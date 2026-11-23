# 테스트와 CI

변경을 검증하거나 CI 실패를 조사하는 개발자를 위한 문서입니다.

테스트를 실행하기 전에 로컬 개발 도구를 준비합니다.

DB 통합 검사는 Docker의 일회용 PostGIS에서 실행합니다.

[도구와 로컬 실행](SETUP.md#1-개발-도구)

## 빌드·테스트·품질 검사

`apps/web/`와 `apps/etl/`에서 각각 `npm ci` 후 실행합니다.

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

`apps/api/`에서 단위·MVC 테스트와 Spotless 포맷 확인은 `./gradlew build`에 포함됩니다.

검사만 분리하려면 `./gradlew test`, `./gradlew spotlessCheck`를 사용합니다.

포맷 수정은 `./gradlew spotlessApply`입니다.

## Backend 통합 테스트

Docker를 먼저 실행한 뒤 `apps/api/`에서 실행합니다.

```bash
./gradlew integrationTest
```

Testcontainers가 `postgis/postgis:17-3.5`의 일회용 DB를 띄우고 서비스와 Flyway 연결을 모두 지정합니다.

분기 목록만 확인하려면 `./gradlew integrationTest --tests '*StatisticsQuarterApiIntegrationTests'`를 실행합니다. 이 검사는 일부 지표가 게시된 분기, 기본값, 적격 배치와 현행 경계 조건, 조회 도중에 커밋된 행이 다음 요청부터 반영되는지 확인합니다.

단위 검사와 함께 실행하려면 `./gradlew build integrationTest`를 사용합니다.

ARM64에서 이미지 판본이 없으면 `docker pull --platform linux/amd64 postgis/postgis:17-3.5`와 AMD64 에뮬레이션을 확인합니다.

[Gradle 태스크 설정](../apps/api/build.gradle)

## ETL 격리 DB 통합 테스트

Docker를 실행한 뒤 `apps/etl/`에서 아래 플래그를 지정하면 일회용 PostGIS의 10개 그룹이 실행됩니다.

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

로컬의 `apps/web/`에서 아래 두 명령을 실행하면 브라우저를 띄우지 않고 타입·Mock과 테스트 목록을 검사합니다.

[Playwright 설정](../apps/web/playwright.config.ts)

```bash
npm run e2e:check
npm run test:e2e:list
```

### 공통 합성 환경

1. `apps/web/`에서 `npm run e2e:serve`를 시작합니다.

   테스트 웹은 `127.0.0.1:4173`, Mock API는 `127.0.0.1:4174`입니다.

   `.env`와 지도 키를 사용하지 않으며 위치 권한 거부와 외부 연결 제한을 적용합니다.

   등록되지 않은 Mock 경로는 404입니다.

2. 테스트 사이트의 `ry-e2e-scenario` 쿠키로 `normal`, `sales-error`, `sales-empty`, `districts-error`, `district-boundary-error`, `quarters-error` 등을 선택합니다.

   변경 후 지역이나 패널을 다시 고릅니다.

   복구 시험은 `normal`로 돌린 뒤 화면에서 재시도합니다.

3. 후보지 복원은 [예시 좌표 A·B·C](../apps/web/e2e/fixtures.ts)와 `localStorage`의 `recycleyoungs.candidates` 버전 2를 사용합니다. 이전 시나리오에서는 같은 키의 `sessionStorage`에 버전 1을 한 번만 넣고 로컬 버전 2가 검증된 뒤에만 탭 원본이 없어지는지 확인합니다.

   각 시나리오는 별도 브라우저 컨텍스트에서 시작합니다. 브라우저 수동 검증에서는 테스트에 사용하는 사이트의 후보지 키와 시나리오 쿠키만 초기화합니다.

   서버는 `Ctrl+C`로 종료합니다.

4. 상권 분석에서 기본값인 2026년 2분기의 마포구 점포 수 120개를 확인합니다. 1분기를 선택하면 110개로 바뀌며, 지역·분석 패널을 바꿔도 분기가 유지됩니다. 새로고침하면 2분기부터 시작합니다.

   3분기는 자치구 점포만 있는 합성 분기입니다. `quarters-error`에서는 후보지 반경 카페가 계속 표시되고, 쿠키를 `normal`로 바꾼 뒤 **분기 목록 다시 시도**를 누르면 통계를 확인할 수 있습니다. 데스크톱과 320px·390px에서 선택 요소의 키보드 접근, 포커스, 패널 스크롤을 확인합니다.

5. **일부 지표** 분기를 선택하면 서울 전체 게시 현황이 구·동별로 표시됩니다. 분기를 바꿔 값과 지표별 한국시간 DB 게시일이 함께 바뀌고, 후보지 경쟁 카페의 원천 기준년월과 DB 게시일은 유지되는지 확인합니다. **데이터 출처 상세**는 키보드로 펼쳐 원본 데이터셋 링크를 확인합니다.

6. 상권 분석의 세부 탭에서 구·동 범위와 그룹별 축·단위를 확인합니다. 마포구의 2분기에서 1분기로 바꾸면 일반 점포 수가 110개에서 100개로 바뀌고, 10개인 프랜차이즈 막대의 길이도 새 상한에 맞춰 바뀝니다. 세부 탭 이동에 추가 통계 요청이 없으며, 원본 개·폐업률은 표시되고 구성비나 분기 증감은 표시되지 않는지 확인합니다.

   단위·컴포넌트 테스트는 큰 정수·긴 소수의 정확한 텍스트와 막대 좌표를 따로 확인합니다. 실제 0의 기준점, NULL의 자료 없음, 축에서 폭을 구분하기 어려운 양수도 검증합니다. 데스크톱과 390px·320px에서 긴 값이 줄바꿈되고, 탭 방향키와 출처 펼치기가 동작하며, 320px에서 키보드로 차트 끝까지 스크롤할 수 있는지 확인합니다.

7. 후보지가 0곳이면 등록 안내, 1곳이면 개별 상세, 2~3곳이면 비교 화면이 표시되는지 확인합니다. 예시 A·B·C의 2026년 2분기 점포 수는 각각 30개·45개·30개입니다. 세 후보지의 반경별 카페 수와 게시일을 비교하고, 분기를 바꿔도 해당 값이 유지되는지 확인합니다. 반경을 바꾸면 경쟁 카페 결과만 갱신하고, 같은 동의 A를 삭제해도 C의 통계는 다시 요청하지 않는지 확인합니다.

   `candidate-partial`에서는 B의 카페 조회 실패와 추정매출 자료 없음이 따로 표시되고, A와 B의 다른 지표는 계속 읽을 수 있습니다. `normal`로 바꿔 B의 카페 조회를 재시도합니다. 데스크톱에서는 표의 후보지 열과 지표 행을, 390px·320px에서는 지표별 세로 카드와 가로 넘침을 확인합니다. 키보드로 상세를 열어 거리순 카페·공식 출처를 확인하고, 삭제 후 남은 후보지의 관리 버튼 또는 등록 안내로 포커스가 이동하는지 확인합니다.

8. 후보지 메모를 입력하고 다른 메뉴로 갔다 돌아오면 초안이 남고 저장값은 그대로인지 확인합니다. **메모 저장**을 누른 뒤 새로고침과 같은 브라우저의 새 탭에서 복원하고, 빈 메모 저장과 후보지 삭제·슬롯 재사용도 확인합니다. 다른 탭에서 저장한 값을 편집 중인 초안으로 덮어쓸 수 없는지 검사합니다. 단위 검사는 빈 목록, 저장 예외, 손상된 저장본 보존, StrictMode 이전을 검증합니다. 메모 전용 변경에서 지도 마커·리스너와 지역·카페·통계 요청이 늘지 않는지도 확인합니다.

9. **지역 필터**를 Enter로 열고 Tab과 Space로 구 버튼을 선택합니다. 선택 강조와 현재 지역 요약이 즉시 바뀌며, Escape나 바깥 클릭 뒤에도 선택한 구가 유지됩니다. 한 구에서만 **행정동**으로 들어가며, 이전 단계로 돌아가도 동 선택이 남습니다. 두 구에서 행정동 버튼이 비활성화되고 **서울 전체**나 초기화로 모든 제한이 즉시 해제되는지 확인합니다. `district-boundary-error`에서는 마포구와 성동구를 선택하고, `normal`로 전환한 뒤 성동구 경계만 재시도합니다. 상권 분석에서 성동구 240개, 마포구 120개, 서교동 30개를 각각 확인합니다.

   SDK를 사용하는 컴포넌트 테스트에서는 공식 경계의 링과 여러 도형, 연속 선택의 마지막 범위만 맞춤, 수동 지도 이동 우선, 반복 `districtCodes`가 담긴 단일 요청과 서버 값 보존을 검사합니다. 실제 지도에서는 1440px의 필터·위치 안내 수직 중심, 320px·390px의 2열 목록과 스크롤, 위치 안내·Dock·검색창과의 간격을 확인합니다.

지도 영역과 반경 조회의 기준년월 응답은 `./gradlew integrationTest --tests '*CafeApiIntegrationTests'`로 검증합니다. 실제 카카오 지도 환경에서는 적용 지역 필터가 있는 지도 영역, 선택 지점의 독립 반경, 0건과 조회 실패에서 카페 출처를 확인합니다.

### 로컬 UI 확인

1. 설치된 `ego-browser` Skill 안내에 따라 작업합니다.

   시스템 서비스 연결·권한·환경 문제로 사용할 수 없을 때는 연결된 Chrome으로 대체하고 이유를 기록합니다.

2. 위 합성 환경 또는 지도 키를 설정한 개발 환경을 엽니다.

   실제 지도·검색·마커·클러스터는 지도 키가 있는 환경에서 확인합니다.

   실행 중인 서버가 검증 목적에 맞으면 재사용합니다.

3. 데스크톱·모바일에서 변경한 흐름을 직접 조작합니다.

   도구·데이터 환경을 명시하고 실제 확인은 `PASS`, 재현한 제품 결함은 `FAIL`, 연결·권한·환경으로 끝내지 못하면 `BLOCKED`로 기록합니다.

   실패 증거는 재현 단계·시나리오와 함께 Git에서 제외되는 `apps/web/test-results/`에 둡니다.

4. 플로팅 탐색 화면을 1440px, 1024px·768px 전환, 390px·320px에서 확인합니다. 패널 개폐 전후 지도 컨테이너의 크기가 같고, Dock과 닫기 버튼, 검색·필터, 지도 컨트롤이 서로 가리지 않는지 검사합니다. 키보드로 포커스 복귀·내부 스크롤·출처 링크·통계 탭을 확인하고, 모션 감소에서는 패널 전환이 즉시 적용되는지 확인합니다.

   같은 화면에서 세 메뉴의 패널 외곽 크기가 같은지 확인합니다. 1440×900에서 너비 기준은 840px, 높이 기준은 585px이며 지도 안내 등으로 사용 가능한 공간이 줄면 패널 높이도 줄어듭니다. 모바일은 50dvh와 사용 가능한 공간 중 더 작은 높이를 사용합니다. 지도에서 후보지나 반경 중심을 고를 때는 시트가 줄고, 선택을 마치면 목록을 읽을 수 있는 일반 높이로 돌아오는지 확인합니다.

   Dock은 1440px에서 352×62px, 390px에서 352×62px, 320px에서 296×62px입니다. 짧은 가로 화면의 높이는 52px입니다. 패널과 Dock 사이 간격, 메뉴 버튼의 44px 이상 터치 높이, 지도 저작권 표시를 함께 확인합니다. 실제 모바일에서는 가상 키보드를 열고 메모 입력창과 저장 버튼까지 스크롤하는 흐름을 확인합니다.

   실제 지도에서는 같은 지도 중심·확대 수준에서 메뉴만 전환해 지도 영역 카페 요청이 추가되지 않는지 확인합니다. 패널 밖 지도 이동, 검색 결과의 세 기능 호출, 후보지·반경 지도 클릭, 화면 회전 후 지도 복원과 Kakao 로고·저작권 표시도 확인합니다. 가상 키보드와 주소창 변화는 모바일 기기에서 확인합니다.

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
