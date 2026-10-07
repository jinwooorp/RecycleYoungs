# V2 공간 스키마 설계

확정일: 2026-10-07(Asia/Seoul). 로드맵 **2차 7단계 완료: V2 설계**의 source of truth입니다. 기준은 `main` / `10384c550044839b73df99d44262f4db22432755`이며 시작 working tree는 clean이었습니다. 현재 파일·Git 상태를 직접 확인했고 기존 세션의 미커밋 작업을 전제하지 않았습니다.

이 문서의 schema와 SQL은 **proposed DDL / query 설계 예시**입니다. production migration·Polygon ETL·Backend API는 아직 구현하지 않았습니다. 실제 구현된 schema의 기준은 계속 `backend/src/main/resources/db/migration/`이며, 8단계에서는 이 설계를 그대로 migration/ETL로 옮깁니다.

## 목표와 비목표

확정 범위는 행정동/상권 경계 저장, source와 operational 분리, 버전·provenance·품질·repair, 5181/GiST 조회, 좌표 판정의 cardinality, 기존 업종 매핑 재사용, populated/fresh DB 보존 migration입니다. 7단계에 필요한 미결 설계는 없습니다.

실제 SQL migration 파일 생성, production DB 연결, ETL 실행, API/Frontend 구현, 원본·manifest·dependency 변경은 이번 범위에 없습니다. 통계 전체의 범용 metadata catalog·다중 점포 스냅샷 플랫폼도 만들지 않습니다. 10단계 반경 전용 index와 점포 스냅샷 metadata는 그 단계의 별도 migration 범위입니다.

원본 ZIP/SHP/CSV가 provenance의 최종 archive입니다. DB geometry는 그 파일을 해석한 서비스/audit 표현이며 원본 bytes 전체를 대체하지 않습니다. API 요청은 DB만 조회하고 CSV/SHP/manifest·검증 report 파일을 읽지 않습니다.

## 현재 V1 제약

| 확인 대상 | 현재 파일에서 확인한 제약 / 유지 정책 |
| --- | --- |
| 테이블 | `industries`, `industry_mappings`, `commercial_areas`, `store_stats_dong`, `sales_dong`, `sales_commercial_area`, `stores`의 7개 |
| `commercial_areas` | 상권 code UNIQUE, `location GEOMETRY(POINT,4326)`는 **대표점**. 표시/참조에 유지하며 경계나 centroid로 재해석하지 않음 |
| `stores` | `source_store_id` UNIQUE, 원본 소분류 보존, nullable `industry_id` FK가 이미 있음. `location GEOMETRY(POINT,4326)` 유지 |
| 업종 | `industries.code` UNIQUE; mappings는 `UNIQUE(source,source_code)`와 industry FK. V1은 SEOUL 4개만 seed, SEMAS는 없음 |
| 통계 | 지역 code·원본 업종·분기 UNIQUE. nullable metric, INTEGER/BIGINT 유지. boundary FK는 현재 없음 |
| 인덱스 | 대표점/점포 POINT GiST, stores 소분류/dong B-tree, 기존 통계 복합 lookup 등 V1 그대로 유지 |
| Backend | JdbcClient SQL 직접 조회. `AdminDongRepository`는 `im.source='SEOUL'`로 매핑을 한정하고 lookup·무결성 검사 및 code 기반 통계를 조회 |
| transaction / Flyway | Service는 읽기 전용 REPEATABLE READ. Spring/standalone Flyway가 동일 V1 사용, 자동 baseline=false·clean-disabled=true·SQL init=never |
| 현재 ETL 주의점 | 상권/점포 loader에 전체 교체 구문이 있음. 이를 **기존 DB migration 경로에 사용하지 않음**. `etl_stores.py`는 industry_id에 의도적으로 None, `load_industry_map()`은 `(source,source_code)` dict를 이미 지원 |

V1을 수정하거나 기존 column/table을 rename/drop하지 않습니다. 대표 POINT·통계·점포를 경계 table로 옮기지 않습니다. 이번에 개발 DB에 연결하지 않았으므로 현재 DB의 stores 행 수를 확인했다고 주장하지 않습니다. 554,092/22,739는 검증된 **원본 스냅샷 기대치**이며 migration은 0행/부분 적재/전체 적재에 모두 동작해야 합니다.

## 확정 데이터/검증 상태

[데이터 목록](data-catalog.md)과 [현재 검증 기록](project-status.md)의 최종 후속 결과를 적용합니다. 과거 검사 절차·일자별 미완료 기록을 최종 상태로 해석하지 않습니다.

| 입력 | 확정 상태 / DB 적재 기대값 |
| --- | --- |
| OA-22160 | EPSG:5181, 2D Polygon 425, valid 425, 통계 code/name 425 일치. VALID_SOURCE 425 |
| OA-15560 | 1,650 feature: source Polygon 1,561 / MultiPolygon 89. raw valid 1,644 / invalid 6. VALID_SOURCE 1,644 + REPAIRED_OPERATIONAL 6 |
| 알려진 repair | `3110137`, `3110270`, `3110234`, `3110407`, `3110515`, `3110542` 모두 ACCEPTABLE. linework 결과 valid/non-empty Polygon, hole 의미 유지, non-polygon 0 |
| 공간 판정 제약 | OA-22160 작은 양의 면적 중첩 13쌍, 최대 약 0.024527336747m². geometry를 snap/round/trim해 없애지 않고 다중 매칭으로 노출 |
| 역사적 호환 | 전체 **B**, 4단계 미완료 known limitation, MVP blocker 아님. OA-22160을 2025 통계 당시의 정확한 역사적 경계라고 주장하지 않음 |
| 홍지문 `3110531` | valid source MultiPolygon, **H5**. SHP `SIGNGU_CD=11110`, `ADSTRD_CD=11410660`의 계층 모순을 geometry quality와 분리 |
| SEMAS | 파일명 기준 2026-06 서울 554,092점포, I21201 22,739개 고유 점포, CAFE 좌표 문제 0. `CAFE → SEMAS / I21201` 검증 완료, DB/ETL 미반영 |

OA-15560의 5181→4326 대표 8점 검산·전체 1,650점 sanity/독립 투영 수치 검증은 완료입니다. 현재 공식 영역 CSV와 보관 CSV의 byte/SHA 동일성도 확인됐습니다. 공식 SHP ZIP은 별도로 고정한 입력이며 CSV와 같은 bytes인 파일이 아닙니다. 최초 다운로드/배포 이력·역사적 경계 기준일은 여전히 미확인이고 홍지문 귀속의 원인도 해결되지 않았습니다.

## 대안 비교와 최종 결정

| 항목 | 선택안과 근거 | 비교한 대안과 비용 |
| --- | --- | --- |
| A. boundary table | **`admin_dong_boundaries` / `commercial_area_boundaries` 분리**. code와 1개 해석/복수 membership semantics를 각각 명시 | 범용 단일 table은 nullable code·종류별 CHECK·FK·분기를 늘리고 잘못된 공통 처리 위험 |
| B. geometry row | **같은 version/feature row에 source + operational**. 해시·repair·코드 연결을 한 key로 audit | 별도 raw/operational table은 1:1 연결·누락·품질 전이 관리가 추가됨. 약 2,075 feature에서는 중복 저장보다 단순성 우선 |
| C. provenance | **`spatial_dataset_versions` 별도 table**. ZIP hash·날짜·처리 profile을 version마다 한 번 기록 | row마다 metadata 반복은 날짜/도구 버전 불일치와 저장 중복을 만듦 |
| D. SRID | **source와 operational 모두 5181**. 검증 평면 보존, 입력 POINT만 transform해 GiST 이용 | 4326 Polygon 저장은 source 평면과 달라지고 미터 진단/repair 대응이 어려움. 이중 CRS Polygon 저장/변환 index도 현재 불필요 |
| E. 점포 업종 | **stores.industry_id materialization**. 기존 column·FK 사용, 미래 경쟁 점포 query 단순화 | 매 query mappings join은 가능하지만 이미 있는 materialization을 계속 NULL로 남기고 조회마다 source 조건을 반복 |
| version cardinality | **surrogate id + UNIQUE(dataset_version_id,code)**, 과거 version 보존 | code PK + 현재 version만 유지하면 같은 code의 다른 경계를 DB에서 재현하지 못함 |
| current 선택 | **dataset version의 is_current + 종류별 partial UNIQUE** | feature별 active는 여러 version을 섞을 수 있음. 환경 설정으로 version만 고정하면 DB readiness·전환의 원자성이 약함 |
| quality type | **VARCHAR(30) + CHECK** | PostgreSQL enum은 상태 변경/정정 시 type migration의 관리 비용이 더 큼. CHECK도 명시 migration으로 변경 |
| 홍지문 source 속성 | **source_* code 2개와 속성 상태 보존**, canonical FK 없음 | 속성을 아예 미적재하면 안전하지만 H5 원인을 DB metadata에서 확인하기 어려움. 이름/전체 DBF는 archive에 남겨 복제 범위 제한 |
| 통계/대표점 FK | **V1 테이블과 application code join** | 통계→현재 경계 FK는 버전 key를 표현하지 못하고 역사적 동일성도 증명하지 않음. 대표점 FK는 fresh 적재 순서/다른 version code에 불필요한 의존 |
| migration | **V2 schema / V3 SEMAS reference + 최소 backfill** | 한 V2에 모두 넣으면 공간 DDL과 기존 대량 table 갱신의 실패/잠금 범위가 섞임 |

