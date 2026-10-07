# 개발·검증 안내

모든 `make` 명령은 프로젝트 루트에서 실행합니다. `Makefile`은 일반 명령의 단축 경로이며 `make help`로 목록을 확인할 수 있습니다. 새 checkout·새 DB에서 CSV → ETL → API → React 전체 vertical slice를 처음부터 재현하려면 [새 환경 재현 안내](reproduction.md)를 따릅니다. 일반 개발 절차와 기존 DB를 보호하는 격리 검증 절차를 구분합니다.

## 환경

| 영역 | 기준 |
| --- | --- |
| Backend | Java 21, 저장소의 Gradle Wrapper |
| Frontend | Node.js 24 계열, `npm ci`와 저장소 lockfile |
| ETL | Python 3.12, `etl/requirements.txt` 고정 버전 |
| DB | 루트 Compose의 PostgreSQL 16/PostGIS 3.4 이미지 |

서로 다른 하위 프로젝트의 package.json·lockfile을 하나로 합치지 않습니다. 실험용 Node 프로젝트는 `legacy/`에 있고 활성 개발의 의존성이 아닙니다.

## 설정

`cp .env.example .env`로 로컬 설정을 생성합니다. `.env`는 Git에서 제외됩니다. Compose는 루트 `.env`를 읽으며 프로세스 환경 변수로 덮어쓸 수 있습니다. Spring은 `.env`를 자동으로 읽지 않습니다. `make backend`·`make check-db`·Gradle 실행 전 셸·IDE의 프로세스 환경에 같은 `DB_PASSWORD`를 지정하고, 기본값을 바꿨다면 나머지 `DB_*`도 맞춥니다. 비밀번호에는 코드 기본값을 두지 않습니다. dotenv와 Java properties는 따옴표·escape 해석이 달라 `.env`를 properties로 import하지 않습니다.

| 변수 | 의미 |
| --- | --- |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | 공용 개발 DB 식별자·계정 |
| `DB_PORT` | 호스트에서 DB에 접속할 포트, 컨테이너 내부는 5432 |
| `DB_HOST` | Docker 밖의 Spring 접속 주소, 기본 localhost; ETL 컨테이너는 postgres |
| `AREA_SOURCE_CRS` | 영역 CSV 원천 좌표계, 상권 좌표 적재 전 명시 |
| `STORE_CHUNK_SIZE` | 개별 점포 CSV 청크 크기 |
| `DATA_DIR` | 로컬 Python 실행 시 입력 폴더 변경, 기본 `data/raw/dataset/` |
| `FRONTEND_ORIGINS` | Spring CORS 허용 주소, 기본 localhost/127.0.0.1의 5173 |

로컬 Python 실행은 `.env`를 자동으로 읽지 않습니다. 필요한 값을 프로세스 환경에 지정합니다. Compose의 ETL 서비스는 DB·좌표계·청크 설정을 전달하고 입력 경로를 `/app/data/raw/dataset`으로 설정합니다.

기존 DB 볼륨을 재사용할 때 DB 이름·계정 설정을 바꿔도 기존 데이터베이스 계정이 자동 변경되지는 않습니다. 현재 기본 식별자와 볼륨은 유지했습니다. 다른 계정으로 전환할 때는 기존 DB 상태를 먼저 확인합니다.

## 실행

```sh
make db
make db-migrate
make etl-validate
make etl ETL_ARGS="--only store_stats_dong sales_dong"
```

DB 시작은 ETL을 자동으로 실행하지 않습니다. `make db-migrate`는 Flyway Docker로 backend SQL을 적용하며 Spring 서버·Java 실행이 필요 없습니다. `make etl`도 migration을 먼저 실행합니다. 초기 SQL로 만든 기존 DB의 일회성 편입은 [스키마 안내](../sql/README.md)를 확인하며, 새 DB에는 baseline을 실행하지 않습니다. `make db-info`로 버전과 상태를 조회합니다.

`db-baseline`은 일반적인 새 DB 초기화 명령이 아닙니다. 기존 schema가 V1과 동일함을 검증한 뒤에만 `make db-baseline CONFIRM_BASELINE=verified-v1`을 사용합니다. 확인 값이 없거나 다르면 DB 명령을 실행하지 않고 실패합니다. 새 DB는 `make db-migrate`로 V1부터 적용합니다.

