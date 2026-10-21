"""A routing mismatch must be rejected before opening any database connection."""
import importlib
import importlib.util
import unittest
from unittest.mock import MagicMock, patch


class IsolationTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('api_isolation'), 'isolated adapter required')
        return importlib.import_module('api_isolation')

    def target(self):
        owner='a'*24
        return dict(host='ry-8c1-db-'+owner,network='ry-8c1-net-'+owner,
            dbname='recycleyoungs_integration_test_'+owner,user='integration_test',port='5432',
            data='/var/lib/postgresql/data/pgdata',sid='123456789',label=owner,
            container_id='b'*64,network_id='c'*64,
            db_image='sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5')

    def test_team_database_and_ambient_routing_are_rejected_before_connect(self):
        m=self.module()
        with patch.dict('os.environ',{},clear=True), patch('psycopg.connect') as connect:
            for change in [dict(dbname='recycleyoungs_team_dev'),dict(host='127.0.0.1'),
                           dict(label='x'),dict(sid='7692329130053947430'),dict(db_image='unapproved')]:
                with self.assertRaises(m.IsolationError): m.connect_target(self.target()|change,'synthetic')
            with patch.dict('os.environ',{'PGHOSTADDR':'127.0.0.1'}):
                with self.assertRaises(m.IsolationError): m.connect_target(self.target(),'synthetic')
            connect.assert_not_called()

    def test_same_connection_identity_failure_closes_connection(self):
        m=self.module(); connection=MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchone.return_value=('wrong',)
        with patch.dict('os.environ',{},clear=True),patch('psycopg.connect',return_value=connection):
            with self.assertRaises(m.IsolationError): m.connect_target(self.target(),'synthetic')
        connection.close.assert_called_once()

    def test_same_connection_verifier_checks_actor_readonly_and_timeouts(self):
        m=self.module(); connection=MagicMock()
        row=('recycleyoungs_integration_test_'+'a'*24,'api_reader','api_reader','123456789',
             '/var/lib/postgresql/data/pgdata',5432,'5s','10min','on')
        connection.cursor.return_value.__enter__.return_value.fetchone.return_value=row
        m.verify_connection(connection,self.target(),actor='api_reader',read_only=True)
        for column,value in [(1,'integration_test'),(3,'987'),(8,'off'),(7,'0')]:
            changed=list(row); changed[column]=value
            connection.cursor.return_value.__enter__.return_value.fetchone.return_value=tuple(changed)
            with self.assertRaises(m.IsolationError): m.verify_connection(connection,self.target(),actor='api_reader',read_only=True)


if __name__=='__main__': unittest.main()
