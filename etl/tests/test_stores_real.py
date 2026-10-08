"""Heavy opt-in validation of the pinned 2026-06 CSV in a fresh isolated DB."""

from contextlib import redirect_stdout
import csv
import hashlib
from io import StringIO
import os
from pathlib import Path
import struct
import sys
import unittest

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import etl_stores


REAL_DSN = os.environ.get('STORES_REAL_DSN')
REAL_CSV = os.environ.get('STORES_REAL_CSV')
CSV_SHA = '08d3fd08b37840256cccd4f09bad6fc33133b647cbff05f22f26fc962cf84152'


@unittest.skipUnless(REAL_DSN and REAL_CSV, 'pinned CSV and fresh isolated STORES_REAL_DSN not provided')
class RealStoreTests(unittest.TestCase):
    def test_all_554092_rows_mapping_points_and_replay(self):
        path = Path(REAL_CSV)
        h = hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(4*1024*1024), b''):
                h.update(chunk)
        self.assertEqual(h.hexdigest(), CSV_SHA)
        if not psycopg.conninfo.conninfo_to_dict(REAL_DSN).get('dbname', '').startswith('recycleyoungs_stores_test_'):
            self.fail('Refusing non-isolated database before connection')
        conn = psycopg.connect(REAL_DSN, autocommit=True, row_factory=dict_row)
        self.addCleanup(conn.close)
        with conn.cursor() as cur:
            cur.execute('SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank')
            self.assertEqual([r['version'] for r in cur.fetchall()], ['1', '2', '3'])
            cur.execute('SELECT count(*) AS n FROM stores')
            self.assertEqual(cur.fetchone()['n'], 0, 'whole CSV test requires fresh empty stores')
            cur.execute("SELECT source_code FROM industry_mappings WHERE source='SEMAS'")
            self.assertEqual([r['source_code'] for r in cur.fetchall()], ['I21201'])
        digests = []
        for attempt in (1, 2):
            print(f'[real stores] load {attempt}/2 starting', flush=True)
            with conn.transaction():
                etl_stores.run(conn, path)
            with conn.cursor() as cur:
                cur.execute("""SELECT count(*) AS total,
                  count(*) FILTER(WHERE source_small_category_code='I21201') AS cafe_source,
                  count(*) FILTER(WHERE source_small_category_code='I21201' AND i.code='CAFE') AS cafe_mapped,
                  count(*) FILTER(WHERE source_small_category_code='I21201' AND s.industry_id IS NULL) AS cafe_null,
                  count(*) FILTER(WHERE source_small_category_code='I21201' AND i.code IS DISTINCT FROM 'CAFE') AS cafe_wrong,
                  count(*) FILTER(WHERE source_small_category_code IS DISTINCT FROM 'I21201' AND s.industry_id IS NOT NULL) AS other_mapped,
                  bool_and(ST_SRID(location)=4326 AND ST_GeometryType(location)='ST_Point') AS point_type
                  FROM stores s LEFT JOIN industries i ON i.id=s.industry_id""")
                summary = cur.fetchone()
            self.assertEqual(summary, {'total': 554092, 'cafe_source': 22739, 'cafe_mapped': 22739,
                                       'cafe_null': 0, 'cafe_wrong': 0, 'other_mapped': 0, 'point_type': True})
            expected = {}
            with path.open(encoding='utf-8-sig', newline='') as source:
                for row in csv.DictReader(source):
                    source_id = row['상가업소번호'].strip()
                    self.assertNotIn(source_id, expected)
                    expected[source_id] = (struct.pack('<BIdd', 1, 1, float(row['경도']), float(row['위도'])).hex(),
                                           'CAFE' if row['상권업종소분류코드'].strip() == 'I21201' else None)
            logical = hashlib.sha256()
            with conn.transaction(), conn.cursor(name=f'whole_stores_verify_{attempt}') as cur:
                cur.execute("""SELECT s.source_store_id,encode(ST_AsBinary(s.location,'NDR'),'hex') AS wkb,i.code AS industry_code,
                  encode(sha256(convert_to((to_jsonb(s)-'id'-'industry_id')::text || COALESCE(i.code,'<NULL>'),'UTF8')),'hex') AS row_hash
                  FROM stores s LEFT JOIN industries i ON i.id=s.industry_id ORDER BY s.source_store_id""")
                for row in cur:
                    self.assertEqual((row['wkb'], row['industry_code']), expected.pop(row['source_store_id']))
                    logical.update(row['source_store_id'].encode('utf-8'))
                    logical.update(bytes.fromhex(row['row_hash']))
            self.assertFalse(expected)
            digests.append(logical.hexdigest())
            print(f'[real stores] load {attempt}/2 PASS {summary}; logical SHA={digests[-1]}', flush=True)
        self.assertEqual(digests[0], digests[1])


if __name__ == '__main__':
    unittest.main()
