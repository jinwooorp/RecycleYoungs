"""Persistent ownership, calendar bounds and crash-state decisions, without DB/Docker."""
from datetime import datetime,timezone
import importlib,importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


class PersistentTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('api_runtime'),'persistent runtime required')
        return importlib.import_module('api_runtime')

    def test_next_due_is_future_korean_monday_even_on_restart(self):
        m=self.module()
        self.assertEqual(m.next_due(datetime(2026,10,21,12,tzinfo=timezone.utc)).isoformat(),'2026-10-25T19:30:00+00:00')
        self.assertEqual(m.next_due(datetime(2026,10,25,19,30,tzinfo=timezone.utc)).isoformat(),'2026-11-01T19:30:00+00:00')

    def test_probe_periods_are_completed_bounded_and_do_not_skip_gaps(self):
        m=self.module()
        self.assertEqual(m.probe_quarters('20262',datetime(2026,10,21,tzinfo=timezone.utc)),['20263'])
        self.assertEqual(m.probe_quarters('20254',datetime(2026,2,1,tzinfo=timezone.utc)),[])
        with self.assertRaisesRegex(m.RuntimeErrorCode,'PERIOD_GAP_TOO_LARGE'):
            m.probe_quarters('20251',datetime(2027,10,1,tzinfo=timezone.utc))

    def test_running_failed_or_unknown_jobs_are_not_automatically_retried(self):
        m=self.module()
        for status in ['RUNNING','FAILED','INTERRUPTED','BOGUS']:
            with self.assertRaises(m.RuntimeErrorCode):m.require_automatic_ready(status)
        m.require_automatic_ready('IDLE');m.require_automatic_ready('SUCCEEDED')

    def test_contract2_registry_cannot_fall_back_to_a_contract1_run_list(self):
        import api_worker as worker
        value=[dict(contract_version=2,bundle='/api-data/runs/new/bundle')]
        with patch('app.api_context_release.read_release_bundle',return_value={'release_id':'a'*64}) as load:
            self.assertEqual(worker.registered_release(value)['release_id'],'a'*64)
            load.assert_called_once_with('/api-data/runs/new/bundle')
        for changed in [[dict(contract_version=1,bundle='/api-data/runs/new/bundle')],
                        [dict(contract_version=2,bundle='/outside/bundle')],
                        [dict(contract_version=2,bundle='/api-data/../outside')]]:
            with self.assertRaises(ValueError):worker.registered_release(changed)

    def test_fresh_migration_receipt_requires_every_bound_source_version(self):
        m=self.module()
        files={f'/api-migration/V{v}__test.sql':'a'*64 for v in range(1,6)}
        result=dict(operation='migrate',flywayVersion='12.4.0',migrationsExecuted=5,
                    migrations=[dict(version=str(v),filepath=f'/flyway/api/V{v}__test.sql') for v in range(1,6)])
        m.verify_fresh_migration(result,files)
        for changed in [result|{'migrationsExecuted':4},result|{'migrations':result['migrations'][1:]},
                        result|{'migrations':[dict(version=str(v),filepath='different.sql') for v in range(1,6)]}]:
            with self.assertRaises(ValueError):m.verify_fresh_migration(changed,files)

    def test_target_cannot_be_team_db_or_invented_owner(self):
        m=self.module()
        valid=dict(runtime='local-dev',project='recycleyoungs-dev',owner='a'*24,dbname='recycleyoungs_api_dev',host='api-postgres',port='5432',data='/var/lib/postgresql/data/api',sid='123',container_id='b'*64,network_id='c'*64,volume='recycleyoungs-dev-db')
        m.validate_target(valid)
        for change in [dict(dbname='recycleyoungs_team_dev'),dict(host='127.0.0.1'),dict(volume='recycleyoungs-team-dev-db'),dict(sid='7692329130053947430'),dict(owner=''),
                       dict(runtime=None,project='recycleyoungs-api-dev',volume='recycleyoungs-api-dev-db')]:
            with self.assertRaises(m.RuntimeErrorCode):m.validate_target(valid|change)

    def test_discovery_requires_both_sources_and_stops_at_first_gap(self):
        import importlib.util
        self.assertIsNotNone(importlib.util.find_spec('api_worker'))
        from api_worker import choose_periods
        from api_fixtures import FakeClient,seoul,stats,sales
        client=FakeClient(seoul([stats(STDR_YYQU_CD='20263')]),{'RESULT':{'CODE':'INFO-200'}})
        result=choose_periods({'quarters':['20261','20262']},client,{'SEOUL_OPENAPI_KEY':'fixture'},datetime(2026,10,21,tzinfo=timezone.utc),True)
        self.assertEqual(result,['20262']);self.assertEqual(len(client.calls),2)

    def test_restore_literal_array_cast_roundtrip_keeps_values_and_other_casts(self):
        from api_snapshot import normalize_constraint
        a="CHECK (x = ANY ((ARRAY['A'::character varying, 'B'::character varying])::text[]))"
        b="CHECK (x = ANY (ARRAY[('A'::character varying)::text, ('B'::character varying)::text]))"
        self.assertEqual(normalize_constraint(a),normalize_constraint(b))
        self.assertNotEqual(normalize_constraint(a),normalize_constraint(b.replace("'B'","'C'")))
        expression='CHECK (amount::integer > 0)'
        self.assertEqual(normalize_constraint(expression),expression)
        literal="CHECK (x = ANY ((ARRAY['A::character varying'::character varying])::text[]))"
        self.assertIn("'A::character varying'",normalize_constraint(literal))

    def test_job_deadline_raises_and_restores_signal_handler(self):
        import signal,os
        m=self.module();previous=signal.getsignal(signal.SIGALRM)
        with self.assertRaisesRegex(m.RuntimeErrorCode,'JOB_DEADLINE_EXCEEDED'):
            with m.job_deadline(30):os.kill(os.getpid(),signal.SIGALRM)
        self.assertEqual(signal.getsignal(signal.SIGALRM),previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0.0,0.0))


if __name__=='__main__':unittest.main()
