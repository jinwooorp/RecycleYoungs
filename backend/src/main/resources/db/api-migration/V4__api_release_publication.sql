-- Optional additive API publication schema. Select db/api-migration explicitly after approval.
-- Kept outside the fixed CSV migration location; this file is NOT approval to execute it.
-- V1/V2/V3 and the CSV tables remain unchanged.
CREATE TABLE api_releases (
    release_id TEXT PRIMARY KEY CHECK (release_id ~ '^[0-9a-f]{64}$'),
    metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
    status TEXT NOT NULL CHECK (status IN ('PREPARING', 'READY')),
    staged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE api_current_release (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    release_id TEXT REFERENCES api_releases(release_id)
);
INSERT INTO api_current_release(singleton, release_id) VALUES (true, NULL);

CREATE TABLE api_store_stats_dong (
    LIKE store_stats_dong INCLUDING CONSTRAINTS,
    release_id TEXT NOT NULL REFERENCES api_releases(release_id),
    PRIMARY KEY (release_id, quarter_code, dong_code, source_industry_code),
    FOREIGN KEY (industry_id) REFERENCES industries(id)
);
-- LIKE does not copy defaults: give this table its own sequence.
ALTER TABLE api_store_stats_dong ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;

CREATE TABLE api_sales_dong (
    LIKE sales_dong INCLUDING CONSTRAINTS,
    release_id TEXT NOT NULL REFERENCES api_releases(release_id),
    PRIMARY KEY (release_id, quarter_code, dong_code, source_industry_code),
    FOREIGN KEY (industry_id) REFERENCES industries(id)
);
-- LIKE does not copy defaults: give this table its own sequence.
ALTER TABLE api_sales_dong ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;

CREATE TABLE api_stores (
    LIKE stores INCLUDING CONSTRAINTS,
    release_id TEXT NOT NULL REFERENCES api_releases(release_id),
    PRIMARY KEY (release_id, source_store_id),
    FOREIGN KEY (industry_id) REFERENCES industries(id)
);
-- LIKE does not copy defaults: give this table its own sequence.
ALTER TABLE api_stores ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;

CREATE INDEX api_stores_location_idx ON api_stores USING gist(location);
CREATE INDEX api_stores_scope_idx ON api_stores(release_id, source_small_category_code);
CREATE INDEX api_store_stats_lookup_idx ON api_store_stats_dong(release_id, dong_code, source_industry_code, quarter_code);
CREATE INDEX api_sales_lookup_idx ON api_sales_dong(release_id, dong_code, source_industry_code, quarter_code);

CREATE FUNCTION guard_api_release_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'PREPARING' OR NEW.metadata->>'contract_version' IS DISTINCT FROM '1'
        OR NEW.metadata->>'release_id' IS DISTINCT FROM NEW.release_id
        OR NEW.metadata->>'text_policy' IS DISTINCT FROM 'SOURCE_TEXT_OUTER_STRIP_ONLY'
        OR jsonb_typeof(NEW.metadata->'quarters') IS DISTINCT FROM 'array'
        OR jsonb_array_length(NEW.metadata->'quarters') = 0
        OR jsonb_typeof(NEW.metadata->'runs') IS DISTINCT FROM 'array'
        OR COALESCE(NEW.metadata->>'store_scope','') NOT IN ('I21201','ALL_SOURCE_INDUSTRIES') THEN
        RAISE EXCEPTION 'API release must start with a validated PREPARING contract';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER api_releases_start BEFORE INSERT ON api_releases
    FOR EACH ROW EXECUTE FUNCTION guard_api_release_insert();

CREATE FUNCTION guard_api_release_rows() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state TEXT;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'API release rows are append-only'; END IF;
    SELECT status INTO state FROM api_releases WHERE release_id = NEW.release_id FOR SHARE;
    IF state IS DISTINCT FROM 'PREPARING' THEN RAISE EXCEPTION 'API release is sealed'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER api_store_stats_dong_immutable BEFORE INSERT OR UPDATE OR DELETE ON api_store_stats_dong
    FOR EACH ROW EXECUTE FUNCTION guard_api_release_rows();
CREATE TRIGGER api_sales_dong_immutable BEFORE INSERT OR UPDATE OR DELETE ON api_sales_dong
    FOR EACH ROW EXECUTE FUNCTION guard_api_release_rows();
CREATE TRIGGER api_stores_immutable BEFORE INSERT OR UPDATE OR DELETE ON api_stores
    FOR EACH ROW EXECUTE FUNCTION guard_api_release_rows();

CREATE FUNCTION guard_api_release_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.status <> 'PREPARING' OR NEW.status <> 'READY'
        OR NEW.release_id IS DISTINCT FROM OLD.release_id
        OR NEW.metadata IS DISTINCT FROM OLD.metadata OR NEW.staged_at IS DISTINCT FROM OLD.staged_at THEN
        RAISE EXCEPTION 'API release metadata is immutable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM api_store_stats_dong WHERE release_id=NEW.release_id)
        OR NOT EXISTS (SELECT 1 FROM api_sales_dong WHERE release_id=NEW.release_id)
        OR NOT EXISTS (SELECT 1 FROM api_stores WHERE release_id=NEW.release_id) THEN
        RAISE EXCEPTION 'API release is incomplete';
    END IF;
    IF (SELECT count(*) FROM api_store_stats_dong WHERE release_id=NEW.release_id) IS DISTINCT FROM
        (SELECT sum((value->>'row_count')::bigint) FROM jsonb_array_elements(NEW.metadata->'runs') WHERE value->>'source'='seoul-stores')
        OR (SELECT count(*) FROM api_sales_dong WHERE release_id=NEW.release_id) IS DISTINCT FROM
        (SELECT sum((value->>'row_count')::bigint) FROM jsonb_array_elements(NEW.metadata->'runs') WHERE value->>'source'='seoul-sales')
        OR (SELECT count(*) FROM api_stores WHERE release_id=NEW.release_id) IS DISTINCT FROM
        (SELECT sum((value->>'row_count')::bigint) FROM jsonb_array_elements(NEW.metadata->'runs') WHERE value->>'source'='semas-stores') THEN
        RAISE EXCEPTION 'API release row counts do not match the contract';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.metadata->'quarters') q(code)
        WHERE NOT EXISTS (SELECT 1 FROM api_store_stats_dong WHERE release_id=NEW.release_id AND quarter_code::text=q.code)
           OR NOT EXISTS (SELECT 1 FROM api_sales_dong WHERE release_id=NEW.release_id AND quarter_code::text=q.code))
        OR EXISTS (SELECT 1 FROM api_store_stats_dong WHERE release_id=NEW.release_id AND NOT (NEW.metadata->'quarters' ? quarter_code::text))
        OR EXISTS (SELECT 1 FROM api_sales_dong WHERE release_id=NEW.release_id AND NOT (NEW.metadata->'quarters' ? quarter_code::text)) THEN
        RAISE EXCEPTION 'API release quarters are incomplete';
    END IF;
    IF EXISTS (SELECT 1 FROM api_stores WHERE release_id=NEW.release_id
        AND (sigungu_code IS NULL OR sigungu_code NOT LIKE '11%'
            OR (NEW.metadata->>'store_scope'='I21201' AND source_small_category_code IS DISTINCT FROM 'I21201'))) THEN
        RAISE EXCEPTION 'API store scope does not match the contract';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER api_releases_immutable BEFORE UPDATE OR DELETE ON api_releases
    FOR EACH ROW EXECUTE FUNCTION guard_api_release_metadata();

