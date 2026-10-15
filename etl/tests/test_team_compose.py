"""Offline Compose target/metadata regression tests; no database connections."""
import copy
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import unittest
import tempfile
from datetime import datetime, timezone
from unittest.mock import patch

from team_data import DataError
from team_guard import (DATABASE, DB_IMAGE, LABEL, NETWORK, OWNER, PGDATA, PROJECT,
                        VOLUMES, claim, prove_database)

ROOT = Path(__file__).resolve().parents[2]


class TeamComposeTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('docker'), 'Docker CLI unavailable')
    def test_fresh_checkout_defaults_v2_release_and_v1_local_override_reaches_every_gate(self):
        base = dict(os.environ)
        for name in ['TEAM_DATA_MODE', 'TEAM_DATA_VERSION', 'COMPOSE_PROJECT_NAME', 'COMPOSE_FILE']:
            base.pop(name, None)
        for overrides, version, mode in [({}, 'real-data-v2', 'release'),
                ({'TEAM_DATA_VERSION': 'real-data-v1', 'TEAM_DATA_MODE': 'local'}, 'real-data-v1', 'local')]:
            with self.subTest(version=version):
                result = subprocess.run(['docker', 'compose', '--env-file', os.devnull,
                    '-f', str(ROOT / 'docker-compose.yml'), 'config', '--format', 'json'],
                    env=dict(base, **overrides), cwd=ROOT, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, 'Compose rendering failed')
                config = json.loads(result.stdout)
                self.assertEqual(config['name'], PROJECT)
                for service in ['preflight', 'data-init', 'db-identity', 'db-migrate', 'etl-init']:
                    self.assertEqual(config['services'][service]['environment']['TEAM_DATA_VERSION'], version)
                self.assertEqual(config['services']['data-init']['environment']['TEAM_DATA_MODE'], mode)
                self.assertEqual({v['name'] for v in config['volumes'].values()}, set(VOLUMES.values()))

    def test_flyway_shell_gate_checks_binding_without_invoking_a_database(self):
        source=(ROOT/'docker/team-dev/migrate.sh').read_text()
        syntax=subprocess.run(['sh','-n',str(ROOT/'docker/team-dev/migrate.sh')],capture_output=True,text=True)
        self.assertEqual(syntax.returncode,0)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,value in {'sid':'12345','owner':'a'*32,'dataset-version':'real-data-v2',
                               'dataset-contract':'b'*64,'password':'fixture-only'}.items():
                (root/name).write_text(value)
            script=source.replace('/control/',shlex.quote(str(root)+'/'))
            script=script.replace('exec /flyway/flyway migrate', 'printf \'%s\' "$FLYWAY_INIT_SQL"')
            self.assertNotIn('exec /flyway/flyway',script)
            for selected,code in [('real-data-v2',0),('real-data-v1',1)]:
                result=subprocess.run(['sh','-s'],input=script,env=dict(os.environ,TEAM_DATA_VERSION=selected),
                                      capture_output=True,text=True)
                self.assertEqual(result.returncode,code)
                if not code:
                    self.assertIn("version='real-data-v2'",result.stdout)
                    self.assertIn("contract='"+'b'*64+"'",result.stdout)
                    self.assertIn("current_database()<>'recycleyoungs_team_dev'",result.stdout)
                else:self.assertEqual(result.stdout,'')

    def test_fixed_contracts_are_in_worker_build_context_and_raw_is_excluded(self):
        rules=(ROOT/'.dockerignore').read_text().splitlines()
        self.assertIn('**',rules)
        for name in ['data/manifest.json','data/release.json','data/public-data-v2.json']:
            self.assertIn('!'+name,rules,'Required COPY source is excluded from the deny-by-default build context')
        self.assertNotIn('!data/raw/**',rules)
        self.assertNotIn('!.codex-local/**',rules)

    @unittest.skipUnless(shutil.which('docker'), 'Docker CLI unavailable')
    def test_explicit_v2_reaches_all_runtime_gates_without_changing_db_resources(self):
        env = dict(os.environ, TEAM_DATA_VERSION='real-data-v2')
        r = subprocess.run(['docker','compose','-f',str(ROOT/'docker-compose.yml'),'config','--format','json'],
                           env=env,cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(r.returncode,0)
        value=json.loads(r.stdout); services=value['services']
        for service in ['preflight','data-init','db-identity','db-migrate','etl-init']:
            self.assertEqual(services[service]['environment']['TEAM_DATA_VERSION'],'real-data-v2')
        self.assertIn('/workspace/etl/team_dataset.py',services['data-init']['entrypoint'])
        self.assertEqual(services['team-postgres']['environment']['POSTGRES_DB'],DATABASE)
        self.assertEqual(services['team-postgres']['ports'][0]['published'],'55432')
        self.assertEqual({v['name'] for v in value['volumes'].values()},set(VOLUMES.values()))
        dockerfile=(ROOT/'docker/team-dev/Dockerfile').read_text()
        for name in ['team_dataset.py','team_public_data.py','public-data-v2.json']:
            self.assertIn(name,dockerfile)

    def test_make_check_db_routes_only_to_guarded_readonly_status(self):
        result = subprocess.run(['make', '-n', 'check-db'], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn('etl/team_dev.py status', result.stdout)
        self.assertNotIn('dbTest', result.stdout)

    def test_interrupted_credential_creation_resumes_without_false_claim(self):
        now = datetime.now(timezone.utc).isoformat()
        resources = {'network_id': 'c' * 64, 'volumes': {'db': {'created': now}}}
        own = {'Created': now, 'State': {'Running': False}, 'Config': {'Labels': {
            LABEL: OWNER, 'com.docker.compose.project': PROJECT, 'com.docker.compose.service': 'preflight'}}}
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'HOSTNAME': 'fixture'}), \
             patch('team_guard.inspect', return_value=own), patch('team_guard.resources', return_value=resources):
            p = Path(tmp)
            with patch('team_guard.secrets.token_hex', side_effect=['a' * 32, 'b' * 64, OSError('fixture')]), self.assertRaises(OSError):
                claim(p)
            self.assertFalse((p / 'ownership.json').exists())
            claim(p)
            self.assertEqual((p / 'password').read_text(), 'b' * 64)
            self.assertEqual(json.loads((p / 'ownership.json').read_text())['owner'], 'a' * 32)
            (p / 'reader-password').unlink()
            with self.assertRaises(DataError): claim(p)

    @unittest.skipUnless(shutil.which('docker'), 'Docker CLI unavailable (config is offline)')
    def test_rendered_compose_ignores_legacy_connection_injection(self):
        env = dict(os.environ, DB_NAME='startup_analysis', DB_PORT='5432', DB_HOST='startup-analysis-postgres',
                   DB_USER='app', DB_PASSWORD='fixture-do-not-use')
        r = subprocess.run(['docker', 'compose', '-f', str(ROOT / 'docker-compose.yml'), 'config', '--format', 'json'],
                           env=env, capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(r.returncode, 0, 'Compose config validation failed')
        value = json.loads(r.stdout); services = value['services']; db = services['team-postgres']
        self.assertNotIn('postgres', services)  # Never reconcile the protected legacy Compose service.
        self.assertEqual(value['name'], PROJECT)
        self.assertEqual(db['environment']['POSTGRES_DB'], DATABASE)
        self.assertEqual(db['ports'][0]['published'], '55432')
        self.assertEqual(db['ports'][0]['host_ip'], '127.0.0.1')
        self.assertNotIn('container_name', db)
        for forbidden in ['startup_analysis', 'startup-analysis-postgres', 'recycleyoungs_postgres_data', 'fixture-do-not-use']:
            self.assertNotIn(forbidden, r.stdout)
        self.assertEqual(set(value['volumes'][v]['name'] for v in value['volumes']), set(VOLUMES.values()))
        self.assertTrue(value['networks']['team']['internal'])
        source = next(v for v in services['data-init']['volumes'] if v['type'] == 'bind')
        self.assertTrue(source['read_only']); self.assertFalse(source['bind']['create_host_path'])
        for service in services.values(): self.assertEqual(service['labels'][LABEL], OWNER)
        self.assertEqual(services['etl-init']['depends_on']['db-migrate']['condition'], 'service_completed_successfully')
        self.assertEqual(services['db-migrate']['environment']['FLYWAY_BASELINE_ON_MIGRATE'], 'false')
        self.assertEqual(services['db-identity']['pull_policy'], 'build')
        socket_users = [name for name, service in services.items()
                        if any(v.get('source') == '/var/run/docker.sock' for v in service.get('volumes', []))]
        self.assertEqual(socket_users, ['inspect-proxy'])
        proxy = services['inspect-proxy']
        self.assertFalse(proxy.get('ports'))
        self.assertEqual(set(proxy['networks']), {'inspect'})
        self.assertTrue(value['networks']['inspect']['internal'])
        self.assertTrue(proxy['read_only'])
        self.assertEqual(proxy['cap_drop'], ['ALL'])
        self.assertIn('no-new-privileges:true', proxy['security_opt'])
        self.assertEqual(services['preflight']['depends_on']['inspect-proxy']['condition'], 'service_healthy')
        for name in ['preflight', 'db-identity', 'etl-init']:
            self.assertIn('inspect', services[name]['networks'])

    @unittest.skipUnless(shutil.which('docker'), 'Docker CLI unavailable')
    def test_legacy_project_override_cannot_select_legacy_postgres_service(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / 'fixture.env'; env_file.write_text('COMPOSE_PROJECT_NAME=recycleyoungs\n')
            r = subprocess.run(['docker', 'compose', '--env-file', str(env_file), '-f', str(ROOT / 'docker-compose.yml'),
                                'config', '--format', 'json'], capture_output=True, text=True, cwd=ROOT)
            self.assertEqual(r.returncode, 0)
            services = json.loads(r.stdout)['services']
            self.assertNotIn('postgres', services)
            self.assertEqual(services['preflight']['environment']['TEAM_PROJECT'], 'recycleyoungs')

    def test_foreign_volume_is_rejected_before_any_chmod(self):
        own = {'Config': {'Labels': {LABEL: OWNER, 'com.docker.compose.project': PROJECT,
                                   'com.docker.compose.service': 'preflight'}}}
        with patch.dict(os.environ, {'HOSTNAME': 'fixture'}), patch('team_guard.inspect', return_value=own), \
             patch('team_guard.resources', side_effect=DataError('Foreign volume')), patch('team_guard.os.chmod') as chmod:
            with self.assertRaises(DataError): claim(Path('/unused'))
            chmod.assert_not_called()

    def fixture(self):
        labels = {LABEL: OWNER, 'com.docker.compose.project': PROJECT, 'com.docker.compose.service': 'team-postgres'}
        network = dict(Id='a' * 64, Name=NETWORK, Internal=True, Driver='bridge', Labels=labels, Containers={})
        volumes = {name: dict(Name=name, Driver='local', Options=None, Labels=labels, CreatedAt='2026-10-14T00:00:00Z')
                   for name in VOLUMES.values()}
        db = dict(Id='b' * 64, Name='/' + PROJECT + '-team-postgres-1', Image=DB_IMAGE, State={'Running': True},
                  Config={'Labels': labels, 'Env': ['POSTGRES_DB=' + DATABASE, 'POSTGRES_USER=ry_team_owner',
                         'PGDATA=' + PGDATA, 'POSTGRES_PASSWORD_FILE=/control/password']},
                  HostConfig={'PortBindings': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55432'}]}},
                  NetworkSettings={'Networks': {NETWORK: {'NetworkID': network['Id'], 'Aliases': ['postgres'], 'IPAddress': '172.20.0.2'},
                                                 PROJECT + '-host': {'NetworkID': 'd' * 64}},
                                   'Ports': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55432'}]}},
                  Mounts=[dict(Destination='/var/lib/postgresql/data', Type='volume', Name=VOLUMES['db'], RW=True),
                          dict(Destination='/control', Type='volume', Name=VOLUMES['control'], RW=False),
                          dict(Destination='/docker-entrypoint-initdb.d', Type='bind', RW=False)])
        def inspect(kind, name):
            host_network = dict(network, Id='d' * 64, Internal=False, Containers={db['Id']: {}})
            return {'network': lambda: network if name == NETWORK else host_network,
                    'volume': lambda: volumes[name], 'container': lambda: db}[kind]()
        return db, network, volumes, inspect

    def test_actual_metadata_checks_reject_protected_or_foreign_targets(self):
        db, network, volumes, inspect = self.fixture()
        with patch('team_guard.inspect', side_effect=inspect):
            self.assertEqual(prove_database()['container_id'], 'b' * 64)
        mutations = [lambda d, n, v: d.update(Image='sha256:wrong'),
                     lambda d, n, v: d['Config']['Labels'].update({LABEL: 'foreign'}),
                     lambda d, n, v: d['Mounts'][0].update(Name='recycleyoungs_postgres_data'),
                     lambda d, n, v: d['HostConfig']['PortBindings']['5432/tcp'][0].update(HostPort='5432'),
                     lambda d, n, v: d['HostConfig']['PortBindings']['5432/tcp'][0].update(HostIp='0.0.0.0'),
                     lambda d, n, v: d['NetworkSettings'].update(Ports={'5432/tcp': []}),
                     lambda d, n, v: n.update(Internal=False),
                     lambda d, n, v: d['Config']['Env'].append('POSTGRES_DB=startup_analysis')]
        for mutate in mutations:
            db, network, volumes, inspect = self.fixture(); mutate(db, network, volumes)
            with self.subTest(mutate=mutate), patch('team_guard.inspect', side_effect=inspect), self.assertRaises(DataError):
                prove_database()


if __name__ == '__main__': unittest.main()
