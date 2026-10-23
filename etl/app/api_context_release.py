"""Final contract 2: exact history exclusions and immutable context policy.

Preparation is DB-free. A history candidate alone never authorizes publication.
Raw observations and excluded fields are retained privately; public projection is
an explicit allowlist, with no inferred observation date or score readiness.
"""
from datetime import datetime, timezone
from decimal import Decimal
import argparse
import hashlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

from .api_artifacts import create_file, encoded, EvidenceRecords
from .api_config import private_parent
from .api_compare import file_sha
from .api_history_quality import (POLICY, approved_cases, decode, descriptor, load_quality_run,
                                 private_json, require, verify_history_candidate)
from .api_records import CollectionError, quarter
from .api_release import TEXT_POLICY, digest, load_run
from .seoul_context import SOURCES, QualityReport, normalize

ACTIVE_SOURCES = ('seoul-population', 'seoul-residents', 'seoul-workers',
                  'seoul-facilities', 'seoul-change')
FINAL_KIND = 'HISTORY_WITH_REFERENCE_CONTEXT_V1'
HISTORY_STATUS = 'PREPARED_UNPUBLISHED_REQUIRES_CONTRACT_2_INTEGRATION'


def policy_document():
    sections = {}
    reasons = {
        'population':['OBSERVATION_DATE_UNKNOWN', 'AGGREGATION_UNVERIFIED'],
        'residents':['OBSERVATION_DATE_UNKNOWN', 'ANNUAL_REPEAT'],
        'workers':['OBSERVATION_DATE_UNKNOWN', 'ANNUAL_REPEAT', 'COVERAGE_GAP'],
        'facilities':['OBSERVATION_DATE_UNKNOWN', 'ANNUAL_REPEAT', 'TOTAL_DEFINITION_UNVERIFIED'],
        'change':['OBSERVATION_DATE_UNKNOWN'],
        'consumption':['SOURCE_CONFLICT', 'QUALITY_WITHHELD'],
    }
    for key in (*[s.removeprefix('seoul-') for s in ACTIVE_SOURCES], 'consumption'):
        source = 'seoul-'+key; spec = SOURCES[source]
        fields = [f for f in spec.numeric_fields
                  if f not in ('APT_HSHLD_CO', 'NON_APT_HSHLD_CO', 'VIATR_FCLTY_CO')]
        sections[key] = dict(source_id=source, dataset_id=spec.dataset,
            source_url='https://data.seoul.go.kr/dataList/'+spec.dataset+'/S/1/datasetView.do',
            state='WITHHELD' if key=='consumption' else 'REFERENCE',
            fields=[] if key=='consumption' else fields,
            attributes=list(spec.text_fields), reason_codes=reasons[key],
            refresh_model='SOURCE_REPORTED_ANNUAL' if spec.annual else 'SOURCE_REPORTED_QUARTERLY',
            temporal_aggregation='UNKNOWN' if key=='population' else 'SOURCE_REPORTED',
            spatial_compatibility='HISTORICAL_UNVERIFIED', score_ready=False)
    return dict(policy_id='SEOUL_CONTEXT_REFERENCE_V1', schema_version=1,
                spatial_unit='ADMINISTRATIVE_DONG', sections=sections)


def policy_version():
    return digest(policy_document())


class RecordFile(list):
    """Re-iterable, hash-checked JSONL list for bounded-memory release handling.

    Only Python JSONEncoder.iterencode is used for release serialization. Each
    complete iteration verifies count/hash again, including during COPY/digest.
    """
    def __init__(self, path, count, sha256, source_path=None):
        super().__init__()
        self.path, self.count, self.sha256 = Path(path), count, sha256
        self.source_path = source_path

    def __len__(self):
        return self.count

    def __iter__(self):
        require(not self.path.is_symlink(), 'NORMALIZED_SYMLINK_REJECTED')
        h = hashlib.sha256(); count = 0
        with self.path.open('rb') as stream:
            for line in stream:
                h.update(line); count += 1
                row = decode(line)
                require(encoded(row) == line, 'NONCANONICAL_RECORD_FILE')
                yield row
        require(count == self.count and h.hexdigest() == self.sha256, 'NORMALIZED_SHA_MISMATCH')

    def __getitem__(self, index):
        if index != 0 or self.count < 1:
            raise IndexError('RecordFile supports first-row lookup only')
        return next(iter(self))

    def canonical_json_items(self):
        require(not self.path.is_symlink(), 'NORMALIZED_SYMLINK_REJECTED')
        count=0; h=hashlib.sha256()
        with self.path.open('rb') as stream:
            for line in stream:
                require(encoded(decode(line))==line, 'NONCANONICAL_RECORD_FILE')
                h.update(line); count+=1
                yield (line[:-1],)
        require(count==self.count and h.hexdigest()==self.sha256, 'NORMALIZED_SHA_MISMATCH')


