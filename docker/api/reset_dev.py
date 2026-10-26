"""Explicit local-project Docker reset. Default is a metadata-only preview.

The operator must verify a current backup and independent restore before applying
this to existing data. This tool neither connects to a database nor inspects a
backup. Shared images/cache and host configuration files are never removed.
"""
import argparse
import http.client
import json
import os
import re
import socket
from urllib.parse import quote

ENV_LABEL = 'org.recycleyoungs.environment'
PROJECT_LABEL = 'com.docker.compose.project'
ENVIRONMENT = 'local-development-v1'
SERVICES = {'inspect-proxy', 'preflight', 'api-postgres', 'identity', 'migrate',
            'initialize', 'api-backend', 'frontend', 'api-scheduler', 'setup', 'reset'}
VOLUMES = {'db', 'control', 'data', 'reader', 'writer'}
NETWORKS = {'data', 'inspect', 'access'}
ROLES = {'worker', 'migrator', 'backend', 'frontend'}


def require(ok, code):
    if not ok:
        raise ValueError(code)


def owned(labels, project):
    return (labels or {}).get(PROJECT_LABEL) == project and (labels or {}).get(ENV_LABEL) == ENVIRONMENT


def selected(value, keys):
    return {key: value.get(key) for key in keys}


def resource_labels(labels):
    keys = {PROJECT_LABEL, ENV_LABEL, 'com.docker.compose.service', 'com.docker.compose.volume',
            'com.docker.compose.network', 'org.recycleyoungs.project', 'org.recycleyoungs.artifact'}
    return {k: v for k, v in (labels or {}).items() if k in keys}


def container_record(c):
    return selected(c, ['Id', 'Names', 'Created', 'Image', 'ImageID']) | {
        'Labels': resource_labels(c.get('Labels')),
        'volumes': sorted(m['Name'] for m in c.get('Mounts', []) if m['Type'] == 'volume'),
        'networks': sorted(n.get('NetworkID', '') for n in c.get('NetworkSettings', {}).get('Networks', {}).values())}


def volume_record(v):
    return selected(v, ['Name', 'CreatedAt', 'Driver', 'Options']) | {'Labels': resource_labels(v.get('Labels'))}


def network_record(n):
    return selected(n, ['Id', 'Name', 'Created', 'Driver', 'Options']) | {'Labels': resource_labels(n.get('Labels'))}


def image_record(i):
    return dict(Id=i['Id'], RepoTags=sorted(i.get('RepoTags') or []), Labels=resource_labels((i.get('Config') or {}).get('Labels')))


def containers(engine):
    # Discard commands, bind source paths and other unrelated metadata immediately.
    return [container_record(c) for c in engine.request('GET', '/containers/json?all=1')]


def plan_reset(engine, project, self_id=None):
    require(bool(re.fullmatch(r'recycleyoungs-dev(?:-check-[0-9a-f]{8})?', project)), 'RESET_PROJECT_REJECTED')
    all_containers = containers(engine)
    mine = []
    for c in all_containers:
        labelled = c['Labels'].get(PROJECT_LABEL) == project
        collision = any(name.startswith('/' + project + '-') for name in c['Names'])
        if not labelled and not collision:
            continue
        require(owned(c['Labels'], project), 'RESET_CONTAINER_OWNER_REJECTED')
        service = c['Labels'].get('com.docker.compose.service')
        require(service in SERVICES and re.fullmatch('[0-9a-f]{64}', c['Id']), 'RESET_CONTAINER_REJECTED')
        pattern = '/' + re.escape(project + '-' + service) + r'(?:-1|-run-[0-9a-f]+)'
        require(len(c['Names']) == 1 and re.fullmatch(pattern, c['Names'][0]), 'RESET_CONTAINER_NAME_REJECTED')
        if self_id and c['Id'].startswith(self_id):
            require(service == 'reset', 'RESET_SELF_REJECTED')
            continue
        require(service != 'reset', 'RESET_CONCURRENT_OPERATOR_REJECTED')
        mine.append(c)
    if self_id:
        require(any(c['Id'].startswith(self_id) and c['Labels'].get('com.docker.compose.service') == 'reset'
                    for c in all_containers), 'RESET_SELF_REJECTED')
    ids = {c['Id'] for c in mine}
    others = [c for c in all_containers if c['Id'] not in ids]
    volumes = []
    for v in engine.request('GET', '/volumes').get('Volumes') or []:
        if v['Name'] not in {project + '-' + role for role in VOLUMES} and (v.get('Labels') or {}).get(PROJECT_LABEL) != project:
            continue
        role = v['Name'].removeprefix(project + '-')
        require(role in VOLUMES and owned(v.get('Labels'), project)
                and v['Labels'].get('com.docker.compose.volume') == role
                and v['Driver'] == 'local' and not v.get('Options'), 'RESET_VOLUME_OWNER_REJECTED')
        require(not any(v['Name'] in c['volumes'] for c in others), 'RESET_SHARED_VOLUME_REJECTED')
        volumes.append(volume_record(v))
    names = {v['Name'] for v in volumes}
    require(all(set(c['volumes']) <= names for c in mine), 'RESET_FOREIGN_MOUNT_REJECTED')
    networks = []
    for n in engine.request('GET', '/networks'):
        if n['Name'] not in {project + '-' + role for role in NETWORKS} and (n.get('Labels') or {}).get(PROJECT_LABEL) != project:
            continue
        role = n['Name'].removeprefix(project + '-')
        require(role in NETWORKS and owned(n.get('Labels'), project)
                and n['Labels'].get('com.docker.compose.network') == role
                and n['Driver'] == 'bridge' and re.fullmatch('[0-9a-f]{64}', n['Id']), 'RESET_NETWORK_OWNER_REJECTED')
        require(not any(n['Id'] in c['networks'] for c in others), 'RESET_SHARED_NETWORK_REJECTED')
        networks.append(network_record(n))
    images = {}; preserved = []
    allowed_tags = {project + '-' + role + ':local' for role in ROLES}
    for tag in sorted(allowed_tags):
        i = engine.request('GET', '/images/' + quote(tag, safe='') + '/json')
        if i is None:
            continue
        i = image_record(i)
        require(re.fullmatch('sha256:[0-9a-f]{64}', i['Id']), 'RESET_IMAGE_ID_REJECTED')
        proof = (i['Labels'].get('org.recycleyoungs.project') == project
                 and i['Labels'].get('org.recycleyoungs.artifact') == ENVIRONMENT)
        proof = proof or any(c['Image'] == tag and c['ImageID'] == i['Id'] for c in mine)
        shared = any(c['ImageID'] == i['Id'] or c['Image'] in i['RepoTags'] for c in others)
        if not proof or shared or not set(i['RepoTags']) <= allowed_tags:
            preserved.append(tag)
        else:
            images[i['Id']] = i
    return dict(project=project, self_id=self_id,
                containers=sorted(mine, key=lambda c: (c['Labels'].get('com.docker.compose.service') != 'api-scheduler', c['Id'])),
                volumes=sorted(volumes, key=lambda v: v['Name']), networks=sorted(networks, key=lambda n: n['Id']),
                images=sorted(images.values(), key=lambda i: i['Id']), preserved_images=preserved,
                shared_cache='PRESERVED; use docker compose build --no-cache')


