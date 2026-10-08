"""Offline, pinned evidence and lossless 5181 geometry preparation."""

from collections import Counter
from dataclasses import dataclass
import hashlib
import io
from itertools import zip_longest
import json
import math
from pathlib import Path
import platform
import re
import struct
import zipfile

from pyproj import CRS
import pyproj
import shapefile
import shapely
from shapely import make_valid
from shapely.geometry import MultiPolygon, shape


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def profile_sha256(profile):
    return sha256(canonical_json(profile).encode('utf-8'))


def wkb_bytes(geometry):
    if geometry.has_z or geometry.has_m:
        raise ValueError('2D WKB only; refusing to flatten Z/M')
    return shapely.to_wkb(geometry, byte_order=1, output_dimension=2, include_srid=False, flavor='iso')


def runtime_versions():
    versions = {'python': platform.python_version(), 'pyshp': shapefile.__version__,
                'shapely': shapely.__version__, 'geos': shapely.geos_version_string,
                'pyproj': pyproj.__version__, 'proj': pyproj.proj_version_str}
    for name, expected in [('pyshp', '3.1.6'), ('shapely', '2.1.2'), ('geos', '3.13.1')]:
        if versions[name] != expected:
            raise ValueError(f'{name.upper()} version requires separate acceptance: {versions[name]} != {expected}')
    return versions


@dataclass(frozen=True)
class BoundaryFeature:
    code: str
    name: str
    source_feature_index: int
    source_wkb: bytes
    operational_wkb: bytes
    source_sha256: str
    operational_sha256: str
    quality_status: str
    quality_detail: str | None = None
    repair_method: str | None = None
    repair_parameters: dict | None = None
    source_sigungu_code: str | None = None
    source_dong_code: str | None = None
    source_attribute_status: str | None = None
    source_attribute_detail: str | None = None


@dataclass(frozen=True)
class PreparedDataset:
    spec: object
    features: tuple[BoundaryFeature, ...]
    profile: dict


def _evidence(spec, paths):
    if set(paths) != set(spec.report_hashes):
        raise ValueError('required fixed report paths are missing or unexpected')
    reports = {}
    for role, expected in spec.report_hashes.items():
        data = Path(paths[role]).read_bytes()
        if sha256(data) != expected:
            raise ValueError(f'{role} report SHA mismatch')
        reports[role] = json.loads(data.decode('utf-8'))
    quality = reports['quality']
    if spec.boundary_kind == 'ADMIN_DONG':
        provenance, schema, summary = quality['archive_provenance'], quality['schema'], quality['geometry']
        count, types, valid = summary['feature_count'], summary['types'], summary['valid_count']
        fields = schema['fields']
    else:
        summary = quality['polygon']
        provenance, fields = summary['source_provenance'], summary['fields']
        count, types, valid = summary['feature_count'], summary['geometry_types'], summary['valid']
    if provenance['sha256'] != spec.archive_sha256:
        raise ValueError('report source ZIP SHA mismatch')
    if count != spec.feature_count or types != spec.geometry_types or valid != count - len(spec.invalid_codes):
        raise ValueError('fixed report feature count/type/quality differs from approved source')
    if tuple(tuple(f) for f in fields) != spec.fields:
        raise ValueError('fixed report field schema mismatch')
    acceptance = {}
    if 'repair' in reports:
        report = reports['repair']
        for name, expected in [('shapely', '2.1.2'), ('geos', '3.13.1'), ('pyshp', '3.1.6')]:
            if report['tools'][name] != expected:
                raise ValueError('fixed repair acceptance tool version mismatch')
        for item in report['features']:
            code = item['code']
            result = item['methods']['linework']['make_valid_result']
            if code in acceptance or item['decision'] != 'ACCEPTABLE' or not (
                item['source_vertices_retained'] and item['boundary_equals_raw']
                and result['type'] == 'Polygon' and result['valid'] and not result['empty']
                and result['holes'] == 1 and result['polygonal_components'] == 1
                and result['non_polygon_components'] == 0
            ):
                raise ValueError('REVIEW_REQUIRED: invalid or duplicate fixed repair acceptance')
            acceptance[code] = {'code': code, 'index': item['source_feature_index'],
                                'source_sha256': item['raw']['wkb_sha256'],
                                'repair_polygon_sha256': result['wkb_sha256'], 'holes': result['holes']}
        if set(acceptance) != set(spec.invalid_codes):
            raise ValueError('REVIEW_REQUIRED: fixed acceptance code set mismatch')
    return acceptance


