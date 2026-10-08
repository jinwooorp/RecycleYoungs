# 프로젝트 분석·정리 기록

확인일: 2026-10-07(Asia/Seoul). 이전 검증과 이번 검증은 아래에서 구분합니다.

## 전체 분석

행정동 자료 적재·DB migration·조회 API와 React 단건/4분기 통계를 실제 데이터로 연결했습니다. 같은 행정동·업종의 선택 분기 상세 통계와 2025년 4개 분기 추세를 조회할 수 있습니다. 같은 개발 PC의 독립 clean clone과 별도 fresh PostgreSQL volume에서 CSV → ETL → PostgreSQL → Spring API → React 전체 흐름을 재현해 1차 로드맵 7단계를 완료했습니다. 2차 공간 로드맵은 5단계 operational geometry·6단계 CAFE 검증에 이어 [7단계 V2 설계](spatial-schema-v2.md)를 확정했으며, 8단계 migration/ETL은 미구현입니다.

| 영역 | 확인한 상태 | 우선 남은 일 |
| --- | --- | --- |
| Backend | CORS·JdbcClient·Flyway, 목록·단건/4분기 통계 API 5개, 일반/실제 DB/API·새 환경 재현 검증 | 2차 지도·공간 기능을 위한 데이터·계약 준비 |
| Frontend | 조건 선택·단건/4분기 점포·추정매출 표, 상태 처리·개발 프록시·새 환경 재현 검증 | 지도·후보 비교 등 2차 UI |
| ETL | CSV 사전 검사·선택 실행·변환·일괄 트랜잭션, 행정동 매출·점포 실제 DB 검증 완료 | 나머지 자료의 실제 적재 검증 |
| DB | V1 7개 테이블·인덱스·서울시 업종 4개 매핑, 공간 V2/V3 설계 확정 | 8단계 공간 schema·Polygon ETL·SEMAS mapping/backfill 구현, 점포 스냅샷 metadata는 후속 |
| 원본 | CSV 6개·공식 경계 ZIP2종, 행정동425/상권1650 품질·코드 대조, invalid6건 operational ACCEPTABLE, SEMAS CAFE 검증, 현재 공식 CSV 동일성 | 2025 참조 경계/재집계 근거 부족(B), 홍지문 귀속 원인 미확인(H5), 미세 중첩 원인·실제 공간 query 검증·보관 CSV 이용 조건 |
| 기존 코드 | 활성 코드의 실행 의존성이 없는 실험 프로젝트 | 필요한 설계 이전 후 별도 제거 |

행정동 매출·점포는 425개 행정동 코드와 2025년 4개 분기를 공유합니다. 상권 매출 1,577개 코드는 영역 자료 1,650개 코드에 모두 포함되지만, 영역 자료는 POINT 정보이며 Polygon이 아닙니다. 서울시 전체 인구 22행은 지역별 수요 분석에 사용하지 않습니다. 2025년 통계와 파일명 기준 2026년 6월 개별 점포의 시점을 구분해야 합니다.

## 정리한 내용

- 루트 README를 개요·현재 상태·시작 방법으로 축소하고 설계·개발 안내·데이터 목록·로드맵을 `docs/`로 분리했습니다.
- `README_temp.md`의 실행·입력 설명을 `etl/README.md`와 데이터 문서에 통합했습니다.
- `csv_server/`를 `legacy/csv_server/`로 이동했습니다. 기존 추적 파일 62개의 바이트가 원본과 같음을 확인했습니다.
- `.env.example`, 공용 Git 제외 규칙과 Makefile을 추가했습니다. CSV 6개는 제외하고 `.gitkeep`과 manifest는 추적할 수 있습니다.
- DB 이름·계정 기본값·볼륨은 유지하고 DB를 localhost에 바인딩했습니다. ETL은 선택 실행 서비스로 분리했습니다.
- NULL 직렬화 오류, 정수 정밀도 손실, 실패 전 삭제 commit, 입력 파일의 모호한 선택을 수정했습니다.
- 적재 전 파일·헤더·행 구조·키·2025년 4개 분기 완전성을 검사합니다. 선택한 DB 작업은 하나의 트랜잭션에서 처리합니다.
- 상권 좌표계는 미확인 기본값을 제거하고 명시 설정하도록 했습니다. DB 데이터 접근 기능과 점수·지도 기능은 로드맵에 남겼습니다.

## 2026-09-30 검증

| 검사 | 결과 |
| --- | --- |
| Frontend `npm run build` | 통과 |
| Frontend `npm run lint` | 통과 |
| Backend `./gradlew --offline test` | BUILD SUCCESSFUL; 변경 없는 작업은 기존 테스트 결과 재사용 |
| ETL unittest | 15개 통과: NULL·코드·정밀도·입력 오류·선택 실행·트랜잭션 실패 경계 |
| 실제 ETL 입력 `--validate-only` | CSV 5개·849,805행 통과, DB 연결 없음 |
| 원본 CSV 6개 | 해시·행 수·분기·후보키 중복·열 개수 검사 완료 |
| Compose | 기본 서비스 DB만 활성, ETL profile·입력 경로·내부 포트·localhost 바인딩 확인 |
| 문서·Git | 로컬 링크·공백 검사, `.gitkeep`·manifest 추적 가능 및 CSV 제외 확인 |

당시 Docker 데몬에 연결되지 않아 실제 PostgreSQL/PostGIS 적재·EWKT 처리·DB의 rollback과 영속 볼륨 재기동은 검증하지 못했습니다. 회귀 테스트의 transaction 검사는 fake connection으로 수행했습니다. 원본 CSV와 기존 DB 데이터는 수정하지 않았습니다.

## 2026-10-03 행정동 적재·복구 검증

작업 시작 시 `main`의 작업 디렉터리는 깨끗했고, Docker `desktop-linux` context에 기존 컨테이너·볼륨은 없었습니다. `.env`는 프로젝트 기본값과 일치하며 `AREA_SOURCE_CRS`는 공란으로 유지했습니다. 새 `recycleyoungs_postgres_data` 볼륨으로 DB를 시작하고 초기 대상 테이블이 비어 있음을 확인했습니다. PostgreSQL 16.4 연결·healthy 상태와 PostGIS 3.4.3 extension을 확인했습니다.

로컬 `etl/.venv`가 없어 프로젝트 ETL Docker 이미지로 기존 unittest 15개를 실행해 모두 통과했습니다. `make etl-validate`는 DB 연결 없이 CSV 5개·849,805행을 검증했습니다. `make etl ETL_ARGS="--only store_stats_dong sales_dong"`로 아래 두 자료만 적재하고 동일 명령을 다시 실행했습니다.

| 테이블 | 원본 = DB 행 수 | 20251 | 20252 | 20253 | 20254 | 복합 키 중복 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `store_stats_dong` | 141,218 | 35,281 | 35,294 | 35,326 | 35,317 | 0 |
| `sales_dong` | 67,113 | 16,770 | 16,794 | 16,831 | 16,718 | 0 |

복합 키는 `quarter_code + dong_code + source_industry_code`입니다. 원본을 `csv.DictReader`로 별도 파싱해 두 테이블의 모든 키와 저장 필드를 대조했습니다. 정수는 Python `int`, 비율은 `Decimal`로 비교했고 모두 일치했습니다. `SEOUL / CS100010 → CAFE`의 `industry_id=1` 연결은 카페 점포 1,700행·매출 1,683행 모두 일치했으며 나머지 서울시 매핑 3개도 확인했습니다.

카페 `CS100010`·20251의 다음 세 행정동에서 점포·개폐업·프랜차이즈 통계와 매출·건수·주중/주말·시간대·연령대 값을 원본과 직접 비교했습니다.

| 행정동 코드 | 행정동 | 점포 수 | 추정매출 원본 값 = DB 값 | 매출 건수 |
| --- | --- | ---: | ---: | ---: |
| `11110515` | 청운효자동 | 114 | 4,535,266,422 | 302,642 |
| `11110530` | 사직동 | 178 | 9,462,371,274 | 954,826 |
| `11110540` | 삼청동 | 89 | 5,548,781,022 | 296,777 |

원본 최대 `sales_amount`는 20254·노량진2동(`11590520`)·`CS300008`의 `866223000000`이며 DB BIGINT와 정확히 일치했습니다. 두 원본에는 빈 필드나 2^53 초과 금액이 없어 해당 원본 사례로 NULL·정밀도 경계를 검증하지는 못했습니다. 대신 원본 밖의 임시 4분기 CSV를 실제 loader로 적재해 빈 통계값의 SQL NULL 보존과 `9007199254740993`의 정확한 저장을 확인한 뒤 검증 트랜잭션을 강제 rollback했습니다. 업종 미매핑의 `industry_id`도 NULL로 유지됐습니다(점포 134,439행·매출 60,460행).

재실행 전후 행 수·분기·키·샘플·원본 값은 동일했습니다. 키 순으로 각 행의 `to_jsonb(t)-'id'`를 MD5 집계한 checksum도 같았습니다: 점포 `f5f45056c75fc4066cf2d8bf5a02e972`, 매출 `4445ff3ff1d895ac76e0386dfa7bcebc`. 현재 연도별 DELETE/재삽입 방식은 내부 `id`를 재발급하므로 재실행의 동일성은 복합 키와 통계 필드 기준입니다.

실제 rollback은 별도 PostgreSQL 세션에서 `BEGIN; LOCK TABLE sales_dong IN ACCESS EXCLUSIVE MODE;`를 실행한 뒤 다음 명령으로 검증했습니다.

```sh
docker compose run --rm --no-deps \
  -e PGOPTIONS='-c lock_timeout=15s' -e PGAPPNAME=etl-rollback-probe \
  etl --only store_stats_dong sales_dong
```

첫 job이 실제 점포 행을 DELETE·INSERT한 후 둘째 job의 매출 DELETE가 잠금 대기하는 것을 `pg_stat_activity`·`pg_locks`로 확인했습니다. 의도한 lock timeout으로 ETL이 종료 코드 1을 반환했고, `pg_stat_user_tables`의 점포 INSERT·DELETE 누적 건수가 각각 141,218 증가해 첫 작업의 실제 DB 변경도 확인했습니다. 잠금 세션은 `ROLLBACK` 후 종료했습니다. 실패 전후 건수·분기·키·샘플과 `id`를 포함한 전체 행 checksum이 동일하고 원본 전수 대조도 통과했습니다. PostgreSQL sequence는 rollback 대상이 아니므로 점포 sequence 값은 증가했지만 저장된 행은 보존됐습니다.

ETL production 코드·스키마 수정 없이 검증했습니다. 원본 CSV 6개의 SHA-256은 작업 전후 같고, 미선택 `commercial_areas`·`sales_commercial_area`·`stores`는 0행을 유지했습니다. DB와 새 볼륨은 보존했습니다. 상권 좌표/EWKT·기존 볼륨 재사용/재기동·Spring/React 연결은 이번에 검증하지 않았습니다.

## 2026-10-03 Spring DB 접근·migration 검증

시작 시 `main`·HEAD `2075100`의 작업 디렉터리는 깨끗했고 기존 PostgreSQL은 healthy였습니다. 점포 141,218행·매출 67,113행, 카페 3개 행정동 샘플·`id` 포함 전체 행 checksum·sequence 값을 기록하고 DB 백업을 저장했습니다.

SQL 중심 집계·복합 키·향후 PostGIS 조회에 맞춰 Spring JDBC/JdbcClient를 선택했습니다. Data JDBC/JPA의 aggregate·ORM 저장 모델과 jOOQ 코드 생성은 현재 범위에 추가하지 않았습니다. Flyway 12.4.0을 도입해 `sql/001_schema.sql`을 내용 변경 없이 backend의 `V1__initial_schema.sql`로 이전했습니다. Compose의 SQL 초기화 책임을 제거했고 Spring과 standalone Flyway가 같은 SQL을 사용합니다. 상세 선택 근거는 [Backend 안내](../backend/README.md)에 있습니다.

| 검증 | 실제 결과 |
| --- | --- |
| 구현 전 실제 DB smoke test | JDBC bean 부재로 의도한 실패 확인 후 dependency·설정 추가 |
| Backend `./gradlew test --rerun-tasks` | 일반 context 테스트 1개 통과; 비밀번호 미지정·접속 불가 포트에서도 DB 없이 통과 |
| 기존 미관리 DB `make db-migrate` | 자동 baseline 없이 non-empty schema를 거부함 |
| 격리된 새 DB | 별도 Compose project·컨테이너·임의 localhost 포트·tmpfs로 생성, Spring 없이 Flyway V1 적용 성공 |
| V1 구조 대조 | 기존·새 DB의 7개 테이블 DDL·sequence 정의·제약·인덱스·테이블 목록·업종 seed·extension 일치 |
| 기존 DB 편입 | 백업·대조 후 `make db-baseline`으로 version 1 BASELINE 추가, V1 재실행 없음 |
| 기존 DB migration | `make db-migrate` 성공, version 1·미적용 migration 없음 |
| 기존 DB Spring `dbTest` | JdbcClient 141,218/67,113행 조회·업종/PostGIS·Flyway validate 검증 3개 통과 |
| 새 DB Spring `dbTest` | 동일 검증을 기대 건수 0/0으로 실행해 3개 통과 |
| 기존 데이터 보존 | `id` 포함 checksum 점포 `944c5a17f6d545d2517c5ff32c8e3e3e`·매출 `a6783e5196b69255ea2c29d2c71b68d4`, 건수·샘플·기존 테이블·extension·sequence 값 모두 작업 전후 동일 |

새 DB의 첫 대조에서 PostGIS 이미지 기본 init 스크립트가 추가 extension 3개를 만드는 차이를 발견했습니다. 빈 tmpfs로 해당 init 경로를 가리고 Flyway V1만 필수 extension을 생성하도록 수정한 뒤 새 DB 생성·대조를 다시 통과했습니다. 기존 DB에는 Flyway 이력 테이블만 추가됐으며 volume·통계 스키마·데이터를 초기화하지 않았습니다.

리뷰에서 Compose dotenv와 Java properties의 따옴표 해석 차이를 가짜 값으로 확인했습니다. Spring의 `.env` properties import를 제거하고 공용 DB 설정을 프로세스 환경으로 전달해 기존·새 DB 테스트를 다시 통과했습니다. 격리 검증용 tmpfs 컨테이너·네트워크는 정리하고 기존 volume은 보존했습니다.

`make db-migrate`는 Spring 서버·Java 없이 ETL용 스키마를 준비하며 `make etl`도 migration을 먼저 실행합니다. 통계 surrogate `id`는 외부의 안정적 식별자로 사용하지 않기로 했고, 최소 dataset metadata의 DB 도입은 원천 정의·API 계약 확인까지 보류했습니다. API·DTO·React·공간 분석·점수·새로운 ETL은 구현하지 않았습니다.

## 2026-10-03 행정동 API 계약 확정

시작 시 `main`·HEAD `9975452`의 작업 디렉터리는 깨끗했습니다. [API 계약](api-contract.md)에 GET 목록 3개와 행정동 통계 1개, 내부 업종·문자열 식별자/분기·BIGINT 문자열·부분/전체 자료 없음·metric NULL·오류·metadata 범위를 확정했습니다. 점포·매출을 한 응답에 제공하며 surrogate id는 노출하지 않습니다.

실제 PostgreSQL을 READ ONLY transaction으로 조회해 점포 141,218행·매출 67,113행, VARCHAR 행정동 코드·SMALLINT 분기·INTEGER 점포 수·BIGINT 금액/건수와 nullable 컬럼을 확인했습니다. 조회 가능 범위는 425개 행정동·내부 업종 4개·2025년 4분기이며 `GYM`은 매핑이 없어 제외합니다. 내부 업종별 서울시 매핑은 각각 하나이고 적재 industry_id 불일치·행정동 명칭 충돌은 없었습니다.

청운효자동·카페·20251의 점포 114개·추정매출 4,535,266,422 등 계약 예시를 DB 값과 대조했습니다. 면목5동·카페·20251은 점포만 존재하고, 신정6동·주점·20251은 두 행 모두 없는 사례를 확인했습니다. 이번 계약 대상 metric의 현재 NULL 사례는 없으므로 NULL 규칙은 향후 결측 계약으로 구분합니다.

기간 metadata는 DB 분기만 제공하는 선택 A로 정했습니다. Dataset metadata 테이블·V2를 첫 API의 필수 선행 작업으로 두지 않고 출처·적재 이력·version 응답은 후속 DB 관리로 유예합니다. 보관 CSV의 상세 집계 정의·다운로드 이력은 추가 확인이 필요하며 공식 페이지의 현재 정보로 이를 대체하지 않습니다.

문서만 갱신했습니다. API/DTO/SQL 구현·schema 변경·migration·ETL·React·API integration test·commit·push는 수행하지 않았습니다. 로드맵 4단계는 계약 확정, 다음은 5단계 API 구현입니다.

## 2026-10-03 행정동 조회 API 구현·검증

시작 시 `main`·HEAD `962b1f7`의 작업 디렉터리는 깨끗했고 기존 PostgreSQL 컨테이너는 healthy였습니다. [API 계약](api-contract.md)을 바꾸지 않고 `GET /api/admin-dongs`, `/api/industries`, `/api/quarters`, `/api/admin-dong-stats`를 구현했습니다. Controller·strict query 검증·Service·JdbcClient Repository·응답 record·공통 예외 처리로 책임을 나눴습니다.

서울시 단일 매핑과 실제 통계 행을 기준으로 lookup을 만들고, 읽기 전용 REPEATABLE READ transaction으로 무결성 검사·목록·통계의 일관된 조회를 유지합니다. 최신 분기 이름을 사용하고 같은 분기에서는 점포 이름을 우선합니다. 모호한 매핑·industry_id 불일치·동일 테이블/분기/행정동 이름 충돌·중복 통계 행을 임의 선택하지 않습니다. DB INTEGER는 nullable number, BIGINT는 nullable 정확한 10진 문자열이며 자료가 없는 유효 조합은 200과 `NO_ROW`입니다.

