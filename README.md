# RecycleYoungs

**“여기 창업해도 돼?”** — 서울시 공공데이터와 소상공인 점포 데이터로 창업 후보 위치를 분석·비교하는 대학 캡스톤 프로젝트입니다. 창업 성공·수익·폐업을 보장하지 않으며 데이터 출처·기간·집계 단위·한계를 구분합니다.

현재 구현·로드맵·blocker는 [프로젝트 상태](docs/project.md)에서 확인합니다. 신규 실행 전에 [개발 가이드](docs/development.md), 기존 개발 DB 관련 작업 전에 [DB 안전 기준](docs/db-safety.md)을 읽습니다. AI 에이전트는 [AGENTS.md](AGENTS.md)를 먼저 따릅니다.

| 문서 | 역할 |
| --- | --- |
| [project](docs/project.md) | MVP·구현·완료 단계·남은 로드맵·blocker·다음 작업 |
| [architecture](docs/architecture.md) | 책임·JDBC·공간 schema/version·조회 설계 |
| [api-contract](docs/api-contract.md) | 구현된 GET API·요청/응답·오류·NULL/0/NO_ROW·BIGINT |
| [data](docs/data.md) | 출처/시점·ETL·업종·geometry·B/H5/overlap 한계 |
| [development](docs/development.md) | 환경·설정·DB 없는 검증·신규 격리 재현·위험 명령 |
| [db-safety](docs/db-safety.md) | 기존 DB NOT_READY·보존·백업/복원·실행 gate·승인·과거 commit 근거 |

코드는 `backend/`·`frontend/`·`etl/`, 정확한 schema는 [Flyway SQL](backend/src/main/resources/db/migration/), CSV 목록은 [manifest](data/manifest.json)에 둡니다. 실행 진입점은 [Makefile](Makefile)·[Compose](docker-compose.yml)입니다. `legacy/`는 [이전 실험 보존 영역](legacy/README.md)이며 활성 개발에서 제외합니다.

문서는 현재 정책만 관리하고 완료된 작업의 상세 로그는 확인된 Git commit을 참조합니다. 격리 테스트 통과와 기존 개발 DB 변경 승인은 별개입니다.
