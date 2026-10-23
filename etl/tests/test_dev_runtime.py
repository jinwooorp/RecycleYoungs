"""Local startup decisions and metadata guards, without Docker/DB/credentials."""
import importlib,importlib.util
from pathlib import Path
import tempfile,unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch


class LocalDevTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('dev_runtime'),'one-command startup required')
        return importlib.import_module('dev_runtime')

    def test_project_names_cannot_select_protected_or_arbitrary_resources(self):
        m=self.module()
        self.assertEqual(m.project_name('recycleyoungs-dev'),'recycleyoungs-dev')
        m.project_name('recycleyoungs-dev-check-12abcdef')
        for value in ['recycleyoungs-team-dev','recycleyoungs-api-dev','anything','recycleyoungs-dev-check-nope']:
            with self.assertRaises(ValueError):m.project_name(value)

    def test_completed_startup_reuses_data_but_interrupted_startup_stops(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve()
            self.assertEqual(m.startup_state(root),'NEW')
            (root/'migration.started').write_text('')
            with self.assertRaisesRegex(ValueError,'INITIALIZATION_INTERRUPTED'):m.startup_state(root)
            (root/'ready.json').write_text('{}')
            self.assertEqual(m.startup_state(root),'READY')

    def test_ready_initializer_skips_collection_with_all_external_operations_mocked(self):
        m=self.module();status=Mock(return_value={'status':'READY'})
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'ready.json').write_text('{}')
            with patch.object(m,'CONTROL',root),patch.object(m,'checked_context'), \
                    patch.dict('sys.modules',{'api_worker':SimpleNamespace(status=status)}), \
                    patch.object(m,'initial_periods',side_effect=AssertionError('must not probe')), \
                    patch('app.api_config.load_keys',side_effect=AssertionError('must not read keys')):
                self.assertEqual(m.initialize(),{'status':'READY','initialized':False})
                status.assert_called_once_with()

    def test_identity_rejects_foreign_mount_or_exposed_db_port(self):
        m=self.module(); project='recycleyoungs-dev'
        db=dict(Id='a'*64,Name='/'+project+'-api-postgres-1',Image=m.DB_IMAGE,
            Config={'Labels':{'org.recycleyoungs.environment':'local-development-v1','com.docker.compose.project':project},
                    'Env':['POSTGRES_DB=recycleyoungs_api_dev','POSTGRES_USER=ry_api_owner','PGDATA=/var/lib/postgresql/data/api','POSTGRES_PASSWORD_FILE=/api-control/owner-password']},
            State={'Running':True},HostConfig={'PortBindings':{}},
            NetworkSettings={'Networks':{project+'-data':{'Aliases':['api-postgres']}}},
            Mounts=[dict(Type='volume',Name=project+'-db',Destination='/var/lib/postgresql/data',RW=True),
                    dict(Type='volume',Name=project+'-control',Destination='/api-control',RW=False)])
        network=dict(Id='c'*64,Name=project+'-data',Internal=True)
        self.assertEqual(m.check_database(project,db,network)['container_id'],'a'*64)
        for changed in [db|{'Image':'other'},db|{'HostConfig':{'PortBindings':{'5432/tcp':[{}]}}},
                        db|{'Mounts':[db['Mounts'][0]]},db|{'Mounts':[db['Mounts'][0],db['Mounts'][1]|{'RW':True}]}]:
            with self.assertRaises(ValueError):m.check_database(project,changed,network)

    def test_initial_periods_start_in_2021_and_distinguish_partial_or_internal_gaps(self):
        m=self.module()
        from datetime import datetime,timezone
        self.assertEqual(m.initial_periods(datetime(2026,10,22,tzinfo=timezone.utc),lambda s,q:q!='20263',start_year=2021),
                         [f'{year}{q}' for year in range(2021,2027) for q in range(1,5) if f'{year}{q}'<='20262'])
        with self.assertRaisesRegex(ValueError,'INITIAL_SOURCE_UNAVAILABLE'):
            m.initial_periods(datetime(2026,10,22,tzinfo=timezone.utc),lambda s,q:False)
        with self.assertRaisesRegex(ValueError,'INITIAL_SOURCE_PAIR_MISMATCH'):
            m.initial_periods(datetime(2026,10,22,tzinfo=timezone.utc),lambda s,q:not(s=='sales' and q=='20222'),start_year=2021)
        with self.assertRaisesRegex(ValueError,'INITIAL_SOURCE_PERIOD_GAP'):
            m.initial_periods(datetime(2026,10,22,tzinfo=timezone.utc),lambda s,q:q!='20222',start_year=2021)
        with self.assertRaisesRegex(ValueError,'INITIAL_PERIOD_RANGE_REJECTED'):
            m.initial_periods(datetime(2040,10,22,tzinfo=timezone.utc),lambda s,q:True)
        self.assertEqual(m.initial_periods(datetime(2026,10,22,tzinfo=timezone.utc),lambda s,q:q!='20263'),
                         ['20251','20252','20253','20254','20261','20262'])

    def test_source_image_context_contains_all_new_runtime_inputs(self):
        import api_images
        names=api_images.context_files(api_images.ROOT)
        for p in ['etl/dev_runtime.py','etl/dev_inspect.py','etl/team_inspect_proxy.py','etl/control.py','docker/api/migrate.sh']:
            self.assertTrue(p in names,'source builder missing '+p)

    def test_preflight_validates_both_keys_before_any_state_is_created(self):
        m=self.module()
        with self.assertRaisesRegex(ValueError,'API_KEYS_REQUIRED'):
            m.validate_config(b'SEOUL_OPENAPI_KEY=\nSEMAS_SERVICE_KEY=\n')
        with self.assertRaises(ValueError):m.validate_config(b'SEMAS_SERVICE_KEY=encoded%2Bkey\n')
        m.validate_config(b'# comment\nSEOUL_OPENAPI_KEY=sample\nSEMAS_SERVICE_KEY=sample+key==\n')

    def test_new_connection_contract_does_not_accept_arbitrary_project(self):
        from api_runtime import validate_target
        target=dict(runtime='local-dev',project='recycleyoungs-dev',owner='a'*24,dbname='recycleyoungs_api_dev',host='api-postgres',
                    port='5432',data='/var/lib/postgresql/data/api',sid='123',volume='recycleyoungs-dev-db',container_id='b'*64,network_id='c'*64)
        validate_target(target)
        with self.assertRaises(ValueError):validate_target(target|{'project':'foreign','volume':'foreign-db'})


if __name__=='__main__':unittest.main()