def _archive(spec, path):
    data = Path(path).read_bytes()
    if sha256(data) != spec.archive_sha256:
        raise ValueError('source ZIP SHA mismatch')
    members = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for member in archive.infolist():
            name = member.filename if member.flag_bits & 0x800 else member.filename.encode('cp437').decode('cp949')
            if name in members or name not in spec.member_hashes or member.is_dir():
                raise ValueError(f'unexpected/duplicate archive member: {name}')
            members[name] = archive.read(member)
    if set(members) != set(spec.member_hashes):
        raise ValueError('missing archive member')
    for name, data in members.items():
        if sha256(data) != spec.member_hashes[name]:
            raise ValueError(f'archive member SHA mismatch: {name}')
    if members[spec.stem + '.cpg'] != b'UTF-8':
        raise ValueError('unsupported DBF encoding declaration')
    try:
        source_crs = CRS.from_wkt(members[spec.stem + '.prj'].decode('utf-8'))
        expected_crs = CRS.from_wkt(CRS.from_epsg(5181).to_wkt('WKT1_ESRI'))
        if source_crs.to_epsg() != 5181 or not source_crs.equals(expected_crs, ignore_axis_order=True):
            raise ValueError('not approved EPSG:5181 CRS')
    except Exception as exc:
        raise ValueError('source CRS declaration mismatch') from exc
    return members


def process_geometry(source, code, index, acceptance):
    if source.geom_type not in ('Polygon', 'MultiPolygon') or source.is_empty or source.has_z or source.has_m:
        raise ValueError(f'REVIEW_REQUIRED: unexpected geometry type/dimension/empty for {code}')
    if not all(math.isfinite(v) for point in shapely.get_coordinates(source) for v in point):
        raise ValueError(f'REVIEW_REQUIRED: nonfinite geometry for {code}')
    if source.is_valid:
        operational = source if source.geom_type == 'MultiPolygon' else MultiPolygon([source])
        return operational, 'VALID_SOURCE', None, None, None
    approved = acceptance.get(code)
    if not approved or approved['index'] != index or approved['source_sha256'] != sha256(wkb_bytes(source)):
        raise ValueError(f'REVIEW_REQUIRED: unverified invalid geometry or source/index mismatch for {code}')
    repaired = make_valid(source, method='linework', keep_collapsed=True)
    if not (repaired.geom_type == 'Polygon' and repaired.is_valid and not repaired.is_empty
            and len(repaired.interiors) == approved['holes'] and repaired.bounds == source.bounds
            and repaired.boundary.equals(source.boundary)
            and set(map(tuple, shapely.get_coordinates(repaired))) == set(map(tuple, shapely.get_coordinates(source)))
            and sha256(wkb_bytes(repaired)) == approved['repair_polygon_sha256']):
        raise ValueError(f'REVIEW_REQUIRED: unexpected repair component/meaning/hash for {code}')
    return (MultiPolygon([repaired]), 'REPAIRED_OPERATIONAL', shapely.is_valid_reason(source),
            'make_valid', {'method': 'linework', 'keep_collapsed': True})


def _shape_records(reader):
    try:
        for geometry, record in zip_longest(reader.iterShapes(), reader.iterRecords()):
            if geometry is None or record is None:
                raise ValueError('SHP shape/record count mismatch')
            yield shapefile.ShapeRecord(geometry, record)
    except (shapefile.ShapefileException, shapefile.dbfFileException, UnicodeError) as exc:
        raise ValueError('strict SHP/DBF parsing failed; no character replacement') from exc


