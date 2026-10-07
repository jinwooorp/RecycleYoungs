# 새 환경 Vertical Slice 재현

현재 보관 dataset과 저장소 코드만으로 **CSV → Python ETL → PostgreSQL/PostGIS → Spring API → React**의 행정동 단건 통계와 2025년 4분기 추세를 재현합니다. 검증 기준 commit은 `c8b7afa28e5f40d96bba2ec928be00de72b3dcea`입니다. 지도·상권 공간 분석·점수·Chart는 이 절차의 대상이 아닙니다.

## 준비물과 실행 기준

- Git, Java 21, Node.js 24 계열, Docker와 Docker Compose
- Python 3.12: 아래 ETL은 저장소 Dockerfile의 Python 3.12를 사용합니다. 파일 검산용 `python3` 또는 로컬 ETL 실행에는 Python 환경을 별도로 준비합니다.
- 팀 내부 전달 경로의 `dataset.zip` 또는 동일한 CSV 6개. **CSV는 GitHub에 없으므로 clone만으로 데이터가 생기지 않습니다.**
- 이미지·npm·Gradle 의존성을 처음 내려받을 네트워크와 충분한 디스크 공간

아래 명령은 macOS/Linux의 POSIX shell 기준입니다. `make`는 저장소 루트에서 실행합니다. Spring과 Vite는 별도 터미널에서 실행합니다. Docker/Gradle 다운로드 캐시는 사용할 수 있지만 기존 `.env`·node_modules·build·venv·DB volume을 복사하지 않습니다.