def _subset_equal(original, current):
    if isinstance(original, dict):
        return isinstance(current, dict) and all(k in current and _subset_equal(v, current[k])
                                                 for k,v in original.items())
    return original == current


def canonical_context_record(source, row):
    spec = SOURCES[source]
    require(isinstance(row,dict) and isinstance(row.get('metrics'),dict) and isinstance(row.get('attributes'),dict)
            and set(row) == {'quarter_code','dong_code','dong_name','metrics','attributes'}
            and set(row['metrics']) == set(spec.numeric_fields)
            and set(row['attributes']) == set(spec.text_fields), 'CONTEXT_RECORD_SCHEMA_MISMATCH')
    raw = dict(STDR_YYQU_CD=row['quarter_code'], ADSTRD_CD=row['dong_code'], ADSTRD_CD_NM=row['dong_name'],
               **row['metrics'], **row['attributes'])
    require(normalize(source, raw) == row, 'NONCANONICAL_CONTEXT_RECORD')
    if source == 'seoul-change':
        names = {'LL':'다이나믹', 'LH':'상권확장', 'HL':'상권축소', 'HH':'정체'}
        require(row['attributes'].get('TRDAR_CHNGE_IX') in names
                and names[row['attributes']['TRDAR_CHNGE_IX']] == row['attributes'].get('TRDAR_CHNGE_IX_NM'),
                'CONTEXT_CHANGE_CODE_REQUIRES_REVIEW')
    return row