선택은 모두 MVP의 확정안입니다. geometry의 type·좌표·순서를 임의 정규화하는 범용 플랫폼을 추가하지 않습니다.

## provenance 구조

### spatial_dataset_versions

한 row는 **원본 ZIP + 고정 처리/검증 profile로 만든 경계 version**입니다. 이름의 versions는 공식 경계 기준일의 증명이 아니라 서비스에서 재현 가능한 버전 식별을 의미합니다. 같은 ZIP도 parser/repair 규칙·도구·검증 근거가 달라지면 새 version을 만듭니다.

| column | type | nullable / 기본값 | 제약 / 의미 |
| --- | --- | --- | --- |
| id | BIGSERIAL | N | PK, 내부 version id |
| boundary_kind | VARCHAR(30) | N | ADMIN_DONG / COMMERCIAL_AREA CHECK |
| dataset_id | VARCHAR(30) | N | 각각 OA-22160 / OA-15560. kind와 조합 CHECK |
| dataset_name | TEXT | N | 공식 이름, 비공백 |
| source_url | TEXT | N | 공식 dataset page URL, 비공백; 실제 form/다운로드 경로는 report |
| source_file_name | TEXT | N | 공식 원본 ZIP 이름, 비공백 |
| source_file_sha256 | VARCHAR(64) | N | 원본 ZIP bytes의 소문자 hex SHA-256 |
| source_crs | INTEGER | N | EPSG 숫자 5181 CHECK, 이 설계는 5181 입력만 지원 |
| downloaded_at | TIMESTAMPTZ | Y | 실제 확보 완료 시각. 확인 불가면 NULL, 검사일로 대체 금지 |
| source_file_modified_date | DATE | Y | 공식 페이지의 ZIP 파일 수정일. ZIP member timestamp와 구분 |
| source_data_updated_date | DATE | Y | 공식 페이지의 데이터 갱신일. 실제 경계 기준일 아님 |
| reference_date | DATE | Y | 공식 근거로 확인된 실제 경계 기준일만 저장 |
| reference_date_verified | BOOLEAN | N / false | `reference_date_verified = (reference_date IS NOT NULL)` CHECK. 미확인 날짜를 추측해 저장하지 않음 |
| historical_compatibility_status | VARCHAR(20) | N / UNRESOLVED | UNRESOLVED / VERIFIED CHECK. reference_date 확인과 통계 연결 검증을 별개로 취급 |
| historical_compatibility_notes | TEXT | N | 검증 대상 통계 기간·근거·한계. 현재 `SEOUL 20251~20254; unresolved; 전체 B/4단계 미완료; operational 사용` 명시 |
| validation_status | VARCHAR(30) | N | PASSED / PASSED_WITH_LIMITATIONS / REVIEW_REQUIRED / UNSUPPORTED CHECK. 현재 두 version은 PASSED_WITH_LIMITATIONS |
| validation_report_path | TEXT | N | 고정 report의 archive 기준 상대 경로. audit 참조만 하며 API 중 파일 읽기 금지 |
| validation_report_sha256 | VARCHAR(64) | N | 고정 acceptance report bytes의 SHA-256 |
| processing_profile_sha256 | VARCHAR(64) | N | 아래 profile의 canonical JSON bytes SHA-256 |
| processing_metadata | JSONB | N | version당 하나의 object. parser·serializer·ETL artifact hash·Python/pyshp/Shapely/GEOS/pyproj/PROJ/PostGIS 버전과 validation profile |
| feature_count | INTEGER | N | 양수 CHECK. 기대 논리 feature 수, 현재 425 또는 1650 |
| load_status | VARCHAR(10) | N / PENDING | PENDING / READY CHECK. ETL의 완전 적재 검증을 통과해야 READY |
| loaded_at | TIMESTAMPTZ | Y | READY 전환 시 `clock_timestamp()`; 성공 commit된 적재의 완료 준비 시각, commit의 정확한 시각이라고 주장하지 않음 |
| is_current | BOOLEAN | N / false | API operational current. READY + 허용 validation 상태만 가능 |
| notes | TEXT | N | 비공백. 이용허락/출처표시·전체 B·H5·알려진 중첩 등 원본별 한계 요약 |

추가 제약은 `UNIQUE(id,boundary_kind)`, `UNIQUE(dataset_id,source_file_sha256,processing_profile_sha256)`입니다. 첫 UNIQUE는 boundary의 종류를 검증하는 composite FK 대상입니다. 모든 SHA 필드는 `^[0-9a-f]{64}$`로 검사합니다. profile은 UTF-8, object key 정렬, 공백 없는 JSON(`sort_keys=True, separators=(",", ":"), ensure_ascii=False`)로 직렬화합니다. 실행 시각·loaded_at·DB id는 profile에서 제외합니다. 고정 validation report hash, source member hash, feature index/code/source WKB acceptance 목록과 repair 정책 식별을 profile에 포함합니다. 같은 고정 입력/profile 재실행은 같은 version이며, 새 검증/처리 근거는 새 version입니다.

현재 version의 provenance 입력은 다음과 같습니다. 날짜를 한 `version_date`로 합치지 않습니다.

| 항목 | OA-22160 | OA-15560 |
| --- | --- | --- |
| source ZIP SHA | `969f7033bd3609a5fd586790f5b2cfedc638d7647ef45c78f9c75e1dabf79f68` | `38bb8fab4e45a1171af4989cd7fa1275f68e5d644aa770f5431ce7ccc38384dd` |
| downloaded_at | 2026-10-07T14:17:09+09:00 | 2026-10-07T15:30:00+09:00 |
| source_file_modified_date | 2023-10-31 | 2023-10-23 |
| source_data_updated_date | 2026-09-11 | 현재 repository의 고정 provenance/report에서 확인된 값만 사용. 미확인 시 NULL |
| reference_date / verified | NULL / false | NULL / false |
| historical compatibility | UNRESOLVED, SEOUL 20251~20254 | UNRESOLVED, SEOUL 20251~20254 |

OA-15560의 source_data_updated_date는 현재 고정 provenance/report에서 확인한 값만 전사합니다. 확정값이 없으면 NULL입니다. 날짜를 추측하거나 다시 내려받지 않습니다.

### cardinality·current·immutability

