# 테스트와 CI

변경을 검증하거나 CI 실패를 조사하는 개발자를 위한 문서입니다.

테스트를 실행하기 전에 로컬 개발 도구를 준비합니다.

DB 통합 검사는 Docker의 일회용 PostGIS에서 실행합니다.

[도구와 로컬 실행](SETUP.md#1-개발-도구)

## 빌드·테스트·품질 검사

`frontend/`와 `etl/`에서 각각 `npm ci` 후 실행합니다.

Frontend의 Vitest는 브라우저 DOM·Kakao SDK·API를 모의합니다.

ETL 기본 검사는 합성 파일·응답을 사용하며 DB 통합 그룹은 명시적으로 켭니다.

```bash
npm run lint
npm run format:check
npm test
npm run build
```

Frontend나 ETL에서 특정 파일만 검사할 때는 `npm test -- 파일경로`를 사용합니다.

ETL 린트에는 TypeScript 검사도 포함됩니다.

테스트를 감시하려면 `npm run test:watch`, 포맷을 수정하려면 `npm run format`을 사용합니다.

`backend/`에서 단위·MVC 테스트와 Spotless 포맷 확인은 `./gradlew build`에 포함됩니다.

검사만 분리하려면 `./gradlew test`, `./gradlew spotlessCheck`를 사용합니다.

포맷 수정은 `./gradlew spotlessApply`입니다.

## Backend 통합 테스트

Docker를 먼저 실행한 뒤 `backend/`에서 실행합니다.

```bash
./gradlew integrationTest
```

Testcontainers가 `postgis/postgis:17-3.5`의 일회용 DB를 띄우고 서비스와 Flyway 연결을 모두 지정합니다.

분기 목록만 확인하려면 `./gradlew integrationTest --tests '*StatisticsQuarterApiIntegrationTests'`를 실행합니다. 이 검사는 일부 지표가 게시된 분기, 기본값, 적격 배치와 현행 경계 조건, 조회 도중에 커밋된 행이 다음 요청부터 반영되는지 확인합니다.

단위 검사와 함께 실행하려면 `./gradlew build integrationTest`를 사용합니다.

ARM64에서 이미지 판본이 없으면 `docker pull --platform linux/amd64 postgis/postgis:17-3.5`와 AMD64 에뮬레이션을 확인합니다.

[Gradle 태스크 설정](../backend/build.gradle)

## ETL 격리 DB 통합 테스트

Docker를 실행한 뒤 `etl/`에서 아래 플래그를 지정하면 일회용 PostGIS의 10개 그룹이 실행됩니다.

CLI probe 검사나 일부 도메인 검증은 해당 테스트 파일을 지정해 범위를 좁힐 수 있습니다.

```bash
RUN_BOUNDARY_DB_TESTS=1 RUN_INDUSTRY_DB_TESTS=1 RUN_STORE_DB_TESTS=1 \
RUN_SALES_DB_TESTS=1 RUN_FOOT_TRAFFIC_DB_TESTS=1 RUN_CAFE_DB_TESTS=1 \
RUN_DISTRICT_STORE_DB_TESTS=1 RUN_DISTRICT_SALES_DB_TESTS=1 \
RUN_DISTRICT_FOOT_TRAFFIC_DB_TESTS=1 RUN_SEOUL_STAT_API_DB_TESTS=1 npm test
```

특정 DB 그룹은 해당 플래그와 파일만 지정합니다.

일반 도메인 통합 파일은 `src/domains/`의 `*.integration.test.ts`입니다.

서울시 API 5종의 통합 검사는 `src/workflows/seoul-stat-api.test.ts`에 있습니다.

자치구 인구의 실제 CSV 대조는 `DISTRICT_FOOT_TRAFFIC_REAL_CSV`가 지정된 경우만 같은 일회용 DB에서 실행합니다.

합성 API 검사는 실키를 사용하지 않습니다.

## 브라우저 E2E 검증

E2E는 화면 흐름을 처음부터 끝까지 확인하는 검사입니다.

로컬 조작은 `ego-browser`를 우선 사용합니다.

Playwright Chromium은 GitHub-hosted Linux Runner에서만 실행하도록 설정돼 있습니다.

로컬의 `frontend/`에서 아래 두 명령을 실행하면 브라우저를 띄우지 않고 타입·Mock과 테스트 목록을 검사합니다.

[Playwright 설정](../frontend/playwright.config.ts)

```bash
npm run e2e:check
npm run test:e2e:list
```

### 공통 합성 환경

1. `frontend/`에서 `npm run e2e:serve`를 시작합니다.

   테스트 웹은 `127.0.0.1:4173`, Mock API는 `127.0.0.1:4174`입니다.

   `.env`와 지도 키를 사용하지 않으며 위치 권한 거부와 외부 연결 제한을 적용합니다.

   등록되지 않은 Mock 경로는 404입니다.

2. 테스트 사이트의 `ry-e2e-scenario` 쿠키로 `normal`, `sales-error`, `sales-empty`, `districts-error`, `quarters-error`를 선택합니다.

   변경 후 지역이나 패널을 다시 고릅니다.

   복구 시험은 `normal`로 돌린 뒤 화면에서 재시도합니다.

3. 후보지 복원은 [예시 좌표 A·B·C](../frontend/e2e/fixtures.ts)와 `sessionStorage`의 `recycleyoungs.candidates` 버전 1을 사용합니다.

   새 탭을 시작하거나 해당 탭의 키·쿠키만 초기화합니다.

   서버는 `Ctrl+C`로 종료합니다.

4. 상권 분석에서 기본값인 2026년 2분기의 마포구 점포 수 120개를 확인합니다. 1분기를 선택하면 110개로 바뀌며, 지역·분석 패널을 바꿔도 분기가 유지됩니다. 새로고침하면 2분기부터 시작합니다.

   3분기는 자치구 점포만 있는 합성 분기입니다. `quarters-error`에서는 후보지 반경 카페가 계속 표시되고, 쿠키를 `normal`로 바꾼 뒤 **분기 목록 다시 시도**를 누르면 통계를 확인할 수 있습니다. 데스크톱과 320px·390px에서 선택 요소의 키보드 접근, 포커스, 패널 스크롤을 확인합니다.

5. **일부 지표** 분기를 선택하면 서울 전체 게시 현황이 구·동별로 표시됩니다. 분기를 바꿔 값과 지표별 한국시간 DB 게시일이 함께 바뀌고, 후보지 경쟁 카페의 원천 기준년월과 DB 게시일은 유지되는지 확인합니다. **데이터 출처 상세**는 키보드로 펼쳐 원본 데이터셋 링크를 확인합니다.

6. 상권 분석의 세부 탭에서 구·동 범위와 그룹별 축·단위를 확인합니다. 마포구의 2분기에서 1분기로 바꾸면 일반 점포 수가 110개에서 100개로 바뀌고, 10개인 프랜차이즈 막대의 길이도 새 상한에 맞춰 바뀝니다. 세부 탭 이동에 추가 통계 요청이 없으며, 원본 개·폐업률은 표시되고 구성비나 분기 증감은 표시되지 않는지 확인합니다.

   단위·컴포넌트 테스트는 큰 정수·긴 소수의 정확한 텍스트와 막대 좌표를 따로 확인합니다. 실제 0의 기준점, NULL의 자료 없음, 축에서 폭을 구분하기 어려운 양수도 검증합니다. 데스크톱과 390px·320px에서 긴 값이 줄바꿈되고, 탭 방향키와 출처 펼치기가 동작하며, 320px에서 키보드로 차트 끝까지 스크롤할 수 있는지 확인합니다.

지도 영역과 반경 조회의 기준년월 응답은 `./gradlew integrationTest --tests '*CafeApiIntegrationTests'`로 검증합니다. 실제 카카오 지도 환경에서는 적용 지역 필터가 있는 지도 영역, 선택 지점의 독립 반경, 0건과 조회 실패에서 카페 출처를 확인합니다.

### 로컬 UI 확인

1. 설치된 `ego-browser` Skill 안내에 따라 작업합니다.

   시스템 서비스 연결·권한·환경 문제로 사용할 수 없을 때는 연결된 Chrome으로 대체하고 이유를 기록합니다.

2. 위 합성 환경 또는 지도 키를 설정한 개발 환경을 엽니다.

   실제 지도·검색·마커·클러스터는 지도 키가 있는 환경에서 확인합니다.

   실행 중인 서버가 검증 목적에 맞으면 재사용합니다.

3. 데스크톱·모바일에서 변경한 흐름을 직접 조작합니다.

   도구·데이터 환경을 명시하고 실제 확인은 `PASS`, 재현한 제품 결함은 `FAIL`, 연결·권한·환경으로 끝내지 못하면 `BLOCKED`로 기록합니다.

   실패 증거는 재현 단계·시나리오와 함께 Git에서 제외되는 `frontend/test-results/`에 둡니다.

별도의 [합성 Demo](SETUP.md#합성-demo)를 기동하고 seed합니다.

저장소 루트에서 `node --test demo/smoke.test.mjs`를 실행해 실제 REST API를 합성 데이터로 확인합니다.

## GitHub Actions CI

`project-upgrade` Push와 이 브랜치 대상 PR의 열기·동기화·재열기·수정·검토 준비 전환에 실행합니다.

동일 브랜치나 PR의 이전 실행을 취소합니다.

[워크플로](../.github/workflows/ci.yml)

| Job | 실행 내용 |
| --- | --- |
| Frontend | Node.js 24·npm 11.19.1, `npm ci`, lint, format:check, test, build |
| Frontend E2E | `npm run e2e:check`, `npx playwright install --with-deps chromium`, `npm run test:e2e`, JUnit 확인 |
| Backend | Java 21, `./gradlew test`, `./gradlew spotlessCheck`, `./gradlew build` |
| Backend integration | Docker 확인과 PostGIS 이미지 준비, `./gradlew integrationTest`, JUnit 확인 |
| ETL | Node.js 24·npm 11.19.1, `npm ci`, lint, format:check, 기본 test, build |

모든 Job은 `ubuntu-24.04`, `contents: read`를 사용하며 checkout 인증정보를 남기지 않습니다.

E2E는 합성 테스트 서버를 띄워 1440×900 데스크톱과 390×844 모바일에서 검증합니다.

E2E·Backend 통합은 JUnit 보고서 누락·실행 0건·실패·오류·건너뜀을 실패로 처리합니다.

E2E 실패 증거인 HTML·trace·스크린샷·JUnit은 7일간 보존합니다.

Job 및 Step 로그는 PR의 **Checks** 또는 **Actions → CI**에서 확인합니다.