def load_context_run(path):
    path = Path(path)
    # macOS's standard TemporaryDirectory parent includes the system /var alias.
    # Reject supplied run/file links; resolve the platform-owned parent alias.
    require(not path.is_symlink(), 'CONTEXT_SYMLINK_REJECTED')
    path = path.parent.resolve()/path.name
    require(not (path/'manifest.json').is_symlink(), 'CONTEXT_SYMLINK_REJECTED')
    m = decode((path/'manifest.json').read_bytes()); source = m.get('source')
    require(source in ACTIVE_SOURCES and m.get('schema_version') == 1
            and m.get('normalizer_version') == 1 and m.get('mode') == 'collect'
            and m.get('status') == 'COLLECTED_UNPUBLISHED' and m.get('complete') is True
            and m.get('raw_complete', True) is True and m.get('published') is False
            and m.get('quarantined_count', 0) == 0, 'INCOMPLETE_CONTEXT_RUN')
    spec = SOURCES[source]; scope = m.get('scope', {})
    require(scope.get('region') == 'SEOUL' and scope.get('service') == spec.service
            and scope.get('dataset') == spec.dataset and scope.get('period_scope') == 'ALL_SOURCE_PERIODS'
            and scope.get('spatial_unit') == 'ADMINISTRATIVE_DONG'
            and scope.get('observation_date') is None, 'CONTEXT_SCOPE_MISMATCH')
    pages = m.get('pages', []); records = []; seen = set(); report = QualityReport(source)
    require(bool(pages) and m.get('page_count') == len(pages), 'CONTEXT_PAGE_MISMATCH')
    for n, page in enumerate(pages, 1):
        name = f'pages/{n:06d}.json'; raw_path = path/name
        require(page.get('file') == name and not (path/'pages').is_symlink()
                and not raw_path.is_symlink() and file_sha(raw_path) == page.get('sha256'), 'RAW_SHA_MISMATCH')
        envelope = decode(raw_path.read_bytes()).get(spec.service, {})
        require(envelope.get('RESULT', {}).get('CODE') == 'INFO-000'
                and envelope.get('list_total_count') == m['declared_count']
                and isinstance(envelope.get('row'), list)
                and len(envelope['row']) == page.get('received_count') and bool(envelope['row']), 'CONTEXT_PAGE_MISMATCH')
        for raw in envelope['row']:
            row = canonical_context_record(source, normalize(source, raw))
            key = row['quarter_code'], row['dong_code']
            require(key not in seen, 'DUPLICATE_CONTEXT_KEY'); seen.add(key)
            records.append(row); report.observe(row)
    count = len(records)
    require(count > 0 and all(type(m.get(k)) is int and m[k] == count
        for k in ('received_count', 'declared_count', 'unique_key_count'))
        and m.get('normalized_count', count) == count, 'CONTEXT_COUNT_MISMATCH')
    require(sorted({r['quarter_code'] for r in records}) == m.get('source_periods'), 'CONTEXT_PERIOD_MISMATCH')
    normal = path/'normalized.jsonl'
    require(not normal.is_symlink() and file_sha(normal) == m.get('normalized_sha256')
            == hashlib.sha256(b''.join(encoded(r) for r in records)).hexdigest(), 'NORMALIZED_SHA_MISMATCH')
    quality = report.finish(complete=True, raw_complete=True); quality_path = path/'quality.json'
    require(m.get('quality_report', {}).get('file') == 'quality.json' and not quality_path.is_symlink()
            and file_sha(quality_path) == m['quality_report']['sha256'], 'CONTEXT_QUALITY_SHA_MISMATCH')
    original = decode(quality_path.read_bytes())
    # Older clean collections lack later diagnostic fields. Replay all original
    # substantive fields; warnings are retained by their original file hash.
    require(_subset_equal({k:v for k,v in original.items() if k != 'warnings'}, quality)
            and quality['name_conflict_count'] == 0, 'CONTEXT_QUALITY_REPLAY_MISMATCH')
    stamp = datetime.fromisoformat(m['finished_at'])
    require(stamp.tzinfo is not None, 'INVALID_COLLECTION_TIME')
    run = dict(source=source, scope=scope, normalizer_version=1, pages=pages,
        normalized_sha256=m['normalized_sha256'], quality_report_sha256=m['quality_report']['sha256'],
        quality=quality, collected_at=stamp.astimezone(timezone.utc).isoformat(), observed_at=None,
        quarters=m['source_periods'], row_count=count)
    return run | dict(run_id=digest(run), records=EvidenceRecords(records,path))


def prepare_context_release(history, context_paths):
    verify_history_candidate(history)
    runs = [load_context_run(p) for p in context_paths]
    return _assemble_context_release(history,runs)


def _assemble_context_release(history, runs, *, baseline_archive=None, refresh_parent=None):
    require(len(runs) == len(ACTIVE_SOURCES) and {r['source'] for r in runs} == set(ACTIVE_SOURCES),
            'CONTEXT_REQUIRED_SOURCES_MISMATCH')
    sources = {r['source'].removeprefix('seoul-'):dict(state='REFERENCE', run=r) for r in runs}
    sources['consumption'] = dict(state='WITHHELD', run=None)
    release = {k:v for k,v in history.items() if k not in ('release_id','candidate_status')}
    release.update(release_kind=FINAL_KIND, history_candidate_id=history['release_id'],
        history_collected_at=history['collected_at'], context_policy=policy_document(),
        context_policy_version=policy_version(), context_sources=sources,
        collected_at=max([history['collected_at'], *[r['collected_at'] for r in runs]]))
    if baseline_archive is not None:
        release.update(baseline_archive=baseline_archive,refresh_parent=refresh_parent)
    release['release_id'] = digest(release)
    verify_context_release(release)
    return release


