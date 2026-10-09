# RecycleYoungs 작업 지침

## 목적과 적용 범위
- 서비스 “여기 창업해도 돼?”는 서울시 통계·소상공인 점포로 후보 위치의 창업 환경을 분석·비교한다.
- 창업 성공·수익·폐업을 예측하거나 보장하지 않는다. 출처·기간·집계 단위·한계를 표시한다.
- 이 파일은 저장소 공통 규칙이다. 작업 하위 경로의 AGENTS.md도 확인한다.
- 최신 사용자 지시와 세션에서 승인된 범위를 우선하며, 승인되지 않은 작업으로 확장하지 않는다.
- 완료 단계·DB 상태·건수·commit SHA는 고정하지 않고 관련 문서와 실제 상태를 확인한다.

## 프로젝트 구조
- `backend/`: Java/Spring Boot API. 현재 JDBC/JdbcClient 구조를 유지하고 명시적 아키텍처 변경 승인 없이 JPA 등으로 전환하지 않는다.
- `backend/src/main/java/com/example/backend/admindong/`: Controller → Service → Repository.
- `backend/src/main/resources/db/migration/`: Flyway SQL의 source of truth.
- `backend/src/test/`: 일반 테스트, `backend/src/dbTest/`: 실제 DB/격리 fixture용 opt-in 테스트.
- `frontend/`: React·TypeScript·Vite. API client·types·hooks·components의 책임을 분리한다.
- `frontend/src/components/ui/`: 기존 Tailwind/shadcn 공통 UI를 재사용하고 접근성을 유지한다.
- `etl/app/`: Python CSV/점포 ETL, 별도 Polygon 검증·publication CLI.
- `etl/tests/`: 회귀·공간/점포·격리 통합 검증과 테스트용 safety gate.
- `etl/control*.py`: 격리 실행 제어. 테스트용 safety gate와 실제 실행 증거를 구분한다.
- `data/manifest.json`, `data/raw/`: 데이터 목록과 Git 제외 원본. `legacy/`는 이전 실험 보존용이다.
- `docker-compose.yml`, `Makefile`: 실행 진입점. 실제 동작과 부작용을 먼저 읽는다.
- 버전은 build.gradle·package.json/lockfile·requirements.txt·Compose·Dockerfile에서 확인한다.
- 기존 스택을 유지하고, 요구 없는 프레임워크/DB 전환·dependency 추가·무관한 리팩터링을 피한다.

## 문서 탐색
- 아래 목록은 탐색 지도다. 작업과 관련된 문서·구간부터 읽고 매번 전체 문서를 일괄적으로 읽지 않는다.
- 입문·상태: `README.md`, `docs/architecture.md`, `docs/project-status.md`, `docs/roadmap.md`.
- roadmap은 순서·완료 기준, project-status는 실제 작업·검증 증거다.
- 개발·API: `docs/development.md`, `docs/api-contract.md`, backend/frontend README.
- 데이터·공간: `docs/data-catalog.md`, `docs/spatial-data-validation.md`, `docs/spatial-schema-v2.md`.
- 재현·적재: `docs/reproduction.md`, `etl/README.md`, `sql/README.md`, manifest.
- 기존 DB 작업: `docs/development-db-8c2-runbook.md`와 preflight·rehearsal 기록을 먼저 읽는다.
- 안전 조건: `docs/development-db-8c2b-safety-gates.md`, `docs/development-db-8c2b-execution-guard.md`.
- 문서의 과거 검증·실행 예시는 현재 DB 상태나 이번 실행 승인을 대신하지 않는다.
- 문서와 코드가 다르면 실제 구현을 확인하고 차이를 보고한다. 미실행 항목을 완료 처리하지 않는다.

## 작업 방식과 데이터 계약
- 시작 시 branch/HEAD/working tree와 관련 문서·코드를 확인한다. 기존 변경은 보존한다.
- 목표·파일 범위·DB/API 영향·검증 계획을 정하고 승인된 범위만 구현한다.
- 필요한 파일·구간을 검색해 읽고 전체 원문·대량 로그를 반복 출력하지 않는다.
- 독립 조사만 읽기 전용으로 병렬화하며 같은 파일 수정이나 기존 DB mutation을 위임하지 않는다.
- 서울시 분기 통계와 SEMAS 점포 snapshot의 시점을 구분하고 snapshot 누락을 폐업으로 단정하지 않는다.
- API의 NULL·실제 0·NO_ROW, BIGINT 문자열, 공통 오류·metadata 계약을 유지한다.
- 원본 CSV/ZIP/SHP/report와 source geometry를 보존한다. 승인된 repair 대상·profile만 사용한다.
- source와 operational geometry를 구분한다. Polygon은 EPSG:5181, V1 대표 POINT는 EPSG:4326이다.
- ST_Covers 기반 행정동 복수 match를 임의 선택하지 않고 경계 모호성으로 처리한다.
- 역사적 경계 호환성 미검증·원본 overlap·홍지문 H5 속성 충돌을 숨기거나 임의 보정하지 않는다.

## 플러그인·Skills 활용
- 실제 사용 가능한 플러그인·Skills·도구를 먼저 확인하고 관련 Skill 지침을 읽는다. 필요한 경우에만 사용한다.
- Superpowers: 계획·TDD·체계적 디버깅·완료 검증·코드 리뷰에 활용한다.
- Context7: 사용 중인 라이브러리 버전에 맞는 공식 문서와 API 동작을 확인한다.
- context-mode: 대량 코드·로그 탐색에 활용하되 credential·DB 백업·민감한 원본 데이터를 인덱싱하거나 외부 전송하지 않는다.
- GitHub: 원격 HEAD·커밋·코드 이력을 로컬 상태와 교차 확인한다.
- Build Web Apps: React UI·접근성·반응형 작업에 적합할 때 활용한다.
- 플러그인·Skills·서브 에이전트는 사용자 승인 범위를 확장하지 않는다. Git·DB 승인 정책을 우선한다.