CREATE FUNCTION guard_api_current_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR NEW.release_id IS NULL OR
        NOT EXISTS (SELECT 1 FROM api_releases WHERE release_id=NEW.release_id AND status='READY') THEN
        RAISE EXCEPTION 'Only a complete READY release may be published';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER api_current_release_ready BEFORE UPDATE OR DELETE ON api_current_release
    FOR EACH ROW EXECUTE FUNCTION guard_api_current_release();

CREATE FUNCTION reject_api_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'API release truncation is prohibited';
END $$;
CREATE TRIGGER api_releases_no_truncate BEFORE TRUNCATE ON api_releases
    FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();
CREATE TRIGGER api_current_no_truncate BEFORE TRUNCATE ON api_current_release
    FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();
CREATE TRIGGER api_stats_no_truncate BEFORE TRUNCATE ON api_store_stats_dong
    FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();
CREATE TRIGGER api_sales_no_truncate BEFORE TRUNCATE ON api_sales_dong
    FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();
CREATE TRIGGER api_stores_no_truncate BEFORE TRUNCATE ON api_stores
    FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();

-- API mode reads only the selected release. No fallback after a missing/invalid pointer.
CREATE VIEW published_store_stats_dong AS
    SELECT t.id, t.quarter_code, t.dong_code, t.dong_name, t.source_industry_code, t.source_industry_name, t.industry_id, t.store_count, t.similar_store_count, t.opening_rate, t.opening_store_count, t.closing_rate, t.closing_store_count, t.franchise_store_count
    FROM api_store_stats_dong t JOIN api_current_release c ON c.release_id=t.release_id;
