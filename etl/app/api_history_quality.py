"""DB-free contract-2 history candidate with exact, explicitly approved exclusions.

Strict v1 normalization is unchanged. Quarantined runs deliberately remain
complete=False and cannot be loaded by the v1 publisher.
"""
from datetime import datetime, timezone
from decimal import Decimal
import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import stat
import sys
import time
from urllib.parse import quote

from .api_artifacts import create_file, encoded, manifest_write, EvidenceRecords
from .api_compare import file_sha
from .api_config import private_parent
from .api_http import HttpClient, unique_object
from .api_records import (CollectionError, SALES, SEOUL_INDUSTRIES, common, integer,
                          normalize_sales, number, quarter, required)
from .api_release import (TEXT_POLICY, digest, load_run, verify_record_layout,
                          verify_release)

POLICY = 'EXACT_APPROVED_UNMAPPED_SALES_NEGATIVE_COUNT_V1'
SERVICE = 'VwsmAdstrdSelngW'
STATUS = 'QUARANTINED_UNPUBLISHED'


def require(condition, code):
    if not condition:
        raise CollectionError(code)


def now():
    return datetime.now(timezone.utc).isoformat()


def case_key(case):
    return tuple(case[k] for k in ('quarter_code', 'dong_code', 'source_industry_code'))


def approved_cases(policy):
    require(isinstance(policy, dict) and policy.get('schema_version') == 1
            and policy.get('policy_id') == POLICY and isinstance(policy.get('cases'), list)
            and bool(policy['cases']), 'EXPLICIT_QUARANTINE_POLICY_REQUIRED')
    result = {}
    for case in policy['cases']:
        required(case, ('quarter_code', 'dong_code', 'source_industry_code', 'fields'))
        key = case_key(case)
        quarter(key[0])
        require(isinstance(key[1], str) and re.fullmatch(r'\d{8}', key[1])
                and isinstance(key[2], str) and re.fullmatch(r'CS\d{6}', key[2])
                and key[2] not in SEOUL_INDUSTRIES and key not in result,
                'UNSUPPORTED_EXACT_CASE_REQUIRED')
        fields = case['fields']
        require(isinstance(fields, dict) and bool(fields), 'EXACT_NEGATIVE_COUNT_REQUIRED')
        for field, value in fields.items():
            require(field in SALES and field.endswith('_SELNG_CO')
                    and isinstance(value, str) and re.fullmatch(r'-[1-9]\d*', value)
                    and int(value) >= -9223372036854775808, 'EXACT_NEGATIVE_COUNT_REQUIRED')
        result[key] = fields
    return result


def classify(row, period, cases):
    identity = common(row, period)
    required(row, SALES)
    try:
        return normalize_sales(row, period), None
    except CollectionError:
        # Validate every field. Only exact negative integer counts can be held;
        # malformed numbers, negative amounts or supported-industry errors fail.
        fields = {}
        for field in SALES:
            value = row[field]
            if value is None or value == '':
                continue
            n = number(value, nullable=False)
            if n < 0 and n == n.to_integral_value() and field.endswith('_SELNG_CO'):
                require(n >= -9223372036854775808, 'INVALID_INTEGER')
                fields[field] = str(int(n))
            else:
                integer(value)
        key = (period, identity['dong_code'], identity['source_industry_code'])
        require(identity['industry_code'] is None and bool(fields) and cases.get(key) == fields,
                'UNAPPROVED_SALES_QUALITY_ISSUE')
        return None, dict(quarter_code=key[0], dong_code=key[1], source_industry_code=key[2],
                         fields=fields, reason='NEGATIVE_COUNT_UNMAPPED_INDUSTRY')


def decode(raw):
    try:
        return json.loads(raw, parse_float=Decimal, object_pairs_hook=unique_object,
                          parse_constant=lambda _: (_ for _ in ()).throw(CollectionError('NONFINITE_JSON_NUMBER')))
    except (ValueError, UnicodeError) as error:
        if isinstance(error, CollectionError):
            raise
        raise CollectionError('INVALID_JSON_RESPONSE') from None