**이 PC에 `startup-analysis-postgres` 또는 기존 개발 DB volume이 있다면 일반 절차를 바로 실행하지 말고 [기존 DB가 있는 PC의 격리 검증](#기존-db가-있는-pc의-격리-검증)을 먼저 따릅니다.** Compose에 고정 container name이 있어 project name만 변경하면 충분하지 않습니다. 재현 실패 시 기존 DB 초기화나 production 코드 수정으로 우회하지 않습니다.

## 1. 저장소와 원본 준비

```sh
git clone https://github.com/jinwooorp/RecycleYoungs.git
cd RecycleYoungs
git rev-parse HEAD
git status --short
cp .env.example .env
```

검증 당시 HEAD는 위 기준 commit이고 working tree는 clean이었습니다. 더 최신 commit을 사용하면 해당 코드·계약 기준으로 다시 확인합니다. `.env`의 DB identity를 확인하고 새 DB용 비밀번호를 정합니다. 기존 volume을 재사용하면서 이름·계정을 바꾸지 않습니다.

ZIP의 `dataset/` 폴더를 유지해 `data/raw/dataset/`에 원본을 배치합니다. [데이터 목록](data-catalog.md)과 `data/manifest.json`의 파일명·크기·SHA-256을 확인합니다. 이 검사는 파일을 변경하지 않습니다.

```sh
python3 - <<'PY'
import hashlib, json
from pathlib import Path
manifest = json.loads(Path('data/manifest.json').read_text())
entries = manifest['datasets']
assert len(entries) == 6
assert len(list(Path('data/raw/dataset').glob('*.csv'))) == 6
for entry in entries:
    path = Path(entry['path'])
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b''):
            digest.update(chunk)
    assert path.stat().st_size == entry['bytes'], path
    assert digest.hexdigest() == entry['sha256'], path
    print(path.name, entry['bytes'], digest.hexdigest())
print('CSV 6개 manifest 일치')
PY
```

불일치·누락이면 적재하지 않습니다. 파일을 새로 받거나 출처·기간·hash 차이를 확인합니다. 첫 vertical slice 입력은 `서울시 상권분석서비스(점포-행정동)_2025년.csv`와 `서울시 상권분석서비스(추정매출-행정동)_2025년.csv`이며 CP949입니다.

## 2. 새 DB와 V1 SQL migration

기존 DB가 없는 새 PC에서는 `.env`의 기본 host port 5432를 사용합니다.

```sh
make db
make db-migrate
make db-info
```

새 DB에서는 **db-baseline을 사용하지 않습니다.** Flyway info는 version `1`, type `SQL`, state `Success`이고 pending migration이 없어야 합니다. `BASELINE`은 V1 구조를 별도로 대조한 기존 DB 편입에만 사용합니다([DB 안내](../sql/README.md)).

```sh
docker compose exec -T postgres sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1' <<'SQL'
BEGIN READ ONLY;
SELECT version, type, success FROM flyway_schema_history ORDER BY installed_rank;
SELECT postgis_version();
SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename IN ('industries','industry_mappings','commercial_areas',
    'store_stats_dong','sales_dong','sales_commercial_area','stores') ORDER BY tablename;
SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx_%' ORDER BY indexname;
SELECT i.code, m.source, m.source_code FROM industry_mappings m
  JOIN industries i ON i.id=m.industry_id ORDER BY i.code;
SELECT count(*) AS store_rows FROM store_stats_dong;
SELECT count(*) AS sales_rows FROM sales_dong;
COMMIT;
SQL
```

ETL 전의 두 통계는 0행이어야 합니다. V1은 프로젝트 테이블 7개·명시 index 8개·PostGIS와 내부 업종 5개를 생성합니다. 서울시 매핑은 CAFE/CS100010, HAIR/CS200028, KFOOD/CS100001, PUB/CS100009의 4개이며 GYM은 seed만 있고 미지원입니다. 빈 DB가 아니면 첫 적재를 진행하지 말고 접속 대상부터 확인합니다.

## 3. CSV 검사와 첫 ETL

```sh
make etl-validate
make etl ETL_ARGS="--only store_stats_dong sales_dong"
```

첫 명령은 `--no-deps`·`--validate-only`로 DB에 연결하지 않습니다. 현재 ETL은 5개 job 입력의 구조·복합 키·필수값·연간 4분기를 검사합니다. 길단위인구-서울시 CSV는 분석 대상에서 제외되어 ETL job이 없으며, 6개 파일 전체의 동일성은 앞의 manifest 검사로 확인합니다.

두 번째 명령은 migration 확인 후 **행정동 점포·매출 두 job만** 실행하고 하나의 transaction으로 commit합니다. 현재 ETL은 대상 연도 행을 삭제 후 재삽입하므로 접속 대상이 반드시 새 재현 DB인지 확인합니다. 상권 좌표계가 미확정이므로 전체 ETL을 첫 재현의 필수 조건으로 두지 않고 `AREA_SOURCE_CRS`도 추측하지 않습니다.

```sh
docker compose exec -T postgres sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1' <<'SQL'
BEGIN READ ONLY;
SELECT count(*), count(DISTINCT dong_code), array_agg(DISTINCT quarter_code ORDER BY quarter_code) FROM store_stats_dong;
SELECT count(*), count(DISTINCT dong_code), array_agg(DISTINCT quarter_code ORDER BY quarter_code) FROM sales_dong;
SELECT quarter_code, dong_code, source_industry_code, count(*) FROM store_stats_dong
  GROUP BY quarter_code, dong_code, source_industry_code HAVING count(*) > 1;
SELECT quarter_code, dong_code, source_industry_code, count(*) FROM sales_dong
  GROUP BY quarter_code, dong_code, source_industry_code HAVING count(*) > 1;
SELECT quarter_code, store_count, similar_store_count, opening_store_count, closing_store_count, franchise_store_count
  FROM store_stats_dong WHERE dong_code='11110515' AND source_industry_code='CS100010' ORDER BY quarter_code;
SELECT quarter_code, sales_amount, transaction_count, weekday_sales_amount, weekend_sales_amount
  FROM sales_dong WHERE dong_code='11110515' AND source_industry_code='CS100010' ORDER BY quarter_code;
COMMIT;
SQL
```

현재 보관 dataset 기준 기대값은 점포 **141,218행**, 매출 **67,113행**, 각각 행정동 **425개**·분기 **20251~20254**, 중복 key 0개입니다. 내부 surrogate id는 재적재마다 달라질 수 있어 비교 키로 쓰지 않습니다.

## 4. 원본과 대표값 검산

CP949 CSV에서 `기준_년분기_코드`·`행정동_코드`·`서비스_업종_코드`로 찾습니다. 청운효자동은 `11110515`, 카페 원본 코드는 `CS100010`입니다. [ETL 구현](../etl/app/etl_store_stats.py)·[매출 구현](../etl/app/etl_sales.py)의 다음 mapping을 사용합니다.

| API metric | 원본 열 | DB 열 |
| --- | --- | --- |
| storeCount | 점포_수 | store_count |
| similarStoreCount | 유사_업종_점포_수 | similar_store_count |
| openingStoreCount | 개업_점포_수 | opening_store_count |
| closingStoreCount | 폐업_점포_수 | closing_store_count |
| franchiseStoreCount | 프랜차이즈_점포_수 | franchise_store_count |
| estimatedSalesAmount | 당월_매출_금액 | sales_amount |
| transactionCount | 당월_매출_건수 | transaction_count |
| weekdayEstimatedSalesAmount | 주중_매출_금액 | weekday_sales_amount |
| weekendEstimatedSalesAmount | 주말_매출_금액 | weekend_sales_amount |

원본을 직접 확인하는 예입니다. `csv.DictReader`와 정수 변환을 사용하며 double/JavaScript Number로 비교하지 않습니다.

```sh
python3 - <<'PY'
import csv
from pathlib import Path
for name in ['서울시 상권분석서비스(점포-행정동)_2025년.csv',
             '서울시 상권분석서비스(추정매출-행정동)_2025년.csv']:
    with (Path('data/raw/dataset') / name).open(encoding='cp949', newline='') as source:
        rows = [row for row in csv.DictReader(source)
                if row['행정동_코드']=='11110515' and row['서비스_업종_코드']=='CS100010']
    for row in sorted(rows, key=lambda row: row['기준_년분기_코드']):
        print(name, row)
PY
```

| 분기 | 점포 수 | 추정매출(원) | 매출 건수 |
| --- | --- | --- | --- |
| 20251 | 114 | 4,535,266,422 | 302,642 |
| 20252 | 114 | 4,603,714,789 | 356,622 |
| 20253 | 115 | 4,195,134,430 | 293,013 |
| 20254 | 118 | 4,724,282,512 | 340,786 |

매출은 분기에 귀속된 원본 보고값이며 실제 매출·이익·성공 확률로 재해석하지 않습니다. NULL과 행 부재를 0으로 바꾸지 않습니다.

## 5. Backend 테스트와 Spring

Spring은 `.env`를 자동으로 읽지 않습니다. `.env`와 동일한 DB 값을 해당 터미널의 환경으로 전달합니다. 기본 설정을 유지한 새 PC의 예이며 비밀번호는 실제 지정값으로 바꿉니다.

```sh
export DB_HOST=localhost DB_PORT=5432 DB_NAME=startup_analysis DB_USER=app
export DB_PASSWORD='새-DB에-지정한-로컬-비밀번호'
export EXPECTED_STORE_STATS_ROWS=141218 EXPECTED_SALES_ROWS=67113
cd backend
./gradlew test
./gradlew dbTest
./gradlew bootRun
```

일반 test는 DB 없이 실행합니다. dbTest는 적재한 DB를 대상으로 실행하며 fixture 쓰기 테스트는 opt-in이 없으므로 skip되어야 합니다. `API_FIXTURE_TEST=true`를 설정하지 않습니다. Spring 로그의 접속 URL과 Flyway 상태가 준비한 DB에 해당하는지 확인합니다. 8080이 점유됐다면 기존 process를 종료하지 말고 별도 port와 임시 Vite proxy 설정으로 격리합니다.

## 6. 다섯 API와 React

다른 터미널에서 조회합니다.

```sh
curl -fsS http://localhost:8080/api/admin-dongs | python3 -m json.tool
curl -fsS http://localhost:8080/api/industries | python3 -m json.tool
curl -fsS http://localhost:8080/api/quarters | python3 -m json.tool
curl -fsS 'http://localhost:8080/api/admin-dong-stats?dongCode=11110515&industryCode=CAFE&quarterCode=20251' | python3 -m json.tool
curl -fsS 'http://localhost:8080/api/admin-dong-trends?dongCode=11110515&industryCode=CAFE' | python3 -m json.tool
```

lookup은 행정동 425개·지원 업종 CAFE/HAIR/KFOOD/PUB·분기 20251~20254입니다. stats는 점포 114와 JSON string `"4535266422"`·`"302642"`를 반환합니다. trend는 항상 네 item을 오름차순으로 반환하고 위 표의 값과 일치해야 합니다. trend query에는 quarterCode를 보내지 않습니다([API 계약](api-contract.md)).

```sh
cd frontend
npm ci
npm run lint
npm run test
npm run build
npm run dev
```

저장소 루트에서 새 터미널을 열고 위 명령을 실행합니다. `http://localhost:5173`의 React에서 세 조건을 선택하고 조회합니다. 기존 Vite `/api` proxy가 Spring 8080으로 전달합니다. 다른 서비스가 port를 점유하면 임의 종료하지 않습니다.

| 선택(상세 분기 20251) | 상세 | 2025년 4분기 추세 |
| --- | --- | --- |
| 청운효자동 / 카페 | 점포 114개·추정매출 4,535,266,422원·매출 302,642건 | 점포 114/114/115/118, 매출은 위 표와 일치 |
| 면목5동 / 카페 | 점포 17개·매출 자료 없음 | 점포 17/16/16/15, 매출 네 분기 자료 없음 |
| 신정6동 / 주점 | 양쪽 자료 없음 | 양쪽 네 분기 자료 없음, 고정 축 유지 |

면목5동은 `11260550`/CAFE, 신정6동은 `11470670`/PUB(원본 `CS100009`)입니다. 유효 조건의 NO_ROW는 HTTP 200이고 오류 alert가 아니어야 합니다. 390px·1280px에서 페이지 가로 넘침 없음, 모바일 표 내부 스크롤, native select·한국어 줄바꿈·console error/warning 없음을 확인합니다.

최소 완료 증거는 청운효자동/CAFE/20251의 **CSV = DB = stats API = trend 첫 item = React**이며, 네 분기 점포 수·추정매출도 모두 연결해 대조합니다. API나 ETL 성공 로그만으로 브라우저 연결을 완료했다고 판단하지 않습니다.

## 기존 DB가 있는 PC의 격리 검증

이 절차는 같은 개발 PC에서 기존 DB를 보호하기 위한 선택 절차입니다. 기존 DB가 없는 팀원 PC의 필수 조건은 아닙니다.

1. `docker ps -a`, `docker volume ls`, 기존 container의 ID·mount·host port를 기록합니다. 실행 중이면 READ ONLY SELECT로 행 수·checksum·Flyway 이력을 기록할 수 있으며 중지 상태라면 이 검증 때문에 시작하지 않습니다.
2. `git clone --no-hardlinks <현재 저장소 절대 경로> <새 임시 경로>`로 독립 clean clone을 만듭니다. HEAD를 확인하고 기존 node_modules·build·venv·`.env`가 없는지 확인합니다. CSV는 hash 검증 후 읽어서 복사합니다.
3. 빈 host port(검증에서는 55432), 고유 project·container 이름을 정합니다. 기존 process를 종료하거나 기존 volume을 재사용하지 않습니다.

새 clone에서만 설정하는 예입니다. project 이름은 실행마다 고유하게 정하고, 해당 named volume이 이미 있으면 새 이름을 선택합니다.

```sh
export COMPOSE_PROJECT_NAME=recycleyoungs-repro-unique-run
export COMPOSE_FILE=docker-compose.yml:.repro-compose.override.yml
cat > .env <<'ENV'
DB_NAME=recycleyoungs_repro
DB_USER=app
DB_PASSWORD=repro_local_only
DB_PORT=55432
AREA_SOURCE_CRS=
STORE_CHUNK_SIZE=50000
ENV
cat > .repro-compose.override.yml <<YAML
services:
  postgres:
    container_name: ${COMPOSE_PROJECT_NAME}-postgres
  etl:
    container_name: ${COMPOSE_PROJECT_NAME}-etl
YAML
docker compose config
```

override의 목적은 고정 container name 격리뿐입니다. `docker compose config`는 로컬 비밀번호도 출력하므로 결과를 공개 채널에 그대로 붙이지 않습니다. postgres container·host port·project·실제 volume 이름이 모두 기존 환경과 다른지 확인한 뒤 앞의 `make db`부터 실행합니다. volume은 `${COMPOSE_PROJECT_NAME}_postgres_data`로 생성되며 `docker inspect`로 실제 mount를 확인합니다. ETL은 해당 project network의 postgres:5432에만 연결합니다.

Backend test/server 터미널에는 `DB_HOST=localhost`, `DB_PORT=55432`, `DB_NAME=recycleyoungs_repro`, `DB_USER=app`, 위 로컬 비밀번호를 **프로세스 환경으로** 지정합니다. Compose 설정만으로 Spring 환경이 바뀌지 않습니다. Spring startup URL이 5432의 기존 DB를 가리키면 중단합니다. 이번 검증은 8080·5173이 비어 있어 기존 Vite proxy를 그대로 사용했습니다. 재현용 override·`.env`·빌드 결과를 원 저장소로 복사하지 않습니다.

검증 후 기존 container ID·volume과 실행 중이었던 DB의 행 수·checksum·Flyway 이력을 다시 비교합니다.

## 종료와 검증 기록

Spring/Vite는 각 터미널에서 Ctrl+C로 종료합니다. 일반 개발 DB는 루트에서 `make db-stop`으로 중지하며 volume을 보존합니다. 격리 clone의 project·COMPOSE_FILE이 설정된 터미널에서는 `docker compose down`으로 검증 container/network만 종료할 수 있습니다. volume은 자동 삭제하지 않습니다. volume 삭제·DB 초기화는 이 재현 절차에 포함하지 않습니다.

2026-10-07 검증의 실제 환경·테스트 수·원본/DB/API/화면 대조·기존 DB 보존 결과는 [프로젝트 기록](project-status.md#2026-10-07-새-환경-vertical-slice-재현)에 남깁니다. 기능·migration·ETL·dependency 변경 없이 재현하는 기준입니다.
