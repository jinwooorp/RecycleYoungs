CREATE TABLE etl_batch (
    batch_id UUID PRIMARY KEY,
    dataset_code VARCHAR(40) NOT NULL,
    source_type VARCHAR(16) NOT NULL,
    scope_type VARCHAR(16) NOT NULL,
    scope_code VARCHAR(5),
    period_from VARCHAR(5),
    period_to VARCHAR(5),
    source_reference TEXT NOT NULL,
    source_checksum CHAR(64),
    etl_version TEXT NOT NULL,
    status VARCHAR(16) NOT NULL,
    expected_rows BIGINT,
    fetched_rows BIGINT NOT NULL DEFAULT 0,
    valid_rows BIGINT NOT NULL DEFAULT 0,
    rejected_rows BIGINT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    error_message TEXT,
    CONSTRAINT etl_batch_source_type_check
        CHECK (source_type IN ('CSV', 'API', 'SHAPEFILE')),
    CONSTRAINT etl_batch_status_check
        CHECK (status IN ('RUNNING', 'PUBLISHED', 'FAILED', 'SKIPPED')),
    CONSTRAINT etl_batch_row_counts_check
        CHECK (expected_rows >= 0 AND fetched_rows >= 0 AND valid_rows >= 0 AND rejected_rows >= 0),
    CONSTRAINT etl_batch_period_from_check
        CHECK (period_from ~ '^[0-9]{4}[1-4]$'),
    CONSTRAINT etl_batch_period_to_check
        CHECK (period_to ~ '^[0-9]{4}[1-4]$'),
    CONSTRAINT etl_batch_period_order_check
        CHECK (period_from <= period_to),
    CONSTRAINT etl_batch_scope_check
        CHECK (
            (scope_type = 'SEOUL' AND scope_code IS NULL)
            OR (scope_type = 'DISTRICT' AND scope_code IS NOT NULL AND scope_code ~ '^[0-9]{5}$')
        )
);

CREATE TABLE district (
    district_code VARCHAR(5) PRIMARY KEY,
    district_name TEXT NOT NULL,
    geom GEOMETRY(MultiPolygon,4326) NOT NULL,
    boundary_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id),
    CONSTRAINT district_code_check CHECK (district_code ~ '^[0-9]{5}$'),
    CONSTRAINT district_geom_valid_check CHECK (NOT ST_IsEmpty(geom) AND ST_IsValid(geom))
);

CREATE TABLE administrative_dong (
    dong_code VARCHAR(8) PRIMARY KEY,
    district_code VARCHAR(5) NOT NULL REFERENCES district (district_code),
    dong_name TEXT NOT NULL,
    geom GEOMETRY(MultiPolygon,4326) NOT NULL,
    label_point GEOMETRY(Point,4326) NOT NULL,
    area_m2 BIGINT NOT NULL,
    boundary_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id),
    CONSTRAINT administrative_dong_code_check CHECK (dong_code ~ '^[0-9]{8}$'),
    CONSTRAINT administrative_dong_district_code_check
        CHECK (LEFT(dong_code, 5) = district_code),
    CONSTRAINT administrative_dong_area_check CHECK (area_m2 > 0),
    CONSTRAINT administrative_dong_geom_valid_check CHECK (NOT ST_IsEmpty(geom) AND ST_IsValid(geom)),
    CONSTRAINT administrative_dong_label_point_valid_check
        CHECK (NOT ST_IsEmpty(label_point) AND ST_IsValid(label_point))
);

CREATE TABLE service_industry (
    industry_code VARCHAR(8) PRIMARY KEY,
    industry_name TEXT NOT NULL,
    source_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id)
);

CREATE INDEX district_geom_idx ON district USING GIST (geom);
CREATE INDEX administrative_dong_geom_idx ON administrative_dong USING GIST (geom);
CREATE INDEX administrative_dong_district_code_idx ON administrative_dong (district_code);
CREATE INDEX etl_batch_dataset_started_at_idx ON etl_batch (dataset_code, started_at DESC);