ETL은 선택 실행하는 Compose 서비스입니다. `make etl-validate`는 DB 컨테이너를 시작하거나 DB에 연결하지 않습니다. 처음에는 Docker 이미지 빌드와 패키지 내려받기에 네트워크가 필요합니다.

백엔드·프론트엔드는 각각 별도 터미널에서 실행합니다.

```sh
make backend
```

```sh
cd frontend
npm ci
npm run dev
```

기본 주소는 Vite 5173, Spring 8080, DB 5432입니다. DB는 localhost에 바인딩합니다. Spring은 JDBC로 공용 DB에 연결하고 Flyway 이력을 검증·적용합니다. React는 `/api` 개발 프록시를 통해 목록·행정동 통계를 조회합니다. 세 조건을 선택한 뒤 조회하기를 누릅니다([Frontend 안내](../frontend/README.md)).

## 검증

```sh
make check-frontend
```

위 명령은 lint·build를 실행합니다. frontend의 화면·API client 테스트는 DB 없이 별도로 실행합니다.

```sh
cd frontend
npm run test
```

```sh
cd backend
./gradlew test
```

일반 `test`의 context 검사는 DataSource/Flyway 자동 설정을 제외해 DB 없이 실행합니다. 실제 DB 검증은 별도 `dbTest` source set으로 분리했습니다. 행정동 자료를 적재한 개발 DB에서 다음을 실행합니다.

```sh
make check-db
```

`dbTest`는 JdbcClient로 141,218/67,113행, 업종 매핑·PostGIS와 Flyway version 1·validate·pending 없음 상태를 검사합니다. 다른 검증 DB를 사용할 때는 `DB_HOST`·`DB_PORT`·`DB_NAME`과 `EXPECTED_STORE_STATS_ROWS`·`EXPECTED_SALES_ROWS`를 환경으로 지정합니다. 새 빈 DB의 기대 행 수는 각각 0입니다. 테스트는 통계 데이터를 쓰지 않지만 Spring 시작 시 미적용 migration이 있으면 적용합니다.

ETL 로컬 환경은 다음과 같이 준비합니다.

```sh
python3.12 -m venv etl/.venv
etl/.venv/bin/python -m pip install -r etl/requirements.txt
make check-etl PYTHON="$(pwd)/etl/.venv/bin/python"
```

CSV 검증의 상세 조건과 선택 작업은 [ETL 안내](../etl/README.md)를 확인합니다. DB 적재 결과는 실제 PostgreSQL에서 건수·샘플 값·재실행·중간 실패를 별도로 검증해야 합니다. CSV 검사나 mock 기반 테스트 통과를 DB 적재 성공으로 표시하지 않습니다.

Gradle은 기본 사용자 캐시를 사용합니다. 실행 환경의 캐시 쓰기 권한이나 네트워크 제한으로 테스트가 막히면 원인을 기록하고 과거 테스트 결과와 이번 실행 결과를 구분합니다.

## Git와 원본 관리

- 코드는 backend·frontend·etl, 스키마는 backend의 `db/migration`, 문서는 docs에서 관리합니다. sql에는 운영 안내만 둡니다.
- `data/raw/dataset/.gitkeep`과 `data/raw/README.md`는 추적하며 실제 CSV·ZIP·정제 결과는 제외합니다.
- 원본 CSV를 코드 정리 과정에서 수정하지 않습니다. 새 파일은 출처·기간·해시를 확인한 뒤 의도적으로 교체합니다.
- `.env`, Python 캐시·가상환경, node_modules·빌드 결과는 제외합니다.
- legacy 자료는 새 기능의 샘플 입력으로 자동 사용하지 않습니다.

## DB 종료·변경

```sh
make db-stop
```

볼륨을 보존하며 DB만 중지합니다. 일상적인 갱신에 볼륨 삭제 명령을 사용하지 않습니다. 초기 SQL 적용 조건과 마이그레이션 전환은 [스키마 안내](../sql/README.md)를 확인합니다.
