# 아키텍처와 확정 설계

구현 현황은 [project](project.md), 정확한 DDL은 [Flyway SQL](../backend/src/main/resources/db/migration/), 원본/CRS/repair는 [data](data.md), 기존 DB 적용·복구 조건은 [db-safety](db-safety.md)가 기준입니다. 아래 공간 조회 정책은 확정 설계이며 공간 API 자체는 아직 구현되지 않았습니다.

## 책임과 데이터 흐름

`공공데이터 → Python 수동 ETL → PostgreSQL/PostGIS ← Spring API ← React` 흐름을 사용합니다.

| 영역 | 책임 |
| --- | --- |
| ETL | 입력 검증·출처별 변환·업종/기간/좌표 정리·transaction 적재 |
| PostgreSQL/PostGIS | 자료별 통계·점포·경계 version·공간 query와 무결성 |
| Backend | Controller → Service → JdbcClient Repository, 입력/매핑/무결성 검증과 API 응답 |
| Frontend | API client → types → hooks → components, 선택·로딩/오류/결측·결과 표시 |
| Compose·Makefile | 실행 진입점. 접속·migration·적재의 승인/identity 검증을 대신하지 않음 |

Spring JDBC/JdbcClient·HikariCP·PostgreSQL driver를 유지합니다. Python ETL 중심의 통계 조회에 ORM aggregate/영속성 계층이 필요하지 않아 Spring Data JDBC/JPA·jOOQ 전환은 채택하지 않았습니다. Flyway는 SQL 이력의 단일 기준이며 ORM schema 생성·Compose 초기 SQL과 병행하지 않습니다. 최초 V1 이전과 후속 V2/V3 결정은 Git에 보존돼 있습니다.

API 요청 중 CSV·manifest·외부 원천을 읽거나 ETL을 실행하지 않습니다. React는 DB에 직접 접속하거나 Backend 계산을 별도로 재구현하지 않습니다. 원본 자동 다운로드·스케줄링은 후속 범위입니다.

## 현재 조회·화면 구조

논리적 통계 key는 행정동 code + 서울시 source 업종 code + 분기입니다. 내부 업종을 유효한 단일 SEOUL mapping으로 연결하고 surrogate ID를 외부 식별자로 사용하지 않습니다. 이름·매핑·중복 row 오류를 임의 선택·합산하지 않습니다. 상세 응답과 무결성 범위는 [API 계약](api-contract.md)에 둡니다.

하나의 읽기 전용 REPEATABLE READ transaction에서 lookup/무결성과 통계를 읽습니다. 추세는 두 통계 테이블을 각각 한 번의 다중 분기 SQL로 가져와 고정 분기 축에 조립합니다. 기존 복합 키/조회 index를 재사용하며 추세 때문에 별도 공간 migration을 요구하지 않습니다.

React lookup은 병렬 요청합니다. 명시적 조회 버튼으로 단건/추세를 병렬 요청하고 두 결과·오류는 독립적으로 유지합니다. 공유 AbortController로 조건 변경·새 조회·unmount 시 이전 요청을 취소하고 완료 전 중복 제출을 막습니다. BIGINT string·semantic table·native select·공통 Tailwind/shadcn UI와 키보드 접근성을 유지합니다. 모바일에서는 표 내부만 가로 스크롤합니다.

React core·fetch·AbortController를 유지하고 별도 상태/폼 라이브러리·theme provider를 도입하지 않았습니다. shadcn new-york-v4 Button/Card를 재사용하며 Button의 44px 최소 클릭 영역·disabled/focus, Card의 Radix Slot asChild로 section/aria-labelledby를 유지합니다. native select·table/caption/th scope와 추세 thead/tbody 접근성을 보존합니다.

