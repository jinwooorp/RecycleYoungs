# Python ETL

공공데이터 CSV를 검증하고 PostgreSQL/PostGIS에 미리 적재하는 수동 배치입니다. 원본 다운로드·스케줄러·서비스 API 역할은 아직 없습니다.

## 입력

입력 위치는 프로젝트 루트의 `data/raw/dataset/`입니다. 원본 CSV는 Git에서 제외하며 파일 목록·해시·기간은 [manifest](../data/manifest.json)와 [데이터 목록](../docs/data-catalog.md)에 기록합니다.

| 작업 이름 | 입력 | 저장 테이블 |
| --- | --- | --- |
| `commercial_areas` | 서울시 영역-상권 | `commercial_areas` |
| `store_stats_dong` | 서울시 점포-행정동 2025년 | `store_stats_dong` |
| `sales_dong` | 서울시 추정매출-행정동 2025년 | `sales_dong` |
| `sales_commercial_area` | 서울시 추정매출-상권 2025년 | `sales_commercial_area` |
| `stores` | 소상공인 점포 서울 202606 | `stores` |

서울시 파일은 CP949, 소상공인 파일은 UTF-8-SIG로 읽습니다. `길단위인구-서울시`는 서울시 전체 집계이므로 위치별 분석 입력에서 제외하며 원본은 보존합니다.

## Docker 실행

프로젝트 루트에서 실행합니다.

```sh
make etl-validate
make db
make etl ETL_ARGS="--only store_stats_dong sales_dong"
```

검증 명령은 DB를 시작하거나 연결하지 않습니다. 실제 적재는 선택한 작업을 하나의 트랜잭션으로 처리하고, 실패하면 해당 실행의 DB 변경을 되돌립니다. 기본 선택은 5개 작업 전체입니다.

상권 좌표 적재는 원천 메타데이터로 좌표계를 확인한 뒤 `.env`의 `AREA_SOURCE_CRS`를 지정해야 합니다. 원본 CSV는 X/Y와 면적·대표 지점을 제공하며 Polygon 경계는 포함하지 않습니다. CRS가 없는 상태에서 기본값을 추측해 변환하지 않습니다.

전체 적재 준비가 끝나면 `make etl`을 실행합니다. 기존 데이터를 교체하는 작업이므로 데이터 출처·선택 작업·DB 상태를 확인한 뒤 실행합니다.

## 로컬 실행

Python 3.12 환경에서 의존성을 설치합니다.

```sh
python3.12 -m venv etl/.venv
etl/.venv/bin/python -m pip install -r etl/requirements.txt
cd etl
.venv/bin/python -m app.main --validate-only
.venv/bin/python -m app.main --only store_stats_dong sales_dong
```

기본 입력 위치는 실행 디렉터리와 무관하게 프로젝트의 `data/raw/dataset/`입니다. `DATA_DIR` 또는 `--data-dir`로 다른 원본 폴더를 지정할 수 있습니다. 로컬 DB 접속은 `DB_HOST`(기본 localhost), `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` 환경 변수를 사용합니다. `.env`는 로컬 Python에서 자동으로 로드되지 않습니다.

동일한 파일명이 여러 개 검색되면 임의로 첫 파일을 고르지 않고 오류를 냅니다. 새 스냅샷을 여러 폴더에 보관할 때 실행 입력 경로를 명시하세요.

## 구현과 제약

공통 DB 연결·타입 정리·입력 검사·적재를 공유하고 자료별 모듈을 분리합니다. 개별 점포는 청크 단위로 읽어 전체 파일을 한 번에 메모리에 올리지 않습니다.

- 서울시 업종 네 개(CAFE, KFOOD, PUB, HAIR)를 연결합니다. stores는 DB에 등록된 SEMAS tuple-key mapping만 사용하며 `SEMAS/I21201 → CAFE`를 적용합니다. 다른 SEMAS 업종을 추측하거나 새 mapping을 만들지 않습니다.
- stores는 caller transaction에서 mapping을 한 번 읽고, CAFE 존재 및 SEMAS/I21201의 CAFE id 일치를 TRUNCATE 전에 검사합니다. 미매핑/빈 code는 industry_id NULL이며 SEOUL-only code를 연결하지 않습니다. KSIC/상호명 filter는 없습니다.
- 점포·상권 대표 정보는 현재 입력으로 교체하고 통계는 2025년 연간 자료를 갱신합니다. 4개 분기가 모두 있는 입력만 처리합니다. 선택한 작업 전체의 실패 시 기존 상태를 유지합니다.
- 파일 입력 검사·트랜잭션 보호와 DB 건수·값의 일치는 별도 검증입니다. 실제 적재·재실행은 PostgreSQL 환경에서 확인해야 합니다.
- 공간 경계는 V2 version/provenance와 아래 별도 ETL로 관리합니다. CSV 통계/점포의 일반 metadata·증분 스냅샷 이력은 후속 범위입니다.
- 상권 내부 판별·지도 반경·인구·점수 계산은 이 배치의 현재 기능이 아닙니다.

