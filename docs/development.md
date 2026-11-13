# 개발 가이드

로컬에서는 Frontend와 Backend를 호스트에서 실행하거나 Docker Compose의 `full` 프로필로 함께 시작할 수 있습니다. 행정구역·상권 API나 ETL이 필요하면 로컬 DB와 게시 데이터를 준비합니다. 사용자에게 보이는 화면 동작은 [서비스 명세](service-spec.md), API 계약은 [데이터 설계](data-design.md)에 있습니다. [README의 상세 기술 문서](../README.md#상세-기술-문서)

## 목차

- [1. 개발 도구](#1-개발-도구)
  - [로컬 DB 준비](#로컬-db-준비)
  - [전체 Docker 스택](#전체-docker-스택)
  - [서울시 Open API 인증키](#서울시-open-api-인증키)
- [2. Frontend](#2-frontend)
- [3. Backend](#3-backend)
  - [마이그레이션 적용 상태 확인](#마이그레이션-적용-상태-확인)
- [빌드·테스트·품질 검사](#빌드테스트품질-검사)
- [GitHub Actions CI](#github-actions-ci)
- [브라우저 E2E 검증](#브라우저-e2e-검증)
- [배포 검토 항목](#배포-검토-항목)

## 1. 개발 도구

명령은 macOS 또는 Linux 셸(Windows의 WSL 포함)을 기준으로 합니다. 네이티브 Windows는 현재 지원 범위 밖입니다.

| 대상                    | 필요한 도구                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Frontend·ETL            | Node.js 24 LTS·npm 11. 각 디렉터리의 `.nvmrc`와 잠금 파일을 사용합니다. CI와 맞출 때는 npm 11.19.1을 사용합니다. |
| Backend                 | Java 21과 저장소의 Gradle Wrapper(`./gradlew`)                                                                   |
| 컨테이너·DB 통합 테스트 | Docker와 Docker Compose. ETL은 호스트에서 실행합니다.                                                            |

### 로컬 DB 준비

루트 [환경변수 예시](../.env.example)를 `.env`로 복사하고 DB 이름·사용자·비밀번호·포트를 확인합니다. `cp -n`은 기존 파일을 유지합니다.

| 설정                                                      | 읽는 위치와 용도                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 루트 `.env`                                               | 개발 Compose가 자동으로 읽습니다. `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`로 로컬 DB를 준비합니다.                                                                        |
| `DB_JDBC_URL`, `DB_USER`, `DB_PASSWORD`                   | Backend의 `db` 프로필이 실행 셸에서 읽습니다. 별도 환경은 [Backend 예시](../backend/.env.example)를 참고합니다.                                                                 |
| `DATABASE_URL`, `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS` | ETL 연결 설정입니다. ETL 실행 위치의 `.env`도 읽으며 셸에서 내보낸 값이 우선합니다. 비밀번호의 URL 예약 문자는 `DATABASE_URL`에서 인코딩합니다. [ETL 예시](../etl/.env.example) |
| `SEMAS_API_KEY`, `SEOUL_OPEN_API_KEY`                     | 각 공공데이터 ETL의 서버 측 인증키입니다. 실제 키·비밀번호·접속 URL은 Git이나 로그에 남기지 않습니다. [ETL 환경변수와 실행](etl-guide.md#설치-및-공통-실행)                     |

루트에서 `.env`를 준비한 뒤 개발 DB를 시작합니다. [개발용 Compose](../docker-compose.yml)의 기본 실행은 DB만 시작하며, 호스트의 Vite HMR과 Spring Boot Gradle 실행을 함께 사용할 수 있습니다. DB는 `127.0.0.1`의 `DB_PORT`(기본 5432)에 게시됩니다. 포트가 이미 사용 중이면 로컬 설정을 바꿉니다.

```bash
cp -n .env.example .env
# .env의 로컬 DB 설정을 확인합니다.
docker compose config --quiet
docker compose up -d --wait db
docker compose ps db
```

공통 설정은 **Backend 또는 ETL을 실행할 각 셸**에서 다음과 같이 내보냅니다. 이미 `backend/`나 `etl/`이면 `source ../.env`를 사용합니다. 두 앱의 연결 URL은 같은 로컬 DB를 가리켜야 합니다.

```bash
set -a
source .env
set +a
```

루트에서 다음 명령으로 접속한 뒤 `psql`에서 `SELECT version(), PostGIS_Version();`을 실행하고 `\q`로 종료합니다. 호스트 DB 도구도 동일한 루프백 주소와 `.env`의 DB 정보를 사용합니다.

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

개발 데이터는 `recycleyoungs_postgres_data`에 남습니다. `docker compose stop db`로 중지하고 `docker compose up -d --wait db`로 다시 시작합니다. 일반 종료·재시작 시 볼륨을 삭제하지 않습니다. 초기화된 볼륨의 DB·계정·비밀번호는 `.env` 값만 바꿔도 자동으로 갱신되지 않습니다.

### 전체 Docker 스택

`full` 프로필은 개발 DB에 Frontend와 Backend를 추가합니다. Frontend는 Node.js 24로 빌드한 SPA를 Nginx에서 제공하고 `/api`를 Backend로 전달합니다. Backend는 Java 21 Gradle Wrapper로 빌드한 JAR를 JRE에서 실행합니다. Backend 포트는 Compose 네트워크 안에서만 사용합니다.

루트 `.env`를 준비한 뒤 별도 프로젝트명과 사용 가능한 포트를 지정합니다. 예제의 DB 볼륨은 `recycleyoungs-full_postgres_data`입니다.

```bash
DB_PORT=15432 FRONTEND_PORT=18081 docker compose -p recycleyoungs-full --profile full up -d --build
DB_PORT=15432 FRONTEND_PORT=18081 docker compose -p recycleyoungs-full --profile full ps
```

Nginx는 루프백의 `FRONTEND_PORT`(기본 8081)에 게시됩니다. Compose는 [루트의 개발용 Nginx 설정](../nginx/default-dev.conf) 한 파일을 컨테이너에 읽기 전용으로 연결합니다. Frontend 빌드 컨텍스트는 `frontend/`입니다.

위 명령으로는 [홈](http://localhost:18081)과 [탐색 화면](http://localhost:18081/explore)을 엽니다. 소스가 바뀌면 이미지를 다시 빌드합니다. HMR이 필요하면 호스트에서 Vite를 실행합니다.

- Backend는 DB가 준비되면 `db:5432`에 연결하고 Flyway를 실행합니다. 호스트용 `DB_JDBC_URL`은 컨테이너에 전달하지 않습니다. 새 볼륨에는 조회용 게시 데이터가 없으며 ETL은 자동 실행되지 않습니다.
- Kakao 지도를 사용하려면 Compose가 읽는 루트 `.env` 또는 실행 셸에 `VITE_KAKAO_MAP_APP_KEY`를 지정하고, Kakao Developers에 실제 접속 origin(예: `http://localhost:18081`)을 등록합니다. 빌드 시 전달되는 JavaScript 키는 브라우저 번들에 공개됩니다. 키를 바꾸면 이미지를 다시 빌드합니다. 키가 비어 있으면 지도 설정 안내가 표시됩니다.
- DB 비밀번호는 실행 시 DB와 Backend에만 전달됩니다. 이미지 빌드에는 로컬 환경 파일을 포함하지 않습니다.

종료할 때도 같은 프로젝트명과 포트를 지정합니다. 아래 명령은 해당 스택의 볼륨을 유지합니다.

```bash
DB_PORT=15432 FRONTEND_PORT=18081 docker compose -p recycleyoungs-full --profile full down
```

### 서울시 Open API 인증키

발급받은 `SEOUL_OPEN_API_KEY`는 로컬 `.env`나 실행 셸에 설정합니다. OA-22179는 읽기 전용 `--api --probe`와 DB에 반영하는 `--api --publish`를 지원합니다. 공식 HTTP 주소에서는 `--allow-insecure-http`가 필요하며, 평문으로 전송되는 키가 노출되거나 응답이 변조될 수 있습니다. 실제 게시 전에 읽기 전용 probe로 원본을 대조하고 대상 DB의 쓰기 승인을 받습니다. [서울시 Open API 이용안내](https://data.seoul.go.kr/together/guide/useGuide.do) · [ETL probe 실행](etl-guide.md#서울시-open-api-전체-수집-probe) · [API 직접 게시](etl-guide.md#oa-22179-api-직접-게시) · [HTTPS 확인 기록](archive/etl-validation-history.md#oa-22179-공개-표본과-https-확인-2026-11-10)

## 2. Frontend

저장소 루트에서 실행합니다. Vite는 기본 포트 5173을 사용하며 사용 중이면 기동 오류가 납니다.

```bash
cd frontend
nvm use
npm ci
npm run dev
```

랜딩은 `/`, 탐색은 `/explore`이며 알 수 없는 경로는 React Router의 404 화면으로 연결됩니다. 탐색 경로에서 지도와 탐색 코드를 불러옵니다. `npm run build`는 타입 검사 후 `dist/`를 생성하고 `npm run preview`는 결과를 확인하는 명령입니다. [로컬 랜딩](http://localhost:5173/) · [탐색 화면](http://localhost:5173/explore)

### Kakao Maps 설정

1. Kakao Developers에서 앱의 카카오맵 사용을 활성화하고 **JavaScript 키**를 확인합니다. [Kakao 지도 공식 가이드](https://apis.map.kakao.com/web/guide/)
2. [Frontend 환경변수 예시](../frontend/.env.example)를 참고해 `frontend/.env.local`에 `VITE_KAKAO_MAP_APP_KEY`를 지정합니다. JavaScript SDK 도메인에 실제 접속 origin을 등록합니다. 개발 기본값은 `http://localhost:5173`이며 `127.0.0.1`이나 preview(기본 4173)를 사용하면 해당 origin도 등록합니다.
3. 키 변경 후 Vite를 재시작합니다. `VITE_*` 값은 브라우저에 노출되고 제품 빌드에 포함됩니다. REST API 키·Admin 키·DB 비밀번호는 사용하지 않습니다.

키가 비어 있으면 설정 안내를 표시하며 SDK를 요청하지 않습니다. 로딩 오류나 시간 초과가 발생하면 키 종류·카카오맵 활성화·등록 origin·네트워크를 확인한 후 화면의 재시도를 사용합니다. 현재 위치 기능은 브라우저 권한과 HTTPS 또는 localhost 같은 보안 컨텍스트가 필요합니다. [지도 이용 동작](service-spec.md#탐색-페이지)

### 프록시와 주의사항

Vite는 `/api`를 기본적으로 `http://localhost:8080`에 전달합니다. 대상 변경은 `frontend/.env` 또는 실행 환경의 `API_PROXY_TARGET`으로 설정합니다. 이는 개발 서버 설정입니다. 지도는 뜨지만 지역·상권 데이터가 로드되지 않으면 프록시 주소, Backend의 `db` 프로필, 정상 게시 데이터를 차례로 확인합니다. [Vite 설정](../frontend/vite.config.ts)

## 3. Backend

### DB 없는 기본 실행

별도 터미널의 저장소 루트에서 다음 명령을 실행합니다. 기본 포트는 8080이며 Backend 루트의 HTTP 404는 정상입니다. 기본 프로필에서는 DataSource·JdbcClient·Flyway 없이 실행됩니다.

```bash
cd backend
./gradlew bootRun
```

### DB를 사용하는 `db` 프로필 실행

기본 Backend가 실행 중이면 종료합니다. [로컬 DB 준비](#로컬-db-준비)에서 DB를 시작하고 해당 실행 셸에 환경변수를 내보낸 뒤 `backend/`에서 실행합니다. **기동 전에 대상 DB, 백업, 마이그레이션 권한을 확인합니다.**

```bash
./gradlew bootRun --args='--spring.profiles.active=db'
```

[프로필 설정](../backend/src/main/resources/application-db.yaml)은 서비스용 Hikari DataSource·JdbcClient와 별도 Flyway 연결을 같은 DB 환경변수로 구성합니다. 계정을 분리할 때는 `spring.datasource.*`와 `spring.flyway.*`를 외부 설정으로 지정합니다. 외부 로컬 DB에는 PostGIS와 확장 생성 권한이 필요합니다.

기동 시 Flyway V1~V7 중 미적용 버전을 적용합니다. 조회에는 정상 게시 데이터가 별도로 필요합니다. 예를 들어 행정구역 API는 [경계 ETL](etl-guide.md#행정동자치구-경계-적재)의 게시본을 사용합니다. [REST API 준비 상태와 오류 계약](data-design.md#행정구역-rest-api-계약)

### 마이그레이션 적용 상태 확인

DB를 확인한 후 `psql`에서 아래 읽기 전용 SQL을 실행합니다. V7까지 적용된 DB의 기대 결과는 버전 1~7의 `success=true`와 프로젝트 테이블 11개입니다. 적용된 마이그레이션 파일과 기존 DB 이력을 보존합니다.

```sql
SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank;
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('etl_batch', 'district', 'administrative_dong', 'service_industry',
                    'dong_store_stat', 'dong_sales_stat', 'dong_foot_traffic_stat', 'cafe_store',
                    'district_store_stat', 'district_sales_stat', 'district_foot_traffic_stat')
ORDER BY tablename;
```

**과거 개발 DB 검증.** V5·V6은 2026-10-31, V7은 2026-11-01에 실제 적용했습니다. CSV·FK·게시 배치·재실행·API·기존 데이터 보존 결과는 각 ETL 검증 기록을 따릅니다. [V5 점포](archive/etl-validation-history.md#자치구-점포-개발-db-적용적재-검증-2026-10-31) · [V6 추정매출](archive/etl-validation-history.md#자치구-추정매출-개발-db-적용적재-검증-2026-10-31) · [V7 길단위인구](archive/etl-validation-history.md#자치구-길단위인구-개발-db-적용적재-검증-2026-11-01)

V6 적용 시 추정매출 테이블의 복합키·FK 3개·CHECK 7개와 측정값의 NULL 허용·기본값 없음도 확인했습니다.

**적용 전 백업 기록.** 당시 같은 로컬 DB에 대한 custom-format 백업을 저장소 외부 `$HOME/Downloads/RecycleYoungs-backups/`에 권한 `600`으로 보존했습니다. 세 적용 모두 `pg_dump`, `pg_restore --list`, 전체 아카이브의 SQL 판독을 확인했습니다. V6의 목록 조기 종료로 생긴 입력 파이프 오류는 파일을 직접 표준입력에 연결해 재검증했습니다. 실제 DB 복원은 세 기록 모두 미실시입니다.

| 적용 | 당시 파일·크기                                                    | SHA-256                                                            |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| V6   | `recycleyoungs-before-v6-20261031T144432Z.dump` · 8,751,707바이트 | `1fe19fb2b95a2cd926a234bef492dbded845bbd01d4ad35a3df2103b62976a14` |
| V7   | `recycleyoungs-before-v7-20261101T040416Z.dump` · 9,579,979바이트 | `b4cf4041275809ae1de61b58cdbe5261ab4a7f081984ec48dc6e6dbbee2437eb` |

## 빌드·테스트·품질 검사

`frontend/`와 `etl/`에서 각각 `nvm use`와 `npm ci`로 준비한 뒤 동일한 명령을 실행합니다. Frontend는 Kakao SDK·API를 모의하고 ETL의 기본 테스트는 opt-in DB 통합·실제 CSV 적재를 포함하지 않습니다.

```bash
npm run lint
npm run format:check
npm test
npm run build
```

`backend/`에서는 `./gradlew build`로 단위·MVC 테스트와 Spotless 검사를 실행하고 Spring Boot JAR를 생성합니다. 전체 검증은 Docker를 준비하고 `./gradlew build integrationTest`를 실행합니다. 통합 테스트는 Testcontainers가 만든 `postgis/postgis:17-3.5`에 서비스·Flyway 연결을 모두 지정합니다. ARM64에서 해당 이미지 판본을 찾지 못하면 `docker pull --platform linux/amd64 postgis/postgis:17-3.5`와 AMD64 에뮬레이션을 확인합니다. 로컬 개발 DB 대신 일회용 DB를 사용합니다.

테스트 감시는 `npm run test:watch`, 포맷 수정은 TypeScript 프로젝트의 `npm run format`이나 Java의 `./gradlew spotlessApply`를 사용합니다. ETL의 개별 DB 테스트는 [격리 DB 통합 테스트](etl-guide.md#격리-db-통합-테스트)를 참고합니다.

## GitHub Actions CI

`78d2d3a526d4`의 2026-11-11 실행에서 아래 5개 Job이 모두 성공했습니다. 워크플로는 `project-upgrade` Push 및 해당 브랜치 대상 PR의 열기·동기화·재열기·수정·검토 준비 전환에서 실행하며, 같은 브랜치나 PR의 이전 실행을 취소합니다. [실행 결과](https://github.com/jinwooorp/RecycleYoungs/actions/runs/42937924388) · [워크플로](../.github/workflows/ci.yml)

| Job                 | 실행과 확인                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| Frontend            | Node.js 24·npm 11.19.1에서 설치, 린트·포맷·Vitest·빌드                       |
| Frontend E2E        | E2E 타입·Mock 검사, Chromium 설치, `npm run test:e2e`, JUnit 검사            |
| Backend             | Java 21에서 `./gradlew test`, `./gradlew spotlessCheck`, `./gradlew build`   |
| Backend integration | Docker와 PostGIS 이미지를 확인하고 `./gradlew integrationTest` 및 JUnit 검사 |
| ETL                 | Node.js 24·npm 11.19.1에서 설치, 린트·포맷·기본 테스트·빌드                  |

모든 Job은 `ubuntu-24.04`와 `contents: read`를 사용합니다. 의존성은 기존 잠금 파일·Wrapper로 준비하며 checkout 인증정보를 남기지 않습니다. E2E·DB 통합은 JUnit 누락·실행 0건·실패·오류·건너뜀을 실패로 처리합니다. 실패 원인은 **Actions → CI → Job/Step 로그** 또는 PR의 **Checks**에서 확인합니다. CI는 품질 검증을 수행하며 실제 환경변수·운영 DB·공공데이터 수집·서비스 배포는 사용하지 않습니다.

## 브라우저 E2E 검증

로컬 브라우저 UI 검증은 `ego-browser`를 우선 사용합니다. 자동 회귀 검증은 기존 합성 Playwright E2E와 GitHub Actions CI에서 수행합니다.

[테스트 구성](../frontend/playwright.config.ts)과 [테스트 코드](../frontend/e2e/)는 제품 빌드 및 Vitest와 분리됩니다. 로컬에서는 `frontend/`에서 설치 후 타입·Mock 검사와 테스트 목록을 확인할 수 있습니다.

```bash
npm run e2e:check
npm run test:e2e:list
```

### 공통 합성 환경

로컬에서 화면을 조작할 때는 `frontend/`에서 `npm run e2e:serve`를 실행합니다. 테스트 Vite는 `http://127.0.0.1:4173`, Mock API는 `127.0.0.1:4174`입니다. 포트가 사용 중이면 실패하며 `Ctrl+C`로 두 서버를 종료합니다. 테스트 전용 서버는 `.env` 로딩을 끄고 Kakao 키를 비우며 위치 권한 거부 응답과 외부 연결 제한을 적용합니다. 등록되지 않은 Mock API는 404로 응답합니다.

오류·자료 없음은 테스트 origin의 `ry-e2e-scenario` 쿠키로 재현합니다. 값은 `normal`, `sales-error`, `sales-empty`, `districts-error`입니다. 값을 바꾼 뒤 지역이나 패널을 재선택합니다. 오류 복구는 `normal`로 돌린 뒤 화면에서 재시도합니다.

```js
document.cookie = "ry-e2e-scenario=sales-error; Path=/; SameSite=Strict";
```

후보지 복원은 [합성 fixture](../frontend/e2e/fixtures.ts)의 A·B·C와 `sessionStorage`의 `recycleyoungs.candidates` 버전 1을 사용합니다. 로컬 재현은 새 탭에서 시작하거나 해당 테스트 탭의 키와 쿠키만 초기화합니다.

### 로컬 ego(lite)

1. 실행 전에 `ego-browser skill`로 설치된 버전의 안내를 확인하고, 안내에 따라 별도 작업 Space를 사용합니다. 시스템 서비스 연결·권한·환경 문제로 실행할 수 없을 때만 연결된 Chrome으로 대체하고 사유를 기록합니다. 브라우저 실행 제한과 테스트 보호 정책을 준수합니다.
2. 검증 목적에 맞는 서버에 접속합니다. 실제 데이터 연동은 Kakao 키가 설정된 개발 Frontend와 게시 데이터가 있는 Backend를 사용하고, 합성 시나리오는 위의 Mock 환경을 사용합니다. 해당 서버가 이미 실행 중이면 재사용하고 불필요한 재시작이나 중복 실행을 피합니다.
3. 데스크톱·모바일에서 링크·필터·탭·재시도 등 해당 흐름을 직접 조작합니다. 실제로 조작하고 기대 결과를 확인한 항목만 `PASS`로 기록합니다. 결과에는 사용 도구와 데이터 환경(실제 데이터 또는 Mock)을 명시합니다.
4. 재현한 애플리케이션 결함은 `FAIL`, 브라우저 연결·권한·환경 문제로 검증을 마칠 수 없는 항목은 `BLOCKED`로 기록합니다. 콘솔·네트워크에서 의도한 오류와 예상하지 않은 오류를 구분합니다. 실패 증거는 재현 단계 및 사용한 합성 시나리오의 쿠키 값과 함께 Git에서 제외되는 `frontend/test-results/`에 보존합니다.

기존 로컬 검증에서 데스크톱 오류 배너가 패널 닫기를 가리는 문제를 보정해 회귀 시나리오에 포함했습니다. 당시 키 미설정 모바일 화면의 오류 배너와 지역 필터에 일부 시각적 겹침이 있었으며, 필터와 닫기 조작은 확인했습니다.

### GitHub Actions Playwright

실제 Chromium 실행은 GitHub-hosted Linux Runner에서 수행합니다. Playwright가 합성 서버를 시작·종료하고 데스크톱 1440×900과 모바일 390×844에서 13개씩 총 26개를 검증합니다. 라우팅·키 누락 안내·반응형 패널과 포커스·지역 통계·오류와 재시도·후보지 복원·미검증 증감 비공개를 포함합니다. 실패 시 HTML·trace·스크린샷·JUnit을 7일 보존합니다. 브라우저 시작 전 실패는 Step 로그로 확인합니다.

실제 Kakao 지도·검색·마커·클러스터 및 지도 클릭이나 검색에서 후보지를 새로 등록하는 흐름은 키가 있는 환경에서 별도 확인합니다. 세 곳 초과 E2E는 저장 데이터의 복원 제한을 검증합니다. `kakao-map.test.tsx`의 간헐적 마커 생성 실패는 기존 후속 검증 항목입니다.

## 배포 검토 항목

개발 환경은 `docker-compose.yml`을 사용합니다. VPS용 `docker-compose.prod.yml`은 Nginx·Certbot·GitHub Actions CD와 함께 별도로 구현할 계획입니다. 운영 환경의 비밀정보, DB 권한과 백업·복구 절차도 해당 구성에서 다룹니다.

기존 배포 사전 검증에서는 격리된 DB에서 초기화 관리자·Flyway·Backend 조회 권한 분리를 확인했습니다. ETL의 loopback 제한을 유지하고 검증된 게시 데이터를 별도로 반입하는 방식을 검토했습니다. 로컬 적재와 게시 검증 결과는 [ETL 검증·적재 이력](archive/etl-validation-history.md)에 있습니다.
