"""Current reference catalogs expose validated fields, never inferred costs/CRS."""
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from decimal import Decimal


class ReferenceTests(unittest.TestCase):
    def module(self):
        try:
            return importlib.import_module('app.seoul_reference')
        except ModuleNotFoundError:
            self.fail('verified current reference collection is missing')

    def parking(self, m, code='P001', spaces='0'):
        row = {key: '' for key in m.SOURCES['seoul-public-parking']['fields']}
        row.update(PKLT_CD=code, PKLT_NM='시험 주차장', ADDR='서울특별시 종로구 시험로 1', TPKCT=spaces, LAT='', LOT='', PRK_CRG='1000')
        return row

    def test_parking_zero_is_reported_and_unverified_coordinates_fees_are_excluded(self):
        m = self.module(); row = m.normalize('seoul-public-parking', self.parking(m))
        self.assertEqual(row['metrics']['TPKCT'], dict(value='0', valueState='REPORTED', unit='PARKING_SPACE'))
        self.assertNotIn('LAT', row['metrics']); self.assertNotIn('PRK_CRG', row['metrics'])
        self.assertFalse(m.policy('seoul-public-parking')['scoreReady'])

    def test_bad_parking_count_is_withheld_instead_of_becoming_zero(self):
        m = self.module(); row = m.normalize('seoul-public-parking', self.parking(m, spaces='-1'))
        self.assertEqual(row['metrics']['TPKCT']['valueState'], 'WITHHELD_INVALID')
        self.assertIsNone(row['metrics']['TPKCT']['value'])

    def test_bus_identifiers_preserve_leading_zero_and_coordinates_are_withheld(self):
        m = self.module(); row = m.normalize('seoul-bus-stops', dict(NODE_ID='100000001', STOPS_NO='00101', STOPS_NM='시험정류장', STOPS_TYPE='일반', XCRD='126.9', YCRD='37.5'))
        self.assertEqual(row['attributes']['STOPS_NO'], '00101')
        self.assertEqual(row['metrics'], {})
        self.assertIn('CRS_DEFINITION_CONFLICT', m.policy('seoul-bus-stops')['reasonCodes'])

    def test_metro_area_is_reference_and_money_and_per_area_cost_are_not_published(self):
        m = self.module(); row = m.normalize('seoul-metro-leases', dict(SHPS_NO='01-1', STN_NM='시험역', STN_CD='001', TPBIZ='판매', AREA='25.50', MM_RTFE='2000000', CTRT_STRT_DD='2025-01-01', CTRT_END_DD='2026-12-31'))
        self.assertEqual(row['metrics']['AREA']['value'], '25.50')
        self.assertNotIn('MM_RTFE', row['metrics'])
        self.assertIn('CURRENCY_AND_CONTRACT_SCOPE_UNVERIFIED', m.policy('seoul-metro-leases')['reasonCodes'])

    def test_invalid_contract_date_is_withheld_with_reason_not_source_null(self):
        m = self.module(); row = m.normalize('seoul-metro-leases', dict(SHPS_NO='01-1', STN_NM='시험역', STN_CD='001', TPBIZ='판매', AREA='25', MM_RTFE='2000000', CTRT_STRT_DD='unverified', CTRT_END_DD=''))
        self.assertIn('attribute_states', row, 'invalid date and missing source date must be distinct')
        self.assertEqual(row['attribute_states']['CTRT_STRT_DD'], 'WITHHELD_FORMAT')
        self.assertEqual(row['attribute_states']['CTRT_END_DD'], 'SOURCE_NULL')

    def test_reference_sources_are_available_in_the_db_free_cli(self):
        from app.collect_main import parser
        try:
            args = parser().parse_args(['collect', 'seoul-public-parking', '--output', '/private/new-run'])
        except SystemExit:
            self.fail('reference sources are not connected to the collection CLI')
        self.assertEqual(args.source, 'seoul-public-parking')

    def test_schema_change_fails_before_any_value_is_published(self):
        m = self.module()
        with self.assertRaisesRegex(ValueError, 'REFERENCE_SCHEMA_CHANGED'):
            m.normalize('seoul-public-parking', self.parking(m) | dict(NEW_FIELD='unverified'))

    def client(self, service, pages):
        class Client:
            def __init__(self): self.index = 0
            def get_json(self, url, *, secret):
                rows, total = pages[self.index]; self.index += 1
                body = {service: dict(RESULT=dict(CODE='INFO-000'), row=rows, list_total_count=total)}
                return body, json.dumps(body).encode()
        return Client()

    def test_complete_raw_replay_detects_altered_normalized_fields(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); root.chmod(0o700); output = root / 'new-run'
            client = self.client('GetParkInfo', [([self.parking(m)], 1)])
            manifest = m.collect_reference(output, 'seoul-public-parking', 'key', client=client, allow_http=True)
            self.assertTrue(manifest['complete']); self.assertFalse(manifest['published'])
            self.assertEqual(m.read_reference(output)['records'][0]['metrics']['TPKCT']['value'], '0')
            (output / 'normalized.jsonl').write_text('{}\n')
            with self.assertRaises(ValueError): m.read_reference(output)

    def test_duplicate_source_keys_block_publication_and_preserve_raw(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); root.chmod(0o700); output = root / 'new-run'
            client = self.client('GetParkInfo', [([self.parking(m), self.parking(m)], 2)])
            with self.assertRaisesRegex(ValueError, 'DUPLICATE_REFERENCE_KEY'):
                m.collect_reference(output, 'seoul-public-parking', 'key', client=client, allow_http=True)
            self.assertTrue((output / 'pages/000001.json').exists())
            self.assertFalse(json.loads((output / 'manifest.json').read_text())['complete'])

    def test_total_change_between_pages_is_not_a_complete_catalog(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); root.chmod(0o700); output = root / 'new-run'
            client = self.client('GetParkInfo', [([self.parking(m, '1')], 2), ([self.parking(m, '2')], 3)])
            with self.assertRaisesRegex(ValueError, 'SOURCE_TOTAL_CHANGED'):
                m.collect_reference(output, 'seoul-public-parking', 'key', client=client, page_size=1, allow_http=True)
            self.assertFalse(json.loads((output / 'manifest.json').read_text())['complete'])

    def test_parking_identical_management_attributes_are_grouped_without_summing_spaces(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); root.chmod(0o700); output = root / 'new-run'
            a = self.parking(m, spaces='20') | dict(LAT='37.5', LOT='127.0')
            b = a | dict(LAT='37.5001')
            client = self.client('GetParkInfo', [([a, b], 2)])
            manifest = m.collect_reference(output, 'seoul-public-parking', 'key', client=client, allow_http=True)
            checked = m.read_reference(output)
            self.assertEqual(manifest['received_count'], 2)
            self.assertEqual(len(checked['records']), 1)
            self.assertEqual(checked['records'][0]['source_row_count'], 2)
            self.assertEqual(checked['records'][0]['metrics']['TPKCT']['value'], '20')

    def test_parking_conflicting_capacity_is_not_arbitrarily_selected(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); root.chmod(0o700); output = root / 'new-run'
            a = self.parking(m, spaces='20') | dict(LAT='37.5', LOT='127.0')
            b = a | dict(LAT='37.5001', TPKCT='21')
            client = self.client('GetParkInfo', [([a, b], 2)])
            with self.assertRaisesRegex(ValueError, 'REFERENCE_ID_ATTRIBUTE_CONFLICT'):
                m.collect_reference(output, 'seoul-public-parking', 'key', client=client, allow_http=True)

    def test_parking_json_decimal_coordinates_can_identify_distinct_raw_members(self):
        m = self.module(); a = self.parking(m, spaces='20') | dict(LAT=Decimal('37.5'), LOT=Decimal('127.0'))
        b = a | dict(LAT=Decimal('37.5001'))
        rows = m.normalized_records('seoul-public-parking', [a, b])
        self.assertEqual(rows[0]['source_row_count'], 2)
        self.assertEqual(rows[0]['metrics']['TPKCT']['value'], '20')


if __name__ == '__main__': unittest.main()
