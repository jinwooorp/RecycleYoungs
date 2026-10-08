"""Approved archive/report identities. No discovery, downloads or database defaults."""

from dataclasses import dataclass


@dataclass(frozen=True)
class SpatialSpec:
    key: str
    dataset_id: str
    boundary_kind: str
    stem: str
    archive_sha256: str
    member_hashes: dict
    fields: tuple
    feature_count: int
    geometry_types: dict
    invalid_codes: tuple
    report_hashes: dict
    report_artifacts: dict
    provenance: dict


PRJ_SHA = '680810e56b8fe15e448efdf2d278a9753369bc93a6fc0092b7952dfac4b872c9'
CPG_SHA = '3ad3031f5503a4404af825262ee8232cc04d4ea6683d42c5dd0a2f2a27ac9824'


def _members(stem, shp, shx, dbf):
    return {f'{stem}.{suffix}': digest for suffix, digest in
            [('shp', shp), ('shx', shx), ('dbf', dbf), ('prj', PRJ_SHA), ('cpg', CPG_SHA)]}


ADMIN_STEM = '서울시 상권분석서비스(영역-행정동)'
COMMERCIAL_STEM = '서울시 상권분석서비스(영역-상권)'
SPECS = {
    'admin': SpatialSpec(
        'admin', 'OA-22160', 'ADMIN_DONG', ADMIN_STEM,
        '969f7033bd3609a5fd586790f5b2cfedc638d7647ef45c78f9c75e1dabf79f68',
        _members(ADMIN_STEM,
                 '49b367efb542b9462d8441e3a7ca6f62482818e78eafc4c82ce0d6fb27471dbb',
                 '7a9dbe34dbec03ff6849b91e716a59675994477d4e9f74e9047eee5490fd1fe9',
                 '1134418c9a61dcfff6c4df3f7f21267b4d9399d05315d255a98c4880f055ed4c'),
        (('ADSTRD_CD', 'C', 8, 0), ('ADSTRD_NM', 'C', 30, 0),
         ('XCNTS_VALU', 'N', 38, 0), ('YDNTS_VALU', 'N', 38, 0), ('RELM_AR', 'N', 38, 0)),
        425, {'Polygon': 425}, (),
        {'quality': '9358769876c8c30e62d8ef9e7b62daba6aee16e11ad4a9033f1ea9821e01477b'},
        {'quality': 'data/raw/spatial/validation-results.json'},
        {'dataset_name': ADMIN_STEM,
         'source_url': 'https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do',
         'source_file_name': ADMIN_STEM + '.zip', 'downloaded_at': '2026-10-07T14:17:09+09:00',
         'source_file_modified_date': '2023-10-31', 'source_data_updated_date': '2026-09-11'},
    ),
    'commercial': SpatialSpec(
        'commercial', 'OA-15560', 'COMMERCIAL_AREA', COMMERCIAL_STEM,
        '38bb8fab4e45a1171af4989cd7fa1275f68e5d644aa770f5431ce7ccc38384dd',
        _members(COMMERCIAL_STEM,
                 '4de3d04e79a8b77440655c4eb880184bbeec426ebeb3ac2d0e00b2e5a3c8016c',
                 'b0859525d6ab1ca0eaa708279de17435eda2a36eef69e9effbbae38f39c6f764',
                 '7e2d03d69442418c142dbaa6b206888777fdd4207825df90c70af408f2c5f3ff'),
        (('TRDAR_SE_C', 'C', 1, 0), ('TRDAR_SE_1', 'C', 12, 0), ('TRDAR_CD', 'C', 10, 0),
         ('TRDAR_CD_N', 'C', 254, 0), ('XCNTS_VALU', 'N', 38, 0), ('YDNTS_VALU', 'N', 38, 0),
         ('SIGNGU_CD', 'C', 5, 0), ('SIGNGU_CD_', 'C', 40, 0), ('ADSTRD_CD', 'C', 8, 0),
         ('ADSTRD_CD_', 'C', 40, 0), ('RELM_AR', 'N', 38, 0)),
        1650, {'Polygon': 1561, 'MultiPolygon': 89},
        ('3110137', '3110270', '3110234', '3110407', '3110515', '3110542'),
        {'quality': '86f92f57ca36b222238171ce4977ce29ce456a66cfce0f3c454339201e43c548',
         'repair': '5654305c2d205575932159746a32a950ea9b06a03b83b7c65f321e347bae2297'},
        {'quality': 'data/raw/spatial/stage56-validation-20261007/results.json',
         'repair': 'data/raw/spatial/six-repair-validation-20261007/results.json'},
        {'dataset_name': COMMERCIAL_STEM,
         'source_url': 'https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do',
         'source_file_name': COMMERCIAL_STEM + '.zip', 'downloaded_at': '2026-10-07T15:30:00+09:00',
         'source_file_modified_date': '2023-10-23', 'source_data_updated_date': None},
    ),
}
