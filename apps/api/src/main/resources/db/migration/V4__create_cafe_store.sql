-- 원천 업소번호는 계산값이 아닌 식별자이며, 소진공 업종은 서울시 service_industry와 분리한다.
CREATE TABLE cafe_store (
    bizes_id VARCHAR(20) PRIMARY KEY,
    store_name TEXT NOT NULL,
    branch_name TEXT,
    semas_industry_code VARCHAR(8) NOT NULL,
    semas_industry_name TEXT NOT NULL,
    ksic_code VARCHAR(6),
    ksic_name TEXT,
    -- 미연결·구형 코드도 원문으로 보존하고, 검증된 동일 코드만 정규 FK에 넣는다.
    source_dong_code VARCHAR(20),
    dong_code VARCHAR(8) REFERENCES administrative_dong (dong_code),
    road_address TEXT,
    lot_address TEXT,
    -- 좌표가 없으면 NULL이며, 주소나 행정동 대표점으로 대신 채우지 않는다.
    geom GEOMETRY(Point,4326),
    source_batch_id UUID NOT NULL REFERENCES etl_batch (batch_id),
    CONSTRAINT cafe_store_bizes_id_check CHECK (bizes_id ~ '^[^[:space:]]+$'),
    CONSTRAINT cafe_store_name_check CHECK (store_name ~ '[^[:space:]]'),
    CONSTRAINT cafe_store_branch_name_check CHECK (branch_name ~ '[^[:space:]]'),
    -- 특정 카페 코드의 소속 여부는 분류 버전을 확인하는 후속 ETL에서 검증한다.
    CONSTRAINT cafe_store_semas_industry_code_check CHECK (semas_industry_code ~ '^[A-Z0-9]+$'),
    CONSTRAINT cafe_store_semas_industry_name_check CHECK (semas_industry_name ~ '[^[:space:]]'),
    CONSTRAINT cafe_store_ksic_code_check CHECK (ksic_code ~ '^[A-Z0-9]+$'),
    CONSTRAINT cafe_store_ksic_name_check CHECK (ksic_name ~ '[^[:space:]]'),
    CONSTRAINT cafe_store_source_dong_code_check CHECK (source_dong_code ~ '^[0-9]+$'),
    CONSTRAINT cafe_store_dong_code_check CHECK (dong_code ~ '^[0-9]{8}$'),
    CONSTRAINT cafe_store_dong_source_match_check CHECK (
        dong_code IS NULL
        OR (source_dong_code IS NOT NULL AND source_dong_code = dong_code)
    ),
    CONSTRAINT cafe_store_road_address_check CHECK (road_address ~ '[^[:space:]]'),
    CONSTRAINT cafe_store_lot_address_check CHECK (lot_address ~ '[^[:space:]]'),
    -- Point·SRID·2차원은 타입으로 제한하고, 빈 도형·비유한값·좌표 범위 초과를 거부한다.
    CONSTRAINT cafe_store_geom_valid_check CHECK (
        geom IS NULL
        OR (
            NOT ST_IsEmpty(geom) AND ST_IsValid(geom)
            AND ST_X(geom) BETWEEN -180 AND 180
            AND ST_Y(geom) BETWEEN -90 AND 90
        )
    )
);

-- 최신의 완전한 PUBLISHED 배치와 행정동으로 목록을 좁힐 때 사용한다.
CREATE INDEX cafe_store_batch_dong_idx ON cafe_store (source_batch_id, dong_code);
-- 지도 영역의 geometry 연산과 미터 반경의 geography 연산은 서로 다른 인덱스를 사용한다.
CREATE INDEX cafe_store_geom_idx ON cafe_store USING GIST (geom);
CREATE INDEX cafe_store_geography_idx ON cafe_store USING GIST ((geom::geography));
