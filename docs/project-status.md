# 프로젝트 분석·정리 기록

확인일: 2026-10-07(Asia/Seoul). 이전 검증과 이번 검증은 아래에서 구분합니다.

## 전체 분석

행정동 자료 적재·DB migration·조회 API와 React 단건/4분기 통계를 실제 데이터로 연결했습니다. 같은 행정동·업종의 선택 분기 상세 통계와 2025년 4개 분기 추세를 조회할 수 있습니다. 같은 개발 PC의 독립 clean clone과 별도 fresh PostgreSQL volume에서 CSV → ETL → PostgreSQL → Spring API → React 전체 흐름을 재현해 로드맵 7단계를 완료했습니다.

| 영역 | 확인한 상태 | 우선 남은 일 |
| --- | --- | --- |
| Backend | CORS·JdbcClient·Flyway, 목록·단건/4분기 통계 API 5개, 일반/실제 DB/API·새 환경 재현 검증 | 2차 지도·공간 기능을 위한 데이터·계약 준비 |
| Frontend | 조건 선택·단건/4분기 점포·추정매출 표, 상태 처리·개발 프록시·새 환경 재현 검증 | 지도·후보 비교 등 2차 UI |
| ETL | CSV 사전 검사·선택 실행·변환·일괄 트랜잭션, 행정동 매출·점포 실제 DB 검증 완료 | 나머지 자료의 실제 적재 검증 |
| DB | 7개 테이블·인덱스·서울시 업종 4개 매핑 | 출처·적재 이력·스냅샷 버전·경계 |
| 원본 | CSV 6개·공식 행정동 ZIP, 대표점 수치/의미·425개 코드/이름·geometry 검사; 후속 공식 CSV 동일성·홍지문 상권 SHP 대조 | 2025 참조 경계/재집계 근거 부족(B); 홍지문 CSV/SHP 귀속 차이 원인 미확인(H5), 미세 중첩 13쌍 별도 검토·개별 점포 CRS·보관 CSV 이용 조건 |
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