CREATE VIEW published_sales_dong AS
    SELECT t.id, t.quarter_code, t.dong_code, t.dong_name, t.source_industry_code, t.source_industry_name, t.industry_id, t.sales_amount, t.transaction_count, t.weekday_sales_amount, t.weekend_sales_amount, t.mon_sales_amount, t.tue_sales_amount, t.wed_sales_amount, t.thu_sales_amount, t.fri_sales_amount, t.sat_sales_amount, t.sun_sales_amount, t.time_00_06_sales, t.time_06_11_sales, t.time_11_14_sales, t.time_14_17_sales, t.time_17_21_sales, t.time_21_24_sales, t.male_sales, t.female_sales, t.age_10_sales, t.age_20_sales, t.age_30_sales, t.age_40_sales, t.age_50_sales, t.age_60_plus_sales, t.weekday_transactions, t.weekend_transactions, t.mon_transactions, t.tue_transactions, t.wed_transactions, t.thu_transactions, t.fri_transactions, t.sat_transactions, t.sun_transactions, t.time_00_06_transactions, t.time_06_11_transactions, t.time_11_14_transactions, t.time_14_17_transactions, t.time_17_21_transactions, t.time_21_24_transactions, t.male_transactions, t.female_transactions, t.age_10_transactions, t.age_20_transactions, t.age_30_transactions, t.age_40_transactions, t.age_50_transactions, t.age_60_plus_transactions
    FROM api_sales_dong t JOIN api_current_release c ON c.release_id=t.release_id;
-- A CAFE-only snapshot replaces only Seoul CAFE. Other legacy scopes are retained.
-- Exclude repeated source IDs when an establishment changes its classification.
CREATE VIEW published_stores AS
    SELECT t.id, t.source_store_id, t.name, t.branch_name, t.source_large_category_code, t.source_large_category_name, t.source_medium_category_code, t.source_medium_category_name, t.source_small_category_code, t.source_small_category_name, t.source_standard_industry_code, t.source_standard_industry_name, t.industry_id, t.sigungu_code, t.sigungu_name, t.dong_code, t.dong_name, t.legal_dong_code, t.legal_dong_name, t.jibun_address, t.road_address, t.longitude, t.latitude, t.location
    FROM api_stores t JOIN api_current_release c ON c.release_id=t.release_id
    UNION ALL
    SELECT s.id, s.source_store_id, s.name, s.branch_name, s.source_large_category_code, s.source_large_category_name, s.source_medium_category_code, s.source_medium_category_name, s.source_small_category_code, s.source_small_category_name, s.source_standard_industry_code, s.source_standard_industry_name, s.industry_id, s.sigungu_code, s.sigungu_name, s.dong_code, s.dong_name, s.legal_dong_code, s.legal_dong_name, s.jibun_address, s.road_address, s.longitude, s.latitude, s.location
    FROM stores s CROSS JOIN api_current_release c JOIN api_releases r ON r.release_id=c.release_id
    WHERE (s.sigungu_code IS NULL OR s.sigungu_code NOT LIKE '11%'
        OR (r.metadata->>'store_scope'='I21201' AND s.source_small_category_code IS DISTINCT FROM 'I21201'))
      AND NOT EXISTS (SELECT 1 FROM api_stores a WHERE a.release_id=c.release_id AND a.source_store_id=s.source_store_id);
