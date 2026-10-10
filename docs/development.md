# 개발 환경과 재현

이 문서는 환경·일반 DB 없는 검증·승인된 새 격리 DB의 재현 순서를 관리합니다. 실행 진입점은 [Makefile](../Makefile)이며 기존 DB 접속/변경은 [db-safety](db-safety.md)가 기준입니다. 아래 예시는 이번 문서 작업에서 실행하지 않았습니다.

## 환경과 설정

| 영역 | 저장소 기준 |
| --- | --- |
| Backend | Java 21·Spring Boot 4.1.1·Gradle Wrapper, [build.gradle](../backend/build.gradle) |
| Frontend | Node.js 24 계열·React 19/TypeScript 6/Vite 8·Tailwind 4/shadcn, [package/lockfile](../frontend/package.json) |
| ETL | Python 3.12, [requirements.txt](../etl/requirements.txt)의 고정 dependency |
| DB | PostgreSQL 16/PostGIS 3.4, Compose Flyway 12.4.0, [Compose](../docker-compose.yml) |

`cp .env.example .env`로 로컬 설정을 준비합니다. Compose는 루트 .env를 읽지만 Spring/로컬 Python은 프로세스 환경을 사용하고 .env를 자동 import하지 않습니다. Java properties로 dotenv를 import하지 않습니다. 실제 secret은 문서·로그·Git에 넣지 않습니다.

| 설정 | 의미 |
| --- | --- |
| DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD | 접속 route·database·계정. 명시한 승인 대상과 맞춰야 함 |
| AREA_SOURCE_CRS | 영역 X/Y 적재에 EPSG:5181 명시. 미설정 시 거부 |
| DATA_DIR 또는 CSV --data-dir | 기본 `data/raw/dataset/` 대신 사용할 입력 |
| STORE_CHUNK_SIZE | 점포 COPY 청크, 전체 transaction 경계와 별개 |
| FRONTEND_ORIGINS | Spring CORS, 기본 localhost/127.0.0.1의 5173 |
| EXPECTED_STORE_STATS_ROWS/EXPECTED_SALES_ROWS | DB 테스트 기대 건수. 실제 상태 확인을 대신하지 않음 |

Docker 밖 Spring/로컬 Python의 기본 localhost:5432와 Compose ETL의 postgres:5432를 혼동하지 않습니다. 기본값이 기존 보호 DB를 가리키면 중단합니다. 기존 volume에 이름/계정 env를 바꿔도 실제 database/role이 바뀌지 않습니다. Spring 기본 port=8080, Vite=5173이고 Vite /api proxy를 사용합니다.

## 설치와 DB 없는 검증

원본 ZIP은 별도 전달받아 dataset 폴더를 유지하고 [manifest](../data/manifest.json)의 파일명/size/SHA와 대조합니다. 원본은 바꾸지 않습니다. 설치는 저장소 lockfile을 따릅니다.

```sh
(cd frontend && npm ci)
python3.12 -m venv etl/.venv
etl/.venv/bin/python -m pip install -r etl/requirements.txt
```

준비된 환경에서 DB/raw opt-in을 활성화하지 않고 필요한 검증만 실행합니다.

```sh
(cd backend && ./gradlew test)
(cd frontend && npm run test)
make check-frontend
make check-etl PYTHON="$(pwd)/etl/.venv/bin/python"
(cd etl && .venv/bin/python -m app.main --validate-only)
```

일반 Backend test는 DataSource/Flyway 자동 설정을 제외합니다. frontend check는 lint/build이며 test는 별도입니다. ETL의 --validate-only는 CSV 구조/key/기간 검사이고 DB 접속·적재를 하지 않습니다. make etl-validate도 --no-deps/--validate-only이지만 첫 image build/download가 필요할 수 있습니다. mock/skip/offline은 실제 DB 성공이 아닙니다.

`python etl/control.py`의 기본 inspect는 Git와 비활성 정책만 출력하고 DB에 접속하지 않습니다. test-only safety_gate도 무접속·write 승인 거부입니다. 실행 코드를 임의 import하거나 --isolated-run을 일반 점검에 추가하지 않습니다.

## 승인된 신규 격리 DB 재현

현재 schema는 **V1→V2→V3**, 원본 geometry는 별도 ETL입니다. 아래는 과거 8-C1 흐름을 현재 코드와 정적으로 대조한 절차이며 현재 HEAD의 전체 실행을 재검증한 결과가 아닙니다.

