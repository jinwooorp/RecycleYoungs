# 개발 DB 스키마

현재 스키마의 기준 파일은 `001_schema.sql`입니다. 루트 Compose가 이 디렉터리를 PostgreSQL의 초기화 경로에 읽기 전용으로 연결합니다.

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

초기 SQL은 **비어 있는 DB 볼륨을 처음 생성할 때만** 실행됩니다. SQL 파일을 수정하고 컨테이너를 재시작하는 것으로 기존 DB 스키마가 갱신되지는 않습니다. `CREATE TABLE IF NOT EXISTS`도 이미 존재하는 테이블의 열을 변경하지 않습니다.

## 변경 관리

첫 Spring 조회 API를 구현할 때 데이터 접근 방식과 Flyway 등의 마이그레이션 도구를 함께 결정합니다. 도입 후에는 이 SQL을 `backend/src/main/resources/db/migration/`으로 이전하고 Compose의 초기 SQL 실행 책임도 정리합니다. 동일 스키마를 두 위치에서 따로 수정하지 않습니다.

기존 볼륨의 변경은 데이터 백업과 적용 범위를 확인한 뒤 수행합니다. 볼륨 삭제를 일상적인 시작·갱신 절차로 사용하지 않습니다.

## 후속 설계

- `commercial_areas.location`은 POINT입니다. 포함 상권 판별에는 별도 Polygon 경계가 필요합니다.
- 점포 스냅샷 기준일·파일 출처·적재 이력은 아직 테이블로 관리하지 않습니다.
- 헬스장과 소상공인 업종 코드 매핑은 미확정입니다.
- 행정동 통계와 상권 통계는 서로 다른 집계 단위입니다.

상세 정책은 [아키텍처](../docs/architecture.md), 구현 순서는 [로드맵](../docs/roadmap.md)을 참고합니다.
