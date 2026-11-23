-- 공식 자치구 길단위인구를 행정동 통계와 분리하고 원본의 NULL·소수 자릿수를 보존합니다.
CREATE TABLE district_foot_traffic_stat (
    district_code VARCHAR(5) NOT NULL REFERENCES district (district_code),
    quarter_code VARCHAR(5) NOT NULL,
    -- 무제한 NUMERIC으로 임의 반올림을 피하며 NaN·양/음의 무한대는 허용하지 않습니다.
    -- 원천의 총인구와 남녀 합계가 다를 수 있으므로 합계 일치 제약은 두지 않습니다.
    total_foot_traffic NUMERIC
        CHECK (total_foot_traffic >= 0 AND total_foot_traffic < 'Infinity'::NUMERIC),
    male_foot_traffic NUMERIC
        CHECK (male_foot_traffic >= 0 AND male_foot_traffic < 'Infinity'::NUMERIC),
    female_foot_traffic NUMERIC
        CHECK (female_foot_traffic >= 0 AND female_foot_traffic < 'Infinity'::NUMERIC),
    source_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id),
    PRIMARY KEY (district_code, quarter_code),
    CONSTRAINT district_foot_traffic_stat_district_code_check CHECK (district_code ~ '^[0-9]{5}$'),
    CONSTRAINT district_foot_traffic_stat_quarter_check CHECK (quarter_code ~ '^[0-9]{4}[1-4]$')
);

-- 현재 복합키 대조·Upsert에는 PK 인덱스를 사용하므로 추측성 보조 인덱스는 추가하지 않습니다.
