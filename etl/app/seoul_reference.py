"""Current Seoul reference catalogs with field-level publication restrictions.

These catalogs have no historical-quarter or score authority. Raw responses are
private; only validated, explicitly allowed fields appear in normalized output.
"""
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from urllib.parse import quote

from .api_artifacts import create_file, encoded, manifest_write
from .api_config import private_parent
from .api_http import HttpClient
from .api_records import CollectionError, integer, number, text

PARKING_FIELDS = tuple(('ADDR ADD_CRG ADD_UNIT_TM_MNT BUS_PRK_ADD_CRG BUS_PRK_ADD_HM BUS_PRK_CRG BUS_PRK_HM '
    'CHGD_FREE_NM CHGD_FREE_SE CRB_PKLT_MNG_GROUP_NO DLY_MAX_CRG LAST_DATA_SYNC_TM LAT LHLDY LHLDY_BGNG LHLDY_NM '
    'LHLDY_YN LOT MNTL_CMUT_CRG NGHT_FREE_OPN_YN NGHT_FREE_OPN_YN_NAME OPER_SE OPER_SE_NM PKLT_CD PKLT_KND '
    'PKLT_KND_NM PKLT_NM PRK_CRG PRK_HM PRK_NOW_INFO_PVSN_YN PRK_NOW_INFO_PVSN_YN_NM SAT_CHGD_FREE_NM SAT_CHGD_FREE_SE '
    'TELNO TPKCT WD_OPER_BGNG_TM WD_OPER_END_TM WE_OPER_BGNG_TM WE_OPER_END_TM').split())
SOURCES = {
    'seoul-bus-stops': dict(service='busStopLocationXyInfo', dataset='OA-15067',
        fields=('NODE_ID', 'STOPS_NO', 'STOPS_NM', 'STOPS_TYPE', 'XCRD', 'YCRD'), id='NODE_ID',
        attributes=('STOPS_NO', 'STOPS_NM', 'STOPS_TYPE'), metric=None),
    'seoul-public-parking': dict(service='GetParkInfo', dataset='OA-13122', fields=PARKING_FIELDS, id='PKLT_CD',
        attributes=('PKLT_NM', 'ADDR', 'PKLT_KND_NM', 'LAST_DATA_SYNC_TM'), metric=('TPKCT', 'PARKING_SPACE')),
    'seoul-metro-leases': dict(service='tvSeoulmetroStoreInfo', dataset='OA-21305',
        fields=('SHPS_NO', 'STN_NM', 'STN_CD', 'TPBIZ', 'AREA', 'MM_RTFE', 'CTRT_STRT_DD', 'CTRT_END_DD'), id='SHPS_NO',
        attributes=('STN_NM', 'STN_CD', 'TPBIZ', 'CTRT_STRT_DD', 'CTRT_END_DD'), metric=('AREA', 'SQUARE_METRE_SOURCE_REPORTED')),
}


def require(ok, code):
    if not ok:
        raise CollectionError(code)


def policy(source):
    require(source in SOURCES, 'REFERENCE_SOURCE_UNSUPPORTED')
    reasons = {
        'seoul-bus-stops': ['CRS_DEFINITION_CONFLICT', 'CURRENT_SOURCE_LIST_ONLY'],
        'seoul-public-parking': ['COORDINATE_COVERAGE_UNVERIFIED', 'CURRENCY_UNVERIFIED', 'NOT_REALTIME_AVAILABILITY'],
        'seoul-metro-leases': ['CURRENCY_AND_CONTRACT_SCOPE_UNVERIFIED', 'CONTRACT_GROUP_AREA', 'METRO_PROPERTY_ONLY'],
    }
    result = dict(id='SEOUL_CURRENT_REFERENCE_V1', sourceId=source, datasetId=SOURCES[source]['dataset'],
                temporalUnit='CURRENT_SOURCE_SNAPSHOT', observedAt=None, spatialUnit='SOURCE_RECORD',
                scoreReady=False, reasonCodes=reasons[source],
                publishedAttributes=list(SOURCES[source]['attributes']),
                publishedMetrics=[] if SOURCES[source]['metric'] is None else [SOURCES[source]['metric'][0]])
    if source == 'seoul-public-parking':
        result['grouping'] = 'MANAGEMENT_ID_IDENTICAL_NON_COORDINATE_ATTRIBUTES'
        result['reasonCodes'] += ['MULTIPLE_SOURCE_ROWS_PER_MANAGEMENT_ID']
    return result


