-- Current source lists are independent of cafe quarterly releases and scores.
-- V1--V5, their rows, checksums and immutable context policy remain untouched.
CREATE TABLE api_reference_snapshots (
    snapshot_id TEXT PRIMARY KEY CHECK (snapshot_id ~ '^[0-9a-f]{64}$'),
    source_id TEXT NOT NULL CHECK (source_id IN ('seoul-bus-stops','seoul-public-parking','seoul-metro-leases')),
    descriptor JSONB NOT NULL CHECK (jsonb_typeof(descriptor)='object'
        AND COALESCE(descriptor->>'kind','')='SEOUL_CURRENT_REFERENCE_V1'
        AND COALESCE(descriptor->>'snapshot_id','')=snapshot_id
        AND COALESCE(descriptor->>'source','')=source_id
        AND COALESCE(descriptor->>'policy_version','') ~ '^[0-9a-f]{64}$'
        AND COALESCE(descriptor->>'complete','')='true'
        AND COALESCE(descriptor->>'status','')='COLLECTED_UNPUBLISHED'
        AND COALESCE(descriptor->'policy'->>'scoreReady','')='false'
        AND COALESCE(descriptor->'policy'->>'sourceId','')=source_id
        AND COALESCE(descriptor->'policy'->>'id','')='SEOUL_CURRENT_REFERENCE_V1'
        AND COALESCE(descriptor->'policy'->>'temporalUnit','')='CURRENT_SOURCE_SNAPSHOT'
        AND COALESCE(descriptor->'policy'->'observedAt','{}'::jsonb)='null'::jsonb),
    artifact_ref TEXT NOT NULL CHECK (artifact_ref LIKE '/api-data/reference-runs/%' AND artifact_ref NOT LIKE '%/../%'),
    record_count BIGINT NOT NULL CHECK (record_count BETWEEN 1 AND 50000),
    raw_row_count BIGINT NOT NULL CHECK (raw_row_count BETWEEN record_count AND 50000),
    status TEXT NOT NULL CHECK (status IN ('PREPARING','READY')),
    UNIQUE (snapshot_id,source_id)
);
CREATE TABLE api_reference_records (
    snapshot_id TEXT NOT NULL REFERENCES api_reference_snapshots(snapshot_id),
    record_id TEXT NOT NULL CHECK (length(record_id) BETWEEN 1 AND 200),
    attributes JSONB NOT NULL CHECK (jsonb_typeof(attributes)='object'),
    attribute_states JSONB NOT NULL CHECK (jsonb_typeof(attribute_states)='object'),
    metrics JSONB NOT NULL CHECK (jsonb_typeof(metrics)='object'),
    source_row_count INTEGER NOT NULL CHECK (source_row_count BETWEEN 1 AND 50000),
    PRIMARY KEY(snapshot_id,record_id)
);
CREATE TABLE api_reference_current (
    source_id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    FOREIGN KEY(snapshot_id,source_id) REFERENCES api_reference_snapshots(snapshot_id,source_id)
);

CREATE FUNCTION guard_api_reference_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_count BIGINT; raw_count BIGINT;
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.status<>'PREPARING' THEN RAISE EXCEPTION 'Reference snapshot must start preparing'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reference snapshots are immutable'; END IF;
    IF OLD.status<>'PREPARING' OR NEW.status<>'READY' OR (to_jsonb(OLD)-'status')<>(to_jsonb(NEW)-'status') THEN
        RAISE EXCEPTION 'Reference snapshots can only be sealed';
    END IF;
    SELECT count(*),COALESCE(sum(source_row_count),0) INTO rows_count,raw_count
      FROM api_reference_records WHERE snapshot_id=NEW.snapshot_id;
    IF rows_count<>NEW.record_count OR raw_count<>NEW.raw_row_count
       OR COALESCE(NEW.descriptor->>'received_count','')<>NEW.raw_row_count::text
       OR COALESCE(NEW.descriptor->>'declared_count','')<>NEW.raw_row_count::text
       OR COALESCE(NEW.descriptor->>'record_count',NEW.descriptor->>'received_count','')<>NEW.record_count::text THEN
        RAISE EXCEPTION 'Reference snapshot coverage mismatch';
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION guard_api_reference_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent api_reference_snapshots%ROWTYPE; fields TEXT[]; metric_name TEXT; metric_unit TEXT;
        item RECORD; state_value TEXT; value JSONB; amount NUMERIC;
BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Reference records are append-only'; END IF;
    -- SHARE conflicts with a parent seal, including an uncommitted concurrent seal.
    SELECT * INTO STRICT parent FROM api_reference_snapshots WHERE snapshot_id=NEW.snapshot_id FOR SHARE;
    IF parent.status<>'PREPARING' THEN RAISE EXCEPTION 'Reference snapshot is sealed'; END IF;
    fields:=CASE parent.source_id
      WHEN 'seoul-bus-stops' THEN ARRAY['STOPS_NO','STOPS_NM','STOPS_TYPE']
      WHEN 'seoul-public-parking' THEN ARRAY['PKLT_NM','ADDR','PKLT_KND_NM','LAST_DATA_SYNC_TM']
      WHEN 'seoul-metro-leases' THEN ARRAY['STN_NM','STN_CD','TPBIZ','CTRT_STRT_DD','CTRT_END_DD'] END;
    IF ARRAY(SELECT jsonb_object_keys(NEW.attributes) ORDER BY 1)<>ARRAY(SELECT unnest(fields) ORDER BY 1)
       OR ARRAY(SELECT jsonb_object_keys(NEW.attribute_states) ORDER BY 1)<>ARRAY(SELECT unnest(fields) ORDER BY 1) THEN
        RAISE EXCEPTION 'Reference attribute allowlist mismatch';
    END IF;
    FOR item IN SELECT e.key,e.value FROM jsonb_each(NEW.attribute_states) e LOOP
        state_value:=item.value#>>'{}'; value:=NEW.attributes->item.key;
        IF jsonb_typeof(item.value)<>'string' OR state_value NOT IN ('REPORTED','SOURCE_NULL','WITHHELD_FORMAT')
           OR (state_value='REPORTED' AND (jsonb_typeof(value)<>'string' OR length(value#>>'{}')>2000))
           OR (state_value<>'REPORTED' AND value<>'null'::jsonb)
           OR (state_value='WITHHELD_FORMAT' AND item.key NOT IN ('CTRT_STRT_DD','CTRT_END_DD')) THEN
            RAISE EXCEPTION 'Reference attribute state mismatch';
        END IF;
    END LOOP;
    metric_name:=CASE parent.source_id WHEN 'seoul-public-parking' THEN 'TPKCT' WHEN 'seoul-metro-leases' THEN 'AREA' ELSE NULL END;
    metric_unit:=CASE parent.source_id WHEN 'seoul-public-parking' THEN 'PARKING_SPACE' WHEN 'seoul-metro-leases' THEN 'SQUARE_METRE_SOURCE_REPORTED' ELSE NULL END;
    IF (metric_name IS NULL AND NEW.metrics<>'{}'::jsonb) OR (metric_name IS NOT NULL AND ARRAY(SELECT jsonb_object_keys(NEW.metrics))<>ARRAY[metric_name]) THEN
        RAISE EXCEPTION 'Reference metric allowlist mismatch';
    END IF;
    IF metric_name IS NOT NULL THEN
        value:=NEW.metrics->metric_name; state_value:=value->>'valueState';
        IF jsonb_typeof(value)<>'object' OR ARRAY(SELECT jsonb_object_keys(value) ORDER BY 1)<>ARRAY['unit','value','valueState']
           OR COALESCE(value->>'unit','')<>metric_unit OR COALESCE(state_value,'') NOT IN ('REPORTED','SOURCE_NULL','WITHHELD_INVALID') THEN
            RAISE EXCEPTION 'Reference metric state mismatch';
        END IF;
        IF state_value='REPORTED' THEN
            IF jsonb_typeof(value->'value')<>'string' OR (value->>'value') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$' THEN
                RAISE EXCEPTION 'Reference metric must be an exact nonnegative decimal string';
            END IF;
            amount:=(value->>'value')::numeric;
            IF amount>9223372036854775807 OR (metric_name='TPKCT' AND amount<>trunc(amount)) THEN
                RAISE EXCEPTION 'Reference metric out of range';
            END IF;
        ELSIF value->'value'<>'null'::jsonb THEN RAISE EXCEPTION 'Unavailable reference value must be NULL'; END IF;
    END IF;
    IF parent.source_id<>'seoul-public-parking' AND NEW.source_row_count<>1 THEN RAISE EXCEPTION 'Unexpected reference grouping'; END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION guard_api_reference_current() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Current reference pointer cannot be deleted'; END IF;
    IF NOT EXISTS (SELECT 1 FROM api_reference_snapshots WHERE snapshot_id=NEW.snapshot_id AND source_id=NEW.source_id AND status='READY') THEN
        RAISE EXCEPTION 'Current reference snapshot is not ready';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER reference_snapshots_guard BEFORE INSERT OR UPDATE OR DELETE ON api_reference_snapshots
 FOR EACH ROW EXECUTE FUNCTION guard_api_reference_snapshots();
CREATE TRIGGER reference_records_guard BEFORE INSERT OR UPDATE OR DELETE ON api_reference_records
 FOR EACH ROW EXECUTE FUNCTION guard_api_reference_records();
CREATE TRIGGER reference_current_guard BEFORE INSERT OR UPDATE OR DELETE ON api_reference_current
 FOR EACH ROW EXECUTE FUNCTION guard_api_reference_current();
CREATE TRIGGER reference_snapshots_no_truncate BEFORE TRUNCATE ON api_reference_snapshots FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();
CREATE TRIGGER reference_records_no_truncate BEFORE TRUNCATE ON api_reference_records FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();
CREATE TRIGGER reference_current_no_truncate BEFORE TRUNCATE ON api_reference_current FOR EACH STATEMENT EXECUTE FUNCTION reject_api_truncate();
REVOKE ALL ON api_reference_snapshots,api_reference_records,api_reference_current FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='api_reader') THEN
        REVOKE ALL ON api_reference_snapshots,api_reference_records,api_reference_current FROM api_reader;
        GRANT SELECT ON api_reference_snapshots,api_reference_records,api_reference_current TO api_reader;
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='api_writer') THEN
        REVOKE ALL ON api_reference_snapshots,api_reference_records,api_reference_current FROM api_writer;
        GRANT SELECT,INSERT ON api_reference_snapshots,api_reference_records,api_reference_current TO api_writer;
        GRANT UPDATE(status) ON api_reference_snapshots TO api_writer;
        GRANT UPDATE(snapshot_id) ON api_reference_current TO api_writer;
    END IF;
END $$;
