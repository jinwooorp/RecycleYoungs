# 행정동 통계 API 계약

확정일: 2026-10-03. 로드맵 1차 4단계에서 확정한 계약이며, 5단계 API 구현과 6단계 React 연결을 완료했습니다. PostgreSQL의 V1 스키마와 적재 데이터를 대조했습니다.

현재 구현된 GET API는 아래의 목록 3개·단건 통계 1개와 [공통 4개 분기 추세](#행정동-공통-4개-분기-추세-api) 1개, 총 5개입니다. 2026-10-06에 확정한 추세 계약을 Backend에서 구현·검증했습니다. 2026-10-07에 Frontend 추세 표 연결도 검증했습니다. 로드맵 7단계의 새 환경 재현은 아직 남아 있습니다.

## 범위와 공통 규칙

첫 화면은 같은 행정동·내부 업종·분기의 점포와 추정매출을 함께 조회합니다. 상권 통계·개별 매장·거리·Polygon·점수·추천은 포함하지 않습니다. 행정동과 상권을 하나의 통계 리소스로 추상화하지 않습니다.

| 항목 | 결정 |
| --- | --- |
| 경로 | `/api` 사용. 아직 외부 배포 계약이 없으므로 `/v1` prefix는 추가하지 않음. Flyway V1과 API 버전은 별개 |
| JSON | UTF-8 `application/json`, 필드명 camelCase |
| 성공 응답 | 목록은 배열, 통계는 리소스 객체 직접 반환. 공통 `data` wrapper·pagination 없음 |
| 행정동 | `dong_code`를 string으로 제공. 현재 8자리 숫자 코드이며 이름은 표시용 |
| 업종 | `industries.code`의 string(`CAFE` 등). `CS100010` 같은 원본 코드를 요청 식별자로 받지 않음 |
| 분기 | DB 코드의 string(`"20251"`). 목록에 `label`을 함께 제공하고 year/quarter 중복 필드는 생략 |
| 정수 표현 | 점포 INTEGER는 JSON number 또는 null. 매출 금액·건수 BIGINT는 정확한 10진 정수 string 또는 null |
| 내부 ID | 통계·업종·매핑의 surrogate `id`는 노출하지 않음 |
| 접근 | 요청 중 CSV·manifest를 읽거나 ETL 실행 없음. React는 Spring API만 호출 |

분기는 `YYYYQ` 형식이며 마지막 자리는 1~4입니다. 현재 지원 값은 `20251`~`20254`이고 향후 적재된 연도도 같은 표현을 사용합니다. `2025-Q1`, 숫자 JSON 분기, year/quarter 별도 query는 사용하지 않습니다. 숫자로 바꾸는 계산은 식별자에 적용하지 않습니다. BIGINT를 JavaScript Number로 변환하지 않으며 문자열 비교를 금액 순서 비교로 사용하지 않습니다.

## 조회 가능한 범위

목록 세 개는 **행정동 통계용 lookup**입니다. `SEOUL` 원본 코드와 내부 업종의 매핑이 유효하고 두 통계 테이블 중 하나 이상에 행이 있는 범위에서 목록을 만듭니다. 두 테이블의 합집합을 사용하므로 매출이 없는 점포 행도 선택할 수 있습니다. 목록에 있는 값들의 모든 조합에 통계가 있다는 뜻은 아닙니다.

현재 행정동 425개, 업종 `CAFE`·`HAIR`·`KFOOD`·`PUB`, 분기 4개입니다. `GYM`은 내부 업종으로 등록됐지만 서울시 매핑이 없어 조회 목록에서 제외합니다. 미매핑 원본 업종도 노출하지 않습니다. 빈 DB에서 lookup은 `200`과 `[]`를 반환합니다.

내부 업종 하나를 서울시 원본 코드 하나에 연결합니다. 현재 네 업종은 각각 정확히 하나에 매핑되고 적재 행의 `industry_id`도 일치합니다. 향후 한 내부 업종에 여러 `SEOUL` 원본 코드가 연결되면 임의로 하나를 선택하거나 매출·점포·비율을 합산하지 않습니다. 이 계약에서 그러한 매핑 또는 적재 연결 불일치는 `500 DATA_INTEGRITY_ERROR`이며 집계 계약을 별도로 정해야 합니다.

## API 목록

| 목적 | Method | Path | 요청 파라미터 | 정상 | 주요 오류 |
| --- | --- | --- | --- | --- | --- |
| 조회 가능한 행정동 | GET | `/api/admin-dongs` | 없음 | 200 | 400, 500 |
| 조회 가능한 내부 업종 | GET | `/api/industries` | 없음 | 200 | 400, 500 |
| 조회 가능한 분기 | GET | `/api/quarters` | 없음 | 200 | 400, 500 |
| 한 조건의 행정동 통계 | GET | `/api/admin-dong-stats` | 아래 필수 query 3개 | 200(부분/전체 자료 없음 포함) | 400, 500 |
| 행정동 4개 분기 추세 | GET | `/api/admin-dong-trends` | dongCode, industryCode 필수 | 200(부분/전체 자료 없음 포함) | 400, 500 |

세 목록 API(`/api/admin-dongs`, `/api/industries`, `/api/quarters`)는 query parameter를 받지 않습니다. query parameter가 없으면 정상적으로 목록을 반환합니다. 미정의 query parameter가 전달되면 통계 API의 strict query 검증과 동일하게 `400 INVALID_PARAMETER`를 반환하며, `field`에는 전달된 미정의 query parameter 이름을 사용합니다.

`admin-dong`은 행정동을 명시하며 법정동이나 상권과 구분합니다. `/api/stats/dong`처럼 포괄적인 stats 하위에 공간 단위를 혼합하지 않습니다. quarters/industries의 현재 범위는 위 lookup이며 향후 다른 공간 단위를 추가할 때 범위를 묵시적으로 확대하지 않습니다.

### GET /api/admin-dongs

`code` 오름차순의 `{code, name}` 배열입니다. code는 `dong_code` string, name은 해당 코드의 `dong_name`입니다. 이름으로 조회하지 않습니다. 이름이 바뀐 자료에서는 최신 분기의 이름을 사용하고 같은 분기라면 점포 통계 이름을 우선합니다. 같은 테이블·분기·코드 안에서 이름이 충돌하면 데이터 오류로 처리합니다.

현재 값 중 세 항목의 예시입니다. 실제 응답에는 범위에 해당하는 모든 항목을 반환합니다.

```json
[
  {"code": "11110515", "name": "청운효자동"},
  {"code": "11110530", "name": "사직동"},
  {"code": "11110540", "name": "삼청동"}
]
```

### GET /api/industries

`code` 오름차순의 `{code, name}` 배열입니다. code/name은 `industries`의 내부 업종 값입니다. 원본 source/code와 DB id는 반환하지 않습니다. 현재 전체 응답 예시입니다.

```json
[
  {"code": "CAFE", "name": "카페"},
  {"code": "HAIR", "name": "미용실"},
  {"code": "KFOOD", "name": "한식"},
  {"code": "PUB", "name": "주점"}
]
```

### GET /api/quarters

`code` 오름차순의 `{code, label}` 배열입니다. code는 적재된 `quarter_code`의 string, label은 `YYYY년 Q분기` 표시값입니다. 현재 전체 응답 예시입니다.

```json
[
  {"code": "20251", "label": "2025년 1분기"},
  {"code": "20252", "label": "2025년 2분기"},
  {"code": "20253", "label": "2025년 3분기"},
  {"code": "20254", "label": "2025년 4분기"}
]
```

### GET /api/admin-dong-stats

```text
/api/admin-dong-stats?dongCode=11110515&industryCode=CAFE&quarterCode=20251
```

| 필수 query | 타입·형식 | 의미·검증 |
| --- | --- | --- |
| `dongCode` | string, `[0-9]{8}` | 행정동 목록의 code와 일치 |
| `industryCode` | string, `[A-Z][A-Z0-9_]{0,29}` | 내부 업종 code 존재 및 현재 lookup 지원 여부. 서울시 원본 코드를 직접 받지 않음 |
| `quarterCode` | string, `[1-9][0-9]{3}[1-4]` | 분기 목록의 code와 일치 |

각 값은 정확히 한 번 전달하며 형식은 전체 문자열과 일치해야 합니다. 누락·빈 값·형식 오류·중복 query·미정의 query는 `400`이며 앞뒤 공백을 제거하거나 대소문자를 보정하지 않습니다. 기본값이나 최신 분기 자동 선택도 없습니다. 여러 오류는 요청 구조 → 필수값 → 형식 → 지원 여부 순으로 검사하고, 같은 단계에서는 dongCode → industryCode → quarterCode 순으로 하나를 반환합니다.

점포·매출을 한 객체로 반환해 프론트가 두 요청을 조합하지 않게 합니다. 두 부분은 같은 분기·행정동·서울시 원본 업종 키로 연결하며 한 부분의 누락이 다른 부분을 숨기지 않습니다. 매출을 점포 수로 나눈 평균 등의 새 계산 지표는 만들지 않습니다.

청운효자동·카페·20251의 실제 DB 값으로 작성한 성공 응답입니다.

```json
{
  "dong": {"code": "11110515", "name": "청운효자동"},
  "industry": {"code": "CAFE", "name": "카페"},
  "quarter": {"code": "20251", "label": "2025년 1분기"},
  "storeStats": {
    "storeCount": 114,
    "similarStoreCount": 115,
    "openingStoreCount": 2,
    "closingStoreCount": 4,
    "franchiseStoreCount": 1
  },
  "salesStats": {
    "estimatedSalesAmount": "4535266422",
    "transactionCount": "302642",
    "weekdayEstimatedSalesAmount": "2853077729",
    "weekendEstimatedSalesAmount": "1682188693"
  },
  "missingReasons": {"storeStats": null, "salesStats": null}
}
```

| 응답 필드 | 타입 | 의미·DB 컬럼·단위 |
| --- | --- | --- |
| `dong`, `industry`, `quarter` | object, null 불가 | lookup과 같은 code/name 또는 code/label. 통계의 논리적 식별자는 이 code 3개의 조합 |
| `storeStats` | object 또는 null | 점포 행. 존재하면 아래 5필드를 항상 포함 |
| `storeStats.storeCount` | number 또는 null | `store_count`, 원본 점포 수, 개 |
| `storeStats.similarStoreCount` | number 또는 null | `similar_store_count`, 원본 유사 업종 점포 수, 개 |
| `storeStats.openingStoreCount` | number 또는 null | `opening_store_count`, 원본 개업 점포 수, 개 |
| `storeStats.closingStoreCount` | number 또는 null | `closing_store_count`, 원본 폐업 점포 수, 개 |
| `storeStats.franchiseStoreCount` | number 또는 null | `franchise_store_count`, 원본 프랜차이즈 점포 수, 개 |
| `salesStats` | object 또는 null | 추정매출 행. 존재하면 아래 4필드를 항상 포함 |
| `salesStats.estimatedSalesAmount` | string 또는 null | `sales_amount` ← `당월_매출_금액`, 원 |
| `salesStats.transactionCount` | string 또는 null | `transaction_count` ← `당월_매출_건수`, 건 |
| `salesStats.weekdayEstimatedSalesAmount` | string 또는 null | `weekday_sales_amount`, 원 |
| `salesStats.weekendEstimatedSalesAmount` | string 또는 null | `weekend_sales_amount`, 원 |
| `missingReasons` | object, null 불가 | 항상 storeStats/salesStats 두 키 포함. 각 값은 null 또는 `"NO_ROW"` |

number는 DB INTEGER 범위의 정수이며 BIGINT 문자열은 부호를 포함한 DB 정수를 지수·소수점·자리 구분 없이 직렬화합니다. `0`/`"0"`은 실제 저장된 0에만 사용합니다. 예시에 없는 `openingRate`·`closingRate`와 요일·시간대·연령대 세부 통계는 이번 최소 응답에서 제외합니다. 비율을 추가할 때 원천 분모·단위 정의를 먼저 확인합니다.

금액 단위는 [서울시 행정동 추정매출 안내](https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do)의 원 기준입니다(2026-10-03 확인). 기간은 선택한 `quarter.code`에 귀속된 **원본 보고값**입니다. 원본의 `당월` 열 이름을 보존해 의미를 설명하며 월평균·연간액·분기 총액으로 재계산하거나 재해석하지 않습니다. 상세 집계 정의가 확인되기 전 화면에 월평균 또는 분기 총액이라고 단정하지 않습니다. 추정매출을 실제 매출·이익·창업 수익으로, 개업/폐업 점포 수를 성공률로 표현하지 않습니다.

## 자료 없음과 NULL

| DB 상태 | HTTP·JSON | 표시 의미 |
| --- | --- | --- |
| 양쪽 행 존재 | 200, 두 객체, missingReasons 값 모두 null | 두 자료 제공 |
| 한쪽 행 없음 | 200, 해당 객체 null, 해당 missingReasons `NO_ROW` | 해당 조건의 그 자료 없음; 남은 자료는 제공 |
| 양쪽 행 없음 | 200, 두 객체 null, 두 missingReasons `NO_ROW` | 유효한 조건 조합의 자료 없음. 404나 오류 응답으로 바꾸지 않음 |
| 행 존재·metric NULL | 200, 객체 안 해당 필드 null, 해당 부분의 missingReasons는 null | 해당 원본 값 결측. 상세 결측 원인은 현재 DB에 없음 |
| 행 존재·metric 0 | 200, number 0 또는 BIGINT string `"0"` | 실제 0 |

행 존재 여부를 metric의 NULL 여부로 판단하지 않습니다. 내부 id를 이용해 행 존재를 확인하더라도 응답에 노출하지 않습니다. 모든 nullable 필드는 생략하지 않고 null로 반환합니다.

점포만 있는 실제 사례: 면목5동·카페·20251입니다.

```json
{
  "dong": {"code": "11260550", "name": "면목5동"},
  "industry": {"code": "CAFE", "name": "카페"},
  "quarter": {"code": "20251", "label": "2025년 1분기"},
  "storeStats": {
    "storeCount": 17,
    "similarStoreCount": 21,
    "openingStoreCount": 0,
    "closingStoreCount": 0,
    "franchiseStoreCount": 4
  },
  "salesStats": null,
  "missingReasons": {"storeStats": null, "salesStats": "NO_ROW"}
}
```

양쪽 행이 없는 실제 사례는 20251·`11470670`·`PUB`입니다. metric NULL 규칙은 향후 결측을 위한 계약이며 이번 응답 대상 metric에는 현재 DB의 NULL 사례가 없었습니다.

## 공통 오류

오류는 wrapper 없이 아래 객체를 반환합니다. HTTP status는 요청 수정 필요(400)/서버 실패(500)를, code는 프론트 분기를 나타냅니다. message는 한국어 표시용이며 프론트는 message 문자열로 판단하지 않습니다. field는 해당 query 이름 또는 null이고 항상 포함합니다. 내부 SQL·stack trace·접속 정보는 응답에 담지 않습니다.

```json
{
  "code": "UNSUPPORTED_QUARTER",
  "message": "지원하지 않는 분기입니다.",
  "field": "quarterCode"
}
```

| HTTP | code | 발생 조건 | field |
| --- | --- | --- | --- |
| 400 | `INVALID_PARAMETER` | 필수값 누락·빈 값·중복·미정의 query | 해당 query 이름 |
| 400 | `INVALID_DONG_CODE` | dongCode 형식 오류 | dongCode |
| 400 | `UNKNOWN_DONG` | 행정동 lookup에 없음 | dongCode |
| 400 | `INVALID_INDUSTRY_CODE` | industryCode 형식 오류 | industryCode |
| 400 | `UNKNOWN_INDUSTRY` | industries.code에 없음. CS100010 직접 입력도 여기에 해당 | industryCode |
| 400 | `UNSUPPORTED_INDUSTRY` | 등록된 내부 업종이지만 현재 lookup에 없음(GYM 등) | industryCode |
| 400 | `INVALID_QUARTER` | quarterCode 형식 오류(20255 등) | quarterCode |
| 400 | `UNSUPPORTED_QUARTER` | 형식은 맞지만 분기 lookup에 없음(현재 20261 등) | quarterCode |
| 500 | `DATA_INTEGRITY_ERROR` | 모호한 서울시 매핑·적재 연결 불일치·동일 테이블/분기/행정동의 명칭 충돌 | null |
| 500 | `INTERNAL_ERROR` | DB 연결 실패 등 예상하지 못한 서버 오류 | null |

통계 endpoint는 존재하고 조건이 query이므로 존재하지 않는 조건도 400으로 일관되게 처리합니다. 유효한 조건의 `NO_ROW`는 오류 code가 아닙니다. 존재하지 않는 URL의 404는 통계 자료 없음과 별개입니다.

## Dataset metadata 결정

**선택 A:** 첫 vertical slice의 기간 metadata는 DB의 quarter만 제공합니다. 현재 source·적재 시각·dataset version을 관리할 테이블은 없으므로 응답에 이 필드들을 추가하거나 값·버전을 만들어내지 않습니다. V2를 첫 조회 API의 필수 선행 작업으로 두지 않습니다. 단위는 위 필드 계약에 명시하며 출처 참고는 이 문서의 공식 안내 링크와 [데이터 목록](data-catalog.md)에 둡니다.

이는 출처·버전 관리가 완료됐다는 뜻이 아닙니다. 로드맵의 출처·버전 응답은 후속 DB metadata migration과 계약 확장 이후에 제공합니다. 그러기 전 화면은 다운로드일·적재일·원본 버전을 보장한다고 표시하지 않습니다. manifest의 미확인 다운로드일·이용 조건이나 Flyway version을 dataset version으로 대체하지 않습니다. 공식 페이지 확인도 보관 CSV의 정확한 다운로드 이력을 증명하지 않습니다.

후속 metadata 작업은 자료별 출처·단위·원천 집계 정의·파일 해시·기간·적재 이력/버전을 확인해 DB에서 관리하는 경로로 연결합니다. 요청 중 CSV·manifest·외부 원천 페이지를 읽는 우회는 금지합니다. 이번에는 metadata schema·V2를 작성하지 않았습니다.

## 구현의 DB 매핑

| API/정보 | DB 정보와 연결 기준 |
| --- | --- |
| 행정동 목록 | 두 통계의 조회 가능 행에서 distinct dong_code/dong_name, 명칭 규칙 적용 |
| 업종 목록 | industries + industry_mappings(source=SEOUL), 유효한 단일 매핑과 실제 통계 행 존재 확인 |
| 분기 목록 | 조회 가능한 두 통계의 distinct quarter_code, DB 수치를 code string/label로 표현 |
| 통계 조회 | 내부 업종 code → SEOUL 원본 코드 → 두 통계의 quarter_code/dong_code/source_industry_code. industry_id 연결도 일치해야 함 |
| 식별자 | DB의 복합 키는 원본 업종 기준, 외부는 내부 업종 기준. 단일 서울시 매핑으로 대응하며 surrogate id는 반환하지 않음 |

SQL·Repository·DTO Java는 5단계에서 구현했습니다. 테스트는 정상·입력 오류·부분/전체 NO_ROW·metric NULL·0·BIGINT 정밀도와 매핑 오류를 구분하며, 실제 DB/API integration 검증 결과는 [프로젝트 기록](project-status.md)에 있습니다.

## 행정동 공통 4개 분기 추세 API

계약 확정일: 2026-10-06. 이 계약에 따른 Backend API와 테스트를 구현하고 실제 DB/HTTP로 검증했습니다. Frontend는 2026-10-07에 고정 4분기 semantic table로 연결·검증했습니다. 전체 흐름의 새 환경 재현은 후속 작업이며 migration·ETL 변경은 없습니다. 기존 네 API의 경로·지원 범위·응답·오류 계약은 유지합니다.

### endpoint와 선택 근거

```text
GET /api/admin-dong-trends?dongCode=11110515&industryCode=CAFE
```

행정동 하나와 내부 업종 하나의 **2025년 4개 분기**를 하나의 리소스로 반환합니다. 행정동 2~3곳은 같은 업종·기간으로 이 endpoint를 각 행정동에 한 번씩 요청합니다. 후보 비교·다중 행정동 batch API·상권 통계·평균·증감률·점수는 이번 계약에 포함하지 않습니다.

| 결정 | 대안과 비교 | 선택 이유 |
| --- | --- | --- |
| 단일 trend endpoint | Frontend가 단건 통계 API를 네 번 호출해 결합 | 한 요청의 읽기 전용 snapshot 안에서 매핑·무결성·네 분기를 함께 검증. 부분 HTTP 실패를 프론트에서 결합하거나 서로 다른 적재 상태를 한 시계열로 섞지 않음 |
| B: 2025년 4분기 고정 | A: 현재 지원 공통 분기 전체를 동적으로 반환 | 확보한 두 원본이 공유하는 2025년 기간을 재현·비교 기준으로 고정. 다른 연도 적재가 응답 길이·비교 기간을 묵시적으로 바꾸지 않음 |
| 기존 통계 metric 전체 | 점포 수·추정매출 두 값만 반환 | 이미 정의한 점포 5개·매출 4개와 NULL 의미를 그대로 재사용. 네 item으로 한정되어 전송량이 작고 건수·개폐업 표시를 위해 단건 API를 다시 호출할 필요가 없음 |

기존 `/api/quarters`는 유효한 서울시 매핑이 연결된 **두 통계의 분기 합집합**입니다. 두 테이블·행정동·업종마다 행이 있는 분기 교집합을 보장하지 않습니다. A를 채택하려면 공통 분기의 교집합을 어느 범위(전체/업종/행정동)에서 계산할지 추가로 정해야 하고, 행 유무에 따라 비교 기간이 달라질 수 있습니다. 따라서 이 목록을 추세 배열의 생성 기준으로 사용하거나 기존 목록 계약을 교집합으로 변경하지 않습니다.

### 요청과 검증 순서

| 필수 query | 형식 | 지원 여부 |
| --- | --- | --- |
| `dongCode` | string, 전체 문자열 `[0-9]{8}` | 기존 `/api/admin-dongs`의 조회 가능한 code |
| `industryCode` | string, 전체 문자열 `[A-Z][A-Z0-9_]{0,29}` | 기존 내부 업종에 등록되고 서울시 단일 매핑·통계 행으로 조회 가능한 code |

현재 지원 업종은 단건 API와 같은 `CAFE`, `HAIR`, `KFOOD`, `PUB`입니다. 로드맵의 최초 검증 대상이 CAFE라고 해서 나머지 지원 업종을 추세에서 제외하지 않습니다. `CS100010`은 원본 코드이므로 요청 식별자로 받지 않습니다. `GYM`은 등록됐지만 서울시 매핑이 없어 `UNSUPPORTED_INDUSTRY`입니다.

각 필수값은 정확히 한 번 전달합니다. trim·대소문자 보정·기본 업종·최신 분기 자동 선택은 없습니다. 허용 query는 이 두 개뿐이며 `quarterCode`, `year`, `fromQuarter`, `toQuarter`, `limit` 등은 미정의 query입니다.

기존 `QueryValidator`의 실제 우선순위를 두 필드에 적용합니다.

1. **요청 구조:** 허용 필드의 중복을 dongCode → industryCode 순으로 검사한 다음, 미정의 key가 있으면 key 문자열 오름차순의 첫 key를 반환합니다. 같은 값의 반복도 중복입니다.
2. **필수값:** 누락·빈 문자열을 dongCode → industryCode 순으로 검사합니다.
3. **형식:** dongCode → industryCode 순으로 전체 문자열 형식을 검사합니다. 공백 문자열은 비어 있지 않으므로 형식 오류입니다.
4. **lookup·무결성:** 기존 전역 서울시 매핑·통계 lookup 무결성을 같은 읽기 전용 transaction에서 확인합니다. 여기서 무결성/DB 오류가 나면 지원 여부 검사 전에 500을 반환할 수 있습니다.
5. **지원 여부:** dongCode → industryCode 순으로 `UNKNOWN_DONG`, `UNKNOWN_INDUSTRY`, `UNSUPPORTED_INDUSTRY`를 구분합니다.

예를 들어 `dongCode` 누락과 `quarterCode` 전달이 동시에 있으면 요청 구조 오류가 먼저이므로 `400 INVALID_PARAMETER`, `field="quarterCode"`입니다. `dongCode` 중복까지 있으면 중복 오류인 `field="dongCode"`가 우선합니다. 단건 API의 세 필드 검증에는 영향을 주지 않습니다.

### 반환 기간·정렬·이름

정상 응답의 `quarters`는 **항상 정확히 4개 item**이며 code 순서는 `"20251"`, `"20252"`, `"20253"`, `"20254"`입니다. code는 string, label은 각각 `2025년 1분기`부터 `2025년 4분기`입니다. 중복·분기 생략·배열 순서의 임의 변경은 허용하지 않습니다.

- 분기는 응답의 지원 기간 축이며 해당 행의 존재를 보증하지 않습니다. 해당 행정동·업종의 한 분기에서 양쪽 행이 없어도 item을 유지합니다.
- 이 endpoint의 지원 기간은 DB 목록과 독립적으로 고정됩니다. 한 분기에서 DB 전체에 행이 없더라도 유효한 행정동·업종 요청에는 그 분기를 유지하고 해당 행 부재를 `NO_ROW`로 반환합니다. 원본 전수 적재의 완전성은 후속 재현 검증에서 확인하며 API가 완전성을 보증하거나 새로운 결측 사유를 만들어내지 않습니다.
- DB에 2024년·2026년 자료가 추가돼도 이 응답은 2025년만 반환합니다. 해당 연도는 이 추세 계약의 지원 기간이 아니며 향후 기간 확대는 별도 계약 변경입니다. `quarterCode=20261`처럼 기간을 query로 전달하면 값과 관계없이 미정의 query 오류입니다.
- 행정동·업종 지원 여부는 기존 lookup을 그대로 사용합니다. 따라서 다른 분기의 자료로 lookup에 포함된 유효 식별자도 2025년 조합이 없으면 전체 NO_ROW가 될 수 있습니다. 반대로 빈 DB에서 조회 가능한 행정동이 없으면 `UNKNOWN_DONG`이며 존재하지 않는 lookup을 만들어내지 않습니다.
- `dong.name`은 기존 lookup의 최신 분기 이름(같은 분기는 점포 이름 우선)을 사용합니다. 2025년 내부나 기간 밖에서 이름이 바뀌어도 표시용 이름 하나를 반환하며 분기별 역사적 이름을 새로 만들지 않습니다. code가 식별자이고 이름은 표시용입니다.

### 응답 JSON과 필드

성공은 HTTP 200, UTF-8 `application/json`입니다. `data` wrapper·pagination·요약 상태·source code·surrogate id는 없습니다. 아래는 계약 확정 시 populated DB에서 읽기 전용으로 대조한 청운효자동/CAFE의 응답 예시이며, 구현 후 실제 trend HTTP 응답도 이 값과 일치함을 확인했습니다.

```json
{
  "dong": {
    "code": "11110515",
    "name": "청운효자동"
  },
  "industry": {
    "code": "CAFE",
    "name": "카페"
  },
  "quarters": [
    {
      "quarter": {
        "code": "20251",
        "label": "2025년 1분기"
      },
      "storeStats": {
        "storeCount": 114,
        "similarStoreCount": 115,
        "openingStoreCount": 2,
        "closingStoreCount": 4,
        "franchiseStoreCount": 1
      },
      "salesStats": {
        "estimatedSalesAmount": "4535266422",
        "transactionCount": "302642",
        "weekdayEstimatedSalesAmount": "2853077729",
        "weekendEstimatedSalesAmount": "1682188693"
      },
      "missingReasons": {
        "storeStats": null,
        "salesStats": null
      }
    },
    {
      "quarter": {
        "code": "20252",
        "label": "2025년 2분기"
      },
      "storeStats": {
        "storeCount": 114,
        "similarStoreCount": 115,
        "openingStoreCount": 2,
        "closingStoreCount": 2,
        "franchiseStoreCount": 1
      },
      "salesStats": {
        "estimatedSalesAmount": "4603714789",
        "transactionCount": "356622",
        "weekdayEstimatedSalesAmount": "2868971210",
        "weekendEstimatedSalesAmount": "1734743579"
      },
      "missingReasons": {
        "storeStats": null,
        "salesStats": null
      }
    },
    {
      "quarter": {
        "code": "20253",
        "label": "2025년 3분기"
      },
      "storeStats": {
        "storeCount": 115,
        "similarStoreCount": 116,
        "openingStoreCount": 2,
        "closingStoreCount": 2,
        "franchiseStoreCount": 1
      },
      "salesStats": {
        "estimatedSalesAmount": "4195134430",
        "transactionCount": "293013",
        "weekdayEstimatedSalesAmount": "2897027346",
        "weekendEstimatedSalesAmount": "1298107084"
      },
      "missingReasons": {
        "storeStats": null,
        "salesStats": null
      }
    },
    {
      "quarter": {
        "code": "20254",
        "label": "2025년 4분기"
      },
      "storeStats": {
        "storeCount": 118,
        "similarStoreCount": 119,
        "openingStoreCount": 5,
        "closingStoreCount": 2,
        "franchiseStoreCount": 1
      },
      "salesStats": {
        "estimatedSalesAmount": "4724282512",
        "transactionCount": "340786",
        "weekdayEstimatedSalesAmount": "2941978790",
        "weekendEstimatedSalesAmount": "1782303722"
      },
      "missingReasons": {
        "storeStats": null,
        "salesStats": null
      }
    }
  ]
}
```

| 필드 | 타입·의미 |
| --- | --- |
| `dong` | null 불가 `{code, name}`. 기존 행정동 lookup과 같은 외부 식별자 |
| `industry` | null 불가 `{code, name}`. 내부 업종; 원본 source code는 노출하지 않음 |
| `quarters` | null 불가, 위 순서의 정확히 4개 item |
| `quarters[].quarter` | null 불가 `{code, label}`. 2025년 고정 기간 |
| `quarters[].storeStats` | 객체 또는 null. 기존 단건의 점포 5개 필드·INTEGER number/null·단위 개를 그대로 사용 |
| `quarters[].salesStats` | 객체 또는 null. 기존 단건의 매출 4개 필드·BIGINT decimal string/null을 그대로 사용 |
| `quarters[].missingReasons` | null 불가. `storeStats`, `salesStats` 키를 항상 제공하며 각 값은 null 또는 `"NO_ROW"` |

점포 필드는 `storeCount`, `similarStoreCount`, `openingStoreCount`, `closingStoreCount`, `franchiseStoreCount`입니다. 매출 필드는 `estimatedSalesAmount`, `transactionCount`, `weekdayEstimatedSalesAmount`, `weekendEstimatedSalesAmount`입니다. 존재하는 객체에서는 모든 필드를 제공하며 값이 null이어도 생략하지 않습니다. INTEGER 범위도 기존 단건과 같습니다.

### 분기별 결측·0·BIGINT

| 상태 | 분기 item의 표현 | HTTP |
| --- | --- | --- |
| 양쪽 행 존재 | 두 객체, 두 missingReasons 모두 null | 200 |
| 점포만 존재 | 점포 객체 유지, 매출 객체 null·매출 이유 `NO_ROW` | 200 |
| 매출만 존재 | 매출 객체 유지, 점포 객체 null·점포 이유 `NO_ROW` | 200 |
| 한 분기 양쪽 행 없음 | 두 객체 null·두 이유 `NO_ROW`; 해당 분기를 생략하지 않음 | 200 |
| 네 분기 모두 양쪽 행 없음 | dong/industry와 네 item 유지; 각 item의 두 객체 null·두 이유 `NO_ROW` | 200 |
| 행 존재·개별 metric NULL | 해당 metric만 null·그 section의 missingReasons는 null | 200 |
| 행 존재·실제 0 | 점포 number `0`, 금액/건수 string `"0"` | 200 |

행 존재는 row 자체로 판정합니다. 첫 metric의 NULL/0 여부로 행을 판단하거나 missing 값을 0으로 채우지 않습니다. HTTP 오류·network 실패는 정상 empty 응답과 별개입니다. network 실패는 frontend의 전송 상태이며 Backend가 NO_ROW나 network용 API error code로 만들어내지 않습니다.

매출 4개 BIGINT 필드는 signed 64-bit 정수를 정확한 10진 문자열로 직렬화합니다. 범위는 `-9223372036854775808`~`9223372036854775807`이며 `"9007199254740993"`도 그대로 전달합니다. 지수·소수·자리 구분 없는 정수 문자열을 사용하고 number/double·Number·parseInt·parseFloat로 변환하지 않습니다. 계산 지표를 추가하거나 차트 입력에 맞춰 정밀도를 줄이지 않습니다. 차트 표현은 추후 Frontend에서 원본 문자열과 정확한 tooltip/표시를 보존하는 별도 정책으로 정합니다.

실제 둔촌1동/CAFE의 20251은 점포 행이 존재하고 `storeCount=0`, 매출 행은 없습니다. 네 item 중 첫 item의 응답 표현은 다음과 같습니다. 나머지 세 분기는 양쪽 행이 존재하며 아래 DB 대조 표에 기록했습니다.

```json
{
  "quarter": {
    "code": "20251",
    "label": "2025년 1분기"
  },
  "storeStats": {
    "storeCount": 0,
    "similarStoreCount": 2,
    "openingStoreCount": 2,
    "closingStoreCount": 0,
    "franchiseStoreCount": 2
  },
  "salesStats": null,
  "missingReasons": {
    "storeStats": null,
    "salesStats": "NO_ROW"
  }
}
```

실제 신정6동/PUB는 네 분기 모두 양쪽 행이 없습니다. 각 item은 아래와 같고 `quarter`만 `20251`~`20254`의 순서로 달라집니다. HTTP 200이며 `quarters=[]`, 404, 400으로 바꾸지 않습니다.

```json
{
  "quarter": {
    "code": "20251",
    "label": "2025년 1분기"
  },
  "storeStats": null,
  "salesStats": null,
  "missingReasons": {
    "storeStats": "NO_ROW",
    "salesStats": "NO_ROW"
  }
}
```

### 단위·기간·metadata

기존 단건의 단위와 해석을 그대로 따릅니다. 점포 수는 개, 추정매출 금액은 원, 거래 건수는 건입니다. 각 값은 해당 `quarters[].quarter.code`에 귀속된 **원본 보고값**입니다. 원본의 `당월` 열 이름을 월평균·분기 총액·연간액으로 재해석하지 않습니다. 네 금액의 합·평균·점포당 매출·증감률을 계산해 응답하지 않습니다.

추정매출은 실제 매출·이익·창업 수익·성공 가능성이 아니며 개업/폐업 점포 수는 성공률/실패율이 아닙니다. 서로 다른 공간 단위인 행정동과 상권 통계를 결합하지 않습니다. 기존 dataset metadata 유예를 유지하며 source·적재 시각·dataset version을 만들거나 CSV/manifest를 요청 중 읽지 않습니다. 고정 분기 축도 다운로드 이력·적재 완전성·경계 버전을 보증하지 않습니다.

### 오류와 원자적 실패

기존 `{code, message, field}` 3필드 오류 응답과 한국어 표시용 메시지를 사용합니다. 새 error code는 없습니다.

| HTTP | code | 발생 조건 | field |
| --- | --- | --- | --- |
| 400 | `INVALID_PARAMETER` | 두 필수 query의 누락·빈 값·중복, 모든 미정의 query | 해당 query key |
| 400 | `INVALID_DONG_CODE` | 행정동 형식 오류 | dongCode |
| 400 | `UNKNOWN_DONG` | 기존 행정동 lookup에서 조회 불가 | dongCode |
| 400 | `INVALID_INDUSTRY_CODE` | 내부 업종 형식 오류 | industryCode |
| 400 | `UNKNOWN_INDUSTRY` | 내부 업종 미등록; 원본 코드 CS100010도 해당 | industryCode |
| 400 | `UNSUPPORTED_INDUSTRY` | 내부 업종은 등록됐지만 서울시 매핑/행 존재 기준으로 조회 불가 | industryCode |
| 500 | `DATA_INTEGRITY_ERROR` | 기존 매핑·식별자·행정동 이름·분기/행 무결성 오류 | null |
| 500 | `INTERNAL_ERROR` | DB 연결 실패 등 예상하지 못한 서버 오류 | null |

`quarterCode=20251`을 추가한 요청은 다음 오류이며 `INVALID_QUARTER`/`UNSUPPORTED_QUARTER`로 처리하지 않습니다. 이 두 분기 오류 code는 기존 단건 API에만 그대로 남습니다.

```json
{"code":"INVALID_PARAMETER","message":"정의되지 않은 요청 파라미터입니다.","field":"quarterCode"}
```

모호한 서울시 매핑, mapped source의 industry_id 불일치(NULL 포함), 복합 키 중복, 같은 table/quarter/dong 내 이름 충돌, 잘못된 저장 분기 code를 임의 선택·합산·정정하지 않습니다. 기존 lookup의 **전체 유효 서울시 매핑 행** 검사를 유지하므로 요청한 조합/2025년 밖의 무결성 오류도 500이 될 수 있습니다. 분기 사이의 이름 변경이나 같은 분기의 점포·매출 간 이름 차이는 기존 최신 이름·점포 우선 정책을 적용하며 그 자체로 오류가 아닙니다.

무결성 검사나 분기 통계 조회 중 무결성/DB 오류가 발생하면 **전체 요청**을 해당 500 오류로 실패시킵니다. 요청 검증의 400 정책은 위 표대로 유지합니다. 정상 분기 일부만 반환하거나 오류 분기를 NO_ROW로 대체하지 않습니다. SQL·stack trace·접속 정보는 응답에 노출하지 않습니다.

### DB 매핑·조회 전략

논리적 key는 `dong_code + source_industry_code + quarter_code`입니다. 내부 `industryCode`를 `industry_mappings.source='SEOUL'`의 유일한 source code에 연결하고 적재 행의 industry_id 일치를 확인합니다. CAFE는 `CS100010`에 연결됩니다. surrogate id는 행 존재 확인에 사용할 수 있지만 JSON에는 노출하지 않습니다.

현재 구현은 Controller의 strict query 검증(QueryValidator) → Service의 lookup·매핑/무결성·지원 여부 확인 → JdbcClient Repository의 여러 분기 조회 → 고정 분기별 응답 조립 순서입니다. 기존 단건 DTO의 StoreStats·SalesStats·MissingReasons·Quarter 의미를 재사용하고 추세 리소스와 분기 item만 추가했습니다.

- 기존처럼 읽기 전용 **REPEATABLE READ transaction 하나**에서 lookup·매핑 검사·두 테이블 통계를 읽습니다. 별도 transaction으로 분리하면 적재 사이의 상태를 섞을 수 있습니다.
- lookup을 한 번만 확인하고, 각 테이블에서 dong/source와 **정확한 네 quarter code**를 bind parameter로 필터링해 quarter 오름차순으로 가져옵니다. 통계 SQL은 store/sales 각 1회, 총 2회이며 lookup·무결성 SQL은 별도입니다.
- 단일 분기 store/sales를 네 번씩 호출하는 최대 8회 통계 SQL도 의미상 구현 가능하지만 불필요한 왕복이 있습니다. Service의 기존 단건 조회를 네 번 호출하면 lookup까지 반복되므로 우선안으로 삼지 않습니다.
- 두 결과를 quarter key로 매핑하고 계약의 고정 기간을 순회해 없는 row를 null/NO_ROW로 채웁니다. INNER JOIN으로 양쪽 행이 있는 분기만 남기지 않고 metric NULL을 0으로 채우지 않습니다. 같은 테이블/quarter의 중복을 맵의 마지막 값으로 덮어쓰지 않습니다.
- 같은 snapshot의 단건 응답과 추세 item은 동일 metric·NULL/NO_ROW 값을 가져야 합니다. 서로 다른 시점의 별도 HTTP 요청 사이까지 snapshot 동일성을 보장하지는 않습니다.

두 테이블에 이미 `(dong_code, source_industry_code, quarter_code)` 조회 인덱스와 복합 키 UNIQUE가 있습니다. 이 필터·정렬의 접근 경로를 제공하므로 현재 4분기 조회 때문에 새 column/table/index나 **V2 migration은 필요하지 않습니다**. 실제 성능은 실행 계획으로 확인하며 근거 없이 index를 추가하지 않습니다.

### 2026-10-06 실제 DB 대조

기존 populated PostgreSQL에서 `transaction_read_only=on`인 REPEATABLE READ transaction으로 SELECT만 수행했습니다. 원본·DB를 변경하거나 ETL·Spring·React를 실행하지 않았습니다. 조회 시작/종료 행 수는 점포 141,218행·매출 67,113행으로 같습니다. CAFE → SEOUL/CS100010, 두 통계 테이블의 20251~20254를 확인했고 전역 매핑 모호성·industry_id 불일치·중복 키·이름 충돌은 0건이었습니다. DB 행 수와 현 상태 대조이며 이번에 CSV 원본을 다시 전수 대조한 것은 아닙니다.

두 원본의 공통 기간이 4분기라는 것과 모든 dong/industry/quarter 조합에 양쪽 행이 있다는 것은 다릅니다. CAFE 점포는 분기마다 425행, 매출은 420/421/421/421행입니다. 아래는 로드맵의 대표 행정동 세 곳과 한 분기 결측 사례입니다. 금액·건수는 JSON string의 원본값을 자리 구분 없이 적었습니다.

| 행정동(code) / 내부 업종 | 분기 | 점포 수(개) | 추정매출(원) | 매출 건수(건) | 행 존재 |
| --- | --- | ---: | ---: | ---: | --- |
| 청운효자동(11110515) / CAFE | 20251 | 114 | 4535266422 | 302642 | 양쪽 |
| 청운효자동(11110515) / CAFE | 20252 | 114 | 4603714789 | 356622 | 양쪽 |
| 청운효자동(11110515) / CAFE | 20253 | 115 | 4195134430 | 293013 | 양쪽 |
| 청운효자동(11110515) / CAFE | 20254 | 118 | 4724282512 | 340786 | 양쪽 |
| 사직동(11110530) / CAFE | 20251 | 178 | 9462371274 | 954826 | 양쪽 |
| 사직동(11110530) / CAFE | 20252 | 178 | 12737397038 | 1259992 | 양쪽 |
| 사직동(11110530) / CAFE | 20253 | 178 | 12539560367 | 1287652 | 양쪽 |
| 사직동(11110530) / CAFE | 20254 | 176 | 12509194587 | 1193317 | 양쪽 |
| 삼청동(11110540) / CAFE | 20251 | 89 | 5548781022 | 296777 | 양쪽 |
| 삼청동(11110540) / CAFE | 20252 | 86 | 10137624187 | 571397 | 양쪽 |
| 삼청동(11110540) / CAFE | 20253 | 87 | 7078408048 | 405292 | 양쪽 |
| 삼청동(11110540) / CAFE | 20254 | 84 | 7808131897 | 444369 | 양쪽 |
| 둔촌1동(11740690) / CAFE | 20251 | 0 | NO_ROW | NO_ROW | 점포만 |
| 둔촌1동(11740690) / CAFE | 20252 | 3 | 452140306 | 82613 | 양쪽 |
| 둔촌1동(11740690) / CAFE | 20253 | 7 | 452142858 | 70594 | 양쪽 |
| 둔촌1동(11740690) / CAFE | 20254 | 8 | 452142858 | 70417 | 양쪽 |

추가로 면목5동(`11260550`)/CAFE는 네 분기의 점포 수가 17/16/16/15이고 매출은 모두 NO_ROW입니다. 신정6동(`11470670`)/PUB(서울시 `CS100009`)는 네 분기 모두 양쪽 NO_ROW입니다. NULL·signed BIGINT 경계값은 이 실제 사례에서 확인한 값이 아니며, 별도 격리 fixture/Backend 응답 경계 테스트에서 검증했습니다.

### 테스트 계약과 검증 상태

기존 단건 테스트는 회귀 기준으로 유지합니다. 같은 parser·직렬화 규칙을 모든 계층에 복사하는 대신 아래 책임별 검증을 사용합니다. Backend 일반·populated/격리 DB 테스트와 실제 HTTP 대조를 수행했습니다([Backend 검증 결과](../backend/README.md#조회-api와-테스트-범위)). Frontend API 경계·UI/hook 테스트와 실제 API/브라우저 대조도 수행했습니다([Frontend 검증 결과](../frontend/README.md#검증)).

| 계층 | 검증 항목 | 이유·경계 |
| --- | --- | --- |
| request / MVC (DB 없음) | dong/industry 각각 누락·빈 값·중복·형식 오류; 공백·소문자·길이 경계; quarterCode와 다른 미정의 query; 복합 오류 우선순위 | 두 필드 strict query와 새 경로의 wiring을 검증. 구조/형식 오류는 Service 호출 전에 400 |
| Service / Repository 단위 | 고정 네 분기·오름차순·없는 분기 유지; 첫/중간/마지막 분기의 NO_ROW 조립; 한 분기 양쪽 NO_ROW·네 분기 모두 NO_ROW; 2024/2026행 배제; 중복 row 거부; 내부 실패/무결성 예외의 원자적 실패 | period 축을 DB 결과 행에서만 만들거나 Map에 중복을 덮어쓰는 실수를 방지. 기존 UNIQUE를 제거하지 않고 중복 query 경계를 대체 |
| 기존 populated DB + MockMvc JSON | 청운효자동 정상 4분기 전 필드·code/label 순서·JSON string; 둔촌1동의 부분 NO_ROW와 실제 0; 면목5동의 section 부재; 신정6동 전체 NO_ROW; unknown dong/industry·원본 업종 code·GYM unsupported | 실제 JdbcClient 매핑·Service 조립·직렬화를 함께 확인. 변경 없는 populated DB에서 단건 API 네 분기의 값과 추세 API 각 item을 대조. 기존 DB에 fixture 쓰기 없음 |
| 별도 격리 fixture DB | 행 존재·metric NULL·0/"0"; `9007199254740993`·signed BIGINT 최대/최소의 정확한 JSON string; 특정 분기의 한쪽/양쪽 부재; DB 전체에서 한 분기가 없는 경우에도 고정 축 유지; 미래 연도만 있는 lookup; 명칭 선택; 모호한 mapping·industry_id NULL/불일치·분기/이름 무결성 오류 | 실제 driver가 nullable INTEGER/Long을 읽는 경계를 검증. 기존 opt-in·DB prefix·빈 DB·rollback 보호를 재사용하고 populated DB에서는 실행하지 않음 |
| HTTP 오류 smoke | 유효 요청의 200; 미정의 quarterCode의 400; 무결성 실패와 DB 연결 실패의 500·안전한 3필드 오류 body | MockMvc 검증을 바탕으로 실제 서버 경계는 대표 요청만 확인. 연결 실패 주입은 검증용 환경에서만 수행 |
| Frontend API 경계 | 네 item의 code/순서/길이·nullable 객체와 missingReasons 일치·string/range 검사; BIGINT를 number·지수·소수·잘못된 문자열·범위 초과로 받은 응답 거부 | 유효 BIGINT column은 잘못된 숫자 문자열을 생산하지 않으므로 잘못된 응답은 API 경계 mock으로 검증. Backend를 double/string 우회 모델로 바꾸지 않음 |
| Frontend UI / hook | 정상·부분/전체 NO_ROW·metric NULL·실제 0·HTTP/network 오류 구분; 정확한 BIGINT 표시; 요청 취소/늦은 응답; 없는 분기를 생략하거나 0으로 연결하지 않음 | semantic table로 고정 네 분기를 표시. 단건/추세의 독립 성공·오류와 공유 취소를 검증하며 Chart·dependency는 추가하지 않음 |

통계 조회의 무결성 오류는 정상 item 일부와 섞이지 않아야 합니다. DB 연결 실패는 INTERNAL_ERROR, 존재하지 않는 통계 조합은 정상 NO_ROW입니다. Backend 구현과 실제 API 검증을 완료했습니다. Frontend 추세 표 연결과 실제 API/브라우저 검증도 완료했습니다. Chart 여부 결정과 CSV → ETL → DB → API → React의 새 환경 재현은 후속 작업으로 남깁니다.
