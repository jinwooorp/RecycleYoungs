"""Optional fixed real-archive checks; missing CI raw inputs never masquerade as validation."""

from collections import Counter
import os
from pathlib import Path
import sys
import unittest

import shapely

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.spatial_geometry import prepare_dataset
from app.spatial_sources import SPECS


def real_prepared(root, key):
    root = Path(root)
    if key == 'admin':
        archive = root / '서울시 상권분석서비스(영역-행정동).zip'
        reports = {'quality': root / 'validation-results.json'}
    else:
        archive = root / 'stage4-research-20261007/official-commercial-area.zip'
        reports = {'quality': root / 'stage56-validation-20261007/results.json',
                   'repair': root / 'six-repair-validation-20261007/results.json'}
    return prepare_dataset(SPECS[key], archive, reports)


@unittest.skipUnless(os.environ.get('SPATIAL_REAL_SOURCE_ROOT'), 'fixed Git-excluded real ZIP/reports not provided')
class RealArchiveTests(unittest.TestCase):
    def test_admin_425_source_and_operational(self):
        prepared = real_prepared(os.environ['SPATIAL_REAL_SOURCE_ROOT'], 'admin')
        self.assertEqual(len(prepared.features), 425)
        self.assertEqual(Counter(f.quality_status for f in prepared.features), {'VALID_SOURCE': 425})
        for f in prepared.features:
            self.assertEqual(shapely.from_wkb(f.source_wkb).geom_type, 'Polygon')
            self.assertEqual(shapely.from_wkb(f.operational_wkb).geom_type, 'MultiPolygon')

    def test_commercial_1650_and_six_accepted_repairs(self):
        prepared = real_prepared(os.environ['SPATIAL_REAL_SOURCE_ROOT'], 'commercial')
        self.assertEqual(len(prepared.features), 1650)
        self.assertEqual(Counter(f.quality_status for f in prepared.features),
                         {'VALID_SOURCE': 1644, 'REPAIRED_OPERATIONAL': 6})
        self.assertEqual(Counter(shapely.from_wkb(f.source_wkb).geom_type for f in prepared.features),
                         {'Polygon': 1561, 'MultiPolygon': 89})
        for f in prepared.features:
            op = shapely.from_wkb(f.operational_wkb)
            self.assertTrue(op.is_valid and not op.is_empty)
            if f.quality_status == 'REPAIRED_OPERATIONAL':
                self.assertFalse(shapely.from_wkb(f.source_wkb).is_valid)
                self.assertEqual(len(op.geoms), 1)
                self.assertEqual(len(op.geoms[0].interiors), 1)
        h5 = next(f for f in prepared.features if f.code == '3110531')
        self.assertEqual((h5.source_sigungu_code, h5.source_dong_code), ('11110', '11410660'))
        self.assertEqual(h5.source_attribute_status, 'CONFLICT_OBSERVED')


if __name__ == '__main__':
    unittest.main()
