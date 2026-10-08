"""Explicit 8-C1 test worker. Isolation proof required; no DB defaults or downloads."""
import argparse
import csv
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import struct
import sys

from psycopg import sql
from pyproj import Transformer

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import etl_sales, etl_store_stats, etl_stores
from app.preflight import InputSpec, validate_input
from app.spatial_sources import SPECS
from integration_support import connect_isolated, load_v1_stores, snapshot, compare_preserved, compare_logical


def file_sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(4*1024*1024),b''):
            h.update(block)
    return h.hexdigest()


def verify_inputs(root,manifest):
    result={}
    for entry in json.loads(Path(manifest).read_text())['datasets']:
        path=Path(root)/entry['filename']
        if file_sha(path)!=entry['sha256'] or path.stat().st_size!=entry['bytes']:
            raise ValueError(f'CSV identity mismatch: {path.name}')
        spec=InputSpec(entry['dataset_id'],entry['filename'],entry['encoding'],tuple(entry['headers']),tuple(entry['candidate_key']))
        report=validate_input(root,spec)
        if report.rows!=entry['row_count']:
            raise ValueError(f'CSV row count differs: {path.name}')
        result[path.name]={'rows':report.rows,'sha256':entry['sha256'],'duplicate_keys':0}
    with (Path(root)/etl_stores.FILE).open(encoding='utf-8-sig',newline='') as f:
        cafe=sum(r['상권업종소분류코드']=='I21201' for r in csv.DictReader(f))
    if cafe!=22739:
        raise ValueError('pinned SEMAS I21201 count differs')
    result['I21201']=cafe
    return result


def text(value):
    return value.strip() or None


def integer(value):
    value=text(value)
    if value is None:
        return None
    d=Decimal(value)
    if not d.is_finite() or d!=d.to_integral_value():
        raise ValueError('source metric is not an exact integer')
    return int(d)


def expected_layout(table):
    if table=='store_stats_dong':
        mapping={'quarter_code':'기준_년분기_코드','dong_code':'행정동_코드','dong_name':'행정동_코드_명',
                 'source_industry_code':'서비스_업종_코드','source_industry_name':'서비스_업종_코드_명',
                 'store_count':'점포_수','similar_store_count':'유사_업종_점포_수','opening_rate':'개업_율',
                 'opening_store_count':'개업_점포_수','closing_rate':'폐업_률','closing_store_count':'폐업_점포_수','franchise_store_count':'프랜차이즈_점포_수'}
        return etl_store_stats.FILE,mapping
    if table in ('sales_dong','sales_commercial_area'):
        mapping={'quarter_code':'기준_년분기_코드'}
        mapping.update({'dong_code':'행정동_코드','dong_name':'행정동_코드_명'} if table=='sales_dong'
                       else {'commercial_area_code':'상권_코드','commercial_area_name':'상권_코드_명'})
        mapping.update(source_industry_code='서비스_업종_코드',source_industry_name='서비스_업종_코드_명')
        mapping.update({dst:src for src,dst in etl_sales.SALES_AMOUNT_FIELDS+etl_sales.TRANSACTION_FIELDS})
        return (etl_sales.FILE_DONG if table=='sales_dong' else etl_sales.FILE_AREA),mapping
    if table=='stores':
        columns=[c for c in etl_stores.COLUMNS if c not in ('industry_id','location')]
        return etl_stores.FILE,dict(zip(columns,etl_stores.USECOLS))
    return '서울시 상권분석서비스(영역-상권).csv',{
        'commercial_area_code':'상권_코드','area_type_code':'상권_구분_코드','area_type_name':'상권_구분_코드_명',
        'name':'상권_코드_명','sigungu_code':'자치구_코드','sigungu_name':'자치구_코드_명','dong_code':'행정동_코드','dong_name':'행정동_코드_명',
        'area_m2':'영역_면적','x':'엑스좌표_값','y':'와이좌표_값'}