def page_rows(data, period, start, page_size, total):
    required(data, [SERVICE])
    envelope = data[SERVICE]
    required(envelope, ['RESULT', 'list_total_count', 'row'])
    require(isinstance(envelope['RESULT'], dict) and envelope['RESULT'].get('CODE') == 'INFO-000', 'SEOUL_API_ERROR')
    count = integer(envelope['list_total_count'])
    require(0 < count <= 10000000 and total in (None, count), 'SOURCE_TOTAL_CHANGED')
    require(1 <= start <= count, 'PAGE_SEQUENCE_MISMATCH')
    rows = envelope['row']
    require(isinstance(rows, list) and len(rows) == min(page_size, count - start + 1), 'PAGE_LENGTH_MISMATCH')
    return rows, count


def collect_sales(output, period, key, policy, *, client=None, allow_http=False, page_size=1000):
    quarter(period)
    cases = {k:v for k,v in approved_cases(policy).items() if k[0] == period}
    require(bool(cases) and bool(key) and key != 'sample' and type(page_size) is int
            and 1 <= page_size <= 1000, 'EXPLICIT_QUALITY_COLLECTION_REQUIRED')
    output = private_parent(output)
    try:
        output.mkdir(mode=0o700)
    except FileExistsError:
        raise CollectionError('OUTPUT_ALREADY_EXISTS') from None
    (output / 'pages').mkdir(mode=0o700)
    manifest = dict(schema_version=2, normalizer_version=3, source='seoul-sales', mode='collect',
        scope=dict(quarter=period, region='SEOUL', industry='ALL_SOURCE_INDUSTRIES', service=SERVICE,
                   transport='http-explicit-opt-in' if allow_http else 'https'),
        policy_id=POLICY, approval_sha256=digest(policy), started_at=now(), status='IN_PROGRESS',
        complete=False, raw_complete=False, published=False, declared_count=None, received_count=0,
        normalized_count=0, quarantined_count=0, unique_key_count=0, page_count=0, pages=[],
        source_periods=[period], page_size=page_size)
    manifest_write(output, manifest, first=True)
    client = client or HttpClient()
    seen, excluded = set(), set()
    normalized_hash, quarantine_hash = hashlib.sha256(), hashlib.sha256()
    try:
        with create_file(output / 'normalized.jsonl') as normal, create_file(output / 'quarantine.jsonl') as held:
            while manifest['declared_count'] is None or manifest['received_count'] < manifest['declared_count']:
                start = manifest['received_count'] + 1
                base = 'http://openapi.seoul.go.kr:8088' if allow_http else 'https://openapi.seoul.go.kr:8088'
                data, raw = client.get_json(f'{base}/{quote(key, safe="")}/json/{SERVICE}/{start}/{start+page_size-1}/{period}', secret=key)
                rows, total = page_rows(data, period, start, page_size, manifest['declared_count'])
                name = f'pages/{manifest["page_count"]+1:06d}.json'
                with create_file(output / name) as target:
                    target.write(raw)
                for offset, row in enumerate(rows):
                    record, issue = classify(row, period, cases)
                    natural = (period, row['ADSTRD_CD'], row['SVC_INDUTY_CD'])
                    require(natural not in seen, 'DUPLICATE_SOURCE_KEY')
                    seen.add(natural)
                    if issue is None:
                        line = encoded(record); normal.write(line); normalized_hash.update(line)
                        manifest['normalized_count'] += 1
                    else:
                        issue.update(page=name, row_index=offset+1)
                        line = encoded(issue); held.write(line); quarantine_hash.update(line)
                        excluded.add(natural); manifest['quarantined_count'] += 1
                manifest['pages'].append(dict(file=name, sha256=hashlib.sha256(raw).hexdigest(), received_count=len(rows)))
                manifest.update(declared_count=total, received_count=len(seen), unique_key_count=len(seen), page_count=len(manifest['pages']))
        require(excluded == set(cases), 'APPROVED_QUARANTINE_CASE_MISSING')
        manifest.update(status=STATUS, raw_complete=True, normalized_sha256=normalized_hash.hexdigest(),
                        quarantine_sha256=quarantine_hash.hexdigest(), finished_at=now())
    except BaseException as error:
        manifest.update(status='FAILED', error=str(error) if isinstance(error, CollectionError) else 'COLLECTION_INTERRUPTED', finished_at=now())
        manifest_write(output, manifest)
        raise
    manifest_write(output, manifest)
    return manifest


