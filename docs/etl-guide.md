# ETL 가이드

공공데이터 원본을 준비하고, 읽기 전용 검증을 거쳐, 의도한 로컬 DB에 게시하는 절차입니다. 현재 ETL은 수동으로 실행합니다. 입력 판본별 실측치·해시·게시 배치·검증 범위는 [ETL 검증·적재 이력](archive/etl-validation-history.md), 저장·REST·집계 계약은 [데이터 설계](data-design.md)에 있습니다. [README의 상세 기술 문서](../README.md#상세-기술-문서)

## 목차

- [공공데이터와 인증키](#공공데이터와-인증키)
- [설치 및 공통 실행](#설치-및-공통-실행)
- [공통 입력 검증과 게시](#공통-입력-검증과-게시)
- [읽기 전용 검증](#읽기-전용-검증)
  - [공식 자치구 CSV 갱신 사전검증](#공식-자치구-csv-갱신-사전검증)
  - [서울시 Open API 전체 수집 probe](#서울시-open-api-전체-수집-probe)
- [실제 적재 명령 9개](#실제-적재-명령-9개)
- [게시 확인과 테스트](#게시-확인과-테스트)

## 공공데이터와 인증키

서울시 경계와 통계는 서울 열린데이터광장, 카페 API는 공공데이터포털에서 확인합니다. [서울 열린데이터광장](https://data.seoul.go.kr/) · [공공데이터포털](https://www.data.go.kr/index.do)

| 원천                                                                                                                                                                                                                                                              | ETL에서 사용하는 범위                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [행정동 영역 OA-22160](https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do)                                                                                                                                                                             | 행정동 Shapefile과 이를 결합한 자치구 경계           |
| [행정동 점포 OA-22172](https://data.seoul.go.kr/dataList/OA-22172/S/1/datasetView.do) · [행정동 추정매출 OA-22175](https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do)                                                                                 | 통계와 서울시 서비스 업종 기준 데이터                |
| [행정동 길단위인구 OA-22178](https://data.seoul.go.kr/dataList/OA-22178/S/1/datasetView.do)                                                                                                                                                                       | 총·남성·여성 유동인구                                |
| [자치구 점포 OA-22173](https://data.seoul.go.kr/dataList/OA-22173/S/1/datasetView.do) · [추정매출 OA-22176](https://data.seoul.go.kr/dataList/OA-22176/S/1/datasetView.do) · [길단위인구 OA-22179](https://data.seoul.go.kr/dataList/OA-22179/S/1/datasetView.do) | 공식 자치구 통계 3종. 각 자료를 별도로 검증하고 게시 |
| [소상공인시장진흥공단 상가(상권)정보 API](https://www.data.go.kr/data/15012005/openapi.do)                                                                                                                                                                        | 공식 카페 소분류와 서울 전체 업소 목록               |

서울시 CSV·ZIP은 데이터셋의 파일 또는 Sheet CSV 내려받기로 확보합니다. Sheet 미리보기는 전체 행 수의 근거로 쓰지 않습니다. 발급 키와 별도로 서비스별 요청 제한·이용조건·제공 범위를 확인합니다. 경계·통계 파일과 로컬 CSV probe에는 인증키가 필요 없습니다. [서울시 상권분석서비스의 다운로드 안내](https://golmok.seoul.go.kr/introduce.do)

- `SEMAS_API_KEY`는 공공데이터포털에서 상가(상권)정보 API 활용을 신청하고 승인 상태를 확인한 뒤 **Decoding 키**로 설정합니다. 다른 API의 이용 권한은 서비스별로 확인합니다. [공공데이터포털](https://www.data.go.kr/) · [활용신청과 명세](https://www.data.go.kr/data/15012005/openapi.do)
- `SEOUL_OPEN_API_KEY`는 서울 열린데이터광장의 일반 인증키입니다. 일부 별도 서비스는 다른 키가 필요합니다. OA-22179의 공식 HTTP 주소에는 명시적 허용 옵션이 필요합니다. [인증키 신청](https://data.seoul.go.kr/together/mypage/actkeyMain.do) · [서울시 Open API 이용안내](https://data.seoul.go.kr/together/guide/useGuide.do)

실제 키는 서버 측 환경변수로만 전달합니다. 키·원본·로컬 manifest·실제 `.env`는 저장소에 올리지 않으며 키나 인증 요청 URL을 로그에 남기지 않습니다.

API 전환 후보와 인증·판본 검증 조건은 [공공데이터 ETL API 전환 계획](etl-api-migration-plan.md)에 정리했습니다.

### 추가 활용 검토 원천

[상주인구 OA-22183](https://data.seoul.go.kr/dataList/OA-22183/S/1/datasetView.do), [직장인구 OA-22184](https://data.seoul.go.kr/dataList/OA-22184/S/1/datasetView.do), [집객시설 OA-22169](https://data.seoul.go.kr/dataList/OA-22169/S/1/datasetView.do), [상권변화지표 OA-15575](https://data.seoul.go.kr/dataList/OA-15575/S/1/datasetView.do), [상권 영역 OA-15560](https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do), [지하철 승하차 OA-12914](https://data.seoul.go.kr/dataList/OA-12914/S/1/datasetView.do)는 검토 대상입니다.

## 설치 및 공통 실행

저장소 루트에서 Node.js 24 LTS·npm 11 환경을 준비하고 다음을 실행합니다. 이후 npm 명령은 모두 `etl/`에서 실행합니다.

```bash
cd etl
nvm use
npm ci
npm run dev -- --help
```

개발 명령은 [`src/index.ts`](../etl/src/index.ts)를 실행합니다. 빌드 결과를 사용할 때는 `npm run build` 후 같은 인자를 `npm start -- …`에 전달해 `dist/index.js`를 실행합니다. 두 방식 모두 인자 없이 실행하거나 `--help`를 지정하면 DB 접속 없이 도움말을 표시합니다. [CLI 인자 파서](../etl/src/cli/arguments.ts)

| 모드                                    | 읽는 범위                                                                  | DB·외부 요청                                                      |
| --------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 자치구 통계 3종의 `--probe`             | 지정 CSV 또는 단일 CSV ZIP 전체                                            | DB·인증키·네트워크 없이 검증                                      |
| `official-sources --probe --manifest`   | manifest의 자치구 원본 3종 전체, 기대 행 수·선택적 해시·관찰 커버리지 대조 | DB·인증키·네트워크 없이 검증                                      |
| `district-foot-traffic --api --probe`   | 서울시 API 전체 페이지, 선택적 CSV 대조                                    | DB 없이 검증. 공식 HTTP는 명시적 허용과 일반 키 필요              |
| `district-foot-traffic --api --publish` | OA-22179 전체 페이지 검증 후 staging·FK 검사·게시                          | 일반 키와 loopback DB 필요. 전체 수집 실패는 `FAILED` 배치로 기록 |
| `cafes --probe`                         | 소진공 공식 분류와 첫 페이지 최대 5행                                      | `SEMAS_API_KEY`로 실제 HTTPS API 요청. DB·배치 생성 없음          |
| 적재 명령 9개                           | 전체 원본 검증, FK·staging 검사 후 게시                                    | 대상 로컬 DB 변경. 카페는 실제 API 전체 수집                      |

### 작업 디렉터리와 환경변수

적재 전 [로컬 DB 준비](development.md#로컬-db-준비), 대상 DB·백업·권한, 필요한 Flyway 버전·기준 데이터를 확인합니다. 같은 로컬 DB를 사용하는 경우 실행 셸에서 루트 `.env`를 내보낸 뒤 `etl/`로 이동합니다.

```bash
# 저장소 루트. 이미 etl/이면 source ../.env를 사용합니다.
set -a
source .env
set +a
```

| 변수                                      | 용도                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                            | ETL 접속 주소. `localhost`, `127.0.0.1`, `::1`의 로컬 개발 DB만 허용하며 URL 쿼리로 호스트를 덮어쓸 수 없습니다. URL 비밀번호의 예약 문자는 인코딩합니다. |
| `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS` | 양의 정수. 기본 연결 풀 최대 10개, 연결 대기 5,000ms                                                                                                      |
| `SEMAS_API_KEY`, `SEOUL_OPEN_API_KEY`     | 카페 API와 서울시 API의 서버 측 키                                                                                                                        |

셸에서 내보낸 값은 `etl/.env`보다 우선합니다. 별도 ETL 설정은 `etl/`에서 `cp -n .env.example .env`로 준비할 수 있습니다. `npm run dev`와 `npm start`는 실행 위치의 `.env`를 읽으며, DB 설정 검증과 풀 생성은 적재에서만 사용합니다. 읽기 전용 파일 검증에는 DB 설정을 준비할 필요가 없습니다. [루트 예시](../.env.example) · [ETL 예시](../etl/.env.example)

## 공통 입력 검증과 게시

### CSV와 숫자·키

- 업종·통계는 UTF-8(BOM 포함) 또는 CP949 CSV와 CSV 하나를 담은 ZIP을 지원합니다. ZIP은 무결성·CRC와 512 MiB 제한을 확인하며 메모리에서 읽습니다. 통계의 SHA-256은 내부 CSV 바이트를 기준으로 하므로 경로와 ZIP 포장만 달라져도 원본 식별값은 같습니다. 경계·복수 원천 업종·카페는 아래 명령별 체크섬 규칙을 따릅니다.
- 필수 한글·영문 헤더를 지원하며 누락·중복·빈 헤더·동일 필드의 모호한 별칭·행 길이 불일치는 실패합니다. 코드와 분기를 문자열로 보존합니다. 통계 키는 자치구 ASCII 5자리 또는 행정동 ASCII 8자리와 `YYYYQ`(분기 1~4), 점포·매출의 `CS`+ASCII 숫자 6자리입니다. 인구에는 업종 키가 없습니다. 동일 값이어도 복합키가 중복되면 실패합니다. `--expected-rows`는 헤더를 제외한 해당 판본의 전체 데이터 행 수이며 양의 안전한 정수입니다.
- 빈 수치 셀은 NULL이고 실제 0·원본에 없는 행과 구분합니다. 공백·문자 `NULL`·NaN·Infinity를 0이나 NULL로 치환하지 않습니다. 채택 수치는 JavaScript `Number` 변환이나 반올림 없이 검증합니다.

| 수치                                | 허용 형식과 보존 규칙                                                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 행정동 점포의 건수                  | 0 이상 BIGINT 정수 문자열. 소수·지수 표기를 거부합니다.                                                                                                                                                                      |
| 자치구 점포의 건수와 구·동 추정매출 | 0 이상 BIGINT 정수 의미. `749.0`·정수 의미 지수 표기는 정확한 정수 문자열로 정규화합니다. 비정수·음수 표기(`-0` 포함)·범위 초과는 거부합니다.                                                                                |
| 구·동 개·폐업률                     | 0 이상 일반 십진수만 허용합니다. 지수 표기는 거부하며 소수 자릿수·후행 0을 유지합니다. 100% 상한·합계 일치·재계산은 강제하지 않습니다.                                                                                       |
| 구·동 길단위인구                    | 0 이상 NUMERIC. 허용 범위의 소수·지수를 정확히 정규화하고 소수 자릿수와 실제 0을 유지합니다. 음수 표기(`-0` 포함)·범위 초과는 거부합니다. 범위를 벗어난 지수로 표기한 0은 기존 판독 규칙대로 전개 없이 `"0"`으로 유지합니다. |

BIGINT는 최댓값 `9223372036854775807`, NUMERIC은 정수부 131,072자리·소수부 16,383자리 한계를 적용합니다. 매출의 당월 기간 의미와 주중·주말 합계 차이, 인구의 총계·성별 합계 차이는 원본대로 보존합니다. [공식 자치구와 지표별 집계 정책](data-design.md#공식-자치구-통계와-집계-정책)

### staging·FK·배치 상태

통계·카페는 검증된 행을 최대 1,000행씩 staging하고 전체 수집·유효 건수와 실제 적재 후보를 확인합니다. 통계는 적용되는 지역·업종 FK를 조회하며, 업종 기준을 참조하지 않는 인구는 지역 FK만 확인합니다. 행정동 통계의 누락 FK는 영향 행 수·분기 범위·첫 데이터 레코드(헤더 제외 1부터)를 보고합니다. 점포는 코드별 예시를 최대 10개씩 보여 주고 두 FK가 모두 없는 행은 한 번만 셉니다. 코드 치환으로 적재를 진행하지 않습니다.

게시 시 데이터셋별 쓰기를 직렬화하고 필요한 기준 데이터를 잠급니다. 서비스 테이블 Upsert와 정상 게시 이력은 같은 트랜잭션에서 확정합니다. 통계는 입력에 빠진 기존 키·출처를 보존하고 누락 조합을 생성하지 않습니다. 경계의 기존 코드 누락은 아래 별도 규칙으로 중단합니다.

| `etl_batch` 상태 | 의미                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNNING`        | 수집·검증·적재가 진행 중인 실행                                                                                                                                       |
| `PUBLISHED`      | 전체 검증을 통과한 서비스 데이터와 게시 이력을 함께 확정한 실행                                                                                                       |
| `SKIPPED`        | 동일 원본·ETL 버전 및 대상 값·출처가 명령별 기준에 맞는지 확인하고 기존 정상 게시 데이터를 유지한 실행. 새 게시 시각을 부여하거나 통계 행의 출처를 덮어쓰지 않습니다. |
| `FAILED`         | 수집·검증·DB 반영이 실패한 실행. 부분 변경은 롤백하고 이전 정상 데이터·출처를 유지합니다. 배치 생성 전 또는 DB 연결 자체가 불가능하면 이력을 남기지 못할 수 있습니다. |

같은 체크섬이어도 대상 행이 없거나 값·출처가 다르면 복구해 새로 게시합니다. 비율·인구는 소수 자릿수와 NULL/0까지 비교합니다. 오류 출력에 원본 값·접속정보를 포함하지 않으며 배치의 로컬 경로·오류 세부 정보는 외부에 공유하지 않습니다.

## 읽기 전용 검증

로컬 자치구 probe는 적재와 같은 파일 검증기를 사용합니다. 필수 옵션·중복 옵션·경로·예상 행 수를 검증하고 표본 제한 뒤 마지막 행까지 검사합니다. 성공 JSON은 `mode=PROBE`, `validationScope=LOCAL_FILE_FORMAT`, `databaseChecked=false`, `batchCreated=false`, `loadedRows=0`과 데이터셋, 인코딩·SHA-256·예상/판독/유효/거부 건수·관찰 분기 범위·최대 5행을 포함합니다. 원본 경로·ZIP entry·NULL별 집계·분기별 구 커버리지는 개별 probe 출력에 포함하지 않습니다. 실패는 종료 코드 1과 안전한 오류로 보고하며 부분 성공 JSON을 반환하지 않습니다. DB의 FK나 게시 준비 여부는 실제 적재에서 확인합니다.

### 자치구 점포 읽기 전용 검증

```bash
npm run dev -- district-stores --probe --source /절대경로/자치구점포.csv --expected-rows 54765
```

3개 코드와 7개 측정값을 검사합니다. 명칭은 키에 포함하지 않습니다. [OA-22173 출력항목](https://data.seoul.go.kr/dataList/OA-22173/A/1/datasetView.do) · [V5 원천·저장 컬럼 대응](data-design.md#v5-자치구-점포-컬럼과-etl-계약)

### 자치구 추정매출 읽기 전용 검증

```bash
npm run dev -- district-sales --probe --source /절대경로/자치구매출.csv --expected-rows 33803
```

3개 코드와 채택한 당월 금액·당월 건수·주중 금액·주말 금액만 검증합니다. [헤더와 출력 계약](data-design.md#자치구-추정매출-원본-probe-계약)

### 자치구 길단위인구 읽기 전용 검증

```bash
npm run dev -- district-foot-traffic --probe --source /절대경로/자치구인구.csv --expected-rows 550
```

자치구·분기와 총·남성·여성 세 수치만 검증합니다. 파일의 전체 컬럼 수·완전 조합은 다른 판본에 강제하지 않습니다. 위 세 명령의 건수는 검증한 원본 예시입니다. 읽기 전용 실행에는 `--probe`를 붙입니다. 생략하면 적재 모드입니다. [헤더와 출력 계약](data-design.md#자치구-길단위인구-원본-probe-계약)

### 공식 자치구 CSV 갱신 사전검증

UTF-8 JSON manifest를 저장소 밖에 준비합니다. 세 데이터셋을 각 한 번 지정하고 판본별 전체 행 수를 입력합니다. `source`는 절대경로 또는 manifest 디렉터리 기준 상대경로입니다. 아래 건수는 형식 예시입니다.

```json
{
  "datasets": [
    { "datasetId": "OA-22173", "source": "stores.csv", "expectedRows": 3 },
    { "datasetId": "OA-22176", "source": "sales.zip", "expectedRows": 2 },
    { "datasetId": "OA-22179", "source": "foot-traffic.csv", "expectedRows": 2 }
  ]
}
```

독립적으로 확인한 내부 CSV SHA-256이 있으면 해당 항목에 64자리 16진수 문자열 `expectedSha256`을 추가합니다. `--probe`와 `--manifest`는 각각 한 번 지정합니다.

```bash
npm --silent run dev -- official-sources --probe --manifest /절대경로/official-sources.json
```

- 결과는 데이터셋별 검증 상태·실제/유효/거부 건수·체크섬·기간과 분기별 자치구 목록을 담습니다. `checksumVerification`은 `MATCHED`, `MISMATCH`, `NOT_PROVIDED`, `NOT_CHECKED`(기대값은 있으나 해시를 구하지 못함)를 구분합니다. 성공은 출처의 공식성이나 게시 적격성을 인증하지 않습니다.
- 세 입력이 통과하면 `coverageComparison`에서 분기·자치구·분기별 자치구 집합의 일치 여부를 보고합니다. 범위·업종 차이는 정보로 표시하며 조합·수치를 보정하지 않습니다.
- 파일 누락·형식·건수·해시 오류는 해당 데이터셋과 전체를 `FAIL`로 표시하고 종료 코드 1을 반환합니다. 판독 미완료 파일의 전체 건수·기간·커버리지는 `null`입니다. manifest 오류는 원본을 읽기 전에 거부합니다. JSON에는 원본 경로·ZIP entry·행 값이 없습니다.

### 서울시 Open API 전체 수집 probe

OA-22179의 `VwsmSignguFlpopW`만 대상으로 하는 인증 읽기 전용 모드입니다. 현재 공식 주소인 `http://openapi.seoul.go.kr:8088`은 `--allow-insecure-http`가 있을 때만 허용합니다. 옵션이 없거나 키가 없거나 `sample`이면 요청 전에 `BLOCKED`로 종료합니다(코드 1). 검증된 공식 HTTPS 주소를 코드의 허용 목록에 등록하면 HTTP 옵션 없이 사용할 수 있습니다. [OA-22179 API 명세](https://data.seoul.go.kr/dataList/OA-22179/S/1/datasetView.do?tab=A) · [2026-11-10 공개 표본과 HTTPS 확인](archive/etl-validation-history.md#oa-22179-공개-표본과-https-확인-2026-11-10)

**HTTP에서는 요청 경로의 인증키와 응답이 평문으로 전송됩니다.** 네트워크 중간에서 키를 읽거나 응답을 변조할 수 있습니다. 인증 URL을 로컬 로그에 남기지 않아도 이 위험은 남습니다. 실제 키를 보내는 자동 검증은 사용자가 전송을 명시적으로 승인한 경우에만 실행합니다. 공개 `sample`은 실키 없이 최대 5행과 전체 건수 메타데이터를 확인하는 별도 조회입니다.

위 위험을 수락해 직접 실행할 때는 [인증키 설정](development.md#서울시-open-api-인증키)을 마치고 `etl/`에서 다음 명령을 사용합니다. `npm run dev`는 `etl/.env` 또는 실행 셸의 환경변수를 읽습니다. 루트 `.env`를 사용할 경우 `node --env-file=../.env --import tsx src/index.ts` 뒤에 같은 인자를 전달합니다.

```bash
npm run dev -- district-foot-traffic \
  --api --probe --allow-insecure-http \
  --expected-rows 550 \
  --compare-csv /절대경로/자치구인구.csv
```

- 공식 요청 형식은 `/{KEY}/json/{SERVICE}/{START_INDEX}/{END_INDEX}/`입니다. 1부터 양끝을 포함해 공식 페이지 상한 1,000행 중 CLI는 최대 100행씩 순차 수집합니다. `RESULT.CODE=INFO-000`, 각 구간 행 수, 모든 페이지의 동일한 `list_total_count`와 유일한 자치구·분기 키가 필요합니다. 결과는 페이지 수·건수·분기 범위·최대 5행을 반환합니다. 전체 수집 검증은 다른 판본과의 일치나 모든 구·분기 제공을 확정하지 않습니다.
- 선택적 `--expected-rows`는 독립적으로 확인한 API 전체 건수와 대조합니다. `--compare-csv /절대경로/자치구인구.csv`는 CSV 또는 단일 CSV ZIP의 전체 복합키와 공통 키의 세 수치를 비교합니다. 지수·후행 0이 달라도 정확한 십진수 값이 같으면 일치로 보고 NULL과 0은 구분합니다. 차이는 API 전용·CSV 전용·수치 불일치 행 수로 보고하며 원문·경로 없이 실패합니다.
- 전체 수집과 요청한 CSV 대조가 모두 끝난 뒤에만 성공 JSON을 반환합니다. `databaseChecked=false`, `batchCreated=false`, `loadedRows=0`이며, 예시의 550행은 대상 판본의 기대 건수입니다.
- 숫자 원문 토큰을 유지해 기존 스키마로 검증합니다. 요청·본문 읽기 10초, 연결·타임아웃·일시적 HTTP 오류는 최대 한 번 재시도, 페이지당 4 MiB, 전체 100,000행, 정규화 수치 문자열 32 MiB를 적용합니다. 리다이렉트를 따르지 않으며 외부 오류 원문·응답 메시지·요청 URL을 출력하지 않습니다.

### 카페 API 첫 페이지 probe

소진공 공식 분류에서 확인한 코드와 명칭을 아래 두 셸 변수에 준비합니다. 이 변수는 CLI 인자이며 인증키는 별도로 `SEMAS_API_KEY`에만 설정합니다.

```bash
npm run dev -- cafes --probe \
  --industry-code "$SEMAS_CAFE_INDUSTRY_CODE" --industry-name "$SEMAS_CAFE_INDUSTRY_NAME"
```

공식 카페 분류와 업소 첫 페이지 최대 5행의 형식·필수값을 확인합니다. `mode=PROBE`, `databaseChecked=false`, `complete=false`이며 이후 페이지·DB FK·PostGIS는 확인하지 않습니다. 선택적 `--expected-rows`는 이 모드에서 API의 전체 건수 메타데이터와 대조합니다.

## 실제 적재 명령 9개

**아래 명령은 대상 DB를 변경합니다.** 의도한 로컬 DB와 사전 마이그레이션·기준 데이터를 확인합니다. 숫자와 경로는 기존 판본 예시이며, 실제 파일에서 확인한 값으로 바꿉니다. CSV 통계·업종·경계에 공공 API 인증키는 필요 없습니다.

### 행정동·자치구 경계 적재

Flyway의 PostGIS와 기준 테이블을 적용한 뒤 실행합니다.

```bash
npm run dev -- boundaries --source /절대경로/경계.zip --expected-dongs 425 --expected-districts 25
```

ZIP 또는 `.shp`를 사용합니다. `.shp`에는 같은 이름의 `.dbf`, `.prj`, `.cpg`가 필요합니다. 기존 UTF-8 원본의 `ADSTRD_CD`, `ADSTRD_NM`, `XCNTS_VALU`, `YDNTS_VALU`, `RELM_AR`를 검증하며 `N(38,0)` 면적은 정수 정밀도를 유지해 `area_m2`에 저장합니다. 코드 중복·빈 값·잘못된 좌표계·유효하지 않은 도형을 보정하지 않습니다.

EPSG:5181의 WKT1 투영·타원체·단위·원점과 원본 도형의 유효성·양의 면적을 검사합니다. 변환 후 SRID 4326, 서울 인근 좌표, `ST_PointOnSurface` 대표점의 경계 내부 포함을 확인합니다. 행정동 코드 앞 5자리와 서울 시군구 기준 코드를 대조하고 동 도형을 결합해 구를 생성합니다. [행정표준코드](https://www.code.go.kr/stdcode/sggCodeIL.do?sidoCd=11&disuseAt=0&searchOk=0)

구·동과 게시 이력을 한 트랜잭션으로 확정합니다. 구성 파일 결합 체크섬·ETL 버전 및 경계·이름·면적·출처가 모두 같아야 `SKIPPED`입니다. 입력에서 기존 코드가 빠지면 삭제 대신 중단합니다. 실패 시 검증 전 행은 유효·거부 건수에 넣지 않습니다. [ZIP 전체와 경계 배치 체크섬의 차이](archive/official-source-verification-20261-20262.md#1-공식-데이터셋과-이번-조회-판본)

### 서비스 업종 기준 데이터 적재

```bash
npm run dev -- industries --source /절대경로/행정동점포.csv \
  --sales-source /절대경로/행정동매출.csv --expected-industries 100
```

점포 원본은 필수, `--sales-source`는 선택입니다. 업종 코드·명칭만 읽고 두 원본의 업종을 합집합으로 검증합니다. 동일 코드·명칭 반복은 허용하고 원본 내부나 원본 간의 명칭 충돌·빈 값·공백·손상된 명칭은 실패합니다. 한글 `서비스_업종_코드`·`서비스_업종_코드_명` 또는 영문 `SVC_INDUTY_CD`·`SVC_INDUTY_CD_NM`을 사용합니다.

`--expected-industries`는 고유 코드 수입니다. 배치의 `expected_rows`는 NULL이며, 판독·유효·거부는 원본 행 단위로 셉니다. 원본별 건수·인코딩과 고유 업종 수는 CLI 결과·출처 JSON에서 구분합니다. 원본 역할과 CSV 바이트로 체크섬을 계산하며 현재 입력 업종의 명칭·출처와 ETL 버전까지 일치해야 `SKIPPED`입니다. 누락된 기존 업종은 보존합니다.

### 점포 통계 적재

V1~V3, 경계·서비스 업종 기준 데이터가 필요합니다. `dong_store_stat`에 5개 건수와 2개 비율을 반영합니다.

```bash
npm run dev -- stores --source /절대경로/행정동점포.csv --expected-rows 211832
```

### 추정매출 통계 적재

V1~V3, 경계·서비스 업종 기준 데이터가 필요합니다. `dong_sales_stat`에 당월 금액·건수와 주중·주말 금액을 반영합니다.

```bash
npm run dev -- sales --source /절대경로/행정동매출.csv --expected-rows 100431
```

### 유동인구 통계 적재

V1~V3과 행정동 경계가 필요합니다. `dong_foot_traffic_stat`에 총·남성·여성 수치를 반영하며 업종 기준 데이터는 참조하지 않습니다.

```bash
npm run dev -- foot-traffic --source /절대경로/행정동인구.csv --expected-rows 9350
```

행정동 통계의 한글 키는 `행정동_코드`·`기준_년분기_코드`와 점포·매출의 `서비스_업종_코드`입니다. 측정값은 아래 한글 헤더 또는 V3 표의 영문 원천 필드를 사용합니다. CSV 체크섬·ETL 버전·현재 입력 키의 측정값과 실제 게시 출처가 일치해야 `SKIPPED`입니다. [V3 영문 필드와 저장 컬럼](data-design.md#v3-통계-컬럼과-저장-정책)

| 행정동 통계 | 한글 측정값 헤더                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| 점포        | `전체_점포_수`, `일반_점포_수`, `프랜차이즈_점포_수`, `개업_점포_수`, `폐업_점포_수`, `개업_율`, `폐업_률` |
| 추정매출    | `당월_매출_금액`, `당월_매출_건수`, `주중_매출_금액`, `주말_매출_금액`                                     |
| 길단위인구  | `총_유동인구_수`, `남성_유동인구_수`, `여성_유동인구_수`                                                   |

### 공식 자치구 통계 적재

V2의 배치·자치구 기준 데이터 및 대상 마이그레이션을 적용합니다. V5·V6에는 서비스 업종 기준 데이터가 추가로 필요합니다.

```bash
npm run dev -- district-stores --source /절대경로/자치구점포.csv --expected-rows 54765
npm run dev -- district-sales --source /절대경로/자치구매출.csv --expected-rows 33803
```

### 자치구 길단위인구 적재와 게시

V7과 실제 자치구 기준 데이터가 필요합니다.

```bash
npm run dev -- district-foot-traffic --source /절대경로/자치구인구.csv --expected-rows 550
```

세 자치구 통계의 CSV 게시에서는 각 probe와 같은 검증을 하고 예상·유효·실제 staging 건수 및 실제 FK를 대조합니다. 원본 종류·범위는 `CSV`·`SEOUL`·`scope_code=NULL`입니다. `source_reference`에는 `datasetId`·`serviceName`·로컬 `path`·선택적 ZIP `entry`·`encoding`을 기록하며 배치에는 내부 CSV 체크섬·관찰 분기 범위를 기록합니다. 동일 체크섬·ETL 버전의 정상 `PUBLISHED`(출처 조건과 게시 시각 포함), 측정값과 실제 `source_batch_id`가 모두 일치할 때만 `SKIPPED`입니다. 적재 결과에는 배치 ID·상태·건수·분기 범위를 반환합니다.

| 계약                                                                 | 배치 데이터셋                      | ETL 버전                        |
| -------------------------------------------------------------------- | ---------------------------------- | ------------------------------- |
| [V5 점포](data-design.md#v5-자치구-점포-컬럼과-etl-계약)             | `SEOUL_DISTRICT_STORE_STAT`        | `district-store-stat-v1`        |
| [V6 추정매출](data-design.md#v6-자치구-추정매출-컬럼과-etl-계약)     | `SEOUL_DISTRICT_SALES_STAT`        | `district-sales-stat-v1`        |
| [V7 길단위인구](data-design.md#v7-자치구-길단위인구-컬럼과-etl-계약) | `SEOUL_DISTRICT_FOOT_TRAFFIC_STAT` | `district-foot-traffic-stat-v1` |

#### OA-22179 API 직접 게시

`--api --publish`는 V1~V7과 서울 자치구 기준 데이터가 준비된 loopback DB에 게시합니다. 실행 셸에 `SEOUL_OPEN_API_KEY`와 `DATABASE_URL`을 준비하고, 해당 판본의 전체 행 수를 `--expected-rows`로 지정합니다. 공식 HTTP 주소는 키와 응답을 평문으로 전송하며 중간에서 가로채거나 변조할 수 있습니다. 이 주소를 쓰는 경우에만 전송을 명시적으로 허용합니다. [공식 HTTP 주소와 위험 안내](#서울시-open-api-전체-수집-probe)

```bash
npm run dev -- district-foot-traffic \
  --api --publish --allow-insecure-http \
  --expected-rows 550
```

- `--api --probe`는 DB 없이 수집 및 선택적 CSV 대조를 수행합니다. `--api --publish`에는 `--probe`, `--source`, `--compare-csv`를 함께 사용할 수 없습니다.
- 게시 명령은 `RUNNING` 배치를 먼저 기록합니다. 전체 페이지·행 수·복합키·분기·측정값 검증이 끝나면 staging과 FK 검사를 시작합니다. 수집 실패는 `FAILED` 이력을 남기고 기존 정상 통계와 출처를 보존합니다. staging 또는 Upsert 실패는 반영 트랜잭션을 롤백합니다.
- API 배치에는 `source_type=API`, `scope_type=SEOUL`, 공식 데이터셋 ID·서비스명·전체 수집 범위를 기록합니다. 성공적으로 수집하면 보고 건수·페이지 수·분기 범위도 저장합니다. 정규화한 행을 자치구·분기 복합키 순으로 정렬한 뒤 고정 순서의 JSON 배열과 줄바꿈을 UTF-8로 해시합니다. 수치의 소수 자릿수와 NULL/0을 보존하며 요청 URL과 키는 출처·체크섬에서 제외합니다.
- `SKIPPED` 판정은 동일 원본 유형의 정상 게시 배치와 현재 값·출처를 대조합니다. 같은 값의 CSV를 API로 교체하면 API 배치로 `PUBLISHED`되고 해당 행의 출처가 바뀝니다. 입력에 없는 키는 보존합니다.

자치구 유동인구 REST는 정상 `CSV`·`API` 게시 배치를 참조하는 각 행을 조회합니다. CSV와 API가 서로 다른 분기에 섞여 있어도 각 행의 배치 ID와 게시 시각을 반환합니다. [현재 Backend 조회 조건](../backend/src/main/java/kr/ac/recycleyoungs/foottraffic/DistrictFootTrafficStatRepository.java)

실제 사용 전에는 인증키 전송을 승인받고 읽기 전용 probe로 공식 CSV와 전체 판본을 대조합니다. 차이와 대상 DB·백업을 확인한 뒤 해당 DB의 쓰기 승인을 받아 게시합니다. 게시 후 배치 상태·시각, 행 수와 출처를 확인합니다. 현재 실행은 수동이며 정기 수집·게시 작업은 구현하지 않았습니다. [검증 및 승인 절차](etl-api-migration-plan.md#csvapi-대조와-게시-승인-조건)

### 카페 API 수집·적재

V4와 서울 경계 기준 데이터, `SEMAS_API_KEY`, 공식 분류에서 확인한 코드·명칭이 필요합니다. 서울시의 `CS100010`과 소진공 분류는 별개입니다.

```bash
npm run dev -- cafes \
  --industry-code "$SEMAS_CAFE_INDUSTRY_CODE" --industry-name "$SEMAS_CAFE_INDUSTRY_NAME"
```

- 고정 HTTPS의 `smallUpjongList`·`storeListInDong`으로 코드·명칭과 실제 업소 분류를 대조하고 서울 시도 코드 `11`의 모든 페이지를 수집합니다. 기준년월·전체 건수·페이지 메타데이터·서울 범위·업소번호 중복·유효/staging 건수를 확인합니다. 타임아웃·간격·제한된 재시도를 적용합니다. 선택적 `--expected-rows`는 독립 기대 건수를 추가 대조하며, 생략해도 원천 전체 건수와 실제 수집 건수를 대조합니다. 확인하지 못한 분류나 빈 전체 목록은 게시하지 않습니다.
- 원본 `signguCd`를 현재 서울 `district`와 대조합니다. 미등록·서울 외 코드는 좌표 유무와 관계없이 게시·`SKIPPED` 전에 거부하고 영향 행 수를 보고합니다. 행정동 원문은 보존하며 같은 구의 정확한 8자리 코드만 FK에 연결합니다. WGS84 경도·위도 둘 다 없으면 NULL, 일부 누락·잘못된 값·서울 경계 밖은 실패합니다. 행정동 경계 불일치는 `spatial_mismatch_rows`로 보고하고 수정하지 않습니다. 미연결·좌표 누락 건수도 출처 JSON에 남깁니다.
- 전체 수집 성공 후 Upsert와 `PUBLISHED`를 확정하고 모든 수집 업소의 출처를 새 배치로 갱신합니다. 과거에만 있는 업소는 보존합니다. 정규화한 원본·수집 조건의 체크섬과 **최신 완전한 서울 게시본**의 실제 값·출처까지 일치할 때만 `SKIPPED`입니다. 과거의 동일 해시만으로 생략하지 않습니다. [카페 저장·출처 계약](data-design.md#v4-카페-컬럼과-etl-계약)

## 게시 확인과 테스트

### 읽기 전용 SQL

[개발 가이드의 DB 접속](development.md#로컬-db-준비)으로 대상을 확인하고 `psql`에서 실행합니다. 다음 배치 조회의 데이터셋은 확인할 대상에 맞게 바꿉니다. `source_reference`·`error_message`는 내부 확인에만 사용합니다.

```sql
SELECT batch_id, status, source_checksum, expected_rows, fetched_rows,
       valid_rows, rejected_rows, period_from, period_to, published_at
FROM etl_batch WHERE dataset_code = 'SEOUL_DISTRICT_STORE_STAT'
ORDER BY started_at DESC;
SELECT count(*), min(quarter_code), max(quarter_code) FROM district_store_stat;
```

다른 구·동 통계도 대응 테이블에서 기간·건수·실제 `source_batch_id`를 확인합니다. 업종은 `service_industry`의 코드·명칭·게시 배치, 경계는 구·동 건수와 SRID·유효 도형·내부 대표점을 확인합니다. 배치 조회에는 경계 `SEOUL_DONG_BOUNDARY`, 업종 `SEOUL_SERVICE_INDUSTRY`, 행정동의 `SEOUL_DONG_STORE_STAT`·`SEOUL_DONG_SALES_STAT`·`SEOUL_DONG_FOOT_TRAFFIC_STAT`을 사용합니다.

```sql
SELECT count(*) FROM district;
SELECT count(*), bool_and(ST_SRID(geom) = 4326 AND ST_SRID(label_point) = 4326
       AND ST_IsValid(geom) AND ST_Contains(geom, label_point) AND area_m2 > 0)
FROM administrative_dong;
```

최신 카페 목록은 완전한 서울 게시 배치를 참조하는 행만 읽습니다. `source_reference`는 TEXT이며, PostgreSQL 17에서 jsonb로 읽을 수 있는지 확인한 뒤 `CASE` 안에서 변환합니다. 별도의 `AND` 나열은 평가 순서를 보장하지 않습니다. [입력 유효성](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-INFO-VALIDITY) · [표현식 평가 순서](https://www.postgresql.org/docs/17/sql-expressions.html#SYNTAX-EXPRESS-EVAL) · [JSON 타입 제약](https://www.postgresql.org/docs/17/datatype-json.html)

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

### 기본 검사와 합성 probe 테스트

`npm test`, `npm run lint`(타입 검사 포함), `npm run format:check`, `npm run build`는 `etl/`에서 실행합니다. 기본 테스트는 개발 DB와 공공 API 인증 없이 실행합니다. 예를 들어 합성 응답으로 OA-22179의 수집과 CLI 차단을 확인하려면 다음을 실행합니다.

```bash
npm test -- src/domains/foot-traffic/district-foot-traffic-api.test.ts \
  src/domains/foot-traffic/district-foot-traffic-cli.test.ts src/workflows/official-sources.test.ts
```

### 격리 DB 통합 테스트

Docker가 실행 중일 때 플래그를 명시해 일회용 PostGIS를 사용합니다. 다음 명령은 9개 그룹을 켭니다. 개발 DB 설정·인증키를 사용하지 않으며 각 그룹의 테스트는 `src/domains/` 아래 `*.integration.test.ts`에 있습니다.

```bash
RUN_BOUNDARY_DB_TESTS=1 RUN_INDUSTRY_DB_TESTS=1 RUN_STORE_DB_TESTS=1 \
RUN_SALES_DB_TESTS=1 RUN_FOOT_TRAFFIC_DB_TESTS=1 RUN_CAFE_DB_TESTS=1 \
RUN_DISTRICT_STORE_DB_TESTS=1 RUN_DISTRICT_SALES_DB_TESTS=1 \
RUN_DISTRICT_FOOT_TRAFFIC_DB_TESTS=1 npm test
```

특정 그룹만 실행할 때는 해당 플래그와 테스트 파일을 지정합니다. 자치구 인구의 선택적 실CSV 대조는 `DISTRICT_FOOT_TRAFFIC_REAL_CSV`에 로컬 파일을 지정하는 별도 시험이며, 사용 대상은 일회용 PostGIS입니다. [당시 합성·격리·개발 DB 검증 결과](archive/etl-validation-history.md)
