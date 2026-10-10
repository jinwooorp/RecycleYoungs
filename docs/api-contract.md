# 행정동 통계 API 계약

현재 구현은 아래 GET 5개입니다. 공간·반경·지도·추천 API는 미구현이며 확정된 공간 조회 설계는 [architecture](architecture.md#후보-좌표-조회-설계)에 분리합니다. 데이터 출처/기간은 [data](data.md), 구현 현황은 [project](project.md)가 기준입니다.

## 공통 규칙과 lookup

- UTF-8 `application/json`, camelCase. 목록은 배열, 통계는 객체를 직접 반환합니다. data wrapper·pagination·surrogate ID·원본 source code는 응답하지 않습니다.
- 외부 식별자는 행정동 code string, 내부 업종 code string, 분기 `YYYYQ` string입니다. 이름은 표시용이고 code를 숫자로 바꾸지 않습니다.
- lookup은 유효한 단일 SEOUL mapping과 두 통계 테이블 중 하나 이상에 행이 있는 범위의 합집합입니다. 모든 lookup 조합에 통계가 있다는 뜻은 아닙니다.
- 고정 입력의 조회 범위는 행정동 425개, CAFE/HAIR/KFOOD/PUB, 20251~20254입니다. GYM은 등록됐지만 SEOUL mapping이 없어 미지원입니다. 현재 DB를 재조회한 건수가 아닙니다.
- 빈 DB의 lookup은 200/[]입니다. 내부 업종에 복수 SEOUL mapping이 있거나 mapped row의 industry_id가 다르면 임의 합산하지 않고 DATA_INTEGRITY_ERROR입니다.
- 이름은 최신 분기, 같은 분기면 점포 통계 우선입니다. 같은 table/quarter/dong의 이름 충돌은 오류이며 분기 간 변경·점포/매출 간 이름 차이는 그 자체로 오류가 아닙니다.

| GET 경로 | 허용 query | 200 응답 |
| --- | --- | --- |
| `/api/admin-dongs` | 없음 | code 오름차순 `[{code, name}]` |
| `/api/industries` | 없음 | code 오름차순 `[{code, name}]`, 내부 업종 |
| `/api/quarters` | 없음 | code 오름차순 `[{code, label}]`, label=`2025년 1분기` 형식 |
| `/api/admin-dong-stats` | dongCode, industryCode, quarterCode 필수 | `{dong, industry, quarter, storeStats, salesStats, missingReasons}` |
| `/api/admin-dong-trends` | dongCode, industryCode 필수 | `{dong, industry, quarters}`, 정확히 4개 분기 item |

목록 API에도 query가 전달되면 INVALID_PARAMETER입니다. 존재하지 않는 URL의 404와 유효 조건의 자료 없음은 별개입니다.

## 요청과 검증 순서

| 필드 | 전체 문자열 형식 | 지원 조건 |
| --- | --- | --- |
| dongCode | `[0-9]{8}` | 행정동 lookup의 code |
| industryCode | `[A-Z][A-Z0-9_]{0,29}` | 내부 업종에 등록되고 유효 SEOUL mapping/통계로 조회 가능 |
| quarterCode | `[1-9][0-9]{3}[1-4]` | 단건 API만 허용, 분기 lookup에 포함 |

필수값은 각각 정확히 한 번 전달합니다. 같은 값 반복도 중복이고 trim·대소문자 보정·기본값·최신 분기 자동 선택이 없습니다. 공백 문자열은 빈 값이 아닌 형식 오류입니다. 원본 업종 code를 요청 식별자로 쓰지 않습니다.

1. 허용 필드의 중복을 dongCode→industryCode→quarterCode 순으로 검사합니다. 추세는 앞의 두 필드만 검사합니다.
2. 미정의 query key를 문자열 오름차순으로 검사해 첫 key를 반환합니다.
3. 누락/빈 값, 형식을 각각 위 필드 순서로 검사합니다.
4. 같은 읽기 전용 transaction에서 전역 SEOUL mapping·lookup/통계 무결성을 확인합니다. 지원 여부 검사 전에 500이 발생할 수 있습니다.
5. dong→industry→quarter 지원 여부를 검사합니다. 추세에는 quarter 지원 검사가 없습니다.

추세에 quarterCode/year/fromQuarter/toQuarter/limit를 전달하면 값과 무관하게 INVALID_PARAMETER입니다. 예를 들어 dongCode 누락+quarterCode 전달이면 field=quarterCode 구조 오류가 우선이고 dongCode 중복까지 있으면 field=dongCode가 먼저입니다.

## 응답 필드와 숫자 계약

lookup·mapping/무결성 검사와 통계 조회는 하나의 **READ ONLY / REPEATABLE READ transaction**입니다. 단건과 추세의 response 의미는 같으며 여러 SQL을 서로 다른 snapshot으로 조합하지 않습니다.

`dong`, `industry`는 null 불가 `{code, name}`, `quarter`는 null 불가 `{code, label}`입니다. section이 존재하면 아래 모든 metric을 포함하며 NULL 필드도 생략하지 않습니다.

| section/필드 | JSON 타입 | DB/단위 |
| --- | --- | --- |
| storeStats | object 또는 null | 점포 통계 row |
| storeCount | integer number 또는 null | store_count, 개 |
| similarStoreCount | integer number 또는 null | similar_store_count, 개 |
| openingStoreCount | integer number 또는 null | opening_store_count, 개 |
| closingStoreCount | integer number 또는 null | closing_store_count, 개 |
| franchiseStoreCount | integer number 또는 null | franchise_store_count, 개 |
| salesStats | object 또는 null | 추정매출 row |
| estimatedSalesAmount | decimal integer string 또는 null | sales_amount ← 당월_매출_금액, 원 |
| transactionCount | decimal integer string 또는 null | transaction_count ← 당월_매출_건수, 건 |
| weekdayEstimatedSalesAmount | decimal integer string 또는 null | weekday_sales_amount, 원 |
| weekendEstimatedSalesAmount | decimal integer string 또는 null | weekend_sales_amount, 원 |
| missingReasons | null 불가 object | storeStats/salesStats 두 키, 각각 null 또는 `"NO_ROW"` |

점포 수는 signed DB INTEGER 범위, 매출의 금액·건수는 signed BIGINT 범위 `-9223372036854775808`~`9223372036854775807`입니다. BIGINT는 부호 포함 10진 정수 문자열로 전달하며 지수·소수점·자리 구분·JSON number를 쓰지 않습니다. `"9007199254740993"`도 보존하고 JS Number/parseInt/parseFloat로 변환하지 않습니다. Frontend는 string 상태를 유지하고 정확한 표시/범위 검사에 BigInt를 사용합니다.

다음은 과거 원본/DB 대조 값으로 만든 단건 응답 예시이며 현재 DB를 재조회한 값이 아닙니다.

```json
{
  "dong": {"code": "11110515", "name": "청운효자동"},
  "industry": {"code": "CAFE", "name": "카페"},
  "quarter": {"code": "20251", "label": "2025년 1분기"},
  "storeStats": {
    "storeCount": 114, "similarStoreCount": 115,
    "openingStoreCount": 2, "closingStoreCount": 4, "franchiseStoreCount": 1
  },
  "salesStats": {
    "estimatedSalesAmount": "4535266422", "transactionCount": "302642",
    "weekdayEstimatedSalesAmount": "2853077729",
    "weekendEstimatedSalesAmount": "1682188693"
  },
  "missingReasons": {"storeStats": null, "salesStats": null}
}
```

## NULL・0・NO_ROW와 추세

| DB 상태 | section/이유 | HTTP·표시 |
| --- | --- | --- |
| 행 존재 | object, 이유 null | 200, 해당 자료 제공 |
| 한쪽 행 없음 | 그 section=null, 그 이유=NO_ROW | 200, 다른 자료는 유지 |
| 양쪽 행 없음 | 두 section=null, 두 이유=NO_ROW | 200, 유효 조건의 자료 없음. 404/오류로 바꾸지 않음 |
| 행 존재·metric NULL | 해당 metric만 null, section 이유 null | 값 결측. 원인을 임의 생성하지 않음 |
| 행 존재·실제 0 | number 0 또는 BIGINT string "0" | 실제 0. 결측을 0으로 채우지 않음 |

행 존재는 row 자체로 판단하며 첫 metric의 NULL/0으로 판단하지 않습니다. HTTP/network 실패는 NO_ROW와 별개의 오류 상태입니다.

추세의 `quarters`는 항상 code 순서 **20251, 20252, 20253, 20254**의 정확히 4개 item입니다. 각 item은 `{quarter, storeStats, salesStats, missingReasons}`이고 단건과 같은 section 계약입니다. 최상위에는 dong/industry와 quarters만 있으며 top-level quarter·요약 상태는 없습니다.

- 한 분기 또는 네 분기 모두 NO_ROW여도 item을 생략하거나 quarters=[]로 바꾸지 않습니다. label은 2025년 1~4분기입니다.
- 기간 축은 DB quarter lookup과 독립적으로 고정됩니다. DB 전체에 한 분기가 없어도 item을 유지하며 다른 연도가 추가돼도 이 API는 2025년만 반환합니다.
- 지원 동/업종은 기존 lookup을 사용합니다. 다른 연도 자료로 lookup에 들어온 조합은 2025 전체 NO_ROW일 수 있고, 빈 DB에서는 UNKNOWN_DONG입니다.
- dong.name은 기간 밖을 포함한 기존 최신 lookup 이름 하나입니다. 분기별 역사적 이름을 만들어내지 않습니다.
- 중복 key·무결성/DB 오류가 발생하면 요청 전체를 실패시킵니다. 정상 분기 일부와 오류를 섞거나 오류 분기를 NO_ROW로 바꾸지 않습니다.
- 같은 DB snapshot의 단건과 추세 item은 같아야 하지만 별도 HTTP 요청 사이의 snapshot 동일성까지 보장하지 않습니다.

## 오류 계약

wrapper 없이 `{code, message, field}` 세 필드를 항상 반환합니다. message는 한국어 표시용이고 분기는 code로 합니다. field는 해당 query 이름 또는 null입니다. SQL·stack trace·접속 정보는 노출하지 않습니다.

| HTTP | code | 조건 / field |
| --- | --- | --- |
| 400 | INVALID_PARAMETER | 누락·빈 값·중복·미정의 query / 해당 이름 |
| 400 | INVALID_DONG_CODE | 동 code 형식 / dongCode |
| 400 | UNKNOWN_DONG | 동 lookup 부재 / dongCode |
| 400 | INVALID_INDUSTRY_CODE | 업종 code 형식 / industryCode |
| 400 | UNKNOWN_INDUSTRY | 내부 업종 부재, CS100010 직접 요청 포함 / industryCode |
| 400 | UNSUPPORTED_INDUSTRY | 등록됐지만 lookup 미지원, GYM 포함 / industryCode |
| 400 | INVALID_QUARTER | 분기 형식 / quarterCode |
| 400 | UNSUPPORTED_QUARTER | 형식은 맞지만 lookup 미지원 / quarterCode |
| 500 | DATA_INTEGRITY_ERROR | 모호한 mapping·mapped row industry_id NULL/불일치·중복·명칭/분기 무결성 / null |
| 500 | INTERNAL_ERROR | DB 연결 등 예상 밖 실패 / null |

전역 유효 SEOUL mapping과 통계 무결성 검사 때문에 요청하지 않은 조합/2025 밖의 오류도 500이 될 수 있습니다. 유효 조건의 NO_ROW는 오류 code가 아닙니다.

## 단위와 metadata

점포 수는 개, 추정매출 금액은 원, 거래 건수는 건입니다. 분기 code에 귀속된 **원본 보고값**이며 원본의 `당월` 열 이름을 월평균·분기 총액·연간액으로 재해석하지 않습니다. 합·평균·점포당 매출·증감률·성공률을 추가 계산하지 않습니다. openingRate/closingRate·시간대/연령대 등 세부 필드는 현재 최소 계약에 없습니다.

통계 응답의 기간 metadata는 quarter만 제공합니다. 통계/점포 source·적재 시각·dataset version catalog가 없으므로 값을 만들거나 Flyway version을 데이터 version으로 대체하지 않습니다. V2 공간 provenance도 이 catalog를 대신하지 않습니다. 출처/버전 응답은 별도 metadata 설계·migration·계약 확장 후 제공하며 요청 중 CSV/manifest/원천 페이지를 읽는 우회는 금지합니다.

형식과 실제 구현은 [ApiResponses](../backend/src/main/java/com/example/backend/admindong/ApiResponses.java), [QueryValidator](../backend/src/main/java/com/example/backend/admindong/QueryValidator.java), [admindong 패키지](../backend/src/main/java/com/example/backend/admindong/)를 함께 확인합니다. 과거 반복 JSON 예시·테스트 과정은 Git 이력에 두고 현재 계약만 유지합니다.