def load_quality_run(path, policy):
    path = Path(path)
    require(not path.is_symlink() and not (path/'manifest.json').is_symlink(), 'QUALITY_SYMLINK_REJECTED')
    m = decode((path / 'manifest.json').read_bytes())
    require(m.get('status') == STATUS and m.get('source') == 'seoul-sales' and m.get('mode') == 'collect'
            and m.get('normalizer_version') == 3 and m.get('schema_version') == 2
            and m.get('complete') is False and m.get('raw_complete') is True and m.get('published') is False
            and m.get('policy_id') == POLICY and m.get('approval_sha256') == digest(policy), 'INCOMPLETE_QUALITY_RUN')
    scope = m.get('scope', {}); period = quarter(scope.get('quarter'))
    require(scope.get('industry') == 'ALL_SOURCE_INDUSTRIES' and scope.get('region') == 'SEOUL'
            and scope.get('service') == SERVICE and m.get('source_periods') == [period], 'QUALITY_SCOPE_MISMATCH')
    cases = {k:v for k,v in approved_cases(policy).items() if k[0] == period}
    pages = m.get('pages', []); size = m.get('page_size')
    require(bool(pages) and type(size) is int and 1 <= size <= 1000 and m.get('page_count') == len(pages), 'QUALITY_PAGE_MISMATCH')
    records, issues, seen, total = [], [], set(), None
    for n, page in enumerate(pages, 1):
        name = f'pages/{n:06d}.json'
        require(page.get('file') == name and not (path/'pages').is_symlink() and not (path/name).is_symlink()
                and file_sha(path/name) == page.get('sha256'), 'RAW_SHA_MISMATCH')
        rows, total = page_rows(decode((path/name).read_bytes()), period, len(seen)+1, size, total)
        require(page.get('received_count') == len(rows), 'QUALITY_COUNT_MISMATCH')
        for offset, row in enumerate(rows):
            record, issue = classify(row, period, cases)
            natural = (period, row['ADSTRD_CD'], row['SVC_INDUTY_CD'])
            require(natural not in seen, 'DUPLICATE_SOURCE_KEY'); seen.add(natural)
            if issue is None:
                records.append(record)
            else:
                issue.update(page=name, row_index=offset+1); issues.append(issue)
    require({case_key(i) for i in issues} == set(cases) and bool(records), 'APPROVED_QUARANTINE_CASE_MISSING')
    for field, count in [('received_count',total), ('declared_count',total), ('unique_key_count',total),
                         ('normalized_count',len(records)), ('quarantined_count',len(issues))]:
        require(type(m.get(field)) is int and m[field] == count, 'QUALITY_COUNT_MISMATCH')
    require(len(seen) == total and len(records)+len(issues) == total, 'QUALITY_COUNT_MISMATCH')
    for name, values, key in [('normalized.jsonl',records,'normalized_sha256'), ('quarantine.jsonl',issues,'quarantine_sha256')]:
        target = path/name
        expected = hashlib.sha256(b''.join(encoded(r) for r in values)).hexdigest()
        require(not target.is_symlink() and file_sha(target) == m.get(key) == expected, 'QUALITY_REPLAY_MISMATCH')
    stamp = datetime.fromisoformat(m['finished_at'])
    require(stamp.tzinfo is not None, 'INVALID_COLLECTION_TIME')
    return dict(source='seoul-sales', period=period, scope=scope, normalizer_version=3,
        normalized_sha256=m['normalized_sha256'], pages=pages, collected_at=stamp.astimezone(timezone.utc).isoformat(), records=EvidenceRecords(records,path),
        quality=dict(policy_id=POLICY, approval_sha256=digest(policy), raw_complete=True,
            raw_count=total, normalized_count=len(records), quarantined_count=len(issues),
            quarantine_sha256=m['quarantine_sha256'], cases=issues))


