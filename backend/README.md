# Backend

Java 21·Spring Boot 프로젝트입니다. 현재 범위는 공용 PostgreSQL 연결·migration과 실제 DB smoke test입니다. Controller·API DTO·통계 조회 API는 아직 없습니다.

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

일반 `test`는 DB 자동 설정을 제외한 context 검사입니다. 별도 `dbTest`는 실제 JdbcClient 조회·업종 매핑·PostGIS와 Flyway 상태를 확인하며 기본 기대 건수는 141,218/67,113입니다. 다른 DB는 `DB_HOST`·`DB_PORT`·`DB_NAME`과 `EXPECTED_STORE_STATS_ROWS`·`EXPECTED_SALES_ROWS`를 지정합니다. 새 DB 검증에서는 두 기대 건수를 0으로 설정합니다. `dbTest`는 매번 실행하며 기본 `test`나 `build`에 포함되지 않습니다.

통계 ETL 재실행 시 내부 `id`가 재발급되므로 stable identifier로 가정하거나 외부 식별자로 사용하지 않습니다. DB 조회 기준은 `quarter_code + dong_code + source_industry_code`이며 [API 계약](../docs/api-contract.md)은 내부 업종 code·문자열 행정동/분기와 BIGINT 문자열을 사용합니다. 계약만 확정했고 API 구현은 다음 단계입니다.

프로젝트 전체 실행은 [루트 README](../README.md), 정책은 [아키텍처](../docs/architecture.md)를 확인합니다.