## 테스트

프로젝트 루트에서 실행합니다.

```sh
make check-etl PYTHON="$(pwd)/etl/.venv/bin/python"
```

테스트는 입력 검증, NULL 전송, 선택 실행과 실패 복구 경계를 확인합니다. 실제 DB 검증과 후속 기능은 [로드맵](../docs/roadmap.md)을 확인합니다.

## stores fresh 적재와 기존 populated DB 보존 — 8-B2

Fresh 경로는 **empty DB → 실제 Flyway V1/V2/V3 → stores full loader**입니다. V3에서는 빈 stores의 backfill이 0건이고, 이후 CSV ETL이 `('SEMAS', source_small_category_code)`로 industry_id를 materialize합니다. UTF-8-SIG·문자열/NULL 정리·청크·기존 COPY column 순서·POINT4326 생성은 유지합니다. `etl_stores.run()`은 새 connection이나 commit을 만들지 않으며 기존 `app.main`의 선택 CSV 전체 transaction에 참여합니다.

기존 populated 경로는 **V1 populated → V2 → V3 최소 backfill**입니다. V3가 기존 I21201+NULL만 갱신합니다. **기존 stores를 보존하려고 full loader를 재실행하지 않습니다.** 현재 full loader는 `TRUNCATE stores RESTART IDENTITY`로 snapshot을 교체하므로 이전 row가 제거되고 surrogate id가 재발급/재사용될 수 있습니다. 재실행 동등성은 source_store_id·원본 속성·location·industry code를 기준으로 보며 id 동일성을 보장하지 않습니다. 증분/upsert 적재는 별도 설계입니다. 기존 개발 DB 적용/backup·대규모 보존 비교는 8-C이며 이번 검증 대상이 아닙니다.

stores 통합 테스트는 실제 V1/V2/V3가 적용된 격리 DB의 `STORES_TEST_DSN`을 명시합니다. DB 이름은 `recycleyoungs_stores_test_` prefix를 검사하지만 prefix만으로 실제 격리를 보장하지 않습니다. 실행자는 별도 container/internal network·tmpfs·기존 volume 미사용을 먼저 확인합니다. `STORES_REAL_DSN`과 read-only `STORES_REAL_CSV`를 함께 지정하면 SHA가 고정된 2026-06 전체 적재/재실행 검사를 수행하며, 이 DB의 stores는 처음에 비어 있어야 합니다. 미지정 시 해당 검사는 skip되고 fixture 결과를 전수 검증으로 주장하지 않습니다.

## 별도 Polygon ETL — 8-B1

`python -m app.spatial_main`은 CSV `app.main`/기본 5개 job과 독립적입니다. **기본은 검증만**이며 `--help`·`--validate-only`는 DB에 접속하지 않습니다. 선택한 종류의 ZIP/report 경로를 모두 명시해야 합니다. 실제 적재는 `--load`와 `--dsn`을 함께 지정해야 하며 `.env`나 기존 CSV DB 기본값을 사용하지 않습니다. `make etl`을 Polygon 실행 경로로 사용하지 않습니다.

Python 3.12에서 갱신된 requirements를 설치하고 `etl/`에서 실행합니다. 행정동:

```sh
python -m app.spatial_main --only admin --validate-only \
  --admin-zip '../data/raw/spatial/서울시 상권분석서비스(영역-행정동).zip' \
  --admin-report ../data/raw/spatial/validation-results.json
```

상권은 전체 품질 report와 6건 repair acceptance report가 모두 필요합니다.

```sh
python -m app.spatial_main --only commercial --validate-only \
  --commercial-zip ../data/raw/spatial/stage4-research-20261007/official-commercial-area.zip \
  --commercial-report ../data/raw/spatial/stage56-validation-20261007/results.json \
  --commercial-repair-report ../data/raw/spatial/six-repair-validation-20261007/results.json
```

두 종류를 순차 실행하려면 `--only admin commercial`과 위의 입력 옵션 전체를 지정합니다. 명시적인 적재에서는 `--validate-only`를 `--load --dsn "$SPATIAL_DSN"`으로 바꿉니다. DSN은 호출자가 확인한 대상 DB의 값을 명시합니다. 현재 기존 개발 DB 적용은 8-C의 별도 backup/보존 검증 절차를 따른 뒤 수행합니다.

Docker도 동일한 Dockerfile을 사용합니다. 새 image를 빌드한 뒤 CSV entrypoint를 명시적으로 바꿉니다. 원본은 read-only로 mount합니다.

```sh
docker build -t recycleyoungs-spatial-etl etl
docker run --rm --network none --entrypoint python \
  -v "$(pwd)/data/raw/spatial:/sources:ro" recycleyoungs-spatial-etl \
  -m app.spatial_main --only admin --validate-only \
  --admin-zip '/sources/서울시 상권분석서비스(영역-행정동).zip' \
  --admin-report /sources/validation-results.json
```