def descriptor(run):
    return {k:v for k,v in run.items() if k != 'records'}


def prepare_history_candidate(paths, quality_paths, policy, *, quarters, baseline_paths):
    cases = approved_cases(policy)
    paths = [Path(p) for p in paths]; baseline_paths = [Path(p) for p in baseline_paths]
    require(bool(baseline_paths) and len(set(baseline_paths)) == len(baseline_paths)
            and set(baseline_paths) <= set(paths), 'HISTORY_BASELINE_REQUIRED')
    require(bool(quarters) and len(set(quarters)) == len(quarters) and len(quarters) <= 40, 'HISTORY_QUARTERS_REQUIRED')
    quarters = sorted(quarter(q) for q in quarters)
    indexes = [int(q[:4])*4+int(q[4])-1 for q in quarters]
    require(indexes == list(range(indexes[0], indexes[-1]+1)), 'HISTORY_PERIOD_GAP')
    before = {p:file_sha(p/'manifest.json') for p in paths}
    normal = [load_run(p) for p in paths]
    quality = [load_quality_run(p,policy) for p in quality_paths]
    require(bool(quality) and {case_key(c) for r in quality for c in r['quality']['cases']} == set(cases), 'QUALITY_CASE_COVERAGE_MISMATCH')
    runs = sorted([*normal,*quality], key=lambda r:(r['source'],r['period']))
    stores = [r for r in runs if r['source'] == 'semas-stores']
    require(len(stores) == 1, 'INCOMPLETE_RELEASE_SOURCES')
    layout = dict(contract_version=1, text_policy=TEXT_POLICY, quarters=quarters,
        store_reference_month=stores[0]['period'], store_scope=stores[0]['scope']['industry'],
        collected_at=max(r['collected_at'] for r in runs), runs=runs)
    # Share strict record checks without passing a v2 payload through the v1 gate.
    verify_record_layout(layout)
    base_runs = sorted([normal[paths.index(p)] for p in baseline_paths], key=lambda r:(r['source'],r['period']))
    base = {**layout, 'runs':base_runs, 'quarters':sorted({r['period'] for r in base_runs if r['source']=='seoul-stores'}),
            'collected_at':max(r['collected_at'] for r in base_runs)}
    verify_release(base | {'release_id':digest(base)})
    baseline = dict(release_id=digest(base), runs=[descriptor(r) for r in base_runs])
    require(all(file_sha(p/'manifest.json') == h for p,h in before.items()), 'HISTORY_BASELINE_CHANGED')
    candidate = {**layout, 'contract_version':2, 'baseline':baseline,
        'quality_policy':dict(policy_id=POLICY, approval=policy,
            quarantined_count=sum(r['quality']['quarantined_count'] for r in quality),
            source_meaning='UNVERIFIED_NEGATIVE_COUNT_EXCLUDED_NOT_CORRECTED'),
        'candidate_status':'PREPARED_UNPUBLISHED_REQUIRES_CONTRACT_2_INTEGRATION'}
    return candidate | {'release_id':digest(candidate)}


def write_candidate(path, candidate):
    """Exclusive output; stream serialization to avoid another large UTF-8 copy."""
    path = private_parent(path)
    with create_file(path) as target:
        for part in json.JSONEncoder(ensure_ascii=False,sort_keys=True,separators=(',',':')).iterencode(candidate):
            target.write(part.encode())
        target.write(b'\n')


