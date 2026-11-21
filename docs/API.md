# REST API 레퍼런스

Backend와 연동하는 개발자를 위한 조회 계약입니다.

API는 `db` 프로필에서 제공됩니다.

표의 모든 경로는 `GET`입니다.

요청할 때는 경로 앞에 `/api/v1`을 붙입니다.

[로컬 실행](SETUP.md#3-backend) · [통계 원천과 집계 기준](ETL.md#공식-자치구-통계와-집계-정책)

- [공통 오류와 데이터 상태](#공통-오류와-데이터-상태)
- [행정구역](#행정구역-rest-api-계약)
- [구·동 상권 통계](#구동-상권-통계-rest-api-계약)
- [주변·지도 영역 카페](#카페-rest-api-계약)

## 공통 오류와 데이터 상태

서비스 오류는 `application/problem+json` 형식입니다.

`type`, `title`, `status`, `detail`, `instance`와 서비스 오류 `code`를 반환합니다.

예외 원문, 입력 원문, SQL, 접속 정보는 노출하지 않습니다.

미등록 경로의 404와 지원하지 않는 메서드의 405는 MVC 상태와 헤더를 유지하고 서비스 오류 코드는 붙이지 않습니다.

| 상태 | `code` | 의미 |
| --- | --- | --- |
| 400 | `INVALID_PARAMETER` | 필수값 누락·중복·형식·범위 오류 또는 지역 필터 조합 오류 |
| 404 | `REGION_NOT_FOUND` | 준비된 최신 경계 게시본에 요청 지역이 없음 |
| 503 | `DATA_NOT_READY` | 조회에 필요한 경계·통계·카페 게시 데이터가 준비되지 않음 |
| 503 | `DATABASE_UNAVAILABLE` | DB 연결·자원 접근·조회 시간 초과 |
| 500 | `INTERNAL_ERROR` | SQL·응답 매핑·무결성 오류 등 서버 구현 오류 |

- 지역 코드는 선행 0을 보존하는 ASCII 숫자 문자열입니다.

  `districtCode`는 5자리, `dongCode`는 8자리입니다.

- 단일 쿼리 값은 중복을 거부합니다.

  선택값의 기본값은 파라미터를 생략할 때 적용합니다.

  지역 목록 필터는 `districtCodes=11110&districtCodes=11140`처럼 키를 반복합니다.

  중복 코드는 제거하며 쉼표 목록, 공백, 빈 항목은 거부합니다.

  지도 영역의 `dongCodes`도 같은 방식입니다.

- 게시 배치는 적재 실행을 식별하는 기록입니다.

   응답의 `boundaryBatch`와 `sourceBatch`는 각각 경계와 조회 데이터의 출처입니다.

   두 값은 `batchId`(UUID 문자열)와 `publishedAt`(ISO 8601 문자열)을 제공합니다.

  게시 시각은 서비스 DB에서 확정한 시각입니다.

- 경계·통계·카페 조회는 읽기 전용 `REPEATABLE READ` 트랜잭션에서 실행합니다.

  한 응답에서 배치 선택, 데이터 준비 여부, 값과 출처를 같은 DB 시점으로 읽습니다.

## 행정구역 REST API 계약

| 경로 | 쿼리 | 응답 |
| --- | --- | --- |
| `/districts` | 없음 | `items[]`의 각 항목에 `districtCode`, `districtName` |
| `/districts/{districtCode}/dongs` | 없음 | `items[]`의 각 항목에 `dongCode`, `districtCode`, `dongName`, `labelPoint` |
| `/districts/{districtCode}/boundary` | 없음 | 자치구 GeoJSON Feature |
| `/dongs/{dongCode}/boundary` | 없음 | 행정동 GeoJSON Feature |
| `/regions/nearby` | `longitude`, `latitude` 필수. `radiusM`, `districtCodes` 선택 | `boundaryBatch`, `districts[]`, `dongs[]` |

- 각 목록은 지역 코드 오름차순입니다.

  `labelPoint`는 DB에 저장된 WGS84 대표점이며 GeoJSON `Point` 객체로 반환합니다.

- 경계는 `application/geo+json`으로 반환합니다.

  최상위 필드는 `type: "Feature"`, `id`(지역 코드), `geometry`, `properties`입니다.

  `properties`에는 `regionType`, `regionCode`, `regionName`, `districtCode`, `boundaryBatch`가 있습니다.

  좌표는 WGS84 경도·위도 순서입니다.

- 주변 조회에서 경도는 `[-180,180]`, 위도는 `[-90,90]` 범위의 유한한 수입니다.

  `radiusM`은 기본 500m, 허용 범위 1~1,000m이며 소수를 허용합니다.

  두 지역 목록은 각각 코드와 이름을 제공하며, 동에는 소속 구 코드도 포함합니다.

  `containsCenter`는 중심이 해당 경계 안이나 위에 있음을 뜻합니다.

- 주변 조회는 반경과 겹치거나 접촉하는 경계를 반환합니다.

  구 필터가 있으면 지정 구로 범위를 좁히고 동은 반경·구·동의 실제 교집합으로 판정합니다.

  지정 구가 최신 경계에 없으면 404입니다.

  경계 게시본이 준비됐으나 겹치는 지역이 없으면 두 목록이 비어 있습니다.

### 경계 게시본

`SEOUL_DONG_BOUNDARY`, `SHAPEFILE`, 서울 전체(`scope_type=SEOUL`, `scope_code IS NULL`), `PUBLISHED`, 게시 시각 존재 조건을 모두 충족한 배치가 대상입니다.

대상 배치를 `published_at → started_at → batch_id` 내림차순으로 정렬해 첫 배치를 사용합니다.

해당 배치를 참조하는 구·동만 조회하며, 동의 부모 구도 같은 게시본에 속해야 합니다.

최신 적격 배치가 없거나 그 배치의 실제 경계 행이 모두 없으면 503입니다.

과거 경계로 대체하지 않습니다.

경계가 준비된 상태에서 없는 구·동은 404이고, 존재하는 구의 동 목록은 비어 있을 수 있습니다.

## 구·동 상권 통계 REST API 계약

### 통계 분기 목록

`GET /api/v1/statistics/quarters`는 서울 전체에서 하나 이상의 적격 통계 행이 존재하는 분기를 최신순으로 반환합니다.

응답에는 점포·추정매출에 적용한 `industryCode`(`CS100010`), `defaultQuarterCode`, `quarters`가 있습니다. 각 분기는 `quarterCode`, `districtMetrics`, `dongMetrics`를 포함하며 지표 값은 `stores`, `sales`, `foot-traffic`입니다. 유동인구는 업종 구분 없이 집계합니다.

지표 목록은 해당 수준의 현행 지역 중 하나 이상에 적격 통계 행이 있다는 의미입니다. 개별 지역의 자료 유무는 해당 지역의 통계 API가 판정합니다.

기본값은 구·동 두 수준에서 세 지표 모두가 있는 최신 분기입니다. 조건을 충족하는 분기가 없으면 목록의 최신 분기를 사용합니다. 현행 경계가 준비됐으나 적격 행이 없으면 `200`과 `quarters: []`, `defaultQuarterCode: null`을 반환합니다. 경계가 미준비면 `503 DATA_NOT_READY`입니다.

[분기 목록의 게시 기준](DATABASE.md#통계-분기-목록)

### 지역별 통계 조회

| 지표 | 자치구 경로 | 행정동 경로 |
| --- | --- | --- |
| 점포 | `/districts/{districtCode}/stats/stores` | `/dongs/{dongCode}/stats/stores` |
| 추정매출 | `/districts/{districtCode}/stats/sales` | `/dongs/{dongCode}/stats/sales` |
| 유동인구 | `/districts/{districtCode}/stats/foot-traffic` | `/dongs/{dongCode}/stats/foot-traffic` |

모든 통계에 `quarterCode`가 필요합니다.

ASCII 연도 4자리와 분기 1~4를 이어 붙인 `YYYYQ` 형식입니다.

점포·매출에는 `industryCode`가 필요하며 형식은 `CS`와 ASCII 숫자 6자리입니다.

유동인구에 `industryCode`를 전달하면 값이 비어 있어도 400입니다.

코드와 분기는 문자열 원문을 검증합니다.

### 응답과 결측

최상위에 요청한 `districtCode` 또는 `dongCode`, `quarterCode`, `data`를 반환합니다.

점포·매출 응답에만 `industryCode`가 포함됩니다.

`data` 객체에는 아래 측정값과 실제 통계 행의 `sourceBatch`가 들어 있습니다.

| 통계 | 측정값 필드 |
| --- | --- |
| 점포 | `storeCount`, `generalStoreCount`, `franchiseStoreCount`, `openedStoreCount`, `closedStoreCount`, `openingRate`, `closureRate` |
| 추정매출 | `monthlySalesAmount`, `monthlySalesCount`, `weekdaySalesAmount`, `weekendSalesAmount` |
| 유동인구 | `totalFootTraffic`, `maleFootTraffic`, `femaleFootTraffic` |

| 상태 | 응답 |
| --- | --- |
| 적격 행과 측정값이 있음 | `200`과 정확한 숫자 문자열. 실제 0은 `"0"`, 저장된 소수 자릿수에 따라 `"0.0000"` 등으로 반환 |
| 적격 행의 측정값이 없음 | `200`과 해당 필드의 JSON `null`. 모든 측정값이 NULL이어도 `data` 객체와 출처 유지 |
| 데이터셋은 준비됐지만 요청 키의 적격 행이 없음 | `200`과 `data: null`. 형식이 유효한 미존재 업종도 이 경우에 포함 |
| 유효한 경계나 통계 데이터셋이 미준비 | `503 DATA_NOT_READY` |
| 준비된 경계에 요청 지역이 없음 | `404 REGION_NOT_FOUND` |

측정값은 JSON 숫자 대신 문자열로 반환합니다.

다른 분기·업종이나 임의의 0으로 대체하지 않습니다.

공식 자치구 통계는 자치구 테이블에서 직접 조회합니다.

[DB의 결측과 정밀도](DATABASE.md#결측과-정밀도)

다음은 `GET /api/v1/districts/00110/stats/foot-traffic?quarterCode=20262`의 합성 응답 예시입니다.

```json
{
  "districtCode": "00110",
  "quarterCode": "20262",
  "data": {
    "totalFootTraffic": "9007199254740993.123456789012345678900",
    "maleFootTraffic": "0.0000",
    "femaleFootTraffic": null,
    "sourceBatch": {
      "batchId": "00000000-0000-0000-0000-000000000002",
      "publishedAt": "2026-10-02T00:00:00Z"
    }
  }
}
```

### 통계 게시 출처

경계 준비 → 경계에 요청 지역이 존재하는지 → 해당 통계 데이터셋 준비 순으로 판정합니다.

데이터셋의 준비 여부는 적격 출처를 가리키는 실제 통계 행이 하나 이상 있는지로 판단합니다.

배치만 존재하면 준비 상태가 아닙니다.

통계 행은 `source_batch_id`로 출처 배치를 참조합니다.

배치는 해당 데이터셋 코드, `CSV` 또는 `API` 출처, 서울 전체 범위, `PUBLISHED`, 게시 시각 존재 조건을 모두 충족해야 합니다.

서비스는 전역 최신 통계 배치로 조회를 제한하지 않습니다.

과거의 적격 배치에서 보존된 분기도 각 행의 출처와 함께 반환합니다.

[데이터셋과 테이블](DATABASE.md#통계-테이블)

## 카페 REST API 계약

### 주변 카페 REST API 계약

`/cafes/nearby`는 중심점 주변을 조회합니다.

`longitude`, `latitude`는 필수이며 범위는 행정구역 주변 조회와 같습니다.

`radiusM`은 선택이며 기본 500m, 허용 범위 1~1,000m입니다.

`districtCodes`를 선택할 수 있습니다.

거리는 PostGIS의 `geography` 연산으로 미터 단위로 계산하며 반경에 접촉한 점도 포함합니다.

지정 구가 있으면 경계 위의 점을 포함하여 카페의 실제 좌표로 판정합니다.

정렬은 반올림 전 거리 오름차순이며, 거리가 같으면 업소번호 오름차순입니다.

### 지도 영역 카페 REST API 계약

`/cafes/viewport`는 지도 사각 영역을 조회합니다.

경도 `west`·`east`와 위도 `south`·`north`가 필수입니다.

각 좌표 범위는 주변 조회와 같으며 `west < east`, `south < north`여야 합니다.

역전된 영역·0 면적·날짜 변경선을 가로지르는 영역은 400입니다.

`districtCodes`와 `dongCodes`를 각각 선택할 수 있습니다.

각 목록 안에서는 하나 이상의 코드와 일치해야 하며, 영역·구 목록·동 목록 조건은 모두 적용합니다.

두 목록을 함께 지정하면 모든 동의 부모 구가 지정 구에 포함되어야 하며, 불일치는 400입니다.

영역의 변·모서리와 선택 지역 경계 위의 점은 포함하고, 도형의 구멍 내부는 제외합니다.

행정동 FK와 무관하게 실제 카페 좌표를 사용하고 업소번호순으로 반환합니다.

### 카페 공통 파라미터와 응답

| 항목 | 규칙 |
| --- | --- |
| 좌표·반경 | 유한한 십진수 또는 지수 표기. 공백, Java 16진수·타입 접미사, NaN·무한대 거부 |
| `limit` | ASCII 정수, 기본 100, 1~500 |
| `offset` | ASCII 정수, 기본 0, 0~100,000 |

구·동 필터를 적용할 때는 최신 경계 게시본이 필요합니다.

미준비는 503, 현재 게시본에 없는 구·동과 동의 부모 구 미존재는 404입니다.

필터를 생략하면 경계 게시본 없이도 조회할 수 있습니다.

두 API 모두 `items`, `totalCount`, `limit`, `offset`, `hasMore`, `sourceBatch`를 반환합니다.

`totalCount`는 페이지를 나누기 전 전체 일치 건수이고 `hasMore`는 `offset + items.length < totalCount`입니다.

결과가 없으면 `200`, 빈 배열, 전체 건수 0, `hasMore: false`입니다.

`offset`이 결과 범위를 넘으면 목록만 비고 전체 건수는 유지됩니다.

| 항목 필드 | 타입 |
| --- | --- |
| `bizesId`, `storeName`, `semasIndustryCode`, `semasIndustryName` | 문자열 |
| `branchName`, `roadAddress`, `lotAddress` | 문자열 또는 `null` |
| `longitude`, `latitude` | WGS84 좌표, JSON 숫자 |
| `distanceM` | 미터 거리, JSON 숫자. 주변 조회에만 포함 |

### 카페 게시본

`SEMAS_CAFE_STORE`, `API`, 서울 전체 범위, `PUBLISHED`, 게시 시각 존재 조건을 충족해야 합니다.

`source_reference`는 유효한 JSON이어야 합니다.

`collection_mode=FULL_SEOUL`, `complete=true`, `classification_verified=true`를 확인합니다.

두 플래그는 JSON 불리언입니다.

적격 배치를 경계와 같은 순서로 정렬해 첫 배치를 고릅니다.

적격 배치가 없거나 선택한 배치를 참조하는 카페 행이 하나도 없으면 503입니다.

과거 배치로 대체하지 않습니다.

실제 행이 있고 좌표가 모두 NULL이면 데이터는 준비된 상태이고, 공간 조회 결과는 빈 배열입니다.

[카페 저장 구조](DATABASE.md#v4-카페-테이블) · [카페 수집과 게시](ETL.md#카페-api-수집적재)