검증된 입력은 `spatial_sources.py`의 고정 ZIP/member/report SHA로 한정합니다. report를 실행 중 새로 만들어 acceptance로 승인하지 않습니다. SHA가 다른 새 자료/검증은 별도 검토와 catalog/profile 변경이 필요합니다. ZIP/SHP를 추출·재저장·재압축하거나 원본을 수정하지 않습니다. CP949 ZIP 이름, UTF-8 strict DBF, 5181 PRJ, field/count/code/type/Z/M·unpaired shape/record를 검사합니다. DBF의 우측 저장 padding 외에 code/name normalization을 하지 않습니다.

425 행정동과 valid 상권 1644건은 repair 없이 MultiPolygon으로 포장합니다. 알려진 invalid 6건만 Shapely 2.1.2/GEOS 3.13.1의 `linework, keep_collapsed=True`를 사용하고 기존 index/source SHA/repair Polygon SHA·hole/경계/vertex를 대조합니다. 예상 밖 결과는 REVIEW_REQUIRED로 실패합니다. 저장 MultiPolygon SHA는 repair 직후 Polygon SHA와 구분합니다. 홍지문 raw 속성과 H5, 전체 B·historical UNRESOLVED를 유지합니다.

오프라인 출력의 `offline_base_profile_sha256`에는 DB 정보가 없습니다. 적재 때 실제 PostgreSQL/PostGIS/GEOS/PROJ version을 추가한 **전체 profile SHA**를 계산합니다. Python/pyshp/Shapely/GEOS/pyproj/PROJ와 ETL 구현 파일 SHA도 기록합니다. 실행 시각·DB id·물리 입력 경로는 identity에서 제외합니다. 논리 report 경로는 catalog의 고정 archive 상대 경로이며 실제 입력 위치가 바뀌어도 동일 bytes/profile이면 같은 identity입니다.

적재는 종류별 advisory lock과 한 transaction으로 INSERT→DB byte/hash/metadata 검사→READY-only UPDATE→이전 current 해제→새 current 활성화를 수행합니다. `loaded_at`은 V2 trigger가 생성합니다. 두 종류 전체를 단일 transaction이라고 보장하지 않습니다. READY 재실행은 모든 row/metadata를 비교하여 동일하면 id/loaded_at/hash를 유지하고 필요한 current 전환만 수행합니다. 불일치/PENDING은 실패하며 upsert/삭제로 숨기지 않습니다. 기존 V1 table·대표 POINT·stores는 이 코드에서 쓰지 않습니다.

합성 unittest는 raw 파일 없이 실행됩니다. 실제 ZIP 검사는 `SPATIAL_REAL_SOURCE_ROOT`를 명시할 때만 수행합니다. DB 테스트는 실제 V1/V2/V3가 적용되고 공간 table이 비어 있는 **격리 DB**의 `SPATIAL_TEST_DSN`을 명시하며 DB 이름은 `recycleyoungs_spatial_test_`로 시작해야 합니다. 이름 prefix만으로 격리를 보장하지 않으므로 실행자는 별도 container/network·tmpfs·원본 read-only·기존 volume 미사용을 먼저 확인합니다. 두 환경 변수가 없으면 해당 검사는 skip되고 실제 자료/DB 완료로 주장하지 않습니다.

```sh
cd etl
python -m unittest discover -s tests -v
```

## 8-C1 전체 격리 통합 검증과 8-C2 계획

[8-C1 결과·재현/streaming checksum 규칙](../docs/integration-validation-8c1.md)은 Fresh V1→V2→V3→CSV/stores→Polygon과 Populated V1 전체 적재→백업/새 격리 DB 복원→V2/V3 최소 backfill→Polygon-only를 구분합니다. 검증 worker는 `tests/integration_check.py`, `tests/integration_spatial.py`이며 actual Docker isolation proof와 명시적 DSN을 요구합니다. 기본 DB 접속값이 없고, 개발 DB·localhost/hostaddr/service override(명시적 DSN 및 ambient libpq 환경)·Python `-O`를 거부합니다. V1 NULL stores fixture는 전용 격리 V1-only/empty stores에서만 사용하며 production/backfill 경로가 아닙니다.

검사 script의 테스트 DB prefix만으로 격리를 판단하지 않습니다. 실행 전과 매 Docker 명령 직전에 internal network·container ID·system identifier·tmpfs·host port/기존 volume 미사용·원본 read-only mount를 확인합니다. 백업·로그·snapshot·환경 driver는 저장소 밖 임시 경로에 둡니다. 기존 `make etl`이나 개발 DB를 통합 테스트 대상으로 사용하지 않습니다.

[8-C2 실행 계획](../docs/development-db-8c2-runbook.md)은 기존 개발 DB의 identity·Flyway/구조·전수 snapshot·실제 backup·격리 복원 검증을 모두 통과한 후에만 V2/V3와 Polygon-only를 수행하는 검토 문서입니다. 8-C1 성공은 개발 DB 적용 완료가 아닙니다.
