# 행정동 통계 API 계약

확정일: 2026-10-03. 로드맵 1차 4단계의 계약이며 API는 아직 구현하지 않았습니다. 현재 PostgreSQL의 V1 스키마와 적재 데이터를 대조했습니다.

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

## 다음 구현의 DB 매핑

| API/정보 | DB 정보와 연결 기준 |
| --- | --- |
| 행정동 목록 | 두 통계의 조회 가능 행에서 distinct dong_code/dong_name, 명칭 규칙 적용 |
| 업종 목록 | industries + industry_mappings(source=SEOUL), 유효한 단일 매핑과 실제 통계 행 존재 확인 |
| 분기 목록 | 조회 가능한 두 통계의 distinct quarter_code, DB 수치를 code string/label로 표현 |
| 통계 조회 | 내부 업종 code → SEOUL 원본 코드 → 두 통계의 quarter_code/dong_code/source_industry_code. industry_id 연결도 일치해야 함 |
| 식별자 | DB의 복합 키는 원본 업종 기준, 외부는 내부 업종 기준. 단일 서울시 매핑으로 대응하며 surrogate id는 반환하지 않음 |

실제 SQL·Repository·DTO Java 설계는 5단계에서 구현합니다. 이후 테스트는 정상·입력 오류·부분/전체 NO_ROW·metric NULL·0·BIGINT 정밀도와 매핑 오류를 구분해야 합니다. API integration test는 아직 실행하지 않았습니다.