def verify_context_release(release):
    require(release.get('contract_version') == 2 and release.get('release_kind') == FINAL_KIND
            and 'candidate_status' not in release, 'FINAL_CONTEXT_CONTRACT_REQUIRED')
    require(release.get('release_id') == digest({k:v for k,v in release.items() if k!='release_id'}),
            'RELEASE_DIGEST_MISMATCH')
    require(release.get('context_policy') == policy_document()
            and release.get('context_policy_version') == policy_version(), 'CONTEXT_POLICY_MISMATCH')
    extras = {'release_kind','history_candidate_id','history_collected_at','baseline_archive','refresh_parent',
              'context_policy','context_policy_version','context_sources'}
    history = {k:v for k,v in release.items() if k not in extras}
    history.update(candidate_status=HISTORY_STATUS, release_id=release['history_candidate_id'],
                   collected_at=release['history_collected_at'])
    archive=release.get('baseline_archive')
    require((archive is None and 'refresh_parent' not in release)
            or (isinstance(archive,list) and bool(archive) and isinstance(release.get('refresh_parent'),str)
                and re.fullmatch('[0-9a-f]{64}',release['refresh_parent'])), 'CONTEXT_REFRESH_LINEAGE_MISMATCH')
    verify_history_candidate(history,baseline_archive=archive)
    sources = release['context_sources']
    require(set(sources) == set(policy_document()['sections']), 'CONTEXT_REQUIRED_SOURCES_MISMATCH')
    stamps = [history['collected_at']]
    for key, entry in sources.items():
        require(set(entry) == {'state','run'}, 'CONTEXT_SOURCE_SCHEMA_MISMATCH')
        if key == 'consumption':
            require(entry == dict(state='WITHHELD', run=None), 'WITHHELD_CONTEXT_RUN_FORBIDDEN')
            continue
        run = entry['run']; source = 'seoul-'+key
        spec=SOURCES[source]; scope=run.get('scope',{})
        require(scope.get('region')=='SEOUL' and scope.get('service')==spec.service
                and scope.get('dataset')==spec.dataset and scope.get('period_scope')=='ALL_SOURCE_PERIODS'
                and scope.get('spatial_unit')=='ADMINISTRATIVE_DONG' and scope.get('observation_date') is None
                and scope.get('annual_repeated_values') is spec.annual, 'CONTEXT_SCOPE_MISMATCH')
        require(all(isinstance(run.get(f),str) and re.fullmatch('[0-9a-f]{64}',run[f])
                    for f in ('run_id','normalized_sha256','quality_report_sha256'))
                and isinstance(run.get('pages'),list) and bool(run['pages'])
                and all(p.get('file')==f'pages/{n:06d}.json' and isinstance(p.get('sha256'),str)
                    and re.fullmatch('[0-9a-f]{64}',p['sha256']) and type(p.get('received_count')) is int
                    and p['received_count']>0 for n,p in enumerate(run['pages'],1)), 'CONTEXT_RUN_DESCRIPTOR_MISMATCH')
        require(entry['state'] == 'REFERENCE' and run['source'] == source
                and run['normalizer_version'] == 1 and run['observed_at'] is None
                and run['run_id'] == digest({k:v for k,v in run.items() if k not in ('run_id','records')}),
                'CONTEXT_RUN_DESCRIPTOR_MISMATCH')
        report = QualityReport(source); seen = set(); h = hashlib.sha256()
        for row in run['records']:
            canonical_context_record(source, row)
            natural = row['quarter_code'], row['dong_code']
            require(natural not in seen, 'DUPLICATE_CONTEXT_KEY'); seen.add(natural)
            h.update(encoded(row)); report.observe(row)
        quality = report.finish(complete=True, raw_complete=True)
        require(bool(seen) and len(seen) == run['row_count'] == len(run['records'])
                and sum(p['received_count'] for p in run['pages']) == len(seen)
                and quality == run['quality'] and quality['name_conflict_count'] == 0
                and run['quarters'] == quality['source_periods']
                and h.hexdigest() == run['normalized_sha256'], 'CONTEXT_RUN_CONTENT_MISMATCH')
        stamp = datetime.fromisoformat(run['collected_at'])
        require(stamp.tzinfo is not None, 'INVALID_COLLECTION_TIME'); stamps.append(run['collected_at'])
    require(release['collected_at'] == max(stamps), 'CONTEXT_COLLECTION_TIME_MISMATCH')
    return release