def verify_history_candidate(candidate, *, baseline_archive=None):
    """Validate a read-back candidate, including exclusions and baseline binding."""
    content = {k:v for k,v in candidate.items() if k != 'release_id'}
    require(candidate.get('release_id') == digest(content), 'RELEASE_DIGEST_MISMATCH')
    require(candidate.get('contract_version') == 2
            and candidate.get('candidate_status') == 'PREPARED_UNPUBLISHED_REQUIRES_CONTRACT_2_INTEGRATION',
            'HISTORY_CONTRACT_MISMATCH')
    policy = candidate['quality_policy']
    require(policy.get('policy_id') == POLICY
            and policy.get('source_meaning') == 'UNVERIFIED_NEGATIVE_COUNT_EXCLUDED_NOT_CORRECTED', 'QUALITY_POLICY_MISMATCH')
    cases = approved_cases(policy['approval'])
    observed = set()
    for run in candidate['runs']:
        quality = run.get('quality')
        if quality is None:
            require(run.get('normalizer_version') in (1,2), 'QUALITY_POLICY_MISMATCH')
            continue
        require(run['source'] == 'seoul-sales' and run.get('normalizer_version') == 3
                and quality.get('policy_id') == POLICY and quality.get('raw_complete') is True
                and quality.get('approval_sha256') == digest(policy['approval']), 'QUALITY_POLICY_MISMATCH')
        issues = quality['cases']
        require(bool(issues) and quality.get('normalized_count') == len(run['records'])
                and quality.get('quarantined_count') == len(issues)
                and quality.get('raw_count') == len(run['records'])+len(issues)
                and sum(p['received_count'] for p in run['pages']) == quality['raw_count']
                and hashlib.sha256(b''.join(encoded(i) for i in issues)).hexdigest() == quality.get('quarantine_sha256'),
                'QUALITY_COUNT_MISMATCH')
        pages = {p['file']:p['received_count'] for p in run['pages']}
        kept = {(r['quarter_code'],r['dong_code'],r['source_industry_code']) for r in run['records']}
        for issue in issues:
            key = case_key(issue)
            require(key[0] == run['period'] and key not in observed and key not in kept
                    and cases.get(key) == issue.get('fields') and key[2] not in SEOUL_INDUSTRIES
                    and issue.get('reason') == 'NEGATIVE_COUNT_UNMAPPED_INDUSTRY'
                    and issue.get('page') in pages and type(issue.get('row_index')) is int
                    and 1 <= issue['row_index'] <= pages[issue['page']], 'QUALITY_CASE_MISMATCH')
            observed.add(key)
    require(observed == set(cases) and type(policy.get('quarantined_count')) is int
            and policy['quarantined_count'] == len(observed), 'QUALITY_CASE_COVERAGE_MISMATCH')
    layout = {k:candidate[k] for k in ('text_policy','quarters','store_reference_month','store_scope','collected_at','runs')}
    verify_record_layout(layout)
    quarters = candidate['quarters']
    indexes = [int(quarter(q)[:4])*4+int(q[4])-1 for q in quarters]
    require(indexes == list(range(indexes[0],indexes[-1]+1)), 'HISTORY_PERIOD_GAP')
    baseline = candidate['baseline']; base_runs = []
    # A final context refresh may retain the exact original baseline in its own
    # digest-bound archive while updating the latest source snapshot. The
    # history-only preparation path never supplies this explicit archive.
    available = {(r['source'],r['period']):r for r in (baseline_archive if baseline_archive is not None else candidate['runs'])}
    if baseline_archive is not None:
        require(len(available)==len(baseline_archive)==len(baseline['runs']), 'HISTORY_BASELINE_CHANGED')
    for entry in baseline['runs']:
        run = available.get((entry['source'],entry['period']))
        require(run is not None and 'quality' not in run and descriptor(run) == entry, 'HISTORY_BASELINE_CHANGED')
        base_runs.append(run)
    require(bool(base_runs), 'HISTORY_BASELINE_REQUIRED')
    base = {**layout, 'contract_version':1, 'runs':base_runs, 'quarters':sorted({r['period'] for r in base_runs if r['source']=='seoul-stores'}),
            'collected_at':max(r['collected_at'] for r in base_runs)}
    if baseline_archive is not None:
        snapshots=[r for r in base_runs if r['source']=='semas-stores']
        require(len(snapshots)==1, 'HISTORY_BASELINE_CHANGED')
        base.update(store_reference_month=snapshots[0]['period'],store_scope=snapshots[0]['scope']['industry'])
    require(digest(base) == baseline['release_id'], 'HISTORY_BASELINE_CHANGED')
    verify_release(base | {'release_id':baseline['release_id']})
    return candidate


