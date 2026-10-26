# RecycleYoungs 작업 지침

## 목적과 기준 문서

- “여기 창업해도 돼?”는 서울의 창업 환경을 분석·비교한다. 성공·수익·폐업을 예측하거나 보장하지 않으며 출처·기간·집계 단위·한계를 표시한다.
- 최신 사용자 지시와 승인 범위를 따르고, 작업 경로의 하위 `AGENTS.md`도 확인한다.
- 사람이 읽을 문서의 진입점은 [문서 안내](docs/README.md)다. 에이전트는 현재 상태를 [README](README.md)와 [project](docs/agents/project.md), 구조·API·데이터 계약을 [technical](docs/agents/technical.md)에서 확인한다. 과거 기록을 현재 상태나 실행 승인으로 취급하지 않는다.
- DB 관련 작업 전에는 [db-safety](docs/agents/db-safety.md)를 반드시 읽는다. 현행 팀 개발 환경·퇴역 DB·격리 환경을 구분하고 실제 대상을 확인한다.
- 기존 기준 문서를 갱신하며, 새 문서는 독립적으로 유지할 이유와 사용자 범위를 먼저 확인한다.

## 변경 원칙

- 시작 시 branch·HEAD·working tree·`git diff --check`를 확인하고 기존 변경을 보존한다. 기본 작업 위치는 `main`이며 예상 밖 상태를 자동 복구하지 않는다.
- 기존 스택과 책임 분리를 유지한다: `backend/`는 Spring Boot·JdbcClient의 Controller → Service → Repository, `frontend/`는 React·TypeScript의 API·hooks·components, `etl/`은 Python 수집·검증·적재다. DDL 기준은 `backend/src/main/resources/db/migration/`이다.
- 요청 없는 아키텍처 전환·dependency 추가·무관한 리팩터링을 피하고, 기존 공통 UI와 접근성을 유지한다.
- 필요한 코드·문서만 읽고 관련 도구·Skills를 사용한다. 독립 조사만 읽기 전용으로 병렬화하며, 도구나 서브 에이전트로 승인 범위를 확장하지 않는다.

## 데이터·DB 보호

- 통계와 점포 snapshot의 시점·공간 단위를 구분한다. snapshot 누락을 폐업으로 단정하지 않으며 NULL·실제 0·NO_ROW, BIGINT 문자열, 공통 오류·metadata 계약을 유지한다.
- 원본과 조회용 geometry를 보존·구분한다. 복수 경계 match나 알려진 품질·속성 충돌을 임의 선택·보정하지 않는다. 공간 처리의 상세 계약은 `docs/agents/technical.md`를 따른다.
- DB 접속은 승인된 대상·범위로 제한하고 실제 연결 identity를 확인한다. 조회는 READ ONLY로 수행하며 문서 조사·일반 테스트에는 DB에 접속하지 않는다.
- 기존 DB의 migration·ETL·DDL/DML·권한·sequence 변경, 컨테이너 중지·재생성, 볼륨 조작·삭제, 복원·백업 변경은 명시적 승인과 `docs/agents/db-safety.md`의 사전 검증 없이 실행하지 않는다. guard를 우회하거나 실패 후 자동 재실행하지 않는다.
- Compose 명령은 자원을 생성·시작·재생성할 수 있다. `make db`·`make etl`·별도 API launcher는 퇴역했다. 현행 status·서버 실행도 DB에 접속할 수 있으므로 실제 동작과 승인 범위를 먼저 확인한다. mock·격리 검증·READY는 기존 DB 변경 승인이 아니다.
- secret·백업·private evidence를 Git에 넣거나 조사 목적으로 열람·인덱싱·외부 전송하지 않는다. 민감 자료와 백업은 승인된 프로젝트 밖 private 위치에 보관한다.

## 검증

준비된 환경에서 변경 범위에 맞는 일반 검증을 실행한다. lockfile·requirements를 따르고 DB/raw opt-in 변수는 임의 활성화하지 않는다.

```sh
(cd backend && ./gradlew test)
(cd frontend && npm run test)
make check-frontend
make check-etl PYTHON=/path/to/prepared/python
```

- 실제 DB 테스트는 승인된 격리 대상과 기존 검증 도구를 사용한다. 명령·PASS/FAIL/SKIP·미실행 사유를 보고하고 mock·offline 결과를 실제 DB 성공으로 간주하지 않는다.

## Git·임시 파일·완료 보고

- 요청 없는 branch/worktree 생성, reset/restore/clean/stash, merge/rebase·force push를 하지 않는다. stage·commit·push는 명시적 승인 후 수행하며 commit/push 전 코드 리뷰를 거친다. 일반 push가 거부되면 중단한다.
- 일반 임시 파일은 `.codex-local/tmp/`, 리뷰 결과는 `.codex-local/reviews/`에 최소한만 만든다. DB·백업·격리 도구의 경로, TMPDIR·테스트 runner 정책은 임의 변경하지 않는다. 기존 파일을 덮어쓰거나 승인 범위 밖 자원을 삭제하지 않는다.
- 대용량 검증 산출물은 생성 전에 필요성·예상 최대 용량·보존 대상·검증 후 삭제 조건을 정한다. 기존 검증 결과를 재사용하고 원본/DB/볼륨/image 전체 복사·tar/readback·export의 중복 생성을 최소화한다. 같은 디스크의 복사본 두 벌을 재해 복구 백업으로 간주하거나 검증 종료 후 계속 쌓아 두지 않는다.
- **사용자의 상시 정리 지시(2026-10-26):** 이 작업에서 직접 만든 일회용 캐시·전체 복사본·readback·preview·빌드 산출물은 검증 성공과 현재 실행/복구 의존 없음 확인 후 같은 작업 안에서 즉시 삭제한다. 이 범위는 별도 재확인 없이 정리하고 삭제 목록·전후 용량을 보고한다. 실패/중단 증거는 원인 파악에 필요한 최소 기록만 남기고 보존 이유와 정리 조건을 명시한다.
- 비공개 보존은 기본적으로 **마지막 복원 검증을 통과한 전체 백업 한 세트와 필요한 복구 기록/이미지**만 유지한다. 새 백업의 복원 검증과 대체 가능성 확인 후 불필요해진 이전 백업·중복 보존본을 정리한다. 추가 대용량 사본의 장기 보존은 목적·용량·정리 조건을 사용자와 먼저 합의한다. 이 규칙은 현행 DB/볼륨·유일한 원본/인증·아직 대체되지 않은 복구본 삭제나 실패 guard 우회를 허용하지 않는다.
- 종료 시 diff-check·status·stat·untracked를 확인하고 검토할 diff, 수정 파일·검증 결과·남은 위험·직접 만든 임시 파일 경로를 보고한다.