| 검증 | 결과 |
| --- | --- |
| TDD | 목록 MVC 테스트 4개·통계 MVC 테스트 8개·strict query 테스트 29개가 구현 전 404로 실패한 뒤 통과 |
| 일반 `./gradlew test --rerun-tasks` | 33개 통과; 비밀번호 미지정·접속 불가 port에서도 통과 |
| 기존 DB `./gradlew dbTest` | 연결/Flyway/PostGIS 3개 + 실제 MVC/JSON 13개 통과; 격리 fixture 10개는 기본 실행에서 제외 |
| 정상 목록 | 행정동 425개, 내부 업종 CAFE/HAIR/KFOOD/PUB, 분기 20251~20254; code 정렬·응답 필드 확인 |
| 정상 통계 | 청운효자동·CAFE·20251: 점포 114개, 추정매출 문자열 `4535266422`, 건수 문자열 `302642` 등 DB/계약 예시 일치 |
| 자료 없음 | 면목5동·CAFE·20251의 매출만 NO_ROW, 신정6동·PUB·20251은 양쪽 NO_ROW; 모두 200 |
| 입력 오류 | 필수값·빈 값·중복·미정의 query·형식·지원 여부·검증 우선순위 및 raw code/GYM 구분 확인 |
| 격리 PostgreSQL fixture | 별도 컨테이너·임의 localhost port·tmpfs에 기존 V1 적용 후 10개 통과. NULL/0·`9007199254740993`·음수 BIGINT·명칭/매핑 오류·빈 lookup 확인. 테스트 transaction rollback 후 0/0행·매핑 4개 유지, 임시 컨테이너 정리, 기존 DB에 fixture 쓰기 없음 |
| 중복 행 경계 | V1 UNIQUE를 제거하지 않고 query 경계만 대체한 단위 테스트로 DATA_INTEGRITY_ERROR 확인 |
| 실제 HTTP | 목록 3개·정상 통계·부분/전체 NO_ROW·목록 미정의 query·잘못된 분기 등 8개 요청 통과, 검증 backend 종료 |
| 기존 데이터 불변 | 점포 141,218행·매출 67,113행, 전체 행 checksum·Flyway baseline 1 이력·대표 샘플 동일 |

checksum은 내부 id를 포함한 `to_jsonb(t)`를 복합 키(분기·행정동·원본 업종) 순으로 연결해 MD5로 비교했습니다. 시작/종료 값은 점포 `b7419d5c6d318eb63ba117d67eaf8110`, 매출 `e22cd2c794f2bef23efd3de54c5af957`로 같습니다. 이전 검증과 정렬 방식이 다르므로 이전 checksum과 직접 비교하지 않습니다.

컴파일 warning은 없었고 테스트 JVM은 Mockito가 사용하는 bootstrap classpath에 대한 CDS 안내 warning을 출력했습니다. 코드·DB 오류가 아니며 테스트는 모두 통과했습니다. 원본 CSV·ETL·frontend·Flyway SQL·dependency·DB volume을 변경하지 않았습니다. 출처·dataset metadata 유예는 그대로이며 React·추세·공간 분석·점수는 검증하지 않았습니다. 로드맵 5단계를 완료했고 다음은 6단계입니다. commit·push는 하지 않았습니다.

후속 작업과 완료 기준은 [로드맵](roadmap.md), 실행 방법은 [개발 안내](development.md)를 확인합니다.

## 2026-10-04 React 조건 선택·결과 표 검증

시작 시 `main`·HEAD `d808b76`의 작업 디렉터리는 깨끗했고 기존 PostgreSQL은 healthy였습니다. Vite starter를 React core·fetch·AbortController·Vanilla CSS 화면으로 교체했습니다. 타입·API client·상태 hook·폼·결과를 분리하고 기존 네 API와 `/api` 프록시만 사용했습니다. 테스트용 Vitest·React Testing Library·jest-dom·jsdom을 개발 의존성에 추가했고 production 의존성은 React/React DOM으로 유지했습니다.

| 검증 | 실제 결과 |
| --- | --- |
| 자동 테스트 | 화면·API client 36개 통과: 병렬 lookup·미선택·조회·로딩·재시도·400/500/network 오류·잘못된 JSON·INTEGER/BIGINT 경계·NULL/0·부분/전체 NO_ROW·취소/늦은 응답 |
| BIGINT 경계 | `9007199254740993` → `9,007,199,254,740,993원`, Number 변환 없음; 계약 밖의 숫자·문자열은 오류로 처리 |
| Frontend 검증 | `npm run lint`, `npm run test`, `npm run build` 통과; strict TypeScript NULL 검사 활성화 |
| 실제 lookup | 브라우저에 행정동 425개·내부 업종 4개·분기 4개 표시, 세 조건은 미선택으로 시작 |
| 정상 실제 화면 | 청운효자동/CAFE/20251: 점포 114개, 추정매출 4,535,266,422원, 매출 건수 302,642건 |
| 부분 NO_ROW | 면목5동/CAFE/20251: 점포 17개·개폐업 0개, 매출 영역만 자료 없음 |
| 전체 NO_ROW | 신정6동/PUB/20251: 기준 조건 유지, 양쪽 자료 없음, HTTP 200 |
| 실제 프록시 | Vite 주소에서 목록 3개·위 통계 3개·미정의 query의 400 INVALID_PARAMETER 응답 대조 |
| 오류/복구 | 검증용 Spring 일시 중단 시 통계 오류와 lookup 오류 구분, Spring 재시작 후 목록 다시 시도·조회 복구 |
| 브라우저 | 초기 loading·선택·조회·결과 확인, 정상 조회 console error 없음. 실패 주입의 proxy 500은 예상 오류이며 390px/1280px 가로 넘침 없음 |
| 기존 DB | 점포 141,218행·매출 67,113행, 전체 행 checksum·대표 샘플·Flyway baseline 1 이력 동일 |

checksum은 5단계와 같은 `to_jsonb(t)`·복합 키 정렬 기준으로 점포 `b7419d5c6d318eb63ba117d67eaf8110`, 매출 `e22cd2c794f2bef23efd3de54c5af957`가 유지됐습니다. 현 DB에는 대상 metric NULL·2^53 초과 샘플이 없어 이 경계와 순수 network 실패는 frontend 자동 테스트로 검증했습니다. 격리 DB나 기존 데이터를 변경하지 않았습니다.

backend production/test·API 계약·Flyway SQL·DB schema·ETL·CSV·volume은 변경하지 않았습니다. roadmap 6단계를 완료했고 다음은 공통 4개 분기 추세와 새 환경 vertical slice 재현입니다. 지도·점수·metadata UI는 구현하지 않았으며 commit·push하지 않았습니다.


## 2026-10-07 Frontend 4분기 추세 표 검증

시작은 main·HEAD `2f1997c9097d0f24e1a44e41cdd3c840a654ec96`·clean working tree였습니다. 기존 세 조건과 선택 분기 상세 통계를 유지하고 같은 행정동·업종의 2025년 4분기 추세를 semantic table로 연결했습니다. 검색 한 번에 stats와 trend를 병렬 요청하며 결과·오류는 독립적으로 유지합니다. 공유 AbortController와 요청 식별로 조건 변경·unmount·늦은 응답을 처리하고 두 요청이 끝날 때까지 중복 제출을 막습니다.

| 검증 | 결과 |
| --- | --- |
| Frontend 자동 검증 | lint PASS, 테스트 80개 PASS, build PASS. 기존 단건 회귀, 고정 네 분기 응답 경계, 한쪽 성공/실패, 취소/늦은 응답, NULL/0/NO_ROW, BIGINT 경계 검증 |
| 실제 Vite → Spring → PostgreSQL | 세 행정동의 상세 20251과 추세 요청 총 6개 HTTP 200. 상세 값과 추세 첫 분기 일치, 고정 축·BIGINT string 확인 |
| 청운효자동 / CAFE | 점포 114·114·115·118개, 추정매출 문자열 `4535266422`·`4603714789`·`4195134430`·`4724282512`의 정확한 화면 표시 |
| 면목5동 / CAFE | 점포 17·16·16·15개, 매출 네 분기 NO_ROW; HTTP 오류로 표시하지 않음 |
| 신정6동 / PUB | 네 분기 양쪽 NO_ROW, 4개 열·정상 자료 없음 안내 유지 |
| 실제 브라우저 | 390px·1280px 페이지 가로 넘침 없음, 표 내부 가로 스크롤·키보드 접근 및 focus, native select 유지, 정상 화면 console error/warning 없음 |
| 정밀도 브라우저 fixture | 별도 임시 Vite API fixture에서 signed BIGINT 최대/최소·`9007199254740993`·metric NULL·실제 0 표시 및 390px/1280px 배치 확인. 실제 DB 사례와 구분 |
| 기존 DB 보존 | 점포 141,218행·매출 67,113행 및 전체 checksum·Flyway 이력·sequence 값이 검증 전후 동일 |

검증용 Spring은 Flyway를 비활성화하고 JDBC 세션을 읽기 전용으로 실행했습니다. SELECT/API 조회만 수행했고 checksum은 기존 `to_jsonb(t)`·복합 키 정렬 기준으로 점포 `b7419d5c6d318eb63ba117d67eaf8110`, 매출 `e22cd2c794f2bef23efd3de54c5af957`가 유지됐습니다. Backend·schema·ETL·CSV·dependency는 변경하지 않았고 Chart는 설치하지 않았습니다. 로드맵 7단계의 새 환경 전체 재현과 팀원용 재현 문서는 남아 있습니다. git add·commit·push는 하지 않았습니다.


## 2026-10-07 새 환경 vertical slice 재현

시작은 원 저장소 main·HEAD `c8b7afa28e5f40d96bba2ec928be00de72b3dcea`·clean working tree였습니다. `git clone --no-hardlinks`로 독립 clone을 만들고 기존 `.env`·node_modules·Backend build·ETL venv를 복사하지 않았습니다. 원 저장소 production code/config는 변경하지 않고 같은 commit의 V1·ETL·Spring·React만 사용했습니다. 팀원용 일반 절차와 개발 PC의 격리 절차는 [새 환경 재현 안내](reproduction.md)에 모았습니다.

| 환경 | 실제 기록 |
| --- | --- |
| 임시 clone | `/var/folders/w9/t457fthn6wv3hbnzdmpqvctw0000gn/T/recycleyoungs-repro-20261007-4i1j8aon/repo` |
| Compose project | `recycleyoungs-repro-20261007-4i1j8aon` |
| 재현 postgres container | `recycleyoungs-repro-20261007-4i1j8aon-postgres` (ID `4dbd49171d42`) |
| 재현 DB | `recycleyoungs_repro` / app / localhost:55432 |
| 재현 volume | `recycleyoungs-repro-20261007-4i1j8aon_postgres_data` → `/var/lib/postgresql/data` |
| 기존 보호 대상 | `startup-analysis-postgres` (ID `983e738d45ac`), `recycleyoungs_postgres_data`, localhost:5432, 시작/종료 healthy |
| 실행 버전 | Java 21.0.12, Node 24.20.0, npm 11.19.0, ETL Python 3.12.15, Docker 29.8.2/Compose 5.5.1, PostgreSQL 16.4/PostGIS 3.4, Flyway 12.4.0 |

container name만 바꾸는 임시 `.repro-compose.override.yml`과 별도 project·`.env`로 격리했습니다. Compose가 해석한 이름·port·volume을 시작 전에 검증하고 실제 mount도 대조했습니다. 기존 `.env`는 읽거나 변경하지 않았습니다. 적재 전 Vite proxy의 lookup 3개와 React는 자료 없는 상태여서 기존 populated DB로 연결되지 않았음도 확인했습니다.

| 검증 | 실제 결과 |
| --- | --- |
| 원본 CSV 6개 | 원본과 복사본의 파일명·크기·SHA-256·컬럼·행 수 모두 manifest/data-catalog 일치. 원본은 읽기·복사만 수행 |
| fresh migration | make db·db-migrate·db-info 성공. V1 type SQL / success true / pending 없음, BASELINE 사용 없음 |
| 빈 schema | 점포/매출 0행, 프로젝트 테이블 7개·V1 명시 index 8개·PostGIS·업종 seed 5개/서울시 mapping 4개 |
| CSV validation | make etl-validate 성공, DB 연결 없음. 5개 ETL job 입력 849,805행·4분기 검사. 제외된 길단위인구까지 포함한 CSV 6개는 별도 manifest/구조 검사 |
| fresh ETL | make etl ETL_ARGS="--only store_stats_dong sales_dong" 성공·transaction commit. 다른 job·좌표계 추측 없음 |
| 적재 결과 | 점포 141,218행·매출 67,113행, 각각 행정동 425개·20251~20254·논리 key 중복 0개 |
| 원본 ↔ DB | CP949 DictReader로 청운효자동/CS100010의 점포 5개·매출 4개 metric × 4분기(36개 값) 직접 대조·동일 |
| Backend 일반 test | 72개 통과·실패/skip 0개. fresh build에서 실제 실행 |
| reproduction dbTest | 20개 통과·fixture 15개 skip (전체 35개, 실패 0). 명시한 reproduction DB·읽기 전용 JDBC 세션 사용, fixture 쓰기 없음 |
| Spring | 8080 startup URL이 localhost:55432/recycleyoungs_repro임을 확인. V1 validate·migration 없음 |
| 실제 API | Vite → Spring의 5개 endpoint, 총 10개 HTTP 200 조회. lookup 425행정동/4업종/4분기, 단건 네 분기와 trend의 전 필드·BIGINT JSON string 일치 |
| Frontend fresh install | node_modules 없이 npm ci 성공, lint·80개 테스트(2개 파일)·build 모두 통과 |
| 실제 React | 청운효자동 정상·면목5동 부분 NO_ROW·신정6동/PUB 전체 NO_ROW 정상 표시. 4분기 축 유지·오류 alert 없음 |
| 브라우저 | 390px/1280px 페이지 가로 넘침 없음·모바일 표 내부 키보드 스크롤·native select·한국어 줄바꿈·3px focus 유지, console error/warning 없음 |
| 연쇄 대조 | CSV = fresh DB = stats = trend = React. 청운효자동의 36개 trend cell도 정확한 formatting으로 일치 |

| 분기 | CSV/DB/API/React 점포 수 | CSV/DB/API 추정매출 정수·문자열 | React 추정매출 |
| --- | --- | --- | --- |
| 20251 | 114 | 4535266422 | 4,535,266,422원 |
| 20252 | 114 | 4603714789 | 4,603,714,789원 |
| 20253 | 115 | 4195134430 | 4,195,134,430원 |
| 20254 | 118 | 4724282512 | 4,724,282,512원 |

20251 매출 건수도 CSV/DB `302642` = 두 API string `"302642"` = React `302,642건`으로 일치했습니다. 면목5동/CAFE는 점포 17·16·16·15와 매출 네 분기 행 부재, 신정6동/PUB는 점포·매출 네 분기 행 부재를 DB에서 직접 확인하고 API·브라우저의 정상 NO_ROW로 대조했습니다.

기존 개발 DB는 SELECT와 READ ONLY transaction만 사용했습니다. container ID·mount·port·state와 점포 141,218행/매출 67,113행, 전체 행 checksum·Flyway 이력·sequence 값이 전후 동일했습니다. 기존과 같은 `to_jsonb(t)`·복합 키 정렬 기준 checksum은 점포 `b7419d5c6d318eb63ba117d67eaf8110`, 매출 `e22cd2c794f2bef23efd3de54c5af957`입니다. reproduction ETL은 별도 project network의 postgres에만 연결했고 기존 DB에는 적재·migration을 하지 않았습니다.

검증용 Spring/Vite와 브라우저 탭을 종료했고 reproduction project만 docker compose down으로 종료했습니다. 기존 DB는 계속 healthy이며 reproduction volume `recycleyoungs-repro-20261007-4i1j8aon_postgres_data`은 삭제하지 않고 보존했습니다. 임시 clone·설정·빌드 결과를 원 저장소로 복사하지 않았습니다.

npm ci는 기존 lockfile에 대해 high 취약점 1개와 fsevents install-script 안내를 출력했습니다. audit fix·dependency 변경은 하지 않았고 lint/test/build는 통과했습니다. ARM 호스트의 PostGIS AMD64 이미지 안내와 테스트 JVM CDS 안내도 있었으나 검증 실패는 없었습니다. ETL 첫 이미지 빌드의 패키지 다운로드는 느렸지만 같은 Dockerfile/requirements로 완료했습니다. 이 검증은 기존 개발 PC의 독립 clone·fresh volume 재현이며 별도 팀원 PC에서 실행했다고 주장하지 않습니다.

로드맵 7단계를 완료했습니다. 상권 좌표계/Polygon·지도·Chart·metadata·나머지 ETL 실제 적재는 후속 범위입니다. production code·migration·Compose·Makefile·dependency 변경은 없고 문서만 갱신했습니다. git add·commit·push는 하지 않았습니다.


## 2026-10-07 공간 데이터 2~4단계 실제 검증

시작은 `main`·HEAD `8f953b631fabc55c8a15f0a673ae96facf81192a`·clean working tree였습니다. 지정 문서·manifest·Git 제외 규칙·ETL 좌표 구현을 읽고 파일 기반 검사만 수행했습니다. ETL 실행·DB 연결·환경 설정·production dependency 변경은 없습니다. 최종 판정은 **B: 코드·이름은 호환되지만 경계 버전의 2025 통계 호환 근거가 부족함**입니다. 작은 면적 중첩과 대표점 참조 예외도 별도로 남깁니다.

