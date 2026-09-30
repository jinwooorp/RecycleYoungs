# Backend

Java 21·Spring Boot 프로젝트입니다. 현재 실행 클래스·CORS 설정·기본 contextLoads 테스트만 있으며 DB 접근과 서비스 API는 아직 구현하지 않았습니다.

## 실행·검증

이 디렉터리에서 실행합니다.

```sh
./gradlew bootRun
```

```sh
./gradlew test
```

기본 포트는 8080이며 `/api/**`의 CORS는 localhost/127.0.0.1의 5173을 허용합니다. 필요한 경우 `FRONTEND_ORIGINS` 환경 변수로 변경합니다.

## 다음 작업

행정동·업종·분기별 통계 조회부터 시작합니다. 첫 DB 기능을 추가할 때 데이터 접근 방식과 마이그레이션 체계를 결정합니다. PostgreSQL runtime 드라이버는 있지만 JDBC/JPA 연결과 datasource 설정은 아직 없습니다.

현재 스키마의 기준은 [sql/](../sql/README.md)입니다. 마이그레이션 도입 시 이전 초기 SQL과 책임을 함께 정리하며, ETL이 공유할 열·키·단위를 변경 전에 합의합니다.

프로젝트 전체 실행은 [루트 README](../README.md), 정책은 [아키텍처](../docs/architecture.md)를 확인합니다.