def verify_source(conn,root):
    """Independent csv/Decimal/struct expected values, SQL EXCEPT ALL, bounded COPY batches."""
    result={}
    transformer=Transformer.from_crs(5181,4326,always_xy=True)
    for table in ('commercial_areas','store_stats_dong','sales_dong','sales_commercial_area','stores'):
        filename,mapping=expected_layout(table)
        columns=list(mapping)
        actual=[f't.{c}' for c in columns]
        if table in ('stores','commercial_areas'):
            columns+=['location_ndr']
            actual+=["encode(ST_AsBinary(t.location,'NDR'),'hex') AS location_ndr"]
        if table!='commercial_areas':
            columns+=['industry_code']
            actual+=['i.code AS industry_code']
        join='' if table=='commercial_areas' else ' LEFT JOIN industries i ON i.id=t.industry_id'
        query=f"SELECT {','.join(actual)} FROM {table} t{join}"
        with conn.transaction(),conn.cursor() as cur:
            cur.execute(f'CREATE TEMP TABLE expected_source ON COMMIT DROP AS {query} WITH NO DATA')
            with (Path(root)/filename).open(encoding='utf-8-sig' if table=='stores' else 'cp949',newline='') as source:
                reader=csv.DictReader(source,strict=True)
                statement=sql.SQL('COPY expected_source ({}) FROM STDIN').format(sql.SQL(',').join(map(sql.Identifier,columns)))
                count=0
                with cur.copy(statement) as copy:
                    for row in reader:
                        values=[]
                        for dst,src in mapping.items():
                            value=text(row[src])
                            if dst in ('longitude','latitude','x','y'):
                                value=float(value) if value is not None else None
                            elif dst=='area_m2' or dst in ('opening_rate','closing_rate'):
                                value=Decimal(value) if value is not None else None
                            elif dst=='quarter_code' or dst.endswith(('_count','_sales','_amount','_transactions')) or dst in ('store_count','similar_store_count'):
                                value=integer(row[src])
                            values.append(value)
                        if table in ('stores','commercial_areas'):
                            if table=='stores':
                                lon,lat=(float(row[k]) if text(row[k]) is not None else None for k in ('경도','위도'))
                            else:
                                x,y=(float(row[k]) if text(row[k]) is not None else None for k in ('엑스좌표_값','와이좌표_값'))
                                lon,lat=transformer.transform(x,y,errcheck=True) if x is not None and y is not None else (None,None)
                            values.append(struct.pack('<BIdd',1,1,lon,lat).hex() if lon is not None and lat is not None else None)
                        if table!='commercial_areas':
                            code=text(row['상권업종소분류코드'] if table=='stores' else row['서비스_업종_코드'])
                            values.append(('CAFE' if code=='I21201' else None) if table=='stores' else
                                          {'CS100010':'CAFE','CS100001':'KFOOD','CS100009':'PUB','CS200028':'HAIR'}.get(code))
                        copy.write_row(values)
                        count+=1
            cur.execute(f'SELECT count(*) AS n FROM (({query} EXCEPT ALL SELECT * FROM expected_source) UNION ALL (SELECT * FROM expected_source EXCEPT ALL {query})) mismatch')
            mismatch=cur.fetchone()['n']
            if mismatch:
                raise AssertionError(f'{table} source row/metric/NULL/POINT mismatch: {mismatch}')
            result[table]={'source_rows':count,'mismatch_rows':0,'columns':columns}
    return result


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode',choices=('inputs','v1-stores','snapshot','source','compare-preserved','compare-logical'))
    p.add_argument('--dsn'); p.add_argument('--proof',type=Path)
    p.add_argument('--data-dir',type=Path); p.add_argument('--manifest',type=Path)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--spatial',action='store_true'); p.add_argument('--before',type=Path); p.add_argument('--after',type=Path)
    p.add_argument('--migrated',action='store_true')
    a=p.parse_args(argv)
    if a.mode=='inputs':
        result=verify_inputs(a.data_dir,a.manifest)
    elif a.mode.startswith('compare-'):
        before,after=(json.loads(path.read_text()) for path in (a.before,a.after))
        if a.mode=='compare-logical': compare_logical(before,after)
        else: compare_preserved(before,after,a.migrated)
        result={'comparison':a.mode,'passed':True}
    else:
        if not a.dsn or not a.proof: p.error('DB modes require explicit --dsn and Docker --proof')
        with connect_isolated(a.dsn,json.loads(a.proof.read_text())) as conn:
            if a.mode=='snapshot': result=snapshot(conn,a.spatial)
            elif a.mode=='source': result=verify_source(conn,a.data_dir)
            else:
                load_v1_stores(conn,a.data_dir/etl_stores.FILE)
                result={'test_only_v1_stores_loaded':True}
    a.output.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2,default=str)+'\n')
    print(f'[integration:{a.mode}] PASS -> {a.output}',flush=True)
    return 0


if __name__=='__main__':
    raise SystemExit(main())