### 입력과 실행 도구

사용 전에 CP949 원본 3개의 크기·SHA-256이 manifest와 일치함을 확인했습니다. 원본은 읽기만 했으며 코드의 숫자 변환·자릿수 절단·자동 치환은 하지 않았습니다.

| 원본 CSV | bytes | SHA-256 / manifest |
| --- | --- | --- |
| 서울시 상권분석서비스(영역-상권).csv | 175854 | `6a6e19141f39712594a2eb42199e38e98ca2c8c06c5d4c5bd3fa39aee06ffd15` / 일치 |
| 서울시 상권분석서비스(점포-행정동)_2025년.csv | 11525299 | `5eaffcefc4ff43d0a7e162f0b1f922815c501a823a6c05bf5fb5f060a3de938b` / 일치 |
| 서울시 상권분석서비스(추정매출-행정동)_2025년.csv | 30186971 | `1030b432d218a5752bf4d3bf313c8424120bbc7b331926c2fd4205cdfda3e519` / 일치 |

시스템 Python은 3.13.16이고 ogrinfo·ogr2ogr·gdalinfo·cs2cs·proj와 시스템 pyproj/shapely/pyshp는 없었습니다. 프로젝트 밖 임시 venv `/var/folders/w9/t457fthn6wv3hbnzdmpqvctw0000gn/T/recycleyoungs-spatial-validation-10ao8axu/venv`만 만들었습니다. 사용 버전은 pyproj 3.7.0 / PROJ 9.4.1, pyshp 3.1.6, Shapely 2.1.2 / GEOS 3.13.1, PyGeodesy 26.09.09입니다.

실제 실행은 아래 임시 환경·분석 명령과 공식 페이지의 form 다운로드였습니다. 패키지는 이 venv에만 설치했습니다.

```sh
python3 -m venv /var/folders/w9/t457fthn6wv3hbnzdmpqvctw0000gn/T/recycleyoungs-spatial-validation-10ao8axu/venv
/var/folders/w9/t457fthn6wv3hbnzdmpqvctw0000gn/T/recycleyoungs-spatial-validation-10ao8axu/venv/bin/python -m pip install --no-cache-dir --index-url https://pypi.org/simple pyproj==3.7.0 shapely pyshp
/var/folders/w9/t457fthn6wv3hbnzdmpqvctw0000gn/T/recycleyoungs-spatial-validation-10ao8axu/venv/bin/python -m pip install --no-cache-dir --index-url https://pypi.org/simple PyGeodesy
/var/folders/w9/t457fthn6wv3hbnzdmpqvctw0000gn/T/recycleyoungs-spatial-validation-10ao8axu/venv/bin/python /var/folders/w9/t457fthn6wv3hbnzdmpqvctw0000gn/T/recycleyoungs-spatial-validation-10ao8axu/analyze.py
```

임시 분석 스크립트 SHA-256은 `b6434b0045e406c5f1b66724d5add2d1abebe8aeacdbbf3dda1419fefbd61911`입니다. 원본·provenance·전체 수치 출력은 Git에서 제외되는 로컬 `data/raw/spatial/`에 보존했습니다. 로컬 산출물은 `data/raw/spatial/oa-22160-provenance.json`과 `data/raw/spatial/validation-results.json`이며 repository에 포함하지 않습니다. 스크립트는 프로젝트 밖에만 있습니다.

### 대표 좌표 수치·의미 검산

X/Y는 문자열과 Decimal로 보존하고 변환 입력에서 float64로 전달했습니다. 현재 공식 데이터셋 CRS 메타데이터를 기준으로 `Transformer.from_crs("EPSG:5181", "EPSG:4326", always_xy=True)`를 사용했습니다. `always_xy=True`는 입력 X=Easting·Y=Northing, 출력 경도·위도 순서를 의미합니다. datum은 KGD2002 / GRS80, 투영 원점 38°N·127°E, k=1, false easting/northing=200000/500000 m입니다.

측정 전에 서울권 sanity 범위를 경도 126.70~127.25·위도 37.40~37.75로, 독립 수치 비교 허용값을 `1e-8°`로 정했습니다. 이 범위는 행정 경계 포함 판정 기준이 아닙니다. 1,650행 모두 finite·전 세계 경위도 범위·서울권 sanity 범위를 통과했습니다. 변환 범위는 경도 126.802018173~127.173766054, 위도 37.434592116~37.689821275입니다. X/Y 반전 시 경도 129.604715284~129.919260990·위도 35.107429964~35.403165393이며 서울권 통과는 0행입니다.

랜덤 추출 없이 X/Y 극값 4개, bounding-box 중앙 (198930.5, 451411) 근접 행, 중복을 제외한 북쪽/남쪽 행, 경복궁역 명칭 행을 골랐습니다.

| 선정 | 상권 코드 | 상권명 | 행정동 코드 | 행정동명 | X | Y | 경도 | 위도 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| X 최소 | 3120115 | 김포공항역(김포공항) | 11500640 | 방화2동 | 182509 | 451952 | 126.8020181730 | 37.5669394374 |
| X 최대 | 3111090 | 강일동주민센터 | 11740515 | 강일동 | 215352 | 451742 | 127.1737660535 | 37.5650854735 |
| Y 최소 | 3110747 | 석수역 1번 출입구 | 11545690 | 시흥3동 | 191566 | 437249 | 126.9047032868 | 37.4345921162 |
| Y 최대 | 3110406 | 도봉산역 1번 | 11320521 | 도봉1동 | 203718 | 465573 | 127.0421536608 | 37.6898212746 |
| X/Y 중앙 | 3120030 | 중부경찰서(영화인의거리) | 11140550 | 명동 | 199144 | 451473 | 126.9903114099 | 37.5627892722 |
| 북쪽 추가 | 3110397 | 도봉산입구 | 11320521 | 도봉1동 | 203332 | 464982 | 127.0377745992 | 37.6844979819 |
| 남쪽 추가 | 3111000 | 대왕초등학교(세곡동사거리서남측) | 11680700 | 세곡동 | 209464 | 440465 | 127.1069760355 | 37.4635587174 |
| 명확한 이름 추가 | 3120002 | 서촌(경복궁역) | 11110530 | 사직동 | 197511 | 453304 | 126.9718221738 | 37.5792835299 |

독립 수치 비교는 PROJ를 호출하지 않는 PyGeodesy `KTransverseMercator(TMorder=8)`의 GRS80 역투영으로 수행했습니다. 원점 북거리는 4207498.019043477 m이며 `x-200000, y-500000+원점 북거리`를 역투영했습니다. 전체 1,650행의 최대 경도/위도 차이는 `2.842170943040401e-14°`로 허용값 이내입니다. 이는 별도 구현의 투영 수치 검산이며 측량 또는 WGS84 datum의 물리적 정확도 검증은 아닙니다. pyproj가 선택한 KGD2002→WGS84 operation의 명시 accuracy는 1 m이고 pipeline은 별도 datum 이동 없이 역투영·단위 변환합니다.

의미 검산은 좌표 변환 전 원본 EPSG:5181 POINT와 CSV가 지정한 코드의 공식 행정동 Polygon을 대조했습니다. 대표 8개 모두 `within=true / contains=true / covers=true`이며 경계선 사례는 없었습니다. 별도 청운효자동 원본 경계 vertex `(197482.3181, 454902.0999)` probe에서는 `within=false / contains=false / covers=true`로 경계선 포함 정책의 차이를 확인했습니다.

추가 전수 대조는 1,649/1,650 대표점이 지정 행정동에 포함됐습니다. 예외 전체는 **홍지문 `3110531`**, X/Y `(196095, 455335)`, CSV 지정 부암동 `11110550`입니다. POINT는 홍은1동 `11410660`에 포함되고 부암동 Polygon까지 거리는 **139.755226386 m**입니다. 원천 대표점/행정동 지정 기준 또는 경계 버전 차이 가능성이 있으나 원인은 미확인입니다. 원본을 고치거나 좌표계 실패로 단정하지 않았습니다. 대표 샘플 검산 완료가 모든 대표점의 참조 코드 정합성을 보증하지는 않습니다.

### 공식 경계 확보·CRS·schema

[OA-22160 공식 페이지](https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do)의 `downloadFile(1) / frmFile`을 읽고 서울시 `datafile.seoul.go.kr` 서버에 POST `infId=OA-22160&seqNo=&seq=1&infSeq=3`로 내려받았습니다. HTTP 200, 실제 전송 크기 1,676,539 bytes이며 ZIP CRC 검사도 통과했습니다. data.go.kr의 보조 다운로드나 비공식 경계는 사용하지 않았습니다.

| 항목 | 확보한 사실 |
| --- | --- |
| 공식 ID / 이름 | OA-22160 / 서울시 상권분석서비스(영역-행정동) |
| 실제 다운로드 완료 시각 | 2026-10-07T14:17:09+09:00 (Asia/Seoul, 다운로드 파일의 마지막 기록 시각) |
| 원본 ZIP / 저장 위치 | `서울시 상권분석서비스(영역-행정동).zip` / `data/raw/spatial/` |
| ZIP bytes / SHA-256 | 1676539 / `969f7033bd3609a5fd586790f5b2cfedc638d7647ef45c78f9c75e1dabf79f68` |
| 공식 페이지 CRS / 코드 체계 | EPSG:5181 / 행정안전부 주민등록 행정기관코드 |
| 페이지 파일 수정일 / 데이터 갱신일 | 2023-10-31 / 2026-09-11 |
| 이용허락범위 | 공공누리 제1유형, 출처표시 (상업적 이용·변경 가능) |
| 실제 경계 기준 시점·버전 | 미확인; 위 날짜를 경계 버전으로 사용하지 않음 |

archive 내부 전 파일은 아래 5개뿐입니다. ZIP member에는 UTF-8 파일명 flag가 없고 파일명 bytes를 CP949로 해석하면 아래 이름이 됩니다. 이 해석으로 파일명만 복원해 압축 해제했고 원본 ZIP bytes는 보존했습니다. 모든 member의 ZIP timestamp는 2023-10-20 11:07:24(시간대 미기재)이며 이것도 실제 경계 기준일의 근거는 아닙니다.

| ZIP 내부 파일 | 압축 해제 bytes |
| --- | --- |
| 서울시 상권분석서비스(영역-행정동).cpg | 5 |
| 서울시 상권분석서비스(영역-행정동).dbf | 65219 |
| 서울시 상권분석서비스(영역-행정동).prj | 417 |
| 서울시 상권분석서비스(영역-행정동).shp | 3313916 |
| 서울시 상권분석서비스(영역-행정동).shx | 3500 |

