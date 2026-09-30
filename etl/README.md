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

- 서울시 업종 네 개(CAFE, KFOOD, PUB, HAIR)를 연결합니다. GYM과 소상공인 코드 매핑은 미확정입니다.
- 개별 점포의 `industry_id`는 매핑 확정 전 NULL로 저장합니다.
- 점포·상권 대표 정보는 현재 입력으로 교체하고 통계는 2025년 연간 자료를 갱신합니다. 4개 분기가 모두 있는 입력만 처리합니다. 선택한 작업 전체의 실패 시 기존 상태를 유지합니다.
- 파일 입력 검사·트랜잭션 보호와 DB 건수·값의 일치는 별도 검증입니다. 실제 적재·재실행은 PostgreSQL 환경에서 확인해야 합니다.
- 출처·적재 이력·버전의 DB 테이블과 증분 스냅샷 이력은 아직 없습니다.
- 상권 내부 판별·지도 반경·인구·점수 계산은 이 배치의 현재 기능이 아닙니다.

## 테스트

프로젝트 루트에서 실행합니다.

```sh
make check-etl PYTHON="$(pwd)/etl/.venv/bin/python"
```

테스트는 입력 검증, NULL 전송, 선택 실행과 실패 복구 경계를 확인합니다. 실제 DB 검증과 후속 기능은 [로드맵](../docs/roadmap.md)을 확인합니다.
