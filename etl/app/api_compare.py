"""Compare a completed, unpublished API run with a hash-pinned CSV; no DB imports."""
import argparse
import ast
from collections import Counter, defaultdict
import csv
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import sys

from .api_artifacts import create_file, encoded
from .api_config import private_parent
from .api_records import (CollectionError, SALES, SEMAS, STORE_COUNTS, normalize_sales,
                          normalize_store, normalize_store_stats, quarter, reference_month)

COMMON_CSV = {'STDR_YYQU_CD': '기준_년분기_코드', 'ADSTRD_CD': '행정동_코드',
              'ADSTRD_CD_NM': '행정동_코드_명', 'SVC_INDUTY_CD': '서비스_업종_코드',
              'SVC_INDUTY_CD_NM': '서비스_업종_코드_명'}


def file_sha(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def declarations(filename, names):
    # Reuse the existing ETL's literal mappings without importing its DB/config modules.
    tree = ast.parse((Path(__file__).parent / filename).read_text())
    result = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in names:
                    result[target.id] = ast.literal_eval(node.value)
    if set(result) != set(names):
        raise CollectionError('LEGACY_MAPPING_MISMATCH')
    return result


def csv_fields(source):
    if source == 'seoul-stores':
        return COMMON_CSV | {'STOR_CO': '점포_수', 'SIMILR_INDUTY_STOR_CO': '유사_업종_점포_수',
                             'FRC_STOR_CO': '프랜차이즈_점포_수', 'OPBIZ_RT': '개업_율',
                             'OPBIZ_STOR_CO': '개업_점포_수', 'CLSBIZ_RT': '폐업_률',
                             'CLSBIZ_STOR_CO': '폐업_점포_수'}
    if source == 'seoul-sales':
        values = declarations('etl_sales.py', ('SALES_AMOUNT_FIELDS', 'TRANSACTION_FIELDS'))
        targets = {target: col for pairs in values.values() for col, target in pairs}
        if set(targets) != set(SALES.values()):
            raise CollectionError('LEGACY_MAPPING_MISMATCH')
        return COMMON_CSV | {api: targets[target] for api, target in SALES.items()}
    if source == 'semas-stores':
        values = declarations('etl_stores.py', ('USECOLS', 'COLUMNS'))
        targets = [x for x in values['COLUMNS'] if x not in ('industry_id', 'location')]
        if len(targets) != len(values['USECOLS']):
            raise CollectionError('LEGACY_MAPPING_MISMATCH')
        fields = dict(zip(targets, values['USECOLS'], strict=True))
        return {api: fields[target] for api, target in SEMAS.items()} | {
            'ctprvnCd': '시도코드', 'lon': '경도', 'lat': '위도'}
    raise CollectionError('UNSUPPORTED_COMPARISON_SOURCE')


def record_key(row, source):
    fields = ('source_store_id',) if source == 'semas-stores' else (
        'quarter_code', 'dong_code', 'source_industry_code')
    if not isinstance(row, dict) or any(not isinstance(row.get(f), str) or not row[f] for f in fields):
        raise CollectionError('INVALID_COMPARISON_KEY')
    return tuple(row[f] for f in fields)


def compare_run(run, csv_path, expected_csv_sha, *, baseline_reference_month=None):
    run, csv_path = Path(run), Path(csv_path)
    if not re.fullmatch('[0-9a-f]{64}', expected_csv_sha or '') or file_sha(csv_path) != expected_csv_sha:
        raise CollectionError('BASELINE_SHA_MISMATCH')
    manifest = json.loads((run / 'manifest.json').read_text())
    source = manifest.get('source')
    mapping = csv_fields(source)
    if (manifest.get('status') != 'COLLECTED_UNPUBLISHED' or manifest.get('complete') is not True
            or manifest.get('published') is not False or manifest.get('normalizer_version') not in (1, 2)):
        raise CollectionError('INCOMPLETE_API_RUN')
    scope = manifest.get('scope', {})
    if source.startswith('seoul-'):
        period = quarter(scope.get('quarter'))
        if scope.get('region') != 'SEOUL' or scope.get('industry') != 'ALL_SOURCE_INDUSTRIES':
            raise CollectionError('COMPARISON_SCOPE_MISMATCH')
    else:
        period = None
        if scope.get('region') != '11' or scope.get('industry') not in ('I21201', 'ALL_SOURCE_INDUSTRIES'):
            raise CollectionError('COMPARISON_SCOPE_MISMATCH')
        baseline_reference_month = reference_month(baseline_reference_month)
    normalized = run / 'normalized.jsonl'
    if file_sha(normalized) != manifest.get('normalized_sha256'):
        raise CollectionError('NORMALIZED_SHA_MISMATCH')
    api = {}
    with normalized.open(encoding='utf-8') as stream:
        for line in stream:
            row = json.loads(line)
            key = record_key(row, source)
            if key in api:
                raise CollectionError('DUPLICATE_API_KEY')
            api[key] = row
    if not api or any(type(manifest.get(f)) is not int or manifest[f] != len(api) for f in
                      ('received_count', 'unique_key_count', 'declared_count')):
        raise CollectionError('API_COUNT_MISMATCH')
    excluded = {'location', 'source_reference_month'} if source == 'semas-stores' else set()
    numeric = set(SALES.values()) if source == 'seoul-sales' else (
        set(STORE_COUNTS.values()) | {'opening_rate', 'closing_rate'} if source == 'seoul-stores'
        else {'longitude', 'latitude'})
    seen, differences = set(), defaultdict(Counter)
    total, matched, changed, baseline_only = 0, 0, 0, 0
    with csv_path.open(encoding='utf-8-sig' if source == 'semas-stores' else 'cp949', newline='') as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames or []
        if len(fields) != len(set(fields)) or not set(mapping.values()).issubset(fields):
            raise CollectionError('CSV_SCHEMA_MISMATCH')
        for raw in reader:
            total += 1
            if None in raw or any(v is None for v in raw.values()):
                raise CollectionError('CSV_ROW_WIDTH_MISMATCH')
            if period and raw[mapping['STDR_YYQU_CD']].strip() != period:
                continue
            if source == 'semas-stores' and (raw[mapping['ctprvnCd']].strip() != '11' or (
                    scope['industry'] == 'I21201' and raw[mapping['indsSclsCd']].strip() != 'I21201')):
                continue
            row = {field: raw[col].strip() for field, col in mapping.items()}
            if source == 'semas-stores':
                row = normalize_store(row, 'I21201' if scope['industry'] == 'I21201' else None,
                                      source_reference_month=baseline_reference_month)
            else:
                row = (normalize_store_stats if source == 'seoul-stores' else normalize_sales)(row, period)
            key = record_key(row, source)
            if key in seen:
                raise CollectionError('DUPLICATE_BASELINE_KEY')
            seen.add(key)
            actual = api.get(key)
            if actual is None:
                baseline_only += 1
                continue
            matched += 1
            if set(row) != set(actual):
                raise CollectionError('NORMALIZED_SCHEMA_MISMATCH')
            changed_fields = 0
            for field in row.keys() - excluded:
                before, after = row[field], actual[field]
                equal = before == after
                if field in numeric and before is not None and after is not None:
                    equal = Decimal(before) == Decimal(after)
                if equal:
                    continue
                changed_fields += 1
                kind = 'other'
                if before is None: kind = 'null_to_value'
                elif after is None: kind = 'value_to_null'
                elif field in numeric and Decimal(before) == 0 and Decimal(after) != 0: kind = 'zero_to_nonzero'
                elif field in numeric and Decimal(before) != 0 and Decimal(after) == 0: kind = 'nonzero_to_zero'
                differences[field][kind] += 1
            if changed_fields:
                changed += 1
    if not seen:
        raise CollectionError('NO_BASELINE_ROWS_IN_SCOPE')
    api_only = len(api.keys() - seen)
    reference_matches = source != 'semas-stores' or manifest.get('source_periods') == [baseline_reference_month]
    return dict(schema_version=1, normalizer_version=manifest['normalizer_version'],
                status='MATCH' if not (api_only or baseline_only or changed) and reference_matches else 'DIFFERENT',
                source=source, scope=scope, api_count=len(api), baseline_total_count=total,
                baseline_scope_count=len(seen), matched_keys=matched, api_only_keys=api_only,
                baseline_only_keys=baseline_only, changed_rows=changed,
                field_differences={k:dict(v) for k,v in sorted(differences.items())},
                baseline_sha256=expected_csv_sha, normalized_sha256=manifest['normalized_sha256'],
                excluded_derived_fields=sorted(excluded), baseline_reference_month=baseline_reference_month,
                api_source_periods=manifest.get('source_periods'), reference_period_matches=reference_matches,
                baseline_reference_kind='pinned_csv_filename_month_not_observation_date' if source == 'semas-stores' else 'row_quarter',
                limitations=['Field parity does not prove source completeness, freshness, or historical boundary compatibility.',
                             'Differences require investigation; none are automatically classified as closure or source correction.'])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--csv', type=Path, required=True)
    parser.add_argument('--csv-sha256', required=True)
    parser.add_argument('--baseline-reference-month')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report_path = private_parent(args.report)
        if report_path.exists() or report_path.is_symlink():
            raise CollectionError('REPORT_ALREADY_EXISTS')
        result = compare_run(args.run, args.csv, args.csv_sha256,
                             baseline_reference_month=args.baseline_reference_month)
        with create_file(report_path) as output:
            output.write(encoded(result))
        print(json.dumps({k:result[k] for k in ('status','source','api_count','matched_keys','changed_rows','api_only_keys','baseline_only_keys')}))
        return 0 if result['status'] == 'MATCH' else 3
    except CollectionError as error:
        print('ERROR: ' + str(error), file=sys.stderr)
    except Exception:
        print('ERROR: COMPARISON_FAILED', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