레이어는 SHP 1개, `서울시 상권분석서비스(영역-행정동).shp`입니다. CPG는 UTF-8이고 DBF 문자열은 오류 대체 없이 UTF-8 strict로 읽었습니다. [서울특별시 공식 공공데이터포털 설명](https://www.data.go.kr/data/15147263/fileData.do)의 필드 정의와 실제 schema를 대조해 코드 `ADSTRD_CD`·이름 `ADSTRD_NM`을 선택했습니다. 실제 코드 길이는 모두 8자리이고 예시는 `11110515`입니다.

| 필드 | DBF type/길이/소수자리 | 확인한 의미 |
| --- | --- | --- |
| `ADSTRD_CD` | C / 8 / 0 | 행정동 코드, 문자열 그대로 비교 |
| `ADSTRD_NM` | C / 30 / 0 | 행정동명, 원문 exact 비교 |
| `XCNTS_VALU` | N / 38 / 0 | 대표 X |
| `YDNTS_VALU` | N / 38 / 0 | 대표 Y |
| `RELM_AR` | N / 38 / 0 | 면적 값 |

PRJ는 `Korea_2000_Korea_Central_Belt` / Transverse Mercator / metre로 선언돼 있습니다. CRS parser의 authority는 EPSG:5181이고 datum EPSG:6737·GRS80·투영 파라미터가 일치합니다. 원본 PRJ와 EPSG 정의의 직접 `equals`는 축 순서 제외 옵션에서도 false라서 이를 숨기지 않았습니다. EPSG 정의를 ESRI WKT로 표현해 다시 파싱한 비교는 축 순서를 제외하면 true이며, geodetic CRS도 축 순서를 제외하면 true입니다. PRJ(Easting/Northing)와 EPSG(Northing/Easting) 표현을 구분했고, 두 source 선언에서 `always_xy=True`로 변환한 1,650행의 차이는 0°였습니다. PRJ를 덮어쓰거나 추측으로 SRID를 부여하지 않았습니다. 원본 bbox는 `[179189.7616, 436547.4067, 216242.2725, 466863.5417]` m입니다.

### Geometry와 공간 관계

| 검사 | 실제 결과 |
| --- | --- |
| feature / 고유 코드 | 425 / 425 |
| Polygon / MultiPolygon / 기타 | 425 / 0 / 0 (2D) |
| geometry NULL / empty | 0 / 0 |
| valid / invalid | 425 / 0; invalid reason 목록 [] |
| 코드 NULL·공백 / 중복 코드 | 0 / 0; 목록 [] |
| 이름 NULL·공백 / 같은 코드의 복수 이름 | 0 / 0; 목록 [] |
| 동일 코드 여러 feature / 논리 key 중복 | 0 / 0 |
| 동일 WKB / 정규화 WKB / 공간적 equals 중복 | 0 / 0 / 0; 목록 [] |

원본 EPSG:5181 평면의 m²로 내부 교차 면적을 검사했습니다. 사전 기준은 `1e-4 m²`, bbox 후보 1,493쌍 중 경계 접촉 `touches` 1,206쌍은 오류로 세지 않았습니다. 기준을 넘는 양의 면적 중첩은 아래 **13쌍**, 기준 이하의 양의 면적은 0쌍, 검사 오류·제외 invalid geometry는 0건입니다. 최대 면적은 **0.024527336747 m²**입니다. 원본에서 관찰된 매우 작은 양의 면적 중첩이며 자동 repair나 사후 허용값 변경은 하지 않았습니다. 원인은 미확인이고, 향후 point-in-polygon 경계/다중 매칭 정책과 geometry 정밀도 기준을 정하기 전에 별도로 검토합니다.

| 행정동 A | 행정동 B | 교차 면적 (투영 m²) |
| --- | --- | --- |
| 11290575 동선동 | 11290590 돈암2동 | 0.000203803452 |
| 11170625 한강로동 | 11170640 이촌2동 | 0.000440895021 |
| 11380510 녹번동 | 11380580 응암1동 | 0.004391647867 |
| 11380580 응암1동 | 11410685 홍은2동 | 0.002086515099 |
| 11380580 응암1동 | 11380590 응암2동 | 0.001305097803 |
| 11560535 영등포동 | 11560560 당산2동 | 0.001118105053 |
| 11560660 신길4동 | 11560680 신길6동 | 0.001057569906 |
| 11560680 신길6동 | 11560690 신길7동 | 0.024527336747 |
| 11620585 낙성대동 | 11620625 인헌동 | 0.000995242209 |
| 11650510 서초1동 | 11650530 서초3동 | 0.001906660322 |
| 11530740 개봉1동 | 11530750 개봉2동 | 0.000887352125 |
| 11710532 거여2동 | 11710540 마천1동 | 0.018256889834 |
| 11740515 강일동 | 11740560 고덕2동 | 0.001509856086 |

### 2025 통계와 코드·이름·분기 대응

모든 업종을 읽었습니다. 점포 141,218행·매출 67,113행이며 전체 고유 코드는 각각 425개입니다. 코드/이름 NULL·공백과 같은 코드의 복수 이름은 두 원본 모두 0건입니다.

```text
count(S_store)=425; count(S_sales)=425; count(S_store ∩ S_sales)=425
S_store - S_sales=[]; S_sales - S_store=[]
count(S)=425; count(P)=425; count(S ∩ P)=425
S - P=[]; P - S=[]
이름 exact 불일치=[]; 두 통계 사이 이름 충돌=[]
```

각 분기를 별도로 계산했으며 두 통계 각각의 Polygon 대응은 아래와 같습니다. 코드 차집합·이름 불일치가 없으므로 공백/표기/실제 명칭 변경으로 분류할 항목도 없습니다. 이름을 자동 치환하지 않았습니다.

| 분기 | 점포 행 수 | 점포 동 / P 교집합 | 매출 행 수 | 매출 동 / P 교집합 | 점포만 / P만 | 매출만 / P만 |
| --- | --- | --- | --- | --- | --- | --- |
| 20251 | 35281 | 425 / 425 | 16770 | 425 / 425 | 0 / 0 | 0 / 0 |
| 20252 | 35294 | 425 / 425 | 16794 | 425 / 425 | 0 / 0 | 0 / 0 |
| 20253 | 35326 | 425 / 425 | 16831 | 425 / 425 | 0 / 0 | 0 / 0 |
| 20254 | 35317 | 425 / 425 | 16718 | 425 / 425 | 0 / 0 | 0 / 0 |

### 경계 버전 조사와 완료 수준

- [행정안전부 2025-07-01 시행 변경내역](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=118483)과 [동대문구 2025-06-24 보도자료](https://www.ddm.go.kr/www/selectBbsNttView.do?bbsNo=39&key=199&nttNo=168783)는 용신동 폐지/분동과 신설동·용두동 신설을 확인합니다. 그러나 보관한 두 통계는 Q1~Q4 모두 용신동 `11230536`을 유지하고 신설동·용두동은 없으며, 확보 경계도 용신동을 포함합니다. 통계가 어느 기준 경계로 재집계됐는지는 이 코드 일치만으로 결정할 수 없습니다.
- 현재 공식 [점포-행정동 OA-22172](https://data.seoul.go.kr/dataList/OA-22172/S/1/datasetView.do)와 [추정매출-행정동 OA-22175](https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do)는 2024년부터 공간 단위가 표준단위구역으로 변경됐다는 2026-07-03 적용 안내를 제공합니다. 이 현재 안내가 보관한 2025 CSV의 정확한 배포본·참조 경계를 증명하지는 않습니다.
- 공식 페이지와 archive에서 실제 경계 기준 시점·버전 식별 근거는 확보하지 못했습니다. 2024~2025 행정동 변경 이력의 전수 확인과 같은 코드의 경계 변경 여부도 미완료입니다. ZIP 수정일 2023년·페이지 갱신일 2026년·공공데이터포털 제목의 20250611을 실제 경계 기준일로 간주하지 않습니다.

**최종 B**이며 4단계 전체 호환 완료는 아닙니다. 로드맵 2단계는 8개 대표점 수치·의미 검산 범위에서 완료(추가 전수 참조 예외 1건 별도), 3단계는 공식 ZIP·CRS/schema 확보 완료, 4단계는 확보 경계의 실제 기준 시점/버전과 2025 통계의 참조 경계/재집계에 대한 공식 근거 부족으로 미완료입니다. 다음은 이 경계 버전 근거와 홍지문 대표점 참조 기준 확인입니다. 작은 면적 중첩 13쌍은 향후 point-in-polygon 경계/다중 매칭 정책과 geometry 정밀도 기준 설계 전에 별도로 검토합니다. 공간 스키마·Flyway·ETL 적재·API·지도 구현으로 진행하지 않았고 Git stage·commit·push도 하지 않았습니다.

## 2026-10-07 공간 검증 4단계 미완료 원인 조사

시작 상태는 `main` / `60a7ca27822d6075099751e7bfdb2cab28d16831`, `git status --short` 출력 없음이었습니다. 기존 대표점 1,650행/8점 검산·425개 행정동 geometry 검사와 미세 중첩 13쌍은 반복하지 않았습니다. 이번에는 공식 배포 파일 비교, 행정기관 코드 변경과 홍지문 한 상권의 추가 공간 관계만 조사했습니다. DB 연결·ETL 실행·원본 교체·production/dependency 변경·Git stage/commit/push는 없습니다.

### 확인한 공식 출처와 설명의 범위

| 공식 출처 | 기관 / 확인한 내용 |
| --- | --- |
| [점포-행정동 OA-22172](https://data.seoul.go.kr/dataList/OA-22172/S/1/datasetView.do), [추정매출-행정동 OA-22175](https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do) | 서울 열린데이터광장·서울신용보증재단. 2025 ZIP 수정일은 둘 다 2026-05-21. 2024년 표준단위구역 전환 및 카드사의 해당 단위 매출이 2021년부터 제공되어 일관성/정확성을 위해 2026-07-03부터 2021년 이후만 제공한다는 안내 확인 |
| [영역-행정동 OA-22160](https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do) | 서울 열린데이터광장. 서비스에서 사용하는 행정동 영역·EPSG:5181 명시. 파일 수정일/페이지 갱신일 외 실제 경계 기준일은 찾지 못함 |
| [영역-상권 OA-15560](https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do) | 서울 열린데이터광장. 현재 CSV와 SHP ZIP 확보. ZIP 목록은 한 개이며 수정일 2023-10-23. 연도별 과거 CSV/SHP archive는 확보하지 못함 |
| [서비스 소개](https://golmok.seoul.go.kr/introduce.do), [데이터 출처](https://golmok.seoul.go.kr/source.do) | 서울시 상권분석서비스. 발달상권·전통시장에 사용한 2022년 표준단위구역은 통계청 조사·집계구·도로망을 반영한 전국 약 40만 구역. 행정동 통계의 환산/재집계 규칙은 명시하지 않음 |
| [제공정보 PDF](https://golmok.seoul.go.kr/images/seoul_info.pdf), [행정동 코드 PDF](https://golmok.seoul.go.kr/images/adstrd_code.pdf) | 서울시 상권분석서비스. 분기 자료는 분기 종료 두 달 후 업데이트 예정. 매출 보정/카드금액에 행정동·표준단위구역 단위를 병기하나 변환 규칙은 없음. 코드 PDF는 425개로 용신동 `11230536`·상일동 `11740520`·일원2동 `11680740` 유지 |
| [상권 목록 v3 PDF](https://golmok.seoul.go.kr/images/seoul_v3.pdf), [현재 v4 PDF](https://golmok.seoul.go.kr/images/seoul_v4.pdf) | 서울시 상권분석서비스. 두 문서 모두 홍지문을 종로구/부암동으로 표시. 생성 metadata는 각각 2023-09-06/2024-07-25이나 실제 경계 기준일이나 연도별 배포 버전을 뜻하지 않음 |
| [2025-01-01](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=114616), [03-10](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=115983), [07-01](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=118483), [09-01](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=120222), [10-17 시행 변경내역](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=121446) | 행정안전부. 말소코드 포함 ZIP 안 `KIKcd_H` 문자열·생성/말소 일자 확인. 마지막 게시물의 실제 첨부는 `KIKcd_H.20251103`이며 10-17 스냅샷으로 취급하지 않음 |
| [행정동 영역](https://www.data.go.kr/data/15147263/fileData.do), [행정동 점포](https://www.data.go.kr/data/15147239/fileData.do) | 공공데이터포털의 서울특별시 제공 자료. OA-22160/22172로 연결되며 참조 경계 기준일·재집계 정책의 추가 근거는 없음. 제목의 `20250611`을 경계 기준일로 사용하지 않음 |
| [원본시스템 메인](https://golmok.seoul.go.kr/main.do), [사이트맵](https://golmok.seoul.go.kr/sitemap.do) | 서울시 상권분석서비스. 공개 도움말/공지 영역과 안내 경로를 확인했으나 2024 개편의 행정동 집계 규칙·2025 분동 반영 정책은 찾지 못함 |
| [재단 홈페이지](https://www.seoulshinbo.co.kr/wbase), [공지](https://www.seoulshinbo.co.kr/wbase/contents/bbs/list.do?mng_cd=STRY9788), [보도](https://www.seoulshinbo.co.kr/wbase/contents/bbs/list.do?mng_cd=STRY2795), [발간자료](https://www.seoulshinbo.co.kr/wbase/contents/bbs/list.do?mng_cd=BUSI3408) | 서울신용보증재단. `상권분석` 제목 검색을 확인. 검색 목록만으로 공간 정책을 결론 내리지 않음 |
| [2022 개편 보도자료와 첨부 PDF](https://www.seoulshinbo.co.kr/wbase/contents/bbs/view/14320.do?mng_cd=STRY2795&pageIndex=1), [2023 데이터 이관 입찰](https://www.seoulshinbo.co.kr/wbase/contents/bbs/view/16264.do?mng_cd=STRY9788&pageIndex=1) | 서울신용보증재단. 전자는 분석 영역을 직선 반경에서 보행권역으로 바꾼 설명이며 2025 행정동 집계 정책이 아님. 후자는 나라장터 입찰번호 `20231126994` 안내뿐이며 과업 원문을 확보하지 못함 |

원본시스템은 공개 설명/PDF에 접근 가능했습니다. 재단 홈페이지는 web 도구의 timeout 후 curl로 본문을 확보했습니다. 확인한 공개 공식 본문에는 표준단위구역 → 행정동 배분/중심점/면적비 규칙, 특정 기준일로 재집계, 연간 코드 고정, 폐지동 유지, 분기별 경계 변경 반영 여부가 명시돼 있지 않았습니다. 행정동 코드가 실제 집계 경계인지 결과 label인지도 확정할 수 없습니다. **통계 정책 판정 B**이며 A1/A2를 선택할 공식 근거가 없습니다.

### 현재 공식 2025 ZIP과 보관 CSV 비교

공식 페이지의 다운로드 form을 HTTPS 서울시 파일 서버에 전송했습니다. 점포/매출은 `infId=OA-22172/OA-22175`, `seq=7`, `infSeq=3`이며, 영역-상권 ZIP은 `infId=OA-15560`, `seq=5`, `infSeq=3`입니다. CSV는 공식 sheet의 CSV 다운로드 경로를 사용했습니다. curl·Python 표준 `zipfile/hashlib/csv`로 비교했으며 코드는 문자열로 보존했습니다. 사용한 추가 공간 도구는 기존 프로젝트 밖 임시 환경의 pyshp 3.1.6·Shapely 2.1.2(GEOS 3.13.1)·pyproj 3.7.0(PROJ 9.4.1)입니다. 새 dependency를 설치하지 않았습니다.

| 공식 원본 | 실제 다운로드 완료(Asia/Seoul) | ZIP bytes | ZIP SHA-256 |
| --- | --- | --- | --- |
| `서울시 상권분석서비스(점포-행정동)_2025년.zip` | 2026-10-07T15:29:55+09:00 | 1073668 | `1eb65713ac04861ac54a765984e9a9072e55288fd1c715409f3cce22782d2e69` |
| `서울시 상권분석서비스(추정매출-행정동)_2025년.zip` | 2026-10-07T15:29:59+09:00 | 11160221 | `caf8596c91ea8865bbb1fbcf940997550452e2b4de9cff8649f663972a90b279` |

각 ZIP에는 해당 이름의 CSV 한 개가 있습니다. CSV는 각각 11525299/30186971 bytes, SHA-256 `5eaffcefc4ff43d0a7e162f0b1f922815c501a823a6c05bf5fb5f060a3de938b` / `1030b432d218a5752bf4d3bf313c8424120bbc7b331926c2fd4205cdfda3e519`이며 보관 파일과 byte 단위까지 동일합니다. 두 보관 파일의 크기/hash는 manifest와도 일치합니다. 행 수는 점포 141218·매출 67113, 전체/각 Q1~Q4 코드 집합은 각각 425개, 보관 대비 전체/분기별 양방향 차집합은 모두 `[]`입니다. 이번 비교는 파일 배포 현상 조사이며 기존 Polygon 품질 검사를 반복한 것이 아닙니다.

ZIP 내부 CSV timestamp는 점포 2026-05-21 13:44:22·매출 13:42:40입니다. 이는 페이지 수정일과 같지만 최초 게시일·재게시/교체 이력·단순 재배포 여부를 증명하지 않습니다. 이번 다운로드는 2026-07-03 정책 안내 이후의 현재 제공 파일임을 확인할 뿐, 수정일만으로 보관 파일을 정책 변경 전/후 배포본으로 분류하지 않습니다.

### 행정안전부 변경 원본과 분기별 통계

`KIKcd_H` 파일명 기준 서울특별시 읍면동 레코드에서 말소일이 없는 코드 수는 2025-01-01/03-10 각각 426, 07-01/09-01/11-03 각각 427입니다. 01-01 대비 03-10 코드 집합 차이는 없고, 이후 세 스냅샷에서는 용신동 하나가 빠지고 신설동·용두동 두 개가 들어옵니다. 10-17 시행 게시물의 첨부 ZIP은 실제로 11-03 코드 파일을 담고 있으므로 게시물 시행일과 스냅샷 날짜를 구분했습니다. 정확한 04-01/10-01·연말 스냅샷은 확보하지 못했으며 인접 공개 스냅샷으로 해당 날짜를 대신 확정하지 않습니다. 이는 공개 스냅샷의 코드 변화 확인이며 동일 코드의 실제 경계 변화 전수 조사 완료를 뜻하지 않습니다.

| 행정기관명 | MOIS 원본 10자리 코드 | 생성일 | 말소일 | 이번 확인 |
| --- | --- | --- | --- | --- |
| 용신동 | `1123053600` | 2009-05-04 | 2025-07-01 | 01-01/03-10 유효, 07-01 이후 말소 |
| 신설동(신규) | `1123051500` | 2025-07-01 | 공란 | 07-01 이후 유효 |
| 용두동(신규) | `1123053300` | 2025-07-01 | 공란 | 07-01 이후 유효 |
| 신설동(과거) | `1123051000` | 1988-04-23 | 2009-05-04 | 신규 신설동과 다른 코드 |
| 용두동(과거) | `1123053500` | 1988-04-23 | 2009-05-04 | 신규 용두동과 다른 코드 |

MOIS의 10자리 코드를 잘라 8자리 통계 코드에 자동 매칭하지 않았습니다. 상권분석서비스의 공식 코드 PDF에는 별도로 용신동 `11230536`이 명시돼 있으며, 아래 통계 코드는 CSV 그대로입니다. MOIS 01-01 원본에는 일원2동 `1168074000`의 2022-12-23 말소와 개포3동 `1168067500` 생성, 상일동 `1174052000`의 2021-07-01 말소와 상일제1/2동 `1174052500/1174052600` 생성도 있습니다. 현재 2025 CSV는 일원2동 `11680740`·상일동 `11740520`을 포함합니다. 이는 통계 label을 해당 분기의 최신 행정기관 목록과 동일시할 수 없다는 추가 관찰이며, 특정 과거 경계 기준일을 추정하지 않습니다.

각 셀은 `원본 code / 이름 / 행 수`입니다. 모든 업종을 포함하며 점포 개수/매출액이 아닌 CSV 레코드 수입니다.

| 분기 | 점포 용신동 | 점포 신설동 | 점포 용두동 | 매출 용신동 | 매출 신설동 | 매출 용두동 |
| --- | --- | --- | --- | --- | --- | --- |
| 20251 | `11230536 / 용신동 / 93` | 없음 / 0 | 없음 / 0 | `11230536 / 용신동 / 49` | 없음 / 0 | 없음 / 0 |
| 20252 | `11230536 / 용신동 / 93` | 없음 / 0 | 없음 / 0 | `11230536 / 용신동 / 50` | 없음 / 0 | 없음 / 0 |
| 20253 | `11230536 / 용신동 / 94` | 없음 / 0 | 없음 / 0 | `11230536 / 용신동 / 51` | 없음 / 0 | 없음 / 0 |
| 20254 | `11230536 / 용신동 / 94` | 없음 / 0 | 없음 / 0 | `11230536 / 용신동 / 50` | 없음 / 0 | 없음 / 0 |

현재 공식 ZIP도 byte 동일하므로 같은 결과입니다. 실제 행정기관 체계가 분기 중 변경된 사실과 현재 통계가 이전 label을 유지하는 현상은 확인했지만, 이를 연간 고정/과거 기준 재집계/단순 반영 지연 중 무엇으로 설명할지는 공식 근거가 없습니다. **경계 버전 문제 unresolved**: OA-22160의 실제 기준일·버전 및 그 geometry가 2025 통계의 참조 경계라는 연결 근거는 여전히 확보하지 못했습니다.

### 홍지문 3110531: 공식 CSV/SHP와 과거 목록

현재 공식 CSV는 CP949, 175854 bytes, 1650행, SHA-256 `6a6e19141f39712594a2eb42199e38e98ca2c8c06c5d4c5bd3fa39aee06ffd15`로 보관 원본/manifest와 byte·hash가 동일합니다. 홍지문 행도 아래 여섯 항목이 완전히 동일합니다. 보관 CSV를 수정하지 않았습니다.

| 항목 | 보관 CSV = 현재 공식 CSV | 현재 공식 SHP |
| --- | --- | --- |
| 상권 코드 / 이름 | `3110531 / 홍지문` | `3110531 / 홍지문` |
| X / Y | `196095 / 455335` | `196095 / 455335` |
| 행정동 코드 / 이름 | `11110550 / 부암동` | `11410660 / 홍은1동` |
| 자치구 코드 / 이름 | `11110 / 종로구` | `11110 / 종로구` |

상권분석서비스 [공식 행정동 코드표](https://golmok.seoul.go.kr/images/adstrd_code.pdf)는 `11410 / 서대문구`, `11410660 / 홍은1동`을 명시합니다. 따라서 홍지문 SHP feature는 CSV와의 행정동 차이뿐 아니라, 내부에서도 `SIGNGU_CD=11110 / SIGNGU_CD_=종로구`와 `ADSTRD_CD=11410660 / ADSTRD_CD_=홍은1동(서대문구)` 사이에 행정구역 계층 불일치가 있습니다. 이 관찰만으로 원천 오류나 어느 속성이 정답인지 확정하지 않습니다.

공식 상권 ZIP은 2026-10-07T15:30:00+09:00 확보, 2123078 bytes, SHA-256 `38bb8fab4e45a1171af4989cd7fa1275f68e5d644aa770f5431ce7ccc38384dd`입니다. archive는 `서울시 상권분석서비스(영역-상권)`의 `.cpg`(5 bytes), `.dbf`(800636), `.prj`(417), `.shp`(3642228), `.shx`(13300) 다섯 파일입니다. CPG/DBF는 UTF-8이며 PRJ를 parser로 읽으면 EPSG:5181, 확보 OA-22160 PRJ와 동일 CRS입니다. 필드는 `TRDAR_SE_C C(1)`, `TRDAR_SE_1 C(12)`, `TRDAR_CD C(10)`, `TRDAR_CD_N C(254)`, `XCNTS_VALU/YDNTS_VALU N(38,0)`, `SIGNGU_CD C(5)`, `SIGNGU_CD_ C(40)`, `ADSTRD_CD C(8)`, `ADSTRD_CD_ C(40)`, `RELM_AR N(38,0)`입니다. 파일명·schema를 확인하고 홍지문 한 feature만 공간 대조했으며 전체 상권 geometry/코드 정합성 검증은 수행하지 않았습니다.

공식 v3/v4 목록 PDF는 모두 홍지문 `3110531`을 `종로구 / 부암동 / 78118㎡`로 기록합니다(두 문서 13쪽). v3는 과거 공식 목록의 속성 확인에만 사용하며 X/Y·geometry가 없어 과거 좌표/경계를 비교할 수 없습니다. 2023/2024/2025 연도별 공식 CSV/SHP 원본은 확보하지 못했고, 현재 ZIP·PDF의 날짜로 좌표/귀속 변경 시점을 추정하지 않습니다.

추가 공간 대조는 원본 EPSG:5181, 미터/제곱미터 단위에서 repair 없이 수행했습니다. 홍지문은 MultiPolygon이고 계산 면적은 78118.080185㎡, 확보 행정동 geometry와의 교차 면적은 부암동 32132.051423㎡(41.132669%)·홍은1동 45986.028762㎡(58.867331%)·홍제3동 0㎡입니다. 상권 geometry의 대표 POINT `covers=True`, 면적 centroid는 `(196165.189861, 455404.283798)`, CSV POINT와 거리는 98.624850m로 같지 않습니다. 이 한 사례가 두 동에 걸치는 관찰과 centroid 불일치를 보여주지만 대표점 생성 방식·행정동 귀속 규칙을 증명하지 않습니다. 기존 부암동까지 약 139.755m 결과는 재계산하지 않았습니다.

**홍지문 H5 — 원인 미확인**입니다. CSV와 SHP 사이 행정동 속성 차이는 공식 파일에서 직접 확인했으나 오류/수정 이력(H1), 다른 귀속 기준의 공식 정의(H2), 경계 버전 차이의 근거(H3)는 없습니다. 현재 공식 CSV도 보관 행과 같으므로 수정된 현재 파일/과거 보관 CSV라는 H4로 판정하지 않습니다. 상권이 부암동·홍은1동 양쪽에 걸친다는 공간 관찰만으로 부암동 귀속의 원인을 설명하지 않습니다.

홍지문 원인이 해결되기 전에는 OA-15560 SHP의 `SIGNGU_CD` 또는 `ADSTRD_CD` 중 어느 하나를 canonical 행정구역 속성으로 임의 선택하지 않습니다. 이 선택 유보는 행정구역 속성에 한정하며 상권 Polygon 자체나 상권 코드 `3110531`의 사용 불가로 확대하지 않습니다.

### 최종 판정과 다음 확인

전체 공간 검증은 **B 유지**, 로드맵 **4단계 미완료**입니다. 현재 배포본 동일성·행정기관 변경 코드·공식 형식 간 참조 차이는 확인했지만, 2025 통계의 참조 경계/재집계 정책과 OA-22160 geometry의 사용 적합성을 공식 근거로 연결하지 못했습니다. 2단계 대표 샘플 범위 완료·3단계 공식 원본 확보 완료는 유지합니다. 다음에는 제공기관의 공식 설명/과업 원문에서 참조 경계 버전·분동 반영/재집계 방식과 홍지문의 POINT/행정동 귀속 정의·CSV/SHP 차이의 이유를 확인해야 합니다. 이번 조사에서 담당자에게 문의를 발송하지 않았습니다.

새 다운로드·HTML·PDF·hash/비교 JSON은 Git 제외 로컬 `data/raw/spatial/stage4-research-20261007/`에 보존했습니다. 주요 기록은 `download-provenance.json`, `file-comparison.json`, `mois-comparison.json`, `current-area-csv-comparison.json`, `hongjimun-results.json`입니다. 분석 스크립트는 프로젝트 밖 `/tmp/recycleyoungs-stage4-research-mnh9y8nb/`에만 있습니다. 기존 `oa-22160-provenance.json`·`validation-results.json`은 덮어쓰지 않았습니다. 미세 중첩 13쌍은 이번 조사에서 추가 분석하지 않았으며 향후 공간 판정/정밀도 정책 검토 항목으로 유지합니다.

## 2026-10-07 결정: MVP 운영용 경계 사용

경계 버전·2025 참조 경계/재집계 공식 근거는 **unresolved**, 전체 공간 검증은 **B**, 로드맵 **4단계 미완료**, 홍지문은 **H5**로 유지합니다. 프로젝트 일정상 역사적 경계 근거 부족을 MVP 구현 blocker로 두지 않기로 결정했습니다. OA-22160은 geometry/code/name 검증을 통과한 현재 공식 **operational geometry**로 향후 좌표 → 행정동 API에 사용하고, 2025 점포/매출 통계 당시의 정확한 역사 경계라고 표현하지 않습니다.

425개 code/name 일치와 역사적 경계 미확인의 제약은 문서·향후 provenance에 유지하며 공식 경계 기준이 후속 확인되면 provenance와 판정 정책을 갱신합니다. 추가 공식 자료 조사·기관 문의는 후속 선택 작업입니다. 홍지문 행정구역 속성의 canonical 임의 선택 유보는 유지하되 상권 Polygon 전체·상권 코드의 사용 금지로 확대하지 않습니다.

## 2026-10-07 공간 데이터 5·6단계 검증

시작 상태는 `main` / `a72514a73c985a62f62ea554531a1d749e5fa4b7`, 초기 `git status --short` 출력 없음입니다. 기존 OA-15560 ZIP을 재사용하고 전체 상권 geometry·코드 연결과 SEMAS CAFE만 검사했습니다. 4단계 재조사·기관 문의·DB 연결·ETL 실행·적재·migration·production/dependency 변경은 하지 않았습니다. 전체 B·OA-22160 operational geometry·4단계 미완료/known limitation/MVP blocker 아님·홍지문 H5를 유지합니다.

분석 스크립트는 프로젝트 밖 `/tmp` 계열의 `recycleyoungs-stage56-jcs5y5bp/`에만 만들었습니다. 사용 도구는 Python 3.13.16·pyshp 3.1.6·Shapely 2.1.2(GEOS 3.13.1)·pyproj 3.7.0(PROJ 9.4.1)이며, XLSX는 bundled Python의 pandas로 읽기만 했습니다. HWP 활용가이드 추출에 필요한 olefile 0.47은 프로젝트 밖 별도 임시 venv에만 설치했습니다. 원본은 변경하지 않았습니다.

### 입력 무결성과 상권 공식 원본

| 입력 CSV | bytes | SHA-256 | 실제 행 수 / manifest 일치 |
| --- | --- | --- | --- |
| `서울시 상권분석서비스(영역-상권).csv` | 175854 | `6a6e19141f39712594a2eb42199e38e98ca2c8c06c5d4c5bd3fa39aee06ffd15` | 1650 / 크기·hash·행 수 모두 일치 |
| `서울시 상권분석서비스(추정매출-상권)_2025년.csv` | 39698674 | `2e299cd3e78a98d9b46634af0cc768276d8d270eb4c38b5f1b1ce54f8dcd828f` | 85732 / 크기·hash·행 수 모두 일치 |
| `소상공인시장진흥공단_상가(상권)정보_서울_202606.csv` | 301889640 | `08d3fd08b37840256cccd4f09bad6fc33133b647cbff05f22f26fc962cf84152` | 554092 / 크기·hash·행 수 모두 일치 |

공식 [서울시 상권분석서비스(영역-상권), OA-15560](https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do)의 서울시 파일 서버 form으로 2026-10-07T15:30:00+09:00 확보한 `서울시 상권분석서비스(영역-상권).zip`을 재사용했습니다. 원본은 Git 제외 `data/raw/spatial/stage4-research-20261007/official-commercial-area.zip`이며 2123078 bytes·SHA-256 `38bb8fab4e45a1171af4989cd7fa1275f68e5d644aa770f5431ce7ccc38384dd`가 기존 provenance와 일치합니다. 이번 전체 검사는 2026-10-07T16:27:27.251386+09:00에 시작했습니다. 재다운로드하지 않았습니다.

| archive member | bytes |
| --- | --- |
| `서울시 상권분석서비스(영역-상권).cpg` | 5 |
| `서울시 상권분석서비스(영역-상권).dbf` | 800636 |
| `서울시 상권분석서비스(영역-상권).prj` | 417 |
| `서울시 상권분석서비스(영역-상권).shp` | 3642228 |
| `서울시 상권분석서비스(영역-상권).shx` | 13300 |

SHP 1레이어, CPG/DBF UTF-8, PRJ parser의 EPSG:5181 식별 및 EPSG의 ESRI WKT 재파싱·축 순서 제외 비교가 일치합니다. SHP header type은 2D POLYGON이며 feature를 해석한 Polygon/MultiPolygon 건수는 아래와 같습니다. 원본 bbox(Easting/Northing, m)는 `(182079.0203, 437149.667400001, 215472.7203, 466040.15499999904)`입니다. ZIP 내부 날짜나 페이지 수정일을 역사적 경계 기준일로 확정하지 않았고 해당 버전 한계는 known limitation입니다.

실제 schema는 `TRDAR_SE_C C(1)`, `TRDAR_SE_1 C(12)`, `TRDAR_CD C(10)`, `TRDAR_CD_N C(254)`, `XCNTS_VALU/YDNTS_VALU N(38,0)`, `SIGNGU_CD C(5)`, `SIGNGU_CD_ C(40)`, `ADSTRD_CD C(8)`, `ADSTRD_CD_ C(40)`, `RELM_AR N(38,0)`입니다. 공식 sheet의 상권 코드/명칭 열과 기존 홍지문 feature 대조를 근거로 코드 필드는 `TRDAR_CD`, 이름은 `TRDAR_CD_N`을 선택했습니다. 코드는 문자열 그대로이며 정수 변환·자릿수 절단을 하지 않았습니다.

### 상권 geometry 최소 품질 검사

| 항목 | 실제 결과 |
| --- | --- |
| 전체 / 고유 상권 코드 | 1650 / 1650 |
| Polygon / MultiPolygon / 기타 | 1561 / 89 / 0 |
| NULL / empty geometry | 0 / 0 |
| valid / invalid | 1644 / 6 |
| 코드 NULL·공백 / 중복 코드 / 같은 코드 복수 feature | 0 / 0 / 0 |
| 이름 NULL·공백 / 동일 코드 복수 이름 | 0 / 0 |
| 완전 중복 geometry | WKB 동일·normalized WKB 동일·동일 bbox 후보의 공간 equals 대조 모두 0 |

invalid 원본 전체는 다음과 같습니다. `buffer(0)`·make-valid·좌표 변경 등 repair는 수행하지 않았습니다. normalized WKB는 중복 판별용으로만 사용했습니다.

| 상권 코드 | 이름 | 원본 invalid reason |
| --- | --- | --- |
| `3110137` | 성수초등학교 | `Ring Self-intersection[205520.8139 449403.567399999]` |
| `3110270` | 혜원여고 | `Ring Self-intersection[208557.9972 454737.521500001]` |
| `3110234` | 중랑역 4번 | `Ring Self-intersection[206619.9998 454998.6647]` |
| `3110407` | 도봉역 2번 | `Ring Self-intersection[203568.7644 464305.1741]` |
| `3110515` | 홍은중학교 | `Ring Self-intersection[194089.5152 454792.161599999]` |
| `3110542` | 마포구청역 7번 | `Ring Self-intersection[191209.785 451263.9614]` |

### 영역 CSV·상권 매출과 코드/이름 대조

영역 CSV `C=1650`, Polygon `P=1650`, `C ∩ P=1650`, `C - P=[]`, `P - C=[]`입니다. 이름은 원문 exact 비교했으며 아래 3건 모두 표기/명칭 차이로 기록합니다. 공백만의 차이나 중복 이름은 없고 원인을 추정해 자동 치환하지 않았습니다.

| 상권 코드 | 영역 CSV 이름 | SHP 이름 |
| --- | --- | --- |
| `3001494` | 종로?청계 관광특구 | 종로·청계 관광특구 |
| `3110024` | 혜화동주민센터 | 혜회동주민센터 |
| `3110379` | KTNG 북부지사 | KT&G 북부지사 |

상권 매출은 모든 업종·분기 85732행에서 `S_sales_area=1577`, `P=1650`, 교집합 1577, `S_sales_area - P=[]`, `P - S_sales_area=73`을 확인했습니다. 매출이 없는 73개 Polygon은 오류로 간주하지 않습니다. 전체 코드/이름 목록은 로컬 `results.json`에 보존했습니다. 매출/SHP 이름 exact 불일치는 `3110024: 혜화동주민센터 / 혜회동주민센터` 1건입니다.

| 분기 | 매출 고유 상권 | Polygon 교집합 | 매출 코드 누락 |
| --- | --- | --- | --- |
| 20251 | 1572 | 1572 | 0 |
| 20252 | 1570 | 1570 | 0 |
| 20253 | 1569 | 1569 | 0 |
| 20254 | 1565 | 1565 | 0 |

홍지문 `3110531`은 Polygon에 존재하며 geometry는 valid MultiPolygon입니다. 기존 **H5**와 행정구역 속성의 canonical 선택 유보를 유지하고, 이번에는 code 존재·validity 외 귀속 원인을 재조사하지 않았습니다.

**5단계 미완료**입니다. provenance·전체 코드 연결은 통과했지만 원본 invalid 6건이 모두 매출 코드에 해당하며 공간 판정용 처리가 해결되지 않았습니다(매출 코드 중 valid geometry 대응 1571/1577). 6건을 자동 보정하거나 silently 제외해 완료로 처리하지 않습니다. 이 geometry 품질 문제와 역사적 버전 known limitation을 구분합니다. 상권 전체 중첩·역사적 버전 조사로 범위를 확대하지 않았습니다.

### SEMAS 공식 분류 근거와 CAFE 범위 결정

[소상공인365 공식 업종분류 공지](https://bigdata.sbiz.or.kr/#/notice/267352041576902656)의 첨부 `[붙임]빅데이터플랫폼_업종분류_및_연계표.xlsx`를 확보했습니다. 106067 bytes·SHA-256 `89b6aae58262c89225752a5764ffa3901b174113aaa8c3edf148af25a1646986`, 다운로드 파일 기록 시각 2026-10-07T16:34:34+09:00입니다. 공식 첨부 메타데이터의 파일명·크기와 일치합니다. 공지는 2025-01-07 게시, 변경 적용은 2023 Q1부터라고 설명하며 대분류 10·중분류 75·소분류 247개와 현재 서울 CSV의 코드 체계를 대조했습니다. 이 날짜를 서울 점포 CSV의 실제 다운로드일로 사용하지 않습니다.

공식 workbook `1. 상권_업종분류(247)!A115:F115`는 `I2 음식점업 → I212 비알코올 음료점업 → I21201 카페`입니다. `2. 표준산업분류(10차)_연계표!A134:J135`는 I21201에 `I56221 커피 전문점`, `I56229 기타 비알코올 음료점업`을 연결합니다. `3. 상권_업종연계표(837-247)!A423:I428`에는 커피전문점/카페/다방·생과일주스전문점·보드게임카페·사주카페·전통찻집/인삼찻집·애견카페의 I21201 통합이 명시됩니다.

[현재 공식 데이터 안내](https://bigdata.sbiz.or.kr/#/notice/384818589907726336)와 [공공데이터포털 API](https://www.data.go.kr/data/15012005/openapi.do)는 상권업종분류와 표준산업분류가 정제 과정에서 상이할 수 있다고 설명합니다. 공개 활용가이드 ZIP(260805, 494378 bytes·SHA `4ed2112e2a90e49e88243fa7963ae7d19628aed247b6492bcbae6a947534970e`)의 경도/위도 필드 설명은 WGS84입니다. 프로젝트 밖 임시 환경에서 HWP 본문을 읽었으며 상가업소 OpenAPI 조회·변경요청은 실행하지 않았습니다.

**MVP에서는 공식 SEMAS 소분류 경계를 그대로 사용하는 단순하고 재현 가능한 정책으로 I21201 전체 22739개를 CAFE 경쟁군으로 채택합니다.** 최종 `M_cafe={I21201}`, `CAFE → SEMAS / I21201`이며 서울시 `SEOUL / CS100010`과 독립된 매핑 근거입니다. 실제 DB insert·`stores.industry_id` 채우기·ETL mapping 코드는 추가하지 않았습니다. 커피만의 순수 집합이라고 표시하지 않으며 KSIC·상호명으로 추가 포함/제외하지 않습니다.

### 후보 분포·포함/제외 기준

키워드 커피·카페·음료·다방·찻집과 분류 계층으로 후보를 탐색하고 빵/떡/아이스크림/버거/편의점을 제외 비교군으로 추가했습니다. 아래 행 수와 고유 점포 수는 모두 같습니다. 현행 공식 비알코올 중분류에는 I21201 한 소분류만 있으며 주스점/전통찻집을 별도 현행 코드로 만들지 않았습니다. MVP 정책은 I21201의 공식 통합 범주 전체를 포함하도록 정의하며, 이 정책에서 미결 ambiguous 소분류는 없습니다. 개별 점포의 실제 영업 형태를 전수 인증했다는 뜻은 아닙니다.

| 소분류 코드 / 이름 | 원본 대분류 / 중분류 | row = 고유 source id | 결정 |
| --- | --- | --- | --- |
| `G20405` 편의점 | `G2` 소매 / `G204` 종합 소매 | 9395 | excluded |
| `G20507` 아이스크림 할인점 | `G2` 소매 / `G205` 식료품 소매 | 35 | excluded |
| `G20601` 얼음 소매업 | `G2` 소매 / `G206` 음료 소매 | 24 | excluded |
| `G20602` 주류 소매업 | `G2` 소매 / `G206` 음료 소매 | 425 | excluded |
| `G20603` 생수/음료 소매업 | `G2` 소매 / `G206` 음료 소매 | 236 | excluded |
| `G20604` 우유 소매업 | `G2` 소매 / `G206` 음료 소매 | 73 | excluded |
| `I21001` 빵/도넛 | `I2` 음식 / `I210` 기타 간이 | 6119 | excluded |
| `I21002` 떡/한과 | `I2` 음식 / `I210` 기타 간이 | 1063 | excluded |
| `I21004` 버거 | `I2` 음식 / `I210` 기타 간이 | 1051 | excluded |
| `I21008` 아이스크림/빙수 | `I2` 음식 / `I210` 기타 간이 | 531 | excluded |
| `I21201` 카페 | `I2` 음식 / `I212` 비알코올 | 22739 | included |
| `R10202` 독서실/스터디 카페 | `R1` 예술·스포츠 / `R102` 도서관·사적지 | 2728 | excluded |

I21201은 통합 카페 경쟁군으로 포함하고, 기타 표의 소매·독서실·간이음식 분류는 CAFE에서 제외합니다. 식당의 음료 판매나 상호의 카페/커피 키워드만으로 원본 소분류를 재분류하지 않습니다. 표의 현행 소분류에 대한 판단만 하며 KFOOD/PUB/HAIR/GYM 내부 매핑은 결정하지 않았습니다. 원본 중분류명 `비알코올 `의 후행 공백은 보존하며 코드 기반 판정에 사용하지 않습니다.

각 후보의 대표 상호는 원본 파일 순서 첫 10건이며 랜덤 선정하지 않았습니다(상호는 분류 의미 대조용). 전체 source id·지점명·대표 상호는 로컬 후보 JSON에 보존했고 여기에는 5개씩 기록합니다.

| 소분류 | 대표 상호 5개 |
| --- | --- |
| `G20405` | GS25공덕블레스점 / GS25을지로 / GS25원효타운점 / GS25중곡마루점 / CU구로우리점 |
| `G20507` | 진호 / 얼음왕국아이스크림할인점신월229호 / 으뜸유통 / 올인원아이스크림 / 띵동아이스크림 |
| `G20601` | 아보 / 물병자리 / 강북얼음 / 신강얼음 / 금방유통 |
| `G20602` | 인터와인 / 주담터-롯데백화점 / 트렌스보틀 / 셀프와인청담점 / 세계주류 |
| `G20603` | 코카콜라EDP / 서초도곡스파클 / 현상사 / 서울우유공항 / 동원샘물여의도，마포 |
| `G20604` | 크로스비트레이딩 / 와인마트 / 제주성이시돌목장유기농우유용산 / 양천상하목장DS / 건국우유개봉보급소 |
| `I21001` | 브리오슈도레정동점 / 페이브푸드 / 빠띠스리크로스비 / 에스피씨삼립빚은연세세브란스 / 싸일러 |
| `I21002` | 소녀방앗간 / 여의도떡방 / 떡마을 / 명품떡고추방앗간 / 태양떡집 |
| `I21004` | 비케이알버거킹공릉역점 / 비케이알버거킹 / 모스버거방배점 / 버거킹 / 테이스터스바스버거 |
| `I21008` | 헬로앨리스마켓24 / 젤라떼리아에따 / 설빙 / 설빙 / 배스킨라빈스내방점 |
| `I21201` | 커피빈마리오아울렛점 / 할리스커피한남순천향점 / 더벤티숙대점 / 투썸플레이스 / 엔제리너스사거리 |
| `R10202` | 잇올스파르타성북관리형프리미엄독서실 / 잇올스파르타관리형프리미엄독서실 / 잇올스파르타프리미엄관리형독서실 / 토즈스터디센터압구정2독서실 / 잇올스파르타관리형독서실 |

I21201의 원본 표준산업분류 분포는 I56221 20533행·I56229 1750행·그 밖의 코드/공란 456행(공란 8행 포함)입니다. 공식 정제 차이 안내와 공식 소분류 전체를 유지하는 MVP 정책에 따라 추가 KSIC 필터를 적용하지 않았습니다. 제과/주스/찻집 중복 영업이나 원본 분류 오차 가능성은 이 경쟁군의 한계로 기록합니다.

### 점포·CAFE 품질과 offline 반경 sanity

점포 CSV는 301889640 bytes·UTF-8 BOM(`utf-8-sig`), 전체 554092행이며 manifest의 크기/SHA/행 수와 일치합니다. 실제 필드는 `상가업소번호`, `상호명`, `지점명`, 대/중/소분류 코드·명, `표준산업분류코드/명`, `경도`, `위도`입니다. ID는 문자열 그대로 보존했습니다.

| 검사 | 전체 점포 | I21201 CAFE |
| --- | --- | --- |
| row / 고유 source id | 554092 / 554092 | 22739 / 22739 |
| finite·전세계 경위도 범위 valid row | 554092 | 22739 |
| 경도 NULL / 위도 NULL / 숫자 파싱 실패 / 비유한값 / 전세계 범위 오류 | 모두 0 | 모두 0 |
| 서울권 bbox 밖 | 0 | 0 |
| source id 공란 / 중복 / 동일 ID의 복수 소분류 | 모두 0 | 모두 0 |

서울권 sanity bbox는 경도 `[126.7, 127.2]`·위도 `[37.4, 37.75]`로 미리 정의했습니다. 이는 보수적 범위 검사이며 정확한 서울 행정경계 포함 전수 검증을 대신하지 않습니다. 2026-06은 파일명 기준 스냅샷으로 유지하고 2025 통계와 동일 시점 또는 스냅샷 누락=폐업으로 해석하지 않습니다.

고정 예시 세 곳에서 pyproj `Geod(ellps="WGS84")`의 타원체 역측지 거리(m), `distance <= radius`로 포함 source id 수를 계산했습니다. 동일 ID 중복은 없어 row count와 같습니다. 보행거리·production 서비스 결과 검증이 아닌 offline 데이터 조회 가능성 sanity입니다.

| 예시 / (longitude, latitude) | 300m | 500m | 1000m |
| --- | --- | --- | --- |
| 청운효자동 부근 / (126.969, 37.5825) | 43 | 86 | 163 |
| 강남역 부근 / (127.0276, 37.4979) | 92 | 174 | 506 |
| 성수역 부근 / (127.0559, 37.5445) | 50 | 125 | 362 |

**6단계 완료: CAFE 범위**입니다. 공식 분류표·통합 범주를 채택한 MVP 정책·포함/제외 규칙·2026-06 분포·좌표 품질·offline 반경 계산 가능성을 확인했습니다. 전체 업종 매핑 완료나 production 적재/조회 완료로 표시하지 않습니다.

상권 5단계의 남은 문제는 invalid 6건 처리 정책이며 역사적 버전 근거를 새 필수 blocker로 추가하지 않습니다. 새 검증 결과·공식 첨부·provenance는 Git 제외 `data/raw/spatial/stage56-validation-20261007/`의 `results.json`, `provenance.json`, `candidates.json`, `semas-classification.xlsx` 등에 보존했습니다. 기존 raw 산출물을 덮어쓰거나 `.gitignore`·manifest를 변경하지 않았습니다.

## 2026-10-07 invalid 상권 6건 operational geometry 검증

시작 상태는 `main` / `c6ae60cf58ca085db1d827c300c3ee1511e48f44`, 초기 `git status --short` 출력 없음입니다. 기존 OA-15560 원본과 5단계 결과를 재사용해 알려진 feature index 6개만 읽었습니다. 1650개 전수 geometry/코드 집합 검사는 반복하지 않았고, 상권 매출도 이 6개 코드의 분기 존재/행 수만 추출했습니다. 검사 시각은 2026-10-07T19:10:45.454236+09:00~2026-10-07T19:22:45.428952+09:00(Asia/Seoul)입니다.

### 원본 보존·도구와 격리 환경

OA-15560 원본 ZIP SHA-256 `38bb8fab4e45a1171af4989cd7fa1275f68e5d644aa770f5431ce7ccc38384dd` 및 기존 SHP/SHX/DBF/PRJ/CPG member hash를 대조했습니다. 원본 ZIP·5개 파일·영역 CSV·상권 매출 CSV의 크기/SHA를 검사 전후 및 완료 시점에 다시 대조했고 모두 동일합니다. raw를 수정하거나 repaired SHP로 대체하지 않았습니다. 원본 EPSG:5181, 거리 m·면적 m²에서만 repair를 검사했습니다.

- Python 3.13.16 / Shapely 2.1.2 / GEOS 3.13.1 / pyshp 3.1.6 / pyproj 3.7.0 / PROJ 9.4.1.
- 기존 프로젝트 밖 임시 venv를 사용했습니다. 시각 대조용 Matplotlib 3.10.7만 해당 임시 환경에 추가했으며 production dependency는 바꾸지 않았습니다.
- 비교용 image `postgis/postgis:16-3.4`, PostgreSQL 16.4 / PostGIS 3.4.3 / GEOS 3.9.0 / PROJ 7.2.1.
- `docker run --rm` 컨테이너와 project label `recycleyoungs-six-repair-i7hyjy2p`, network `none`, host port 없음, `/var/lib/postgresql/data` tmpfs, 기존/별도 named volume mount 없음.
- 임시 DB `repair_validation`의 Unix socket에 `docker exec psql`로만 연결했습니다. 여섯 WKB literal의 SELECT/CTE 검사이며 table·migration·적재 작업은 하지 않았습니다. 검사 후 해당 임시 컨테이너만 stop/자동 제거했고 기존 `startup-analysis-postgres`와 기존 volume 목록은 유지됐습니다. 기존 개발 DB에는 연결하지 않았습니다.

[Shapely make_valid](https://shapely.readthedocs.io/en/stable/reference/shapely.make_valid.html)의 `linework`와 `structure`를 각각 `keep_collapsed=True`로 실행했습니다. [PostGIS ST_MakeValid](https://postgis.net/docs/ST_MakeValid.html)는 기본 linework로 비교했습니다. 임시 환경의 GEOS 3.9.0은 structure에 필요한 GEOS 3.10 이상 조건을 충족하지 않아 PostGIS structure 비교는 수행하지 않았습니다. 두 구현은 같은 GEOS 알고리즘 계열이므로 완전히 독립적인 알고리즘 검증이 아니라 구현/버전 호환 대조입니다.

### 6건 원본과 self-intersection의 실제 구조

6건 모두 원본은 invalid Polygon 1개·ring 1개·명시된 hole 0개이며 reason은 `Ring Self-intersection`입니다. 원본 area는 유효하지 않은 형상의 진단 수치이며 실제 영역의 ground truth로 취급하지 않습니다.

| 코드 / 이름 | raw area m² | raw ring vertex 수* | 반복 vertex index | self-touch 원본 좌표 | loop area m² / 둘레 m | 전체 bbox 대각선 m |
| --- | --- | --- | --- | --- | --- | --- |
| `3110137` 성수초등학교 | 330982.766709656338 | 144 | [0, 8] | (205520.8139, 449403.567399999) | 12898.182058 / 470.769186 | 1131.265014 |
| `3110270` 혜원여고 | 35643.832793595917 | 85 | [0, 25] | (208557.9972, 454737.521500001) | 5784.420276 / 352.112210 | 414.322346 |
| `3110234` 중랑역 4번 | 58421.426861916028 | 87 | [0, 8] | (206619.9998, 454998.6647) | 4298.598846 / 270.485759 | 627.874112 |
| `3110407` 도봉역 2번 | 454339.648021544563 | 367 | [0, 36] | (203568.7644, 464305.1741) | 1750.136106 / 190.338610 | 1300.479599 |
| `3110515` 홍은중학교 | 64938.467160828674 | 137 | [0, 25] | (194089.5152, 454792.16159999906) | 1738.768568 / 171.964974 | 682.703992 |
| `3110542` 마포구청역 7번 | 123656.428756203270 | 148 | [0, 19] | (191209.785, 451263.96140000003) | 4909.151117 / 282.154459 | 787.299291 |

*마지막 폐합 좌표를 제외한 ring vertex 수이며 동일 좌표의 재방문을 포함합니다. 원본 feature/ring의 segment index·양끝 좌표·길이·문제 위치까지 거리와 원본 전체 bbox는 로컬 `results.json`에 보존했습니다. 두 코드의 reason 문자열 좌표와 실제 vertex 간 최대 약 `5.82e-11m` 차이는 출력 반올림 차이로 구분했으며 진단 anchor만 원본의 최근접 vertex로 식별했습니다. source 좌표를 snap/수정하지 않았습니다.

문제는 미세한 line spike 제거로 설명되지 않습니다. 첫 꼭짓점에서 내부 closed loop를 돌아 같은 꼭짓점으로 복귀한 뒤 외곽을 도는 한 ring의 self-touch 표현입니다. 여섯 loop는 유효한 Polygon이고 counterclockwise이며, make_valid 결과의 hole과 각각 topological equality가 참입니다. 면적 1738.77~12898.18m²인 의미 있는 loop를 버리거나 채운 것이 아니라 외곽과 hole로 분리해 보존했습니다. 큰 bow-tie 영역을 임의 선택해 없앤 결과는 관찰되지 않았습니다. 원본 경계 linework와 모든 고유 vertex가 결과에 그대로 남았습니다.

원본 bbox와 linework/structure/PostGIS 보정 bbox를 실제 좌표값으로 비교했습니다. 아래 bbox는 각 원본과 모든 보정 후보에 공통이며 변화는 `(0,0,0,0)m`입니다.

| 코드 | bbox `(xmin,ymin,xmax,ymax)` EPSG:5181 |
| --- | --- |
| `3110137` | `(205097.7793, 449187.318299999, 205961.7926, 449917.55220000097)` |
| `3110270` | `(208470.6102, 454530.752, 208715.9066, 454864.657199999)` |
| `3110234` | `(206246.9093, 454789.076400001, 206821.6645, 455041.825999999)` |
| `3110407` | `(203107.6069, 463509.5525, 203977.5963, 464476.17840000096)` |
| `3110515` | `(194070.1112, 454482.09930000105, 194293.7685, 455127.1281)` |
| `3110542` | `(190970.6954, 451082.60170000105, 191641.7294, 451494.3705)` |

### make_valid·buffer(0) 정량 대조

linework·structure·진단용 buffer(0)은 6건 모두 valid / non-empty Polygon 1개, 외곽 ring 1개 + hole 1개입니다. MultiPolygon 0·GeometryCollection 0·non-polygon component 0이며 polygonal component만 추출하거나 line/point를 버린 사례는 없습니다.

| 코드 | linework area m² | linework 절대 Δm² / 상대 Δ% | structure 절대 Δm² / 상대 Δ% | buffer(0) 절대 Δm² |
| --- | --- | --- | --- | --- |
| `3110137` | 330982.766709656280 | 5.82076609135e-11 / 1.75863116657e-14 | 5.82076609135e-11 / 1.75863116657e-14 | 5.82076609135e-11 |
| `3110270` | 35643.832793595910 | 7.27595761418e-12 / 2.04129495734e-14 | 0 / 0 | 0 |
| `3110234` | 58421.426861916014 | 1.45519152284e-11 / 2.49085241666e-14 | 0 / 0 | 0 |
| `3110407` | 454339.648021544388 | 1.7462298274e-10 / 3.84344583399e-14 | 5.82076609135e-11 / 1.28114861133e-14 | 5.82076609135e-11 |
| `3110515` | 64938.467160828623 | 5.09317032993e-11 / 7.84307137604e-14 | 7.27595761418e-12 / 1.12043876801e-14 | 7.27595761418e-12 |
| `3110542` | 123656.428756203313 | 4.36557456851e-11 / 3.53040647577e-14 | 8.73114913702e-11 / 7.06081295153e-14 | 8.73114913702e-11 |

각 원본 bbox와 세 결과 bbox는 동일하며 xmin/ymin/xmax/ymax 변화는 모두 0m입니다. 면적 차이만으로 합격시키지 않았습니다. 경계/vertex 보존·동일 hole·아래 공간 관계 및 방법 간 동일성을 함께 근거로 판단했고 임의의 단일 면적 threshold를 도입하지 않았습니다. 원본과 결과의 경계선 equality가 참이며, linework/structure/buffer(0)의 polygonal equality가 모두 참·symmetric difference는 empty/0m²·Hausdorff distance 0m입니다. 면적 산출의 작은 차이는 이러한 동일성 근거에 따라 부동소수점 계산 순서 차이로 해석했습니다.

**buffer(0)은 진단 비교용이며 production canonical repair 방식으로 채택하지 않습니다.** 이번 6건에서는 component/공간 영역 차이가 없었지만 다른 입력에도 같다고 일반화하지 않습니다.

### 대표 POINT·내부/hole·문제 지점 주변 영향

| 코드 | CSV X / Y | 후보 within / contains / covers | raw representative / centroid covers | 안정적 내부 표본 | hole 제외 표본 | PostGIS 전체 관계 표본 |
| --- | --- | --- | --- | --- | --- | --- |
| `3110137` | 205519 / 449630 | true / true / true | true / true | 36 모두 포함 | 14 모두 제외 | 101 |
| `3110270` | 208593 / 454695 | true / true / true | true / true | 31 모두 포함 | 11 모두 제외 | 93 |
| `3110234` | 206502 / 454920 | true / true / true | true / true | 26 모두 포함 | 15 모두 제외 | 92 |
| `3110407` | 203614 / 463983 | true / true / true | true / true | 34 모두 포함 | 14 모두 제외 | 99 |
| `3110515` | 194180 / 454791 | true / true / true | true / true | 31 모두 포함 | 16 모두 제외 | 98 |
| `3110542` | 191345 / 451292 | true / true / true | true / true | 30 모두 포함 | 13 모두 제외 | 94 |

원본 representative point·centroid와 고정 7×7 bbox grid에서 source ring의 독립 even-odd ray 판정으로 내부이고 경계 위가 아닌 점을 골랐습니다. 총 188개 내부 표본이 보정 후에도 포함됐습니다. 원본 closed loop의 대표점/고정 grid 83개는 source even-odd와 결과 모두 영역 밖(hole)으로 유지됐습니다. invalid 원본의 GEOS predicate만을 ground truth로 사용하지 않았습니다.

문제 지점 주변은 교차점 자체와 0.0001/0.001/0.01/0.1/1/5m의 8방향 offset으로 코드별 49개·총 294개를 검사했습니다. 이 값은 표본 간격이며 acceptance threshold가 아닙니다. linework·structure·buffer(0)의 within/contains/covers 차이는 0입니다. 원본의 정확한 self-touch vertex는 모든 후보에서 within=false / contains=false / covers=true로 경계 관계를 유지했습니다. 원본/결과 ring vertex·전체 형상은 진단 그림으로도 대조했습니다.

### PostGIS 비교와 deterministic 재현

6건 모두 임시 PostGIS ST_MakeValid 결과가 valid / non-empty Polygon 1개·hole 1개·non-polygon 0입니다. Shapely linework 및 structure와 ST_Equals=true, symmetric difference empty/0m², bbox 변화 0m이며 대표 POINT 관계도 모두 true입니다. 이 입력/버전에서 PostGIS WKB bytes는 Shapely linework WKB와도 동일했습니다. 다른 버전에도 WKB 순서까지 같다고 일반화하지 않습니다.

CSV 대표점 6개·정확한 self-touch vertex 6개·내부 188개·hole 83개·문제 지점 주변 294개, 총 **577개 표본 레코드**의 within/contains/covers를 임시 PostGIS와 대조했고 각각 mismatch 0입니다. 교차점 등 같은 좌표가 여러 표본 역할에 등장하는 중복을 포함한 기록 수입니다. 동일 source WKB를 같은 버전/명시 인자로 세 번 호출하고 별도 Python 프로세스에서 재실행해 linework·structure 각각 6건 모두 출력 WKB SHA 동일성을 확인했습니다. 고정 source SHA/raw WKB·방법·인자·도구 버전·파생 WKB SHA를 기록해야 재현 가능한 profile이 됩니다.

### 매출 사용 영향·최종 decision

상권 매출 값을 재검산하지 않고 아래 여섯 코드의 분기별 원본 레코드 수만 확인했습니다. 모두 네 분기에 존재하므로 미지원 처리하면 아래 상권의 Q1~Q4 공간 선택/연결에 영향을 줍니다. 표의 수는 업종별 CSV 행 수이며 매출액·점포 수가 아닙니다.

| 코드 | 20251 | 20252 | 20253 | 20254 |
| --- | --- | --- | --- | --- |
| `3110137` | 23 | 23 | 24 | 23 |
| `3110270` | 6 | 7 | 7 | 7 |
| `3110234` | 6 | 7 | 6 | 5 |
| `3110407` | 21 | 20 | 20 | 20 |
| `3110515` | 3 | 2 | 2 | 2 |
| `3110542` | 19 | 17 | 18 | 18 |

| 코드 / 이름 | raw valid | operational method / type | operational valid | 절대 area Δm² | 대표 POINT covers | PostGIS agreement | decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `3110137` 성수초등학교 | false | linework / Polygon | true | 5.82076609135e-11 | true | equality·표본 관계 일치 | ACCEPTABLE |
| `3110270` 혜원여고 | false | linework / Polygon | true | 7.27595761418e-12 | true | equality·표본 관계 일치 | ACCEPTABLE |
| `3110234` 중랑역 4번 | false | linework / Polygon | true | 1.45519152284e-11 | true | equality·표본 관계 일치 | ACCEPTABLE |
| `3110407` 도봉역 2번 | false | linework / Polygon | true | 1.7462298274e-10 | true | equality·표본 관계 일치 | ACCEPTABLE |
| `3110515` 홍은중학교 | false | linework / Polygon | true | 5.09317032993e-11 | true | equality·표본 관계 일치 | ACCEPTABLE |
| `3110542` 마포구청역 7번 | false | linework / Polygon | true | 4.36557456851e-11 | true | equality·표본 관계 일치 | ACCEPTABLE |

**ACCEPTABLE=6 / REVIEW_REQUIRED=0 / UNSUPPORTED=0**입니다. 단일 숫자 cutoff 없이 유효한 Polygon 확보·원본 linework/vertex/bbox와 hole 의미 보존·대표점/내부/교차점 관계·대체 방법 및 PostGIS 호환·고정 입력 재현을 종합해 판정했습니다.

### operational geometry 정책과 5단계 완료 범위

1. OA-15560 원본 ZIP/SHP와 source geometry는 불변으로 보존합니다. 파생 operational geometry는 source와 구분해 기록하며 원본이 수정되거나 raw invalid가 valid로 바뀌었다고 표현하지 않습니다.
2. 이번에 검증된 source ZIP SHA·6개 code·raw WKB SHA profile에서는 `make_valid(method="linework", keep_collapsed=True)`의 Polygon 결과를 파생 operational 후보로 채택합니다. 임시 PostGIS 기본 linework와 호환되는 것을 확인했습니다. 기존 valid 1644건은 이전 검증을 재사용하며 불필요하게 repair하지 않습니다.
3. 이번 6건은 GeometryCollection/line/point가 없어 polygon-only 추출·discard가 필요하지 않았습니다. 향후 예상 밖 component나 공간 의미 변화가 나오면 자동 추출/제거·buffer(0) fallback 없이 REVIEW_REQUIRED로 별도 검토합니다. 이번 acceptance를 다른 invalid 입력에 자동 적용하지 않습니다.
4. source dataset ID·파일 SHA·feature index/code·CRS·raw WKB SHA·검사 상태·method/인자/버전·operational WKB SHA와 연결 근거를 보존합니다. source/raw와 validated operational의 분리 방향은 확정하되 별도 column/table 및 quality enum의 실제 스키마는 다음 7단계에서 결정합니다.

**5단계 완료: operational geometry 정책**으로 기록합니다. 6건 모두 ACCEPTABLE·원본 보존·파생 생성 규칙·동일 입력 재현·raw/operational 분리 방향을 충족했습니다. 실제 production 적재·Flyway V2·API 구현 완료나 역사적 경계 버전 완전 검증을 뜻하지 않습니다. **전체 공간 B·4단계 미완료 known limitation/MVP blocker 아님·홍지문 H5·6단계 CAFE 범위 완료는 유지**합니다.

새 결과·원본/파생 WKB·PostGIS 비교·재현 기록·진단 그림은 Git 제외 `data/raw/spatial/six-repair-validation-20261007/`의 `results.json`, `derived-operational-geometries.json`, `six-fixtures.json`, `postgis-results.jsonl`, `postgis-point-results.jsonl`, `replay-results.json`, `six-geometry-overview.png` 등에 보존했습니다. 이 JSON은 파생 검증 산출물이며 repaired SHP나 production raw 입력으로 저장하지 않았습니다. 분석/SQL 스크립트는 프로젝트 밖 임시 디렉터리에만 있습니다. 기존 공간 검증 산출물·manifest·architecture·production code/dependency는 변경하지 않았고 Git stage/commit/push도 하지 않았습니다.

## 2026-10-07 공간 DB 7단계 V2 설계 확정

시작은 `main` / `10384c550044839b73df99d44262f4db22432755`, `git status --short` 출력 없음이었습니다. V1·지정 문서 전체·manifest·현재 ETL·Backend JdbcClient/행정동 SQL/Flyway·Compose/Makefile을 직접 읽었습니다. 기존 세션 상태나 미커밋 파일을 전제하지 않았습니다. 설계 source of truth는 새 [spatial-schema-v2.md](spatial-schema-v2.md)입니다.

| 결정 | 확정 내용 |
| --- | --- |
| table / version | admin_dong_boundaries·commercial_area_boundaries 분리, surrogate PK + version/code UNIQUE, 같은 code의 여러 version 보존 |
| provenance / current | spatial_dataset_versions에 ZIP/처리 profile hash·분리된 날짜·reference verified·historical UNRESOLVED·report/도구 metadata. 종류별 is_current partial UNIQUE, 완전 적재 READY만 공개 |
| geometry / quality | 같은 row의 source/operational 5181, 원래 source Polygon/MultiPolygon과 invalid 보존, operational valid MultiPolygon. VARCHAR+CHECK 4status, 6건만 linework repair metadata/hash |
| 불변성 / index | INSERT-only boundary/lifecycle guard 2함수/3trigger. operational partial GiST, version/code·feature UNIQUE 겸용 lookup. source/radius index 추가 없음 |
| PIP | POINT4326→5181, Covers. 행정동 0=OUTSIDE_OR_UNSUPPORTED/1=RESOLVED/2+=AMBIGUOUS_BOUNDARY 전체 후보. 원본 미세 중첩 유지. 상권은0..N membership |
| 홍지문 / 통계 연결 | source_sigungu_code/source_dong_code와 CONFLICT_OBSERVED/H5, canonical FK/자동 동기화 없음. V1 통계/대표점과 application code join, 역사적 동일성 주장 금지 |
| SEMAS / stores | 기존 industry_mappings 재사용, SEMAS/I21201→CAFE. V3에서 기존 NULL I21201만 최소 backfill, 충돌은 실패. 8단계 ETL은 SEMAS map으로 materialize, 미매핑 NULL |
| migration | V2 공간 schema / V3 reference+최소 backfill, 각각 transaction. V2 성공/V3 실패의 부분 적용 상태를 명시. 기존 통계/점포/대표 POINT 보존, fresh도 동일 논리 결과 |

전체 B·4단계 미완료 known limitation/MVP blocker 아님·홍지문 H5·5단계 ACCEPTABLE6·6단계 CAFE 범위 완료는 유지합니다. OA-15560 좌표 검산과 현재 공식 CSV/보관 CSV byte·SHA 동일성의 완료를 architecture에 반영했으며 최초 배포/역사적 경계 시점은 미확인으로 남겼습니다. SEMAS 데이터 검증 완료와 실제 DB/ETL 미반영을 구분했습니다.

### isolated DDL spike

프로젝트 밖 `/tmp/ry-spatial-schema-g5J45k/`에서만 임시 DDL/합성 fixture를 만들었습니다. container `ry-spatial-schema-g5j45k`는 network none·host port 없음·data/init-dir tmpfs·named volume/bind mount 없음으로 생성했습니다. PostgreSQL16.4/PostGIS3.4.3/GEOS3.9.0/PROJ7.2.1, 전용 DB3개와 docker exec Unix socket만 사용했습니다.

geometry typmod·hash/NULL/quality CHECK·version/code UNIQUE·종류 composite FK·current partial UNIQUE·불변성/완전 적재 trigger를 실제 SQL로 확인했습니다. 공유 경계 Covers2/Containsfalse, 4326 입력 내부1/외부0, operational GiST 접근 경로(EXPLAIN; enable_seqscan=off)를 확인했습니다. 이는 index 사용 가능성 검사이며 실제 원본 workload 성능 보증은 아닙니다.

합성 populated fixture에서는 통계·대표 POINT·점포 id/업종 외 값을 양방향 비교하여 보존하고 CAFE2행만 backfill, 나머지 NULL 및 반복 실행 결과를 확인했습니다. fresh0행 성공과 conflicting mapping/점포 id 거부, current 전환 실패 rollback, DDL 생성 후 강제 실패의 rollback도 확인했습니다. 첫 보존 검사 SQL은 EXCEPT/UNION ALL 괄호 문제로 오검출했고 최소 재현 후 수정해 새 합성 DB에서 통과했습니다.

spike는 실제 Flyway V2/V3·원본2075건 ETL·현재 populated DB의 적용/보존 검증을 대신하지 않습니다. 상세 수용 검증은 설계 문서의 8단계 목록입니다. 임시 container는 종료/자동 제거했고 기존 `startup-analysis-postgres`는 같은 ID `983e738d45ac`/healthy를 유지했습니다. 기존 개발 DB에 연결하거나 volume을 mount/변경하지 않았습니다.

**2차 7단계 완료: V2 설계**입니다. 8단계는 V2/V3 migration·Polygon2종 ETL·current 원자적 전환·stores SEMAS materialization과 fresh/populated/rollback/원본 보존 검증입니다. 새 migration 파일·production code·ETL·API·manifest·dependency·Compose/Makefile 변경 및 ETL 실행은 없습니다. Git stage/commit/push와 branch/worktree 작업도 하지 않았습니다. 7→8의 설계 blocker는 없습니다.

## 2026-10-08 공간 8-B1 Polygon ETL 구현·격리 검증

시작은 `main` / local HEAD·원격 main 모두 `90c66fe451836e703acf43409a1e823694b92ca4`, clean working tree였습니다. 기존 V1/V2/V3를 수정하지 않고 Python Polygon 전용 모듈·unittest·requirements·실행 안내를 추가했습니다. 기존 CSV `app.main`의 job/default와 `etl_stores.py`는 유지합니다.

실행 경로는 `python -m app.spatial_main`입니다. 기본/`--validate-only`/`--help`는 DB에 접속하지 않습니다. 종류·ZIP·독립적인 고정 report 경로를 명시하며, 적재는 `--load`와 explicit DSN을 함께 지정할 때만 수행합니다. `make etl`을 실행하지 않았습니다. source catalog는 지정 ZIP/member/report SHA를 고정하고 기존 report bytes를 바꾸거나 실행 중 새로운 acceptance를 생성하지 않습니다.

| 실제 입력 검증 | 결과 |
| --- | --- |
| OA-22160 ZIP | 지정 SHA `969f7033…` 일치, CP949 ZIP 이름·SHP/SHX/DBF/PRJ/CPG 5member·UTF-8 strict·5181·원문 code/name·425 valid Polygon |
| OA-15560 ZIP | 지정 SHA `38bb8fab…` 일치, 같은 형식 검사·1561 Polygon/89 MultiPolygon·raw valid1644/invalid6 유지 |
| report/acceptance | 행정동 `validation-results.json`, 상권 `stage56-validation…/results.json` 및 `six-repair-validation…/results.json`의 실제 구조/SHA 고정. 여섯 code/index/source WKB/linework Polygon SHA·hole/경계/vertex/bbox 일치 |
| operational | 행정동425 VALID_SOURCE, 상권1644 VALID_SOURCE/6 REPAIRED_OPERATIONAL, 모두 valid non-empty MultiPolygon5181. valid source에는 repair 없음 |
| 홍지문 | raw11110/11410660·CONFLICT_OBSERVED·H5 unresolved, Polygon usable. 기존 CSV/대표점 dong 속성 변경 없음 |

GEOS는 별도 Python package로 추가하지 않았습니다. 기존 Python3.12 Dockerfile을 실제 빌드하여 **Python3.12.15 / pyshp3.1.6 / Shapely2.1.2 / GEOS3.13.1 / pyproj3.7.0 / PROJ9.4.1**을 확인했습니다. 프로젝트 밖 local venv는 Python3.13.16이고 GIS 버전은 같았습니다. Python 차이는 실제 profile에 기록되며 동일 profile이라고 주장하지 않습니다. source/repair bytes는 고정 acceptance와 대조했습니다.

DB profile에는 실제 PostgreSQL16.4/PostGIS3.4.3/DB GEOS3.9.0/PROJ7.2.1을 추가합니다. report/member hash·parser/serializer·검증된 repair 목록·실제 도구/구현 파일 SHA를 canonical JSON UTF-8로 기록하며, 실행 시각/DBid/임시 물리 경로는 제외합니다. source와 operational은 NDR 2D OGC WKB(무SRID·무normalize)로 각각 hash를 계산하고 DB 저장 bytes와 core sha256을 대조합니다. repair 직후 Polygon과 저장 MultiPolygon SHA를 구분합니다.

| 격리 검증 | 실제 결과 |
| --- | --- |
| 환경 | `ry-spatial-etl-qbuykl-db`와 internal network, host port 없음, data/init-dir tmpfs, named volume 없음. DB명은 `recycleyoungs_spatial_test_…`, raw/app/tests read-only mount |
| migration | synthetic/real 각각 fresh DB에서 실제 Flyway12.4 V1→V2→V3, baseline 없음 |
| unittest | production Python3.12 image에서 46개 PASS·fail0·skip0: 기존 CSV15, 파일/CLI/DB/실제ZIP 검사. raw 없는 환경의 DB/real 검사는 명시 opt-in이며 skip을 완료 증거로 쓰지 않음 |
| 실제 publication | 별도 real DB에 행정동425/상권1650 전수 적재. 원래 type·raw invalid6 유지, operational SRID/type/validity/non-empty·Python/DB NDR hash 모두 통과 |
| lifecycle/retry | 종류별 lock/transaction, PENDING→READY-only→old current 해제→new READY current 활성화. loaded_at DB 생성. 동일 identity 재실행에서 version/rowid/hash/loaded_at 불변, current 불필요 갱신 없음 |
| 실패/동시성 | READY row/metadata 불일치 거부, PENDING incomplete 보존. 중간 INSERT/최종 current 활성화 강제 실패는 전체 rollback·기존 current 유지. 같은 profile 동시 publication은 하나의 version으로 직렬화 |
| V1 보존 | 두 종류의 실제 적재 전후 작은 V1 통계 3table·상권 대표 POINT·stores·mapping fixture의 id/전체 값/POINT 불변. 현재 개발 populated DB 전수 보존 검증을 대신하지 않음 |
| 공간/index | 홍지문 raw/H5·대표점 covers 확인, 고정 행정동 vertex Covers=true/Contains=false, operational GiST2개와 Index Scan 접근 확인(검증에서만 seqscan 비활성화). API 검증은 아님 |

초기 synthetic 손상 입력 fixture에서 ZIP pin을 바꾼 뒤 report 참조가 남아 깊은 파서 검사에 도달하지 못한 setup을 수정했습니다. 기대 검증은 약화하지 않았습니다. 추가 실패 테스트로 unpaired SHP/DBF를 조용히 zip하는 경로와 serializer Z/M 축소를 재현한 뒤 각각 명시적 거부로 수정했습니다. 원본 파일을 수정하거나 검증 실패를 삭제하지 않았습니다.

**8-B1의 구현과 실제 격리 자료 적재 검증 완료**입니다. 전체 B·4단계 known limitation·historical UNRESOLVED·홍지문 H5는 유지합니다. stores SEMAS ETL은 8-B2이며 이번에 수정하지 않았습니다. 기존 `startup-analysis-postgres`/`recycleyoungs_postgres_data`에는 연결·migration·적재·mount하지 않았습니다. 8-C 이전에는 변경 diff 리뷰, 실제 접속 대상/backup/Flyway history·checksum·V1 구조 대조, 기존 데이터 전후 비교, 명시적인 Polygon-only 실행 절차가 필요합니다. Git stage/commit/push와 branch/worktree 작업은 하지 않았습니다.

## 2026-10-08 8-B2 SEMAS stores ETL 구현·격리 검증

시작은 `main` / local HEAD·원격 main 모두 `c51422489427eac024ead14591df68f67b7ea829`, clean working tree였습니다. `etl_stores.run()`에서 caller의 transaction으로 기존 `load_industry_map()`을 한 번 읽고, `industries.code='CAFE'`의 실제 id와 `SEMAS/I21201` mapping을 비교합니다. CAFE 부재·mapping 부재·다른 업종 연결은 `TRUNCATE` 전에 명시적으로 실패합니다. mapping 생성·CAFE id 숫자 고정·별도 connection·내부 commit은 없습니다.

각 점포의 기존 `clean_text` 소분류를 `('SEMAS', code)`로 조회하여 기존 industry_id 위치에 전달합니다. 미매핑/빈 code와 SEOUL에만 존재하는 code는 NULL입니다. KSIC·상호·브랜드로 I21201 범위를 바꾸지 않으며 source code/name·UTF-8-SIG·청크·nullable 속성·좌표 검사·POINT4326·COPY column contract는 유지합니다.

Fresh 경로는 빈 DB → V1 → V2 → V3 → mapping-aware stores full loader입니다. 기존 populated DB는 V3의 I21201+NULL 최소 backfill 경로를 사용합니다. **full loader는 `TRUNCATE stores RESTART IDENTITY`로 snapshot을 교체하므로 기존 데이터를 보존하는 backfill 도구가 아닙니다.** 재적재에서 surrogate id는 재발급/재사용될 수 있으며 동등성은 source_store_id·원본 속성·POINT·논리 업종 기준으로 검사합니다.

| 격리 검증 | 실제 결과 |
| --- | --- |
| 환경/migration | 전용 `ry-stores-8b2-gcgmru-db`·internal network, host port 없음·data/init-dir tmpfs·named volume 없음. fixture/실제 CSV/Polygon 회귀 DB 각각 실제 Flyway12.4.0 V1→V2→V3 적용, baseline 없음. stores fixture/실제 CSV DB Flyway validate 각각 3migration 통과 |
| 실행 환경 | 8-B1에서 빌드한 production Python3.12.15 image에 현재 app/tests를 read-only로 mount. PostgreSQL16.4/PostGIS3.4.3, dependency·Dockerfile 변경 없음 |
| unittest | 전체 기존 CSV/Polygon·stores 회귀 54개 중 PASS53·fail0·skip1(별도 whole CSV 실행). 이어 whole CSV 검사1개 PASS·fail0·skip0. 합계 서로 다른 54개 모두 실행/통과. DB/raw opt-in 변수 없는 기본 local 실행은 PASS39·fail0·skip15이며 skip을 통과 증거로 쓰지 않음 |
| mapping fixture | 동적 CAFE id·SEMAS/SEOUL source 분리·미매핑/빈 code·여러 chunk의 map 1회 조회. leading zero·탭/개행/따옴표/NA/주소·nullable 좌표·독립 NDR POINT WKB/SRID·실제 FK 확인 |
| 오류/rollback | 세 mapping 오류 모두 실제 BEFORE TRUNCATE 감시 trigger에 도달하지 않고 실패. 두 번째 COPY chunk 강제 실패·좌표 오류는 caller transaction 전체 rollback·이전 stores id/전체 값/POINT 보존. 실제 app.main transaction 성공도 확인 |
| 고정 실제 CSV | SHA `08d3fd08b37840256cccd4f09bad6fc33133b647cbff05f22f26fc962cf84152` 일치. 매 실행 전체554092·I21201/CAFE22739·I21201 NULL0/non-CAFE0·나머지 미매핑 non-NULL0 |
| 전체 원본/재실행 | CSV 전체 source_store_id·독립 POINT WKB·업종을 두 번 전수 대조. id를 제외한 원본 속성/location/논리 업종의 정렬 hash `f6c8c0cce048cd6a1daccd834712033823df6747616482c019522861abe70a4c`가 두 적재에서 일치 |

중간 실패를 강제로 발생시킨 두 테스트에서 기존 pandas 청크 reader의 파일 미종료 `ResourceWarning`이 관찰됐습니다. rollback 및 검증 결과는 통과했고, 기존 실패 경로의 reader 정리 개선은 별도 후속 사항으로 남깁니다. 경고를 숨기거나 테스트를 삭제하지 않았습니다.

**8-B2 구현과 fresh 격리 환경의 fixture·실제 전체 CSV 적재 검증 완료**입니다. 기존 개발 DB/container/volume에는 연결·쓰기·migration·mount하지 않았습니다. 기존 migration·Polygon ETL·Compose/Makefile·원본 데이터는 변경하지 않았고 stage/commit/push도 하지 않았습니다. 전체 공간 B·4단계 known limitation·홍지문 H5는 유지하며 **8-C는 미완료**입니다. 8-C 전에는 diff 리뷰·대상 DB/backup/Flyway history/checksum 확인·보존 비교 계획·V3 최소 backfill과 Polygon-only 실행 절차를 확정해야 합니다. 기존 DB의 stores full loader 재실행은 그 절차에 포함하지 않습니다.

최종 읽기 전용 리뷰에서 중요한 문제는 발견되지 않았습니다. 이번 작업의 임시 container·network는 제거했습니다. 기존 개발 container는 Docker metadata만 읽어 같은 ID `983e738d45ac`/healthy·기존 volume 연결 유지를 확인했으며, DB 접속이나 데이터 변경은 하지 않았습니다.

## 2026-10-08 8-C1 실제 전체 데이터 격리 통합 검증

시작 `main` / local·remote `ad290d0878ea247eefc747682b6c7b616d648329`, clean이었습니다. production migration/ETL/API·원본·dependency·Compose/Makefile은 유지하고 격리 검증 worker와 DB-free 테스트, [전수 결과/재현·hash 정의](integration-validation-8c1.md), [8-C2 실행 계획](development-db-8c2-runbook.md)을 추가했습니다.

`ry-8c1-db-xa4ene`·전용 internal network·data/init-dir tmpfs·host port/named volume 없음으로 기존 개발 자원과 분리했습니다. Docker ID·mount/network/port·server system identifier를 매 명령 전 확인했고 입력/app/tests/migration은 read-only mount했습니다. PostgreSQL16.4/PostGIS3.4.3·Flyway12.4.0·production Python3.12.15에서 실행했습니다.

CSV6개의 manifest SHA/size/strict schema/key/count와 Polygon2 ZIP·3report·member/CRS/repair acceptance를 확인했습니다. Fresh는 실제 V1→V2→V3→5 CSV job→Polygon CLI, Populated는 실제 V1→4 CSV job+테스트 전용 NULL stores554092→snapshot/pg_dump→새 빈 격리 DB 실제 복원/전수 동일성→V2→V3 최소 backfill→Polygon-only를 수행했습니다. Populated migration 이후 CSV/full stores/commercial loader를 다시 실행하지 않았습니다.

| 검증 | 실제 결과 |
| --- | --- |
| 전체 CSV/source | 대표 POINT1650·점포통계141218·행정동매출67113·상권매출85732·stores554092. 양 경로 모든 저장 원본 metric/key/NULL/POINT의 source EXCEPT ALL mismatch0. 인구22는 입력 검증만 수행 |
| V3 | I21201+NULL22739만 CAFE로 변경. 다른 code NULL 유지, SEOUL4 보존·SEMAS1 추가. 실제 대상 id/sourceid와 예상 분류 digest 일치 |
| Populated 보존 | 통계/상권 대표 POINT/industries 전체 ID/값 동일, stores industry_id 제외 id/원본/POINT digest 동일, V1 sequence 보존(stores554092/true), V1 history/checksum 보존 |
| 백업·복원 | custom dump79579490bytes·TOC/restore exit0, restored V1의7table 전체 checksum/ID/POINT·분류·sequence/history snapshot 동일. V1 column/default/nullability·constraint/index도 restored/Fresh/Populated 동일. 개발 DB 백업이 아님 |
| Polygon | 양쪽425 VALID_SOURCE 및1644 VALID_SOURCE/6 REPAIRED_OPERATIONAL, source5181/type/rawinvalid6·valid/non-empty MultiPolygon·WKB/SHA·H5/provenance 확인. current READY 각각1개. 동등 재실행 version/rowid/loaded_at/hash/sequence 불변 |
| Fresh vs Populated | V1·공간10table 전수 logical digest 모두 동일. surrogate id/FK 숫자는 논리 code로, loaded_at은 제외하며 실제 column/NULL/geometry/profile/quality/current는 보존 |
| 실패·회귀 | actual Flyway mapping/store conflict2case에서 V3 실패·전수 rollback·V2 유지, 이미 CAFE fixture 최소 backfill 성공. 통합시점 unittest61 PASS/fail0/skip0, opt-in DB/원본 검사 포함. 리뷰 guard 검사 추가 후 최종62개 suite는 local47PASS/fail0/skip15(DB/raw env 없음), production49PASS/fail0/skip13(DB opt-in env 미지정); DB/전체 CSV 검사는 앞선61개에서 실제 실행 |
| 공간/index | 양 경로 각각32 exact5181 표본, hole 내부/경계·13 overlap pair의 다중 match·상권복수membership·0match·독립 후보 대조 통과. operational GiST2개, ANALYZE 이후 normal/격리강제 plan 모두 Index Scan. 9단계 API 검증 아님 |

첫 보존 도구가 새 공간 sequence의 정상 증가를 V1 변경으로 오검출했습니다. V1 해시는 같음을 확인하고 RED/GREEN regression으로 비교 범위를 V1 sequence로 제한했으며 경계 재실행은 전체 sequence까지 검사합니다. 기존 실패 경로 pandas reader ResourceWarning2건도 재관찰해 기록했습니다. 기대 데이터/테스트를 약화하거나 production 코드를 수정하지 않았습니다.

**8-C1 완료, 8-C2 및 8-C 전체 미완료**입니다. 기존 `startup-analysis-postgres`/`recycleyoungs_postgres_data`/개발 port5432에 DB 접속·쓰기·migration·full ETL·volume mount하지 않았습니다. 전체 B·4단계 known limitation·historical UNRESOLVED·홍지문 H5를 유지합니다. 8-C2는 실제 접속 identity·현재 history/checksum/구조·writer 정지·전수 ID/sequence/POINT snapshot·실제 backup/격리 복원 확인 후에만 적용합니다. 백업/복원/보존 불일치·업종 충돌·원본/acceptance 차이는 중단 조건이며 자동 초기화/repair/기존 volume 삭제는 없습니다. stage/commit/push는 하지 않았습니다.

최종 읽기 전용 리뷰의 Important1건은 libpq 환경 변수 route 우회 가능성이었습니다. PGHOSTADDR/PGSERVICE 및 관련 service/options 환경을 connect 전에 거부하도록 검증 도구만 보강했고 RED5case→GREEN 및 실제 강화 guard의 Fresh source 전수 mismatch0을 확인했습니다. 실제 실행 image/driver에는 해당 override가 없었습니다. 현재62개 서로 다른 unittest는 작업 중 모두 통과했고, post-fix DB opt-in skip을 재실행 성공으로 표현하지 않습니다.

이번 작업의 임시 DB container·internal network는 검증 후 제거했습니다. 기존 개발 container는 시작과 같은 ID `983e738d45ac64e2c5c116117d739fde554b17041f417c2110938847c9edf951`/healthy·기존 volume 연결 상태를 Docker metadata로만 확인했습니다. DB/volume에 연결하거나 쓰지 않았습니다. 검토용 백업·JSON·로그는 저장소 밖 `/tmp/ry-8c1-xa4EnE/`에 유지하며 Git에 포함하지 않습니다.

## 2026-10-08 8-C2A 기존 개발 DB 사전 점검·백업 복원 검증

시작 `main` / local·remote `b6113585ea4c2ba10d1edf3d57ec999403e9b5dd`, clean이었습니다. 기존 runbook1~9단계를 실제 대상에서 검증했으며 [별도 점검 결과](development-db-8c2a-preflight.md)에 민감 정보 없이 기록했습니다. runbook과 production code/migration/ETL/Compose/Makefile/원본은 변경하지 않았습니다.

기존 `startup-analysis-postgres`의 full ID·volume·PGDATA·network/alias·port·health를 먼저 확인한 뒤, 승인 container 내부 Unix socket의 명시적 REPEATABLE READ READ ONLY SQL을 사용했습니다. 실제 PostgreSQL16.4/PostGIS3.4.3, system identifier7692329130053947430, 구성 DB/user 일치·필요 권한을 확인했습니다. 세션 정책 외 DDL/DML/sequence 변경은 없습니다. 8-C1 connect_isolated를 수정하거나 개발 DB용으로 우회하지 않았습니다.

현재 history는 성공 BASELINE1/checksumNULL 한 건, V2/V3/failed row 없음입니다. Flyway12.4.0 info 확인, 전체 기본 validate는 미적용V2/V3의 RESOLVED_VERSIONED_MIGRATION_NOT_APPLIED로 false임을 기록했습니다. 현재 적용된 target1 validate는 true이며 ignore/repair/baseline은 쓰지 않았습니다. baseline의 NULL checksum을 SQL checksum과 같은 것으로 취급하지 않고 새 격리 reference의 실제 V1 SQL과169column·19constraint·22index·7sequenceownership·extension/trigger 구조를 정확히 대조했습니다.

실제 V1은 industries5·SEOUL mappings4·store_stats_dong141218·sales_dong67113, commercial_areas/sales_commercial_area/stores는0입니다. 이는2026-10-03의 두 job만 적재한 기록과 일치하며8-C1의 전체 source 테스트 상태와 구분합니다. 전체169field/ID/POINT NDR/SRID/NULL분포/분기·업종분포·sequence/history의 streaming snapshot을 수집했습니다. I21201분류충돌·mapping충돌은 없고 현재 V3 backfill 예상0입니다. 비어 있는3table을 채우는 full CSV loader는 실행하지 않았습니다.

다른 DB client/프로젝트 writer/사용자 cron/prepared transaction/subscription이 관찰되지 않는 검증 창에서 pre-snapshot을 재확인하고, coordinator의 exported READ ONLY snapshot을 공유해 pg_dump-Fc를 수행했습니다. backup11690636bytes·SHA970cb9016b67b95b9e1c3bb291f762a229129f2a3884551e16053aca26f2089d·exit0/stderr0/TOC0, 프로젝트 밖 dir0700/file0600로 보관합니다. 백업 이름/상세 접속값/credential/원본 row는 공개하지 않습니다.

새 no-port/internal-network/no-volume/tmpfs DB에 실제 pg_restore --exit-on-error가0으로 완료됐고, 원본7table 전체 값/ID/POINT/NULL·sequence·baseline history·V1 구조/mapping과 정확히 일치했습니다. --no-owner/--no-acl을 사용했으므로 실제 owner/ACL/role 권한 복원까지 검증한 것은 아닙니다. 최초→dump직전→dump직후→restore검증종료의 원본 전수 snapshot 및 write counter/history도 같았습니다. 기존 DB에 restore하지 않았습니다.

Polygon2ZIP/고정3report SHA와 후속Python3.12.15/pyshp3.1.6/Shapely2.1.2/GEOS3.13.1/pyproj3.7.0/PROJ9.4.1·Flyway12.4.0 재현을 확인했습니다. 임시 bridge guard2PASS, 일반 unittest62개47PASS/fail0/skip15(DB/raw env 미지정)입니다. skip을 실제 DB 검증으로 주장하지 않습니다.

판정 **READY_FOR_8_C2B_REVIEW**, 실제 migration 승인은 아닙니다. **8-C2/8단계 전체는 미완료**입니다. 8-C2B 직전 identity·writer검증창·history/hash/sequence·원본SHA를 다시 확인하고, 달라지면 중단/재점검해야 합니다. 현재 빈3table 적재를 migration과 섞지 않습니다. 기존 DB에는 읽기 SQL/pg_dump만 사용했고 V2/V3·Polygon publication·CSV loader·Spring startup·baseline/repair/clean·기존 container/volume 변경·Git stage/commit/push는 하지 않았습니다. 전체B·4단계 limitation·홍지문H5는 유지합니다.

최종 읽기 전용 리뷰에서 commercial_areas.x와 임시 집계 alias x의 충돌로 초기 NULL count13field가 누락된 점을 찾았습니다. unique alias.*·object/column key-set 검사를 추가하고 격리 READ ONLY 상수 RED→GREEN으로 재현/수정했습니다. 원본/복원 전체169field NULL count 보완 실측이 일치했고 physical/ID/POINT/sequence/history/write-counter는 그대로였습니다. 기존 table0행 snapshot으로 backup 당시13count도0임을 입증하며 초기 증거는 보존했습니다. 문서에는 SQL 감사/pg_dump Unix socket과 Flyway readonly JDBC 접속을 구분했습니다. production/DB write는 없었습니다.

이번 작업의 격리 reference/restore container와 internal network는 제거했습니다. 원본 container는 ID·StartedAt·RestartCount·volume이 시작과 같고 healthy임을 Docker metadata로 최종 확인했습니다. 실제 backup과 private 검증 근거는 제한된 프로젝트 밖 임시 경로에 보관합니다. backup/원본 row/접속값/credential은 Git에 추가하거나 첨부하지 않았고 stage/commit/push도 하지 않았습니다.