def metric(value, unit):
    try:
        result = number(value)
        if result is None:
            return dict(value=None, valueState='SOURCE_NULL', unit=unit)
        require(result >= 0 and result <= Decimal('9223372036854775807') and result.as_tuple().exponent >= -12,
                'REFERENCE_INVALID_METRIC')
        if unit == 'PARKING_SPACE':
            require(result == result.to_integral_value(), 'REFERENCE_INVALID_METRIC')
        return dict(value=format(result, 'f'), valueState='REPORTED', unit=unit)
    except CollectionError:
        return dict(value=None, valueState='WITHHELD_INVALID', unit=unit)


def normalize(source, row):
    require(source in SOURCES, 'REFERENCE_SOURCE_UNSUPPORTED')
    spec = SOURCES[source]
    require(isinstance(row, dict) and set(row) == set(spec['fields']), 'REFERENCE_SCHEMA_CHANGED')
    identity = text(row[spec['id']], nullable=False)
    require(bool(identity) and len(identity) <= 200, 'REFERENCE_ID_INVALID')
    attributes = {key: text(row[key]) for key in spec['attributes']}
    attribute_states = {key: 'SOURCE_NULL' if value is None else 'REPORTED' for key, value in attributes.items()}
    require(all(value is None or len(value) <= 2000 for value in attributes.values()), 'REFERENCE_TEXT_TOO_LONG')
    for key in ['CTRT_STRT_DD', 'CTRT_END_DD']:
        if attributes.get(key):
            try:
                date.fromisoformat(attributes[key])
            except ValueError:
                attributes[key] = None
                attribute_states[key] = 'WITHHELD_FORMAT'
    metrics = {}
    if spec['metric']:
        field, unit = spec['metric']; metrics[field] = metric(row[field], unit)
    return dict(reference_id=identity, attributes=attributes, attribute_states=attribute_states, metrics=metrics)


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def normalized_records(source, raw_rows):
    records = {}; originals = {}; coordinates = {}
    for raw_row in raw_rows:
        row = normalize(source, raw_row); key = row['reference_id']
        if source == 'seoul-public-parking':
            attributes = {k: v for k, v in raw_row.items() if k not in ['LAT', 'LOT']}
            # Coordinates remain withheld; exact decimal text is only a raw
            # membership key and never passes through binary floating point.
            location = encoded([None if raw_row[k] is None else str(raw_row[k]) for k in ['LAT', 'LOT']])
            if key in records:
                require(originals[key] == attributes, 'REFERENCE_ID_ATTRIBUTE_CONFLICT')
                require(location not in coordinates[key], 'DUPLICATE_REFERENCE_KEY')
                coordinates[key].add(location); records[key]['source_row_count'] += 1
                continue
            originals[key] = attributes; coordinates[key] = {location}; row['source_row_count'] = 1
        else:
            require(key not in records, 'DUPLICATE_REFERENCE_KEY')
        records[key] = row
    return list(records.values())


def raw_records(output, manifest):
    from .api_http import unique_object, invalid_constant
    for index, page in enumerate(manifest['pages'], 1):
        require(page['file'] == f'pages/{index:06d}.json', 'REFERENCE_PAGE_PATH_REJECTED')
        path = output / page['file']
        require(not path.is_symlink() and path.stat().st_uid == __import__('os').getuid() and not path.stat().st_mode & 0o077, 'REFERENCE_PRIVATE_PAGE_REQUIRED')
        raw = path.read_bytes(); require(hashlib.sha256(raw).hexdigest() == page['sha256'], 'REFERENCE_RAW_CHANGED')
        body = json.loads(raw, parse_float=Decimal, object_pairs_hook=unique_object, parse_constant=invalid_constant)
        envelope = body[SOURCES[manifest['source']]['service']]
        require(envelope['RESULT']['CODE'] == 'INFO-000' and integer(envelope['list_total_count']) == manifest['declared_count'], 'SOURCE_TOTAL_CHANGED')
        yield from envelope['row']


