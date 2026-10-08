import copy
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import replace
from io import StringIO
from pathlib import Path
import shutil
import sys
import tempfile
import struct
import unittest
from unittest.mock import patch
import warnings

import shapely
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from spatial_fixtures import SHELL, TOUCH, digest, polygon_wkb, rewrite_archive, write_fixture
try:
    from app import spatial_geometry as spatial
except ImportError:
    spatial = None


class SpatialFileTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(spatial, 'Polygon preparation is not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.spec, self.archive, self.reports = write_fixture(self.root)

    def prepare(self):
        return spatial.prepare_dataset(self.spec, self.archive, self.reports)

    def test_valid_source_preserves_code_type_and_ndr_bytes_without_repair(self):
        with patch.object(spatial, 'make_valid', side_effect=AssertionError('valid source repaired')):
            prepared = self.prepare()
        feature = prepared.features[0]
        self.assertEqual(feature.code, '00110515')
        self.assertEqual(feature.source_wkb, polygon_wkb([SHELL]))
        self.assertEqual(feature.source_sha256, digest(polygon_wkb([SHELL])))
        self.assertEqual(shapely.from_wkb(feature.operational_wkb).geom_type, 'MultiPolygon')
        self.assertEqual(feature.quality_status, 'VALID_SOURCE')
        self.assertIsNone(feature.repair_parameters)

    def test_zip_hash_mismatch_is_rejected(self):
        self.archive.write_bytes(self.archive.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'ZIP SHA'):
            self.prepare()

    def test_missing_and_duplicate_members_are_rejected(self):
        for mutation in [lambda m: m[:-1], lambda m: m + [m[0]]]:
            with self.subTest(mutation=mutation):
                self.spec, self.archive, self.reports = write_fixture(self.root)
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    rewrite_archive(self.archive, self.spec, mutation)
                with self.assertRaisesRegex(ValueError, 'archive member'):
                    self.prepare()

    def test_wrong_crs_encoding_and_member_schema_are_rejected(self):
        for suffix, replacement, error in [('prj', b'not a CRS', 'CRS'), ('cpg', b'CP949', 'encoding')]:
            with self.subTest(suffix=suffix):
                self.spec, self.archive, self.reports = write_fixture(self.root)
                rewrite_archive(self.archive, self.spec,
                                lambda m: [(n, replacement if n.endswith('.' + suffix) else b) for n, b in m])
                with self.assertRaisesRegex(ValueError, error):
                    self.prepare()

    def test_missing_required_dbf_field_is_rejected(self):
        self.spec, self.archive, self.reports = write_fixture(self.root, fields=[('ADSTRD_NM', 'C', 30, 0)])
        with self.assertRaisesRegex(ValueError, 'field'):
            self.prepare()

    def test_strict_encoding_does_not_replace_bad_characters(self):
        def corrupt(members):
            result = []
            for name, data in members:
                if name.endswith('.dbf'):
                    data = bytearray(data)
                    header = int.from_bytes(data[8:10], 'little')
                    data[header + 1 + 8] = 255
                    data = bytes(data)
                result.append((name, data))
            return result
        rewrite_archive(self.archive, self.spec, corrupt)
        with self.assertRaises((UnicodeError, ValueError)):
            self.prepare()

    def test_blank_duplicate_and_untrimmed_codes_are_rejected(self):
        for codes in [[''], ['00110515', '00110515'], [' 0110515']]:
            with self.subTest(codes=codes):
                self.spec, self.archive, self.reports = write_fixture(self.root, codes=codes)
                with self.assertRaisesRegex(ValueError, 'code'):
                    self.prepare()

    def test_feature_count_mismatch_is_rejected(self):
        self.spec.feature_count = 2
        with self.assertRaisesRegex(ValueError, 'feature count'):
            self.prepare()

    def test_fixed_report_digest_and_runtime_repair_versions_are_required(self):
        self.reports['quality'].write_bytes(self.reports['quality'].read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'report SHA'):
            self.prepare()
        self.spec, self.archive, self.reports = write_fixture(self.root)
        with patch.object(spatial.shapely, 'geos_version_string', '3.14.0'):
            with self.assertRaisesRegex(ValueError, 'GEOS'):
                self.prepare()

    def test_unverified_invalid_and_unexpected_geometry_are_review_required(self):
        for geom in [Polygon(TOUCH), GeometryCollection([Polygon(SHELL), LineString([(0, 0), (1, 1)])]),
                     Polygon([(0, 0, 1), (0, 10, 1), (10, 10, 1), (0, 0, 1)])]:
            with self.subTest(geom=geom.geom_type):
                with self.assertRaisesRegex(ValueError, 'REVIEW_REQUIRED'):
                    spatial.process_geometry(geom, '00110515', 0, {})

    def test_specified_linework_repair_and_fixed_acceptance(self):
        self.spec, self.archive, self.reports = write_fixture(self.root, commercial=True, repair=True)
        with patch.object(spatial, 'make_valid', wraps=shapely.make_valid) as repair:
            prepared = self.prepare()
        self.assertEqual(repair.call_count, 1)
        self.assertEqual(repair.call_args.kwargs, {'method': 'linework', 'keep_collapsed': True})
        feature = prepared.features[1]
        self.assertEqual(feature.quality_status, 'REPAIRED_OPERATIONAL')
        self.assertEqual(feature.source_wkb, polygon_wkb([TOUCH]))
        self.assertNotEqual(feature.source_sha256, feature.operational_sha256)
        self.assertEqual(feature.repair_parameters, {'method': 'linework', 'keep_collapsed': True})
        self.assertEqual(len(shapely.from_wkb(feature.operational_wkb).geoms[0].interiors), 1)

    def test_h5_attributes_are_raw_and_remain_conflicted(self):
        self.spec, self.archive, self.reports = write_fixture(self.root, commercial=True)
        feature = self.prepare().features[0]
        self.assertEqual((feature.source_sigungu_code, feature.source_dong_code), ('11110', '11410660'))
        self.assertEqual(feature.source_attribute_status, 'CONFLICT_OBSERVED')
        self.assertIn('H5', feature.source_attribute_detail)

    def test_profile_is_canonical_and_independent_of_physical_input_path(self):
        first = self.prepare()
        other = self.root / 'relocated'
        other.mkdir()
        archive = other / 'renamed.zip'
        shutil.copyfile(self.archive, archive)
        reports = {role: other / path.name for role, path in self.reports.items()}
        for role, path in reports.items():
            shutil.copyfile(self.reports[role], path)
        second = spatial.prepare_dataset(self.spec, archive, reports)
        self.assertEqual(first.profile, second.profile)
        self.assertEqual(spatial.profile_sha256(first.profile), spatial.profile_sha256(second.profile))
        self.assertEqual(spatial.profile_sha256({'b': 2, 'a': '한글'}),
                         digest('{"a":"한글","b":2}'.encode('utf-8')))

    def test_serializer_is_little_endian_2d_without_srid(self):
        geom = shapely.set_srid(Polygon(SHELL), 5181)
        self.assertEqual(spatial.wkb_bytes(geom), polygon_wkb([SHELL]))

    def test_serializer_refuses_to_silently_flatten_z_or_m(self):
        for geom in [shapely.from_wkt('POLYGON Z ((0 0 1,0 10 1,10 10 1,0 0 1))'),
                     shapely.from_wkt('POLYGON M ((0 0 1,0 10 1,10 10 1,0 0 1))')]:
            with self.subTest(geom=geom.wkt), self.assertRaisesRegex(ValueError, '2D'):
                spatial.wkb_bytes(geom)

    def test_extra_unpaired_shp_feature_and_wrong_header_type_are_rejected(self):
        for mode in ('extra', 'z-header'):
            self.spec, self.archive, self.reports = write_fixture(self.root)
            def mutate(members):
                result = []
                for name, data in members:
                    raw = bytearray(data)
                    if name.endswith(('.shp', '.shx')):
                        if mode == 'z-header':
                            struct.pack_into('<I', raw, 32, 15)
                        elif name.endswith('.shp'):
                            raw.extend(struct.pack('>II', 2, (len(data) - 108) // 2) + data[108:])
                            struct.pack_into('>I', raw, 24, len(raw) // 2)
                        else:
                            raw.extend(struct.pack('>II', len(members[0][1]) // 2, (len(members[0][1]) - 108) // 2))
                            struct.pack_into('>I', raw, 24, len(raw) // 2)
                    result.append((name, bytes(raw)))
                return result
            rewrite_archive(self.archive, self.spec, mutate)
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, 'SHP|shape|REVIEW_REQUIRED'):
                self.prepare()


if __name__ == '__main__':
    unittest.main()
