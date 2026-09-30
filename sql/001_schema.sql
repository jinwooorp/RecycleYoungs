CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS industries (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS industry_mappings (
    id BIGSERIAL PRIMARY KEY,
    source VARCHAR(30) NOT NULL,
    source_code VARCHAR(30) NOT NULL,
    industry_id BIGINT NOT NULL REFERENCES industries(id),
    UNIQUE (source, source_code)
);

CREATE TABLE IF NOT EXISTS commercial_areas (
    id BIGSERIAL PRIMARY KEY,
    commercial_area_code VARCHAR(20) NOT NULL UNIQUE,
    area_type_code VARCHAR(10),
    area_type_name VARCHAR(30),
    name VARCHAR(200) NOT NULL,
    sigungu_code VARCHAR(10),
    sigungu_name VARCHAR(50),
    dong_code VARCHAR(10),
    dong_name VARCHAR(50),
    area_m2 NUMERIC,
    x DOUBLE PRECISION,
    y DOUBLE PRECISION,
    location GEOMETRY(POINT, 4326)
);

CREATE INDEX IF NOT EXISTS idx_commercial_areas_location
    ON commercial_areas USING GIST(location);

CREATE INDEX IF NOT EXISTS idx_commercial_areas_dong_code
    ON commercial_areas(dong_code);

CREATE TABLE IF NOT EXISTS store_stats_dong (
    id BIGSERIAL PRIMARY KEY,
    quarter_code SMALLINT NOT NULL,
    dong_code VARCHAR(10) NOT NULL,
    dong_name VARCHAR(50) NOT NULL,
    source_industry_code VARCHAR(30) NOT NULL,
    source_industry_name VARCHAR(100),
    industry_id BIGINT REFERENCES industries(id),
    store_count INTEGER,
    similar_store_count INTEGER,
    opening_rate NUMERIC,
    opening_store_count INTEGER,
    closing_rate NUMERIC,
    closing_store_count INTEGER,
    franchise_store_count INTEGER,
    UNIQUE (quarter_code, dong_code, source_industry_code)
);

CREATE INDEX IF NOT EXISTS idx_store_stats_dong_lookup
    ON store_stats_dong(dong_code, source_industry_code, quarter_code);

CREATE TABLE IF NOT EXISTS sales_dong (
    id BIGSERIAL PRIMARY KEY,
    quarter_code SMALLINT NOT NULL,
    dong_code VARCHAR(10) NOT NULL,
    dong_name VARCHAR(50) NOT NULL,
    source_industry_code VARCHAR(30) NOT NULL,
    source_industry_name VARCHAR(100),
    industry_id BIGINT REFERENCES industries(id),

    sales_amount BIGINT,
    transaction_count BIGINT,
    weekday_sales_amount BIGINT,
    weekend_sales_amount BIGINT,

    mon_sales_amount BIGINT,
    tue_sales_amount BIGINT,
    wed_sales_amount BIGINT,
    thu_sales_amount BIGINT,
    fri_sales_amount BIGINT,
    sat_sales_amount BIGINT,
    sun_sales_amount BIGINT,

    time_00_06_sales BIGINT,
    time_06_11_sales BIGINT,
    time_11_14_sales BIGINT,
    time_14_17_sales BIGINT,
    time_17_21_sales BIGINT,
    time_21_24_sales BIGINT,

    male_sales BIGINT,
    female_sales BIGINT,

    age_10_sales BIGINT,
    age_20_sales BIGINT,
    age_30_sales BIGINT,
    age_40_sales BIGINT,
    age_50_sales BIGINT,
    age_60_plus_sales BIGINT,

    weekday_transactions BIGINT,
    weekend_transactions BIGINT,

    mon_transactions BIGINT,
    tue_transactions BIGINT,
    wed_transactions BIGINT,
    thu_transactions BIGINT,
    fri_transactions BIGINT,
    sat_transactions BIGINT,
    sun_transactions BIGINT,

    time_00_06_transactions BIGINT,
    time_06_11_transactions BIGINT,
    time_11_14_transactions BIGINT,
    time_14_17_transactions BIGINT,
    time_17_21_transactions BIGINT,
    time_21_24_transactions BIGINT,

    male_transactions BIGINT,
    female_transactions BIGINT,

    age_10_transactions BIGINT,
    age_20_transactions BIGINT,
    age_30_transactions BIGINT,
    age_40_transactions BIGINT,
    age_50_transactions BIGINT,
    age_60_plus_transactions BIGINT,

    UNIQUE (quarter_code, dong_code, source_industry_code)
);

CREATE INDEX IF NOT EXISTS idx_sales_dong_lookup
    ON sales_dong(dong_code, source_industry_code, quarter_code);

CREATE TABLE IF NOT EXISTS sales_commercial_area (
    id BIGSERIAL PRIMARY KEY,
    quarter_code SMALLINT NOT NULL,
    commercial_area_code VARCHAR(20) NOT NULL,
    commercial_area_name VARCHAR(200),
    source_industry_code VARCHAR(30) NOT NULL,
    source_industry_name VARCHAR(100),
    industry_id BIGINT REFERENCES industries(id),

    sales_amount BIGINT,
    transaction_count BIGINT,
    weekday_sales_amount BIGINT,
    weekend_sales_amount BIGINT,

    mon_sales_amount BIGINT,
    tue_sales_amount BIGINT,
    wed_sales_amount BIGINT,
    thu_sales_amount BIGINT,
    fri_sales_amount BIGINT,
    sat_sales_amount BIGINT,
    sun_sales_amount BIGINT,

    time_00_06_sales BIGINT,
    time_06_11_sales BIGINT,
    time_11_14_sales BIGINT,
    time_14_17_sales BIGINT,
    time_17_21_sales BIGINT,
    time_21_24_sales BIGINT,

    male_sales BIGINT,
    female_sales BIGINT,

    age_10_sales BIGINT,
    age_20_sales BIGINT,
    age_30_sales BIGINT,
    age_40_sales BIGINT,
    age_50_sales BIGINT,
    age_60_plus_sales BIGINT,

    weekday_transactions BIGINT,
    weekend_transactions BIGINT,

    mon_transactions BIGINT,
    tue_transactions BIGINT,
    wed_transactions BIGINT,
    thu_transactions BIGINT,
    fri_transactions BIGINT,
    sat_transactions BIGINT,
    sun_transactions BIGINT,

    time_00_06_transactions BIGINT,
    time_06_11_transactions BIGINT,
    time_11_14_transactions BIGINT,
    time_14_17_transactions BIGINT,
    time_17_21_transactions BIGINT,
    time_21_24_transactions BIGINT,

    male_transactions BIGINT,
    female_transactions BIGINT,

    age_10_transactions BIGINT,
    age_20_transactions BIGINT,
    age_30_transactions BIGINT,
    age_40_transactions BIGINT,
    age_50_transactions BIGINT,
    age_60_plus_transactions BIGINT,

    UNIQUE (quarter_code, commercial_area_code, source_industry_code)
);

CREATE INDEX IF NOT EXISTS idx_sales_area_lookup
    ON sales_commercial_area(commercial_area_code, source_industry_code, quarter_code);

CREATE TABLE IF NOT EXISTS stores (
    id BIGSERIAL PRIMARY KEY,
    source_store_id VARCHAR(40) NOT NULL UNIQUE,

    name VARCHAR(200),
    branch_name VARCHAR(100),

    source_large_category_code VARCHAR(20),
    source_large_category_name VARCHAR(100),
    source_medium_category_code VARCHAR(20),
    source_medium_category_name VARCHAR(100),
    source_small_category_code VARCHAR(20),
    source_small_category_name VARCHAR(100),
    source_standard_industry_code VARCHAR(20),
    source_standard_industry_name VARCHAR(100),

    industry_id BIGINT REFERENCES industries(id),

    sigungu_code VARCHAR(10),
    sigungu_name VARCHAR(50),
    dong_code VARCHAR(10),
    dong_name VARCHAR(50),
    legal_dong_code VARCHAR(20),
    legal_dong_name VARCHAR(50),

    jibun_address TEXT,
    road_address TEXT,

    longitude DOUBLE PRECISION,
    latitude DOUBLE PRECISION,

    location GEOMETRY(POINT, 4326)
);

CREATE INDEX IF NOT EXISTS idx_stores_location
    ON stores USING GIST(location);

CREATE INDEX IF NOT EXISTS idx_stores_small_category
    ON stores(source_small_category_code);

CREATE INDEX IF NOT EXISTS idx_stores_dong
    ON stores(dong_code);

-- 업종은 프로젝트가 실제 분석할 범위만 내부 업종으로 정의한다.
INSERT INTO industries(code, name) VALUES
    ('CAFE', '카페'),
    ('KFOOD', '한식'),
    ('PUB', '주점'),
    ('GYM', '헬스장'),
    ('HAIR', '미용실')
ON CONFLICT (code) DO NOTHING;

-- 서울시 업종 코드는 현재 제공된 2025년 데이터에서 확인된 코드만 매핑한다.
-- '커피-음료'는 프로젝트의 '카페'로 본다.
INSERT INTO industry_mappings(source, source_code, industry_id)
SELECT 'SEOUL', 'CS100010', id FROM industries WHERE code = 'CAFE'
ON CONFLICT (source, source_code) DO NOTHING;

INSERT INTO industry_mappings(source, source_code, industry_id)
SELECT 'SEOUL', 'CS100001', id FROM industries WHERE code = 'KFOOD'
ON CONFLICT (source, source_code) DO NOTHING;

INSERT INTO industry_mappings(source, source_code, industry_id)
SELECT 'SEOUL', 'CS100009', id FROM industries WHERE code = 'PUB'
ON CONFLICT (source, source_code) DO NOTHING;

INSERT INTO industry_mappings(source, source_code, industry_id)
SELECT 'SEOUL', 'CS200028', id FROM industries WHERE code = 'HAIR'
ON CONFLICT (source, source_code) DO NOTHING;
