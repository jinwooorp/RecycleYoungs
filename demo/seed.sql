\set ON_ERROR_STOP on
\set QUIET on
BEGIN;
SET LOCAL search_path TO pg_temp, public;
SET LOCAL lock_timeout TO '10s';

-- 전용 DB·계정·서버 표시를 모두 확인한 뒤에만 데이터를 검사합니다.
DO $$
BEGIN
    IF current_database() <> 'recycleyoungs_demo'
        OR current_user <> 'recycleyoungs_demo'
        OR inet_server_addr() IS NOT NULL
        OR current_setting('recycleyoungs.demo_fixture', true) IS DISTINCT FROM 'on'
    THEN
        RAISE EXCEPTION 'Demo 전용 PostGIS가 아닙니다. 쓰기 전에 중단합니다.';
    END IF;

    IF to_regclass('public.flyway_schema_history') IS NULL THEN
        RAISE EXCEPTION 'Demo DB에 Flyway 마이그레이션 이력이 없습니다.';
    END IF;
    IF (SELECT array_agg(version::text ORDER BY installed_rank)
        FROM public.flyway_schema_history WHERE version IS NOT NULL AND success)
            IS DISTINCT FROM ARRAY['1', '2', '3', '4', '5', '6', '7']
        OR EXISTS (SELECT FROM public.flyway_schema_history WHERE NOT success)
    THEN
        RAISE EXCEPTION 'Demo DB의 Flyway V1~V7 상태가 예상과 다릅니다.';
    END IF;
END $$;

-- 동시에 실행한 seed를 직렬화합니다. 조회는 트랜잭션이 완료된 스냅샷만 봅니다.
LOCK TABLE etl_batch, district, administrative_dong, service_industry, cafe_store,
    district_store_stat, district_sales_stat, district_foot_traffic_stat,
    dong_store_stat, dong_sales_stat, dong_foot_traffic_stat
    IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE demo_batches (LIKE etl_batch INCLUDING DEFAULTS) ON COMMIT DROP;
INSERT INTO demo_batches (
    batch_id, dataset_code, source_type, scope_type, period_from, period_to,
    source_reference, etl_version, status, expected_rows, fetched_rows, valid_rows,
    started_at, finished_at, published_at
)
SELECT ('f17e0000-0000-4000-8000-' || lpad(slot::text, 12, '0'))::uuid,
    dataset_code, source_type, 'SEOUL',
    CASE WHEN quarterly THEN '20261' END, CASE WHEN quarterly THEN '20262' END,
    (jsonb_build_object('fixture', 'recycleyoungs-demo-v1', 'synthetic', true)
        || CASE WHEN dataset_code = 'SEMAS_CAFE_STORE' THEN
            '{"collection_mode":"FULL_SEOUL","complete":true,"classification_verified":true}'::jsonb
        ELSE '{}'::jsonb END)::text,
    'recycleyoungs-demo-v1', 'PUBLISHED', row_count, row_count, row_count,
    TIMESTAMPTZ '2026-07-01 00:00:00+00', TIMESTAMPTZ '2026-07-01 00:00:00+00',
    TIMESTAMPTZ '2026-07-01 00:00:00+00'
FROM (VALUES
    (1, 'SEOUL_DONG_BOUNDARY',       'SHAPEFILE', false, 2),
    (2, 'SEOUL_SERVICE_INDUSTRY',    'CSV',       false, 1),
    (3, 'SEMAS_CAFE_STORE',          'API',       false, 5),
    (4, 'SEOUL_DISTRICT_STORE_STAT', 'CSV',       true,  2),
    (5, 'SEOUL_DISTRICT_SALES_STAT', 'CSV',       true,  2),
    (6, 'SEOUL_DISTRICT_FOOT_TRAFFIC_STAT', 'CSV', true,  2),
    (7, 'SEOUL_DONG_STORE_STAT',     'CSV',       true,  2),
    (8, 'SEOUL_DONG_SALES_STAT',     'CSV',       true,  2),
    (9, 'SEOUL_DONG_FOOT_TRAFFIC_STAT', 'CSV',    true,  2)
) AS fixture(slot, dataset_code, source_type, quarterly, row_count);

-- 모든 조회용 행은 etl_batch를 참조합니다. 빈 DB 또는 동일 fixture만 허용합니다.
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM etl_batch b
        LEFT JOIN demo_batches expected USING (batch_id)
        WHERE expected.batch_id IS NULL
            OR to_jsonb(b) - 'source_checksum' IS DISTINCT FROM
                to_jsonb(expected) - 'source_checksum'
    ) OR ((SELECT count(*) FROM etl_batch) NOT IN (0, (SELECT count(*) FROM demo_batches)))
    THEN
        RAISE EXCEPTION 'Demo 외부 배치 또는 불완전한 fixture가 있어 쓰기 전에 중단합니다.';
    END IF;