def project_sections(release, dong_code, period):
    """Reference projection used by cross-language fixtures and isolated audits."""
    quarter(period); sections = {}
    for key, spec in policy_document()['sections'].items():
        entry = release['context_sources'][key]; run = entry['run']; row = None
        state = entry['state']
        if run:
            matches = [r for r in run['records'] if r['quarter_code']==period and r['dong_code']==dong_code]
            require(len(matches) <= 1, 'DUPLICATE_CONTEXT_KEY')
            row = matches[0] if matches else None
            state = 'REFERENCE' if row else ('NO_ROW' if period in run['quarters'] else 'NO_PERIOD')
        metrics = None
        if row:
            metrics = {f:dict(value=row['metrics'][f], valueState='SOURCE_NULL' if row['metrics'][f] is None else 'REPORTED',
                unit='HOUSEHOLD' if f=='TOT_HSHLD_CO' else ('FACILITY' if key=='facilities' else ('MONTH' if key=='change' else 'PERSON')),
                temporalAggregation=spec['temporal_aggregation']) for f in spec['fields']}
        sections[key] = dict(state=state, reasonCodes=spec['reason_codes'], metrics=metrics,
            attributes={f:row['attributes'][f] for f in spec['attributes']} if row else None,
            provenance=dict(sourceId=spec['source_id'], datasetId=spec['dataset_id'], sourceUrl=spec['source_url'],
                runId=run['run_id'] if run else None, sourceQuarter=period if row else None, observedAt=None,
                collectedAt=run['collected_at'] if run else None, refreshModel=spec['refresh_model']),
            spatialCompatibility='HISTORICAL_UNVERIFIED', scoreReady=False)
    return sections


def release_metadata(release):
    result = {k:v for k,v in release.items() if k not in ('runs','context_sources','baseline_archive')}
    if 'baseline_archive' in release:
        result['baseline_archive']=[descriptor(r)|dict(row_count=len(r['records'])) for r in release['baseline_archive']]
    result['runs'] = [descriptor(r) | dict(row_count=len(r['records'])) for r in release['runs']]
    result['context_sources'] = {key:dict(state=e['state'], run=descriptor(e['run']) if e['run'] else None)
                                 for key,e in release['context_sources'].items()}
    return result


def compare_staged_statistics(cur, release):
    """Compare every typed field/geometry before READY; bounded by a single run."""
    from .api_release import TABLES
    count = 0
    for run in release['runs']:
        store = run['source'] == 'semas-stores'
        fields = [k for k in run['records'][0] if k not in ('industry_code','source_reference_month','location')]
        expression = ','.join(fields) + (',ST_X(location),ST_Y(location)' if store else '')
        params = [release['release_id']]
        where = 'release_id=%s'
        if not store:
            where += ' AND quarter_code=%s'; params.append(int(run['period']))
        cur.execute('SELECT '+expression+' FROM '+TABLES[run['source']]+' WHERE '+where, params)
        types = [d.type_code for d in cur.description]; actual = cur.fetchall()
        expected = []
        for row in run['records']:
            values = []
            for field, oid in zip(fields, types):
                value = row[field]
                values.append(None if value is None else int(value) if oid in (20,21,23)
                    else Decimal(value) if oid==1700 else float(value) if oid==701 else value)
            if store:
                values += [float(row['longitude']) if row['location'] else None,
                           float(row['latitude']) if row['location'] else None]
            expected.append(tuple(values))
        indices = [fields.index('source_store_id')] if store else [fields.index(k) for k in
            ('quarter_code','dong_code','source_industry_code')]
        key = lambda row:tuple(row[i] for i in indices)
        require(sorted(actual, key=key) == sorted(expected, key=key), 'STAGED_TYPED_VALUE_MISMATCH')
        count += len(actual)
    return count


