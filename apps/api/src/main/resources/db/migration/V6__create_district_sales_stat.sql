-- 공식 자치구 추정매출은 행정동 매출과 분리하며 합산하거나 누락 조합을 생성하지 않습니다.
CREATE TABLE district_sales_stat (
    district_code VARCHAR(5) NOT NULL REFERENCES district (district_code),
    industry_code VARCHAR(8) NOT NULL REFERENCES service_industry (industry_code),
    quarter_code VARCHAR(5) NOT NULL,
    -- 원천의 당월·주중·주말 의미와 NULL·실제 0을 보존하며 부분 합 일치는 강제하지 않습니다.
    monthly_sales_amount BIGINT CHECK (monthly_sales_amount >= 0),
    monthly_sales_count BIGINT CHECK (monthly_sales_count >= 0),
    weekday_sales_amount BIGINT CHECK (weekday_sales_amount >= 0),
    weekend_sales_amount BIGINT CHECK (weekend_sales_amount >= 0),
    source_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id),
    PRIMARY KEY (district_code, industry_code, quarter_code),
    CONSTRAINT district_sales_stat_district_code_check CHECK (district_code ~ '^[0-9]{5}$'),
    CONSTRAINT district_sales_stat_industry_code_check CHECK (industry_code ~ '^CS[0-9]{6}$'),
    CONSTRAINT district_sales_stat_quarter_check CHECK (quarter_code ~ '^[0-9]{4}[1-4]$')
);

-- 현재 ETL의 복합키 대조·Upsert는 PK 인덱스를 사용하므로 추측성 보조 인덱스는 만들지 않습니다.
