# 개발·검증 안내

모든 `make` 명령은 프로젝트 루트에서 실행합니다. `Makefile`은 일반 명령의 단축 경로이며 `make help`로 목록을 확인할 수 있습니다.

## 환경

| 영역 | 기준 |
| --- | --- |
| Backend | Java 21, 저장소의 Gradle Wrapper |
| Frontend | Node.js 24 계열, `npm ci`와 저장소 lockfile |
| ETL | Python 3.12, `etl/requirements.txt` 고정 버전 |
| DB | 루트 Compose의 PostgreSQL 16/PostGIS 3.4 이미지 |

서로 다른 하위 프로젝트의 package.json·lockfile을 하나로 합치지 않습니다. 실험용 Node 프로젝트는 `legacy/`에 있고 활성 개발의 의존성이 아닙니다.

## 설정

`cp .env.example .env`로 로컬 설정을 생성합니다. `.env`는 Git에서 제외되며 Compose가 읽습니다.

| 변수 | 의미 |
| --- | --- |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | 공용 개발 DB 식별자·계정 |
| `DB_PORT` | 호스트에서 DB에 접속할 포트, 컨테이너 내부는 5432 |
| `AREA_SOURCE_CRS` | 영역 CSV 원천 좌표계, 상권 좌표 적재 전 명시 |
| `STORE_CHUNK_SIZE` | 개별 점포 CSV 청크 크기 |
| `DATA_DIR` | 로컬 Python 실행 시 입력 폴더 변경, 기본 `data/raw/dataset/` |
| `FRONTEND_ORIGINS` | Spring CORS 허용 주소, 기본 localhost/127.0.0.1의 5173 |

로컬 Python 실행은 `.env`를 자동으로 읽지 않습니다. 필요한 값을 프로세스 환경에 지정합니다. Compose의 ETL 서비스는 DB·좌표계·청크 설정을 전달하고 입력 경로를 `/app/data/raw/dataset`으로 설정합니다.

기존 DB 볼륨을 재사용할 때 DB 이름·계정 설정을 바꿔도 기존 데이터베이스 계정이 자동 변경되지는 않습니다. 현재 기본 식별자와 볼륨은 유지했습니다. 다른 계정으로 전환할 때는 기존 DB 상태를 먼저 확인합니다.

## 실행

```sh
make db
make etl-validate
make etl ETL_ARGS="--only store_stats_dong sales_dong"
```

DB 시작은 ETL을 자동으로 실행하지 않습니다. ETL은 선택 실행하는 Compose 서비스입니다. `make etl-validate`는 DB 컨테이너를 시작하거나 DB에 연결하지 않습니다. 처음에는 Docker 이미지 빌드와 패키지 내려받기에 네트워크가 필요합니다.

백엔드·프론트엔드는 각각 별도 터미널에서 실행합니다.

```sh
make backend
```

```sh
cd frontend
npm ci
npm run dev
```

기본 주소는 Vite 5173, Spring 8080, DB 5432입니다. DB는 localhost에 바인딩합니다. 아직 Spring에는 DB 연결·통계 API가 구현되지 않았으므로 실행만으로 실제 분석 기능이 제공되지는 않습니다.

## 검증

```sh
make check-frontend
```

```sh
cd backend
./gradlew test
```

ETL 로컬 환경은 다음과 같이 준비합니다.

```sh
python3.12 -m venv etl/.venv
etl/.venv/bin/python -m pip install -r etl/requirements.txt
make check-etl PYTHON="$(pwd)/etl/.venv/bin/python"
```

CSV 검증의 상세 조건과 선택 작업은 [ETL 안내](../etl/README.md)를 확인합니다. DB 적재 결과는 실제 PostgreSQL에서 건수·샘플 값·재실행·중간 실패를 별도로 검증해야 합니다. CSV 검사나 mock 기반 테스트 통과를 DB 적재 성공으로 표시하지 않습니다.

Gradle은 기본 사용자 캐시를 사용합니다. 실행 환경의 캐시 쓰기 권한이나 네트워크 제한으로 테스트가 막히면 원인을 기록하고 과거 테스트 결과와 이번 실행 결과를 구분합니다.

## Git와 원본 관리

- 코드는 backend·frontend·etl, 스키마는 현재 sql, 문서는 docs에서 관리합니다.
- `data/raw/dataset/.gitkeep`과 `data/raw/README.md`는 추적하며 실제 CSV·ZIP·정제 결과는 제외합니다.
- 원본 CSV를 코드 정리 과정에서 수정하지 않습니다. 새 파일은 출처·기간·해시를 확인한 뒤 의도적으로 교체합니다.
- `.env`, Python 캐시·가상환경, node_modules·빌드 결과는 제외합니다.
- legacy 자료는 새 기능의 샘플 입력으로 자동 사용하지 않습니다.

## DB 종료·변경

```sh
make db-stop
```

볼륨을 보존하며 DB만 중지합니다. 일상적인 갱신에 볼륨 삭제 명령을 사용하지 않습니다. 초기 SQL 적용 조건과 마이그레이션 전환은 [스키마 안내](../sql/README.md)를 확인합니다.
