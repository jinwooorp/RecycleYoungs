# 데이터 설계

PostgreSQL의 프로젝트 테이블 11개는 지역·업종 기준, 구·동 통계, 개별 카페, ETL 실행 이력을 저장합니다. PostGIS는 좌표·경계·거리 검색을 제공하고, Flyway는 테이블 구조의 변경 이력을 관리합니다. [로컬 마이그레이션 적용](SETUP.md#3-backend) · [API 응답](API.md)

- [마이그레이션 버전](#db-마이그레이션-방향)
- [지역·업종 기준과 출처 배치](#기본-테이블과-관계)
- [통계 키와 측정값](#통계-테이블)
- [공간 데이터](#공간-데이터) · [개별 카페](#v4-카페-테이블)

## DB 마이그레이션 방향

Flyway는 DB 스키마 변경을 버전순으로 적용하고 이력과 체크섬을 기록합니다. 적용한 파일은 보존하고 후속 변경은 새 버전으로 추가합니다. 새 DB에 스키마를 적용한 뒤 ETL 또는 합성 Demo로 조회 데이터를 준비합니다. [마이그레이션 파일](../apps/api/src/main/resources/db/migration/) · [ETL](ETL.md) · [합성 Demo](SETUP.md#합성-demo)

| 버전 | 적용 내용 |
| --- | --- |
| V1 | PostGIS 확장 활성화 |
| V2 | `etl_batch`, `district`, `administrative_dong`, `service_industry` |
| V3 | 행정동 점포·매출·유동인구 테이블 |
| V4 | 개별 카페 `cafe_store`와 조회 인덱스 |
| V5 | 공식 자치구 점포 `district_store_stat` |
| V6 | 공식 자치구 추정매출 `district_sales_stat` |
| V7 | 공식 자치구 길단위인구 `district_foot_traffic_stat` |

## 기본 테이블과 관계

기본키(PK)는 행을 유일하게 식별하고 외래키(FK)는 다른 테이블의 행을 참조합니다. 지역·업종·분기 코드는 문자열로 저장해 선행 0을 보존합니다.

| 테이블 | 기본키 | 주요 컬럼과 관계 |
| --- | --- | --- |
| `etl_batch` | `batch_id` UUID | 데이터셋, 수집 유형, 범위, 분기, 입력 참조, 체크섬, ETL 버전, 실행 상태, 행 수, 게시 시각 |
| `district` | `district_code` ASCII 5자리 | 이름, 경계 `geom`, 경계 배치 FK |
| `administrative_dong` | `dong_code` ASCII 8자리 | 소속 구 FK, 이름, 경계, 대표점, 원본 면적, 경계 배치 FK. 동 코드의 앞 5자리와 소속 구 코드가 일치해야 함 |
| `service_industry` | `industry_code` | 서울시 업종명과 출처 배치 FK. 소진공 업종 체계는 카페 테이블에서 따로 관리 |

### ETL 배치의 출처와 범위

| 컬럼 | 저장 규칙 |
| --- | --- |
| `source_type` | `CSV`, `API`, `SHAPEFILE` |
| `scope_type`, `scope_code` | 서울 전체(`SEOUL`)는 `scope_code`가 NULL입니다. 구 범위(`DISTRICT`)는 ASCII 숫자 5자리 코드가 필요합니다. |
| `period_from`, `period_to` | 값이 있으면 `YYYYQ` 형식과 순서를 검사합니다. |
| `published_at` | 서비스 DB에서 게시를 확정한 시각입니다. 제공기관의 원본 생성·배포 시각은 별도로 관리합니다. |
| `source_reference` | TEXT로 저장합니다. JSON 메타데이터를 읽을 때 유효성을 확인한 뒤 변환합니다. |

[ETL 배치 상태와 재실행](ETL.md#배치-상태와-재실행)

## 통계 테이블

| 지표 | 행정동 테이블 · 데이터셋 | 자치구 테이블 · 데이터셋 | 기본키 |
| --- | --- | --- | --- |
| 점포 | `dong_store_stat` · `SEOUL_DONG_STORE_STAT` | `district_store_stat` · `SEOUL_DISTRICT_STORE_STAT` | 지역, `industry_code`, `quarter_code` |
| 추정매출 | `dong_sales_stat` · `SEOUL_DONG_SALES_STAT` | `district_sales_stat` · `SEOUL_DISTRICT_SALES_STAT` | 지역, `industry_code`, `quarter_code` |
| 유동인구 | `dong_foot_traffic_stat` · `SEOUL_DONG_FOOT_TRAFFIC_STAT` | `district_foot_traffic_stat` · `SEOUL_DISTRICT_FOOT_TRAFFIC_STAT` | 지역, `quarter_code` |

행정동 통계의 `dong_code`와 자치구 통계의 `district_code`는 각 지역 기준 테이블을 참조합니다. 점포·매출은 업종 FK도 가지며, 모든 통계 행은 `source_batch_id`로 실제 출처 배치를 참조합니다.

분기는 `YYYYQ`(연도 4자리·분기 1~4), 업종은 `CS`와 ASCII 숫자 6자리입니다. 통계는 기본키 인덱스를 사용합니다.

### 통계 분기 목록

분기 목록은 여섯 통계 테이블의 실제 행에서 `quarter_code`를 읽습니다. 각 행의 `source_batch_id`가 가리키는 배치는 해당 데이터셋, `CSV` 또는 `API` 출처, 서울 전체 범위, `PUBLISHED`, 게시 시각 존재 조건을 충족해야 합니다. 과거 적격 배치와 측정값이 모두 NULL인 적격 행도 포함합니다.

구는 최신 유효 경계 게시본에 속해야 하고, 동은 소속 구와 동 모두 그 게시본에 있어야 합니다. 경계와 통계 행은 읽기 전용 `REPEATABLE READ` 트랜잭션에서 조회합니다.

[목록과 기본 분기의 응답 계약](API.md#통계-분기-목록)

### 구·동 공통 측정값

| 지표 | DB 컬럼 | 영문 원천 필드 | 한글 CSV 헤더 | 자료형 |
| --- | --- | --- | --- | --- |
| 점포 | `store_count` | `SIMILR_INDUTY_STOR_CO` | 전체_점포_수 | BIGINT |
| 점포 | `general_store_count` | `STOR_CO` | 일반_점포_수 | BIGINT |
| 점포 | `franchise_store_count` | `FRC_STOR_CO` | 프랜차이즈_점포_수 | BIGINT |
| 점포 | `opened_store_count` | `OPBIZ_STOR_CO` | 개업_점포_수 | BIGINT |
| 점포 | `closed_store_count` | `CLSBIZ_STOR_CO` | 폐업_점포_수 | BIGINT |
| 점포 | `opening_rate` | `OPBIZ_RT` | 개업_율 | NUMERIC |
| 점포 | `closure_rate` | `CLSBIZ_RT` | 폐업_률 | NUMERIC |
| 매출 | `monthly_sales_amount` | `THSMON_SELNG_AMT` | 당월_매출_금액 | BIGINT |
| 매출 | `monthly_sales_count` | `THSMON_SELNG_CO` | 당월_매출_건수 | BIGINT |
| 매출 | `weekday_sales_amount` | `MDWK_SELNG_AMT` | 주중_매출_금액 | BIGINT |
| 매출 | `weekend_sales_amount` | `WKEND_SELNG_AMT` | 주말_매출_금액 | BIGINT |
| 유동인구 | `total_foot_traffic` | `TOT_FLPOP_CO` | 총_유동인구_수 | NUMERIC |
| 유동인구 | `male_foot_traffic` | `ML_FLPOP_CO` | 남성_유동인구_수 | NUMERIC |
| 유동인구 | `female_foot_traffic` | `FML_FLPOP_CO` | 여성_유동인구_수 | NUMERIC |

### 결측과 정밀도

| 상태 | 의미 |
| --- | --- |
| 행 부재 | 요청한 지역·분기·업종 조합의 유효한 행이 없음 |
| 측정값 NULL | 행은 있지만 해당 값이 제공되지 않음 |
| 실제 0 | 원천이 제공한 유효 수치. 저장된 소수 자릿수를 유지 |

측정값은 기본값 없이 NULL을 허용합니다. 값이 있으면 유한한 0 이상의 수만 저장합니다. BIGINT는 정수에, 고정 소수 자릿수가 없는 NUMERIC은 비율과 인구에 사용합니다. NUMERIC은 소수 자릿수와 후행 0을 보존합니다. 비율이 100%를 넘거나 합계가 세부 값의 합과 달라도 원본 수치를 저장합니다.

[입력 형식 검증](ETL.md#공통-입력-검증과-게시) · [API의 응답과 결측](API.md#응답과-결측)

## 공간 데이터

경계는 WGS84(EPSG:4326) `MultiPolygon`이며 좌표는 경도·위도 순입니다.

행정동에 WGS84 `Point` 대표점과 양수인 `area_m2`(BIGINT)를 저장합니다.

경계 ETL은 EPSG:5181 원본을 변환하고 같은 구의 동 도형을 결합합니다.

구·동 경계에 공간 검색용 GiST 인덱스가 있습니다.

`geometry`는 경계와 사각 영역 판정에, `geography`는 미터 단위 반경과 거리 계산에 사용합니다.

## V4 카페 테이블

| DB 컬럼 | 원천 | 제약과 의미 |
| --- | --- | --- |
| `bizes_id` | `bizesId` | 공백 없는 원본 식별자, `VARCHAR(20)` PK |
| `store_name`, `branch_name` | `bizesNm`, `brchNm` | 상호명 필수, 지점명 선택 |
| `semas_industry_code`, `semas_industry_name` | `indsSclsCd`, `indsSclsNm` | 소진공 분류, 코드 `VARCHAR(8)`과 명칭 필수 |
| `ksic_code`, `ksic_name` | `ksicCd`, `ksicNm` | 표준산업분류, 코드 `VARCHAR(6)`과 명칭 선택 |
| `source_dong_code`, `dong_code` | `adongCd` | 최대 20자리 숫자 원문 보존. 연결된 동 코드는 같은 값의 8자리 FK, 연결할 수 없으면 NULL |
| `road_address`, `lot_address` | `rdnmAdr`, `lnoAdr` | 도로명·지번 주소, 선택 |
| `geom` | `lon`, `lat` | 선택적 WGS84 `Point`. 비어 있지 않은 유효 2차원 좌표 및 위·경도 범위 검사 |
| `source_batch_id` | ETL 배치 | 필수 `etl_batch` FK |

배치·행정동 조회에는 `(source_batch_id, dong_code)` B-tree를 사용합니다.

사각 영역 조회에는 `geom` GiST를 사용합니다.

미터 반경 조회에는 `(geom::geography)` GiST를 사용합니다.

적재는 전체 서울 수집의 검증을 거쳐 실제 출처를 반영합니다.

서비스는 최신 적격 배치에 속한 행만 조회합니다.

[카페 최신 목록 조건](API.md#카페-게시본)

## 관련 계약

- [행정구역 REST API 계약](API.md#행정구역-rest-api-계약)
- [공식 자치구 통계와 집계 정책](ETL.md#공식-자치구-통계와-집계-정책)
- [ETL 파일 검사와 게시 절차](ETL.md)