def _stage_context(cur, release):
    from psycopg.types.json import Jsonb
    if 'refresh_parent' in release:
        cur.execute("SELECT metadata FROM api_releases WHERE release_id=%s AND status='READY' FOR SHARE",(release['refresh_parent'],))
        parent=cur.fetchone()
        require(parent is not None and parent[0].get('baseline')==release['baseline']
                and parent[0].get('context_policy_version')==release['context_policy_version']
                and parent[0].get('quality_policy',{}).get('approval')==release['quality_policy']['approval'],
                'CONTEXT_REFRESH_LINEAGE_MISMATCH')
    # The approval is checked against the actual target's mapping as well as the
    # source normalizer. A newly supported source industry cannot stay excluded.
    for case in release['quality_policy']['approval']['cases']:
        cur.execute("SELECT 1 FROM industry_mappings WHERE source='SEOUL' AND source_code=%s",
                    (case['source_industry_code'],))
        require(cur.fetchone() is None, 'SUPPORTED_INDUSTRY_QUARANTINE_FORBIDDEN')
    for key, entry in sorted(release['context_sources'].items()):
        run = entry['run']; run_id = run['run_id'] if run else None
        if run:
            metadata = descriptor(run)
            cur.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (run_id,))
            cur.execute('SELECT descriptor FROM api_context_runs WHERE run_id=%s', (run_id,))
            existing = cur.fetchone()
            if existing:
                require(existing == (metadata,), 'EXISTING_CONTEXT_RUN_CONFLICT')
            else:
                cur.execute('INSERT INTO api_context_runs(run_id,source_id,descriptor) VALUES (%s,%s,%s)',
                            (run_id,run['source'],Jsonb(metadata)))
                with cur.copy('COPY api_context_rows(run_id,quarter_code,dong_code,dong_name,metrics,attributes) FROM STDIN') as copy:
                    for row in run['records']:
                        copy.write_row((run_id,row['quarter_code'],row['dong_code'],row['dong_name'],
                                        Jsonb(row['metrics']),Jsonb(row['attributes'])))
            cur.execute('SELECT quarter_code,dong_code,dong_name,metrics,attributes FROM api_context_rows WHERE run_id=%s', (run_id,))
            actual = cur.fetchall()
            expected = [(r['quarter_code'],r['dong_code'],r['dong_name'],r['metrics'],r['attributes']) for r in run['records']]
            require(sorted(actual,key=lambda r:r[:2]) == sorted(expected,key=lambda r:r[:2]), 'STAGED_CONTEXT_TYPED_VALUE_MISMATCH')
        cur.execute('INSERT INTO api_release_context_sources(release_id,source_id,state,run_id,policy_version) VALUES (%s,%s,%s,%s,%s)',
                    (release['release_id'],'seoul-'+key,entry['state'],run_id,release['context_policy_version']))
    compare_staged_statistics(cur, release)


def stage_context_release(conn, release, *, verify_identity):
    """Explicit v2 gate; never route a history-only candidate through v1 staging."""
    from .api_release import _stage_verified_release
    verify_context_release(release)
    return _stage_verified_release(conn, release, verify_identity=verify_identity,
        metadata=release_metadata(release), before_seal=_stage_context)


def prepare_streamed_history(plan, policy, *, expected_id):
    """Replay existing runs one at a time; bind to the already audited candidate."""
    require(isinstance(expected_id,str) and re.fullmatch('[0-9a-f]{64}',expected_id), 'HISTORY_CANDIDATE_ID_REQUIRED')
    approved_cases(policy)
    runs = []; by_path = {}
    paths = [Path(p) for p in plan['runs']]; quality_paths = [Path(p) for p in plan['quality_runs']]
    require(len(set(paths+quality_paths)) == len(paths+quality_paths), 'DUPLICATE_RELEASE_SCOPE')
    for path, quality in [(p,False) for p in paths]+[(p,True) for p in quality_paths]:
        run = load_quality_run(path,policy) if quality else load_run(path)
        count = len(run['records'])
        run['records'] = RecordFile(path/'normalized.jsonl',count,run['normalized_sha256'],path)
        runs.append(run); by_path[path] = run
    runs.sort(key=lambda r:(r['source'],r['period']))
    base_paths = [Path(p) for p in plan['baseline_runs']]
    require(bool(base_paths) and len(set(base_paths)) == len(base_paths) and set(base_paths)<=set(paths), 'HISTORY_BASELINE_REQUIRED')
    baseline_runs = sorted([by_path[p] for p in base_paths],key=lambda r:(r['source'],r['period']))
    stores = [r for r in runs if r['source']=='semas-stores']
    require(len(stores)==1, 'INCOMPLETE_RELEASE_SOURCES')
    base = dict(contract_version=1,text_policy=TEXT_POLICY,
        quarters=sorted({r['period'] for r in baseline_runs if r['source']=='seoul-stores'}),
        store_reference_month=stores[0]['period'],store_scope=stores[0]['scope']['industry'],
        collected_at=max(r['collected_at'] for r in baseline_runs),runs=baseline_runs)
    result = {**base,'contract_version':2,'runs':runs,'quarters':plan['quarters'],
        'collected_at':max(r['collected_at'] for r in runs),
        'baseline':dict(release_id=digest(base),runs=[descriptor(r) for r in baseline_runs]),
        'quality_policy':dict(policy_id=POLICY,approval=policy,
            quarantined_count=sum(r['quality']['quarantined_count'] for r in runs if 'quality' in r),
            source_meaning='UNVERIFIED_NEGATIVE_COUNT_EXCLUDED_NOT_CORRECTED'),
        'candidate_status':HISTORY_STATUS}
    result['release_id'] = digest(result)
    require(result['release_id']==expected_id, 'AUDITED_HISTORY_CANDIDATE_CHANGED')
    verify_history_candidate(result)
    return result