def collect_reference(output, source, key, *, client=None, page_size=1000, allow_http=False, probe=False):
    require(source in SOURCES and type(page_size) is int and 1 <= page_size <= 1000 and bool(key), 'REFERENCE_SCOPE_REJECTED')
    require(key != 'sample' or (probe and page_size <= 5), 'REFERENCE_KEY_SCOPE_REJECTED')
    output = private_parent(Path(output)); output.mkdir(mode=0o700); (output / 'pages').mkdir(mode=0o700)
    spec = SOURCES[source]; client = client or HttpClient()
    manifest = dict(schema_version=1, kind='SEOUL_CURRENT_REFERENCE_V1', source=source,
                    source_url='https://data.seoul.go.kr/dataList/' + spec['dataset'] + '/A/1/datasetView.do',
                    started_at=datetime.now(timezone.utc).isoformat(), collected_at=None, mode='probe' if probe else 'collect',
                    policy=policy(source), policy_version=digest(policy(source)), pages=[], complete=False, published=False,
                    status='IN_PROGRESS', received_count=0, declared_count=None, snapshot_id=None)
    manifest_write(output, manifest, first=True)
    normalized = hashlib.sha256(); start = 1
    base = 'http://openapi.seoul.go.kr:8088' if allow_http else 'https://openapi.seoul.go.kr:8088'
    try:
        with create_file(output / 'normalized.jsonl') as stream:
            while True:
                end = start + page_size - 1
                body, raw = client.get_json(base + '/' + quote(key, safe='') + '/json/' + spec['service'] + '/' + str(start) + '/' + str(end) + '/', secret=key)
                filename = f'pages/{len(manifest["pages"]) + 1:06d}.json'
                with create_file(output / filename) as page_file:
                    page_file.write(raw)
                manifest['pages'].append(dict(file=filename, sha256=hashlib.sha256(raw).hexdigest()))
                envelope = body.get(spec['service'])
                require(isinstance(envelope, dict) and envelope.get('RESULT', {}).get('CODE') == 'INFO-000', 'REFERENCE_API_ERROR')
                total = integer(envelope.get('list_total_count')); rows = envelope.get('row')
                require(isinstance(rows, list) and total <= 50000, 'REFERENCE_PAGE_REJECTED')
                require(manifest['declared_count'] in (None, total), 'SOURCE_TOTAL_CHANGED')
                manifest['declared_count'] = total
                require(len(rows) == min(page_size, max(0, total - start + 1)), 'PAGE_LENGTH_MISMATCH')
                manifest['received_count'] += len(rows)
                if probe or end >= total:
                    break
                start = end + 1
            records = normalized_records(source, raw_records(output, manifest))
            for row in records:
                data = encoded(row); stream.write(data); normalized.update(data)
            manifest['record_count'] = len(records)
        manifest.update(status='PROBED_UNPUBLISHED' if probe else 'COLLECTED_UNPUBLISHED', complete=not probe,
                        collected_at=datetime.now(timezone.utc).isoformat(), normalized_sha256=normalized.hexdigest())
        manifest['snapshot_id'] = digest(manifest)
        manifest_write(output, manifest)
        return manifest
    except BaseException:
        manifest.update(status='FAILED', complete=False, snapshot_id=None)
        manifest_write(output, manifest)
        raise


def read_reference(output):
    from api_runtime import private_read
    output = Path(output)
    manifest = json.loads(private_read(output / 'manifest.json'))
    require(manifest.get('kind') == 'SEOUL_CURRENT_REFERENCE_V1' and manifest.get('schema_version') == 1
            and manifest.get('complete') is True and manifest.get('published') is False
            and manifest.get('status') == 'COLLECTED_UNPUBLISHED' and manifest.get('mode') == 'collect', 'REFERENCE_INCOMPLETE')
    source = manifest['source']; require(manifest['policy'] == policy(source) and manifest['policy_version'] == digest(policy(source)), 'REFERENCE_POLICY_CHANGED')
    canonical = dict(manifest); identity = canonical.pop('snapshot_id'); canonical['snapshot_id'] = None
    require(digest(canonical) == identity, 'REFERENCE_MANIFEST_CHANGED')
    records = normalized_records(source, raw_records(output, manifest))
    data = b''.join(encoded(row) for row in records)
    require(len(records) == manifest.get('record_count', manifest['received_count'])
            and sum(r.get('source_row_count', 1) for r in records) == manifest['received_count'] == manifest['declared_count']
            and hashlib.sha256(data).hexdigest() == manifest['normalized_sha256'], 'REFERENCE_REPLAY_CHANGED')
    path = output / 'normalized.jsonl'
    require(not path.is_symlink() and path.stat().st_uid == __import__('os').getuid() and not path.stat().st_mode & 0o077
            and path.read_bytes() == data, 'REFERENCE_NORMALIZED_CHANGED')
    return dict(manifest=manifest, records=records)
