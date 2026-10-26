"""Explicit V4 -> V5 transition; ordinary startup never upgrades an existing DB.

Plans and receipts are private operational inputs, not approval credentials.
The operator must obtain the scoped human approval after backup/rehearsal review.
An interrupted intent is terminal: there is deliberately no resume/force switch.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
import time
import zlib

from api_runtime import RuntimeErrorCode, require, private_read, validate_target, connect, verify_connection

V5 = '/api-migration/V5__api_context_and_quality_contract.sql'
STEPS = ('migration', 'grants', 'stage', 'publish', 'binding')
PENDING = 'transition-pending.json'


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_plan(p, *, now=None):
    fields = {'format', 'run_id', 'target', 'previous_binding', 'proposed_sql', 'expected_current',
              'candidate', 'bundle', 'bundle_sha256', 'source_sha256', 'backup_sha256',
              'rehearsal_sha256', 'expires_at'}
    require(isinstance(p, dict) and set(p) == fields and p['format'] == 1, 'TRANSITION_PLAN_FORMAT')
    require(isinstance(p['run_id'], str) and re.fullmatch('[0-9a-f]{24}', p['run_id']), 'TRANSITION_RUN_ID')
    validate_target(p['target'])
    old = p['previous_binding']
    require(set(old) == {'project', 'volumes', 'sql'} and old['project'] == p['target']['project']
            and set(old['volumes']) == {'db', 'control', 'data', 'reader', 'writer'}
            and all(isinstance(v, str) and v for v in old['volumes'].values()), 'TRANSITION_BINDING_REJECTED')
    require(isinstance(old['sql'], dict) and len(old['sql']) == 5 and V5 not in old['sql']
            and set(p['proposed_sql']) == set(old['sql']) | {V5}
            and all(p['proposed_sql'][k] == v for k, v in old['sql'].items()), 'TRANSITION_SQL_CHANGED')
    require(all(isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v)
                for v in p['proposed_sql'].values()), 'TRANSITION_SQL_HASH_REQUIRED')
    for key in ('expected_current', 'candidate', 'bundle_sha256', 'source_sha256',
                'backup_sha256', 'rehearsal_sha256'):
        require(isinstance(p[key], str) and re.fullmatch('[0-9a-f]{64}', p[key]), 'TRANSITION_FINGERPRINT_REQUIRED')
    require(p['candidate'] != p['expected_current'], 'TRANSITION_CANDIDATE_UNCHANGED')
    require(p['bundle'] == '/api-data/transitions/'+p['run_id']+'/bundle', 'TRANSITION_BUNDLE_PATH')
    now = time.time() if now is None else now
    require(type(p['expires_at']) in (int, float) and 0 < p['expires_at']-now <= 1800,
            'TRANSITION_APPROVAL_EXPIRED')
    return p


def validate_observation(p, *, target, binding, sql_hashes, current, status):
    require(target == p['target'], 'TRANSITION_TARGET_CHANGED')
    require(binding == p['previous_binding'], 'TRANSITION_BINDING_CHANGED')
    require(sql_hashes == p['proposed_sql'], 'TRANSITION_SQL_CHANGED')
    require(current == p['expected_current'], 'CURRENT_RELEASE_CHANGED')
    require(status in ('IDLE', 'SUCCEEDED'), 'TRANSITION_WRITER_NOT_QUIESCENT')


def exclusive_json(path, value):
    require(not any(p.is_symlink() for p in [path, *path.parents]), 'PRIVATE_SYMLINK_REJECTED')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(value, out, sort_keys=True, separators=(',', ':')); out.flush(); os.fsync(out.fileno())
    fd = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


class Journal:
    """Append-only fsynced intents, results and STOP records; every record is chained."""
    def __init__(self, root, p, records):
        self.root, self.plan, self.records = root, fingerprint(p), records
        self.proposal = json.loads(json.dumps(p))

    @classmethod
    def create(cls, root, p):
        require(not any(x.is_symlink() for x in [root, *root.parents]), 'PRIVATE_SYMLINK_REJECTED')
        root.mkdir(mode=0o700, parents=False, exist_ok=True)
        require(not list(root.iterdir()), 'TRANSITION_JOURNAL_EXISTS')
        j = cls(root, p, []); j.append('PREPARED', None, {})
        return j

    @classmethod
    def open(cls, root, p):
        records = []; previous = None
        for index, path in enumerate(sorted(x for x in root.iterdir() if x.name != 'HEAD')):
            require(path.name == f'{index:06d}.json', 'TRANSITION_JOURNAL_SEQUENCE')
            try: value = json.loads(private_read(path))
            except (ValueError, OSError): raise RuntimeErrorCode('TRANSITION_JOURNAL_INVALID') from None
            require(set(value) == {'seq', 'previous', 'plan', 'status', 'step', 'receipt', 'sha256'},
                    'TRANSITION_JOURNAL_INVALID')
            digest = value['sha256']
            require(value['seq'] == index and value['previous'] == previous and value['plan'] == fingerprint(p)
                    and digest == fingerprint({k:v for k,v in value.items() if k != 'sha256'}),
                    'TRANSITION_JOURNAL_HASH')
            require((index == 0 and value['status'] == 'PREPARED' and value['step'] is None)
                    or (index > 0 and value['status'] in ('INTENT', 'DONE', 'STOP')), 'TRANSITION_JOURNAL_INVALID')
            if index:
                last = records[-1]
                if value['status'] == 'INTENT':
                    completed = sum(x['status'] == 'DONE' for x in records)
                    require(last['status'] in ('PREPARED', 'DONE') and completed < len(STEPS)
                            and value['step'] == STEPS[completed], 'TRANSITION_JOURNAL_ORDER')
                else:
                    require(last['status'] == 'INTENT' and value['step'] == last['step'], 'TRANSITION_JOURNAL_ORDER')
            previous = digest; records.append(value)
        require(bool(records), 'TRANSITION_JOURNAL_MISSING')
        require(json.loads(private_read(root/'HEAD')) == {'sha256':records[-1]['sha256']},
                'TRANSITION_JOURNAL_HEAD')
        return cls(root, p, records)

    def append(self, status, step, receipt):
        head = self.root/'HEAD'
        require((not self.records and not head.exists()) or (self.records and
                json.loads(private_read(head)) == {'sha256':self.records[-1]['sha256']}), 'TRANSITION_JOURNAL_HEAD')
        value = dict(seq=len(self.records), previous=self.records[-1]['sha256'] if self.records else None,
                     plan=self.plan, status=status, step=step, receipt=receipt)
        value['sha256'] = fingerprint(value)
        exclusive_json(self.root/f'{len(self.records):06d}.json', value)
        temporary = self.root/('.head-'+secrets.token_hex(12))
        exclusive_json(temporary, {'sha256':value['sha256']}); os.replace(temporary, head)
        fd = os.open(self.root, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
        self.records.append(value)

    def intent(self, step):
        last = self.records[-1]
        require(last['status'] != 'STOP', 'TRANSITION_STOPPED')
        require(last['status'] != 'INTENT', 'TRANSITION_INTERRUPTED')
        done = sum(x['status'] == 'DONE' for x in self.records)
        require(done < len(STEPS) and step == STEPS[done], 'TRANSITION_STEP_ORDER')
        self.append('INTENT', step, {})

    def done(self, step, receipt):
        require(self.records[-1]['status'] == 'INTENT' and self.records[-1]['step'] == step,
                'TRANSITION_STEP_ORDER')
        self.append('DONE', step, receipt)

    def stop(self, step, code):
        require(self.records[-1]['status'] == 'INTENT' and self.records[-1]['step'] == step,
                'TRANSITION_STEP_ORDER')
        self.append('STOP', step, {'code': code})


def flyway_checksum(path):
    crc = 0
    for line in path.read_text(encoding='utf-8-sig').splitlines(): crc = zlib.crc32(line.encode(), crc)
    return crc if crc < 2**31 else crc-2**32


def require_clear(control):
    require(not (Path(control)/PENDING).exists(), 'TRANSITION_REQUIRES_REVIEW')


def execute_step(journal, step, operation, *, verify_preconditions=None):
    """Both the real operator and the isolated rehearsal use this exact gate."""
    journal.intent(step)
    try:
        validate_plan(journal.proposal)
        require(fingerprint(journal.proposal) == journal.plan, 'TRANSITION_PLAN_CHANGED')
        require(callable(verify_preconditions), 'TRANSITION_PRECONDITIONS_REQUIRED')
        proof = verify_preconditions(journal.proposal, step)
        validate_step_proof(journal.proposal, step, proof)
        validate_plan(journal.proposal)
        receipt = operation()
        require(isinstance(receipt, dict) and receipt.get('status') == 'PASS', 'TRANSITION_PROOF_REQUIRED')
        journal.done(step, receipt)
        return receipt
    except BaseException as error:
        journal.stop(step, str(error) if isinstance(error, RuntimeErrorCode) else 'TRANSITION_OPERATION_FAILED')
        raise


def validate_step_proof(p, step, proof):
    expected = dict(status='PASS', plan_sha256=fingerprint(p), target_sha256=fingerprint(p['target']),
                    source_sha256=p['source_sha256'], sql_sha256=fingerprint(p['proposed_sql']),
                    input_sha256=p['bundle_sha256'], previous_binding_sha256=fingerprint(p['previous_binding']),
                    current=p['candidate'] if step in ('binding', 'finish') else p['expected_current'])
    require(isinstance(proof, dict) and all(proof.get(k) == v for k,v in expected.items())
            and proof.get('job_status') in ('IDLE', 'SUCCEEDED'), 'TRANSITION_PRECONDITIONS_CHANGED')


def validate_publication(p, *, current, registered, status):
    require(current == p['candidate'] and registered == p['candidate'] and status == 'READY',
            'TRANSITION_PUBLICATION_NOT_VERIFIED')


def runtime_fingerprint():
    paths = []
    for folder, pattern in [('/workspace/etl', '*.py'), ('/workspace/etl/app', '*.py'),
                            ('/workspace/backend/src/main/resources/db/migration', '*.sql'),
                            ('/api-migration', '*.sql'), ('/api-schema', '*.sql')]:
        paths.extend(sorted(Path(folder).glob(pattern)))
    paths.append(Path('/workspace/data/boundaries/public-reports.json'))
    return fingerprint({str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths})


def apply_grants(conn, *, verify_identity):
    with conn.transaction():
        verify_identity(conn)
        conn.execute('GRANT SELECT ON api_context_runs,api_context_rows,api_release_context_sources,published_context_rows TO api_reader,api_writer')
        conn.execute('GRANT INSERT ON api_context_runs,api_context_rows,api_release_context_sources TO api_writer')
        conn.execute('GRANT UPDATE(run_id) ON api_context_runs TO api_writer')
    return dict(status='PASS', kind='V5_ADDITIVE_GRANTS')


def stage_candidate(conn, p, release, *, verify_identity, register):
    from app.api_context_release import stage_context_release
    require(release['release_id'] == p['candidate'] and release['baseline']['release_id'] == p['expected_current'],
            'TRANSITION_BASELINE_CHANGED')
    with conn.transaction():
        verify_identity(conn)
        require(conn.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()
                == (p['expected_current'],), 'CURRENT_RELEASE_CHANGED')
    result = stage_context_release(conn, release, verify_identity=verify_identity)
    register(conn, release)
    return dict(status='PASS', release_id=release['release_id'], result=result)


def publish_candidate(conn, p, *, verify_identity, registered):
    from app.api_release import publish_release
    require(registered(conn) == p['candidate'], 'TRANSITION_REGISTRY_CHANGED')
    result = publish_release(conn, p['candidate'], expected_current=p['expected_current'], verify_identity=verify_identity)
    require(result is True, 'TRANSITION_CAS_NOT_PERFORMED')
    with conn.transaction():
        verify_identity(conn)
        row = conn.execute('SELECT c.release_id,r.status FROM api_current_release c JOIN api_releases r USING(release_id) WHERE c.singleton').fetchone()
        validate_publication(p, current=row[0], registered=registered(conn), status=row[1])
    return dict(status='PASS', release_id=p['candidate'], result=result)


def replace_binding(path, expected, proposed, run_id):
    require(json.loads(private_read(path)) == expected, 'TRANSITION_BINDING_CHANGED')
    backup = path.parent/('binding-before-'+run_id+'.json')
    exclusive_json(backup, expected)
    temporary = path.parent/('binding-next-'+run_id+'.json')
    exclusive_json(temporary, proposed)
    require(json.loads(private_read(path)) == expected, 'TRANSITION_BINDING_CHANGED')
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


def commit_bindings(p, control, writer, *, verify_publication):
    """An incomplete two-volume update stays blocked by both persistent markers."""
    marker = dict(run_id=p['run_id'], plan_sha256=fingerprint(p))
    for root in (control, writer):
        require(json.loads(private_read(root/PENDING)) == marker, 'TRANSITION_MARKER_CHANGED')
        require(json.loads(private_read(root/'binding.json')) == p['previous_binding'], 'TRANSITION_BINDING_CHANGED')
    proof = verify_publication()
    require(isinstance(proof, dict) and proof.get('status') == 'PASS' and proof.get('release_id') == p['candidate'],
            'TRANSITION_PUBLICATION_NOT_VERIFIED')
    validate_plan(p)
    proposed = p['previous_binding'] | dict(sql=p['proposed_sql'])
    for root in (control, writer): replace_binding(root/'binding.json', p['previous_binding'], proposed, p['run_id'])
    receipt = dict(status='PASS', kind='EXPLICIT_V4_V5_TRANSITION', plan_sha256=fingerprint(p),
                   previous_binding_sha256=fingerprint(p['previous_binding']), proposed_binding_sha256=fingerprint(proposed),
                   release_id=p['candidate'], proof=proof)
    exclusive_json(control/('transition-'+p['run_id']+'.json'), receipt)
    return receipt


def finish(p, journal, control, writer, *, verify_preconditions):
    require(journal.records[-1]['status'] == 'DONE' and journal.records[-1]['step'] == 'binding',
            'TRANSITION_NOT_COMPLETE')
    # Reopen from disk: an in-memory receipt alone cannot remove startup guards.
    Journal.open(journal.root, p)
    validate_plan(p)
    validate_step_proof(p, 'finish', verify_preconditions(p, 'finish'))
    validate_plan(p)
    proposed = p['previous_binding'] | dict(sql=p['proposed_sql'])
    marker = dict(run_id=p['run_id'], plan_sha256=fingerprint(p))
    receipt = json.loads(private_read(control/('transition-'+p['run_id']+'.json')))
    require(receipt.get('plan_sha256') == fingerprint(p) and receipt.get('release_id') == p['candidate']
            and receipt.get('status') == 'PASS', 'TRANSITION_RECEIPT_CHANGED')
    for root in (control, writer):
        require(json.loads(private_read(root/'binding.json')) == proposed
                and json.loads(private_read(root/PENDING)) == marker, 'TRANSITION_BINDING_CHANGED')
    for root in (control, writer):
        (root/PENDING).unlink()
        fd = os.open(root, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    return dict(status='PASS', release_id=p['candidate'], plan_sha256=fingerprint(p))


def inspect_target(p):
    import dev_runtime as dev
    require(dev.project() == p['target']['project'], 'TRANSITION_PROJECT_CHANGED')
    image = dev.metadata('image', 'postgis-pinned')
    require(image['RepoDigests'] == ['postgis/postgis@'+dev.DB_IMAGE]
            and image['Os'] == 'linux' and image['Architecture'] == 'amd64', 'LOCAL_IMAGE_REJECTED')
    actual = dev.check_database(dev.project(), dev.metadata('container', dev.project()+'-api-postgres-1'),
                                dev.metadata('network', dev.project()+'-data'), image['Id'])
    require(all(p['target'][k] == v for k,v in actual.items()), 'TRANSITION_TARGET_CHANGED')
    require(dev.volume_binding() == p['previous_binding']['volumes'] and dev.schemas() == p['proposed_sql'],
            'TRANSITION_BINDING_CHANGED')
    require(runtime_fingerprint() == p['source_sha256'], 'TRANSITION_SOURCE_CHANGED')
    require(json.loads(private_read(dev.CONTROL/'target.json')) == p['target'], 'TRANSITION_TARGET_CHANGED')


def observation(conn, p):
    verify_connection(conn, p['target'], 'ry_api_owner', True)
    require(conn.execute('SELECT count(*) FROM pg_prepared_xacts').fetchone() == (0,), 'PREPARED_TRANSACTION')
    require(conn.execute('SELECT count(*) FROM pg_subscription').fetchone() == (0,), 'SUBSCRIPTION_PRESENT')
    require(conn.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND usename IN ('ry_api_owner','api_writer')").fetchone() == (0,), 'TRANSITION_WRITER_ACTIVE')
    current = conn.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()[0]
    status = conn.execute('SELECT status FROM api_runtime.state WHERE singleton').fetchone()[0]
    history = conn.execute('SELECT installed_rank,version,script,checksum,success FROM flyway_schema_history ORDER BY installed_rank').fetchall()
    return current, status, history


def verify_history(history, sql_hashes, count):
    files = {}
    for name in sql_hashes:
        match = re.fullmatch(r'V([1-5])__.+\.sql', Path(name).name)
        if match: files[int(match[1])] = Path(name)
    require(set(files) == set(range(1, 6)), 'TRANSITION_MIGRATION_FILES')
    require(len(history) == count and all(list(row) == [n, str(n), files[n].name, flyway_checksum(files[n]), True]
            for n, row in enumerate(history, 1)), 'TRANSITION_HISTORY_CHANGED')


def bundle(p):
    from app.api_context_release import read_release_bundle
    path = Path(p['bundle'])
    require(hashlib.sha256((path/'bundle.json').read_bytes()).hexdigest() == p['bundle_sha256'], 'TRANSITION_INPUT_CHANGED')
    release = read_release_bundle(path)
    require(release['release_id'] == p['candidate'] and release['baseline']['release_id'] == p['expected_current'],
            'TRANSITION_BASELINE_CHANGED')
    require(release['quarters'] == [str(y)+str(q) for y in range(2021, 2027) for q in range(1, 5)
            if (y, q) <= (2026, 2)], 'TRANSITION_PERIODS_CHANGED')
    return release


def verify_input_fingerprints(p):
    """Fast byte verification of the previously fully replayed, pinned bundle.

    Recheck every normalized/raw/quality/quarantine/provenance file before each
    mutation. The stage itself also replays and revalidates the whole contract.
    """
    root = Path(p['bundle'])
    from app.api_history_quality import private_json
    require(hashlib.sha256((root/'bundle.json').read_bytes()).hexdigest() == p['bundle_sha256'], 'TRANSITION_INPUT_CHANGED')
    document = private_json(root/'bundle.json')
    require(document.get('schema_version') == 2 and document['release']['release_id'] == p['candidate'], 'TRANSITION_INPUT_CHANGED')
    for index, binding in enumerate(document['record_files']):
        require(binding['file'] == f'normalized/{index:06d}.jsonl', 'TRANSITION_INPUT_CHANGED')
        files = [(binding['file'], binding['sha256'])]
        files += [(f'evidence/{index:06d}/'+f['file'], f['sha256']) for f in binding['evidence_files']]
        for name, expected in files:
            relative = Path(name)
            require(not relative.is_absolute() and '..' not in relative.parts, 'TRANSITION_INPUT_PATH')
            path = root/relative
            require(not any(x.is_symlink() for x in [path, *path.parents]), 'PRIVATE_SYMLINK_REJECTED')
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda:stream.read(1024*1024), b''): digest.update(block)
            require(digest.hexdigest() == expected, 'TRANSITION_INPUT_CHANGED')


def step_precheck(p, step):
    """The actual-dev adapter must pass this function to every execute_step."""
    import dev_runtime as dev
    validate_plan(p); inspect_target(p); verify_input_fingerprints(p)
    marker = dict(run_id=p['run_id'], plan_sha256=fingerprint(p))
    expected_binding = p['previous_binding'] | dict(sql=p['proposed_sql']) if step == 'finish' else p['previous_binding']
    for root in (dev.CONTROL, dev.WRITER):
        require(json.loads(private_read(root/PENDING)) == marker
                and json.loads(private_read(root/'binding.json')) == expected_binding, 'TRANSITION_BINDING_CHANGED')
    with connect(dev.CONTROL, 'ry_api_owner', True)[0] as conn:
        with conn.transaction():
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            current, status, history = observation(conn, p)
            verify_history(history, p['proposed_sql'], 4 if step == 'migration' else 5)
    proof = dict(status='PASS', plan_sha256=fingerprint(p), target_sha256=fingerprint(p['target']),
                 source_sha256=runtime_fingerprint(), sql_sha256=fingerprint(dev.schemas()),
                 input_sha256=p['bundle_sha256'], previous_binding_sha256=fingerprint(p['previous_binding']),
                 current=current, job_status=status)
    validate_step_proof(p, step, proof)
    return proof


def precheck(p):
    import dev_runtime as dev
    validate_plan(p); inspect_target(p)
    with connect(dev.CONTROL, 'ry_api_owner', True)[0] as conn:
        with conn.transaction():
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            current, status, history = observation(conn, p)
            validate_observation(p, target=json.loads(private_read(dev.CONTROL/'target.json')),
                binding=json.loads(private_read(dev.CONTROL/'binding.json')), sql_hashes=dev.schemas(),
                current=current, status=status)
            verify_history(history, p['proposed_sql'], 4)
    return dict(status='PRECHECK_PASS', plan=fingerprint(p), expected_current=p['expected_current'])


def begin(p):
    import dev_runtime as dev
    precheck(p)
    require_clear(dev.CONTROL); require_clear(dev.WRITER)
    root = dev.CONTROL/'transitions'; root.mkdir(mode=0o700, exist_ok=True)
    journal = Journal.create(root/p['run_id'], p)
    marker = dict(run_id=p['run_id'], plan_sha256=fingerprint(p))
    # Both startup and the writer are blocked before any migration is allowed.
    exclusive_json(dev.CONTROL/PENDING, marker); exclusive_json(dev.WRITER/PENDING, marker)
    return dict(status='PREPARED', plan=fingerprint(p))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['precheck', 'begin'])
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--approve-existing-dev-transition', action='store_true')
    args = parser.parse_args()
    p = json.loads(private_read(args.plan))
    require(args.action == 'precheck' or args.approve_existing_dev_transition, 'EXPLICIT_TRANSITION_APPROVAL_REQUIRED')
    # Application steps are intentionally separate from backup/rehearsal preparation.
    value = precheck(p) if args.action == 'precheck' else begin(p)
    print(json.dumps(value), flush=True)


if __name__ == '__main__':
    os.umask(0o077)
    try: main()
    except Exception as error:
        print(json.dumps(dict(status='STOP', code=str(error) if isinstance(error, RuntimeErrorCode)
                              else 'TRANSITION_FAILED', type=type(error).__name__)), file=sys.stderr)
        sys.exit(2)
