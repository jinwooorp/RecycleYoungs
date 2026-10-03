# 프로젝트 분석·정리 기록

확인일: 2026-10-03(Asia/Seoul). 이전 검증과 이번 검증은 아래에서 구분합니다.

## 전체 분석

프로젝트는 개발 골격과 원본 CSV·초기 스키마·ETL이 있는 단계입니다. Spring API와 React 서비스 화면의 연결은 아직 없습니다. 초기 기능은 같은 행정동·업종·분기의 매출과 점포 통계를 조회하는 흐름으로 진행할 수 있습니다.

| 영역 | 확인한 상태 | 우선 남은 일 |
| --- | --- | --- |
| Backend | 실행 클래스·CORS·JdbcClient·Flyway, 일반/실제 DB 테스트, API 계약 문서 | 조회 API 구현 |
| Frontend | Vite 템플릿·개발 프록시 | 조건 선택·결과 표·상태 처리 |
| ETL | CSV 사전 검사·선택 실행·변환·일괄 트랜잭션, 행정동 매출·점포 실제 DB 검증 완료 | 나머지 자료의 실제 적재 검증 |
| DB | 7개 테이블·인덱스·서울시 업종 4개 매핑 | 출처·적재 이력·스냅샷 버전·경계 |
| 원본 | CSV 6개, 해시·행 수·기간·코드 연결 확인 | 좌표계·단위·경계 버전·이용 조건 확인 |
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

후속 작업과 완료 기준은 [로드맵](roadmap.md), 실행 방법은 [개발 안내](development.md)를 확인합니다.
