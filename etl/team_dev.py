"""Host-side checks/status and secret-free Gradle bridge. Python standard library only."""
import argparse
import json
import os
import re
import socket
import subprocess
import sys

from team_data import DataError, canonical, require
from team_dataset import (SPATIAL_PROOF_SQL, contract_sha, expected_history, parse_json,
                          validate_binding, validate_spatial, version)
from team_guard import (DATABASE, NETWORK, OWNER, LABEL, PROJECT, SERVICES, VOLUMES,
                        inspect, prove_database)


def docker(*args, input=None):
    result = subprocess.run(['docker', *args], input=input, capture_output=True, text=True, timeout=90)
    require(result.returncode == 0, 'Team Docker operation failed; inspect compose service status/logs')
    return result.stdout.strip()


def preflight():
    version()
    docker('info', '--format', '{{.ServerVersion}}')
    for name in ['COMPOSE_PROJECT_NAME', 'COMPOSE_FILE']:
        require(not os.getenv(name), 'Compose override rejected: ' + name)
    existing = []
    for kind, names in [('container', [PROJECT + '-' + s + '-1' for s in sorted(SERVICES)]),
                        ('network', [NETWORK, PROJECT + '-download', PROJECT + '-host', PROJECT + '-inspect']),
                        ('volume', list(VOLUMES.values()))]:
        for name in names:
            r = subprocess.run(['docker', kind, 'inspect', name], capture_output=True, text=True, timeout=15)
            if r.returncode == 0: existing.append(name)
    require(not existing, 'Existing team-named resources; use status to prove prior ownership, never adopt/delete: ' + ','.join(existing))
    with socket.socket() as s:
        require(s.connect_ex(('127.0.0.1', 55432)) != 0, 'Port 55432 already in use')
    return dict(status='PASS', project=PROJECT, host_port=55432, collisions=0, db_connected=False)


def validate_status(result, metadata, identity):
    require(result['db'] == DATABASE and result['actor'] == 'ry_team_owner' and result['readonly'] == 'on'
            and result['sid'] == identity['sid'] and result['owner'] == identity['owner']
            and result['pgdata'] == metadata['pgdata'], 'Actual status connection identity rejected')
    state = result['state']
    require(state and state['owner'] == identity['owner'] and state['version'] == version()
            and state['contract'] == contract_sha() and state['status'] == 'READY',
            'DB_NOT_READY: selected version/contract is not READY; preserve resources and inspect initialization')
    require(result['migrations'] == state['verification']['migrations'] == expected_history(), 'Flyway history/checksum mismatch')
    require(result['fingerprint'] == state['verification']['fingerprint'], 'READY/actual DB fingerprint mismatch; preserve volume and review')
    validate_spatial(result['spatial'])
    require(re.fullmatch('[0-9a-f]{64}', result['spatial_proof'] or ''), 'Spatial proof missing')


def proof():
    metadata = prove_database()
    cid = metadata['container_id']
    ledger = parse_json(docker('exec', cid, 'cat', '/control/ownership.json'))
    identity = parse_json(docker('exec', cid, 'cat', '/control/identity.json'))
    validate_binding(ledger)
    validate_binding(identity)
    require(identity['resources'] == ledger['resources'] == metadata['resources']
            and identity['owner'] == ledger['owner'] and identity['image'] == metadata['image'],
            'Persisted ownership proof mismatch')
    sid, owner = identity['sid'], identity['owner']
    require(sid.isdecimal() and sid != '7692329130053947430' and len(owner) == 32
            and all(x in '0123456789abcdef' for x in owner), 'Unsafe SQL identity proof')
    query = """BEGIN READ ONLY; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';
      SELECT jsonb_build_object('db',current_database(),'actor',current_user,
        'sid',(SELECT system_identifier::text FROM pg_control_system()),
        'pgdata',current_setting('data_directory'),'owner',current_setting('recycleyoungs.owner',true),
        'readonly',current_setting('transaction_read_only'),
        'state',(SELECT to_jsonb(s) FROM team_dev.state s WHERE singleton),
        'fingerprint',team_dev.fingerprint(),
        'migrations',(SELECT jsonb_agg(jsonb_build_object('version',version,'checksum',checksum,'success',success)
          ORDER BY installed_rank) FROM public.flyway_schema_history),
        'spatial',(SELECT jsonb_agg(to_jsonb(v) ORDER BY boundary_kind) FROM public.spatial_dataset_versions v),
        'spatial_proof',(""" + SPATIAL_PROOF_SQL + """)); ROLLBACK;"""
    result = parse_json(docker('exec', '-i', cid, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                              '-U', 'ry_team_owner', '-d', DATABASE, input=query))
    validate_status(result, metadata, identity)
    state = result['state']
    metadata.update(sid=sid, owner=owner, contract=state['contract'], version=version(), spatial_proof=result['spatial_proof'],
                    verification=state['verification'], status='READY')
    return metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['preflight', 'status', 'backend-proof'])
    args = parser.parse_args()
    try:
        if args.action == 'preflight': value = preflight()
        else:
            value = proof()
            if args.action == 'backend-proof':
                # Only Gradle consumes this captured stdout, never log or save it.
                password = docker('exec', value['container_id'], 'cat', '/control/reader-password')
                value = dict(sid=value['sid'], owner=value['owner'], contract=value['contract'], password=password,
                             version=value['version'], spatial=value['spatial_proof'])
        print(canonical(value))
    except Exception as exc:
        print('TEAM_DEV_NOT_READY: ' + (str(exc) if isinstance(exc, DataError) else type(exc).__name__), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__': main()