def private_json(path):
    path = private_parent(Path(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077,
                'PRIVATE_INPUT_0600_REQUIRED')
        raw = stream.read(2*1024*1024+1)
    require(len(raw) <= 2*1024*1024, 'PRIVATE_INPUT_TOO_LARGE')
    return decode(raw)


def main(argv=None):
    parser = argparse.ArgumentParser(description='승인된 정확한 미지원업종 행 격리·계약2 후보 준비. DB 접속 없음.')
    sub = parser.add_subparsers(dest='action', required=True)
    collect = sub.add_parser('collect-sales')
    collect.add_argument('--env-file', required=True, type=Path)
    collect.add_argument('--quarter', required=True)
    collect.add_argument('--allow-seoul-http', action='store_true')
    prepare = sub.add_parser('prepare')
    prepare.add_argument('--input-plan', required=True, type=Path)
    for command in (collect, prepare):
        command.add_argument('--policy-file', required=True, type=Path)
        command.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    started = time.monotonic()
    try:
        policy = private_json(args.policy_file)
        approved_cases(policy)
        if args.action == 'collect-sales':
            from .api_config import load_keys
            keys = load_keys(args.env_file)
            manifest = collect_sales(args.output, args.quarter, keys['SEOUL_OPENAPI_KEY'], policy,
                                     allow_http=args.allow_seoul_http)
            result = {k:manifest[k] for k in ('status','raw_complete','complete','published',
                                             'received_count','normalized_count','quarantined_count')}
        else:
            plan = private_json(args.input_plan)
            required(plan, ['runs','quality_runs','baseline_runs','quarters'])
            output = private_parent(args.output)
            try:
                output.mkdir(mode=0o700)
            except FileExistsError:
                raise CollectionError('OUTPUT_ALREADY_EXISTS') from None
            candidate = prepare_history_candidate(plan['runs'], plan['quality_runs'], policy,
                quarters=plan['quarters'], baseline_paths=plan['baseline_runs'])
            write_candidate(output/'candidate.json', candidate)
            result = dict(status=candidate['candidate_status'], published=False,
                current_publication_checked=False, requires_contract_2_integration=True,
                release_id=candidate['release_id'], baseline_release_id=candidate['baseline']['release_id'],
                quarters=candidate['quarters'], runs=len(candidate['runs']),
                normalized_rows=sum(len(r['records']) for r in candidate['runs']),
                quarantined_rows=candidate['quality_policy']['quarantined_count'],
                candidate_file_sha256=file_sha(output/'candidate.json'))
            # Release the materialized source records before reading the saved
            # file back, so serialization verification does not double the set.
            del candidate
            gc.collect()
            with (output/'candidate.json').open() as source:
                saved = json.load(source, object_pairs_hook=unique_object)
            verify_history_candidate(saved)
            require(saved['release_id'] == result['release_id'], 'RELEASE_DIGEST_MISMATCH')
            del saved
            result['readback_verified'] = True
            result.update(seconds=round(time.monotonic()-started,1),
                peak_rss_mib=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024*1024 if sys.platform=='darwin' else 1024),1))
            with create_file(output/'preparation.json') as target:
                target.write(encoded(result))
        print(json.dumps(result))
        return 0
    except CollectionError as error:
        print('ERROR: '+str(error), file=sys.stderr)
    except KeyboardInterrupt:
        print('ERROR: HISTORY_PREPARATION_INTERRUPTED', file=sys.stderr)
        return 130
    except Exception:
        print('ERROR: HISTORY_PREPARATION_FAILED', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
