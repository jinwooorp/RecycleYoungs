# 개발 환경 설정과 실행

처음 개발 환경을 준비하거나 로컬에서 앱을 실행하는 개발자를 위한 문서입니다.

웹 앱의 첫 화면은 Frontend만으로 열 수 있습니다.

지역·상권 API를 확인하는 방법은 두 가지입니다.

테스트용 예시 데이터로 실행하는 합성 Demo를 쓰거나, 로컬 DB에 조회용 데이터를 준비합니다.

[전체 구성](ARCHITECTURE.md)

## 목차

- [실행 방식 선택](#팀원-클론과-실행-방식)
- [로컬 DB 준비](#로컬-db-준비)
- [전체 Docker 스택](#전체-docker-스택)
- [합성 Demo](#합성-demo)
- [개발 DB 게시 데이터](#개발-db-게시-데이터)
- [Frontend 실행과 지도 설정](#2-frontend)
- [Backend 실행과 DB 구조 확인](#3-backend)
- [문제 해결](#문제-해결)
- [테스트와 CI](TESTING.md)

## 1. 개발 도구

명령은 macOS 또는 Linux 셸(Windows의 WSL 포함)을 기준으로 합니다.

네이티브 Windows는 현재 지원 범위 밖입니다.

| 대상                    | 필요한 도구                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Frontend·ETL            | Node.js 24 LTS·npm 11. `nvm`을 사용하면 각 디렉터리에서 `nvm use`로 버전을 선택합니다. CI와 맞출 때는 npm 11.19.1을 사용합니다. |
| Backend                 | Java 21과 저장소의 Gradle Wrapper(`./gradlew`)                                                                   |
| 전체 스택·Demo·DB 통합 테스트 | Docker와 Docker Compose. Demo의 REST 자동 검증에는 Node.js 24도 필요합니다. |

### 팀원 클론과 실행 방식

저장소를 클론하고 작업할 브랜치를 체크아웃합니다.

명령은 별도 안내가 없으면 저장소 루트에서 시작합니다.

| 확인하려는 기능 | 실행 방식 | 기본 접속 주소 |
| --- | --- | --- |
| 화면 구조와 라우팅 | [Frontend](#2-frontend)를 실행합니다. Spring Boot 기동 자체를 확인하려면 [DB 없는 기본 실행](#db-없는-기본-실행)을 사용합니다. | `http://localhost:5173` |
| 공공데이터나 인증키 없이 조회 API 확인 | [합성 Demo](#합성-demo)를 실행하고 전용 DB에 합성 데이터를 넣습니다. | `http://127.0.0.1:38081` |
| 웹 앱 변경을 바로 보면서 로컬 데이터 연동 | [하이브리드 실행](#로컬-db-준비)으로 PostGIS는 Docker에서, Vite와 Spring Boot는 로컬에서 직접 실행합니다. | `http://localhost:5173` |
| Nginx를 포함한 개발 스택 확인 | [전체 Docker 스택](#전체-docker-스택)을 실행합니다. | `http://127.0.0.1:8081` |

하이브리드와 전체 Docker 방식은 루트 `.env`를 사용합니다.

실제 지도는 실행 방식에 맞게 JavaScript 키를 설정합니다.

실제 통계까지 보려면 조회용 데이터를 준비합니다.

[Kakao Maps 설정](#kakao-maps-설정) · [개발 DB 게시 데이터](#개발-db-게시-데이터)

### 로컬 DB 준비

루트의 `.env`를 준비합니다.

아래 명령 중 `cp -n`은 기존 `.env`를 유지합니다.

복사한 뒤 DB 이름·사용자·비밀번호·포트가 사용할 로컬 DB 설정인지 확인합니다.

| 설정 | 읽는 위치와 용도 |
| --- | --- |
| [루트 예시](../.env.example) | Compose는 루트 `.env`를 읽습니다. `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`는 DB 설정이고, `FRONTEND_PORT`와 `VITE_KAKAO_MAP_APP_KEY`는 `full` 프로필에 사용합니다. |
| [Frontend 예시](../apps/web/.env.example) | 호스트 Vite는 `apps/web/.env.local` 등에서 지도 키와 개발 서버의 API 전달 주소를 읽습니다. |
| [Backend 예시](../apps/api/.env.example) | 호스트 Backend의 `db` 프로필은 실행 셸에서 `DB_USER`, `DB_PASSWORD`, `DB_JDBC_URL`을 읽습니다. |
| [ETL 예시](../apps/etl/.env.example) | ETL은 실행 위치의 `.env`에서 DB 연결 설정과 `SEMAS_API_KEY`, `SEOUL_OPEN_API_KEY`를 읽습니다. 실행 셸의 값이 우선합니다. |

실제 키·비밀번호·접속 URL은 Git이나 로그에 남기지 않습니다.

ETL을 실행할 때는 `DATABASE_URL`이 의도한 로컬 DB를 가리키는지 확인합니다.

URL 비밀번호에 예약 문자가 있으면 인코딩합니다.

[ETL 환경변수와 실행](ETL.md#설치-및-공통-실행)

저장소 루트에서 DB를 시작합니다.

DB는 `127.0.0.1`의 `DB_PORT`(기본 5432)에 게시됩니다.

포트가 사용 중이면 로컬 설정의 포트와 접속 URL을 함께 맞춥니다.

[개발용 Compose](../docker-compose.yml)

```bash
cp -n .env.example .env
# .env의 로컬 DB 설정을 확인합니다.
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml up -d --wait db
docker compose -f docker-compose.yml ps db
```

DB가 준비되면 별도 터미널에서 [Backend의 `db` 프로필](#db를-사용하는-db-프로필-실행)과 [Frontend](#2-frontend)를 실행합니다.

두 서버를 띄운 뒤 [개발 DB 게시 데이터](#개발-db-게시-데이터)를 확인합니다.

루트에서 다음 명령으로 접속한 뒤 `psql`에서 `SELECT version(), PostGIS_Version();`을 실행하고 `\q`로 종료합니다.

호스트 DB 도구도 동일한 루프백 주소와 `.env`의 DB 정보를 사용합니다.

```bash
docker compose -f docker-compose.yml exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

호스트 Frontend와 Backend는 실행한 터미널에서 `Ctrl+C`로 종료합니다.

DB는 `docker compose -f docker-compose.yml stop db`로 중지합니다.

기존 컨테이너는 `docker compose -f docker-compose.yml start db`로 다시 시작합니다.

`recycleyoungs_postgres_data` 볼륨에 개발 데이터가 남습니다.

최초 기동 때 만든 DB와 계정은 이후 `.env`를 수정해도 그대로입니다.

### 전체 Docker 스택

`full` 프로필은 개발 DB에 Frontend와 Backend를 추가합니다.

Frontend는 Node.js 24로 빌드한 SPA를 Nginx에서 제공하고 `/api`를 Backend로 전달합니다.

Backend는 Java 21 Gradle Wrapper로 빌드한 JAR를 JRE에서 실행합니다.

Backend 포트는 Compose 네트워크 안에서만 사용합니다.

하이브리드에서 전환할 때는 호스트 Vite와 Spring Boot를 먼저 종료합니다.

전체 스택과 하이브리드는 기본 프로젝트 `recycleyoungs`의 `recycleyoungs_postgres_data` 볼륨을 공유합니다.

저장소 루트에서 다음 명령을 실행합니다.

```bash
cp -n .env.example .env
# .env의 로컬 DB 설정을 확인합니다.
docker compose -f docker-compose.yml --profile full config --quiet
docker compose -f docker-compose.yml --profile full up -d --build
docker compose -f docker-compose.yml --profile full ps
```

Nginx는 루프백의 `FRONTEND_PORT`(기본 8081)에 게시됩니다.

Compose는 [루트의 개발용 Nginx 설정](../nginx/default-dev.conf) 한 파일을 컨테이너에 읽기 전용으로 연결합니다.

Frontend 빌드 컨텍스트는 `apps/web/`입니다.

[홈](http://127.0.0.1:8081/)과 [탐색 화면](http://127.0.0.1:8081/explore)을 엽니다.

Docker에서는 정적 빌드를 제공하므로 앱 소스를 바꾸면 해당 서비스 이미지를 다시 빌드합니다.

HMR을 사용하려면 하이브리드 방식으로 실행합니다.

- Backend는 DB가 준비되면 `db:5432`에 연결합니다.

  DB 구조 변경 이력을 관리하는 도구인 Flyway가 적용되지 않은 변경을 실행합니다.

  호스트용 `DB_JDBC_URL`은 컨테이너에 전달하지 않습니다.

  새 볼륨의 조회용 데이터는 별도로 준비합니다.

  ETL은 수동으로 실행합니다.

- Docker 지도는 루트 `.env`의 `VITE_KAKAO_MAP_APP_KEY`를 빌드 인자로 사용합니다.

  키를 바꾼 뒤 아래 Frontend 재빌드 명령을 실행합니다.

  [Kakao Maps 설정](#kakao-maps-설정)
- DB 비밀번호는 실행 시 DB와 Backend에만 전달됩니다.

  이미지 빌드에는 로컬 환경 파일을 포함하지 않습니다.

전체 컨테이너를 종료하거나 기존 이미지로 다시 시작할 때 같은 Compose 프로젝트를 사용합니다.

Frontend 재빌드는 실행 중인 DB와 Backend를 유지합니다.

```bash
# 실행 중인 전체 스택 중지
docker compose -f docker-compose.yml --profile full stop
# 중지된 전체 스택 재시작
docker compose -f docker-compose.yml --profile full start
# Frontend 소스 또는 지도 키 변경 후 Frontend만 재빌드
docker compose -f docker-compose.yml --profile full up -d --no-deps --build frontend
```

기존 개발 DB와 나란히 분리해 실행하려면 별도 프로젝트명과 빈 루프백 포트를 사용합니다.

아래 예의 볼륨은 `recycleyoungs-full_postgres_data`입니다.

`ps`, `stop`, `start`에도 같은 프로젝트명과 포트 설정을 사용합니다.

```bash
DB_PORT=15432 FRONTEND_PORT=18081 docker compose -f docker-compose.yml -p recycleyoungs-full --profile full up -d --build
```

`restart`는 기존 컨테이너의 프로세스를 다시 시작합니다.

빌드 인자나 Compose 설정 변경을 적용할 때는 해당 서비스를 `up`으로 다시 구성합니다.

기본 개발 볼륨에서 데이터를 보존하려면 볼륨 삭제 옵션을 사용하지 않습니다.

### 합성 Demo

로컬 Docker와 Compose를 준비하고 저장소 루트에서 아래 명령을 실행합니다.

REST 자동 검증에는 Node.js 24가 필요합니다.

Demo는 프로젝트 `recycleyoungs-demo`, DB `recycleyoungs_demo`, 볼륨 `recycleyoungs-demo_postgres_data`를 사용합니다.

루프백 포트는 PostGIS가 `35432`, Nginx가 `38081`입니다.

```bash
./demo/run.sh up
./demo/run.sh seed
node --test demo/smoke.test.mjs
```

`up`은 Flyway V1~V7을 적용합니다.

`seed`를 실행하면 합성 게시 배치 9건과 조회용 행 20건이 저장됩니다.

`seed`는 전용 컨테이너·볼륨·DB·계정·서버 표시를 확인합니다.

동일 fixture의 행 수와 SHA-256을 재검증해 출력합니다.

다른 배치나 불일치가 있으면 중단합니다.

`./demo/run.sh logs`로 Backend 기동을 확인하고, 종료는 `./demo/run.sh stop`을 사용합니다.

재기동해도 같은 Demo 볼륨을 사용합니다.

같은 호스트에서 독립된 Demo를 실행하려면 별도 셸에서 `export DEMO_SLOT=1`을 설정합니다.

시작·seed·테스트·종료 명령에는 같은 값을 사용합니다.

슬롯은 0~9이고 0이 기본입니다.

슬롯 1의 프로젝트는 `recycleyoungs-demo-1`, 볼륨은 `recycleyoungs-demo-1_postgres_data`입니다.

루프백 포트는 `35433`과 `38082`입니다.

1~9는 프로젝트 이름에 슬롯 번호를 붙이고 기본 포트에 슬롯 번호를 더합니다.

아래 조회 예시는 기본 슬롯 기준입니다.

```bash
curl -fsS http://127.0.0.1:38081/api/v1/districts
curl -fsS 'http://127.0.0.1:38081/api/v1/dongs/99001001/stats/stores?quarterCode=20262&industryCode=CS100010'
curl -fsS 'http://127.0.0.1:38081/api/v1/cafes/nearby?longitude=127&latitude=37.57&radiusM=500'
```

REST 검증은 [후보 좌표 A·B](../demo/candidates.json)로 중심 포함 지역과 500m·1,000m 카페 수를 확인합니다.

두 분기의 통계는 REST에서 조회하며, 화면의 전분기 증감 표시는 기존 공개 정책을 따릅니다.

Demo 화면에는 지도 키 설정 안내가 표시됩니다.

실제 지도 표시·장소 검색·지도 조작에 의존하는 후보 등록은 [Kakao Maps 설정](#kakao-maps-설정)이 있는 개발 실행에서 확인합니다.

키 없이 화면의 합성 후보 흐름을 확인하려면 [합성 E2E 환경](TESTING.md#공통-합성-환경)을 사용합니다.

### 개발 DB 게시 데이터

새 로컬 DB에는 Flyway로 테이블 구조를 적용합니다.

조회할 데이터는 다음 중 하나로 준비합니다.

[DB 구조 변경 이력](DATABASE.md#db-마이그레이션-방향)

1. 공공데이터 없이 조회 API를 확인하려면 [합성 Demo](#합성-demo)의 전용 DB를 사용합니다.

2. 기존 검증 데이터를 사용하려면 승인된 개발 스냅샷을 별도 로컬 DB에 복원합니다.

   스냅샷은 Git 외부에서 관리합니다.

   새 클러스터에 복원할 때는 대상 DB와 필요한 소유자 역할을 확인합니다.

3. 공식 원천으로 직접 준비하려면 경계와 서비스 업종 기준 데이터를 먼저 적재합니다.

   카페와 통계는 [ETL 절차](ETL.md#실제-적재-명령-9개)에 따라 게시합니다.

기존 개발 DB에서 확인한 통계 통합·복원 결과는 날짜와 대상 범위를 함께 확인합니다.

[검증 범위와 재현 근거](ETL.md#검증-범위와-재현-근거)

### 서울시 Open API 인증키

ETL을 실행할 때만 발급받은 `SEOUL_OPEN_API_KEY`를 ETL 실행 위치의 `.env`나 실행 셸에 설정합니다.

인증키 전송·DB 쓰기 승인과 평문 HTTP 위험은 ETL 가이드에서 확인합니다.

[API 전송과 게시 절차](ETL.md#서울시-open-api-전체-수집-probe)

## 2. Frontend

Node.js 24를 준비한 뒤 저장소 루트에서 실행합니다.

Vite는 기본 포트 5173을 사용하며 이미 사용 중이면 기동 오류가 납니다.

```bash
cd apps/web
npm ci
npm run dev
```

랜딩은 `/`, 탐색은 `/explore`이며 알 수 없는 경로는 React Router의 404 화면으로 연결됩니다.

탐색 경로에서 지도와 탐색 코드를 불러옵니다.

`npm run build`는 타입 검사 후 `dist/`를 생성하고 `npm run preview`는 결과를 확인하는 명령입니다.

[로컬 랜딩](http://localhost:5173/) · [탐색 화면](http://localhost:5173/explore)

### Kakao Maps 설정

1. Kakao Developers에서 앱의 **카카오맵 사용 설정**을 활성화합니다.

   **앱 → 플랫폼 키 → JavaScript 키**에서 키를 발급하거나 확인합니다.

   [카카오맵 사용 설정](https://developers.kakao.com/docs/ko/kakaomap/common) · [JavaScript 키 설정](https://developers.kakao.com/docs/ko/app-setting/app)
2. 같은 JavaScript 키의 **JavaScript SDK 도메인**에 실제 접속 주소를 등록합니다.

   호스트 Vite의 기본 예는 `http://localhost:5173`, 전체 Docker의 기본 주소는 `http://127.0.0.1:8081`입니다.

   호스트명이나 포트가 다르면 실제 사용할 주소를 등록합니다.

3. 호스트 Vite는 [Frontend 예시](../apps/web/.env.example)에 따라 `apps/web/.env.local`에 `VITE_KAKAO_MAP_APP_KEY`를 설정합니다.

   설정 후 Vite를 재시작합니다.

   전체 Docker는 [루트 예시](../.env.example)에 따라 루트 `.env`에 같은 변수명을 설정합니다.

   `docker compose -f docker-compose.yml --profile full up -d --no-deps --build frontend`로 다시 빌드합니다.

   Docker 빌드는 `apps/web/.env.local`을 읽지 않습니다.

JavaScript 키는 브라우저 번들에서 확인할 수 있습니다.

`VITE_KAKAO_MAP_APP_KEY`에는 JavaScript 키만 사용하며 REST API 키·Admin 키·DB 비밀번호는 넣지 않습니다.

키가 비어 있으면 설정 안내를 표시하며 SDK를 요청하지 않습니다.

로딩 오류나 시간 초과가 발생하면 키 종류·카카오맵 활성화·등록 origin·네트워크를 확인합니다.

확인 후 화면의 재시도를 사용합니다.

현재 위치 기능은 브라우저 권한과 HTTPS 또는 localhost 같은 보안 컨텍스트가 필요합니다.

[지도 이용 동작](PRD.md#탐색-페이지)

### 프록시와 주의사항

Vite는 `/api`를 기본적으로 `http://localhost:8080`에 전달합니다.

대상 변경은 `apps/web/.env` 또는 실행 환경의 `API_PROXY_TARGET`으로 설정합니다.

이는 개발 서버 설정입니다.

지도는 뜨지만 지역·상권 데이터가 로드되지 않으면 프록시 주소, Backend의 `db` 프로필, 정상 게시 데이터를 차례로 확인합니다.

[Vite 설정](../apps/web/vite.config.ts)

## 3. Backend

### DB 없는 기본 실행

별도 터미널의 저장소 루트에서 다음 명령을 실행합니다.

기본 포트는 8080이며 Backend 루트의 HTTP 404는 정상입니다.

기본 프로필에서는 DataSource·JdbcClient·Flyway 없이 실행됩니다.

```bash
cd apps/api
./gradlew bootRun
```

### DB를 사용하는 `db` 프로필 실행

기본 Backend가 실행 중이면 종료합니다.

[로컬 DB 준비](#로컬-db-준비)에서 DB를 시작한 뒤 Backend를 실행할 터미널의 저장소 루트에서 아래 명령을 실행합니다.

**기동 전에 대상 DB, 백업, 마이그레이션 권한을 확인합니다.**

```bash
set -a
source .env
set +a
cd apps/api
./gradlew bootRun --args='--spring.profiles.active=db'
```

[프로필 설정](../apps/api/src/main/resources/application-db.yaml)은 서비스용 Hikari DataSource·JdbcClient와 별도 Flyway 연결을 같은 DB 환경변수로 구성합니다.

계정을 분리할 때는 `spring.datasource.*`와 `spring.flyway.*`를 외부 설정으로 지정합니다.

외부 로컬 DB에는 PostGIS와 확장 생성 권한이 필요합니다.

기동 시 Flyway V1~V7 중 미적용 버전을 적용합니다.

새 DB에서 `/api/v1/districts`가 `503 DATA_NOT_READY`를 반환하면 [개발 DB 게시 데이터](#개발-db-게시-데이터)를 준비합니다.

행정구역 목록에는 경계 ETL의 정상 게시본이 필요합니다.

[경계 ETL](ETL.md#행정동자치구-경계-적재) · [REST API 준비 상태와 오류 계약](API.md#공통-오류와-데이터-상태)

### 마이그레이션 적용 상태 확인

DB를 확인한 후 `psql`에서 아래 읽기 전용 SQL을 실행합니다.

V7까지 적용된 DB의 기대 결과는 버전 1~7의 `success=true`와 프로젝트 테이블 11개입니다.

적용된 마이그레이션 파일과 기존 DB 이력을 보존합니다.

```sql
SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank;
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('etl_batch', 'district', 'administrative_dong', 'service_industry',
                    'dong_store_stat', 'dong_sales_stat', 'dong_foot_traffic_stat', 'cafe_store',
                    'district_store_stat', 'district_sales_stat', 'district_foot_traffic_stat')
ORDER BY tablename;
```

## 문제 해결

| 증상 | 확인할 곳 |
| --- | --- |
| Vite가 시작하지 않음 | Node.js 24와 설치 상태, 5173 포트 사용 여부를 확인합니다. |
| 지도가 설정 안내를 표시하거나 로딩에 실패 | JavaScript 키·카카오맵 활성화·등록 주소를 확인합니다. 호스트 Vite는 재시작하고 Docker는 Frontend를 다시 빌드합니다. [지도 설정](#kakao-maps-설정) |
| 지도는 보이지만 지역·상권 데이터가 없음 | `/api` 전달 주소, Backend의 `db` 프로필, 조회 대상의 게시 상태를 차례로 확인합니다. [API 오류와 데이터 상태](API.md#공통-오류와-데이터-상태) |
| DB 연결이나 Flyway 적용 실패 | DB 서비스 상태, 대상 주소·포트·계정, PostGIS 확장 생성 권한과 마이그레이션 이력을 확인합니다. [로컬 DB 준비](#로컬-db-준비) |
| Compose 설정을 바꿔도 그대로임 | 빌드 인자와 서비스 설정 변경은 `up`으로 적용합니다. 기존 볼륨에 생성된 DB·계정은 `.env` 변경으로 갱신되지 않습니다. [전체 Docker 스택](#전체-docker-스택) |
