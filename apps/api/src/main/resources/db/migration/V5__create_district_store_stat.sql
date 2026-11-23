-- 공식 자치구 원천은 행정동 통계와 분리하며 합산·누락 조합의 0 보정을 하지 않습니다.
CREATE TABLE district_store_stat (
    district_code VARCHAR(5) NOT NULL REFERENCES district (district_code),
    industry_code VARCHAR(8) NOT NULL REFERENCES service_industry (industry_code),
    quarter_code VARCHAR(5) NOT NULL,
    -- SIMILR_INDUTY_STOR_CO는 전체, STOR_CO는 일반 점포 수이며 NULL과 실제 0을 구분합니다.
    store_count BIGINT CHECK (store_count >= 0),
    general_store_count BIGINT CHECK (general_store_count >= 0),
    franchise_store_count BIGINT CHECK (franchise_store_count >= 0),
    opened_store_count BIGINT CHECK (opened_store_count >= 0),
    closed_store_count BIGINT CHECK (closed_store_count >= 0),
    -- 원본 소수 자릿수와 100% 초과값을 허용하되 음수·비유한 값은 허용하지 않습니다.
    opening_rate NUMERIC CHECK (opening_rate >= 0 AND opening_rate < 'Infinity'::NUMERIC),
    closure_rate NUMERIC CHECK (closure_rate >= 0 AND closure_rate < 'Infinity'::NUMERIC),
    source_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id),
    PRIMARY KEY (district_code, industry_code, quarter_code),
    CONSTRAINT district_store_stat_district_code_check CHECK (district_code ~ '^[0-9]{5}$'),
    CONSTRAINT district_store_stat_industry_code_check CHECK (industry_code ~ '^CS[0-9]{6}$'),
    CONSTRAINT district_store_stat_quarter_check CHECK (quarter_code ~ '^[0-9]{4}[1-4]$')
);

-- 현재 ETL의 복합키 대조·Upsert는 PK 인덱스를 사용하므로 추측성 보조 인덱스는 만들지 않습니다.
