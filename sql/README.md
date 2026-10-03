# 개발 DB 스키마

스키마의 단일 기준은 [`backend/src/main/resources/db/migration/`](../backend/src/main/resources/db/migration/)의 Flyway SQL입니다. `001_schema.sql`은 내용 변경 없이 `V1__initial_schema.sql`로 이전했고 이 디렉터리에는 운영 안내만 남겼습니다. 적용된 migration 파일을 수정하지 말고 이후 변경은 새 `V2__...sql`부터 추가합니다.

## 현재 테이블

| 테이블 | 저장 단위 |
| --- | --- |
| `industries` | 내부 업종 |
| `industry_mappings` | 출처별 업종 코드 → 내부 업종 |
| `commercial_areas` | 상권 코드·명칭·대표 지점 |
| `store_stats_dong` | 행정동·분기·서울시 업종별 점포 통계 |
| `sales_dong` | 행정동·분기·서울시 업종별 추정매출 |
| `sales_commercial_area` | 상권·분기·서울시 업종별 추정매출 |
| `stores` | 개별 점포의 현재 입력 스냅샷 |

Compose는 SQL 초기화 mount를 사용하지 않습니다. `/docker-entrypoint-initdb.d`를 빈 tmpfs로 가려 PostGIS 이미지의 기본 extension 초기화도 제외합니다. V1이 필수 PostGIS extension과 테이블·인덱스·업종 seed를 생성합니다. 기존 DB 볼륨에는 초기화 스크립트가 다시 실행되지 않습니다.

## 변경 관리

Spring Boot와 standalone Flyway Docker(12.4.0)가 같은 backend SQL을 사용합니다. Spring Boot 4.1.1이 관리하는 Flyway 버전과 Docker 태그를 함께 유지합니다. `baseline-on-migrate=false`, `clean-disabled=true`이며 SQL 초기화나 ORM schema 생성과 병행하지 않습니다.

기존 볼륨의 변경은 데이터 백업과 적용 범위를 확인한 뒤 수행합니다. 볼륨 삭제를 일상적인 시작·갱신 절차로 사용하지 않습니다.

### 새 DB

```sh
make db
make db-migrate
make db-info
```

빈 DB는 V1을 실행하고 Flyway 이력에 SQL migration version 1을 기록합니다. 이후 ETL을 실행할 수 있으며 Spring 서버를 먼저 띄울 필요가 없습니다. `make etl`은 migration을 먼저 실행합니다. `make etl-validate`는 migration이나 DB 연결 없이 입력만 검사합니다.

### 초기 SQL로 이미 생성한 DB

**새 DB 또는 V1과 구조가 다른 DB에 baseline을 실행하지 않습니다.** baseline은 과거 SQL을 실행하거나 구조를 검증하는 명령이 아니며, version 1 이하를 이미 적용된 것으로 표시합니다. 자동 baseline은 사용하지 않습니다([Flyway baseline 설명](https://documentation.red-gate.com/fd/baseline-277578867.html)).

`make db-baseline`은 `CONFIRM_BASELINE=verified-v1`을 명시해야 실행됩니다. 값이 없거나 정확히 일치하지 않으면 DB 명령 실행 전에 실패합니다. 이 확인 변수는 기존 schema의 실제 V1 대조를 대신하지 않습니다. 새 DB는 위의 `make db-migrate` 절차를 사용합니다.

1. DB 식별자·볼륨과 데이터 건수·샘플을 확인하고 백업합니다.
2. 별도의 새 검증 DB에 V1을 적용해 기존 DB의 7개 테이블 DDL·sequence 정의·제약·인덱스·업종 seed·extension을 대조합니다. 서로 다르면 baseline하지 않고 차이를 먼저 조사합니다.
3. V1과 일치하는 기존 DB에서 한 번만 실행합니다.

   ```sh
   make db-baseline CONFIRM_BASELINE=verified-v1
   make db-migrate
   make db-info
   ```

4. version 1의 `BASELINE` 이력, pending migration 없음, 기존 건수·샘플 보존을 확인합니다. baseline된 V1은 checksum 검증 대상이 아니므로 2번의 실제 구조 대조가 필요합니다.

현재 개발 DB는 2026-10-03에 백업·V1 구조 대조 후 baseline 1 편입을 마쳤습니다. 점포 141,218행·매출 67,113행과 전체 행 checksum·샘플·sequence 값이 유지됐습니다. 자세한 결과는 [프로젝트 기록](../docs/project-status.md)에 있습니다.

## 후속 설계

- `commercial_areas.location`은 POINT입니다. 포함 상권 판별에는 별도 Polygon 경계가 필요합니다.
- 점포 스냅샷 기준일·파일 출처·적재 이력은 아직 테이블로 관리하지 않습니다.
- 헬스장과 소상공인 업종 코드 매핑은 미확정입니다.
- 행정동 통계와 상권 통계는 서로 다른 집계 단위입니다.

상세 정책은 [아키텍처](../docs/architecture.md), 구현 순서는 [로드맵](../docs/roadmap.md)을 참고합니다.
