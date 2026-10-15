"""Explicit integration fixtures on the owned team DB, all fixture mutations rolled back."""
import argparse
from unittest.mock import patch

import team_db
from team_data import DataError, canonical, require
from team_dataset import contract_sha, version


def rejected(fn):
    try: fn()
    except DataError: return
    raise AssertionError('Expected fail-closed rejection')


def run():
    checks = []
    identity = team_db.load_identity()
    require(identity is not None, 'Team DB identity is required')
    with patch('team_db.load_identity', return_value=dict(identity, sid='1')):
        rejected(team_db.connect)
    checks.append('ACTUAL_CONNECTION_WRONG_SID_REJECTED')
    with team_db.connect() as c:
        team_db.assert_ready(c)
        before = team_db.fingerprint(c)
        for column, value in [('version', 'fixture-v2'), ('contract', '0' * 64), ('status', 'FAILED')]:
            with c.transaction(force_rollback=True):
                c.execute('UPDATE team_dev.state SET ' + column + '=%s', (value,))
                rejected(lambda: team_db.assert_ready(c))
                if column != 'status':
                    rejected(lambda: team_db.migration_state(team_db.read_state(c), version(), contract_sha(), identity['owner']))
            checks.append(column.upper() + '_MISMATCH_REJECTED_WITHOUT_RELOAD')
        with c.transaction(force_rollback=True):
            c.execute("UPDATE stores SET name=name || ' fixture' WHERE id=(SELECT min(id) FROM stores)")
            rejected(lambda: team_db.assert_ready(c))
        checks.append('READY_VALUE_TAMPERING_DETECTED')
        with c.transaction(force_rollback=True):
            # RESTART is transactional, unlike setval/nextval. Rollback also restores the
            # sequence if the real stats loader consumes IDs during this failure fixture.
            c.execute('ALTER SEQUENCE store_stats_dong_id_seq RESTART')
            team_db.checkpoint(c, 'LOADING', 'CSV')
            rejected(lambda: team_db.load_csv(c, fail_after='stats'))
            team_db.checkpoint(c, 'FAILED', 'CSV')
            rejected(lambda: team_db.assert_ready(c))
            require(team_db.read_state(c)['status'] == 'FAILED', 'Failed ETL was marked READY')
        checks.append('REAL_CSV_FAILURE_ROLLBACK_AND_FAILED_NOT_READY')
        require(team_db.fingerprint(c) == before, 'Failure fixtures changed data/IDs/sequences')
        team_db.assert_ready(c)
        checks.append('FIXTURE_ROLLBACK_RESTORES_READY_DATA_IDS_SEQUENCES')
    return dict(status='PASS', checks=checks, count=len(checks), scope='owned team DB only; all fixture mutations rolled back')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--owned-team-db', action='store_true', required=True)
    parser.parse_args()
    try: print(canonical(run()))
    except Exception as exc:
        print(canonical(dict(status='FAIL', reason=str(exc) if isinstance(exc, DataError) else type(exc).__name__)))
        raise SystemExit(1)
