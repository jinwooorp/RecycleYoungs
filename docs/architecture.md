# 아키텍처와 분석 정책

이 문서는 프로젝트의 책임과 목표 정책을 관리합니다. 구현 완료 항목은 [로드맵](roadmap.md), 실제 원본 범위는 [데이터 목록](data-catalog.md)을 확인합니다. 2차 7단계에서 확정한 공간 DB 설계의 source of truth는 [V2 공간 스키마 설계](spatial-schema-v2.md)이며 실제 migration/ETL 구현은 8단계입니다.

## 데이터 흐름

```text
공공데이터 파일 / 향후 공식 API 수집
                 ↓
          Python ETL 배치
                 ↓
      PostgreSQL + PostGIS
                 ↑
      Spring Boot 조회·분석 API
                 ↑ /api
      React 조건 입력·결과 표시
```

| 영역 | 책임 |
| --- | --- |
| ETL | 입력 검증, 출처별 변환, 업종·기간·좌표 정리, 적재 |
| PostgreSQL/PostGIS | 자료별 통계·점포·공간 정보 저장과 조회 |
| Spring | 입력 검증, DB 접근, 공간 기준 적용, 점수·근거 계산, API 응답 |
| React | 조건 선택, 로딩·오류·결측 상태, 지도·통계·비교 표시 |
| 루트 Compose | 공용 개발 DB, 선택 실행하는 ETL 컨테이너 |

사용자 API 요청 중 원본 CSV를 읽거나 ETL을 실행하지 않습니다. 화면은 DB에 직접 연결하지 않으며 점수를 별도로 다시 계산하지 않습니다. 초기 갱신은 수동 배치이며 자동 다운로드·스케줄러는 그 이후에 검토합니다.

## 현재 저장 구조

서비스 DB는 하나를 사용하고 자료별 테이블로 구분합니다. 스키마의 단일 기준은 `backend/src/main/resources/db/migration/`의 Flyway SQL입니다. 기존 `sql/001_schema.sql`은 내용 변경 없이 `V1__initial_schema.sql`로 이전했습니다. Spring과 독립 migration 명령이 같은 SQL을 사용하며 Compose는 초기 SQL을 실행하지 않습니다. 기존 DB는 V1 구조 대조 후 명시적 baseline 1로 편입했습니다.

Spring 조회는 JdbcClient로 SQL을 직접 작성합니다. 통계 ETL의 연도별 DELETE/재삽입으로 내부 `id`는 바뀔 수 있으므로 DB의 안정적인 조회 기준은 행정동 코드·서울시 업종 코드·분기입니다. [API 계약](api-contract.md)의 외부 식별자는 행정동 code·내부 업종 code·문자열 분기이며, 단일 서울시 매핑으로 DB 키와 연결합니다. surrogate `id`는 노출하지 않고 모호한 매핑을 임의 합산하지 않습니다. 행정동 lookup·단건 통계·추세 API 5개와 React 조건 선택·결과 표를 이 계약으로 연결했습니다.

React는 작은 fetch client·상태 hook·폼/결과 component로 나눕니다. lookup은 병렬 요청하고 명시적 조회 버튼으로 선택 분기 단건 통계와 같은 행정동·업종의 2025년 4분기 추세를 병렬 요청합니다. 두 요청은 결과·오류를 독립적으로 유지하고 하나의 AbortController를 공유하며 모두 끝날 때까지 중복 제출을 막습니다. 조건 변경·새 조회·unmount 시 이전 결과와 요청을 정리합니다. BIGINT는 상태에서 string을 유지하고 범위 검증·표시에 BigInt를 사용합니다. 행 없음·metric NULL·실제 0·요청 실패는 각각 구분합니다. 표현 계층은 Tailwind CSS v4와 shadcn/ui Button·Card를 점진 적용했으며 API/state logic과 native select·semantic table을 유지했습니다. 추세는 점포 5개·추정매출 4개 지표의 semantic table로 표시하며 모바일에서는 표 내부만 가로 스크롤합니다. 지도·Chart·metadata UI는 아직 없습니다.

