-- Keep readers available while serializing the mapping and minimal store backfill.
-- Flyway runs the lock, assertions, insert and update in one script transaction.
LOCK TABLE industry_mappings, stores IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
DECLARE
    cafe_id BIGINT;
    mapped_industry_id BIGINT;
    target_rows BIGINT;
    affected_rows BIGINT;
BEGIN
    SELECT id INTO cafe_id
    FROM industries
    WHERE code = 'CAFE'
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SEMAS CAFE migration requires industries.code = CAFE';
    END IF;

    SELECT industry_id INTO mapped_industry_id
    FROM industry_mappings
    WHERE source = 'SEMAS' AND source_code = 'I21201';

    IF FOUND AND mapped_industry_id IS DISTINCT FROM cafe_id THEN
        RAISE EXCEPTION 'SEMAS/I21201 already maps to an industry other than CAFE';
    END IF;

    IF EXISTS (
        SELECT 1 FROM stores
        WHERE source_small_category_code = 'I21201'
            AND industry_id IS NOT NULL AND industry_id <> cafe_id
    ) THEN
        RAISE EXCEPTION 'I21201 stores contain a conflicting non-CAFE industry_id';
    END IF;

    -- The table lock makes absence stable; do not suppress an unexpected conflict.
    IF mapped_industry_id IS NULL THEN
        INSERT INTO industry_mappings(source, source_code, industry_id)
        VALUES ('SEMAS', 'I21201', cafe_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM industry_mappings
        WHERE source = 'SEMAS' AND source_code = 'I21201' AND industry_id = cafe_id
    ) THEN
        RAISE EXCEPTION 'SEMAS/I21201 mapping does not resolve to CAFE after insertion';
    END IF;

    SELECT count(*) INTO target_rows
    FROM stores
    WHERE source_small_category_code = 'I21201' AND industry_id IS NULL;

    -- Preserve row identities, source attributes and POINTs; fill only missing classifications.
    UPDATE stores SET industry_id = cafe_id
    WHERE source_small_category_code = 'I21201' AND industry_id IS NULL;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    IF affected_rows <> target_rows THEN
        RAISE EXCEPTION 'CAFE backfill affected % rows but expected %', affected_rows, target_rows;
    END IF;

    IF EXISTS (
        SELECT 1 FROM stores
        WHERE source_small_category_code = 'I21201' AND industry_id IS NULL
    ) THEN
        RAISE EXCEPTION 'CAFE backfill left I21201 stores without industry_id';
    END IF;

    IF EXISTS (
        SELECT 1 FROM stores
        WHERE source_small_category_code = 'I21201'
            AND industry_id IS NOT NULL AND industry_id <> cafe_id
    ) THEN
        RAISE EXCEPTION 'CAFE backfill left I21201 stores with a non-CAFE industry_id';
    END IF;
END;
$migration$;