END $$;

SELECT NOT EXISTS (SELECT FROM etl_batch) AS demo_empty \gset
\if :demo_empty
INSERT INTO etl_batch SELECT * FROM demo_batches;

INSERT INTO district (district_code, district_name, geom, boundary_batch_id)
SELECT '99001', '[Demo 합성] 예시구',
    ST_Multi(ST_MakeEnvelope(126.96, 37.52, 127.08, 37.64, 4326)), batch_id
FROM demo_batches WHERE dataset_code = 'SEOUL_DONG_BOUNDARY';

INSERT INTO administrative_dong
    (dong_code, district_code, dong_name, geom, label_point, area_m2, boundary_batch_id)
SELECT '99001001', '99001', '[Demo 합성] 예시동', geom,
    ST_PointOnSurface(geom), round(ST_Area(geom::geography))::bigint, batch_id
FROM demo_batches
CROSS JOIN (SELECT ST_Multi(ST_MakeEnvelope(126.985, 37.54, 127.045, 37.60, 4326)) AS geom) AS shapes
WHERE dataset_code = 'SEOUL_DONG_BOUNDARY';

-- 앱의 고정 업종 코드만 공유합니다. 이름, 도형, 측정값은 모두 합성입니다.
INSERT INTO service_industry (industry_code, industry_name, source_batch_id)
SELECT 'CS100010', '[Demo 합성] 카페 업종', batch_id
FROM demo_batches WHERE dataset_code = 'SEOUL_SERVICE_INDUSTRY';

-- 두 후보의 500m·1,000m 반경에서 다른 결과를 보여줄 합성 카페입니다.
INSERT INTO cafe_store
    (bizes_id, store_name, semas_industry_code, semas_industry_name,
     source_dong_code, dong_code, geom, source_batch_id)
SELECT cafe_id, '[Demo 합성] 카페 ' || right(cafe_id, 1), 'D0001', '[Demo 합성] 카페 업종',
    '99001001', '99001001', ST_SetSRID(ST_MakePoint(longitude, 37.57), 4326), batch_id
FROM demo_batches
CROSS JOIN (VALUES
    ('DEMO-CAFE-1', 127.001), ('DEMO-CAFE-2', 127.004), ('DEMO-CAFE-3', 127.008),
    ('DEMO-CAFE-4', 127.031), ('DEMO-CAFE-5', 127.038)
) AS cafes(cafe_id, longitude)
WHERE dataset_code = 'SEMAS_CAFE_STORE';

INSERT INTO district_store_stat
    (district_code, industry_code, quarter_code, store_count, general_store_count,
     franchise_store_count, opened_store_count, closed_store_count, opening_rate, closure_rate, source_batch_id)
SELECT '99001', 'CS100010', stats.*, batch_id
FROM demo_batches CROSS JOIN (VALUES
    ('20261', 120, 100, 20, 4, 2, 3.33, 1.67),
    ('20262', 132, 108, 24, 5, 3, 3.79, 2.27)
) AS stats(quarter, total, general, franchise, opened, closed, opening_rate, closure_rate)
WHERE dataset_code = 'SEOUL_DISTRICT_STORE_STAT';

INSERT INTO dong_store_stat
    (dong_code, industry_code, quarter_code, store_count, general_store_count,
     franchise_store_count, opened_store_count, closed_store_count, opening_rate, closure_rate, source_batch_id)
SELECT '99001001', 'CS100010', stats.*, batch_id
FROM demo_batches CROSS JOIN (VALUES
    ('20261', 28, 25, 3, 2, 1, 7.14, 3.57),
    ('20262', 33, 29, 4, 3, 2, 9.09, 6.06)
) AS stats(quarter, total, general, franchise, opened, closed, opening_rate, closure_rate)
WHERE dataset_code = 'SEOUL_DONG_STORE_STAT';

INSERT INTO district_sales_stat
    (district_code, industry_code, quarter_code, monthly_sales_amount, monthly_sales_count,
     weekday_sales_amount, weekend_sales_amount, source_batch_id)
SELECT '99001', 'CS100010', stats.*, batch_id
FROM demo_batches CROSS JOIN (VALUES
    ('20261', 160000000, 14000, 110000000, 50000000),
    ('20262', 176000000, 15100, 121000000, 55000000)
) AS stats(quarter, amount, sales, weekdays, weekends)
WHERE dataset_code = 'SEOUL_DISTRICT_SALES_STAT';

