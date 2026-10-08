"""8-C1 actual Polygon catalog inventory, fixed-source probes and planner checks."""
import argparse
import json
from pathlib import Path
import sys

import shapely
from shapely.geometry import Point,Polygon

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.spatial_geometry import wkb_bytes
from integration_support import connect_isolated
from test_spatial_real import real_prepared


def verify(conn,root):
    result={'versions':[], 'schema':{}, 'probes':[], 'overlaps':[], 'plans':{}}
    with conn.cursor() as cur:
        cur.execute('SELECT version() AS postgresql,postgis_full_version() AS postgis')
        result['database_tools']=cur.fetchone()
        cur.execute('SELECT * FROM spatial_dataset_versions ORDER BY boundary_kind')
        result['versions']=cur.fetchall()
        if len(result['versions'])!=2 or any(v['load_status']!='READY' or not v['is_current'] or v['reference_date'] is not None or v['reference_date_verified'] or v['historical_compatibility_status']!='UNRESOLVED' or v['validation_status']!='PASSED_WITH_LIMITATIONS' for v in result['versions']):
            raise AssertionError('current READY/provenance/known limitation differs')
        cur.execute("SELECT c.relname AS table_name,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('industries','industry_mappings','commercial_areas','store_stats_dong','sales_dong','sales_commercial_area','stores','spatial_dataset_versions','admin_dong_boundaries','commercial_area_boundaries') ORDER BY c.relname,k.conname")
        result['schema']['constraints']=cur.fetchall()
        cur.execute("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename NOT IN ('spatial_ref_sys','flyway_schema_history') ORDER BY tablename,indexname")
        result['schema']['indexes']=cur.fetchall()
        cur.execute("SELECT tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname")
        result['schema']['triggers']=cur.fetchall()
        cur.execute("SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('guard_spatial_dataset_version','guard_spatial_boundary_write') ORDER BY proname")
        result['schema']['functions']=cur.fetchall()
    assert len(result['schema']['functions'])==2 and len(result['schema']['triggers'])==3
    tables={'admin':('admin_dong_boundaries','dong_code'), 'commercial':('commercial_area_boundaries','commercial_area_code')}
    datasets={key:real_prepared(root,key) for key in tables}
    # Same pinned bytes and independent Shapely point membership list; all candidates retained.
    def probe(key,label,point,required=None,excluded=None):
        table,code=tables[key]
        with conn.cursor() as cur:
            cur.execute(f"SELECT {code} AS code,ST_Contains(operational_geometry,ST_GeomFromWKB(%s,5181)) AS contains FROM {table} b JOIN spatial_dataset_versions v ON v.id=b.dataset_version_id WHERE v.is_current AND b.operational_geometry IS NOT NULL AND ST_Covers(b.operational_geometry,ST_GeomFromWKB(%s,5181)) ORDER BY {code}",(wkb_bytes(point),wkb_bytes(point)))
            matches=cur.fetchall()
        expected=sorted(f.code for f in datasets[key].features if shapely.from_wkb(f.operational_wkb).covers(point))
        assert [m['code'] for m in matches]==expected,(label,matches,expected)
        if required: assert required in expected,(label,'missing required membership')
        if excluded: assert excluded not in expected,(label,'hole incorrectly covered')
        record={'kind':key,'label':label,'point_5181':[point.x,point.y],'candidates':matches}
        result['probes'].append(record)
        return matches
    for key,dataset in datasets.items():
        f=min(dataset.features,key=lambda f:f.code)
        g=shapely.from_wkb(f.operational_wkb)
        probe(key,'fixed-source interior '+f.code,g.representative_point(),required=f.code)
        matches=probe(key,'exact source exterior vertex '+f.code,Point(g.geoms[0].exterior.coords[0]),required=f.code)
        assert next(m for m in matches if m['code']==f.code)['contains'] is False
        assert probe(key,'zero membership fixed projected origin',Point(0,0))==[]
    for f in datasets['commercial'].features:
        if f.quality_status!='REPAIRED_OPERATIONAL': continue
        g=shapely.from_wkb(f.operational_wkb)
        ring=g.geoms[0].interiors[0]
        probe('commercial','accepted hole interior '+f.code,Polygon(ring).representative_point(),excluded=f.code)
        matches=probe('commercial','exact hole ring vertex '+f.code,Point(ring.coords[0]),required=f.code)
        assert next(m for m in matches if m['code']==f.code)['contains'] is False
    report=json.loads((Path(root)/'validation-results.json').read_text())
    expected_pairs={tuple(sorted((r['left_code'],r['right_code']))) for r in report['topology']['positive_area_overlaps']}
    with conn.cursor() as cur:
        cur.execute("""SELECT a.dong_code AS left_code,b.dong_code AS right_code,
          ST_Area(ST_Intersection(a.operational_geometry,b.operational_geometry)) AS area_m2,
          ST_X(ST_PointOnSurface(ST_Intersection(a.operational_geometry,b.operational_geometry))) AS x,
          ST_Y(ST_PointOnSurface(ST_Intersection(a.operational_geometry,b.operational_geometry))) AS y
          FROM admin_dong_boundaries a JOIN admin_dong_boundaries b ON a.dong_code<b.dong_code
          AND a.dataset_version_id=b.dataset_version_id AND a.operational_geometry && b.operational_geometry
          WHERE ST_Area(ST_Intersection(a.operational_geometry,b.operational_geometry))>0.0001
          ORDER BY a.dong_code,b.dong_code""")
        overlaps=cur.fetchall()
    assert {tuple(sorted((r['left_code'],r['right_code']))) for r in overlaps}==expected_pairs and len(overlaps)==13
    for r in overlaps:
        matches=probe('admin','known overlap '+r['left_code']+'/'+r['right_code'],Point(r['x'],r['y']))
        assert {r['left_code'],r['right_code']} <= {m['code'] for m in matches}
        result['overlaps'].append(r)
    # Do not assign meaning to commercial overlap. Search only to select a reproducible probe.
    with conn.cursor() as cur:
        cur.execute("""SELECT a.commercial_area_code AS left_code,b.commercial_area_code AS right_code,
          ST_X(ST_PointOnSurface(ST_Intersection(a.operational_geometry,b.operational_geometry))) AS x,
          ST_Y(ST_PointOnSurface(ST_Intersection(a.operational_geometry,b.operational_geometry))) AS y
          FROM commercial_area_boundaries a JOIN commercial_area_boundaries b ON a.commercial_area_code<b.commercial_area_code
          AND a.dataset_version_id=b.dataset_version_id AND a.operational_geometry && b.operational_geometry
          WHERE ST_Area(ST_Intersection(a.operational_geometry,b.operational_geometry))>0
          ORDER BY a.commercial_area_code,b.commercial_area_code LIMIT 1""")
        r=cur.fetchone()
    if r:
        matches=probe('commercial','overlap probe selection '+r['left_code']+'/'+r['right_code'],Point(r['x'],r['y']))
        assert {r['left_code'],r['right_code']} <= {m['code'] for m in matches}
    result['commercial_overlap_probe']=r
    with conn.cursor() as cur:
        cur.execute("SELECT source_sigungu_code,source_dong_code,source_attribute_status,source_attribute_detail FROM commercial_area_boundaries WHERE commercial_area_code='3110531'")
        result['h5']=cur.fetchone()
    assert (result['h5']['source_sigungu_code'],result['h5']['source_dong_code'],result['h5']['source_attribute_status'])==('11110','11410660','CONFLICT_OBSERVED') and 'H5' in result['h5']['source_attribute_detail']
    for key,(table,code) in tables.items():
        with conn.cursor() as cur:
            cur.execute(f'ANALYZE {table}')
            cur.execute(f"SELECT count(*) AS total, count(*) FILTER(WHERE quality_status='VALID_SOURCE') AS valid_source,count(*) FILTER(WHERE quality_status='REPAIRED_OPERATIONAL') AS repaired,count(*) FILTER(WHERE NOT ST_IsValid(source_geometry)) AS raw_invalid,bool_and(ST_SRID(source_geometry)=5181 AND ST_SRID(operational_geometry)=5181 AND ST_IsValid(operational_geometry) AND NOT ST_IsEmpty(operational_geometry) AND ST_GeometryType(operational_geometry)='ST_MultiPolygon' AND source_geometry_sha256=encode(sha256(ST_AsBinary(source_geometry,'NDR')),'hex') AND operational_geometry_sha256=encode(sha256(ST_AsBinary(operational_geometry,'NDR')),'hex')) AS geometry_hash_valid FROM {table}")
            summary=cur.fetchone()
            assert summary==({'total':425,'valid_source':425,'repaired':0,'raw_invalid':0,'geometry_hash_valid':True} if key=='admin' else {'total':1650,'valid_source':1644,'repaired':6,'raw_invalid':6,'geometry_hash_valid':True})
            result[key+'_summary']=summary
            cur.execute(f'SELECT ST_GeometryType(source_geometry) AS type,count(*) AS n FROM {table} GROUP BY 1 ORDER BY 1')
            source_types={r['type']:r['n'] for r in cur.fetchall()}
            assert source_types==({'ST_Polygon':425} if key=='admin' else {'ST_Polygon':1561,'ST_MultiPolygon':89})
            result[key+'_source_types']=source_types
        f=min(datasets[key].features,key=lambda f:f.code)
        point=shapely.from_wkb(f.operational_wkb).representative_point()
        query=f"EXPLAIN (FORMAT JSON) SELECT {code} FROM {table} WHERE operational_geometry IS NOT NULL AND ST_Covers(operational_geometry,ST_GeomFromWKB(%s,5181))"
        with conn.transaction(),conn.cursor() as cur:
            cur.execute(query,(wkb_bytes(point),)); normal=cur.fetchone()['QUERY PLAN']
            cur.execute('SET LOCAL enable_seqscan=off')
            cur.execute(query,(wkb_bytes(point),)); forced=cur.fetchone()['QUERY PLAN']
        expected_index='idx_admin_dong_boundaries_operational' if key=='admin' else 'idx_commercial_area_boundaries_operational'
        assert expected_index in json.dumps(forced),'operational GiST inaccessible'
        result['plans'][key]={'normal':normal,'isolated_seqscan_off':forced}
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dsn',required=True);p.add_argument('--proof',type=Path,required=True)
    p.add_argument('--spatial-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    with connect_isolated(a.dsn,json.loads(a.proof.read_text())) as conn:
        result=verify(conn,a.spatial_root)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,default=str)+'\n')
    print(f'[integration spatial probes] PASS {len(result["probes"])} samples,13 overlap pairs -> {a.output}')


if __name__=='__main__': main()
