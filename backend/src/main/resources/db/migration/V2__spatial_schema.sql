-- Spatial versions are independent of V1 statistical rows and representative POINTs.
-- Flyway supplies the transaction boundary for this versioned migration.
CREATE TABLE spatial_dataset_versions (
    id BIGSERIAL PRIMARY KEY,
    boundary_kind VARCHAR(30) NOT NULL
        CHECK (boundary_kind IN ('ADMIN_DONG', 'COMMERCIAL_AREA')),
    dataset_id VARCHAR(30) NOT NULL,
    dataset_name TEXT NOT NULL CHECK (btrim(dataset_name) <> ''),
    source_url TEXT NOT NULL CHECK (btrim(source_url) <> ''),
    source_file_name TEXT NOT NULL CHECK (btrim(source_file_name) <> ''),
    source_file_sha256 VARCHAR(64) NOT NULL
        CHECK (source_file_sha256 ~ '^[0-9a-f]{64}$'),
    source_crs INTEGER NOT NULL CHECK (source_crs = 5181),
    downloaded_at TIMESTAMPTZ,
    source_file_modified_date DATE,
    source_data_updated_date DATE,
    reference_date DATE,
    reference_date_verified BOOLEAN NOT NULL DEFAULT false,
    historical_compatibility_status VARCHAR(20) NOT NULL DEFAULT 'UNRESOLVED'
        CHECK (historical_compatibility_status IN ('UNRESOLVED', 'VERIFIED')),
    historical_compatibility_notes TEXT NOT NULL
        CHECK (btrim(historical_compatibility_notes) <> ''),
    validation_status VARCHAR(30) NOT NULL
        CHECK (validation_status IN (
            'PASSED', 'PASSED_WITH_LIMITATIONS', 'REVIEW_REQUIRED', 'UNSUPPORTED'
        )),
    validation_report_path TEXT NOT NULL CHECK (btrim(validation_report_path) <> ''),
    validation_report_sha256 VARCHAR(64) NOT NULL
        CHECK (validation_report_sha256 ~ '^[0-9a-f]{64}$'),
    processing_profile_sha256 VARCHAR(64) NOT NULL
        CHECK (processing_profile_sha256 ~ '^[0-9a-f]{64}$'),
    processing_metadata JSONB NOT NULL
        CHECK (jsonb_typeof(processing_metadata) = 'object'),
    feature_count INTEGER NOT NULL CHECK (feature_count > 0),
    load_status VARCHAR(10) NOT NULL DEFAULT 'PENDING'
        CHECK (load_status IN ('PENDING', 'READY')),
    loaded_at TIMESTAMPTZ,
    is_current BOOLEAN NOT NULL DEFAULT false,
    notes TEXT NOT NULL CHECK (btrim(notes) <> ''),

    UNIQUE (id, boundary_kind),
    UNIQUE (dataset_id, source_file_sha256, processing_profile_sha256),
    CONSTRAINT ck_spatial_versions_dataset_kind CHECK (
        (boundary_kind = 'ADMIN_DONG' AND dataset_id = 'OA-22160')
        OR (boundary_kind = 'COMMERCIAL_AREA' AND dataset_id = 'OA-15560')
    ),
    CONSTRAINT ck_spatial_versions_reference_date CHECK (
        reference_date_verified = (reference_date IS NOT NULL)
    ),
    CONSTRAINT ck_spatial_versions_load_state CHECK (
        (load_status = 'PENDING' AND loaded_at IS NULL AND NOT is_current)
        OR (load_status = 'READY' AND loaded_at IS NOT NULL)
    ),
    CONSTRAINT ck_spatial_versions_current_validation CHECK (
        NOT is_current OR validation_status IN ('PASSED', 'PASSED_WITH_LIMITATIONS')
    )
);

CREATE UNIQUE INDEX uq_spatial_dataset_current
    ON spatial_dataset_versions(boundary_kind) WHERE is_current;

