from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import etl_stores
from app.industry import load_industry_map
from store_fixtures import mapped_mock_connection, store_rows, write_store_csv


class StoreMappingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = write_store_csv(Path(self.temp.name) / 'stores.csv')
        self.conn, self.cursor, self.catalog = mapped_mock_connection()

    def run_loader(self, chunk_size=1):
        with redirect_stdout(StringIO()), patch.object(etl_stores, 'STORE_CHUNK_SIZE', chunk_size):
            etl_stores.run(self.conn, self.path)

    def copied(self):
        writer = self.cursor.copy.return_value.__enter__.return_value
        return [call.args[0] for call in writer.write_row.call_args_list]

    def test_cafe_materialization_and_source_null_separation(self):
        self.run_loader()
        rows = self.copied()
        position = etl_stores.COLUMNS.index('industry_id')
        self.assertEqual(len(rows), 4)
        self.assertEqual([r[position] for r in rows], [self.catalog['CAFE'], None, None, None])
        self.assertEqual(rows[0][0], '0001')
        self.assertEqual(rows[0][1], store_rows()[0]['상호명'])
        self.assertEqual(rows[0][2], 'NA')
        self.assertEqual(rows[0][7:11], ('I21201', '카페', 'I56229', '기타 비알코올'))
        self.assertEqual(rows[0][12], '01110')
        self.assertEqual(rows[0][14], '00110515')
        self.assertEqual(rows[0][19], store_rows()[0]['도로명주소'])
        self.assertEqual(rows[0][-1], 'SRID=4326;POINT(127.0 37.5)')
        self.assertIsNone(rows[2][-1])
        self.assertEqual(rows[3][-3:], (127.2, None, None))
        self.conn.commit.assert_not_called()

    def test_mapping_is_read_once_before_truncate_for_all_chunks(self):
        with patch.object(etl_stores, 'load_industry_map', wraps=load_industry_map, create=True) as mapping:
            self.run_loader(chunk_size=1)
        self.assertEqual(mapping.call_count, 1)
        statements = [str(call.args[0]) for call in self.cursor.execute.call_args_list]
        mapping_index = next(i for i, q in enumerate(statements) if 'industry_mappings' in q)
        cafe_index = next(i for i, q in enumerate(statements) if "code = 'CAFE'" in q)
        truncate_index = next(i for i, q in enumerate(statements) if 'TRUNCATE stores' in q)
        self.assertLess(mapping_index, truncate_index)
        self.assertLess(cafe_index, truncate_index)
        self.assertEqual(sum('industry_mappings' in q for q in statements), 1)
        self.assertEqual(sum("code = 'CAFE'" in q for q in statements), 1)

    def test_missing_cafe_mapping_and_conflicting_mapping_fail_before_writes(self):
        for case in ['missing cafe', 'missing mapping', 'wrong mapping']:
            with self.subTest(case=case):
                self.conn, self.cursor, self.catalog = mapped_mock_connection()
                if case == 'missing cafe':
                    self.cursor.fetchone.return_value = None
                elif case == 'missing mapping':
                    self.cursor.fetchall.return_value = self.cursor.fetchall.return_value[1:]
                else:
                    self.cursor.fetchall.return_value[0]['industry_id'] = self.catalog['PUB']
                with self.assertRaisesRegex(ValueError, 'CAFE|SEMAS'):
                    self.run_loader()
                self.assertFalse(any('TRUNCATE' in str(c.args[0]) for c in self.cursor.execute.call_args_list))
                self.cursor.copy.assert_not_called()
                self.conn.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
