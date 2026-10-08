"""Synthetic CSV/mapping fixtures shared by unit and opt-in DB tests."""

import csv
from pathlib import Path
from unittest.mock import MagicMock

from app import etl_stores


def store_rows():
    return [
        {'상가업소번호': '0001', '상호명': 'Juice\t"NA"\n전통찻집', '지점명': 'NA',
         '상권업종대분류코드': 'I2', '상권업종대분류명': '음식',
         '상권업종중분류코드': 'I212', '상권업종중분류명': '비알코올 ',
         '상권업종소분류코드': 'I21201', '상권업종소분류명': '카페',
         '표준산업분류코드': 'I56229', '표준산업분류명': '기타 비알코올',
         '시군구코드': '01110', '행정동코드': '00110515', '도로명주소': '길\t1\n2\\N',
         '경도': '127.0', '위도': '37.5'},
        {'상가업소번호': '0002', '상호명': 'unmapped', '상권업종소분류코드': 'G20405',
         '상권업종소분류명': '편의점', '경도': '127.1', '위도': '37.6'},
        {'상가업소번호': '0003', '상호명': 'empty code', '상권업종소분류코드': ''},
        {'상가업소번호': '0004', '상호명': 'SEOUL only', '상권업종소분류코드': 'CS100010',
         '경도': '127.2', '위도': ''},
    ]


def write_store_csv(path, rows=None):
    path = Path(path)
    with path.open('w', encoding='utf-8-sig', newline='') as dest:
        writer = csv.DictWriter(dest, fieldnames=etl_stores.USECOLS)
        writer.writeheader()
        writer.writerows(store_rows() if rows is None else rows)
    return path


def mapped_mock_connection():
    # Allocate fixture IDs from inserted catalog rows; assertions never assume a CAFE number.
    catalog = {}
    for code in ['OTHER', 'CAFE', 'PUB']:
        catalog[code] = len(catalog) + 1
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = {'id': catalog['CAFE']}
    cursor.fetchall.return_value = [
        {'source': 'SEMAS', 'source_code': 'I21201', 'industry_id': catalog['CAFE']},
        {'source': 'SEOUL', 'source_code': 'CS100010', 'industry_id': catalog['CAFE']},
    ]
    return conn, cursor, catalog