현재 Backend 구현 API는 5개입니다. [추세 API 계약](api-contract.md#행정동-공통-4개-분기-추세-api)에 따라 `GET /api/admin-dong-trends`는 행정동·내부 업종을 받아 2025년 4개 분기의 기존 점포·추정매출 구조를 반환합니다. 하나의 읽기 전용 REPEATABLE READ transaction에서 기존 lookup·무결성을 확인한 뒤 두 테이블을 각각 한 번의 다중 분기 통계 SQL로 읽습니다. 분기별 NO_ROW를 생략하지 않고 BIGINT 문자열을 유지하며 중복 row 등 무결성 오류는 전체 요청을 실패시킵니다. Frontend도 응답의 고정 네 분기·code/label 순서·metric 범위·NO_ROW 일관성을 검증한 뒤 표시합니다. 새 환경의 vertical slice도 clean checkout·별도 fresh DB·V1 SQL migration에서 CSV → ETL → API → React까지 검증했습니다([재현 절차](reproduction.md)).

| 자료 | 키·공간 단위 |
| --- | --- |
| `store_stats_dong`, `sales_dong` | 행정동 코드 + 분기 + 서울시 서비스 업종 |
| `sales_commercial_area` | 상권 코드 + 분기 + 서울시 서비스 업종 |
| `commercial_areas` | 상권 코드·이름·원본 X/Y, 변환한 대표 `location GEOMETRY(POINT, 4326)` |
| `stores` | 출처 점포 식별자·원본 업종·점포 POINT, 파일명 기준 2026-06 스냅샷; `industry_id`는 NULL |
| `industries`, `industry_mappings` | 내부 업종과 출처별 원본 코드 연결 |

현재 자료의 행정동 매출과 점포 통계는 같은 425개 행정동·2025년 4개 분기를 제공합니다. 첫 기능은 이 공통 단위를 사용합니다. 상권 매출과 행정동 점포 통계를 같은 지역의 통계로 직접 합치지 않습니다.

## 공간 기준

최종 지도 분석에서 경쟁 점포 수·비율·밀집도는 후보 좌표 중심 300m·500m·1km 반경을 기준으로 합니다. 매출·인구·개폐업·시설은 공식 지역 코드 단위로 제공하며, 좌표 판정용 경계와 통계 당시 경계의 검증 수준을 구분합니다.

- 반경을 변경해도 공식 지역 집계값은 그대로일 수 있습니다. 지역 매출·인구를 반경 면적 비율로 임의 배분하지 않습니다.
- 현재 영역 CSV는 대표 지점과 면적만 제공하며 Polygon 경계가 없습니다. POINT만으로 후보 좌표의 포함 상권을 판정하지 않습니다.
- 미지원 경계·연결 불가 통계는 데이터 부족으로 표시합니다. 근처 상권 통계를 대신 넣지 않습니다.
- 경계선은 `ST_Covers`로 포함하고 행정동 다중 match는 전체 후보를 반환하는 `AMBIGUOUS_BOUNDARY`로 처리합니다. 상권은 `0..N` membership입니다. 원본 미세 중첩 13쌍을 snap/round로 제거하거나 `LIMIT 1`로 숨기지 않습니다. 구현 검증은 8·9단계입니다.
- 영역-상권 공식 CRS는 **EPSG:5181**입니다([확인 기록](data-catalog.md#좌표와-인구-자료의-한계)). 대표 8점의 변환/의미 검산과 전체 1,650점의 sanity·독립 투영 수치 검증은 완료했고, 현재 공식 영역 CSV와 보관 CSV의 byte/SHA 동일성도 확인했습니다. 최초 다운로드·배포 이력/역사적 경계 기준일은 미확인이고 홍지문 참조 예외는 H5입니다. 별도 공식 SHP ZIP의 검증과 CSV 동일성을 구분하며 `AREA_SOURCE_CRS`의 공란 기본값·미설정 시 적재 거부를 유지합니다.

MVP는 **행정동 Polygon 우선**입니다. 현재 vertical slice의 `store_stats_dong`·`sales_dong`과 목록·단건 stats·4분기 trend API가 425개 행정동·2025 Q1~Q4를 사용하므로, 향후 `후보 좌표 → operational 행정동 포함 판정 → dong_code → 기존 stats / trend`로 연결합니다. `sales_commercial_area`는 스키마·ETL 입력이 존재하지만 현재 통계 API의 중심이 아니며 상권 단위 점포 통계도 추가 확보가 필요합니다. 상권 Polygon은 5단계 operational geometry 검증을 완료했고 실제 DB 적재는 남아 있습니다.

MVP의 공간 경계는 다음 두 수준으로 구분합니다.

| 구분 | 의미와 현재 OA-22160의 사용 정책 |
| --- | --- |
| operational geometry | 현재 공식 제공 자료로서 geometry/code/name 검증을 통과한 OA-22160 행정동 Polygon을 향후 **좌표 → 행정동 API**의 공간 판정용 경계로 사용 |
| historically verified statistical boundary | 2025 점포/매출 통계의 실제 집계에 사용한 정확한 역사적 경계. OA-22160은 이 수준으로 검증되지 않았으며 해당 경계라고 주장하지 않음 |

2025 통계와 확보 Polygon의 행정동 code/name 425개는 일치하지만 경계 기준 시점·재집계 정책의 공식 근거는 **unresolved**입니다. 전체 공간 검증 **B**, 로드맵 **4단계 미완료**를 유지하면서 이 제약을 문서와 향후 데이터 provenance에 기록하고, MVP 공간 기능 구현의 blocker로 사용하지 않습니다. 공식 경계 기준이 후속 확인되면 provenance와 판정 정책을 갱신합니다.

홍지문 `3110531`은 **H5**를 유지합니다. 원인이 해결되기 전 OA-15560 상권 자료의 `SIGNGU_CD` 또는 `ADSTRD_CD` 중 어느 하나를 canonical 행정구역 속성으로 임의 선택하지 않습니다. 이 정책은 상권 Polygon 전체나 상권 코드 자체의 사용 금지를 의미하지 않습니다.

대표 지점과 실제 경계는 [7단계 설계](spatial-schema-v2.md)에서 다음처럼 분리하기로 확정했습니다. 아래 새 테이블은 아직 구현하지 않았습니다.

| 개념 | 역할 |
| --- | --- |
| `commercial_areas` | 상권 코드·이름·대표 POINT 유지; POINT와 면적만으로 경계를 재구성하지 않음 |
| `spatial_dataset_versions` | ZIP hash·처리/검증 profile·서로 다른 날짜·역사적 호환 상태·current version 관리 |
| `admin_dong_boundaries` | version + dong code, source geometry와 operational MultiPolygon 별도 보존 |
| `commercial_area_boundaries` | version + 상권 code, source geometry와 operational MultiPolygon·quality/repair·raw 행정구역 속성 보존 |

source/operational은 모두 **EPSG:5181**이며 source의 Polygon/MultiPolygon type·invalid 상태를 유지합니다. operational은 valid non-empty MultiPolygon입니다. OA-15560 valid 1644건은 repair하지 않고 검증된 invalid 6건만 `make_valid(method="linework", keep_collapsed=True)` 파생 geometry를 사용합니다. 예상 밖 component/의미 변화는 자동 discard 없이 REVIEW_REQUIRED입니다. raw를 repaired SHP로 덮어쓰지 않습니다.

version 안의 code/feature index는 UNIQUE이고 종류별 current는 partial UNIQUE로 최대 하나입니다. INSERT-only/lifecycle guard로 source·완료 version의 불변성과 완전 적재를 보장합니다. API는 4326 입력 POINT만 5181로 transform하여 operational partial GiST를 이용합니다. current 부재·0 match·단일 match·다중 match를 구분하며 V1 통계/대표점과는 FK 대신 code join합니다. 역사적 동일성을 주장하지 않고 B/unresolved metadata를 유지합니다. 실제 Flyway는 **V2 공간 schema / V3 SEMAS reference와 점포 최소 backfill**, 원본 적재는 별도 ETL로 구현합니다. 구체적인 column·제약·query·fresh/existing 경로와 isolated DDL spike 결과는 [설계 문서](spatial-schema-v2.md)에 있습니다.

## 업종·기간·출처

서울시 `서비스_업종_코드`와 소상공인 `상권업종소분류코드`는 서로 다른 체계입니다. 현재 DB에는 서울시 네 개만 매핑하고 `etl_stores.py`는 의도적으로 `industry_id`를 NULL로 저장합니다. 6단계에서 **`CAFE → SEMAS / I21201`의 데이터 검증을 완료**했지만 DB/ETL에는 아직 미반영입니다. 헬스장과 다른 SEMAS 업종은 미확정입니다.

V1의 `industry_mappings`와 `load_industry_map()`의 `(source, source_code)` 구조를 재사용합니다. V3에서 SEMAS/I21201→CAFE reference row와 기존 I21201/industry_id NULL 점포의 최소 backfill을 함께 적용하고, 향후 ETL은 SEMAS 소분류 mapping으로 materialize하며 미매핑 code는 NULL로 둡니다. I21201 전체를 공식 통합 범주에 따른 재현 가능한 MVP 경쟁군으로 사용하고 KSIC/상호명으로 재분류하지 않습니다. 현재 통계 API의 단일 SEOUL 매핑 규칙은 유지합니다([확정 설계](spatial-schema-v2.md#semas-cafe-mapping)).

2025 Q1~Q4 통계와 파일명 기준 2026-06 점포 스냅샷을 같은 기간의 관측값으로 취급하지 않습니다. 공간 조회 결과에서도 통계 분기·점포 스냅샷·경계 버전을 구분하며, 스냅샷에서 사라진 점포만으로 폐업을 판정하지 않습니다. 비교에 사용할 기준 분기는 후보지별로 따로 선택하지 않습니다. 향후 데이터 버전·원본 파일·적재 이력·점포 기준일을 DB에도 기록해야 합니다.

원본 출처·파일 해시·기간·인코딩·좌표계 확인 상태는 `data/manifest.json`과 데이터 목록에 남깁니다. 파일 교체 시 새 목록을 생성하고 변경 범위를 기록합니다.

기존 통계 API의 metadata 유예와 단위 계약은 유지합니다. 7단계의 `spatial_dataset_versions`는 공간 경계용 최소 provenance이며 통계 전체/점포 스냅샷 catalog를 대신하지 않습니다. 9단계 공간 응답은 DB의 실제 경계 version/quality/한계를 사용하고, 점포 스냅샷 metadata와 반경 index는 10단계에서 연결합니다. V2는 기존 첫 통계 조회의 필수 선행조건이 아니며 이번에는 설계만 확정했습니다. 이후에도 요청 중 CSV·manifest를 직접 읽지 않습니다.

## 점수와 후보 비교 — 구현 전 정책

초기 모델은 설명 가능한 규칙 기반으로 검토합니다. 다음 가중치는 검증 전 초안입니다.

| 항목 | 근거 | 초안 가중치 |
| --- | --- | --- |
| 시장 수요 | 인구·업종별 추정매출 | 30% |
| 경쟁 여유 | 동일 업종 점포 수·비율·밀집도 | 25% |
| 성장성 | 매출·점포·인구 변화와 개폐업 | 20% |
| 고객 적합도 | 연령·시간대 특성 | 15% |
| 접근성·집객 환경 | 공식 지역 내 교통·시설 통계 | 10% |

모든 점수는 높을수록 창업에 유리한 방향으로 맞춥니다. 같은 업종·기준 분기·공간 유형의 비교 집단으로 정규화하며 계산식·가중치·비교 집단을 모델 버전으로 관리합니다.

필수 자료가 없으면 해당 점수와 종합점수는 `null`로 반환하고 부족한 자료를 설명합니다. 결측을 0점으로 바꾸거나 후보지마다 가중치를 재분배하지 않습니다. 0~100점은 상대 평가이며 성공 확률이나 수익 예측이 아닙니다.

최대 3개 후보지의 비교는 업종·반경·연령대·분기·공간 유형·데이터 버전·모델 버전을 동일하게 맞춥니다. API에는 기준 지역·원지표·기간·출처·결측 사유를 포함하고, 관련 버전은 DB 관리가 구현된 뒤 실제 값으로 제공합니다.

## 목표 범위

서울, 업종 3~5개, 연결 가능한 4~8개 분기를 최종 MVP 범위로 검토합니다. 지도·통계·근거 문장·후보 비교를 먼저 완성하고 자료와 계산식 검증 후 점수를 추가합니다. AI 예측·실시간 수집·전국 확대·수익 예측·전체 컨테이너 배포는 후속 범위입니다.
