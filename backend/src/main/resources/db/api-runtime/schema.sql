-- Explicit API environment bootstrap only, after V1–V4. Never a default Flyway location.
CREATE SCHEMA api_runtime;
CREATE TABLE api_runtime.artifacts (
 release_id TEXT PRIMARY KEY REFERENCES public.api_releases(release_id),
 runs JSONB NOT NULL CHECK(jsonb_typeof(runs)='array'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE api_runtime.state (
 singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton),
 status TEXT NOT NULL CHECK(status IN ('IDLE','RUNNING','SUCCEEDED','FAILED')),
 next_due TIMESTAMPTZ NOT NULL,
 candidate_release TEXT REFERENCES public.api_releases(release_id),
 last_error TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION api_runtime.reject_artifact_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'API artifact registry is immutable'; END $$;
CREATE TRIGGER artifacts_immutable BEFORE UPDATE OR DELETE ON api_runtime.artifacts
 FOR EACH ROW EXECUTE FUNCTION api_runtime.reject_artifact_change();
CREATE TRIGGER artifacts_no_truncate BEFORE TRUNCATE ON api_runtime.artifacts
 FOR EACH STATEMENT EXECUTE FUNCTION api_runtime.reject_artifact_change();