INSERT INTO dong_sales_stat
    (dong_code, industry_code, quarter_code, monthly_sales_amount, monthly_sales_count,
     weekday_sales_amount, weekend_sales_amount, source_batch_id)
SELECT '99001001', 'CS100010', stats.*, batch_id
FROM demo_batches CROSS JOIN (VALUES
    ('20261', 48000000, 3900, 32000000, 16000000),
    ('20262', 54000000, 4200, 36000000, 18000000)
) AS stats(quarter, amount, sales, weekdays, weekends)
WHERE dataset_code = 'SEOUL_DONG_SALES_STAT';

INSERT INTO district_foot_traffic_stat
    (district_code, quarter_code, total_foot_traffic, male_foot_traffic, female_foot_traffic, source_batch_id)
SELECT '99001', stats.*, batch_id
FROM demo_batches CROSS JOIN (VALUES
    ('20261', 210000.25, 100000.10, 110000.15),
    ('20262', 231000.50, 111000.25, 120000.25)
) AS stats(quarter, total, male, female)
WHERE dataset_code = 'SEOUL_DISTRICT_FOOT_TRAFFIC_STAT';

INSERT INTO dong_foot_traffic_stat
    (dong_code, quarter_code, total_foot_traffic, male_foot_traffic, female_foot_traffic, source_batch_id)
SELECT '99001001', stats.*, batch_id
FROM demo_batches CROSS JOIN (VALUES
    ('20261', 41000.25, 20000.10, 21000.15),
    ('20262', 45000.50, 22000.25, 23000.25)
) AS stats(quarter, total, male, female)
WHERE dataset_code = 'SEOUL_DONG_FOOT_TRAFFIC_STAT';
\endif

-- 모든 저장 컬럼을 테이블명·행 순으로 정렬한 JSONB의 SHA-256입니다.
-- source_type과 카페 메타데이터는 Repository 계약값이며 실제 원천은 위 fixture로 표시합니다.
CREATE TEMP VIEW demo_fingerprints AS
WITH rows AS (
    SELECT boundary_batch_id AS batch_id, 'district' AS relation, to_jsonb(t) AS payload FROM district t
    UNION ALL SELECT boundary_batch_id, 'administrative_dong', to_jsonb(t) FROM administrative_dong t
    UNION ALL SELECT source_batch_id, 'service_industry', to_jsonb(t) FROM service_industry t
    UNION ALL SELECT source_batch_id, 'cafe_store', to_jsonb(t) FROM cafe_store t
    UNION ALL SELECT source_batch_id, 'district_store_stat', to_jsonb(t) FROM district_store_stat t
    UNION ALL SELECT source_batch_id, 'district_sales_stat', to_jsonb(t) FROM district_sales_stat t
    UNION ALL SELECT source_batch_id, 'district_foot_traffic_stat', to_jsonb(t) FROM district_foot_traffic_stat t
    UNION ALL SELECT source_batch_id, 'dong_store_stat', to_jsonb(t) FROM dong_store_stat t
    UNION ALL SELECT source_batch_id, 'dong_sales_stat', to_jsonb(t) FROM dong_sales_stat t
    UNION ALL SELECT source_batch_id, 'dong_foot_traffic_stat', to_jsonb(t) FROM dong_foot_traffic_stat t
)
SELECT batch_id, count(*) AS row_count,
    encode(sha256(convert_to(
        jsonb_agg(jsonb_build_array(relation, payload) ORDER BY relation, payload)::text, 'UTF8'
    )), 'hex') AS checksum
FROM rows GROUP BY batch_id;

\if :demo_empty
UPDATE etl_batch b SET source_checksum = f.checksum
FROM demo_fingerprints f WHERE b.batch_id = f.batch_id;
\endif

DO $$
BEGIN
    IF EXISTS (
        SELECT FROM etl_batch b FULL JOIN demo_fingerprints f USING (batch_id)
        WHERE b.valid_rows IS DISTINCT FROM f.row_count
            OR b.source_checksum::text IS DISTINCT FROM f.checksum
    ) THEN
        RAISE EXCEPTION 'Demo 배치의 저장 행 수 또는 체크섬이 달라 롤백합니다.';
    END IF;
END $$;

SELECT dataset_code, status, valid_rows, source_checksum FROM etl_batch ORDER BY dataset_code;
COMMIT;
\if :demo_empty
\echo '합성 Demo fixture를 적재했습니다.'
\else
\echo '기존 Demo fixture의 행 수와 SHA-256이 일치합니다.'
\endif