CREATE TABLE admin_dong_boundaries (
    id BIGSERIAL PRIMARY KEY,
    dataset_version_id BIGINT NOT NULL,
    boundary_kind VARCHAR(30) NOT NULL DEFAULT 'ADMIN_DONG'
        CHECK (boundary_kind = 'ADMIN_DONG'),
    dong_code VARCHAR(10) NOT NULL CHECK (dong_code ~ '^[0-9]{8}$'),
    dong_name VARCHAR(100) NOT NULL CHECK (btrim(dong_name) <> ''),
    source_feature_index INTEGER NOT NULL CHECK (source_feature_index >= 0),
    source_geometry GEOMETRY(GEOMETRY, 5181),
    operational_geometry GEOMETRY(MULTIPOLYGON, 5181),
    quality_status VARCHAR(30) NOT NULL
        CHECK (quality_status IN (
            'VALID_SOURCE', 'REPAIRED_OPERATIONAL', 'REVIEW_REQUIRED', 'UNSUPPORTED'
        )),
    quality_detail TEXT,
    repair_method VARCHAR(30),
    repair_parameters JSONB,
    source_geometry_sha256 VARCHAR(64),
    operational_geometry_sha256 VARCHAR(64),

    FOREIGN KEY (dataset_version_id, boundary_kind)
        REFERENCES spatial_dataset_versions(id, boundary_kind),
    UNIQUE (dataset_version_id, dong_code),
    UNIQUE (dataset_version_id, source_feature_index),
    CONSTRAINT ck_admin_boundaries_source_hash CHECK (COALESCE(
        (source_geometry IS NULL AND source_geometry_sha256 IS NULL)
        OR (source_geometry IS NOT NULL AND source_geometry_sha256 IS NOT NULL
            AND source_geometry_sha256 ~ '^[0-9a-f]{64}$'
            AND source_geometry_sha256 =
                encode(sha256(ST_AsBinary(source_geometry, 'NDR')), 'hex')),
        false
    )),
    CONSTRAINT ck_admin_boundaries_operational_hash CHECK (COALESCE(
        (operational_geometry IS NULL AND operational_geometry_sha256 IS NULL)
        OR (operational_geometry IS NOT NULL AND operational_geometry_sha256 IS NOT NULL
            AND operational_geometry_sha256 ~ '^[0-9a-f]{64}$'
            AND operational_geometry_sha256 =
                encode(sha256(ST_AsBinary(operational_geometry, 'NDR')), 'hex')),
        false
    )),
    CONSTRAINT ck_admin_boundaries_operational_valid CHECK (
        operational_geometry IS NULL OR COALESCE(
            NOT ST_IsEmpty(operational_geometry) AND ST_IsValid(operational_geometry),
            false
        )
    ),
    CONSTRAINT ck_admin_boundaries_quality CHECK (COALESCE(
        CASE quality_status
            WHEN 'VALID_SOURCE' THEN
                source_geometry IS NOT NULL AND NOT ST_IsEmpty(source_geometry)
                AND ST_GeometryType(source_geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
                AND ST_IsValid(source_geometry) AND operational_geometry IS NOT NULL
                AND ST_AsBinary(operational_geometry, 'NDR') =
                    ST_AsBinary(ST_Multi(source_geometry), 'NDR')
                AND quality_detail IS NULL AND repair_method IS NULL
                AND repair_parameters IS NULL
            WHEN 'REPAIRED_OPERATIONAL' THEN
                source_geometry IS NOT NULL AND NOT ST_IsEmpty(source_geometry)
                AND ST_GeometryType(source_geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
                AND NOT ST_IsValid(source_geometry) AND operational_geometry IS NOT NULL
                AND repair_method = 'make_valid'
                AND repair_parameters = '{"method":"linework","keep_collapsed":true}'::jsonb
                AND quality_detail IS NOT NULL AND btrim(quality_detail) <> ''
            ELSE
                operational_geometry IS NULL AND operational_geometry_sha256 IS NULL
                AND repair_method IS NULL AND repair_parameters IS NULL
                AND quality_detail IS NOT NULL AND btrim(quality_detail) <> ''
        END,
        false
    ))
);

CREATE INDEX idx_admin_dong_boundaries_operational
    ON admin_dong_boundaries USING GIST(operational_geometry)
    WHERE operational_geometry IS NOT NULL;

CREATE TABLE commercial_area_boundaries (
    id BIGSERIAL PRIMARY KEY,
    dataset_version_id BIGINT NOT NULL,
    boundary_kind VARCHAR(30) NOT NULL DEFAULT 'COMMERCIAL_AREA'
        CHECK (boundary_kind = 'COMMERCIAL_AREA'),
    commercial_area_code VARCHAR(20) NOT NULL
        CHECK (commercial_area_code ~ '^[0-9]{1,20}$'),
    source_name VARCHAR(254) NOT NULL CHECK (btrim(source_name) <> ''),
    source_feature_index INTEGER NOT NULL CHECK (source_feature_index >= 0),
    source_geometry GEOMETRY(GEOMETRY, 5181),
    operational_geometry GEOMETRY(MULTIPOLYGON, 5181),
    quality_status VARCHAR(30) NOT NULL
        CHECK (quality_status IN (
            'VALID_SOURCE', 'REPAIRED_OPERATIONAL', 'REVIEW_REQUIRED', 'UNSUPPORTED'
        )),
    quality_detail TEXT,
    repair_method VARCHAR(30),
    repair_parameters JSONB,
    source_geometry_sha256 VARCHAR(64),
    operational_geometry_sha256 VARCHAR(64),
    source_sigungu_code VARCHAR(10),
    source_dong_code VARCHAR(10),
    source_attribute_status VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (source_attribute_status IN ('UNVERIFIED', 'CONFLICT_OBSERVED')),
    source_attribute_detail TEXT,

    CONSTRAINT ck_commercial_boundaries_source_attribute CHECK (
        (source_attribute_status = 'UNVERIFIED' AND source_attribute_detail IS NULL)
        OR (source_attribute_status = 'CONFLICT_OBSERVED'
            AND source_attribute_detail IS NOT NULL AND btrim(source_attribute_detail) <> '')
    ),
    FOREIGN KEY (dataset_version_id, boundary_kind)
        REFERENCES spatial_dataset_versions(id, boundary_kind),
    UNIQUE (dataset_version_id, commercial_area_code),
    UNIQUE (dataset_version_id, source_feature_index),
    CONSTRAINT ck_commercial_boundaries_source_hash CHECK (COALESCE(
        (source_geometry IS NULL AND source_geometry_sha256 IS NULL)
        OR (source_geometry IS NOT NULL AND source_geometry_sha256 IS NOT NULL
            AND source_geometry_sha256 ~ '^[0-9a-f]{64}$'
            AND source_geometry_sha256 =
                encode(sha256(ST_AsBinary(source_geometry, 'NDR')), 'hex')),
        false
    )),
    CONSTRAINT ck_commercial_boundaries_operational_hash CHECK (COALESCE(
        (operational_geometry IS NULL AND operational_geometry_sha256 IS NULL)
        OR (operational_geometry IS NOT NULL AND operational_geometry_sha256 IS NOT NULL
            AND operational_geometry_sha256 ~ '^[0-9a-f]{64}$'
            AND operational_geometry_sha256 =
                encode(sha256(ST_AsBinary(operational_geometry, 'NDR')), 'hex')),
        false
    )),
    CONSTRAINT ck_commercial_boundaries_operational_valid CHECK (
        operational_geometry IS NULL OR COALESCE(
            NOT ST_IsEmpty(operational_geometry) AND ST_IsValid(operational_geometry),
            false
        )
    ),
    CONSTRAINT ck_commercial_boundaries_quality CHECK (COALESCE(
        CASE quality_status
            WHEN 'VALID_SOURCE' THEN
                source_geometry IS NOT NULL AND NOT ST_IsEmpty(source_geometry)
                AND ST_GeometryType(source_geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
                AND ST_IsValid(source_geometry) AND operational_geometry IS NOT NULL
                AND ST_AsBinary(operational_geometry, 'NDR') =
                    ST_AsBinary(ST_Multi(source_geometry), 'NDR')
                AND quality_detail IS NULL AND repair_method IS NULL
                AND repair_parameters IS NULL
            WHEN 'REPAIRED_OPERATIONAL' THEN
                source_geometry IS NOT NULL AND NOT ST_IsEmpty(source_geometry)
                AND ST_GeometryType(source_geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
                AND NOT ST_IsValid(source_geometry) AND operational_geometry IS NOT NULL
                AND repair_method = 'make_valid'
                AND repair_parameters = '{"method":"linework","keep_collapsed":true}'::jsonb
                AND quality_detail IS NOT NULL AND btrim(quality_detail) <> ''
            ELSE
                operational_geometry IS NULL AND operational_geometry_sha256 IS NULL
                AND repair_method IS NULL AND repair_parameters IS NULL
                AND quality_detail IS NOT NULL AND btrim(quality_detail) <> ''
        END,
        false
    ))
);

CREATE INDEX idx_commercial_area_boundaries_operational
    ON commercial_area_boundaries USING GIST(operational_geometry)
    WHERE operational_geometry IS NOT NULL;

CREATE FUNCTION guard_spatial_boundary_write() RETURNS trigger
LANGUAGE plpgsql AS $function$
DECLARE
    parent_load_status VARCHAR(10);
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Boundary versions are INSERT-only; % is forbidden', TG_OP;
    END IF;

    -- Serialize each insertion with publication of the same parent version.
    SELECT load_status INTO parent_load_status
    FROM public.spatial_dataset_versions
    WHERE id = NEW.dataset_version_id
    FOR UPDATE;

    IF parent_load_status IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'Boundary insertion requires a PENDING dataset version';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER guard_admin_boundary
    BEFORE INSERT OR UPDATE OR DELETE ON admin_dong_boundaries
    FOR EACH ROW EXECUTE FUNCTION guard_spatial_boundary_write();

CREATE TRIGGER guard_commercial_boundary
    BEFORE INSERT OR UPDATE OR DELETE ON commercial_area_boundaries
    FOR EACH ROW EXECUTE FUNCTION guard_spatial_boundary_write();

CREATE FUNCTION guard_spatial_dataset_version() RETURNS trigger
LANGUAGE plpgsql AS $function$
DECLARE
    total_rows BIGINT;
    usable_rows BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Dataset versions must be retained; DELETE is forbidden';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.load_status IS DISTINCT FROM 'PENDING'
            OR NEW.is_current IS DISTINCT FROM false OR NEW.loaded_at IS NOT NULL THEN
            RAISE EXCEPTION 'New dataset versions must be PENDING, non-current and without loaded_at';
        END IF;
        RETURN NEW;
    END IF;

    -- Only lifecycle fields may differ; all source/validation/processing facts are immutable.
    IF (to_jsonb(NEW) - ARRAY['load_status', 'loaded_at', 'is_current']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['load_status', 'loaded_at', 'is_current']) THEN
        RAISE EXCEPTION 'Dataset identity, validation and processing metadata are immutable';
    END IF;

    IF NEW.is_current IS DISTINCT FROM OLD.is_current
        AND OLD.load_status <> 'READY' THEN
        RAISE EXCEPTION 'is_current can change only for an already READY dataset version';
    END IF;

    IF OLD.load_status = 'READY' AND (
        NEW.load_status IS DISTINCT FROM OLD.load_status
        OR NEW.loaded_at IS DISTINCT FROM OLD.loaded_at
    ) THEN
        RAISE EXCEPTION 'READY dataset load_status and loaded_at are immutable';
    END IF;

    IF OLD.load_status = 'PENDING' AND NEW.load_status = 'READY' THEN
        IF NEW.boundary_kind = 'ADMIN_DONG' THEN
            SELECT count(*), count(*) FILTER (
                WHERE quality_status IN ('VALID_SOURCE', 'REPAIRED_OPERATIONAL')
            ) INTO total_rows, usable_rows
            FROM public.admin_dong_boundaries WHERE dataset_version_id = NEW.id;
        ELSE
            SELECT count(*), count(*) FILTER (
                WHERE quality_status IN ('VALID_SOURCE', 'REPAIRED_OPERATIONAL')
            ) INTO total_rows, usable_rows
            FROM public.commercial_area_boundaries WHERE dataset_version_id = NEW.id;
        END IF;

        IF total_rows <> NEW.feature_count OR usable_rows <> total_rows
            OR NEW.validation_status NOT IN ('PASSED', 'PASSED_WITH_LIMITATIONS') THEN
            RAISE EXCEPTION 'READY requires the complete expected feature set and only usable quality/validation states';
        END IF;

        -- Record the DB-observed completion time, never a caller-supplied historical timestamp.
        NEW.loaded_at := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER guard_spatial_version
    BEFORE INSERT OR UPDATE OR DELETE ON spatial_dataset_versions
    FOR EACH ROW EXECUTE FUNCTION guard_spatial_dataset_version();