Tailwind는 @tailwindcss/vite·@import로 구성하고 index.css는 light theme/base/접근성 utility, App.css는 native 입력/통계/상태의 components layer를 담당합니다. layer 밖 전역 CSS로 공통 UI를 덮어쓰지 않습니다. 기존 760px 전환과 TypeScript/Vite의 @/*→src/* alias를 유지합니다. 미사용 Select/Combobox/Chart·Button/Card wrapper는 추가하지 않았습니다.

## 공간 schema와 version

| 저장소 | 역할 |
| --- | --- |
| V1 `commercial_areas` | 상권 code·원본 X/Y·대표 POINT 보존. 경계를 재구성하지 않음 |
| V1 통계·`stores` | 기존 key·값·ID·POINT 유지. current 경계에 물리 FK를 추가하지 않음 |
| V2 `spatial_dataset_versions` | dataset/kind·ZIP SHA·processing profile SHA·출처/검증/처리 version·날짜·역사적 호환·상태/current |
| V2 `admin_dong_boundaries` | version+dong code, source/operational geometry·품질/repair/hash |
| V2 `commercial_area_boundaries` | version+상권 code, geometry·품질과 raw 행정구역 속성 충돌을 별도로 보존 |
| V3 | SEMAS reference와 기존 stores 최소 backfill. 원본 geometry row는 별도 ETL |

version identity는 dataset ID + source ZIP SHA + processing profile SHA입니다. source feature index는 SHP의 0-based 순서이고 version 안에서 code와 feature index 각각 UNIQUE입니다. kind composite FK로 잘못된 경계 종류 연결을 막습니다. 다른 version에는 같은 code를 저장할 수 있습니다.

다운로드일·파일 수정일·페이지 갱신일·실제 경계 기준일·검증일·적재일을 하나의 version date로 합치지 않습니다. 미확인 reference date는 NULL/미검증으로 남깁니다. 통계/점포 snapshot metadata catalog는 아직 별도이며 공간 provenance가 이를 대신하지 않습니다.

### 불변성과 publication

- 종류별 current는 partial UNIQUE로 **최대 1개**이며 미적재 상태는 0개입니다. 최신 ID/날짜로 임의 선택하지 않습니다.
- boundary는 INSERT-only입니다. UPDATE/DELETE·READY 뒤 추가 INSERT를 trigger로 거부합니다. 재repair/품질 변경은 새 profile/version에 기록합니다.
- 새 version은 PENDING/non-current입니다. provenance identity와 검증/처리 metadata는 불변이며 DELETE·READY→PENDING·loaded_at 변경은 거부합니다.
- PENDING→READY는 한 번만 허용하고 기대 feature 수·전수 usable 품질·허용 validation 상태를 검사합니다. READY의 current 전환만 허용합니다.
- boundary INSERT는 parent version을 FOR UPDATE로 읽습니다. 종류별 advisory transaction lock과 한 transaction에서 전수 INSERT/검증→READY→이전 current 해제→새 current 활성화를 수행합니다.
- 실패한 kind는 rollback하여 이전 current를 보존합니다. 두 kind 전체는 단일 transaction이 아닙니다.
- 같은 READY 입력은 전수 row/hash/metadata가 같을 때 ID/loaded_at/hash를 유지하며 재사용합니다. 불일치·불완전 PENDING을 upsert/삭제로 숨기지 않습니다.

V2는 2 guard 함수·3 trigger와 operational geometry의 partial GiST를 포함합니다. source GiST·4326 Polygon 복제·quality B-tree·반경용 index는 추가하지 않았습니다. 작은 table의 Seq Scan도 정상이며 강제 Index Scan은 운영 설정이 아닙니다.

## 후보 좌표 조회 설계

입력은 longitude/latitude 순서의 EPSG:4326 POINT이고 query 내 POINT 하나만 5181로 변환합니다. 저장 경계 column을 transform하지 않아 operational GiST를 사용할 수 있습니다. `ST_Covers`는 내부·외곽/공유 경계·hole ring을 포함하고 hole 내부는 제외합니다.

| 행정동 current version match | domain result |
| --- | --- |
| 0 | OUTSIDE_OR_UNSUPPORTED, reason=NO_COVERING_OPERATIONAL_BOUNDARY. resolved dong=NULL, candidates=[]; 원인을 영역 밖/gap으로 단정하지 않음 |
| 1 | RESOLVED, dong code·version·quality·point_relation 제공. 단일 경계 위 match도 BOUNDARY 관계 유지 |
| 2+ | AMBIGUOUS_BOUNDARY, 모든 후보 반환, resolved dong=NULL. LIMIT 1이나 임의 통계 동 선택 금지 |

상권은 **0..N memberships**입니다. 0개는 NO_MEMBERSHIP/빈 배열, 여러 개는 전체 membership이며 행정동의 모호성 상태를 적용하지 않습니다. 배타적 상권 소속이나 원본 overlap의 의도/오류를 가정하지 않습니다. 상권 선택은 사용자 명시 선택이고 복수 상권 통계를 자동 합산하지 않습니다.

유효 좌표의 domain result는 200, current 부재는 BOUNDARY_DATA_UNAVAILABLE/503, 무결성·DB 실패는 500으로 설계했습니다. endpoint/query/DTO의 구현 계약은 후속 작업입니다. 기존 code 기반 5 API의 HTTP 계약을 변경하지 않습니다.

resolved dong code로 기존 통계 lookup을 연결합니다. 정상 geometry match와 lookup 부재/통계 NO_ROW는 별개이며 통계 부재를 OUTSIDE로 바꾸지 않습니다. 대표 POINT·통계 row가 없어도 geometry membership을 반환합니다. 경계 이름과 대표점 catalog 이름을 구분하고 raw 행정구역 속성으로 fallback하지 않습니다.

snap/round/epsilon buffer로 다중 match를 제거하지 않습니다. 4326↔5181 왕복 오차와 측위 오차 때문에 경계 근처의 확정 소속을 보장하지 않습니다. exact 5181 fixture와 4326 입력 fixture를 구분해 검증합니다. 실제 원본 제약은 [data](data.md#공간-데이터와-한계)를 따릅니다.

반경 query는 `stores.location::geography` functional GiST와 5181 projected POINT를 후속 성능 검증으로 선택합니다. 4326 degree 거리를 미터로 쓰지 않습니다. 기존 POINT GiST/소분류 index는 유지하며 신규 반경/index 설계는 10단계입니다.

## 결정의 Git 근거

설계의 대안 비교·column 상세·과거 DDL spike는 [25f03ce7의 원문](https://github.com/jinwooorp/RecycleYoungs/blob/25f03ce7bc6396606c9cc2656781d38f46efaed5/docs/spatial-schema-v2.md)에 보존돼 있습니다. 전체 Proposed DDL은 활성 문서에 복제하지 않습니다. 현재 실행 기준은 V1/V2/V3 SQL이며 역사적 설계·격리 실험을 현재 DB 적용 증거로 사용하지 않습니다.
