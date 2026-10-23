-- Additive contract 2. V1--V4 and the legacy tables/checksums remain intact.
CREATE TABLE api_context_runs (
    run_id TEXT PRIMARY KEY CHECK (run_id ~ '^[0-9a-f]{64}$'),
    source_id TEXT NOT NULL CHECK (source_id IN ('seoul-population','seoul-residents',
        'seoul-workers','seoul-facilities','seoul-change')),
    descriptor JSONB NOT NULL CHECK (jsonb_typeof(descriptor)='object'
        AND descriptor->>'run_id'=run_id AND descriptor->>'source'=source_id
        AND descriptor->>'normalizer_version'='1'
        AND descriptor->'observed_at'='null'::jsonb
        AND (descriptor->>'row_count')::bigint>0
        AND descriptor->'quality'->>'collection_complete'='true'
        AND descriptor->'quality'->>'quarantined_count'='0'
        AND descriptor->'quality'->>'name_conflict_count'='0')
);
CREATE TABLE api_context_rows (
    run_id TEXT NOT NULL REFERENCES api_context_runs(run_id),
    quarter_code TEXT NOT NULL CHECK (quarter_code ~ '^[1-9][0-9]{3}[1-4]$'),
    dong_code TEXT NOT NULL CHECK (dong_code ~ '^11[0-9]{6}$'),
    dong_name TEXT NOT NULL CHECK (length(dong_name)>0),
    metrics JSONB NOT NULL CHECK (jsonb_typeof(metrics)='object'),
    attributes JSONB NOT NULL CHECK (jsonb_typeof(attributes)='object'),
    PRIMARY KEY(run_id,quarter_code,dong_code)
);
CREATE TABLE api_release_context_sources (
    release_id TEXT NOT NULL REFERENCES api_releases(release_id),
    source_id TEXT NOT NULL CHECK (source_id IN ('seoul-population','seoul-residents',
        'seoul-workers','seoul-facilities','seoul-change','seoul-consumption')),
    state TEXT NOT NULL CHECK (state IN ('REFERENCE','WITHHELD')),
    run_id TEXT REFERENCES api_context_runs(run_id),
    policy_version TEXT NOT NULL CHECK (policy_version ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY(release_id,source_id),
    CHECK ((source_id='seoul-consumption' AND state='WITHHELD' AND run_id IS NULL)
        OR (source_id<>'seoul-consumption' AND state='REFERENCE' AND run_id IS NOT NULL))
);

CREATE FUNCTION guard_api_context_runs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Context runs are append-only'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER api_context_run_immutable BEFORE UPDATE OR DELETE ON api_context_runs
    FOR EACH ROW EXECUTE FUNCTION guard_api_context_runs();

CREATE FUNCTION guard_api_context_rows() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE descriptor_value JSONB; metric RECORD;
BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Context rows are append-only'; END IF;
    SELECT descriptor INTO STRICT descriptor_value FROM api_context_runs WHERE run_id=NEW.run_id FOR SHARE;
    IF EXISTS (SELECT 1 FROM api_release_context_sources s JOIN api_releases r USING(release_id)
        WHERE s.run_id=NEW.run_id AND r.status='READY') THEN RAISE EXCEPTION 'Context run is sealed'; END IF;
    IF NOT (descriptor_value->'quarters' ? NEW.quarter_code) THEN RAISE EXCEPTION 'Context quarter mismatch'; END IF;
    FOR metric IN SELECT key,value FROM jsonb_each(NEW.metrics) LOOP
        IF metric.value<>'null'::jsonb AND (jsonb_typeof(metric.value)<>'string'
            OR (metric.value#>>'{}') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$'
            OR (metric.value#>>'{}')::numeric>9223372036854775807) THEN
            RAISE EXCEPTION 'Context metric must be a nonnegative exact decimal string or NULL';
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_each(NEW.attributes) WHERE value<>'null'::jsonb AND jsonb_typeof(value)<>'string') THEN
        RAISE EXCEPTION 'Context attribute must be a string or NULL';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER api_context_rows_immutable BEFORE INSERT OR UPDATE OR DELETE ON api_context_rows
    FOR EACH ROW EXECUTE FUNCTION guard_api_context_rows();
CREATE TRIGGER api_context_sources_immutable BEFORE INSERT OR UPDATE OR DELETE ON api_release_context_sources
    FOR EACH ROW EXECUTE FUNCTION guard_api_release_rows();
CREATE TRIGGER api_context_runs_no_truncate BEFORE TRUNCATE ON api_context_runs
    FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();
CREATE TRIGGER api_context_rows_no_truncate BEFORE TRUNCATE ON api_context_rows
    FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();
CREATE TRIGGER api_context_sources_no_truncate BEFORE TRUNCATE ON api_release_context_sources
    FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();

CREATE OR REPLACE FUNCTION guard_api_release_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status<>'PREPARING' OR COALESCE(NEW.metadata->>'contract_version','') NOT IN ('1','2')
        OR NEW.metadata->>'release_id' IS DISTINCT FROM NEW.release_id
        OR NEW.metadata->>'text_policy' IS DISTINCT FROM 'SOURCE_TEXT_OUTER_STRIP_ONLY'
        OR jsonb_typeof(NEW.metadata->'quarters') IS DISTINCT FROM 'array'
        OR jsonb_array_length(NEW.metadata->'quarters')=0
        OR jsonb_typeof(NEW.metadata->'runs') IS DISTINCT FROM 'array'
        OR COALESCE(NEW.metadata->>'store_scope','') NOT IN ('I21201','ALL_SOURCE_INDUSTRIES')
        OR NEW.metadata ? 'candidate_status' THEN RAISE EXCEPTION 'Validated PREPARING contract required'; END IF;
    IF NEW.metadata->>'contract_version'='1' AND (NEW.metadata ?| ARRAY['quality_policy','context_sources','context_policy']) THEN
        RAISE EXCEPTION 'Contract 1 cannot contain contract 2 policy';
    END IF;
    IF NEW.metadata->>'contract_version'='2' AND (
        NEW.metadata->>'release_kind' IS DISTINCT FROM 'HISTORY_WITH_REFERENCE_CONTEXT_V1'
        OR NEW.metadata->'context_policy'->>'policy_id' IS DISTINCT FROM 'SEOUL_CONTEXT_REFERENCE_V1'
        OR COALESCE(NEW.metadata->>'context_policy_version','') !~ '^[0-9a-f]{64}$'
        OR NEW.metadata->'quality_policy'->>'policy_id' IS DISTINCT FROM 'EXACT_APPROVED_UNMAPPED_SALES_NEGATIVE_COUNT_V1'
        OR jsonb_typeof(NEW.metadata->'context_sources') IS DISTINCT FROM 'object'
        OR jsonb_typeof(NEW.metadata->'quality_policy'->'approval'->'cases') IS DISTINCT FROM 'array') THEN
        RAISE EXCEPTION 'Final context and exact exclusion contract required';
    END IF;
    IF NEW.metadata ? 'baseline_archive' AND (
        COALESCE(NEW.metadata->>'refresh_parent','') !~ '^[0-9a-f]{64}$'
        OR jsonb_typeof(NEW.metadata->'baseline_archive') IS DISTINCT FROM 'array'
        OR NOT EXISTS (SELECT 1 FROM api_releases p WHERE p.release_id=NEW.metadata->>'refresh_parent'
            AND p.status='READY' AND p.metadata->'baseline'=NEW.metadata->'baseline'
            AND p.metadata->>'context_policy_version'=NEW.metadata->>'context_policy_version'
            AND p.metadata->'quality_policy'->'approval'=NEW.metadata->'quality_policy'->'approval')) THEN
        RAISE EXCEPTION 'Baseline archive requires an immutable READY parent';
    END IF;
    RETURN NEW;
END $$;

-- The V4 metadata trigger still enforces all existing typed row/quarter counts.
-- This additional trigger validates the contract 2 part before the same seal.
CREATE FUNCTION guard_api_context_seal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry RECORD; case_value JSONB; run_value JSONB; expected BIGINT; actual BIGINT;
BEGIN
    IF NEW.metadata->>'contract_version'<>'2' THEN
        IF EXISTS (SELECT 1 FROM api_release_context_sources WHERE release_id=NEW.release_id) THEN
            RAISE EXCEPTION 'Contract 1 cannot bind context sources'; END IF;
        RETURN NEW;
    END IF;
    IF (SELECT count(*) FROM api_release_context_sources WHERE release_id=NEW.release_id)<>6
        OR (SELECT count(*) FROM jsonb_object_keys(NEW.metadata->'context_sources'))<>6 THEN
        RAISE EXCEPTION 'Exactly six context sections required'; END IF;
    FOR entry IN SELECT * FROM api_release_context_sources WHERE release_id=NEW.release_id LOOP
        IF entry.policy_version IS DISTINCT FROM NEW.metadata->>'context_policy_version'
            OR NEW.metadata->'context_sources'->replace(entry.source_id,'seoul-','')->>'state' IS DISTINCT FROM entry.state THEN
            RAISE EXCEPTION 'Context policy binding mismatch'; END IF;
        IF entry.run_id IS NOT NULL THEN
            SELECT descriptor INTO STRICT run_value FROM api_context_runs
                WHERE run_id=entry.run_id AND source_id=entry.source_id FOR UPDATE;
            IF run_value IS DISTINCT FROM NEW.metadata->'context_sources'->replace(entry.source_id,'seoul-','')->'run' THEN
                RAISE EXCEPTION 'Context run binding mismatch'; END IF;
            IF (SELECT count(*) FROM api_context_rows WHERE run_id=entry.run_id)<>(run_value->>'row_count')::bigint
                OR EXISTS (SELECT 1 FROM jsonb_each(run_value->'quality'->'periods') p
                    WHERE (SELECT count(*) FROM api_context_rows WHERE run_id=entry.run_id AND quarter_code=p.key)
                        <>(p.value->>'row_count')::bigint) THEN RAISE EXCEPTION 'Incomplete context run'; END IF;
        ELSIF NEW.metadata->'context_sources'->'consumption'->'run' IS DISTINCT FROM 'null'::jsonb THEN
            RAISE EXCEPTION 'Withheld source must not bind a run';
        END IF;
    END LOOP;
    expected:=jsonb_array_length(NEW.metadata->'quality_policy'->'approval'->'cases'); actual:=0;
    IF expected=0 OR (NEW.metadata->'quality_policy'->>'quarantined_count')::bigint<>expected THEN
        RAISE EXCEPTION 'Exact quarantine count mismatch'; END IF;
    FOR case_value IN SELECT value FROM jsonb_array_elements(NEW.metadata->'quality_policy'->'approval'->'cases') LOOP
        IF EXISTS (SELECT 1 FROM industry_mappings WHERE source='SEOUL' AND source_code=case_value->>'source_industry_code')
            OR EXISTS (SELECT 1 FROM api_sales_dong WHERE release_id=NEW.release_id
                AND quarter_code::text=case_value->>'quarter_code' AND dong_code=case_value->>'dong_code'
                AND source_industry_code=case_value->>'source_industry_code') THEN
            RAISE EXCEPTION 'Quarantined row must be unsupported and excluded'; END IF;
        IF (SELECT count(*) FROM jsonb_array_elements(NEW.metadata->'runs') r,
             LATERAL jsonb_array_elements(r->'quality'->'cases') c WHERE
             r->>'source'='seoul-sales' AND r->>'period'=case_value->>'quarter_code'
             AND c->>'quarter_code'=case_value->>'quarter_code' AND c->>'dong_code'=case_value->>'dong_code'
             AND c->>'source_industry_code'=case_value->>'source_industry_code' AND c->'fields'=case_value->'fields')<>1 THEN
            RAISE EXCEPTION 'Quarantine case evidence mismatch'; END IF;
    END LOOP;
    FOR run_value IN SELECT value FROM jsonb_array_elements(NEW.metadata->'runs') WHERE value ? 'quality' LOOP
        IF run_value->>'source'<>'seoul-sales' OR run_value->>'normalizer_version'<>'3'
            OR (run_value->'quality'->>'raw_count')::bigint<>(run_value->>'row_count')::bigint
                +(run_value->'quality'->>'quarantined_count')::bigint
            OR (run_value->'quality'->>'normalized_count')::bigint<>(run_value->>'row_count')::bigint THEN
            RAISE EXCEPTION 'Quarantine run count mismatch'; END IF;
        actual:=actual+(run_value->'quality'->>'quarantined_count')::bigint;
    END LOOP;
    IF actual<>expected THEN RAISE EXCEPTION 'Quarantine evidence count mismatch'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER api_releases_context_seal BEFORE UPDATE ON api_releases
    FOR EACH ROW EXECUTE FUNCTION guard_api_context_seal();

CREATE FUNCTION guard_api_context_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous JSONB; candidate JSONB; lost_context BOOLEAN;
BEGIN
    IF OLD.release_id IS NULL THEN RETURN NEW; END IF;
    SELECT metadata INTO STRICT previous FROM api_releases WHERE release_id=OLD.release_id;
    SELECT metadata INTO STRICT candidate FROM api_releases WHERE release_id=NEW.release_id;
    IF (previous->>'contract_version'='2' AND candidate->>'contract_version'<>'2')
        OR NOT ((candidate->'quarters') @> (previous->'quarters'))
        OR candidate->>'store_reference_month'<previous->>'store_reference_month'
        OR (previous->>'store_scope'='ALL_SOURCE_INDUSTRIES' AND candidate->>'store_scope'<>'ALL_SOURCE_INDUSTRIES') THEN
        RAISE EXCEPTION 'Publication cannot lose contract, periods, scope or store month'; END IF;
    IF previous->>'contract_version'='2' AND (
        candidate->>'context_policy_version' IS DISTINCT FROM previous->>'context_policy_version'
        OR candidate->'quality_policy'->'approval' IS DISTINCT FROM previous->'quality_policy'->'approval') THEN
        RAISE EXCEPTION 'Publication policy transition requires a new explicit contract'; END IF;
    IF candidate ? 'refresh_parent' AND candidate->>'refresh_parent' IS DISTINCT FROM OLD.release_id THEN
        RAISE EXCEPTION 'Refresh must succeed its exact parent publication';
    END IF;
    IF previous->>'contract_version'='2' THEN
        SELECT EXISTS (
            SELECT s.source_id,t.quarter_code,t.dong_code FROM api_release_context_sources s
                JOIN api_context_rows t ON t.run_id=s.run_id
                WHERE s.release_id=OLD.release_id AND s.state='REFERENCE'
            EXCEPT
            SELECT s.source_id,t.quarter_code,t.dong_code FROM api_release_context_sources s
                JOIN api_context_rows t ON t.run_id=s.run_id
                WHERE s.release_id=NEW.release_id AND s.state='REFERENCE'
        ) INTO lost_context;
        IF lost_context THEN RAISE EXCEPTION 'Context coverage regression requires review'; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER api_current_context_contract BEFORE UPDATE ON api_current_release
    FOR EACH ROW EXECUTE FUNCTION guard_api_context_publication();

CREATE VIEW published_context_rows AS
    SELECT t.*,s.source_id,s.policy_version,r.release_id
    FROM api_context_rows t JOIN api_release_context_sources s ON s.run_id=t.run_id AND s.state='REFERENCE'
    JOIN api_current_release c ON c.release_id=s.release_id
    JOIN api_releases r ON r.release_id=c.release_id AND r.status='READY'
    WHERE r.metadata->'quarters' ? t.quarter_code;