1. 기존 DB/container/volume을 재사용하지 않는 새 대상과 생성/실행 범위를 승인받습니다. 전용 internal network·host port 없음·data/init tmpfs·기존 mount/volume 없음·고정 image를 사용합니다. 루트 Compose는 고정 보호 container 이름을 쓰므로 project 이름만 바꿔 격리를 주장하지 않습니다.
2. 실제 Docker/server identity와 isolation proof를 수집하고 승인된 explicit route/계정·secret으로 고정합니다. 원본·source/migration은 read-only, evidence는 project 밖 private 위치에 둡니다.
3. 입력 manifest·Polygon ZIP/member/report/profile을 offline 검사합니다. 불일치면 DB 단계로 진행하지 않습니다.
4. **Fresh:** 빈 DB에 Flyway V1/V2/V3 SQL을 적용·validate합니다. BASELINE이 아닌 SQL history 1/2/3, V1 7table+V2 3table, SEOUL 4+SEMAS CAFE mapping, 빈 stores backfill 0을 확인합니다. actual JDBC identity 검사와 gate를 생략하지 않습니다.
5. 같은 격리 network의 승인 runner에서 explicit CSV DB env로 행정동 두 통계만 먼저 적재합니다. 전체 5job 적재는 별도 범위이고 AREA_SOURCE_CRS가 필요합니다. source/row/key/NULL/ID/sequence·rollback을 검증합니다.
6. Polygon은 explicit ZIP/report와 DSN으로 admin→검증→commercial→검증→동등 retry를 수행합니다. 상세 publication/STOP은 db-safety를 따릅니다.
7. Backend를 같은 격리 network의 승인 runner에서 explicit DB route로 실행하고 HTTP/API·원본 표 값을 대조합니다. Frontend는 `npm run dev`와 승인된 API proxy로 연결합니다. 임시 port/proxy가 필요하면 기존 process를 종료하지 않습니다.
8. 전후 원본 hash·기존 보호 자원 불변·새 대상 최종 snapshot을 확인하고 승인받아 만든 자원만 정리합니다. 기존 container stop/volume 삭제·restore는 이 절차에 포함하지 않습니다.

CSV 선택 예시는 승인된 격리 runner에서 ETL 디렉터리를 기준으로 사용합니다.

```sh
python -m app.main --data-dir "$APPROVED_DATA_DIR" --only store_stats_dong sales_dong
```

Polygon offline 검증 예시는 다음과 같습니다. 실제 load는 --load/--dsn을 함께 요구하며 기본 CSV DB env나 make etl을 사용하지 않습니다.

```sh
python -m app.spatial_main --only admin --validate-only \
  --admin-zip "$APPROVED_ADMIN_ZIP" --admin-report "$APPROVED_ADMIN_REPORT"
python -m app.spatial_main --only commercial --validate-only \
  --commercial-zip "$APPROVED_COMMERCIAL_ZIP" \
  --commercial-report "$APPROVED_COMMERCIAL_REPORT" \
  --commercial-repair-report "$APPROVED_REPAIR_REPORT"
```

실제 검사 도구는 [integration_check](../etl/tests/integration_check.py)의 inputs/snapshot/source/compare-preserved/compare-logical과 [integration_spatial](../etl/tests/integration_spatial.py)입니다. DSN 기본값이 없으며 guarded DB mode는 actual proof와 테스트 prefix·SID·route를 검사합니다. inputs/compare는 무접속입니다. v1-stores는 전용 V1-only/empty 격리 fixture이고 production/full loader/backfill 경로가 아닙니다. 재현 전체 orchestration driver와 private config/evidence는 저장소의 일반 자동 실행 명령이 아닙니다.

## DB 테스트와 실행 제한

`./gradlew dbTest`/`make check-db`와 Spring bootRun/`make backend`는 pending migration을 자동 실행할 수 있습니다. **기존 DB 사전 점검에 사용하지 않습니다.** 현재 PostgresConnectionTests는 current Flyway version **1**을 고정 기대하므로 V1~V3 fresh DB와 맞지 않습니다. 행 수 변수만 바꾸면 해결되는 문제가 아니며 기대값·startup migration 정책은 후속 코드 검토 사항입니다.

API fixture는 API_FIXTURE_TEST=true와 DB_NAME의 recycleyoungs_api_fixture_ prefix, 실제 V1·빈 통계 table을 요구하고 Flyway를 비활성화합니다. 쓰기/rollback fixture이므로 별도 격리 승인 없이 활성화하지 않습니다. 공간/stores DB 및 실제 raw 검사는 SPATIAL_TEST_DSN/SPATIAL_REAL_SOURCE_ROOT/STORES_TEST_DSN/STORES_REAL_DSN/STORES_REAL_CSV opt-in이며 prefix만으로 격리가 보장되지 않습니다. 실행/미실행·PASS/FAIL/SKIP를 분리합니다.

| 경로 | 부작용·사용 조건 |
| --- | --- |
| make db / db-info / docker compose up | 기존 container 시작·재생성 가능. 대상·승인 확인 전 실행 금지 |
| make db-migrate / Flyway migrate | schema/history 변경. 단계별 JDBC/gate·명시 승인 필요 |
| make db-baseline | V1 대조를 대신하지 않음. 새 DB에 사용 금지, 기존 BASELINE 재실행 금지 |
| make etl / CSV full loader | migration 선행·DELETE/TRUNCATE·ID 재시작. 기존 DB backfill 금지 |
| Polygon --load | explicit DSN·actual publication 연결 검사·종류별 transaction·명시 승인 |
| bootRun / make backend / dbTest / check-db | DB 접속·자동 migration 가능. 일반 읽기 전용 검증이 아님 |
| db-stop / stop/restart/recreate / down / restore | 기존 자원에 자동 실행 금지. 만든 격리 자원과 보호 대상 구분 |

API 값·NULL/0/NO_ROW·오류·BIGINT 표시·정상/결측 조합·390px/1280px·키보드 focus를 함께 검증합니다. 과거 API/화면/원본 대조 과정은 [deaed745의 기록](https://github.com/jinwooorp/RecycleYoungs/blob/deaed745b31fdcb16355ecc241f46b3dc2b46045/docs/project-status.md)에 있고 이번 실행 결과로 사용하지 않습니다. 캐시/네트워크/권한 때문에 검증을 못 했다면 원인과 미실행 범위를 보고합니다.
