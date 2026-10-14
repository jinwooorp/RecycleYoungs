"""Read-only SQL/HTTP cross-checks against the immutable real-data demo."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import time
import urllib.error
import urllib.request

from demo_safety import require

CANDIDATES = [('서울시청', 37.5665, 126.9780), ('홍대입구', 37.5563, 126.9238), ('성수', 37.5445, 127.0557)]


def request(owner, path):
    start = time.perf_counter()
    try:
        with urllib.request.urlopen('http://ry-demo-api-' + owner + ':8080' + path, timeout=35) as response:
            status, value = response.status, json.load(response)
    except urllib.error.HTTPError as failure:
        status, value = failure.code, json.load(failure)
    return status, value, round((time.perf_counter() - start) * 1000, 3)


def location_reference(connection, lat, lng):
    from app.spatial_load import LAYOUTS
    result = {}
    for kind in ('ADMIN_DONG', 'COMMERCIAL_AREA'):
        table, code, name, _ = LAYOUTS[kind]
        attributes = 'b.source_attribute_status,b.source_attribute_detail,' if kind == 'COMMERCIAL_AREA' else ''
        query = 'SELECT b.' + code + ' AS code,b.' + name + ' AS name,' + attributes + "b.dataset_version_id,b.quality_status,b.quality_detail,CASE WHEN ST_Touches(b.operational_geometry,ST_Transform(ST_SetSRID(ST_MakePoint(%s,%s),4326),5181)) THEN 'BOUNDARY' ELSE 'INTERIOR' END AS relation FROM " + table + ' b JOIN spatial_dataset_versions v ON v.id=b.dataset_version_id WHERE v.is_current AND v.load_status=\'READY\' AND ST_Covers(b.operational_geometry,ST_Transform(ST_SetSRID(ST_MakePoint(%s,%s),4326),5181)) ORDER BY b.' + code
        result[kind] = list(connection.execute(query, (lng, lat, lng, lat)))
    return result


def resolution_policy(expected, actual):
    rows = expected['ADMIN_DONG']
    admin = actual['adminDong']
    status = 'OUTSIDE_OR_UNSUPPORTED' if not rows else 'RESOLVED' if len(rows) == 1 else 'AMBIGUOUS_BOUNDARY'
    require(admin['status'] == status and admin['reason'] == ('NO_COVERING_OPERATIONAL_BOUNDARY' if not rows else None),
            'Admin resolution status/reason mismatch')
    require((admin['resolvedDong'] is not None) == (len(rows) == 1)
            and len(admin['candidates']) == (len(rows) if len(rows) > 1 else 0), 'Admin resolution structure mismatch')
    require(actual['commercialArea']['status'] == ('MEMBERSHIP' if expected['COMMERCIAL_AREA'] else 'NO_MEMBERSHIP'),
            'Commercial resolution status mismatch')


def check_location(connection, owner, label, lat, lng):
    expected = location_reference(connection, lat, lng)
    status, actual, elapsed = request(owner, f'/api/locations/resolve?lat={lat}&lng={lng}')
    require(status == 200, 'Real location HTTP failed: ' + label)
    require(actual['coordinate'] == dict(lat=lat, lng=lng), 'Location response coordinate mismatch')
    resolution_policy(expected, actual)
    admin = actual['adminDong']
    rows = expected['ADMIN_DONG']
    expected_codes = [r['code'] for r in rows]
    actual_dongs = [admin['resolvedDong']] if admin['resolvedDong'] else admin['candidates']
    require(sorted(d['code'] for d in actual_dongs) == expected_codes, 'Admin SQL/HTTP membership mismatch')
    if len(rows) > 1:
        require(admin['resolvedDong'] is None, 'Ambiguous admin membership was selected')
    for d, r in zip(sorted(actual_dongs, key=lambda d: d['code']), rows):
        require((d['name'], d['datasetVersion'], d['qualityStatus'], d['qualityDetail'], d['pointRelation']) ==
                (r['name'], str(r['dataset_version_id']), r['quality_status'], r['quality_detail'], r['relation']), 'Admin detail mismatch')
    memberships = actual['commercialArea']['memberships']
    require(sorted(d['code'] for d in memberships) == [r['code'] for r in expected['COMMERCIAL_AREA']],
            'Commercial SQL/HTTP membership mismatch')
    for d, r in zip(sorted(memberships, key=lambda d: d['code']), expected['COMMERCIAL_AREA']):
        require((d['name'], d['datasetVersion'], d['qualityStatus'], d['qualityDetail'], d['pointRelation'],
                 d['sourceAttributeStatus'], d['sourceAttributeDetail']) ==
                (r['name'], str(r['dataset_version_id']), r['quality_status'], r['quality_detail'], r['relation'],
                 r['source_attribute_status'], r['source_attribute_detail']), 'Commercial detail/attribute mismatch')
    for dataset in [admin['dataset'], actual['commercialArea']['dataset']]:
        require(dataset['referenceDateVerified'] is False and dataset['historicalCompatibilityStatus'] == 'UNRESOLVED',
                'Unverified date/history was promoted')
    return dict(label=label, lat=lat, lng=lng, admin_codes=expected_codes,
                admin_status=admin['status'], admin_relations=[r['relation'] for r in rows],
                commercial_codes=[d['code'] for d in memberships], http_ms=elapsed,
                commercial_attribute_statuses=[d['sourceAttributeStatus'] for d in memberships],
                sql_http_equal=True, versions=[admin['dataset']['version'], actual['commercialArea']['dataset']['version']])


def cafes(connection, lat, lng):
    # Full classified source scan and spheroid distance: independent of API bbox/ST_DWithin candidates.
    return list(connection.execute("""WITH distances AS MATERIALIZED (
        SELECT source_store_id,name,ST_X(location) AS lng,ST_Y(location) AS lat,
          ST_Distance(ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography,location::geography,true) AS meters
        FROM stores WHERE source_small_category_code='I21201'
          AND industry_id=(SELECT id FROM industries WHERE code='CAFE') AND location IS NOT NULL)
        SELECT * FROM distances WHERE meters<=500 ORDER BY meters,source_store_id COLLATE "C"
        """, (lng, lat)))


def check_cafes(connection, owner, label, lat, lng):
    expected = cafes(connection, lat, lng)
    status, actual, elapsed = request(owner, f'/api/nearby-stores?lat={lat}&lng={lng}&radius=500&industryCode=CAFE')
    require(status == 200 and actual['totalCount'] == str(len(expected)) and actual['listedCount'] == min(100, len(expected)),
            'Cafe SQL/HTTP count mismatch')
    require(actual['industryCode'] == 'CAFE' and actual['radiusMeters'] == 500 and actual['data']['snapshotStatus'] == 'UNVERIFIED',
            'Cafe scope/snapshot changed')
    require(actual['coordinate'] == dict(lat=lat, lng=lng) and actual['data']['source'] == 'SEMAS'
            and actual['data']['sourceCategoryCode'] == 'I21201' and actual['data']['availability'] == 'AVAILABLE_RECORDS'
            and actual['data']['referenceDate'] is None and actual['data']['loadedAt'] is None, 'Cafe provenance mismatch')
    require(actual['listComplete'] == (len(expected) <= 100), 'Cafe list completeness mismatch')
    require(actual['listLimit'] == 100 and len(actual['stores']) == actual['listedCount'], 'Cafe list size/limit mismatch')
    ids = []
    for row, store in zip(expected[:100], actual['stores']):
        require(store['sourceStoreId'] == row['source_store_id'] and store['name'] == row['name']
                and abs(store['distanceMeters'] - row['meters']) < 0.000001
                and store['distanceMeters'] <= 500 and store['coordinate'] == dict(lat=row['lat'], lng=row['lng']),
                'Cafe list/coordinate/distance mismatch')
        ids.append(store['sourceStoreId'])
    require(len(ids) == len(set(ids)) == actual['listedCount'], 'Cafe list duplicate/length mismatch')
    return dict(label=label, lat=lat, lng=lng, total=len(expected), listed=len(ids),
                nearest_source_ids=ids[:3], nearest_distance_m=expected[0]['meters'] if expected else None,
                furthest_listed_distance_m=expected[min(100, len(expected)) - 1]['meters'] if expected else None,
                source_id_list_sha256=hashlib.sha256('\n'.join(ids).encode()).hexdigest(),
                sql_http_equal=True, http_ms=elapsed, snapshot_status='UNVERIFIED')


def check_stats(connection, owner, dong, quarter):
    status, actual, elapsed = request(owner, f'/api/admin-dong-stats?dongCode={dong}&industryCode=CAFE&quarterCode={quarter}')
    require(status == 200, 'Real stats HTTP failed')
    require(actual['dong']['code'] == dong and actual['industry']['code'] == 'CAFE'
            and actual['quarter']['code'] == str(quarter), 'Stats response scope mismatch')
    store = connection.execute('SELECT store_count,similar_store_count,opening_store_count,closing_store_count,franchise_store_count FROM store_stats_dong WHERE dong_code=%s AND quarter_code=%s AND source_industry_code=\'CS100010\'', (dong, quarter)).fetchone()
    sales = connection.execute('SELECT sales_amount,transaction_count,weekday_sales_amount,weekend_sales_amount FROM sales_dong WHERE dong_code=%s AND quarter_code=%s AND source_industry_code=\'CS100010\'', (dong, quarter)).fetchone()
    expected_store = dict(zip(['storeCount', 'similarStoreCount', 'openingStoreCount', 'closingStoreCount', 'franchiseStoreCount'], store.values())) if store else None
    expected_sales = dict(zip(['estimatedSalesAmount', 'transactionCount', 'weekdayEstimatedSalesAmount', 'weekendEstimatedSalesAmount'], [str(v) if v is not None else None for v in sales.values()])) if sales else None
    require(actual['storeStats'] == expected_store and actual['salesStats'] == expected_sales, 'Full displayed stats SQL/HTTP mismatch')
    return dict(dong=dong, quarter=str(quarter), store=expected_store, sales=expected_sales,
                sql_http_equal=True, http_ms=elapsed)


def special_points(connection):
    cases = []
    expressions = [
        ('no-commercial', "SELECT ST_PointOnSurface(a.operational_geometry) AS geom FROM admin_dong_boundaries a JOIN spatial_dataset_versions v ON v.id=a.dataset_version_id WHERE v.is_current AND NOT EXISTS (SELECT 1 FROM commercial_area_boundaries c JOIN spatial_dataset_versions w ON w.id=c.dataset_version_id WHERE w.is_current AND ST_Covers(c.operational_geometry,ST_PointOnSurface(a.operational_geometry))) LIMIT 1"),
        ('commercial-multiple', "SELECT ST_PointOnSurface(ST_Intersection(a.operational_geometry,b.operational_geometry)) AS geom FROM commercial_area_boundaries a JOIN commercial_area_boundaries b ON a.dataset_version_id=b.dataset_version_id AND a.id<b.id JOIN spatial_dataset_versions v ON v.id=a.dataset_version_id WHERE v.is_current AND ST_Intersects(a.operational_geometry,b.operational_geometry) AND ST_Area(ST_Intersection(a.operational_geometry,b.operational_geometry))>0 ORDER BY ST_Area(ST_Intersection(a.operational_geometry,b.operational_geometry)) DESC LIMIT 1"),
        ('admin-overlap', "SELECT ST_PointOnSurface(ST_Intersection(a.operational_geometry,b.operational_geometry)) AS geom FROM admin_dong_boundaries a JOIN admin_dong_boundaries b ON a.dataset_version_id=b.dataset_version_id AND a.id<b.id JOIN spatial_dataset_versions v ON v.id=a.dataset_version_id WHERE v.is_current AND ST_Intersects(a.operational_geometry,b.operational_geometry) AND ST_Area(ST_Intersection(a.operational_geometry,b.operational_geometry))>0 ORDER BY ST_Area(ST_Intersection(a.operational_geometry,b.operational_geometry)) DESC LIMIT 1"),
        ('source-boundary-roundtrip', "SELECT ST_PointN(ST_ExteriorRing(ST_GeometryN(operational_geometry,1)),1) AS geom FROM admin_dong_boundaries ORDER BY id LIMIT 1"),
        ('real-hole', "SELECT ST_PointOnSurface(ST_MakePolygon(ST_InteriorRingN(ST_GeometryN(operational_geometry,1),1))) AS geom FROM commercial_area_boundaries WHERE quality_status='REPAIRED_OPERATIONAL' ORDER BY id LIMIT 1"),
        ('hongjimun-H5', "SELECT ST_PointOnSurface(operational_geometry) AS geom FROM commercial_area_boundaries WHERE commercial_area_code='3110531' LIMIT 1")]
    for label, expression in expressions:
        row = connection.execute('WITH p AS (' + expression + ') SELECT ST_Y(ST_Transform(geom,4326)) AS lat,ST_X(ST_Transform(geom,4326)) AS lng FROM p').fetchone()
        if row:
            cases.append((label, row['lat'], row['lng']))
    return cases


def run_checks(connection, owner):
    locations, nearby, stats = [], [], []
    for label, lat, lng in CANDIDATES:
        location = check_location(connection, owner, label, lat, lng)
        require(len(location['admin_codes']) == 1, 'Demo candidate admin unresolved')
        locations.append(location)
        nearby.append(check_cafes(connection, owner, label, lat, lng))
        for quarter in (20254, 20253):
            stats.append(check_stats(connection, owner, location['admin_codes'][0], quarter))
    require(len(set(row['admin_codes'][0] for row in locations)) == 3, 'Candidates must use different admin dongs')
    for label, lat, lng in special_points(connection):
        locations.append(check_location(connection, owner, label, lat, lng))
    outside = request(owner, '/api/locations/resolve?lat=35.1796&lng=129.0756')
    require(outside[0] == 200, 'Outside coordinate HTTP failed')
    resolution_policy({'ADMIN_DONG': [], 'COMMERCIAL_AREA': []}, outside[1])
    validations = []
    for path, status in [('/api/locations/resolve?lat=999&lng=126.978', 400),
                         ('/api/locations/resolve?lat=37.5&lng=127&lat=37.6', 400),
                         ('/api/nearby-stores?lat=37.5&lng=127&radius=501&industryCode=CAFE', 400)]:
        actual_status, value, elapsed = request(owner, path)
        require(actual_status == status, 'Invalid request HTTP policy mismatch')
        validations.append(dict(status=actual_status, code=value['code'], http_ms=elapsed))
    nearby.append(check_cafes(connection, owner, 'zero-away-from-Seoul', 35.1796, 129.0756))
    paths = [f'/api/nearby-stores?lat={lat}&lng={lng}&radius=500&industryCode=CAFE' for _, lat, lng in CANDIDATES]
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=3) as pool:
        parallel = list(pool.map(lambda p: request(owner, p), paths))
    require(all(r[0] == 200 for r in parallel), 'Three parallel real requests failed')
    return dict(locations=locations, nearby=nearby, stats=stats, invalid_requests=validations,
                outside=dict(status=outside[0], admin_status=outside[1].get('adminDong', {}).get('status')),
                three_parallel_nearby=dict(total_ms=round((time.perf_counter()-started)*1000, 3),
                                           per_request_ms=[r[2] for r in parallel]),
                special_case_policy='Real source points; 4326 roundtrip boundary relation reported without snapping',
                browser_flow='separately verified; no HTTP check substitutes for browser E2E')
