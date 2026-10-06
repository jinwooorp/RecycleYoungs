# Backend

Java 21·Spring Boot 프로젝트입니다. 현재 구현 범위는 공용 PostgreSQL 연결·migration과 행정동 lookup·단건 통계·2025년 4개 분기 추세 조회 GET API 5개입니다. 계약은 [행정동 API 계약](../docs/api-contract.md)을 따릅니다. Frontend 추세 표시와 새 환경 전체 흐름 재현은 후속 작업입니다.

## 선택한 방식

| 선택지 | 판단 |
| --- | --- |
| Spring JDBC / JdbcClient | 채택. 복합 키 조회·집계·향후 PostGIS SQL을 직접 작성하고 필요한 결과만 매핑 |
| Spring Data JDBC | aggregate 저장 모델이 중심이며 현재 Python ETL·통계 조회 구조에서는 repository 도입 이점이 작음 |
| Spring Data JPA | entity graph·CRUD·영속성 관리가 현재 목표가 아니므로 ORM 계층을 추가하지 않음 |
| jOOQ | 복잡한 SQL의 타입 안전성은 유용하지만 현재는 코드 생성·스키마 연동 설정을 추가하지 않음 |

`spring-boot-starter-jdbc`의 JdbcClient와 HikariCP, PostgreSQL driver를 사용합니다. Spring이 ETL이나 데이터 적재를 담당하지 않습니다. Spring의 [SQL 접근 안내](https://docs.spring.io/spring-boot/reference/data/sql.html)를 참고합니다.

## 스키마 책임

Flyway를 선택했습니다. SQL migration과 Spring Boot 연동으로 기존 스키마의 변경 이력을 관리할 수 있습니다. Liquibase도 가능하지만 현재는 다양한 changelog·rollback 기능을 위한 추가 구성이 필요하지 않습니다. 최초 초기 SQL만 유지하는 방식은 기존 볼륨의 변경 이력을 관리하지 못합니다.

단일 SQL 기준은 `src/main/resources/db/migration/`입니다. Spring Boot Flyway starter·PostgreSQL module은 Boot가 버전을 관리하며 standalone Compose Flyway도 같은 12.4.0을 사용합니다([Boot DB 초기화 안내](https://docs.spring.io/spring-boot/how-to/data-initialization.html)). 기존 DB는 구조 대조 후 명시적 baseline 1, 새 DB는 V1 실행으로 편입합니다. 절차는 [DB 안내](../sql/README.md)에 있습니다.

## 실행과 검증

Compose는 루트 `.env`를 읽고, Spring은 프로세스 환경 변수를 사용합니다. Spring 실행 전 셸·IDE에 `.env`와 같은 `DB_PASSWORD`를 지정하고, 기본값을 바꾼 경우 `DB_NAME`·`DB_USER`·`DB_PORT`도 지정합니다. `.env`를 Java properties로 자동 import하지 않습니다. Docker 밖에서는 기본 localhost:5432이며 비밀번호에는 코드 기본값을 두지 않습니다. Spring 포트는 8080이며 `/api/**`의 CORS는 localhost/127.0.0.1의 5173을 허용합니다. `FRONTEND_ORIGINS`로 변경할 수 있습니다.

DB 환경 변수를 지정한 뒤 프로젝트 루트에서 다음을 실행합니다.

```sh
make db-migrate
make backend
```

ETL만 사용할 때는 `make db-migrate` 또는 `make etl`로 준비하면 되므로 Java·Spring 서버 실행이 필요 없습니다.

```sh
cd backend
./gradlew test
./gradlew dbTest
```

일반 `test`는 DB 자동 설정을 제외하고 JdbcClient 경계만 대체한 context 검사와 strict query·오류 응답·중복 행 처리 검사입니다. DB 없이 실행됩니다. 별도 `dbTest`는 실제 JdbcClient 조회·업종 매핑·PostGIS·Flyway와 Spring MVC JSON 계약을 확인하며 기본 기대 건수는 141,218/67,113입니다. 다른 DB는 `DB_HOST`·`DB_PORT`·`DB_NAME`과 `EXPECTED_STORE_STATS_ROWS`·`EXPECTED_SALES_ROWS`를 지정합니다. 빈 DB의 연결 검증은 두 기대 건수를 0으로 설정하고 `--tests '*PostgresConnectionTests'`로 실행합니다. 현재 데이터에 대한 `AdminDongApiTests`는 검증된 populated DB를 사용합니다. `dbTest`는 매번 실행하며 기본 `test`나 `build`에 포함되지 않습니다.

통계 ETL 재실행 시 내부 `id`가 재발급되므로 stable identifier로 가정하거나 외부 식별자로 사용하지 않습니다. DB 조회 기준은 `quarter_code + dong_code + source_industry_code`이며 [API 계약](../docs/api-contract.md)은 내부 업종 code·문자열 행정동/분기와 BIGINT 문자열을 사용합니다. 기존 네 GET API는 React 조건 선택·결과 표까지 연결했고, 추세 API도 Backend에서 구현했습니다. 추세 화면과 새 환경 전체 흐름 재현은 후속 작업입니다.

## 조회 API와 테스트 범위

`com.example.backend.admindong`의 Controller → Service → JdbcClient Repository로 구성합니다. 목록은 조회 가능한 서울시 매핑 범위의 합집합이며, 읽기 전용 REPEATABLE READ transaction에서 매핑·복합 키·행정동 이름 무결성을 확인한 후 목록/통계를 조회합니다. SQL 입력은 bind parameter를 사용합니다.

- `GET /api/admin-dongs`, `/api/industries`, `/api/quarters`: 정렬된 lookup 배열, query가 있으면 400
- `GET /api/admin-dong-stats?dongCode=11110515&industryCode=CAFE&quarterCode=20251`: 점포·추정매출 합동 응답
- `GET /api/admin-dong-trends?dongCode=11110515&industryCode=CAFE`: lookup 분기와 독립적인 20251~20254 네 item, 분기별 점포·추정매출과 NO_ROW 유지. quarterCode를 전달하면 400
- 구조 → 필수값 → 형식 → 지원 여부로 검증하며 BIGINT는 문자열, metric NULL·실제 0·부분/전체 `NO_ROW`를 구분합니다.
- 추세의 정상 요청은 기존 lookup/무결성 SQL 4회와 점포/매출 다중 분기 통계 SQL 각 1회, 총 6회를 실행합니다. 통계 결과를 분기 key로 연결하며 중복 key는 DATA_INTEGRITY_ERROR로 실패합니다. 새 schema/index/migration은 없습니다.
- 2026-10-06에 일반 `test` 72개(기존 33개 포함), populated DB `dbTest` 20개(기존 16개 포함), 별도 격리 fixture 15개(기존 10개 포함)를 통과했습니다. populated 실행에서는 fixture 15개를 skip했습니다. 기존 DB는 읽기 전용 JDBC 세션으로 실행했습니다.
- 실제 HTTP로 청운효자동·둔촌1동·면목5동·신정6동 추세와 단건 네 분기 값을 대조하고 quarterCode 전달의 400 오류를 확인했습니다. 검증용 HTTP 서버는 Flyway를 비활성화했습니다. Frontend·ETL·새 환경 재현 검증은 이번 Backend 작업에 포함하지 않았습니다.

`AdminDongFixtureTests` 15개는 `API_FIXTURE_TEST=true`이고 `DB_NAME`이 `recycleyoungs_api_fixture_`로 시작할 때만 활성화됩니다. 조건이 맞지 않으면 Spring context 초기화 전에 건너뜁니다. fixture test의 Spring context는 Flyway를 실행하지 않으므로 **V1을 미리 적용한 별도 격리 PostgreSQL을 준비해야 합니다**. NULL·큰 BIGINT·데이터 오류를 만들기 때문에 기존 populated DB에서는 실행하지 않습니다. fixture 쓰기 전 실제 DB 이름 prefix와 두 통계 테이블의 0행을 다시 확인하고 각 테스트의 변경을 rollback합니다.

`recycleyoungs_api_fixture_local` 이름의 격리 DB를 준비한 뒤 `API_FIXTURE_PORT`·`API_FIXTURE_USER`·`API_FIXTURE_PASSWORD`를 그 DB의 값으로 지정합니다.

```sh
API_FIXTURE_TEST=true DB_NAME=recycleyoungs_api_fixture_local \
  DB_HOST=localhost DB_PORT="${API_FIXTURE_PORT:?격리 DB port 지정}" \
  DB_USER="${API_FIXTURE_USER:?격리 DB 계정 지정}" \
  DB_PASSWORD="${API_FIXTURE_PASSWORD:?격리 DB 비밀번호 지정}" \
  ./gradlew dbTest --tests '*AdminDongFixtureTests'
```

기존 volume을 재사용하거나 삭제하지 않습니다. 검증 후 직접 만든 격리 컨테이너만 정리합니다. API 계약·migration·ETL·React는 이 테스트로 변경하지 않습니다.

프로젝트 전체 실행은 [루트 README](../README.md), 정책은 [아키텍처](../docs/architecture.md)를 확인합니다.
