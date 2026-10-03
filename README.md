# RecycleYoungs

공공데이터로 서울의 창업 후보지를 비교하는 팀 프로젝트입니다. 서비스 가칭은 **“여기 창업해도 돼?”**입니다.

현재는 Spring·React, PostgreSQL/PostGIS·Flyway 스키마 관리, CSV 검증·적재용 Python ETL이 준비되어 있습니다. **행정동 매출·점포 적재와 DB migration 검증을 마쳤고, React 조건 선택·결과 표를 실제 Vite 프록시 → Spring API → PostgreSQL로 연결했습니다. 공통 4개 분기 추세와 새 환경 재현은 다음 단계입니다.**

## 구성

```text
RecycleYoungs/
├── backend/               # Spring Boot API (Java 21)
├── frontend/              # React + TypeScript + Vite
├── etl/                   # Python CSV 검증·수동 배치 적재
├── sql/                   # DB 준비·기존 DB baseline 안내
├── data/
│   ├── manifest.json      # 원본 파일 해시·기간·건수
│   └── raw/dataset/       # CSV는 Git 제외, .gitkeep만 추적
├── docs/                  # 설계·개발 안내·데이터 목록·로드맵
├── legacy/csv_server/     # 이전 실험 코드, 활성 실행에서 제외
├── .env.example
├── docker-compose.yml
└── Makefile
```

| 영역 | 현재 기능 | 다음 작업 |
| --- | --- | --- |
| Backend | CORS, JdbcClient·Flyway, 목록·통계 API, 실제 DB/API 테스트 | 공통 분기 추세·재현 지원 |
| Frontend | 조건 선택·점포/추정매출 표, 로딩·오류·자료 없음, `/api` 프록시 | 공통 4개 분기 추세 |
| ETL | 입력 검증, 업종 매핑, 좌표 변환, 행정동 실제 적재·복구 검증 | 나머지 자료의 실제 DB 적재 검증 |
| DB | 7개 테이블, 공간·조회 인덱스, 서울시 업종 4개 매핑 | 적재 이력·스냅샷 버전·상권 경계 |

## 시작하기

필요 환경은 Java 21, Node.js 24 계열, Docker Compose입니다. 로컬 ETL을 실행하려면 Python 3.12 환경도 준비합니다.

1. 프로젝트 루트에서 로컬 설정을 준비합니다.

   ```sh
   cp .env.example .env
   ```

2. 전달받은 `dataset.zip`을 `data/raw/`에 압축 해제합니다. ZIP 내부의 `dataset/` 폴더를 유지합니다. 현재 작업 폴더에는 CSV 6개가 이미 배치되어 있습니다. GitHub에서 새로 받은 환경에는 `.gitkeep`만 있으므로 원본을 별도로 확보해야 합니다.

3. DB를 시작합니다. 이 명령은 ETL을 실행하지 않습니다.

   ```sh
   make db
   ```

4. Spring 서버 없이 스키마를 준비합니다. 새 DB는 `db-migrate`로 V1부터 적용합니다. `db-baseline`은 V1과 동일하다고 검증된 기존 DB의 일회성 편입에만 사용하며 `CONFIRM_BASELINE=verified-v1`이 없으면 실행을 거부합니다([baseline 안내](sql/README.md)). 현재 검증된 개발 DB는 baseline 1 편입을 마쳤습니다.

   ```sh
   make db-migrate
   ```

5. DB에 연결하지 않고 CSV를 검증합니다.

   ```sh
   make etl-validate
   ```

6. 처음에는 공간 좌표가 필요 없는 **행정동 매출·점포 통계**부터 적재합니다. `make etl`은 적재 전에 migration 상태를 확인·적용합니다.

   ```sh
   make etl ETL_ARGS="--only store_stats_dong sales_dong"
   ```

상권 좌표까지 적재하려면 원천 좌표계 메타데이터를 확인하고 `.env`의 `AREA_SOURCE_CRS`를 지정합니다. CSV 자체에는 좌표계가 기록되어 있지 않습니다. 선택한 작업들은 하나의 트랜잭션으로 처리하며 성공 시 반영됩니다.

Spring과 React는 각각 별도 터미널에서 실행합니다. Spring 실행 전 `.env`와 같은 `DB_PASSWORD`를 셸·IDE 환경에 지정합니다. DB 기본값을 바꿨다면 나머지 `DB_*`도 맞춥니다([환경 설정](docs/development.md#설정)).

```sh
make backend
```

```sh
cd frontend
npm ci
npm run dev
```

React는 `http://localhost:5173`, Spring은 `http://localhost:8080`을 사용합니다. React는 `/api` 프록시로 조회 API 4개를 호출합니다. 행정동·업종·분기를 선택하고 조회하기를 누르면 점포·추정매출 표가 표시됩니다. 실행·테스트와 자료 없음 표시는 [Frontend 안내](frontend/README.md)를 확인합니다.

## 문서

- [프로젝트 분석·정리 기록](docs/project-status.md): 전체 구현 상태와 이번 검증 결과
- [개발·검증 안내](docs/development.md): 실행 명령, 환경 변수, Git 관리
- [아키텍처와 분석 정책](docs/architecture.md): 역할, 공간·기간·점수 기준
- [데이터 목록](docs/data-catalog.md): 실제 파일, 연결 검사, 출처와 한계
- [구현 로드맵](docs/roadmap.md): 현재 완료 항목과 다음 단계
- [행정동 API 계약](docs/api-contract.md): 목록·통계 조회, 식별자·결측·오류·metadata 범위
- [ETL 안내](etl/README.md): 입력 검증, 선택 적재, 테스트
- [DB 스키마 안내](sql/README.md): 초기화와 마이그레이션 전환
- [이전 코드 보존 안내](legacy/README.md): 기존 실험 프로젝트

첫 목표는 **행정동 2~3곳·카페·공통 분기 하나의 매출과 점포 통계를 ETL → DB → Spring → React로 연결하는 것**입니다. 이후 상권 경계·지도·경쟁 점포·인구·점수 기능을 순서대로 확장합니다.