- 각 boundary table은 version 안에서 code UNIQUE입니다. 다른 version에는 같은 code를 저장할 수 있습니다. source feature index는 SHP의 **0-based 순서**이며 version 안에서 UNIQUE입니다. 같은 code의 복수 feature나 미확인 CRS를 자동 union/절단하지 않습니다. 새 입력은 별도 profile 검증이 필요합니다.
- 종류별 `is_current` partial UNIQUE로 current는 **최대 1개**입니다. 아직 적재하지 않았다면 0개를 허용하고 API는 BOUNDARY_DATA_UNAVAILABLE로 정상적인 공간 0 matches와 구분합니다. 최신 id·다운로드일·파일 수정일로 자동 선택하지 않습니다.
- boundary row는 INSERT-only입니다. DB trigger는 UPDATE/DELETE와 READY version에 추가 INSERT를 거부합니다. source와 operational 및 row metadata가 모두 불변입니다. 재repair·quality 재판정은 새 profile/version에 INSERT합니다.
- provenance trigger는 DELETE와 identity/validation/processing metadata UPDATE를 거부합니다. PENDING→READY를 한 번만 허용하면서 해당 boundary table의 행 수=`feature_count`, 전 행 usable, 허용 validation 상태를 검사합니다. READY→PENDING과 READY의 loaded_at 변경은 거부하고 READY의 is_current 전환만 허용합니다. 새 version은 PENDING/non-current로 시작합니다.
- boundary INSERT trigger는 parent version을 `FOR UPDATE`로 읽고 PENDING만 허용합니다. publish와 동시 INSERT를 직렬화합니다. CHECK만으로 행 간 완전성·불변성을 보장할 수 없어 이 작은 공통 guard **2함수/3trigger**를 V2에 포함합니다.
- 수동 ETL은 종류별 `pg_advisory_xact_lock(726007,1)`(ADMIN_DONG) / `(726007,2)`(COMMERCIAL_AREA)를 얻고 전 feature INSERT·집계 검증·READY 전환·이전 current=false→새 current=true를 **한 transaction**에서 처리합니다. partial UNIQUE는 즉시 제약이므로 해제→활성 순서입니다. 실패하면 이전 current도 rollback됩니다. reader는 commit 전/후 상태만 보고 중간 current 부재를 보지 않습니다.
- 같은 identity의 기존 READY version은 모든 row hash/metadata 일치를 확인하고 INSERT/UPDATE 없이 재사용합니다. 필요한 current 전환만 transaction으로 수행합니다. 불일치를 upsert로 덮어쓰지 않습니다. 불완전 PENDING version도 삭제하지 않고 원인을 기록한 새 profile/version으로 처리합니다.

## admin_dong_boundaries

### 공통 column

다음 **12개 column은 두 boundary table 모두에 존재**합니다. `boundary_kind` 고정값만 다릅니다. nullable Y는 진단용 비usable version을 표현하며, usable row에는 quality CHECK로 geometry/hash를 필수로 요구합니다.

| column | type | nullable / 기본값 | 제약 / 의미 |
| --- | --- | --- | --- |
| id | BIGSERIAL | N | PK, 외부 행정동/상권 code를 대신하지 않음 |
| dataset_version_id | BIGINT | N | kind와 composite FK → versions(id,boundary_kind), cascade 없음 |
| boundary_kind | VARCHAR(30) | N / table 종류 | 고정값 CHECK, 다른 종류 dataset 연결 방지 |
| source_feature_index | INTEGER | N | 0 이상 CHECK, UNIQUE(dataset_version_id,source_feature_index) |
| source_geometry | GEOMETRY(GEOMETRY,5181) | Y | 2D, 원래 Polygon/MultiPolygon type 유지, invalid 허용. 진단 row의 다른 type/empty도 보존 가능 |
| operational_geometry | GEOMETRY(MULTIPOLYGON,5181) | Y | 2D, non-empty/valid CHECK, API membership 전용 |
| quality_status | VARCHAR(30) | N | VALID_SOURCE / REPAIRED_OPERATIONAL / REVIEW_REQUIRED / UNSUPPORTED CHECK |
| quality_detail | TEXT | Y | VALID_SOURCE 외에는 비공백 필수. source invalid reason·보류·미지원 이유 |
| repair_method | VARCHAR(30) | Y | repair row만 `make_valid`, 다른 status는 NULL |
| repair_parameters | JSONB | Y | repair row만 `{"method":"linework","keep_collapsed":true}` exact object. 전체 row에 범용 JSON을 넣지 않음 |
| source_geometry_sha256 | VARCHAR(64) | Y | source geometry가 있으면 필수, 아래 WKB hash 규칙 |
| operational_geometry_sha256 | VARCHAR(64) | Y | operational이 있으면 필수, ST_Multi 후 저장 geometry의 hash |

### 행정동 고유 column과 key

| column | type | nullable | 제약 / 의미 |
| --- | --- | --- | --- |
| dong_code | VARCHAR(10) | N | 전체 문자열 `^[0-9]{8}$` CHECK, 원문 code. UNIQUE(dataset_version_id,dong_code) |
| dong_name | VARCHAR(100) | N | SHP ADSTRD_NM, 비공백. 기존 통계 이름을 자동 변경하지 않음 |

`boundary_kind='ADMIN_DONG'`, code 입력은 ADSTRD_CD입니다. 425 source Polygon을 그대로 저장하고 operational만 ST_Multi합니다. 원래 type은 ST_GeometryType으로 조회할 수 있어 중복 type column은 만들지 않습니다.

`store_stats_dong`·`sales_dong`에서 current boundary로 물리 FK를 추가하지 않습니다. code join은 운영용 경계를 이용한 통계 조회이며 역사적 집계 영역의 증명이 아닙니다. 9단계는 resolved dong_code를 기존 SEOUL 통계 lookup에 전달하고 lookup 부재/통계 NO_ROW를 별도 상태로 처리합니다. geometry가 해결됐는데 통계가 없다는 이유로 OUTSIDE를 반환하지 않습니다. 공간 응답에 B/unresolved metadata를 제공하고 기존 code 기반 5 API 계약은 유지합니다.

## commercial_area_boundaries

공통 12개 column에 다음 6개를 추가합니다.

| column | type | nullable / 기본값 | 제약 / 의미 |
| --- | --- | --- | --- |
| commercial_area_code | VARCHAR(20) | N | 전체 문자열 `^[0-9]{1,20}$` CHECK, TRDAR_CD 원문. UNIQUE(dataset_version_id,commercial_area_code) |
| source_name | VARCHAR(254) | N | TRDAR_CD_N 원문, 비공백. CSV와 다른 이름 3건을 자동 교정하지 않음 |
| source_sigungu_code | VARCHAR(10) | Y | SIGNGU_CD raw 속성, canonical FK/소속 판정 아님 |
| source_dong_code | VARCHAR(10) | Y | ADSTRD_CD raw 속성, commercial_areas.dong_code와 자동 동기화 금지 |
| source_attribute_status | VARCHAR(30) | N / UNVERIFIED | UNVERIFIED / CONFLICT_OBSERVED CHECK, geometry quality와 별개 |
| source_attribute_detail | TEXT | Y | CONFLICT_OBSERVED이면 비공백 필수, UNVERIFIED이면 NULL |

`boundary_kind='COMMERCIAL_AREA'`입니다. 나머지 DBF 이름/수치 속성은 archive/report에 남기며 전체 JSON을 복제하지 않습니다. source code 두 개는 검증된 canonical 관계로 제공하거나 지역 filter에 사용하지 않습니다. 현재 확인된 홍지문만 CONFLICT_OBSERVED이며 detail은 `H5; SIGNGU_CD=11110 / ADSTRD_CD=11410660; 계층 불일치, 원인 미확인`을 기록합니다. 다른 feature의 UNVERIFIED는 모순 없음의 보증이 아닙니다.

`commercial_areas`와 `sales_commercial_area`에도 새 FK를 추가하지 않고 code join합니다. 대표 POINT로 경계를 재구성하거나 경계에서 대표 POINT/dong 속성을 재계산하지 않습니다. 경계 이름과 대표점 catalog 이름의 출처를 구분합니다. current geometry membership은 대표점/매출 row가 없어도 반환하고 관련 통계 부재는 별도로 표현합니다.

## geometry/SRID 정책

**source_geometry / operational_geometry 모두 5181로 확정**합니다. source generic geometry typmod로 Polygon/MultiPolygon의 원래 type을 보존합니다. 5181 외 CRS·Z/M 등 미검증 입력은 이 2D schema에 억지로 넣지 않고 batch를 중단하며 archive/report에 이유를 기록합니다. ST_SetSRID 변경·ST_Force2D로 문제를 감추지 않습니다.

