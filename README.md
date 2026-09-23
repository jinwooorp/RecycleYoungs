# RecycleYoungs

공공데이터를 바탕으로 서울의 창업 후보지를 비교하는 팀 프로젝트입니다. 사용자가 지도에서 위치와 업종, 분석 반경을 선택하면 주변 경쟁 점포와 상권 지표를 조회하고, 설명 가능한 규칙으로 만든 창업 적합도와 근거를 보여주는 것을 목표로 합니다.

서비스 가칭은 **“여기 창업해도 돼?”**입니다. 타깃 고객의 연령대도 분석 조건으로 고려하되, 실제 데이터에서 연령·시간대별 값을 확보할 수 있는지 먼저 확인합니다.

> 현재는 기본 개발 환경을 만든 단계입니다. 분석 API, 실제 공공데이터 적재, 서비스 화면은 아직 구현되지 않았습니다. 아래 체크리스트는 완료한 작업과 앞으로의 작업을 함께 관리합니다.

## 현재 구성과 원칙

- [x] `backend/`: Spring Boot API 프로젝트 생성
- [x] `frontend/`: React + TypeScript + Vite 프로젝트 생성
- [x] `frontend/`의 `/api` 개발 프록시와 `backend/`의 CORS 설정 추가
- [x] `csv_server/`에 PostgreSQL + PostGIS용 Docker Compose 초안 생성
- [ ] 실제 데이터와 DB 스키마를 확정하고 API부터 화면까지 연결

현재 `csv_server/data/raw/stores.csv`는 Git에 추적되는 소규모 샘플입니다. 실제 공공데이터 원본과 정제 파일은 별도로 Git에서 제외해야 합니다. `csv_server/scripts/import-popilation.ts`는 빈 파일이고, `package.json`의 `import:population` 명령이 가리키는 파일명과도 다릅니다.

주 실행 구조는 **`frontend/` → `backend/` → PostgreSQL/PostGIS**입니다. `csv_server/`는 CSV 적재 작업과 DB 개발 설정을 위한 공간으로 활용합니다. 그 안의 `apps/api`, `apps/web`은 기존 실험 코드이며, 서비스 API와 화면을 새로 만드는 위치로 사용하지 않습니다. 최상위 폴더를 `apps/` 형태로 옮기지 않습니다.

공공 CSV는 사용자 요청마다 읽지 않고 미리 검증·정제하여 DB에 적재합니다. 좌표가 있는 점포의 반경 통계와 상권·행정동 단위 집계는 서로 다른 공간 단위이므로, 결과 화면에 각 지표의 기준 지역·분기·출처를 표시합니다.

## 폴더 구조: 현재와 목표

아래의 **현재** 트리는 2026-09-23 기준 실제 프로젝트에서 주요 소스만 추린 것입니다. `node_modules/`, 빌드 결과, Gradle 파일 등은 생략했습니다. **목표** 트리는 최상위 `backend/`, `frontend/`, `csv_server/`를 그대로 두고 추가할 폴더를 `+`로 표시했습니다. 목표 트리에 적힌 새 폴더는 아직 생성되지 않았습니다.

### 현재

```text
RecycleYoungs/
├── backend/
│   ├── src/main/java/com/example/backend/
│   │   ├── BackendApplication.java       # Spring Boot 시작점
│   │   └── WebConfig.java                # CORS 설정
│   ├── src/main/resources/application.yaml
│   └── src/test/java/.../BackendApplicationTests.java
├── frontend/
│   ├── src/
│   │   ├── App.tsx                       # Vite 기본 화면
│   │   └── assets/                       # 기본 이미지
│   └── vite.config.ts                    # /api → localhost:8080 프록시
├── csv_server/
│   ├── docker-compose.yml                # PostGIS DB 정의
│   ├── data/raw/stores.csv               # Git 추적 중인 소규모 샘플
│   ├── scripts/
│   │   ├── import-stores.ts              # 임시 점포 적재 코드
│   │   ├── import-sales.ts               # 매출 적재 미완성
│   │   └── import-popilation.ts          # 빈 파일, 이름 오타
│   └── apps/                             # 기존 실험 코드
│       ├── api/                          # Next.js
│       └── web/                          # 별도 Vite 화면
└── README.md
```

### 목표