def prepare_dataset(spec, zip_path, report_paths):
    versions = runtime_versions()
    acceptance = _evidence(spec, report_paths)
    members = _archive(spec, zip_path)
    dbf = members[spec.stem + '.dbf']
    count, header_length, record_length = struct.unpack_from('<IHH', dbf, 4)
    if count != spec.feature_count:
        raise ValueError('DBF feature count mismatch')
    if len(dbf) < header_length + count * record_length or any(
        dbf[header_length + i * record_length] != 0x20 for i in range(count)
    ):
        raise ValueError('missing/deleted DBF feature')
    reader = shapefile.Reader(shp=io.BytesIO(members[spec.stem + '.shp']),
                              shx=io.BytesIO(members[spec.stem + '.shx']), dbf=io.BytesIO(dbf),
                              encoding='utf-8', encodingErrors='strict')
    fields = tuple((f[0], f[1].value if hasattr(f[1], 'value') else f[1], f[2], f[3])
                   for f in reader.fields[1:])
    if reader.shapeType != shapefile.POLYGON:
        raise ValueError('REVIEW_REQUIRED: unexpected SHP header type/Z/M')
    if fields != spec.fields:
        raise ValueError('DBF field schema mismatch')
    commercial = spec.boundary_kind == 'COMMERCIAL_AREA'
    code_field, name_field = ('TRDAR_CD', 'TRDAR_CD_N') if commercial else ('ADSTRD_CD', 'ADSTRD_NM')
    if not {code_field, name_field}.issubset(f[0] for f in fields):
        raise ValueError('required code/name field missing')
    features, seen, invalid, types = [], set(), set(), Counter()
    for index, item in enumerate(_shape_records(reader)):
        if item.shape.shapeType != shapefile.POLYGON:
            raise ValueError('REVIEW_REQUIRED: unexpected SHP geometry type/Z/M')
        record = item.record.as_dict()
        code, name = record[code_field], record[name_field]
        # Pyshp 3.1.6 removes DBF RHS storage padding, not semantic leading whitespace/zeros.
        pattern = r'[0-9]{1,20}' if commercial else r'[0-9]{8}'
        if not isinstance(code, str) or not re.fullmatch(pattern, code) or code in seen:
            raise ValueError(f'missing/duplicate/invalid source code: {code!r}')
        if not isinstance(name, str) or not name.strip():
            raise ValueError('missing source name')
        seen.add(code)
        source = shape(item.shape.__geo_interface__)
        types[source.geom_type] += 1
        if not source.is_valid:
            invalid.add(code)
        operational, quality, detail, method, parameters = process_geometry(source, code, index, acceptance)
        raw, op = wkb_bytes(source), wkb_bytes(operational)
        attribute = {}
        if commercial:
            attribute = {'source_sigungu_code': record['SIGNGU_CD'], 'source_dong_code': record['ADSTRD_CD'],
                         'source_attribute_status': 'UNVERIFIED'}
            if code == '3110531':
                if (record['SIGNGU_CD'], record['ADSTRD_CD']) != ('11110', '11410660'):
                    raise ValueError('REVIEW_REQUIRED: H5 raw attributes changed')
                attribute.update(source_attribute_status='CONFLICT_OBSERVED', source_attribute_detail=
                                 'H5 unresolved; SIGNGU_CD=11110 / ADSTRD_CD=11410660 hierarchy conflict; no canonical attribution')
        features.append(BoundaryFeature(code, name, index, raw, op, sha256(raw), sha256(op),
                                        quality, detail, method, parameters, **attribute))
    if len(features) != spec.feature_count or dict(types) != spec.geometry_types or invalid != set(spec.invalid_codes):
        raise ValueError('feature count/type/invalid code set mismatch; no partial publication')
    profile = {'policy': 'spatial-v2-8b1-linework-v1', 'dataset_id': spec.dataset_id,
               'boundary_kind': spec.boundary_kind, 'source_zip_sha256': spec.archive_sha256,
               'source_members': spec.member_hashes, 'reports': {
                   role: {'sha256': digest, 'artifact_path': spec.report_artifacts[role]}
                   for role, digest in spec.report_hashes.items()},
               'parser': {'library': 'pyshp', 'encoding': 'UTF-8 strict', 'feature_index': '0-based SHP order',
                          'fields': spec.fields, 'normalization': 'none; DBF RHS storage padding only'},
               'serializer': {'type': 'OGC WKB', 'dimensions': 2, 'endian': 'NDR', 'srid': False, 'normalize': False},
               'geometry': {'srid': 5181, 'operational_type': 'MultiPolygon',
                            'repair_method': 'linework', 'keep_collapsed': True},
               'accepted_repairs': [acceptance[k] for k in sorted(acceptance)], 'tools': versions,
               'implementation': {name: sha256(Path(__file__).with_name(name).read_bytes())
                                  for name in ('spatial_geometry.py', 'spatial_sources.py')},
               'limitations': 'overall B; historical 2025 compatibility UNRESOLVED; stage4 incomplete; H5 unresolved'}
    return PreparedDataset(spec, tuple(features), json.loads(canonical_json(profile)))
