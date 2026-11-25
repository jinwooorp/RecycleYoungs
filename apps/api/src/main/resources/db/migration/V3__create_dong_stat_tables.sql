CREATE TABLE dong_store_stat (
    dong_code VARCHAR(8) NOT NULL REFERENCES administrative_dong (dong_code),
    industry_code VARCHAR(8) NOT NULL REFERENCES service_industry (industry_code),
    quarter_code VARCHAR(5) NOT NULL,
    -- SIMILR_INDUTY_STOR_CO는 전체 점포 수, STOR_CO는 일반 점포 수입니다.
    store_count BIGINT CHECK (store_count >= 0),
    general_store_count BIGINT CHECK (general_store_count >= 0),
    franchise_store_count BIGINT CHECK (franchise_store_count >= 0),
    opened_store_count BIGINT CHECK (opened_store_count >= 0),
    closed_store_count BIGINT CHECK (closed_store_count >= 0),
    opening_rate NUMERIC CHECK (opening_rate >= 0 AND opening_rate < 'Infinity'::NUMERIC),
    closure_rate NUMERIC CHECK (closure_rate >= 0 AND closure_rate < 'Infinity'::NUMERIC),
    source_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id),
    PRIMARY KEY (dong_code, industry_code, quarter_code),
    CONSTRAINT dong_store_stat_quarter_check CHECK (quarter_code ~ '^[0-9]{4}[1-4]$')
);

CREATE TABLE dong_sales_stat (
    dong_code VARCHAR(8) NOT NULL REFERENCES administrative_dong (dong_code),
    industry_code VARCHAR(8) NOT NULL REFERENCES service_industry (industry_code),
    quarter_code VARCHAR(5) NOT NULL,
    monthly_sales_amount BIGINT CHECK (monthly_sales_amount >= 0),
    monthly_sales_count BIGINT CHECK (monthly_sales_count >= 0),
    weekday_sales_amount BIGINT CHECK (weekday_sales_amount >= 0),
    weekend_sales_amount BIGINT CHECK (weekend_sales_amount >= 0),
    source_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id),
    PRIMARY KEY (dong_code, industry_code, quarter_code),
    CONSTRAINT dong_sales_stat_quarter_check CHECK (quarter_code ~ '^[0-9]{4}[1-4]$')
);

CREATE TABLE dong_foot_traffic_stat (
    dong_code VARCHAR(8) NOT NULL REFERENCES administrative_dong (dong_code),
    quarter_code VARCHAR(5) NOT NULL,
    -- 원천의 소수 정밀도 보장이 없어 고정 소수 자릿수나 반올림을 강제하지 않습니다.
    total_foot_traffic NUMERIC
        CHECK (total_foot_traffic >= 0 AND total_foot_traffic < 'Infinity'::NUMERIC),
    male_foot_traffic NUMERIC
        CHECK (male_foot_traffic >= 0 AND male_foot_traffic < 'Infinity'::NUMERIC),
    female_foot_traffic NUMERIC
        CHECK (female_foot_traffic >= 0 AND female_foot_traffic < 'Infinity'::NUMERIC),
    source_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id),
    PRIMARY KEY (dong_code, quarter_code),
    CONSTRAINT dong_foot_traffic_stat_quarter_check CHECK (quarter_code ~ '^[0-9]{4}[1-4]$')
);