```text
RecycleYoungs/
├── backend/                               # 서비스 API는 이곳에 구현
│   ├── src/main/java/com/example/backend/
│   │   ├── BackendApplication.java        # 기존
│   │   ├── WebConfig.java                 # 기존 CORS 설정
│   │   ├── analysis/          +           # 요청·응답, 점수와 근거
│   │   ├── commercial/        +           # 상권·분기 통계 조회
│   │   ├── store/             +           # 점포 공간 조회, 업종 매핑
│   │   └── common/            +           # 공통 검증·오류 처리
│   ├── src/main/resources/
│   │   ├── application.yaml               # 기존, DB 설정 추가
│   │   └── db/migration/      +           # PostGIS·테이블 변경 이력
│   └── src/test/                          # 기존, 분석 테스트 추가
├── frontend/                              # 서비스 화면은 이곳에 구현
│   ├── src/
│   │   ├── App.tsx                        # 기존 기본 화면 교체
│   │   ├── api/               +           # Spring API 호출·응답 타입
│   │   ├── components/        +           # 공통 UI
│   │   └── features/          +
│   │       ├── map/           +           # 위치 선택·점포 지도
│   │       ├── analysis/      +           # 조건 입력·분석 결과
│   │       └── comparison/    +           # 후보지 3곳 비교
│   └── vite.config.ts                    # 기존 /api 프록시 유지
├── csv_server/                            # ETL과 로컬 DB 개발 설정
│   ├── docker-compose.yml                # 기존, 설정 검증·보완
│   ├── data/
│   │   ├── raw/                           # 기존 샘플과 실제 원본 분리
│   │   └── processed/        +           # 정제 중간 파일, Git 제외
│   ├── scripts/                           # 기존 스크립트 정비
│   │   ├── import-stores.ts
│   │   ├── import-sales.ts
│   │   └── import-population.ts  +        # 파일명 오타 수정 후 구현
│   └── apps/                             # 기존 실험 코드, 주 실행 경로 아님
│       ├── api/
│       └── web/
└── README.md
```

| 영역 | 현재 | 완성 방향 |
| --- | --- | --- |
| `backend/` | 시작점·CORS·기본 테스트 | Spring API, PostGIS 조회, 점수 계산, 마이그레이션 |
| `frontend/` | Vite 기본 화면·API 프록시 | 지도, 분석 조건·결과, 차트, 후보지 비교 |
| `csv_server/data/` | Git에 추적된 샘플 CSV 1개 | 실제 원본·중간 파일을 Git에서 제외하고 적재 |
| `csv_server/scripts/` | 점포 임시 코드, 매출 미완성, 인구 빈 파일 | 재실행 가능한 점포·매출·인구 ETL |
| `csv_server/apps/` | Next.js API·별도 Vite 화면 실험 코드 | 유지하되 주 서비스의 구현·실행 경로에서 제외 |

## 구현 체크리스트

### 1. 데이터 확보와 기준 확정

- [ ] 소상공인시장진흥공단 상가(상권)정보와 서울시 상권분석의 상권 영역·업종별 매출·점포·유동·상주·직장인구 데이터 파일, 이용 조건, 기준 기간 확인
- [ ] 개·폐업, 상권변화지표, 연령·시간대별 인구, 지하철·버스·학교·병원 등 집객시설 자료의 확보 가능성 확인
- [ ] 각 CSV의 열 이름, 인코딩, 좌표계, 공간 단위, 분기, 금액·인구 단위 및 누락률 기록
- [ ] MVP 업종 3~5개와 원본 데이터의 업종 코드 매핑표 확정
- [ ] 실제 데이터로 서울 후보지 2~3곳을 수작업 검산해 구현 가능 지표 확정
- [ ] 원본·중간 CSV 및 DB 비밀번호를 Git에서 제외하고 팀용 환경 변수 예시 작성
- [ ] 개발 기간에는 수동 CSV 적재 1회를 기준으로 데이터 갱신일을 기록

### 2. DB와 적재 과정

- [ ] PostGIS 컨테이너 기동과 Spring DB 연결 확인
- [ ] 점포 좌표, 상권 경계, 업종·분기별 통계 테이블 및 공간 인덱스 설계
- [ ] `csv_server/scripts/`의 임시 접속 정보와 샘플 테이블 의존성을 제거하고 실제 CSV에 맞춰 적재
- [ ] 인구 적재 스크립트의 파일명·npm 명령 불일치를 고치고 매출·인구 적재 로직 완성
- [ ] 재실행 가능한 적재, 중복·좌표 오류 검사, 적재·제외 건수 로그 작성
- [ ] 점포 반경 조회와 상권 연결 방식 검증