def apply_reset(engine, plan, confirm):
    require(confirm == plan['project'], 'RESET_EXPLICIT_PROJECT_CONFIRMATION_REQUIRED')
    require(plan_reset(engine, plan['project'], plan['self_id']) == plan, 'RESET_INVENTORY_CHANGED')
    for c in plan['containers']:
        engine.request('POST', '/containers/' + c['Id'] + '/stop?t=30')
    for c in plan['containers']:
        engine.request('DELETE', '/containers/' + c['Id'] + '?v=false&force=false')
    for v in plan['volumes']:
        require(volume_record(engine.request('GET', '/volumes/' + v['Name'])) == v, 'RESET_VOLUME_CHANGED')
        require(not any(v['Name'] in c['volumes'] for c in containers(engine)), 'RESET_SHARED_VOLUME_REJECTED')
        engine.request('DELETE', '/volumes/' + v['Name'] + '?force=false')
    for n in plan['networks']:
        require(network_record(engine.request('GET', '/networks/' + n['Id'])) == n, 'RESET_NETWORK_CHANGED')
        require(not any(n['Id'] in c['networks'] for c in containers(engine)), 'RESET_SHARED_NETWORK_REJECTED')
        engine.request('DELETE', '/networks/' + n['Id'])
    for i in plan['images']:
        ref = quote(i['Id'], safe='')
        require(image_record(engine.request('GET', '/images/' + ref + '/json')) == i, 'RESET_IMAGE_CHANGED')
        require(not any(c['ImageID'] == i['Id'] or c['Image'] in i['RepoTags'] for c in containers(engine)), 'RESET_SHARED_IMAGE_REJECTED')
        # The daemon also refuses in-use images; never force or prune parent images.
        engine.request('DELETE', '/images/' + ref + '?force=false&noprune=true')
    remaining = plan_reset(engine, plan['project'], plan['self_id'])
    require(not any(remaining[k] for k in ('containers', 'volumes', 'networks', 'images')), 'RESET_NEW_RESOURCES_REMAIN')


class UnixConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


class Engine:
    def request(self, method, path):
        if method != 'GET':
            print(json.dumps(dict(action=method, resource=path)), flush=True)
        conn = UnixConnection('localhost', timeout=45)
        try:
            conn.request(method, '/v1.49' + path)
            response = conn.getresponse()
            raw = response.read(8 * 1024 * 1024 + 1)
            require(len(raw) <= 8 * 1024 * 1024, 'RESET_METADATA_TOO_LARGE')
            if method == 'GET' and path.startswith('/images/') and response.status == 404:
                return None
            require(response.status in (200, 201, 204, 304), 'RESET_ENGINE_REQUEST_FAILED')
            return json.loads(raw) if raw else None
        finally:
            conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Delete the displayed owned resources; requires a verified current backup for existing data')
    parser.add_argument('--confirm', help='Exact project name; required with --apply')
    args = parser.parse_args()
    project = os.environ.get('DEV_PROJECT', 'recycleyoungs-dev')
    self_id = os.environ.get('HOSTNAME')
    require(self_id and re.fullmatch('[0-9a-f]{12,64}', self_id), 'RESET_SELF_REJECTED')
    engine = Engine(); plan = plan_reset(engine, project, self_id)
    print(json.dumps(dict(status='RESET_PREVIEW', plan=plan), ensure_ascii=False), flush=True)
    if args.apply:
        apply_reset(engine, plan, args.confirm)
        print(json.dumps(dict(status='RESET_COMPLETE', project=project, cache_deleted=False)), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error)
        if not re.fullmatch('RESET_[A-Z_]+', code):
            code = 'RESET_FAILED'
        print(json.dumps(dict(status='STOP', code=code, automatic_retry=False)), flush=True)
        raise SystemExit(2) from None