def _evidence_names(run):
    names=['run/manifest.json','run/normalized.jsonl']+['run/'+p['file'] for p in run['pages']]
    if run['source'] in ACTIVE_SOURCES: names.append('run/quality.json')
    elif 'quality' in run: names.append('run/quarantine.jsonl')
    original=run['scope'].get('replay_of')
    if original:
        require(isinstance(original,str) and re.fullmatch('[A-Za-z0-9_-]+',original)
                and original!='run','INVALID_REPLAY_PROVENANCE')
        names.append(original+'/manifest.json')
    return names


def _evidence_file(root, name):
    target=root/name
    require(not any(p.is_symlink() for p in [target,*target.parents]),'CONTEXT_SYMLINK_REJECTED')
    return target


def _verify_evidence(root, run, bindings, approval):
    names=_evidence_names(run)
    require(isinstance(bindings,list) and [b.get('file') for b in bindings]==names,'BUNDLE_EVIDENCE_BINDING_MISMATCH')
    for binding in bindings:
        require(set(binding)=={'file','sha256'} and isinstance(binding['sha256'],str)
                and re.fullmatch('[0-9a-f]{64}',binding['sha256'])
                and file_sha(_evidence_file(root,binding['file']))==binding['sha256'],'BUNDLE_EVIDENCE_SHA_MISMATCH')
    source=root/'run'
    actual=(load_context_run(source) if run['source'] in ACTIVE_SOURCES else
            load_quality_run(source,approval) if 'quality' in run else load_run(source))
    require(descriptor(actual)==descriptor(run),'BUNDLE_EVIDENCE_DESCRIPTOR_MISMATCH')
    return source


def write_release_bundle(output, release):
    """Create a private, self-contained JSONL bundle; never mutate source runs."""
    verify_context_release(release)
    output = private_parent(output)
    output = output.parent.resolve()/output.name
    try: output.mkdir(mode=0o700)
    except FileExistsError: raise CollectionError('OUTPUT_ALREADY_EXISTS') from None
    (output/'normalized').mkdir(mode=0o700)
    (output/'evidence').mkdir(mode=0o700)
    compact = {k:v for k,v in release.items() if k not in ('runs','context_sources','baseline_archive')}
    compact['runs'] = [descriptor(r) for r in release['runs']]
    compact['context_sources'] = {k:dict(state=e['state'],run=descriptor(e['run']) if e['run'] else None)
                                  for k,e in release['context_sources'].items()}
    if 'baseline_archive' in release:
        compact['baseline_archive']=[descriptor(r) for r in release['baseline_archive']]
    bindings = []
    for index, (kind, selector, run) in enumerate(
            [('runs',n,r) for n,r in enumerate(release['runs'])]+
            [('baseline_archive',n,r) for n,r in enumerate(release.get('baseline_archive',[]))]+
            [('context_sources',k,e['run']) for k,e in sorted(release['context_sources'].items()) if e['run']]):
        name = f'normalized/{index:06d}.jsonl'; h = hashlib.sha256()
        with create_file(output/name) as target:
            for row in run['records']:
                line = encoded(row); target.write(line); h.update(line)
        require(h.hexdigest()==run['normalized_sha256'], 'NORMALIZED_SHA_MISMATCH')
        source=getattr(run['records'],'source_path',None)
        require(source is not None,'BUNDLE_SOURCE_EVIDENCE_REQUIRED')
        source=Path(source).resolve()
        evidence=output/'evidence'/f'{index:06d}';evidence.mkdir(mode=0o700)
        files=[]
        for evidence_name in _evidence_names(run):
            relative=Path(evidence_name)
            original=source/Path(*relative.parts[1:]) if relative.parts[0]=='run' else source.parent/relative
            require(not any(p.is_symlink() for p in [original,*original.parents]),'CONTEXT_SYMLINK_REJECTED')
            destination=evidence/relative;destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            with original.open('rb') as src,create_file(destination) as dst:shutil.copyfileobj(src,dst)
            files.append(dict(file=evidence_name,sha256=file_sha(destination)))
        _verify_evidence(evidence,run,files,release['quality_policy']['approval'])
        bindings.append(dict(kind=kind,selector=selector,file=name,count=len(run['records']),sha256=h.hexdigest(),evidence_files=files))
    with create_file(output/'bundle.json') as target:
        target.write(encoded(dict(schema_version=2,release=compact,record_files=bindings)))
    return output


