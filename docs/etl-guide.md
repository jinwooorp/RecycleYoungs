# ETL 가이드

- [README의 상세 기술 문서 안내](../README.md#상세-기술-문서)

아래 검증 결과·수치·배치 ID는 기존 README에 기록된 2026년 10월 기준 검증 및 로컬 개발 DB 적재 이력입니다. 과거 검증 기록을 유지하며, 자치구 점포의 2026-10-31 실제 개발 DB 적용·적재 결과는 별도 절에 구분합니다. 입력 버전별 기대 건수와 공식 분류는 재실행 시 다시 확인합니다. 자치구 점포는 실제 CSV 전체 probe와 개발 DB 적재·API 대조를 완료했습니다. 다른 데이터셋은 이번 작업에서 재적재하지 않았습니다. DB 준비·환경변수·공통 품질 검사는 [개발 가이드](development.md)를 참고하세요.

ETL(수집·검증·변환·적재)의 원본 동일성은 체크섬(원본 내용에서 계산한 식별값)과 실제 DB 값·출처를 함께 대조합니다. 스테이징은 최종 반영 전에 데이터를 검증하는 임시 적재 영역이며, Upsert는 기본키 기준 추가·갱신을 뜻합니다.

## 목차

- [사용하는 공공 데이터](#사용하는-공공-데이터)
- [공공데이터 검증 현황](#공공데이터-검증-현황)
- [ETL 처리 방향](#etl-처리-방향)
- [설치 및 공통 실행](#설치-및-공통-실행)
  - [작업 디렉터리와 환경변수](#작업-디렉터리와-환경변수)
  - [설치와 도움말](#설치와-도움말)
- [자치구 추정매출 읽기 전용 검증](#자치구-추정매출-읽기-전용-검증)
- [자치구 점포 읽기 전용 검증](#자치구-점포-읽기-전용-검증)
- [행정동·자치구 경계 적재](#행정동자치구-경계-적재)
- [서비스 업종 기준 데이터 적재](#서비스-업종-기준-데이터-적재)
- [점포 통계 적재](#점포-통계-적재)
- [추정매출 통계 적재](#추정매출-통계-적재)
- [유동인구 통계 적재](#유동인구-통계-적재)
- [카페 API 수집·적재](#카페-api-수집적재)

## 사용하는 공공 데이터

[공공데이터포털](https://www.data.go.kr/index.do)과 [서울 열린데이터광장](https://data.seoul.go.kr/)에서 제공하는 공공데이터를 활용합니다.

아래 핵심 공공데이터 5종은 CSV·Shapefile 또는 API를 이용한 기본 검증을 완료했습니다. 영역-행정동 경계, 서비스 업종 기준 데이터와 점포·추정매출·유동인구 통계를 ETL로 로컬 개발 DB에 실제 적재했습니다. 카페 ETL도 실제 API 검증·21,996건 적재·재실행 `SKIPPED` 확인을 완료했습니다. 서비스 연동·정기 갱신은 남아 있습니다.

### 핵심 데이터 (기본 검증 완료)

| 데이터                                                                               | 제공처               | 활용 목적                                         |
| ------------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------- |
| [상가(상권)정보 API](https://www.data.go.kr/data/15012005/openapi.do)                | 소상공인시장진흥공단 | 카페 위치, 업종 및 주변 경쟁 점포 확인            |
| [점포 - 행정동](https://data.seoul.go.kr/dataList/OA-22172/S/1/datasetView.do)       | 서울 열린데이터광장  | 지역별 점포 수, 개업·폐업 및 프랜차이즈 현황 분석 |
| [추정매출 - 행정동](https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do)   | 서울 열린데이터광장  | 카페 업종의 추정매출과 소비 동향 분석             |
| [길단위인구 - 행정동](https://data.seoul.go.kr/dataList/OA-22178/S/1/datasetView.do) | 서울 열린데이터광장  | 시간대·요일·연령대별 유동인구 분석                |
| [영역 - 행정동](https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do)       | 서울 열린데이터광장  | 행정동 경계 표시 및 선택 위치의 소속 지역 판정    |

### 추가 활용 검토 데이터

| 데이터                                                                                         | 제공처              | 활용 목적                               |
| ---------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------- |
| [상주인구 - 행정동](https://data.seoul.go.kr/dataList/OA-22183/S/1/datasetView.do)             | 서울 열린데이터광장 | 지역별 거주 인구 및 잠재 소비 환경 파악 |
| [직장인구 - 행정동](https://data.seoul.go.kr/dataList/OA-22184/S/1/datasetView.do)             | 서울 열린데이터광장 | 직장인 밀집 지역 및 평일 소비 환경 분석 |
| [집객시설 - 행정동](https://data.seoul.go.kr/dataList/OA-22169/S/1/datasetView.do)             | 서울 열린데이터광장 | 학교·병원 등 주변 시설 환경 파악        |
| [상권변화지표 - 행정동](https://data.seoul.go.kr/dataList/OA-15575/S/1/datasetView.do)         | 서울 열린데이터광장 | 사업체 평균 영업기간과 지역 변화 참고   |
| [영역 - 상권](https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do)                   | 서울 열린데이터광장 | 상권 경계 표시 및 상권별 분석           |
| [지하철호선별 역별 승하차 인원](https://data.seoul.go.kr/dataList/OA-12914/S/1/datasetView.do) | 서울 열린데이터광장 | 인근 지하철역 이용량과 교통 접근성 참고 |

### API 인증키 발급 방법

공공데이터포털과 서울 열린데이터광장은 인증키 발급 및 API 이용 방식이 다릅니다.

**1. 공공데이터포털**

1. [공공데이터포털](https://www.data.go.kr/)에 회원가입 후 로그인합니다.
2. [소상공인시장진흥공단 상가(상권)정보 API](https://www.data.go.kr/data/15012005/openapi.do) 상세 페이지에 접속합니다.
3. **활용신청**을 클릭하고 화면에 안내되는 신청 정보를 입력합니다.
4. 활용신청을 완료한 뒤 승인 상태를 확인합니다. 해당 API는 확인 당시 개발·운영 단계 모두 자동승인 대상으로 안내되어 있습니다.
5. 마이페이지의 API 활용신청 내역에서 서비스 이용 상태와 인증키를 확인합니다.
6. API 상세 페이지의 활용 명세 및 참고문서를 확인한 뒤 발급받은 인증키로 호출을 테스트합니다.

공공데이터포털은 사용할 API 서비스별로 활용신청 및 승인 여부를 확인해야 합니다. 인증키를 보유하고 있더라도 신청하지 않은 API의 접근 권한이 자동으로 부여되는 것은 아닙니다.

**2. 서울 열린데이터광장**

1. [서울 열린데이터광장](https://data.seoul.go.kr/)에 회원가입 후 로그인합니다.
2. [Open API 인증키 신청](https://data.seoul.go.kr/together/mypage/actkeyMain.do) 페이지에 접속합니다.
3. **일반 인증키 신청**을 선택합니다.
4. 신청 정보를 입력하고 발급을 신청합니다.
5. **인증키 관리** 메뉴에서 발급된 인증키를 확인합니다.
6. 사용할 데이터의 상세 페이지에서 Open API 서비스명과 요청 매개변수를 확인합니다.
7. 발급받은 인증키와 서비스명을 이용해 호출을 테스트합니다.

서울 열린데이터광장의 일반 인증키는 여러 일반 Open API에서 사용할 수 있으므로 데이터마다 별도로 신청할 필요는 없습니다. 다만 실시간 지하철 API 등 일부 서비스는 별도 인증키가 필요합니다.

**인증키 관리 및 이용 시 주의사항**

- 발급받은 인증키는 환경변수로 관리하며 Git 저장소에 커밋하지 않습니다.
- API 인증키를 프론트엔드 코드에 포함하지 않고 서버 측에서 관리합니다.
- API별 요청 제한, 이용조건, 제공 기간 및 데이터 갱신 주기를 확인합니다.
- 서울 열린데이터광장 API는 일반적으로 한 번에 최대 1,000건을 조회하므로 데이터가 많다면 구간을 나누어 요청합니다. 개별 API의 제한은 별도로 확인합니다.
- 행정동·상권 경계처럼 파일 형태로 제공되는 데이터는 API 인증키 없이 다운로드할 수 있는지 별도로 확인합니다.

※ 데이터별 집계 단위, 기준 시점, 갱신 주기, 좌표계가 다르므로 비교·결합 전에 확인해야 합니다. 추정매출과 인구 통계는 실제 매장 매출이나 창업 성공 가능성을 보장하지 않습니다.

## 공공데이터 검증 현황

2026년 10월 기준으로 다음 데이터를 검증했습니다.

| 데이터             | 검증한 범위                                                      | 상태                              |
| ------------------ | ---------------------------------------------------------------- | --------------------------------- |
| 점포-행정동        | CSV 211,832행, 100개 업종, 행정동·업종·분기별 데이터 및 API 비교 | 업종·점포 통계 ETL·실제 적재 완료 |
| 추정매출-행정동    | CSV 100,431행, 63개 업종, 매출·건수 및 API 비교                  | ETL·실제 적재 완료                |
| 길단위인구-행정동  | CSV 9,350행, 22개 분기·425개 행정동 및 API 비교                  | ETL·실제 적재 완료                |
| 영역-행정동        | Shapefile 425개 경계, 좌표계·경계 유효성·행정동 코드 검증        | 경계 ETL·실제 적재 완료           |
| 상가(상권)정보 API | 염창동 카페 70개 및 염창역 반경 500m 카페 53개 조회              | 기본 조회 검증 완료               |

검증 과정에서 다음 사항을 확인했습니다.

- 통계 데이터는 행정동 코드를 기준으로 연결해야 합니다.
- 행정동 이름은 중복될 수 있으므로 고유 식별자로 사용하지 않습니다.
- 점포·추정매출·길단위인구의 집계 단위와 데이터 제공 범위가 다릅니다.
- 일부 업종이나 행정동의 통계가 제공되지 않을 수 있으며, 데이터가 없다는 사실을 실제 값 `0`과 구분해야 합니다.
- 원본 통계의 세부 합계는 반올림 및 집계 기준 차이로 전체 값과 정확히 일치하지 않을 수 있습니다.
- 서로 다른 데이터 제공처의 카페 수는 업종 분류·수집 범위·기준 시점 차이로 일치하지 않을 수 있습니다.
- 행정동 경계와 과거 통계의 기준 시점이 다를 수 있으므로 행정구역 변경 이력을 고려해야 합니다.

기본 검증은 일회성 분석으로 수행했습니다. 이후 실제 적재와 재실행 검증도 완료했습니다. 입력 버전별 수치·출처 보존 결과는 아래 각 ETL 절에서 관리합니다.

## ETL 처리 방향

행정동·자치구 경계·서비스 업종·점포·추정매출·유동인구 통계 ETL은 Node.js·TypeScript 기반으로 구현했으며, Zod로 데이터를 검증하고 node-postgres를 이용해 PostgreSQL에 적재합니다. 경계 공간 연산은 PostGIS를 사용합니다. 카페 ETL도 같은 기술 스택과 Node.js 내장 fetch를 사용합니다. 아래 처리 흐름과 갱신 원칙은 전체 ETL의 설계 방향입니다.

### 처리 흐름

1. **수집:** 공공데이터 API 또는 제공 파일에서 원본 데이터를 가져옵니다.
2. **검증:** 데이터 형식, 필수 값, 중복, 코드, 수치, 좌표 및 수집 범위를 확인합니다.
3. **변환:** 날짜·업종·행정구역 코드와 좌표계를 서비스 데이터 모델에 맞게 변환합니다.
4. **임시 적재:** 검증한 데이터를 스테이징 영역에 적재합니다.
5. **최종 검증:** 전체 수집 여부, 데이터 건수, 고유성, 외래키 및 기존 데이터와의 차이를 확인합니다.
6. **DB 반영:** 검증에 성공한 데이터만 트랜잭션으로 서비스 테이블에 반영합니다.
7. **이력 기록:** 수집 출처, 기준 기간, 적재 결과 및 오류를 ETL 배치 단위로 기록합니다.

### 데이터 갱신 및 실패 처리

- 동일한 분기·행정동·업종 조합은 중복 저장하지 않습니다.
- 기존 분기의 수정 데이터는 수집 범위와 유효성을 검증한 후 갱신합니다.
- API 일부 페이지만 수집한 경우 기존 서비스 데이터를 유지합니다.
- 전체 스냅샷 수집이 성공한 경우에만 기존 데이터와의 삭제·누락 차이를 검토합니다.
- 행정동 경계 변경이 발견되면 관련 통계에 미치는 영향을 확인한 후 반영합니다.
- 수집·검증에 실패한 데이터는 기존 정상 데이터를 대체하지 않습니다.
- 원본 데이터와 적재 결과의 출처, 기준 시점 및 버전을 확인할 수 있도록 관리합니다.

경계·서비스 업종·점포·추정매출·유동인구 통계 ETL은 임시 스테이징, 트랜잭션 반영·롤백, 배치 이력, 동일 원본 재실행 및 기존 데이터 보존 처리를 구현했습니다. 카페 ETL도 아래 수집·게시 계약을 구현했습니다. 추가 데이터셋의 구체적인 스테이징·트랜잭션·재실행·보존 정책은 해당 ETL 구현 전에 확정할 예정입니다.

### 배치 상태

`etl_batch`는 ETL 한 번의 실행과 결과를 기록합니다. `SKIPPED`·실패 이력은 기존 정상 게시본을 대체하지 않습니다.

| 상태        | 의미                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| `RUNNING`   | 수집·검증·적재가 진행 중인 실행                                                               |
| `PUBLISHED` | 전체 검증 후 서비스 데이터와 게시 이력을 함께 확정한 실행                                     |
| `SKIPPED`   | 동일 원본·ETL 버전과 실제 저장 값·출처 등의 일치를 검증해 기존 정상 데이터·출처를 유지한 실행 |
| `FAILED`    | 수집·검증·반영에 실패한 실행. 변경은 롤백하고 이전 정상 데이터를 보존                         |

상태별 세부 검증은 아래 ETL별 규칙을 따릅니다. DB 연결 자체가 불가능하면 실패 이력도 남길 수 없습니다.

## 설치 및 공통 실행

### 작업 디렉터리와 환경변수

- **적재 모드 필수:** 실행할 ETL의 사전 조건에 맞는 Flyway·기준 데이터와 DB 설정을 준비합니다. 명령별 검증 SQL·테스트는 각 절의 마지막에 있습니다.
- **카페 `--probe`:** DB 준비를 건너뛸 수 있지만 API 인증키와 공식 카페 분류 변수는 필요합니다.
- **자치구 매출 `district-sales --probe`:** 로컬 CSV·ZIP의 읽기 전용 검증만 지원합니다. DB·인증키·네트워크가 필요 없으며 `--probe` 생략은 오류입니다.
- **자치구 점포 `district-stores --probe`:** 로컬 CSV·ZIP만 검증합니다. DB 준비·환경변수·인증키·네트워크 요청은 필요하지 않습니다.
- **선택 설정:** ETL 전용 `.env`와 빌드 결과 실행은 필요할 때만 사용합니다. 공통 DB 설정을 쓰면 루트 `.env` 내보내기를 우선합니다.

명령 블록마다 기준 디렉터리를 표시합니다. 저장소 루트에서 시작하는 공통 준비 절차에서 `cd etl`을 한 번 실행합니다. **아래 ETL·probe 절의 npm 명령은 모두 `etl/` 기준이므로 `cd etl`을 반복하지 않습니다.** 적재용 새 터미널에서는 먼저 루트 `.env`를 내보내고 `etl/`로 이동하세요. 환경변수는 내보낸 셸과 그 자식 프로세스에만 적용됩니다.

```bash
# 새 터미널의 저장소 루트에서 실행
set -a
source .env
set +a
```

`--probe`만 실행할 때는 DB 준비와 위 DB 환경변수 내보내기가 필요하지 않습니다. 카페 probe에만 API 인증키·카페 분류 변수를 별도로 준비합니다. 자치구 점포·매출 probe에는 인증키도 필요하지 않습니다.

### 설치와 도움말

다음 블록은 저장소 루트에서 시작합니다. 이미 `etl/`에 있다면 `cd etl` 줄을 다시 실행하지 않습니다.

필수 준비는 Node.js 버전 선택과 의존성 설치입니다.

```bash
# 저장소 루트에서 시작
cd etl
nvm use
npm ci
```

이후 다음 **두 방식 중 하나**를 선택합니다. 아래 명령은 이미 이동한 **`etl/`**에서 실행하며, 인자를 생략하면 적재 대신 사용법을 확인합니다.

**개발 실행:** TypeScript 원본을 직접 실행합니다. 별도 빌드가 필요하지 않습니다.

```bash
npm run dev
```

**빌드 결과 실행 (선택):** `npm run build`로 `dist/`에 JavaScript를 생성하고, `npm start`로 빌드된 진입점을 실행하려는 경우에만 사용합니다.

```bash
npm run build
npm start
```

`npm run dev`와 `npm start`를 연속 실행할 필요는 없습니다. 실제 적재는 아래에서 선택한 명령에 같은 인자를 전달하며, 개발 방식이면 `npm run dev -- …`, 빌드 방식이면 `npm start -- …`를 사용합니다.

인자 없는 실행은 DB에 접속하지 않습니다. 현재 구현된 적재 명령은 행정동·자치구 경계용 `boundaries`, 서비스 업종용 `industries`, 점포 통계용 `stores`, 추정매출 통계용 `sales`, 유동인구 통계용 `foot-traffic`, 카페용 `cafes`, 공식 자치구 점포용 `district-stores`입니다. `district-sales --probe`는 별도의 읽기 전용 검증 명령이며 적재 기능이 아닙니다.

Compose DB를 공유하려면 [개발 가이드](development.md#로컬-db-준비)에 따라 같은 터미널에서 루트 `.env`를 먼저 내보냅니다. 내보낸 `DATABASE_URL`은 `etl/.env`보다 우선하므로 Backend와 같은 DB를 사용합니다.

- ETL만 별도로 설정할 때는 `etl/`에서 `cp -n .env.example .env`로 기존 파일을 보존하며 준비할 수 있습니다. `npm run dev`와 `npm start`는 Node.js의 환경변수 파일 기능으로 이 `etl/.env`를 읽습니다.
- DB 연결 시 `DATABASE_URL`, `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS`를 Zod로 검증하고 `pg.Pool`을 생성합니다. 설정은 실제 사용할 때 검증하며 풀 생성만으로 DB에 접속하지 않습니다.
- 아래 확인 SQL은 `etl/`의 npm 명령이 아닙니다. 저장소 루트의 별도 터미널에서 [DB 접속 명령](development.md#로컬-db-준비)을 실행한 뒤 `psql` 안에서 실행합니다. 테스트 명령은 `etl/`에서 실행합니다.

## 자치구 추정매출 읽기 전용 검증

### 사전 조건과 실행

Node.js·의존성만 준비하고 **`etl/`에서** 실행합니다. DB 시작·`.env` 내보내기·API 인증키는 필요 없습니다. `district-sales`는 `--probe`를 생략하면 DB·파일 처리 전에 명시적으로 거부하며, 적재 모드는 없습니다.

```bash
# etl/에서 실행. 아래 파일은 사용자가 제공한 실제 CSV입니다.
npm run dev -- district-sales --probe \
  --source "$HOME/Downloads/서울시 상권분석서비스(추정매출-자치구).csv" \
  --expected-rows 33803
```

`33803`은 이번 판본의 데이터 행 수(헤더 제외)이며 다른 파일에는 확인한 전체 건수를 지정합니다. CSV 한 개를 담은 ZIP도 같은 `--source`로 지원합니다. 빌드 결과 실행을 선택할 때만 `npm run build` 후 `npm start -- district-sales --probe …`를 사용하며 개발 실행과 연속 수행할 필요는 없습니다.

### 입력과 검증 규칙

- 공식 OA-22176·서비스 `VwsmSignguSelngW`의 자치구·업종·분기와 당월 금액·당월 건수·주중 금액·주말 금액 4종만 채택합니다. [한글·영문 헤더와 출력 계약](data-design.md#자치구-추정매출-원본-probe-계약)을 따르며 다른 44개 수치는 이 probe의 수치 검증·출력 대상이 아닙니다. 파일의 전체 컬럼 수를 53개로 고정하지 않습니다.
- 필수·중복·모호한 헤더, 행 길이, ASCII 코드, 복합키 중복과 채택 수치의 0 이상 BIGINT 범위를 검증합니다. `normalizeInteger`로 큰 정수·`.0`·정수 의미 지수 표기를 정밀도 손실 없이 문자열로 보존합니다. 빈 셀만 NULL이며 실제 0·누락 행과 구분합니다.
- 기존 CSV/ZIP 및 UTF-8·CP949 판독기를 재사용합니다. 전체 파일을 검증한 뒤 예상 건수를 비교하고 최대 5행의 sample만 출력합니다. 성공 JSON에는 `mode=PROBE`, `datasetId=OA-22176`, `serviceName=VwsmSignguSelngW`, `validationScope=LOCAL_FILE_FORMAT`, `databaseChecked=false`, `batchCreated=false`, `loadedRows=0`과 건수·분기 범위·인코딩·SHA-256을 포함합니다. ZIP 체크섬은 내부 CSV 바이트 기준이고 경로·ZIP entry는 출력하지 않습니다.
- 검증 실패 시 종료 코드 1과 안전한 오류만 출력하며 성공 JSON·부분 sample을 출력하지 않습니다. 옵션 누락·중복·알 수 없는 옵션과 잘못된 예상 건수도 거부합니다. DB·배치·적재·FK 확인·네트워크는 호출하지 않습니다.
- 당월을 분기 합계나 월평균으로 환산하지 않고 주중·주말 합계 일치도 강제하지 않습니다. 누락 조합을 0으로 생성하거나 행정동 수치를 합산하지 않습니다.

### 실제 CSV 검증 결과 (2026-10-31)

제공된 `서울시 상권분석서비스(추정매출-자치구).csv`에 위 명령을 실행해 **CP949, 판독·유효 33,803행, 거부 0행**, `20211`~`20262`와 최대 5행 표본을 확인했습니다. SHA-256은 `d78b04e3367195f3bee78db3fb4c1cb95091b4e30ed2943b1f235c6abca85daa`로 제공 정보와 일치합니다. DB 준비·연결·배치·적재는 수행하지 않았습니다.

같은 실제 파일을 독립적으로 읽어 53개 컬럼·48개 수치 모두 정수 문자열, 22개 분기·25개 구·63개 업종, 키 중복·형식 오류 0건을 확인했습니다. NULL 수치 셀은 없으며 실제 0은 존재합니다. 관찰 차원의 곱 `22 × 25 × 63 = 34,650`에서 **847개 조합이 없고**, 당월 금액과 주중·주말 합계의 **절댓값 1~3원 차이가 39행** 존재합니다. 이 조사는 probe의 4개 수치 검증과 별개이며, 다른 44개 필드의 채택이나 합계 차이 허용 오차를 API·DB 계약으로 확정한 것이 아닙니다. 값 보정·행 생성은 하지 않았습니다. 이번 실제 원본은 CSV이고 실제 ZIP 판본은 미검증입니다.

### 테스트와 후속 범위

`etl/`에서 `npm test -- src/district-sales-source.test.ts src/district-sales-cli.test.ts`로 합성 CSV/ZIP·정밀도·NULL/0·마지막 행 오류와 실제 CLI의 DB/네트워크 차단을 검증합니다. 테스트는 임시 파일·실제 DB 없이 메모리 입력을 사용합니다. 자치구 매출의 실제 FK 대조·DB 테이블·적재 ETL·게시 정책·REST API는 후속 범위이며 기존 행정동 매출·자치구 점포 동작은 유지합니다.

## 자치구 점포 읽기 전용 검증

### 사전 조건과 실행 명령

Node.js·의존성 설치 후 **`etl/`에서** 실행합니다. `district-stores --probe`는 읽기 전용이고, `--probe` 없이 실행하면 적재 모드입니다. probe는 DB 설정이 없거나 잘못되어도 DB 풀 생성·접속·배치 생성·적재를 하지 않습니다. 로컬 원본의 경로와 해당 판본의 전체 데이터 행 수(헤더 제외)를 준비합니다. 아래 `EXPECTED_DISTRICT_STORE_ROWS`는 확인한 행 수를 담는 셸 변수이며 인증정보가 아닙니다.

```bash
# etl/에서 실행. 실제 원본의 확인한 전체 행 수를 변수에 먼저 지정합니다.
npm run dev -- district-stores --probe \
  --source /절대경로/자치구점포.csv \
  --expected-rows "$EXPECTED_DISTRICT_STORE_ROWS"
```

CSV 하나를 담은 ZIP도 `--source /절대경로/자치구점포.zip`으로 검증합니다. 빌드 결과를 선택하면 `npm run build` 후 같은 인자를 `npm start -- district-stores --probe …`로 전달합니다. 기존 적재 명령과 달리 `.env` 내보내기·API 인증키는 필요하지 않습니다. 옵션 중복·누락된 경로·양의 안전한 정수가 아닌 예상 건수는 실행 전에 거부합니다. `--probe` 생략은 적재를 선택하므로 읽기 전용 확인에는 반드시 붙입니다.

### 입력·검증 규칙

- 공식 [점포-자치구 OA-22173](https://data.seoul.go.kr/dataList/OA-22173/A/1/datasetView.do)의 Open API 출력항목·Sheet label에 대응하는 3개 코드와 7개 측정값을 요구합니다. [전체 컬럼 대응과 원천 조사](district-statistics-policy.md#점포의-7개-측정값)를 참고하세요. 한글 또는 영문 헤더를 받되 누락·중복·모호한 두 별칭·잘못된 행 길이를 거부합니다. 명칭 컬럼은 키가 아닙니다.
- 분기 `YYYYQ`(분기 1~4), 자치구 ASCII 5자리, 업종 `CS`+ASCII 6자리를 문자열로 검증합니다. 동일 분기·구·업종의 복합키 중복과 빈 데이터도 오류입니다. probe는 서울 구·업종 기준 테이블의 실제 존재를 조회하지 않으며, 적재 모드에서 FK를 별도로 대조합니다.
- 점포 수 5개는 BIGINT 범위의 0 이상 정수 의미를 검증합니다. 공개 API 표본의 `749.0`이나 정수 의미 지수 표기를 정확한 정수 문자열로 정규화하며 `Number`로 변환하지 않습니다. 소수 의미·음수·범위 초과는 거부합니다.
- 개·폐업률은 기존 점포 계약의 일반 십진수 문자열로 검증합니다(지수 표기 제외). NUMERIC 정수부 131072자리·소수부 16383자리 한계를 적용하고 긴 소수부·끝의 0을 보존합니다. 100% 상한·합계 일치·비율 재계산은 강제하지 않습니다.
- 빈 셀만 `null`이며 실제 `0`과 구분합니다. 공백·문자 `NULL`·NaN·Infinity를 대체하지 않습니다. UTF-8·CP949 및 단일 CSV ZIP 판독·CRC·512 MiB 제한은 기존 CSV 처리기를 재사용하며 디스크에 압축을 풀지 않습니다.
- 파일 전체를 검증한 뒤 `--expected-rows`와 대조합니다. 표본 뒤 오류·중복도 실패하며 오류 시 부분 표본이나 성공 JSON을 출력하지 않습니다. 오류에는 원본 값·경로·접속 정보를 포함하지 않습니다.

### 검증 결과와 한계

성공 출력은 `mode=PROBE`, `datasetId=OA-22173`, `validationScope=LOCAL_FILE_FORMAT`, `databaseChecked=false`, `batchCreated=false`, `loadedRows=0`입니다. 판독·유효·거부 건수, 예상 건수, 관찰된 최소·최대 분기, CSV 바이트의 SHA-256 체크섬, 인코딩과 최대 5행의 `sample`을 포함합니다. ZIP 포장이 달라도 내부 CSV가 같으면 같은 체크섬입니다. 원본 경로·ZIP entry·구별 커버리지·NULL별 집계는 출력하지 않습니다.

2026-10-31에 제공된 `서울시 상권분석서비스(점포-자치구).csv` 전체를 `--expected-rows 54765`로 검증했습니다. CP949, 판독·유효 54,765행, 거부 0행, `20211`~`20262` 22개 분기이며 25개 구·100개 업종을 확인했습니다. 복합키 중복·수치 형식 오류가 없고 7개 측정값 모두 소수 표기였습니다. 이 파일에는 빈 수치 셀이 없고 실제 0이 존재하며, 폐업률 `200.0`인 1행이 있습니다. 관찰 차원의 곱 55,000개 중 235개 조합은 원본에 없으므로 전체 조합을 강제하거나 0으로 채우지 않습니다.

원본 CSV SHA-256은 `84702068872a5ab8c6c824f11294a16f8b306afb6c19a25689af4c135bf377fd`입니다. 구·업종 수·없는 조합·NULL·비율 범위는 같은 파일을 별도로 읽어 대조한 결과이며 probe 출력에 새 집계 필드를 추가하지 않았습니다. probe 성공은 지정 로컬 파일의 형식 검증이고 공식 원본의 진위·DB FK·게시 준비 완료를 뜻하지 않습니다. 최초 구현 검증 당시에는 실제 개발 DB에 V5 적용이나 자치구 점포 적재를 하지 않았습니다. 실제 CSV 54,765행을 일회용 PostGIS에 적재해 7개 측정값을 전수 문자열 대조했고 재실행 `SKIPPED`와 정상 게시 출처 보존을 확인했습니다. 이 시험의 FK 기준 행은 관찰 코드로 만든 합성 기준 데이터이며 실제 개발 DB 기준 데이터와 대조한 것은 아닙니다.

공식 자치구 점포 조회 API는 구현됐습니다. [API 계약](data-design.md#자치구-점포-통계-rest-api-계약)과 아래 실제 개발 DB 검증 기록을 참고하세요. 자치구 매출·인구는 [후속 정책](district-statistics-policy.md#후속-저장게시api-방향)으로 구분합니다.

### 적재 사전 조건과 실행

V5 `district_store_stat`, V2의 `district`·`service_industry`·`etl_batch`와 검증할 자치구·업종 기준 데이터가 필요합니다. 적재용 `DATABASE_URL`은 기존 ETL처럼 loopback 주소만 허용합니다. 명령을 실행하면 대상 DB에 변경이 생기므로 먼저 대상과 적용 권한을 확인합니다. 최초 구현 테스트는 일회용 PostGIS에서 수행했고, 이후 아래 기록처럼 실제 개발 DB에도 적용·적재했습니다. 테스트 명령은 계속 개발 DB와 분리된 일회용 컨테이너만 사용합니다.

```bash
# etl/에서 실행. 적재 대상 DB 설정과 V5·기준 데이터를 별도로 준비한 경우만 사용합니다.
npm run dev -- district-stores \
  --source "$HOME/Downloads/서울시 상권분석서비스(점포-자치구).csv" \
  --expected-rows 54765
```

`54765`는 위에서 검증한 파일 판본의 전체 행 수이며 다른 판본에 고정 적용하지 않습니다. ZIP과 빌드 결과 실행도 probe와 같은 입력 옵션을 사용합니다. 인증키·외부 API 호출은 없습니다.

### staging·게시·재실행

- CSV·ZIP 전체를 검증하며 중복키를 확인하고 수치를 문자열 또는 NULL로 유지해 최대 1,000행씩 staging합니다. 실제 staging 행 수를 유효·예상 건수와 비교하고 `district`·`service_industry`의 실제 코드를 대조합니다. 일부 분기·구·업종 조합이 없어도 임의 행이나 0을 생성하지 않습니다.
- 공개 직전에 같은 데이터셋·대상 쓰기를 직렬화하고 FK 기준 데이터 변경을 잠근 뒤 Upsert와 `PUBLISHED` 배치를 같은 트랜잭션으로 반영합니다. 신규 파일에 없는 이전 키는 삭제하거나 출처를 변경하지 않습니다. 전체·세부 합계나 개·폐업률도 보정하지 않습니다.
- 데이터셋은 `SEOUL_DISTRICT_STORE_STAT`, `CSV`·`SEOUL`·`scope_code=NULL`, ETL 버전은 `district-store-stat-v1`입니다. `source_reference` JSON에는 `datasetId=OA-22173`, `serviceName=VwsmSignguStorW`, `path`, 선택적 ZIP `entry`, `encoding`을 남기며 CSV 내용 체크섬·분기 범위는 배치 컬럼에 기록합니다.
- 같은 체크섬·ETL 버전의 정상 `PUBLISHED` 이력(`CSV`·`SEOUL`·범위 코드 NULL·게시 시각 존재)과 모든 대상 측정값(비율의 소수 자릿수 포함)·`source_batch_id`가 실제 저장값과 일치해야 `SKIPPED`입니다. 이때 새 SKIPPED 배치로 통계 행 출처를 덮어쓰지 않습니다. 원본이나 저장값·출처가 달라지면 새 `PUBLISHED`로 복구·게시합니다.
- 파일·FK·DB 오류에서는 staging과 일부 성공한 Upsert도 함께 롤백하고 기존 정상 게시 데이터·출처를 보존합니다. 시작 배치가 생성된 실행은 `FAILED`를 기록하며 DB 연결 자체가 불가능하면 이력도 남길 수 없습니다. `--probe`는 이 모든 DB 처리 전에 분기합니다.

### 확인 SQL·테스트

아래 SQL은 대상 DB를 먼저 확인한 뒤 실행하는 읽기 전용 확인 예시입니다. 실제 개발 DB에서도 아래 배치·행 수 항목과 7개 측정값을 검증했습니다.

```sql
SELECT batch_id, status, source_checksum, expected_rows, fetched_rows,
       valid_rows, rejected_rows, period_from, period_to, published_at
FROM etl_batch
WHERE dataset_code = 'SEOUL_DISTRICT_STORE_STAT'
ORDER BY started_at DESC;
SELECT count(*), min(quarter_code), max(quarter_code)
FROM district_store_stat;
```

검증 로직과 실제 CLI의 DB 미접속 회귀는 `etl/`에서 `npm test -- src/district-store-source.test.ts src/district-store-cli.test.ts src/index.test.ts`로 실행합니다. 단위 테스트는 메모리 CSV·ZIP과 모의 파일 읽기·DB/네트워크 차단을 사용합니다. `RUN_DISTRICT_STORE_DB_TESTS=1 npm test -- src/district-stores.integration.test.ts`는 기존 ETL 방식대로 새 일회용 PostGIS 컨테이너에만 V1~V5와 합성 기준·통계를 적용해 실제 SQL·트랜잭션·실패 보존을 검증합니다. 개발 DB·공공 API에는 접속하지 않습니다.

### 실제 개발 DB 적용·적재 검증 (2026-10-31)

- 적용 전 Compose의 PostGIS 컨테이너·영속 볼륨·health 상태와 ETL·Backend·Compose의 DB 설정 및 실제 PostgreSQL 인스턴스 일치를 확인했습니다. 비밀번호·접속 URL은 출력하거나 문서에 기록하지 않았습니다. [적용 전 백업 검증](development.md#마이그레이션-적용-상태-확인) 후 기존 `db` 프로필로 V5만 신규 적용했고 V1~V5의 `success=true`를 확인했습니다. V1~V4의 이력·체크섬은 그대로 유지했습니다.
- 위 SHA-256의 실제 CP949 CSV로 읽기 전용 probe를 다시 실행해 판독·유효 54,765행, 거부 0행을 확인했습니다. 실제 개발 DB의 자치구·업종 코드와 전수 대조해 FK 불일치가 없었습니다.
- 최초 적재 배치 `d3fbcf90-18e3-4c20-bd30-cf29abdbe748`는 `PUBLISHED`이며 게시 시각은 `2026-10-31T09:50:24.232140Z`입니다. `SEOUL_DISTRICT_STORE_STAT`·`CSV`·`SEOUL`·범위 코드 NULL·위 체크섬을 확인했고, 54,765행 전체의 `source_batch_id`가 이 배치를 참조합니다.
- 저장 결과는 `20211`~`20262`의 22개 분기·25개 자치구·100개 업종입니다. 실제 원본을 독립적으로 읽어 7개 수치 총 **383,355개를 전수 문자열 대조해 불일치 0건**을 확인했습니다. 5개 BIGINT는 원본 `749.0` 등을 정확한 정수 의미로 저장하고 두 NUMERIC 비율은 원본 소수 자릿수를 유지했습니다. 원본·DB 모두 실제 0인 측정 셀이 89,940개이며 빈 수치 셀은 없습니다. 따라서 실제 NULL 행의 동작은 이번 실데이터로 확인한 것이 아니라 기존 격리 테스트의 검증 범위입니다. 폐업률 `200.0` 1행도 보정 없이 유지했습니다.
- 차원의 곱 55,000개 중 원본에 없는 **235개 복합키는 DB에도 없으며** 0이나 대체 분기로 생성하지 않았습니다.
- 같은 적재 명령 재실행은 배치 `98da2dbf-6473-4b62-a9b6-ff23f0138c89`의 `SKIPPED`로 끝났습니다. 게시 시각은 NULL이고, 54,765행 전체의 측정값·출처를 포함한 행 지문은 최초 적재 직후와 동일합니다. 기존 7개 데이터 테이블과 기존 배치 14건도 적용 전후 건수·전체 행 지문이 같았습니다. DB 초기화·볼륨 삭제·DROP/TRUNCATE나 기존 ETL 재실행은 하지 않았습니다.

실제 `db` 프로필 API도 DB 값과 대조했습니다. 다음은 **합성 데이터가 아닌 위 게시본의 실제 검증 결과**이며, 측정값은 모두 JSON 문자열입니다.

```text
GET /api/v1/districts/11500/stats/stores?quarterCode=20262&industryCode=CS100010
200: storeCount="1268", generalStoreCount="889", franchiseStoreCount="379",
     openedStoreCount="53", closedStoreCount="52", openingRate="4.2", closureRate="4.1"
sourceBatch.batchId=d3fbcf90-18e3-4c20-bd30-cf29abdbe748
sourceBatch.publishedAt=2026-10-31T09:50:24.23214Z
```

같은 구·업종의 `20211` 과거 분기, 폐업률 `200.0`인 실제 행도 DB와 일치했습니다. 원본에 없는 `11140`·`20212`·`CS200039`는 `200`과 `data: null`, 누락·빈 값·형식·중복·공백 등 잘못된 입력 7종은 `400 / INVALID_PARAMETER`, 없는 구 `99999`는 `404 / REGION_NOT_FOUND`였습니다. 적재 전에는 `503 / DATA_NOT_READY`도 확인했습니다. 기존 자치구 목록·행정동 목록·행정동 점포 API의 정상 응답을 확인했으며 코드·마이그레이션·ETL 수정은 없었습니다.

## 행정동·자치구 경계 적재

### 사전 조건

로컬 DB를 실행하고 기존 Flyway 마이그레이션을 먼저 적용한 뒤, 루트 `.env`를 내보낸 셸에서 실행합니다. `DATABASE_URL`은 `localhost`, `127.0.0.1`, `::1`의 로컬 개발 DB만 허용하며, URL 쿼리로 접속 호스트를 우회할 수 없습니다.

### 실행 명령

다음 npm 명령은 환경변수를 내보낸 **`etl/` 터미널**에서 실행합니다.

```bash
npm run dev -- boundaries \
  --source "/절대경로/서울시 상권분석서비스(영역-행정동).zip" \
  --expected-dongs 425 --expected-districts 25
```

빌드 결과로 실행하려면 `npm run build` 후 동일한 인자를 `npm start -- boundaries --source "/절대경로/경계.zip" --expected-dongs 425 --expected-districts 25`로 전달합니다. `npm run dev -- --help`로 사용법을 확인할 수 있습니다.

### 입력 데이터

- 입력은 원본 ZIP 또는 `.shp` 경로입니다. `.shp`는 같은 이름의 `.dbf`, `.prj`, `.cpg`가 필요하며 ZIP은 메모리에서 읽습니다. 원본을 저장소에 복사하거나 커밋하지 않습니다.
- `425`행·`25`개 자치구는 기존에 검증한 입력 버전의 기준입니다. 두 건수 인자는 필수이며 다른 버전에는 해당 원본을 확인한 기준을 지정합니다.

### 검증 규칙

- 현재 원본은 UTF-8이며 `ADSTRD_CD`, `ADSTRD_NM`, `XCNTS_VALU`, `YDNTS_VALU`, `RELM_AR`를 검증합니다. 원본의 `RELM_AR`는 `N(38,0)` 정수 ㎡이므로 정수 정밀도를 유지해 `area_m2`에 저장합니다. 코드 중복·빈 값·잘못된 좌표계·유효하지 않은 도형은 자동 보정하지 않습니다.
- `.prj`의 EPSG:5181 투영·타원체·단위·원점 등 실제 WKT1 매개변수를 검증합니다. PostGIS로 원본 도형의 유효성·양의 면적, 변환 후 SRID 4326·서울 인근 좌표 범위 및 대표점의 경계 내부 포함을 확인합니다. 대표점은 원본 중심 좌표 대신 `ST_PointOnSurface`로 생성합니다.
- 자치구는 행정동 코드 앞 5자리와 [행정표준코드의 서울 시군구 코드표](https://www.code.go.kr/stdcode/sggCodeIL.do?sidoCd=11&disuseAt=0&searchOk=0)를 대응하고, 행정동 경계를 결합해 생성합니다.

### 적재 결과

원본 Shapefile의 행정동 425개와 이를 결합한 자치구 25개를 로컬 개발 DB에 적재했습니다. 유효 425건·거부 0건과 동일 원본 재실행 `SKIPPED` 처리를 확인했습니다. 이 건수는 검증한 입력 버전의 결과입니다.

### 재실행·오류 처리

- 전체 검증 후 두 경계 테이블과 `PUBLISHED` 이력을 한 트랜잭션으로 반영합니다. 실패하면 경계 변경을 롤백하고 `FAILED` 이력을 별도로 기록합니다. DB 연결 자체가 불가능한 경우에는 실패 이력도 기록할 수 없습니다.
- 원본 체크섬·ETL 버전과 현재 경계·이름·면적·출처가 같으면 재실행은 `SKIPPED`로 기록합니다. 나머지는 기본키 기준으로 추가·갱신하며, 입력에 빠진 기존 코드가 있다면 삭제하지 않고 중단합니다. 유효 건수에는 검증이 끝난 행만 포함하며, 실패 시 아직 검증하지 않은 행은 유효·거부 건수에 포함하지 않습니다.

### 확인 SQL·테스트

확인 SQL은 저장소 루트에서 접속한 `psql`에서 실행합니다.

```sql
SELECT batch_id, source_reference, source_checksum, status, expected_rows,
       fetched_rows, valid_rows, rejected_rows, error_message
FROM etl_batch WHERE dataset_code = 'SEOUL_DONG_BOUNDARY' ORDER BY started_at DESC;
SELECT count(*) FROM district;
SELECT count(*), bool_and(ST_SRID(geom) = 4326 AND ST_SRID(label_point) = 4326
       AND ST_IsValid(geom) AND ST_Contains(geom, label_point) AND area_m2 > 0)
FROM administrative_dong;
```

파일·CLI 단위 테스트는 기존 `npm test`에 포함됩니다. DB 회귀 테스트는 합성 데이터를 새 일회용 PostGIS 컨테이너에서만 사용하며 기존 개발 DB는 변경하지 않습니다. Docker가 실행 중일 때 `etl/`에서 `RUN_BOUNDARY_DB_TESTS=1 npm test -- src/boundaries.integration.test.ts`로 실행합니다. 이 테스트는 원본의 실제 적재 검증을 대신하지 않습니다.

## 서비스 업종 기준 데이터 적재

### 사전 조건

루트 `.env`를 내보낸 터미널에서 실행합니다. 점포 CSV가 기본 원본이고 `--sales-source`는 선택입니다. 두 원본을 함께 쓰면 매출에만 있는 유효한 업종도 합집합에 포함하며, 같은 코드의 명칭이 다르면 반영하지 않습니다. 통계 수치는 이번 명령에서 적재하지 않습니다.

### 실행 명령

다음 npm 명령은 환경변수를 내보낸 **`etl/` 터미널**에서 실행합니다.

```bash
npm run dev -- industries \
  --source "$HOME/Downloads/서울시 상권분석서비스(점포-행정동).csv" \
  --sales-source "$HOME/Downloads/서울시 상권분석서비스(추정매출-행정동).csv" \
  --expected-industries 100
```

빌드 결과는 `npm run build` 후 위 명령의 `npm run dev --`를 `npm start --`로 바꿔 실행합니다. 파일 경로와 필수 `--expected-industries`는 입력 버전에 맞게 지정합니다. `100`은 검증한 두 원본의 합집합 기준이며 코드에 고정하지 않습니다.

### 입력 데이터

- CSV 또는 CSV가 정확히 하나 들어 있는 ZIP을 지원합니다. ZIP은 메모리에서 읽고 무결성을 확인하며 원본을 저장소에 복사하거나 디스크에 압축 해제하지 않습니다.
- 실제 원본은 CP949이며 `서비스_업종_코드`·`서비스_업종_코드_명`을 사용합니다. UTF-8(BOM 포함)과 API 형식의 `SVC_INDUTY_CD`·`SVC_INDUTY_CD_NM` 헤더도 지원합니다. CSV의 인용부호·쉼표·개행을 파서로 처리합니다.

### 검증 규칙

- 코드는 `CS`와 숫자 6자리입니다. 빈 값·앞뒤 공백·손상된 명칭·모호한 헤더·열 수 오류를 거부하며, 동일 코드·명칭의 반복은 허용합니다. 동일 코드의 명칭 충돌은 원본 내부와 두 원본 사이 모두 실패 처리합니다.
- `fetched_rows`, `valid_rows`, `rejected_rows`는 두 CSV의 원본 행 수 기준입니다. 실패하면 중단 시점까지 확인한 행만 셉니다. 고유 업종 수와 원본별 행 수·인코딩은 CLI 결과와 `source_reference` JSON에서 구분하며, 예상 고유 업종 수를 `expected_rows`에 넣지 않습니다(`NULL` 유지).

### 적재 결과

현재 원본으로 점포 211,832행·100개 업종과 매출 100,431행·63개 업종을 검증해, 유효 312,263행·거부 0행·고유 업종 100개를 로컬 개발 DB에 적재했습니다. 카페 코드 `CS100010`(커피-음료)을 확인했고 동일 원본 재실행은 `SKIPPED`였습니다.

### 재실행·오류 처리

- 전체 검증 후 업종과 `PUBLISHED` 이력을 한 트랜잭션으로 반영합니다. 실패하면 업종 변경을 롤백하고 `FAILED` 이력을 남깁니다. DB 연결 자체가 불가능하면 이력을 기록할 수 없습니다. 입력에서 빠진 기존 업종은 삭제하지 않습니다.
- 원본 역할·CSV 바이트로 체크섬을 계산합니다. 경로·ZIP 포장만 바뀌어도 같은 원본으로 판단하며, 체크섬·ETL 버전과 현재 입력 업종의 명칭·출처가 모두 같을 때만 `SKIPPED` 처리합니다.

### 확인 SQL·테스트

확인 SQL은 저장소 루트에서 접속한 `psql`에서 실행합니다.

```sql
SELECT batch_id, status, source_checksum, fetched_rows, valid_rows, rejected_rows,
       source_reference, error_message
FROM etl_batch WHERE dataset_code = 'SEOUL_SERVICE_INDUSTRY' ORDER BY started_at DESC;
SELECT count(*) FROM service_industry;
SELECT i.industry_code, i.industry_name, i.source_batch_id, b.status
FROM service_industry i JOIN etl_batch b ON b.batch_id = i.source_batch_id
WHERE i.industry_code = 'CS100010';
```

업종 DB 통합 테스트는 `etl/`에서 `RUN_INDUSTRY_DB_TESTS=1 npm test -- src/industries.integration.test.ts`로 실행합니다. 경계 회귀 테스트까지 함께 실행하려면 `RUN_INDUSTRY_DB_TESTS=1 RUN_BOUNDARY_DB_TESTS=1 npm test`를 사용합니다. 각 테스트는 새 일회용 PostGIS 컨테이너와 테스트별 스키마를 사용하며 실제 개발 DB는 변경하지 않습니다.

## 점포 통계 적재

### 사전 조건

기존 Flyway V1~V3를 적용하고 경계·서비스 업종 기준 데이터를 먼저 적재합니다. 루트 `.env`를 내보낸 터미널에서 실행합니다.

### 실행 명령

다음 npm 명령은 환경변수를 내보낸 **`etl/` 터미널**에서 실행합니다.

```bash
npm run dev -- stores \
  --source "$HOME/Downloads/서울시 상권분석서비스(점포-행정동).csv" \
  --expected-rows 211832
```

### 입력 데이터

`--source`는 CSV 또는 CSV 하나를 포함한 ZIP 경로이며 UTF-8(BOM 포함)·CP949를 지원합니다. 필수 `--expected-rows`는 입력 버전의 전체 데이터 행 수(헤더 제외)입니다. `211832`는 검증한 파일의 기준이며 코드에 고정하지 않습니다. 빌드 실행은 `npm run build` 후 같은 인자를 `npm start -- stores …`에 전달합니다.

| 원본 CSV 헤더                                         | V3 컬럼                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `행정동_코드`, `서비스_업종_코드`, `기준_년분기_코드` | `dong_code`, `industry_code`, `quarter_code`                  |
| `전체_점포_수`, `일반_점포_수`, `프랜차이즈_점포_수`  | `store_count`, `general_store_count`, `franchise_store_count` |
| `개업_점포_수`, `폐업_점포_수`                        | `opened_store_count`, `closed_store_count`                    |
| `개업_율`, `폐업_률`                                  | `opening_rate`, `closure_rate`                                |

### 검증 규칙

- [V3 통계 매핑 표](data-design.md#v3-통계-컬럼과-저장-정책)의 API 영문 헤더도 지원하며, 필수 컬럼의 누락·중복·모호한 별칭을 거부합니다. 코드와 분기는 Zod로 검증하고 `(dong_code, industry_code, quarter_code)` 중복은 값이 같아도 실패 처리합니다.
- 측정값은 빈 셀만 `NULL`로 보존하며 실제 `0`과 구분합니다. 점포 수는 0 이상 BIGINT 범위의 정수 문자열, 비율은 0 이상 유한한 십진수 문자열로 검증합니다. 소수·지수 표기의 점포 수와 지수 표기의 비율은 거부하며, JavaScript `Number`로 변환하거나 반올림하지 않습니다. 비율의 100% 상한이나 세부 수치의 합계 일치는 강제하지 않습니다.
- FK 불일치는 거부 행 수와 누락 코드별 영향 행 수·분기 범위·첫 데이터 레코드(헤더 제외 1부터)를 보여줍니다. 코드별 예시는 최대 10개씩이며, 한 행에서 두 FK가 누락되어도 거부 행은 한 번만 셉니다. 기준 데이터 적재 누락이나 과거 행정구역·업종 버전을 확인해야 하며 코드를 임의 치환하지 않습니다.

### 적재 결과

실제 원본의 `20251`~`20262` 6개 분기, 행정동 425개·업종 100개에 해당하는 211,832행을 적재했습니다. 유효 211,832행·거부 0행, 카페 코드 `CS100010` 2,550행, 재실행 `SKIPPED`와 기존 기준 데이터 보존을 확인했습니다.

### 재실행·오류 처리

- 최대 1,000행씩 DB 스테이징 완료를 기다리며 전달하고, 전체 검증 후 트랜잭션 Upsert와 `PUBLISHED` 이력을 함께 확정합니다. 입력에 없는 기존 키는 삭제하지 않습니다. 실패하면 스테이징·Upsert를 롤백하고 `FAILED` 이력을 별도로 기록합니다.
- CSV 바이트의 체크섬·ETL 버전과 현재 입력 키의 모든 측정값·출처가 같을 때만 `SKIPPED`로 기록합니다. NULL과 0의 차이, DB 행 누락이나 수정도 비교하며, 다른 경로·ZIP 포장의 동일 CSV는 같은 원본으로 판단합니다.

### 확인 SQL·테스트

```sql
SELECT batch_id, status, expected_rows, fetched_rows, valid_rows, rejected_rows,
       period_from, period_to, source_checksum, source_reference, error_message
FROM etl_batch WHERE dataset_code = 'SEOUL_DONG_STORE_STAT' ORDER BY started_at DESC;
SELECT quarter_code, count(*) FROM dong_store_stat GROUP BY quarter_code ORDER BY quarter_code;
SELECT count(*) FROM dong_store_stat WHERE industry_code = 'CS100010';
```

점포 DB 통합 테스트는 `etl/`에서 `RUN_STORE_DB_TESTS=1 npm test -- src/stores.integration.test.ts`로 실행합니다. 기존 ETL 회귀까지 포함한 전체 테스트는 `RUN_STORE_DB_TESTS=1 RUN_INDUSTRY_DB_TESTS=1 RUN_BOUNDARY_DB_TESTS=1 npm test`로 실행하며, DB 테스트는 개발 DB와 분리된 새 일회용 PostGIS 컨테이너만 사용합니다.

## 추정매출 통계 적재

### 사전 조건

추정매출 ETL은 로컬 개발 DB에 100,431행 적재를 완료했습니다. 아래는 적재·재실행 명령입니다. 기존 Flyway V1~V3와 경계·서비스 업종 기준 데이터가 필요하며, 루트 `.env`를 내보낸 터미널에서 실행합니다.

### 실행 명령

다음 npm 명령은 환경변수를 내보낸 **`etl/` 터미널**에서 실행합니다.

```bash
npm run dev -- sales \
  --source "$HOME/Downloads/서울시 상권분석서비스(추정매출-행정동).csv" \
  --expected-rows 100431
```

### 입력 데이터

`--source`는 CSV 또는 CSV 하나를 포함한 ZIP이며 UTF-8(BOM 포함)·CP949를 지원합니다. `--expected-rows`는 헤더를 제외한 입력 버전의 전체 행 수입니다. `100431`은 검증한 파일의 기준이며 코드에 고정하지 않습니다. 빌드 결과는 `npm run build` 후 같은 인자를 `npm start -- sales …`에 전달합니다.

| 원본 CSV 헤더                                         | API 영문 헤더                                | V3 컬럼                                      |
| ----------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `기준_년분기_코드`, `행정동_코드`, `서비스_업종_코드` | `STDR_YYQU_CD`, `ADSTRD_CD`, `SVC_INDUTY_CD` | `quarter_code`, `dong_code`, `industry_code` |
| `당월_매출_금액`                                      | `THSMON_SELNG_AMT`                           | `monthly_sales_amount`                       |
| `당월_매출_건수`                                      | `THSMON_SELNG_CO`                            | `monthly_sales_count`                        |
| `주중_매출_금액`                                      | `MDWK_SELNG_AMT`                             | `weekday_sales_amount`                       |
| `주말_매출_금액`                                      | `WKEND_SELNG_AMT`                            | `weekend_sales_amount`                       |

### 검증 규칙

- 네 측정 컬럼은 빈 셀만 `NULL`로 저장하고 `0`과 구분합니다. `9007199254740993.0`, `9.223372036854775807e18`처럼 정수 의미인 소수·지수 표기는 문자열과 정수 연산으로 정확히 정규화합니다. 음수 표기(`-0` 포함), 비정수, BIGINT 범위 초과, NaN·Infinity·공백 값은 거부하며 반올림하지 않습니다.
- 필수 코드·분기·헤더와 복합키 중복을 검증합니다. 당월 값을 월평균으로 환산하지 않으며 주중·주말과 전체 매출액의 합계 일치를 강제하지 않습니다.
- 최대 1,000행씩 스테이징하고 실제 DB 스테이징 건수와 검증된 유효 행 수를 비교합니다. FK가 누락되면 코드별 영향 행·분기·첫 데이터 레코드를 보고하고 롤백하며, 기준 코드를 임의로 치환하지 않습니다.

### 적재 결과

검증한 추정매출 원본은 CP949, `20251`~`20262`의 6개 분기, 행정동 425개·업종 63개, 유효 100,431행·거부 0행이며 로컬 개발 DB 적재를 완료했습니다. 원본의 카페 코드 `CS100010`은 2,525행입니다. 이 수치는 검증한 입력 버전의 결과입니다.

### 재실행·오류 처리

- 전체 검증 후 Upsert와 `PUBLISHED` 이력을 한 트랜잭션으로 반영합니다. 원본에 없는 기존 키는 유지하고 실패하면 변경을 롤백한 뒤 `FAILED` 이력을 남깁니다. 동일 원본은 체크섬·ETL 버전과 현재 네 측정값·출처가 모두 같을 때만 `SKIPPED`로 처리합니다.

### 확인 SQL·테스트

```sql
SELECT batch_id, status, expected_rows, fetched_rows, valid_rows, rejected_rows,
       period_from, period_to, source_checksum, source_reference, error_message
FROM etl_batch WHERE dataset_code = 'SEOUL_DONG_SALES_STAT' ORDER BY started_at DESC;
SELECT quarter_code, count(*) FROM dong_sales_stat GROUP BY quarter_code ORDER BY quarter_code;
```

추정매출 DB 통합 테스트는 `etl/`에서 `RUN_SALES_DB_TESTS=1 npm test -- src/sales.integration.test.ts`로 실행합니다. 모든 ETL의 단위·격리 DB 통합 테스트 명령은 아래 유동인구 안내를 참고하세요. 합성 테스트 데이터는 새 일회용 PostGIS 컨테이너에만 적재하며 실제 개발 DB는 변경하지 않습니다.

## 유동인구 통계 적재

### 사전 조건

`foot-traffic`은 길단위인구-행정동 원본을 `dong_foot_traffic_stat`에 적재합니다. 로컬 개발 DB에 9,350행을 실제 적재하고 동일 원본 재실행 검증을 완료했습니다. 기존 Flyway V1~V3와 행정동 경계 데이터가 필요합니다. 업종 기준 데이터는 참조하지 않습니다.

루트 `.env`를 내보낸 터미널에서 다음과 같이 실행합니다.

### 실행 명령

다음 npm 명령은 환경변수를 내보낸 **`etl/` 터미널**에서 실행합니다.

```bash
npm run dev -- foot-traffic \
  --source "$HOME/Downloads/서울시 상권분석서비스(길단위인구-행정동).csv" \
  --expected-rows 9350
```

### 입력 데이터

`--source`는 CSV 또는 CSV 하나가 포함된 ZIP이며 UTF-8(BOM 포함)·CP949를 지원합니다. `--expected-rows`는 헤더를 제외한 입력 버전의 전체 행 수입니다. `9350`과 22개 분기는 검증한 원본의 참고값이며 코드에 고정하지 않습니다. 빌드 후에는 `npm start -- foot-traffic …`로 실행할 수 있습니다.

| 원본 CSV 헤더      | API 영문 헤더  | V3 컬럼               |
| ------------------ | -------------- | --------------------- |
| `기준_년분기_코드` | `STDR_YYQU_CD` | `quarter_code`        |
| `행정동_코드`      | `ADSTRD_CD`    | `dong_code`           |
| `총_유동인구_수`   | `TOT_FLPOP_CO` | `total_foot_traffic`  |
| `남성_유동인구_수` | `ML_FLPOP_CO`  | `male_foot_traffic`   |
| `여성_유동인구_수` | `FML_FLPOP_CO` | `female_foot_traffic` |

### 검증 규칙

- 세 측정값은 `Number`로 변환하지 않고 문자열로 검증·전달해 `NUMERIC`의 정수·소수 정밀도를 보존합니다. 소수·지수 표기를 반올림하지 않으며 PostgreSQL `NUMERIC` 범위를 벗어난 값, 음수 표기(`-0` 포함), NaN·Infinity·공백 값은 거부합니다. 빈 셀만 `NULL`로 취급하고 `0`과 구분합니다.
- 필수 헤더·행정동·분기와 `(dong_code, quarter_code)` 중복을 검증합니다. 전체와 남성·여성 합계의 일치는 강제하지 않습니다.
- 최대 1,000행씩 스테이징하고 실제 스테이징 건수를 검증된 유효 행 수와 비교합니다. 행정동 FK 누락 시 코드별 영향 행·분기·첫 데이터 레코드를 보고하고, 코드를 임의 치환하지 않습니다.

### 적재 결과

격리 DB에서 NUMERIC 정밀도·롤백·재실행을 검증했습니다. CP949 원본을 로컬 개발 DB에 실제 적재한 결과 `20211`~`20262`의 22개 분기·425개 행정동, 유효 9,350행·거부 0행이었습니다. 동일 원본 재실행은 `SKIPPED`였으며 기존 데이터와 출처(`source_batch_id`)가 보존됨을 확인했습니다. 이 건수는 적재한 입력 버전의 결과입니다.

### 재실행·오류 처리

- 전체 검증 후 Upsert와 `PUBLISHED` 이력을 한 트랜잭션으로 반영합니다. 실패 시 이전 데이터·출처를 보존하고 `FAILED`를 기록하며, 입력에 없는 기존 키는 삭제하지 않습니다. 같은 체크섬·ETL 버전이어도 실제 세 측정값·출처가 다르면 다시 반영하고 모두 같을 때만 `SKIPPED`로 기록합니다.

### 확인 SQL·테스트

```sql
SELECT batch_id, status, expected_rows, fetched_rows, valid_rows, rejected_rows,
       period_from, period_to, source_checksum, source_reference, error_message
FROM etl_batch WHERE dataset_code = 'SEOUL_DONG_FOOT_TRAFFIC_STAT' ORDER BY started_at DESC;
SELECT quarter_code, count(*) FROM dong_foot_traffic_stat GROUP BY quarter_code ORDER BY quarter_code;
```

유동인구 DB 통합 테스트는 `etl/`에서 `RUN_FOOT_TRAFFIC_DB_TESTS=1 npm test -- src/foot-traffic.integration.test.ts`로 실행합니다. 전체 ETL 단위·격리 DB 통합 테스트는 다음 명령으로 실행합니다. 합성 테스트 데이터는 새 일회용 PostGIS 컨테이너에만 적재하며 실제 개발 DB는 변경하지 않습니다.

```bash
RUN_CAFE_DB_TESTS=1 RUN_FOOT_TRAFFIC_DB_TESTS=1 RUN_SALES_DB_TESTS=1 RUN_STORE_DB_TESTS=1 RUN_INDUSTRY_DB_TESTS=1 RUN_BOUNDARY_DB_TESTS=1 npm test
```

## 카페 API 수집·적재

### 사전 조건

게시 모드에는 V4와 서울 경계 기준 데이터가 필요합니다. 확인 전용 `--probe`는 DB 설정·접속 없이 실행합니다.

[공식 상가(상권)정보 API](https://www.data.go.kr/data/15012005/openapi.do)의 활용 승인을 받은 뒤 Decoding 인증키를 `SEMAS_API_KEY` 환경변수로만 설정합니다. 키를 CLI 인자·소스·README·인증 URL에 복사하거나 출력하지 않습니다. 공식 분류에서 확인한 코드와 명칭을 각각 `SEMAS_CAFE_INDUSTRY_CODE`, `SEMAS_CAFE_INDUSTRY_NAME` 터미널 변수에 설정한 뒤 실행합니다. 아래 두 분류 변수는 셸의 인자 전달용이며 인증키가 아닙니다.

### 실행 명령

다음 npm 명령은 API 인증키와 카페 분류 변수를 설정한 **`etl/` 터미널**에서 실행합니다. `--probe`는 DB 환경변수가 필요 없으며, 실제 게시 모드만 루트 DB 설정을 내보냅니다.

#### 확인 전용 (`--probe`)

**확인 전용:** 공식 카페 분류와 업소 첫 페이지 최대 5행의 응답 형식·필수값을 확인합니다. 실제 API 요청은 발생하지만 DB 연결·배치 이력·적재는 없고, 이후 페이지는 요청하지 않습니다. 전체 수집·서울 district 대조·PostGIS 검증을 완료했다는 뜻이 아니며 결과는 `mode='PROBE'`, `databaseChecked=false`, `complete=false`로 표시합니다.

```bash
npm run dev -- cafes --probe \
  --industry-code "$SEMAS_CAFE_INDUSTRY_CODE" \
  --industry-name "$SEMAS_CAFE_INDUSTRY_NAME"
```

#### 실제 게시

**실제 게시:** 루트 `.env`의 DB 설정을 내보낸 터미널에서 `--probe` 없이 실행합니다. 모든 페이지를 수집하고 DB·공간 검증을 통과하면 로컬 개발 DB에 게시하며 `PUBLISHED`·`SKIPPED`·`FAILED` 이력을 기록합니다.

```bash
# etl/ 디렉터리에서 실행
npm run dev -- cafes \
  --industry-code "$SEMAS_CAFE_INDUSTRY_CODE" \
  --industry-name "$SEMAS_CAFE_INDUSTRY_NAME"
```

### 입력 데이터

- 선택적인 `--expected-rows`는 해당 원본 전체 건수와 대조합니다. 생략해도 게시 모드는 API가 알린 전체 건수와 모든 페이지의 실제 수집·유효·스테이징 건수를 확인합니다. `--probe`에서는 원천 전체 건수 메타데이터와 비교할 뿐 전체 페이지를 수집하지 않습니다. 빌드 후에는 `npm start -- cafes …`로 실행합니다.

### 검증 규칙

#### 업종·페이지 검증

- 공식 분류 목록의 카페 소분류 코드·명칭과 실제 업소 응답이 정확히 일치해야 합니다. 후보 코드나 서울시 `CS100010`을 소진공 코드로 간주하지 않으며, 확인하지 못한 분류·빈 전체 목록은 `PUBLISHED`로 게시하지 않습니다.
- 고정 HTTPS 엔드포인트의 `smallUpjongList`와 `storeListInDong`을 사용합니다. 서울 시도 코드 `11`로 모든 페이지를 요청하고 기준년월·전체 건수·페이지 메타데이터·서울 범위·업소번호 중복을 검증합니다. 타임아웃·요청 간격·제한된 재시도로 요청 폭주를 막고 인증 실패·오류·비정상 JSON을 안전하게 실패 처리합니다.

#### 행정동 연결·좌표 검증

- 원본 `signguCd`를 스테이징에 전달해 현재 서울 `district` 코드와 대조합니다.
- 미등록·서울 외 코드는 좌표·행정동이 없어도 게시·SKIPPED 전에 거부하며 코드별 영향 행 수를 보고합니다.
- 행정동 원문은 보존하며 원본 시군구에 속한 8자리 기준 코드가 정확히 존재할 때만 FK에 연결합니다.
- 좌표는 WGS84 경도·위도 순서이며 둘 다 누락되면 NULL, 일부 누락·잘못된 좌표·서울 경계 밖은 실패합니다.
- 행정동 경계 불일치는 `spatial_mismatch_rows`로 보고하고 자동 수정하지 않습니다.
- 미연결 코드·좌표 누락 건수도 출처 JSON에 기록합니다.

### 적재 결과

V4는 개발 DB에 적용되었으며 실제 API의 소진공 카페 분류 `I21201`·`카페`와 응답 형식 검증을 완료했습니다. `202609` 기준 원본 21,996건을 `PUBLISHED`로 적재했고, 동일 원본 재실행 `SKIPPED` 및 기존 게시 출처 보존을 확인했습니다. 이 코드·명칭·건수는 검증한 원본의 결과이며 매 실행 시 다시 검증합니다.

실제 적재 결과는 유효 21,996건·거부 0건입니다. 게시 배치는 `0e149f16-5b3a-45c9-8473-379cc3b67206`, 재실행 `SKIPPED` 배치는 `01a020f8-7984-48e8-bc5b-884a62dd76ed`입니다. 로컬 DB를 읽기 전용으로 확인한 결과 `cafe_store` 21,996행 모두 기존 게시 배치의 `source_batch_id`를 유지하고 있으며, SKIPPED 배치의 `published_at`은 NULL입니다.

### 재실행·오류 처리

- 페이지별로 검증한 데이터를 최대 1,000행씩 스테이징하고, 모든 페이지 검증 후 트랜잭션 Upsert로 게시합니다. 실패 시 이전 정상 데이터·출처를 보존하고 `FAILED`를 기록합니다. 새 게시에서는 모든 수집 업소의 출처를 새 배치로 갱신하고 원본에 없는 과거 업소를 삭제하지 않습니다.
- 정규화한 원본·수집 조건의 체크섬과 최신 전체 `PUBLISHED`의 실제 값·출처가 같을 때만 `SKIPPED`로 기록합니다. 과거 동일 체크섬만으로 생략하지 않습니다. SKIPPED는 이전 게시 출처를 유지하며 전체 최신 목록의 기준 배치를 대체하지 않습니다.

### 확인 SQL·테스트

최신 목록은 테이블 전체가 아닌 완전한 서울 게시 배치만 조회합니다. 과거에만 존재한 업소는 보존되지만 최신 목록에 섞이지 않습니다.

```sql
WITH latest AS (
  SELECT batch_id FROM etl_batch
  WHERE dataset_code = 'SEMAS_CAFE_STORE' AND status = 'PUBLISHED'
    AND source_type = 'API' AND scope_type = 'SEOUL' AND scope_code IS NULL
    AND published_at IS NOT NULL
    AND CASE
      WHEN pg_input_is_valid(source_reference, 'jsonb')
      THEN source_reference::jsonb @>
        '{"collection_mode":"FULL_SEOUL","complete":true,"classification_verified":true}'::jsonb
      ELSE false
    END
  ORDER BY published_at DESC, started_at DESC, batch_id DESC LIMIT 1
)
SELECT c.* FROM cafe_store c JOIN latest b ON c.source_batch_id = b.batch_id;
```

`source_reference`는 V2에서 JSON 타입이 아닌 `TEXT NOT NULL`입니다. 위 예시는 프로젝트의 PostgreSQL 17에서 `pg_input_is_valid(..., 'jsonb')`로 **jsonb 입력 가능 여부**를 검사하고, 통과한 행에서만 `CASE` 안의 형 변환을 수행합니다. 잘못된 JSON, jsonb가 허용하지 않는 Unicode·수치도 제외합니다. JSON 문법 검사만으로 jsonb 변환 가능성을 보장하지 않습니다.

별도의 `AND` 조건 나열은 평가 순서를 보장하지 않으므로 형 변환 보호 수단으로 사용하지 않습니다. 이 예시는 행의 TEXT 컬럼을 변환하며, `CASE`가 모든 상수식·집계식의 선행 평가까지 막는다는 의미는 아닙니다. 근거는 PostgreSQL 17의 [입력 유효성 검사](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-INFO-VALIDITY), [표현식 평가 순서](https://www.postgresql.org/docs/17/sql-expressions.html#SYNTAX-EXPRESS-EVAL), [JSON 타입 제약](https://www.postgresql.org/docs/17/datatype-json.html)입니다.

모의 API 단위 테스트는 `npm test -- src/cafe-source.test.ts`, 카페 격리 DB 통합 테스트는 `RUN_CAFE_DB_TESTS=1 npm test -- src/cafes.integration.test.ts`로 실행합니다. API 인증키는 테스트에 필요하지 않습니다. DB 테스트는 새 일회용 PostGIS 컨테이너만 사용하며 개발 DB에 접근하지 않습니다.