operational은 2D MultiPolygon입니다. valid source Polygon→ST_Multi, valid MultiPolygon→그대로(같은 WKB)입니다. valid 상권 1644와 행정동 425에는 make_valid를 호출하지 않습니다. 검증된 invalid 6건만 지정 linework의 Polygon 결과를 ST_Multi합니다. snap/round/buffer fallback은 없습니다.

API는 4326 `longitude, latitude` 순서로 ST_MakePoint하고 query 내 POINT 하나를 5181로 ST_Transform합니다. 경계 column을 transform하지 않아 저장된 5181 GiST를 사용할 수 있습니다. ST_Covers는 bbox index 검색을 포함합니다. 작은 table에서는 planner의 Seq Scan 선택도 정당하며 강제 Index Scan을 production 설정으로 쓰지 않습니다. 근거는 [ST_Transform 공식 문서](https://postgis.net/docs/ST_Transform.html), [ST_Covers 공식 문서](https://postgis.net/docs/ST_Covers.html)와 아래 spike입니다.

## quality/repair metadata

| quality_status | 필수 상태 | query 사용 |
| --- | --- | --- |
| VALID_SOURCE | source non-null/non-empty/valid Polygon 또는 MultiPolygon, operational valid MultiPolygon, ST_Multi(source)와 WKB bytes 일치. detail/method/parameters는 NULL | usable |
| REPAIRED_OPERATIONAL | source non-empty/invalid Polygon 또는 MultiPolygon, operational non-null/valid/non-empty, method/parameters exact, detail에 invalid reason 필수 | acceptance를 통과한 profile만 usable |
| REVIEW_REQUIRED | operational/hash·repair metadata는 NULL, 비공백 detail 필수. source GeometryCollection 등 예상 밖 성분을 보존 | current publish 금지 |
| UNSUPPORTED | operational/hash·repair metadata는 NULL, 비공백 detail 필수. source NULL/empty/미지원 사유를 구분 | current publish 금지 |

source에 일괄 ST_IsValid CHECK를 걸지 않습니다. usable 품질 CASE는 `COALESCE(...,false)`로 감싸 SQL CHECK의 NULL=unknown에 의한 필수값 누락을 막습니다. geometry/hash는 둘 다 NULL 또는 둘 다 non-null+hash 일치여야 합니다. operational invalid/empty는 모든 status에서 금지합니다. 검토/미지원 geometry를 0이나 빈 usable polygon으로 숨기지 않습니다.

SHA는 **2D little-endian OGC WKB, SRID 미포함, ring/vertex 순서 normalize 없음**으로 확정합니다. DB CHECK는 `encode(sha256(ST_AsBinary(geometry,'NDR')),'hex')`이고 ETL도 같은 출력 규칙입니다. source SHA는 parser 이후 geometry WKB hash이며 SHP 파일 bytes hash와 다릅니다. SRID는 typmod/version으로 별도 보장합니다. [ST_AsBinary](https://postgis.net/docs/ST_AsBinary.html), [PostgreSQL 16 sha256](https://www.postgresql.org/docs/16/functions-binarystring.html)에 따라 pgcrypto 추가는 필요 없습니다.

기존 report의 repair 직후 **Polygon** WKB SHA와 DB 저장형 **MultiPolygon** operational SHA는 다를 수 있습니다. 8단계는 source SHA를 기존 acceptance와 대조하고 repair 직후 값은 report, ST_Multi 후 값은 DB에 기록합니다. ST_Equals는 byte 순서 차이를 검출하지 않으므로 bytes 검사와 공간 의미 검사를 구분합니다.

repair는 Shapely `make_valid(method="linework",keep_collapsed=True)`이며 검증된 버전 Shapely 2.1.2/GEOS 3.13.1, parser pyshp 3.1.6을 production 기준 profile로 고정합니다. 8단계는 현재 Python3.12 ETL image에서 이 의존성과 6건 재현을 검증합니다. 버전을 바꾸면 새 profile과 재검증이 필수입니다. [make_valid 공식 문서](https://shapely.readthedocs.io/en/2.1.2/reference/shapely.make_valid.html)의 linework는 예상 밖 component를 반환할 수 있어 호출 성공만으로 acceptance를 주지 않습니다.

6건 자동 수용은 고정 ZIP SHA+code+feature index+source WKB SHA+검증 report에 한정합니다. 예상 밖 GeometryCollection/line/point/의미 변화는 ST_CollectionExtract 등으로 자동 discard하지 않고 REVIEW_REQUIRED입니다. 비current 진단 version에 source와 이유를 표현할 수 있지만 **정상 publish batch는 이상 시 rollback하여 이전 current를 유지**하고 실패 report를 archive에 남깁니다. 검토용 PENDING version의 수동 보존은 별도 작업이며 불완전 version을 current로 올리지 않습니다.

## SEMAS CAFE mapping

새 mapping schema 없이 V3에서 기존 `industry_mappings`에 `('SEMAS','I21201', industries.code='CAFE'의 id)` 한 행을 추가합니다. 숫자 id는 hard-code하지 않습니다.

CAFE id 존재를 검증하고 같은 source/code가 이미 CAFE이면 동등한 입력으로 허용합니다. 다른 industry이면 **V3 전체 실패**입니다. `ON CONFLICT DO NOTHING`으로 충돌을 감추지 않고 insert 후에도 일치를 assert합니다. SEOUL/CS100010과 나머지 SEOUL 3개 mapping은 유지합니다. Backend의 SEOUL filter를 그대로 두므로 기존 통계의 단일 SEOUL mapping 계약도 유지됩니다.

I21201의 공식 통합 범주 전체를 사용하고 KSIC/상호명으로 추가 filter하지 않습니다. CAFE 외 SEMAS mapping은 추가하지 않습니다. 근거와 파일 hash는 [6단계 기록](data-catalog.md#semas-cafe-6단계-검사-결과)에 있습니다. SEMAS reference row를 공간 경계 provenance table에 억지로 넣지 않습니다.

## stores industry_id 전략

**A 선택: V3 mapping insert + 기존 stores 최소 backfill.** mapping만 추가하고 ETL 재실행을 기다리는 B는 기존 CAFE가 NULL로 남습니다. 현재 full loader 재실행은 row id/POINT를 보존할 migration에 필요 없습니다. 매 query join하는 C보다 기존 industry_id를 사용한 조회가 단순합니다.

V3는 `source_small_category_code='I21201' AND industry_id IS NULL`만 CAFE id로 UPDATE합니다. 이미 CAFE이면 무변경, 다른 industry이면 중단합니다. 다른 code·통계·source id·POINT·원본 속성은 보존합니다. 원본과 같은 554092행에 모든 I21201이 NULL이면 22739건 갱신을 기대하지만 migration에 이 수를 고정 assert하지 않습니다. 실제 대상 count와 갱신 count를 비교하여 fresh/부분 적재도 처리합니다.

8단계 store ETL은 동일 transaction 시작에 `load_industry_map(conn)`을 한 번 읽고 `industry_map.get(('SEMAS',source_small_category_code))`를 사용합니다. 미매핑 code는 NULL입니다. 시작 전에 SEMAS/I21201→CAFE 존재/일치를 assert하고 source를 생략하지 않습니다. 기존 full loader를 기존 DB backfill 경로로 실행하지 않도록 운영 절차에 명시합니다.

mapping 변경을 자동 추종하는 stores trigger는 추가하지 않습니다. 후속 mapping 개정은 대상 backfill과 ETL 정책을 별도 migration에서 함께 변경합니다. 8단계 fixture는 ETL 재실행 후 분류도 확인합니다. 이번 ETL 변경은 없습니다.

## 공간 query semantics

### SQL 기준형

9단계는 read-only REPEATABLE READ transaction에서 필요한 종류의 current READY version을 읽어 id를 고정합니다. current 부재는 BOUNDARY_DATA_UNAVAILABLE, 중복/불일치는 DATA_INTEGRITY_ERROR입니다. transform 실패를 0 matches로 바꾸지 않습니다.

```sql
-- proposed query: JdbcClient bind parameter. 아직 구현 API가 아님.
WITH p AS MATERIALIZED (
    SELECT ST_Transform(
        ST_SetSRID(ST_MakePoint(
            CAST(:longitude AS double precision),
            CAST(:latitude AS double precision)),4326),5181) AS geometry
)
SELECT b.dong_code,b.dong_name,b.dataset_version_id,
       b.quality_status,
       CASE WHEN ST_Contains(b.operational_geometry,p.geometry)
            THEN 'INTERIOR' ELSE 'BOUNDARY' END AS point_relation
FROM admin_dong_boundaries b CROSS JOIN p
WHERE b.dataset_version_id=:datasetVersionId
  AND b.operational_geometry IS NOT NULL
  AND ST_Covers(b.operational_geometry,p.geometry)
ORDER BY b.dong_code;
```

상권도 같은 predicate/version filter로 commercial_area_boundaries의 code/source_name을 반환합니다. ORDER BY는 후보 배열 표시 순서일 뿐이며 LIMIT 1·DISTINCT ON으로 임의 선택하지 않습니다. source_geometry를 조회하거나 여러 version의 경계를 섞지 않습니다.

API 입력은 longitude가 finite이고 `-180 <= longitude <= 180`, latitude가 finite이고 `-90 <= latitude <= 90`인지만 검증합니다. 별도의 하드코딩된 서울 사각 bbox를 API 입력 제한으로 두지 않습니다. 유효한 WGS84 좌표는 EPSG:4326 POINT를 생성하고 `ST_Transform(...,5181)`한 뒤 current operational geometry에 `ST_Covers`로 판정합니다.

current boundary가 존재할 때 0 matches는 `OUTSIDE_OR_UNSUPPORTED`, `reason=NO_COVERING_OPERATIONAL_BOUNDARY`, `resolved=null`, `candidates=[]`입니다. 이 결과만으로 서울 밖·원본 gap·hole·coverage 문제 중 하나라고 단정하지 않습니다.

기존 sanity bbox는 원본/ETL 데이터 품질 검사 범위이며 API query domain을 정의하지 않습니다. 향후 서비스의 명시적인 지역 제한이 필요하면 제품/API 계약에서 별도로 정의하고, 과거 데이터 품질 sanity bbox를 근거 없이 서비스 범위로 재사용하지 않습니다.

### 행정동: ST_Covers / 0·1·multiple

**ST_Covers 채택**입니다. POINT가 내부/경계선에 있으면 포함하고 hole 내부는 제외하며 hole ring은 경계입니다. ST_Contains는 경계선 POINT에 false라서 기존 vertex 검사 within=false/contains=false/covers=true와 대응하는 ST_Covers를 선택합니다. [Contains 공식 문서](https://postgis.net/docs/ST_Contains.html), [Covers 공식 문서](https://postgis.net/docs/ST_Covers.html).

| current version 내 match 수 | 의미 / 9단계 처리 |
| --- | --- |
| 0 | OUTSIDE_OR_UNSUPPORTED, reason=NO_COVERING_OPERATIONAL_BOUNDARY. 영역 밖/원본 gap 등의 원인을 단정하지 않고 resolved dong=NULL, candidates=[] |
| 1 | RESOLVED. dong code·version·quality·point_relation을 반환하여 기존 통계에 연결. 경계 위 단일 match도 BOUNDARY 관계 유지 |
| 2+ | AMBIGUOUS_BOUNDARY. 모든 candidate/point_relation 반환, resolved dong=NULL. 공유 경계와 미세 내부 중첩 13쌍 모두 해당. 통계 dong을 임의 선택하지 않음 |

공간 domain result와 version 부재/DB 실패를 구분합니다. 새 공간 응답은 유효 입력에 200+status/candidates, current 부재에 503, 무결성/DB 실패에 500으로 처리합니다. 정확한 endpoint/query/DTO를 9단계 API 계약에 옮기는 작업은 남아 있지만 predicate·cardinality·선택 규칙은 확정입니다. 기존 5 API의 HTTP 계약은 유지합니다.

epsilon buffer/snap/round를 도입하지 않습니다. 5181 vertex를 4326으로 왕복하면 투영/부동소수점 차이로 내외부에 이동할 수 있습니다. ST_Covers는 실제 5181 변환값에 엄밀하게 적용하며 측위 오차까지 포함한 경계 근처의 확정 소속을 보장하지 않습니다. 8단계 exact 5181 경계 fixture와 9단계 4326 입력 경계 근처 fixture를 구분합니다.

### 상권: 0..N membership

**0..N collection 반환**입니다. 1개는 그 상권 membership, 여러 개는 전체 membership입니다. 행정동의 AMBIGUOUS_BOUNDARY를 상권 다중 match에 적용하지 않습니다. 상권 overlap의 공식 의미/전수 분포는 미검증이므로 배타적 소속을 가정하거나 중복을 공식 의도/오류로 단정하지 않습니다.

current가 있을 때 0개는 `memberships=[]` (`NO_MEMBERSHIP`), source 행정구역 속성으로 fallback하지 않습니다. 복수 상권 통계를 합쳐 단일 통계로 만들지 않습니다. 각 membership에 code/source_name·version·quality·point_relation을 제공하고 통계 연결/홍지문 H5는 별도 metadata로 전합니다. 분석 대상으로 한 상권을 택하는 기능은 명시 선택으로 처리합니다.

## index 전략

| table / index | 목적 / 결정 |
| --- | --- |
| versions PK(id) | 단일 version lookup |
| versions UNIQUE(id,boundary_kind) | composite FK, parent 종류 무결성 |
| versions UNIQUE(dataset_id,source_file_sha256,processing_profile_sha256) | 같은 입력/profile 재실행, leading dataset_id lookup 겸용 |
| versions partial UNIQUE(boundary_kind) WHERE is_current | 종류별 current 최대 1개, selector |
| boundary PK(id) | 내부 row lookup |
| boundary UNIQUE(dataset_version_id,code) | 현재 code/해당 version 전체 lookup 겸용. 중복 단독 code/version B-tree 없음 |
| boundary UNIQUE(dataset_version_id,source_feature_index) | 원본 feature 중복 방지/audit |
| 각 boundary `USING GIST(operational_geometry) WHERE operational_geometry IS NOT NULL` | operational PIP, query에도 IS NOT NULL 명시 |

source GiST·4326 파생 Polygon/transform functional index·quality B-tree는 만들지 않습니다. V2에서 빈 새 table에 일반 CREATE INDEX를 사용하고 CONCURRENTLY는 필요 없습니다. 8단계 실제 load 후 ANALYZE/EXPLAIN을 확인합니다. spike의 Seq Scan 비활성화는 index 접근 가능성 확인에만 사용했습니다.

10단계는 `stores.location::geography`+functional GiST 또는 5181 projected POINT의 거리/성능을 측정하여 결정합니다. 4326 geometry degree 거리를 미터로 사용하지 않습니다. **radius index와 stores.industry_id 단독 index는 V2/V3에서 제외**합니다. 기존 POINT GiST/소분류 B-tree를 유지하고 필요한 radius index는 후속 migration입니다.

## Flyway migration 분할

**V2 공간 schema / V3 SEMAS reference data와 최소 backfill**을 8단계에서 구현합니다. 원본 provenance/geometry row는 migration에 넣지 않고 수동 Polygon ETL로 적재합니다.

| 순서 | migration / 처리 |
| --- | --- |
| V2-1 | spatial_dataset_versions, CHECK/UNIQUE/current partial UNIQUE |
| V2-2 | 두 boundary table, kind composite FK·geometry/quality/hash CHECK·UNIQUE |
| V2-3 | operational partial GiST 2개 |
| V2-4 | boundary INSERT-only 및 version lifecycle/complete publish guard 2함수/3trigger |
| V3-1 | 동일 transaction에서 industry_mappings/stores에 SHARE ROW EXCLUSIVE lock. 동시 ETL/다른 writer 차단, reader 허용 |
| V3-2 | CAFE id 존재·기존 SEMAS/I21201·대상 stores의 non-null conflicting id 검사. 충돌이면 전체 실패 |
| V3-3 | SEMAS/I21201→CAFE 추가, insert 후 mapping 일치 assert |
| V3-4 | I21201+NULL만 backfill, 갱신 전 대상 count=갱신 count와 대상 NULL/불일치 잔존 0 assert |

Flyway 기본 transaction은 **script별**입니다. V2 성공/V3 실패 시 V2 schema가 남고 V3 reference/backfill은 rollback됩니다. 둘을 합친 원자성을 보장하지 않습니다. V3 실패는 기능 ready로 공개하지 않고 원인을 해결하여 미적용 V3를 재실행합니다. group=true나 executeInTransaction=false는 필요 없습니다. [Flyway transaction 공식 문서](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/migration-transaction-handling).

성공한 V1/V2/V3 checksum을 변경하지 않고 이후 변경은 후속 migration입니다. 기존 baseline1을 유지하며 재baseline하지 않습니다. 새 DDL은 IF NOT EXISTS로 불일치를 숨기지 않고 versioned migration에서 한 번만 생성합니다. migration에 파일 읽기/다운로드/repair/full ETL은 포함하지 않습니다.

## existing DB migration

**V1 populated → V2 → V3 → 새 boundary ETL**입니다. 실행 전에 접속 identity·Flyway history/validate·V1 구조·backup을 확인하고 stats/sales 전 행 및 stores/commercial_areas의 건수·id 포함 checksum·POINT WKB/NULL 수를 기록합니다. 이는 향후 절차 설계이며 이번 기존 DB SELECT는 없습니다.

V2는 새 object만 추가합니다. V3는 대상 industry_id만 변경합니다. 통계 행 수/전체 checksum·상권 대표 POINT/id·stores의 industry_id 제외 전 값/id를 전후 비교합니다. I21201은 CAFE, 다른 code는 이전 값과 동일해야 합니다. 기존 sequence를 재발급하지 않습니다.

새 Polygon ETL만 실행하고 V1 full commercial_areas/stores job을 migration/backfill로 사용하지 않습니다. 기존 대표 POINT/dong 속성/통계값을 경계로 덮어쓰지 않습니다. 기존 volume을 유지하고 삭제·초기화·재생성 없이 적용합니다.

## fresh DB

**empty PostgreSQL → V1 → V2 → V3 → 변경된 ETL**입니다. baseline은 사용하지 않습니다. V3가 CAFE mapping을 추가하고 backfill은 0건이며 이후 stores ETL이 I21201을 materialize합니다. 기존 SEOUL 통계 ETL은 V1의 키/값을 유지합니다.

Polygon ETL은 고정 ZIP/profile을 대조하여 425/1650 row를 source+operational로 INSERT하고 종류별 READY/current로 올립니다. 대표점 CSV 적재는 독립적이며 경계에서 생성하지 않습니다. existing과 source key·값·CAFE 분류·geometry/profile/current가 논리적으로 같아야 합니다. surrogate id/sequence 번호/loaded_at의 일치는 요구하지 않습니다.

V2/V3만 적용한 DB에는 경계가 없으므로 current 부재와 정상 공간 0 matches를 구분합니다. 현재 stores ETL을 그대로 실행하면 NULL로 되돌아가므로 8단계는 migration과 ETL 변경을 함께 완료한 뒤 새 경로를 사용합니다.

## 검증 계획

### 이번 isolated DDL spike

프로젝트 밖 `/tmp/ry-spatial-schema-g5J45k/`의 임시 DDL/합성 fixture만 사용했습니다. container `ry-spatial-schema-g5j45k`, image `postgis/postgis:16-3.4`, network none, host port 없음, data/init-dir tmpfs, named volume/bind mount 없음입니다. 전용 spatial_schema_spike / spatial_existing_spike / spatial_fresh_spike DB의 Unix socket에 docker exec로 연결했습니다. 기존 DB 연결/ETL 실행은 없습니다.

| 실험 | 실제 결과 |
| --- | --- |
| V1→proposed DDL | PostgreSQL16.4/PostGIS3.4.3/GEOS3.9.0/PROJ7.2.1에서 3table·2guard 함수·3trigger·모든 CHECK/UNIQUE/GiST 생성 성공 |
| typmod / quality | operational POINT/source4326 거부, invalid source의 repair row 수용, GeometryCollection source를 REVIEW_REQUIRED로 보존 |
| hash / NULL | NULL hash 누락·잘못된 WKB hash·review 이유 누락 거부, pgcrypto 추가 없이 core sha256 사용 |
| version / FK | 같은 version 중복 code 거부, 다른 version 동일 code 수용, 잘못된 kind composite FK 거부 |
| 불변성 / publish | boundary UPDATE/DELETE·sourcehash 변경·READY 뒤 추가/되돌림·PENDING current·누락/REVIEW version publish 거부 |
| current | 같은 종류 2current 거부, 해제→활성 전환 성공, 실패 주입 시 이전 current 보존 |
| PIP | exact5181 공유 경계 Covers2건/Containsfalse, 4326 입력→5181 내부1건, 외부0건 |
| index | enable_seqscan=off EXPLAIN에서 operational GiST Index Scan·bbox Index Cond·Covers Filter 확인. 실제 성능 보증은 아님 |
| 합성 populated | 점포3행 중 CAFE2행만 채움, 다른 code NULL 유지. stats/sales(2^53 초과 BIGINT 포함)/대표 POINT/점포 id·업종 외 전체 값을 양방향 EXCEPT로 보존 확인, 반복 backfill 동등 |
| 합성 fresh | V1 seed→reference/backfill로 CAFE/SEMAS/I21201 생성, stores0행 유지 |
| 충돌 / 원자성 | mapping/점포 industry 충돌 거부. transaction DDL 생성 뒤 division-by-zero를 주입하여 table 생성 rollback/부재 확인 |

첫 합성 보존 검사에 EXCEPT/UNION ALL 괄호 누락으로 오검출이 있었습니다. 최소 집합으로 원인을 재현하고 양방향 괄호 비교로 수정하여 새 전용 합성 DB에서 PASS했습니다. production schema/backfill 문제로 해석하지 않습니다. **실제 V2/V3 Flyway 실행·원본2075건 ETL·기존 DB 데이터 보존 검증은 아닙니다**. 기존 6건 acceptance의 재검증을 대신하지도 않습니다.

임시 container는 stop/--rm으로 제거했습니다. 기존 startup-analysis-postgres는 동일 ID `983e738d45ac`/healthy를 유지하며 DB/volume에 연결·mount·쓰기하지 않았습니다. 임시 script는 프로젝트 밖에만 있고 영구 근거는 이 기록입니다.

### 8단계 필수 수용 검증

1. 격리 fresh DB에서 실제 Flyway V1/V2/V3, populated V1 fixture에서 V2/V3 실행. history/validate·성공 checksum 불변·V3 실패 rollback과 V2 잔존 확인.
2. ZIP/member SHA·CRS/2D/type·code/name/index·WKB profile 대조. source는 행정동425Polygon, 상권1561Polygon/89MultiPolygon·valid1644/invalid6 유지. operational은425/1650 valid non-empty MultiPolygon, quality는425VALID_SOURCE와1644VALID_SOURCE/6REPAIRED_OPERATIONAL, review/unsupported0.
3. 6건 source WKB·repair 직후 Polygon/hole/linework/bbox·대표점/내부/hole/경계 관계를 기존 acceptance와 비교, ST_Multi 후 SHA 검사. 예상 밖 component 자동 discard 금지를 fixture로 확인.
4. 같은 입력 재실행은 동일 version/행/hash/current. 불변성·종류 FK·partial UNIQUE·미완성 publish 거부·중간 실패 rollback·전환 reader snapshot 검증.
5. 빈/부분/전체 stores와 non-null conflict로 V3 검증. 원본554092 적재 시 CAFE22739/미매핑NULL 및 재실행 동등. 기존 industry_id 외 값·통계·대표 POINT 보존.
6. 실제 load 후 ANALYZE/EXPLAIN, exact 경계·13쌍 중첩 근처·hole 내외 fixture. B/H5/이름 차3건/매출 없는73개를 geometry 오류로 바꾸지 않음.
7. 기존 DB 적용은 구현 단계에서 접속 identity/backup/전후 증거를 준비하여 진행. 이번 설계 기록을 적용 완료로 해석하지 않음.

## 후속 단계

| 단계 | 정확한 구현 범위 |
| --- | --- |
| 8 | V2 3table/제약/index/guard, V3 SEMAS mapping/최소 backfill, Polygon2종 명시 선택 ETL·profile/provenance 입력·INSERT-only/atomic current publish, stores ETL의 SEMAS materialization, parser/repair 의존성 고정과 fresh/populated/rollback/원본 수용 검증·운영 문서 |
| 9 | 확정 predicate/version/cardinality의 JdbcClient 공간 API 계약/구현·503/500/domain result, resolved dong→기존 stats/trend, B/H5/version/quality, 후보2~3곳/경계/복수 membership 검증. 요청 중 파일 읽기 없음 |
| 10 | 300m/500m/1km 거리·전용 index·점포 snapshot/provenance를 별도 migration에서 설계/측정. 2025 통계와2026-06 점포 시점 구분 |

**7단계 설계 완료, 8단계 미완료**입니다. B/4단계 미완료와 홍지문 H5는 known limitation이며 7→8을 막는 미결 schema/blocker는 없습니다.

## Proposed DDL 보충

다음은 합성 spike에서 생성 확인한 **설계 예시**입니다. V1/PostGIS 위에 추가할 새 object만 보여 줍니다. BEGIN/COMMIT은 spike의 transaction 경계이며 실제 Flyway SQL은 script transaction을 사용합니다. V3/reference/원본 geometry를 포함하지 않고 repository에 실행할 migration 파일을 만들지 않았습니다.

```sql
BEGIN;
CREATE TABLE spatial_dataset_versions (
 id BIGSERIAL PRIMARY KEY,
 boundary_kind VARCHAR(30) NOT NULL CHECK (boundary_kind IN ('ADMIN_DONG','COMMERCIAL_AREA')),
 dataset_id VARCHAR(30) NOT NULL,
 dataset_name TEXT NOT NULL CHECK (btrim(dataset_name) <> ''),
 source_url TEXT NOT NULL CHECK (btrim(source_url) <> ''),
 source_file_name TEXT NOT NULL CHECK (btrim(source_file_name) <> ''),
 source_file_sha256 VARCHAR(64) NOT NULL CHECK (source_file_sha256 ~ '^[0-9a-f]{64}$'),
 source_crs INTEGER NOT NULL CHECK (source_crs = 5181),
 downloaded_at TIMESTAMPTZ,
 source_file_modified_date DATE,
 source_data_updated_date DATE,
 reference_date DATE,
 reference_date_verified BOOLEAN NOT NULL DEFAULT false,
 historical_compatibility_status VARCHAR(20) NOT NULL DEFAULT 'UNRESOLVED'
   CHECK (historical_compatibility_status IN ('UNRESOLVED','VERIFIED')),
 historical_compatibility_notes TEXT NOT NULL CHECK (btrim(historical_compatibility_notes) <> ''),
 validation_status VARCHAR(30) NOT NULL CHECK (validation_status IN
   ('PASSED','PASSED_WITH_LIMITATIONS','REVIEW_REQUIRED','UNSUPPORTED')),
 validation_report_path TEXT NOT NULL CHECK (btrim(validation_report_path) <> ''),
 validation_report_sha256 VARCHAR(64) NOT NULL CHECK (validation_report_sha256 ~ '^[0-9a-f]{64}$'),
 processing_profile_sha256 VARCHAR(64) NOT NULL CHECK (processing_profile_sha256 ~ '^[0-9a-f]{64}$'),
 processing_metadata JSONB NOT NULL CHECK (jsonb_typeof(processing_metadata) = 'object'),
 feature_count INTEGER NOT NULL CHECK (feature_count > 0),
 load_status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (load_status IN ('PENDING','READY')),
 loaded_at TIMESTAMPTZ,
 is_current BOOLEAN NOT NULL DEFAULT false,
 notes TEXT NOT NULL CHECK (btrim(notes) <> ''),
 UNIQUE (id,boundary_kind),
 UNIQUE (dataset_id,source_file_sha256,processing_profile_sha256),
 CHECK ((boundary_kind='ADMIN_DONG' AND dataset_id='OA-22160') OR
        (boundary_kind='COMMERCIAL_AREA' AND dataset_id='OA-15560')),
 CHECK (reference_date_verified = (reference_date IS NOT NULL)),
 CHECK ((load_status='PENDING' AND loaded_at IS NULL AND NOT is_current) OR
        (load_status='READY' AND loaded_at IS NOT NULL)),
 CHECK (NOT is_current OR validation_status IN ('PASSED','PASSED_WITH_LIMITATIONS'))
);
CREATE UNIQUE INDEX uq_spatial_dataset_current ON spatial_dataset_versions(boundary_kind) WHERE is_current;
CREATE TABLE admin_dong_boundaries (
 id BIGSERIAL PRIMARY KEY,
 dataset_version_id BIGINT NOT NULL,
 boundary_kind VARCHAR(30) NOT NULL DEFAULT 'ADMIN_DONG' CHECK (boundary_kind='ADMIN_DONG'),
 dong_code VARCHAR(10) NOT NULL CHECK (dong_code ~ '^[0-9]{8}$'),
 dong_name VARCHAR(100) NOT NULL CHECK (btrim(dong_name) <> ''),
 source_feature_index INTEGER NOT NULL CHECK (source_feature_index >= 0),
 source_geometry GEOMETRY(GEOMETRY,5181),
 operational_geometry GEOMETRY(MULTIPOLYGON,5181),
 quality_status VARCHAR(30) NOT NULL CHECK (quality_status IN
   ('VALID_SOURCE','REPAIRED_OPERATIONAL','REVIEW_REQUIRED','UNSUPPORTED')),
 quality_detail TEXT,
 repair_method VARCHAR(30),
 repair_parameters JSONB,
 source_geometry_sha256 VARCHAR(64),
 operational_geometry_sha256 VARCHAR(64),

 FOREIGN KEY(dataset_version_id,boundary_kind) REFERENCES spatial_dataset_versions(id,boundary_kind),
 UNIQUE(dataset_version_id,dong_code),
 UNIQUE(dataset_version_id,source_feature_index),
 CHECK ((source_geometry IS NULL AND source_geometry_sha256 IS NULL) OR
        (source_geometry IS NOT NULL AND source_geometry_sha256 IS NOT NULL
          AND source_geometry_sha256 ~ '^[0-9a-f]{64}$'
          AND source_geometry_sha256 = encode(sha256(ST_AsBinary(source_geometry,'NDR')),'hex'))),
 CHECK ((operational_geometry IS NULL AND operational_geometry_sha256 IS NULL) OR
        (operational_geometry IS NOT NULL AND operational_geometry_sha256 IS NOT NULL
          AND operational_geometry_sha256 ~ '^[0-9a-f]{64}$'
          AND operational_geometry_sha256 = encode(sha256(ST_AsBinary(operational_geometry,'NDR')),'hex'))),
 CHECK (operational_geometry IS NULL OR
          (NOT ST_IsEmpty(operational_geometry) AND ST_IsValid(operational_geometry))),
 CHECK (CASE quality_status
 WHEN 'VALID_SOURCE' THEN COALESCE(
   source_geometry IS NOT NULL AND NOT ST_IsEmpty(source_geometry)
   AND ST_GeometryType(source_geometry) IN ('ST_Polygon','ST_MultiPolygon')
   AND ST_IsValid(source_geometry) AND operational_geometry IS NOT NULL
   AND ST_AsBinary(operational_geometry,'NDR') = ST_AsBinary(ST_Multi(source_geometry),'NDR')
   AND repair_method IS NULL AND repair_parameters IS NULL AND quality_detail IS NULL, false)
 WHEN 'REPAIRED_OPERATIONAL' THEN COALESCE(
   source_geometry IS NOT NULL AND NOT ST_IsEmpty(source_geometry)
   AND ST_GeometryType(source_geometry) IN ('ST_Polygon','ST_MultiPolygon')
   AND NOT ST_IsValid(source_geometry) AND operational_geometry IS NOT NULL
   AND repair_method='make_valid'
   AND repair_parameters='{"method":"linework","keep_collapsed":true}'::jsonb
   AND quality_detail IS NOT NULL AND btrim(quality_detail) <> '', false)
 ELSE operational_geometry IS NULL AND repair_method IS NULL AND repair_parameters IS NULL
   AND quality_detail IS NOT NULL AND btrim(quality_detail) <> '' END)
);
CREATE INDEX idx_admin_dong_boundaries_operational ON admin_dong_boundaries USING GIST(operational_geometry)
 WHERE operational_geometry IS NOT NULL;
CREATE TABLE commercial_area_boundaries (
 id BIGSERIAL PRIMARY KEY,
 dataset_version_id BIGINT NOT NULL,
 boundary_kind VARCHAR(30) NOT NULL DEFAULT 'COMMERCIAL_AREA' CHECK (boundary_kind='COMMERCIAL_AREA'),
 commercial_area_code VARCHAR(20) NOT NULL CHECK (commercial_area_code ~ '^[0-9]{1,20}$'),
 source_name VARCHAR(254) NOT NULL CHECK (btrim(source_name) <> ''),
 source_feature_index INTEGER NOT NULL CHECK (source_feature_index >= 0),
 source_geometry GEOMETRY(GEOMETRY,5181),
 operational_geometry GEOMETRY(MULTIPOLYGON,5181),
 quality_status VARCHAR(30) NOT NULL CHECK (quality_status IN
   ('VALID_SOURCE','REPAIRED_OPERATIONAL','REVIEW_REQUIRED','UNSUPPORTED')),
 quality_detail TEXT,
 repair_method VARCHAR(30),
 repair_parameters JSONB,
 source_geometry_sha256 VARCHAR(64),
 operational_geometry_sha256 VARCHAR(64),
 source_sigungu_code VARCHAR(10),
 source_dong_code VARCHAR(10),
 source_attribute_status VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED'
   CHECK (source_attribute_status IN ('UNVERIFIED','CONFLICT_OBSERVED')),
 source_attribute_detail TEXT,
 CHECK ((source_attribute_status='UNVERIFIED' AND source_attribute_detail IS NULL) OR
        (source_attribute_status='CONFLICT_OBSERVED' AND source_attribute_detail IS NOT NULL
         AND btrim(source_attribute_detail) <> '')),
 FOREIGN KEY(dataset_version_id,boundary_kind) REFERENCES spatial_dataset_versions(id,boundary_kind),
 UNIQUE(dataset_version_id,commercial_area_code),
 UNIQUE(dataset_version_id,source_feature_index),
 CHECK ((source_geometry IS NULL AND source_geometry_sha256 IS NULL) OR
        (source_geometry IS NOT NULL AND source_geometry_sha256 IS NOT NULL
          AND source_geometry_sha256 ~ '^[0-9a-f]{64}$'
          AND source_geometry_sha256 = encode(sha256(ST_AsBinary(source_geometry,'NDR')),'hex'))),
 CHECK ((operational_geometry IS NULL AND operational_geometry_sha256 IS NULL) OR
        (operational_geometry IS NOT NULL AND operational_geometry_sha256 IS NOT NULL
          AND operational_geometry_sha256 ~ '^[0-9a-f]{64}$'
          AND operational_geometry_sha256 = encode(sha256(ST_AsBinary(operational_geometry,'NDR')),'hex'))),
 CHECK (operational_geometry IS NULL OR
          (NOT ST_IsEmpty(operational_geometry) AND ST_IsValid(operational_geometry))),
 CHECK (CASE quality_status
 WHEN 'VALID_SOURCE' THEN COALESCE(
   source_geometry IS NOT NULL AND NOT ST_IsEmpty(source_geometry)
   AND ST_GeometryType(source_geometry) IN ('ST_Polygon','ST_MultiPolygon')
   AND ST_IsValid(source_geometry) AND operational_geometry IS NOT NULL
   AND ST_AsBinary(operational_geometry,'NDR') = ST_AsBinary(ST_Multi(source_geometry),'NDR')
   AND repair_method IS NULL AND repair_parameters IS NULL AND quality_detail IS NULL, false)
 WHEN 'REPAIRED_OPERATIONAL' THEN COALESCE(
   source_geometry IS NOT NULL AND NOT ST_IsEmpty(source_geometry)
   AND ST_GeometryType(source_geometry) IN ('ST_Polygon','ST_MultiPolygon')
   AND NOT ST_IsValid(source_geometry) AND operational_geometry IS NOT NULL
   AND repair_method='make_valid'
   AND repair_parameters='{"method":"linework","keep_collapsed":true}'::jsonb
   AND quality_detail IS NOT NULL AND btrim(quality_detail) <> '', false)
 ELSE operational_geometry IS NULL AND repair_method IS NULL AND repair_parameters IS NULL
   AND quality_detail IS NOT NULL AND btrim(quality_detail) <> '' END)
);
CREATE INDEX idx_commercial_area_boundaries_operational ON commercial_area_boundaries USING GIST(operational_geometry)
 WHERE operational_geometry IS NOT NULL;
CREATE FUNCTION guard_spatial_boundary_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state TEXT;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'boundary versions are insert-only'; END IF;
 SELECT load_status INTO state FROM spatial_dataset_versions
   WHERE id=NEW.dataset_version_id FOR UPDATE;
 IF state IS DISTINCT FROM 'PENDING' THEN RAISE EXCEPTION 'version is not pending'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_admin_boundary BEFORE INSERT OR UPDATE OR DELETE ON admin_dong_boundaries
 FOR EACH ROW EXECUTE FUNCTION guard_spatial_boundary_write();
CREATE TRIGGER guard_commercial_boundary BEFORE INSERT OR UPDATE OR DELETE ON commercial_area_boundaries
 FOR EACH ROW EXECUTE FUNCTION guard_spatial_boundary_write();
CREATE FUNCTION guard_spatial_dataset_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT; usable BIGINT;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'dataset versions are retained'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.load_status <> 'PENDING' OR NEW.is_current OR NEW.loaded_at IS NOT NULL THEN
     RAISE EXCEPTION 'new version must be pending';
   END IF;
   RETURN NEW;
 END IF;
 IF (to_jsonb(NEW) - ARRAY['load_status','loaded_at','is_current']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['load_status','loaded_at','is_current']) THEN
   RAISE EXCEPTION 'version metadata is immutable';
 END IF;
 IF OLD.load_status='READY' AND
    (NEW.load_status IS DISTINCT FROM OLD.load_status OR NEW.loaded_at IS DISTINCT FROM OLD.loaded_at) THEN
   RAISE EXCEPTION 'ready version is immutable';
 END IF;
 IF OLD.load_status='PENDING' AND NEW.load_status='READY' THEN
   IF NEW.boundary_kind='ADMIN_DONG' THEN
     SELECT count(*),count(*) FILTER (WHERE quality_status IN ('VALID_SOURCE','REPAIRED_OPERATIONAL'))
       INTO total,usable FROM admin_dong_boundaries WHERE dataset_version_id=NEW.id;
   ELSE
     SELECT count(*),count(*) FILTER (WHERE quality_status IN ('VALID_SOURCE','REPAIRED_OPERATIONAL'))
       INTO total,usable FROM commercial_area_boundaries WHERE dataset_version_id=NEW.id;
   END IF;
   IF total <> NEW.feature_count OR usable <> total OR
      NEW.validation_status NOT IN ('PASSED','PASSED_WITH_LIMITATIONS') THEN
     RAISE EXCEPTION 'version is incomplete or unsupported';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_spatial_version BEFORE INSERT OR UPDATE OR DELETE ON spatial_dataset_versions
 FOR EACH ROW EXECUTE FUNCTION guard_spatial_dataset_version();
COMMIT;
```