def read_release_bundle(path):
    """Reconstruct and fully revalidate content; no metadata-only verified flag."""
    path = Path(path)
    require(not path.is_symlink(), 'CONTEXT_SYMLINK_REJECTED')
    path=path.parent.resolve()/path.name
    document = private_json(path/'bundle.json')
    require(document.get('schema_version')==2 and set(document)=={'schema_version','release','record_files'}, 'BUNDLE_SCHEMA_MISMATCH')
    release = document['release']; seen = set()
    expected = {('runs',n) for n in range(len(release['runs']))}
    expected |= {('baseline_archive',n) for n in range(len(release.get('baseline_archive',[])))}
    expected |= {('context_sources',k) for k,e in release['context_sources'].items() if e['run']}
    for index, binding in enumerate(document['record_files']):
        key = binding['kind'], binding['selector']; name = f'normalized/{index:06d}.jsonl'
        require(key in expected and key not in seen and binding['file']==name
                and type(binding['count']) is int and binding['count']>0 and not (path/'normalized').is_symlink(), 'BUNDLE_BINDING_MISMATCH')
        seen.add(key)
        run = release[key[0]][key[1]] if key[0] in ('runs','baseline_archive') else release['context_sources'][key[1]]['run']
        require('records' not in run and binding['sha256']==run['normalized_sha256'], 'BUNDLE_BINDING_MISMATCH')
        source=_verify_evidence(path/'evidence'/f'{index:06d}',run,binding.get('evidence_files'),release['quality_policy']['approval'])
        run['records'] = RecordFile(path/name,binding['count'],binding['sha256'],source)
    require(seen==expected, 'BUNDLE_BINDING_MISMATCH')
    return verify_context_release(release)


def main(argv=None):
    p = argparse.ArgumentParser(description='기존 실자료를 재검증해 최종 계약2 private 입력을 준비합니다. DB 접속 없음.')
    p.add_argument('--history-input-plan',required=True,type=Path)
    p.add_argument('--quality-policy',required=True,type=Path)
    p.add_argument('--history-id',required=True)
    p.add_argument('--context-run',required=True,action='append',type=Path)
    p.add_argument('--output',required=True,type=Path)
    args = p.parse_args(argv); started = time.monotonic()
    try:
        history = prepare_streamed_history(private_json(args.history_input_plan),private_json(args.quality_policy),expected_id=args.history_id)
        release = prepare_context_release(history,args.context_run)
        output = write_release_bundle(args.output,release)
        restored = read_release_bundle(output)
        receipt = dict(status='PREPARED_UNPUBLISHED',contract_version=2,release_id=restored['release_id'],
            history_candidate_id=restored['history_candidate_id'],quarters=restored['quarters'],
            context_rows=sum(e['run']['row_count'] for e in restored['context_sources'].values() if e['run']),
            normalized_rows=sum(len(r['records']) for r in restored['runs']),
            readback_verified=True,seconds=round(time.monotonic()-started,2))
        with create_file(output/'preparation.json') as target: target.write(encoded(receipt))
        print(json.dumps(receipt)); return 0
    except CollectionError as error:
        print(json.dumps(dict(status='FAIL',code=str(error),automatic_retry=False)),file=sys.stderr)
    except Exception as error:
        print(json.dumps(dict(status='FAIL',code='CONTEXT_PREPARATION_FAILED',type=type(error).__name__,automatic_retry=False)),file=sys.stderr)
    return 2


if __name__=='__main__': sys.exit(main())