## 기존 개발 DB 보호
- 보호 대상: container `startup-analysis-postgres`, volume `recycleyoungs_postgres_data`.
- DB 접속·변경은 세션에서 승인된 대상과 범위로 제한한다. 문서 작성·일반 검증에 접속하지 않는다.
- `make db`, `make db-info`, `docker compose up` 등도 기존 container 시작·재생성·변경 여부와 승인 범위를 실행 전에 확인한다.
- 접속 전 full container ID·network/alias/port·volume/PGDATA·image identity를 확인한다.
- 연결 자체의 database/user/system identifier·read-only/timeout을 확인하고 불일치하면 중단한다.
- 승인된 조회는 READ ONLY transaction으로 수행하며 role/ACL 검증에 시험용 쓰기를 사용하지 않는다.
- mutation 전 writer·history/checksum·구조·전수 ID/digest·POINT/NULL·sequence를 재확인한다.
- 최신 snapshot에 연결된 백업·격리 복원 증거·예상 변경 범위·중단/복구 계획을 확보한다.
- 백업의 존재·과거 리허설 성공·READY 판정은 실제 migration/ETL 실행 승인이 아니다.
- 다음은 별도 명시적 승인 없이 실행하지 않는다:
  `make etl`, `make db-migrate`, `make db-baseline`, Flyway migrate/baseline/repair/clean.
- Polygon `--load`, CSV full loader, DDL/DML·GRANT/ALTER ROLE·sequence 변경도 같은 제한을 적용한다.
- Polygon 적재는 명시적인 DSN을 사용하고 사전 검사뿐 아니라 실제 publication 연결의 identity도 확인한다.
- stores full loader는 TRUNCATE/ID 재시작을 수행한다. 기존 DB backfill이나 일반 검증에 쓰지 않는다.
- 별도 승인 없이 기존 container stop/restart/recreate, `docker compose down -v`, volume 삭제·mount·기존 DB restore를 하지 않는다.
- 장애 시 자동 재시도·삭제·덮어쓰기를 하지 않는다. 격리 복원 검증 후 복구/전환을 별도 승인받는다.
- 백업은 승인된 프로젝트 밖 private 위치에 보관한다. 복사·이동·삭제·덮어쓰기는 승인 범위를 지킨다.
- directory 0700/file 0600·SHA·복원용 role/ACL을 확인하고 secret·백업 경로·private evidence를 Git에 넣지 않는다.
- 격리 DB는 전용 internal network·host port 없음·기존 volume 없음·data/init tmpfs·승인 image를 사용한다.
- identity·입력 hash·단계별 PASS를 강제하고 실패/stale 증거 이후 진행하지 않는다. 만든 자원만 정리한다.
- 실행 guard의 기본 inspect는 무접속이다. 개발 DB 쓰기 경로를 임의로 활성화하거나 우회하지 않는다.

## 테스트와 검증 명령
DB/raw opt-in 변수가 없는 준비된 환경에서 변경 범위에 맞춰 실행한다.
```sh
(cd backend && ./gradlew test)
(cd frontend && npm run test)
make check-frontend
(cd etl && python -m unittest discover -s tests -v)
# Python interpreter를 명시할 때:
make check-etl PYTHON=/path/to/prepared/python
```
- frontend는 기존 lockfile을 따르고, Python은 requirements.txt와 맞는 준비된 환경을 사용한다.
- 일반 backend test는 DB/Flyway 자동 설정을 제외한다. 다른 Spring 테스트도 설정을 먼저 확인한다.
- `make backend`/bootRun·`make check-db`/dbTest는 migration을 자동 실행할 수 있다. 사전 점검에 쓰지 않는다.
- SPATIAL_TEST_DSN·STORES_TEST_DSN·STORES_REAL_DSN 등 DB/raw opt-in은 임의 활성화하지 않는다.
- 실제 DB 테스트·failure injection은 승인된 격리 대상에서만 수행하고 기존 검증 도구를 재사용한다.
- PASS/FAIL/SKIP, 실행 명령·환경·중단 원인을 기록한다. skip/mock/offline 결과를 DB 성공으로 간주하지 않는다.
- 이번 실행과 과거 증거를 구분하고, 미실행·권한/환경 blocker를 숨기지 않는다.

## Git 승인과 리뷰
- `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, `git diff --check`로 시작한다.
- 필요 시 remote HEAD를 로컬 Git/GitHub로 대조한다. 원격 상태만으로 로컬 clean을 주장하지 않는다.
- 기본 작업 위치는 main이다. 예상 밖 상태면 자동 동기화·복구하지 않고 차이를 보고한다.
- 요청 없는 branch/worktree 생성, reset/restore/clean/stash, 자동 merge/rebase·force push를 하지 않는다.
- 코드 리뷰 전 commit/push하지 않는다. stage·commit·push는 해당 범위의 명시적 승인 후 별도 수행한다.
- 승인된 파일만 stage하고 cached check/name-only/stat으로 정확한 목록과 민감 자료 제외를 검증한다.
- 일반 push가 거부되면 중단한다. 자동 rebase/merge나 강제 push로 해결하지 않는다.
- 종료 시 diff-check/status/stat과 untracked 목록을 확인하고 수정 파일·검증·남은 위험을 보고한다.
- 사용자가 검토할 diff를 제공하며 승인 없는 기존 변경 덮어쓰기나 stage를 하지 않는다.