### 3. Spring API와 분석 로직

- [ ] 업종 목록과 데이터 기준일을 반환하는 API 작성
- [ ] 지도 범위 또는 분석 반경의 경쟁 점포 조회 API 작성
- [ ] `POST /api/analysis` 구현: 위도·경도, 업종, 반경(300/500/1000m), 타깃 연령대 입력 검증
- [ ] 경쟁강도(동일 업종 점포 수·비율·밀집도), 시장수요(인구·업종별 추정매출), 성장성(분기 변화·개폐업), 고객 적합도(연령·시간대), 접근성(교통·집객시설)의 계산식과 비교 기준 문서화
- [ ] 초안 가중치인 수요 30%·경쟁 25%·성장 20%·고객 15%·접근성 10%를 실제 데이터로 검토하고 점수 버전 관리
- [ ] 항목별 점수, 종합점수, 원지표, 장점·위험요소, 최종 판단 문장, 근거, 출처·기준 분기를 함께 반환
- [ ] 데이터가 없는 항목을 임의의 점수로 채우지 않고 결측 상태로 반환
- [ ] 핵심 공간 조회와 점수 계산에 대한 자동 검증 추가

분석 API의 초기 입력 형태는 아래와 같이 잡고, 실제 업종 코드와 타깃 연령대 형식은 데이터 확인 후 확정합니다. 결과는 0~100점의 종합·항목별 점수와 근거를 목표로 합니다.

```json
{
  "latitude": 37.5446,
  "longitude": 127.0557,
  "radius": 500,
  "industry": "카페",
  "targetAge": ["20", "30"]
}
```

### 4. React 화면과 후보지 비교

- [ ] Kakao Maps 또는 Naver Maps 중 지도 SDK 하나를 선택해 서울 지도와 후보 위치 선택 구현
- [ ] 업종·반경·타깃 연령대 선택 후 `/api/analysis` 호출 및 로딩·오류 상태 표시
- [ ] 경쟁 점포 지도 표시, 항목별 점수·원지표·근거 문장 시각화
- [ ] Apache ECharts 또는 Recharts 중 차트 도구 하나를 선택해 지표와 추세 표시
- [ ] 동일 업종·반경·기준 분기로 후보지 최대 3곳을 나란히 비교
- [ ] 모바일 화면과 지도 SDK 키의 환경 변수 설정 확인

### 5. 결과 검증과 시연 준비

- [ ] 반경별 점포 수, 상권 연결, 최근 분기·누락 데이터 사례를 실제 자료와 대조
- [ ] 점수 정규화·가중치·버전을 고정하고 지역별 결과가 설명 가능한지 검토
- [ ] 데이터 출처·갱신 시점·공간 단위 및 추정치의 한계를 화면과 문서에 표시
- [ ] 팀원이 같은 절차로 DB 적재와 서버 실행을 재현할 수 있도록 실행 방법 작성
- [ ] 성수동 등 실제 후보지의 분석·비교 시나리오로 최종 시연

## MVP 범위와 후순위

**MVP:** 서울, 업종 3~5개, 확보 가능한 최근 4~8개 분기, 반경 300m·500m·1km, 경쟁 점포 지도, 근거가 있는 분석 결과, 후보지 최대 3곳 비교. 지표를 제공할 수 없는 데이터가 있다면 결과에 그 한계를 명시합니다.

**후순위:** 지역에 맞는 업종 자동 추천, AI/머신러닝 예측, 실시간 공공데이터 동기화, 전국 확대, 정교한 수익 예측. 먼저 실제 CSV로 재현 가능한 분석을 완성합니다.

## 현재 개발 환경 실행

현재는 API와 DB 연결이 아직 없으므로 아래 명령으로 실행하면 기본 프론트엔드 화면과 Spring Boot 골격만 확인할 수 있습니다. 백엔드와 프론트엔드는 각각 별도 터미널에서 실행합니다.

```sh
cd backend
./gradlew bootRun
```

```sh
cd frontend
npm ci
npm run dev
```

프론트엔드는 `http://localhost:5173`, 백엔드는 `http://localhost:8080`을 사용합니다. 개발 중 프론트엔드의 `/api` 요청은 Vite 프록시가 백엔드로 전달합니다. 실제 데이터 분석은 위 체크리스트의 DB 적재와 API 구현 이후에 가능합니다.
