"""Pure routing checks for disposable real-data demos, separate from test allowlists."""
import re

DB_IMAGE = 'sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5'
ETL_IMAGE = 'sha256:b3bc55d2aeadd8ca3ef25e8c6be50a9f1651420983ded52cf20f98b3cee75536'
JAVA_IMAGE = 'sha256:3e3c176ffed168beb42c607be9bc1639b466cf00261a0fb04425562c9d0c5c2b'
LABEL = 'recycleyoungs.real-data-demo'
PGDATA = '/var/lib/postgresql/data/pgdata'
PROTECTED_ID = '983e738d45ac64e2c5c116117d739fde554b17041f417c2110938847c9edf951'
PROTECTED_SID = '7692329130053947430'


class DemoError(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise DemoError(reason)


def reject_environment(environment):
    forbidden = ('PG', 'DB_', 'FLYWAY_', 'SPRING_DATASOURCE', 'SPRING_FLYWAY',
                 'STORES_', 'SPATIAL_', 'SOURCE_', 'CONTROL_')
    require(not any(value and key.startswith(forbidden) for key, value in environment.items()),
            'Ambient DB/raw configuration rejected; use explicit demo inputs')


def check_owned_database(target, container, network):
    """Deletion/bootstrap metadata proof only; never authorizes a SQL connection."""
    owner = target['owner']
    require(bool(re.fullmatch('[0-9a-f]{24}', owner)), 'Invalid owner')
    require(target['host'] == 'ry-demo-db-' + owner and
            target['network'] == 'ry-demo-net-' + owner and
            target['database'] == 'recycleyoungs_demo_' + owner and
            target['user'] == 'ry_demo_owner', 'Non-demo routing rejected')
    require(target['container_id'] != PROTECTED_ID and
            bool(re.fullmatch('[0-9a-f]{64}', target['container_id'])) and
            bool(re.fullmatch('[0-9a-f]{64}', target['network_id'])), 'Unsafe full identity')
    require(target['image'] == DB_IMAGE and container['Image'] == DB_IMAGE and
            container['Id'] == target['container_id'] and
            container['Name'] == '/' + target['host'],
            'DB container identity changed')
    require(not container['Mounts'] and not container['HostConfig'].get('PortBindings') and
            set(container['HostConfig'].get('Tmpfs', {})) == {
                '/var/lib/postgresql/data', '/docker-entrypoint-initdb.d'}, 'Volume/port/tmpfs rejected')
    require(set(container['NetworkSettings']['Networks']) == {target['network']}, 'Shared network rejected')
    endpoint = container['NetworkSettings']['Networks'][target['network']]
    aliases = set(endpoint.get('Aliases') or []) | set(endpoint.get('DNSNames') or [])
    require(container['HostConfig'].get('NetworkMode') == target['network'] and
            (endpoint['NetworkID'] == target['network_id'] or
             (container['State'].get('Status') == 'created' and not endpoint['NetworkID'])) and target['host'] in aliases,
            'DB endpoint identity changed')
    require(network['Id'] == target['network_id'] and network['Name'] == target['network'] and
            network['Internal'] is True, 'Network identity/isolation changed')
    require(container['Config']['Labels'].get(LABEL) == owner and
            network['Labels'].get(LABEL) == owner, 'Ownership mismatch')
    environment = dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)
    require(target['pgdata'] == PGDATA and environment.get('PGDATA') == PGDATA, 'PGDATA mismatch')


def check_target(target, container, network):
    check_owned_database(target, container, network)
    sid = target.get('sid', '')
    require(sid != PROTECTED_SID and bool(re.fullmatch('[0-9]+', sid)) and container['State']['Running'],
            'Operational SID/readiness proof missing')
