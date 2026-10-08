"""DB-free tests for the full integration verification tool's safety and digest contract."""
import hashlib
import os
from copy import deepcopy
from pathlib import Path
import sys
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import integration_support as support


class IntegrationSupportTests(unittest.TestCase):
    def proof(self):
        return {'host': 'ry-8c1-db-abc123', 'port': '5432', 'user': 'integration_test',
                'container_id': 'a'*64, 'network': 'ry-8c1-net-abc123', 'internal': True,
                'port_bindings': {}, 'mounts': [],
                'tmpfs': {'/var/lib/postgresql/data': 'rw', '/docker-entrypoint-initdb.d': 'rw'},
                'system_identifier': '123456789'}

    def dsn(self, **overrides):
        values = dict(host='ry-8c1-db-abc123', port='5432', user='integration_test',
                      dbname='recycleyoungs_integration_test_abc123_fresh', password='test_only')
        values.update(overrides)
        return ' '.join(f'{k}={v}' for k,v in values.items())

    def test_unsafe_targets_fail_before_connection(self):
        cases = [{'host':'localhost'}, {'host':'startup-analysis-postgres'}, {'dbname':'startup_analysis'},
                 {'hostaddr':'127.0.0.1'}, {'service':'production'}, {'port':'5433'}, {'user':'app'}]
        for overrides in cases:
            with self.subTest(overrides=overrides), patch.object(support.psycopg, 'connect') as connect:
                with self.assertRaises(ValueError):
                    support.connect_isolated(self.dsn(**overrides), self.proof())
                connect.assert_not_called()
        for change in [{'internal':False}, {'mounts':[{'Name':'recycleyoungs_postgres_data'}]},
                       {'port_bindings':{'5432/tcp':[{'HostPort':'5432'}]}}, {'tmpfs':{}}, {'container_id':''}]:
            with self.subTest(change=change), patch.object(support.psycopg, 'connect') as connect:
                with self.assertRaises(ValueError):
                    support.connect_isolated(self.dsn(), dict(self.proof(), **change))
                connect.assert_not_called()

    def test_ambient_libpq_route_service_options_rejected_before_connection(self):
        overrides={'PGHOSTADDR':'127.0.0.1','PGSERVICE':'development',
                   'PGSERVICEFILE':'/tmp/service.conf','PGSYSCONFDIR':'/tmp',
                   'PGOPTIONS':'-c search_path=public'}
        for name,value in overrides.items():
            with self.subTest(name=name), patch.dict(os.environ,{name:value}), patch.object(support.psycopg,'connect') as connect:
                connect.side_effect=AssertionError('must not attempt connection')
                with self.assertRaisesRegex(ValueError,'libpq'):
                    support.connect_isolated(self.dsn(),self.proof())
                connect.assert_not_called()

    def test_length_framed_stream_digest_retains_null_zero_and_order(self):
        self.assertNotEqual(support.digest_records(iter(['null'])), support.digest_records(iter(['0'])))
        self.assertNotEqual(support.digest_records(iter(['a','bc'])), support.digest_records(iter(['ab','c'])))
        self.assertNotEqual(support.digest_records(iter(['a','b'])), support.digest_records(iter(['b','a'])))
        payload = '한글'.encode()
        expected = hashlib.sha256(len(payload).to_bytes(8,'big')+payload).hexdigest()
        self.assertEqual(support.digest_records(iter(['한글'])), {'rows':1,'sha256':expected})

    def preservation_fixture(self):
        tables = {name:{'rows':1,'sha256':'a'*64} for name in support.V1_TABLES}
        return {'physical':tables,'raw':{'stores':{'rows':1,'sha256':'b'*64}},
                'expected_v3_classification':{'rows':1,'sha256':'c'*64},
                'classification':{'rows':1,'sha256':'c'*64},
                'target_ids':{'rows':1,'sha256':'d'*64},'mappings':[],
                'sequences':{'stores_id_seq':{'last_value':1,'is_called':True}},
                'history':[{'version':'1','checksum':42}]}

    def test_preservation_checker_rejects_id_sequence_and_classification_change(self):
        before=self.preservation_fixture()
        support.compare_preserved(before,deepcopy(before),migrated=True)
        for part,key in [('raw','stores'),('sequences','stores_id_seq')]:
            with self.subTest(part=part):
                after=deepcopy(before)
                after[part][key]={}
                with self.assertRaises(AssertionError):
                    support.compare_preserved(before,after,migrated=True)
        after=deepcopy(before)
        after['classification']={'rows':1,'sha256':'wrong'}
        with self.assertRaises(AssertionError):
            support.compare_preserved(before,after,migrated=True)

    def test_first_publication_may_advance_only_new_spatial_sequences(self):
        before=self.preservation_fixture()
        before['sequences']['admin_dong_boundaries_id_seq']={'last_value':1,'is_called':False}
        after=deepcopy(before)
        after['sequences']['admin_dong_boundaries_id_seq']={'last_value':425,'is_called':True}
        support.compare_preserved(before,after)

    def test_v1_loader_rejects_development_connection_before_queries(self):
        conn=MagicMock()
        conn.info=SimpleNamespace(host='localhost',dbname='startup_analysis',user='app',port=5432)
        with self.assertRaisesRegex(ValueError,'isolated'):
            support.load_v1_stores(conn,None)
        conn.transaction.assert_not_called()
        conn.cursor.assert_not_called()

    def test_optimized_python_cannot_disable_verification_assertions(self):
        script="import sys;sys.path.insert(0,"+repr(str(Path(__file__).resolve().parent))+");import integration_support"
        result=subprocess.run([sys.executable,'-O','-c',script],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('optimization',result.stderr)

    def test_v1_fixture_rejects_non_v1_or_nonempty(self):
        for versions, count in [(['1','2','3'],0), (['1'],1), ([],0)]:
            with self.subTest(versions=versions,count=count):
                with self.assertRaises(ValueError):
                    support.assert_v1_fixture_state(versions,count)
        support.assert_v1_fixture_state(['1'],0)


if __name__ == '__main__':
    unittest.main()
