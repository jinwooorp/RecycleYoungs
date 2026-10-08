"""Small, independent SHP/report fixtures; no Git-excluded real data required."""

import hashlib
import io
import json
from pathlib import Path
import struct
from types import SimpleNamespace
import zipfile

from pyproj import CRS
import shapefile


SHELL = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]
TOUCH = [(0, 0), (2, 1), (1, 2), (0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]
REPAIRED = [[(0, 10), (10, 10), (10, 0), (0, 0), (0, 10)],
            [(2, 1), (1, 2), (0, 0), (2, 1)]]
TOOLS = {"python": "3.13.16", "pyshp": "3.1.6", "shapely": "2.1.2",
         "geos": "3.13.1", "pyproj": "3.7.0", "proj": "9.4.1"}


def polygon_wkb(rings):
    """Hand-encoded 2D NDR OGC WKB, independent of the ETL serializer."""
    result = struct.pack("<BII", 1, 3, len(rings))
    for ring in rings:
        result += struct.pack("<I", len(ring))
        result += b"".join(struct.pack("<dd", *p) for p in ring)
    return result


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_fixture(directory, commercial=False, repair=False, codes=None, fields=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    stem = "synthetic-commercial" if commercial else "synthetic-admin"
    fields = fields or ([('TRDAR_CD', 'C', 10, 0), ('TRDAR_CD_N', 'C', 254, 0),
                         ('SIGNGU_CD', 'C', 5, 0), ('ADSTRD_CD', 'C', 8, 0)] if commercial else
                        [('ADSTRD_CD', 'C', 8, 0), ('ADSTRD_NM', 'C', 30, 0)])
    codes = codes or (["3110531", "3110137"] if repair else
                      ["3110531"] if commercial else ["00110515"])
    streams = {suffix: io.BytesIO() for suffix in ('shp', 'shx', 'dbf')}
    writer = shapefile.Writer(shp=streams['shp'], shx=streams['shx'], dbf=streams['dbf'],
                              shapeType=shapefile.POLYGON, encoding='utf-8')
    for field in fields:
        writer.field(*field)
    for index, code in enumerate(codes):
        writer.poly([TOUCH if repair and index == 1 else SHELL])
        values = {'ADSTRD_CD': '11410660' if commercial else code,
                  'ADSTRD_NM': 'synthetic', 'TRDAR_CD': code, 'TRDAR_CD_N': 'synthetic',
                  'SIGNGU_CD': '11110'}
        writer.record(*(values.get(field[0], '') for field in fields))
    writer.close()
    members = {f'{stem}.{suffix}': stream.getvalue() for suffix, stream in streams.items()}
    members[f'{stem}.cpg'] = b'UTF-8'
    members[f'{stem}.prj'] = CRS.from_epsg(5181).to_wkt('WKT1_ESRI').encode('utf-8')
    archive = directory / 'source.zip'
    with zipfile.ZipFile(archive, 'w') as dest:
        for name, data in members.items():
            dest.writestr(zipfile.ZipInfo(name), data)
    archive_sha = digest(archive.read_bytes())
    provenance = {'download_completed_at': '2026-10-07T15:30:00+09:00',
                  'sha256': archive_sha, 'source_page': 'https://example.invalid/synthetic'}
    if commercial:
        quality = {'tools': TOOLS, 'polygon': {
            'source_provenance': provenance, 'fields': fields, 'encoding': 'UTF-8',
            'crs_epsg': 5181, 'feature_count': len(codes), 'geometry_types': {'Polygon': len(codes)},
            'valid': len(codes) - int(repair), 'invalid': [{'code': '3110137', 'feature': 1}] if repair else []}}
    else:
        quality = {'tools': TOOLS, 'archive_provenance': dict(provenance, official_dataset_id='OA-22160'),
                   'schema': {'fields': fields, 'encoding': 'UTF-8'},
                   'geometry': {'feature_count': len(codes), 'types': {'Polygon': len(codes)},
                                'valid_count': len(codes), 'invalid': []}}
    reports = {'quality': quality}
    if commercial:
        features = []
        if repair:
            features = [{'code': '3110137', 'name': 'synthetic', 'source_feature_index': 1,
                         'raw': {'wkb_sha256': digest(polygon_wkb([TOUCH]))},
                         'decision': 'ACCEPTABLE', 'source_vertices_retained': True,
                         'boundary_equals_raw': True,
                         'methods': {'linework': {'make_valid_result': {
                             'type': 'Polygon', 'valid': True, 'empty': False, 'holes': 1,
                             'polygonal_components': 1, 'non_polygon_components': 0,
                             'wkb_sha256': digest(polygon_wkb(REPAIRED))}}}}]
        reports['repair'] = {'tools': TOOLS, 'features': features,
                             'decisions': {'ACCEPTABLE': len(features), 'REVIEW_REQUIRED': 0, 'UNSUPPORTED': 0}}
    paths = {}
    for role, document in reports.items():
        paths[role] = directory / f'{role}.json'
        paths[role].write_text(json.dumps(document, sort_keys=True), encoding='utf-8')
    spec = SimpleNamespace(
        key='commercial' if commercial else 'admin', dataset_id='OA-15560' if commercial else 'OA-22160',
        boundary_kind='COMMERCIAL_AREA' if commercial else 'ADMIN_DONG',
        stem=stem, archive_sha256=archive_sha, member_hashes={k: digest(v) for k, v in members.items()},
        fields=tuple(tuple(f) for f in fields), feature_count=len(codes), geometry_types={'Polygon': len(codes)},
        invalid_codes=('3110137',) if repair else (),
        report_hashes={role: digest(path.read_bytes()) for role, path in paths.items()},
        report_artifacts={role: f'synthetic/{role}.json' for role in paths},
        provenance={'dataset_name': 'synthetic', 'source_url': 'https://example.invalid/synthetic',
                    'source_file_name': f'{stem}.zip', 'downloaded_at': '2026-10-07T15:30:00+09:00',
                    'source_file_modified_date': '2023-10-23', 'source_data_updated_date': None},
    )
    return spec, archive, paths


def rewrite_archive(archive, spec, mutate):
    with zipfile.ZipFile(archive) as source:
        members = [(i.filename, source.read(i)) for i in source.infolist()]
    members = mutate(members)
    with zipfile.ZipFile(archive, 'w') as dest:
        for name, data in members:
            dest.writestr(zipfile.ZipInfo(name), data)
    # Test-only trust boundary: reach the parser after mutation instead of stopping at the ZIP pin.
    spec.archive_sha256 = digest(archive.read_bytes())
    for name, data in members:
        if name in spec.member_hashes:
            spec.member_hashes[name] = digest(data)
    quality_path = archive.parent / 'quality.json'
    document = json.loads(quality_path.read_text())
    provenance = (document['polygon']['source_provenance'] if 'polygon' in document
                  else document['archive_provenance'])
    provenance['sha256'] = spec.archive_sha256
    quality_path.write_text(json.dumps(document, sort_keys=True), encoding='utf-8')
    spec.report_hashes['quality'] = digest(quality_path.read_bytes())
