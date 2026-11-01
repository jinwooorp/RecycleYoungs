# 창업 환경 점수 설계·데이터 적합성 검토

검토일: 2026-11-01(KST). 대상: 현재 `project-upgrade` 작업 트리, `20262`(2026년 2분기), 카페 업종 `CS100010`(DB 명칭 `커피-음료`). 유동인구는 업종 구분 없이 지역·분기로만 연결합니다.

이 문서는 **검토 결과**이며 점수 산식·가중치·정규화·새 API·저장 스키마의 확정 계약이 아닙니다. 기존 [서비스 요구사항](service-spec.md), [데이터 계약](data-design.md), [자치구 통계 정책](district-statistics-policy.md)을 유지합니다. 실제 점수·순위는 계산하지 않았습니다.

## 1. 결론과 근거 수준

- **검증된 사실:** 로컬 개발 DB의 최신 정상 경계는 25구·425동입니다. 대상 분기의 정상 게시 점포·인구는 모든 지역에 존재하고, 매출은 자치구 25/25, 행정동 421/425입니다. 존재하는 행의 14개 측정값에는 NULL이 없지만 실제 0은 있습니다.
- **설계 제안:** 구·동별로 분리된 같은 분기·업종의 비교 집단에서 정규화하고, 원본과 출처를 보존합니다. 필수 입력이 빠진 4개 동은 매출을 쓰는 점수 후보에서 산출 불가로 둡니다. 규모형 지표와 점포당 지표를 비교하되 어느 후보도 현 단계에서 채택하지 않습니다.
- **미확정:** 원천의 통계 경계와 현행 경계의 시점 일치, 서로 다른 자료의 카페 모집단 일치, 개폐업률의 정확한 분모·반올림, 매출과 인구의 세부 기간 의미, 결측 사유, 가중치·정규화·소규모 기준·기간 안정성입니다. **행 존재와 수치 품질은 확인했지만 점수의 타당성이 입증된 것은 아닙니다.**

검토 시작 시 미커밋 변경은 없었습니다. 다른 브랜치·Git 이력은 조회하지 않았고 브랜치 전환·커밋·Push도 하지 않았습니다. 변경은 이 문서로 한정하며 제품 코드·마이그레이션·기존 문서는 수정하지 않습니다.

## 2. 확인한 계약과 코드

| 근거                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 확인 내용                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [AGENTS.md](../AGENTS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 현재 작업 트리만 사용, 읽기 전용 DB 분석, 임시 파일·불필요한 구현 금지                                        |
| [서비스 명세](service-spec.md#3-창업-환경-점수-확인)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 0~100의 지역 상대평가, 성공 확률·수익 예측 아님, 데이터 부족 시 산출 불가, 구·동·반경 구분                    |
| [데이터 설계](data-design.md#2-통계-데이터), [재현성](data-design.md#5-평가-결과의-재현성)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | BIGINT/NUMERIC 정밀도, NULL과 0 구분, 원본 비율, 입력·버전·정규화 근거 보존; `region_score`와 점수 API 미확정 |
| [자치구 정책](district-statistics-policy.md#지표별-집계-정책)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 공식 자치구 원천 우선, 동 합계·비율 평균·임의 분모·당월 환산·인구 중복 합산 금지                              |
| [V2](../backend/src/main/resources/db/migration/V2__create_core_tables.sql), [V3](../backend/src/main/resources/db/migration/V3__create_dong_stat_tables.sql), [V5](../backend/src/main/resources/db/migration/V5__create_district_store_stat.sql)·[V6](../backend/src/main/resources/db/migration/V6__create_district_sales_stat.sql)·[V7](../backend/src/main/resources/db/migration/V7__create_district_foot_traffic_stat.sql)                                                                                                                                                           | 지역·업종·배치 FK, 점포·매출의 지역/업종/분기 PK, 인구의 지역/분기 PK; 모든 측정값 NULL 허용·기본값 없음      |
| [RegionRepository](../backend/src/main/java/kr/ac/recycleyoungs/region/RegionRepository.java)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 최신 정상 경계 선택, 동과 부모 구의 같은 경계 게시본 검사                                                     |
| [동 점포](../backend/src/main/java/kr/ac/recycleyoungs/store/StoreStatRepository.java)·[구 점포](../backend/src/main/java/kr/ac/recycleyoungs/store/DistrictStoreStatRepository.java), [동 매출](../backend/src/main/java/kr/ac/recycleyoungs/sales/SalesStatRepository.java)·[구 매출](../backend/src/main/java/kr/ac/recycleyoungs/sales/DistrictSalesStatRepository.java), [동 인구](../backend/src/main/java/kr/ac/recycleyoungs/foottraffic/FootTrafficStatRepository.java)·[구 인구](../backend/src/main/java/kr/ac/recycleyoungs/foottraffic/DistrictFootTrafficStatRepository.java) | 각 통계 행의 실제 정상 출처를 검사하며 전역 최신 통계 배치를 강제하지 않음                                    |
| 위 6개 통계의 Service                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 경계 준비 → 현행 지역 존재 → 데이터셋 준비 → 조건별 조회; 읽기 전용 `REPEATABLE_READ` 트랜잭션                |
| [개발 DB 접속 안내](development.md#로컬-db-준비)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 현재 프로젝트의 Compose 로컬 DB 사용                                                                          |

### 반드시 유지할 게시 조건

1. 경계는 `SEOUL_DONG_BOUNDARY / SHAPEFILE / SEOUL / scope_code IS NULL / PUBLISHED / published_at IS NOT NULL` 중 `published_at, started_at, batch_id DESC` 첫 배치를 선택한 **후** 실제 구·동 경계 행 존재를 검사합니다. 최신 적격 배치가 비었다고 과거 경계로 되돌아가지 않습니다.
2. 구는 선택 경계 게시본을 참조해야 하고, 동은 자신과 부모 구 모두 그 게시본을 참조해야 합니다. 이번 커버리지의 분모도 이 조건을 사용합니다. 현재 경계의 코드 일치가 통계 시점의 경계 일치까지 증명하지는 않습니다.
3. 통계는 아래 데이터셋과 `CSV / SEOUL / scope_code IS NULL / PUBLISHED / published_at IS NOT NULL`을 **행별 `source_batch_id` JOIN**으로 검사합니다. `FAILED / RUNNING / SKIPPED` 및 잘못된 출처는 제외합니다.

| 단위   | 점포                        | 매출                        | 인구                               |
| ------ | --------------------------- | --------------------------- | ---------------------------------- |
| 자치구 | `SEOUL_DISTRICT_STORE_STAT` | `SEOUL_DISTRICT_SALES_STAT` | `SEOUL_DISTRICT_FOOT_TRAFFIC_STAT` |
| 행정동 | `SEOUL_DONG_STORE_STAT`     | `SEOUL_DONG_SALES_STAT`     | `SEOUL_DONG_FOOT_TRAFFIC_STAT`     |

통계에는 전역 최신 배치 제한을 추가하지 않습니다. ETL이 보존한 과거 정상 행을 새 빈 배치나 `SKIPPED`가 가리지 않아야 합니다. 이번에는 자료별 한 배치씩 관찰했지만 이를 단일 배치 제약으로 일반화하지 않습니다. 점포·매출·인구의 UUID가 서로 다르다는 것은 정상입니다.

유효한 실제 행이 전체에 하나라도 있어야 해당 데이터셋 준비 상태입니다. 기존 API의 경계·데이터셋 미준비(503), 현행 지역 미존재(404), 준비 후 조건별 행 미존재(`200, data: null`), 측정값 전부 NULL인 실제 행(`data` 객체와 출처 유지)을 구분합니다. 점수 산출 불가에 대한 향후 표현은 이 통계 API 계약을 바꾸지 않습니다.

## 3. 검증된 사실: 실제 DB 분석

### 실행 범위와 재현성

현재 `compose.yaml`의 로컬 `db` 서비스(127.0.0.1에 공개)를 사용했습니다. 최초 Docker 소켓 접근은 샌드박스 권한으로 차단되어 읽기 전용 상태 확인·SQL 실행 권한을 사용했습니다. DB 시작·적재·마이그레이션·API 서버 실행은 하지 않았습니다.

- 기본 분석: 2026-11-01 **13:36:33.855834 KST**.
- 파생지표·극값 추가 분석: 같은 날 **13:37:04.191417 KST**.
- 각각 `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, `SET LOCAL statement_timeout='30s'`, 마지막 `ROLLBACK`으로 종료했습니다. `PGOPTIONS=-c default_transaction_read_only=on`도 적용했고 DB 응답에서 `transaction_read_only=on`, `transaction_isolation=repeatable read`를 확인했습니다.
- 두 분석은 **별도의 트랜잭션**입니다. 각 분석 내부는 같은 스냅샷이며, 두 시점이 하나의 스냅샷이라고 주장하지 않습니다. 원본 파일·공공 포털을 재수집하거나 과거 문서의 검증을 재수행한 것은 아닙니다.
- `source_reference`의 경로·인증정보는 출력하거나 문서에 싣지 않았습니다.

경계 배치: `e8653cde-14bd-42e1-b539-d6ac6e355fd5`, 게시 시각 `2026-10-29T13:42:42.421126Z`, ETL `boundary-v1`, SHA-256 `07c8d3b3e3de3e3c7ab10cd703d826c465e95084031b8813d261346fcb462f47`.

아래 게시 시각은 초까지 표시한 KST이며, 실제 DB의 소수 초를 변경한 것이 아닙니다. 배치 분기 범위는 입력 관찰 범위이지 모든 지역·업종 조합의 완전성 보장이 아닙니다.

| 단위·자료   | 실제 source_batch_id                   | 게시 시각(KST)      | 배치 분기 범위 | ETL 버전                        |
| ----------- | -------------------------------------- | ------------------- | -------------- | ------------------------------- |
| 자치구 인구 | `7d40f4b8-2eba-4b98-af54-477608c51856` | 2026-11-01 13:06:00 | 20211~20262    | `district-foot-traffic-stat-v1` |
| 자치구 매출 | `19bcbf8b-9ef4-41fe-8a31-e3e2f861a349` | 2026-10-31 23:47:10 | 20211~20262    | `district-sales-stat-v1`        |
| 자치구 점포 | `d3fbcf90-18e3-4c20-bd30-cf29abdbe748` | 2026-10-31 18:50:24 | 20211~20262    | `district-store-stat-v1`        |
| 행정동 인구 | `7c0fa332-07a4-49c2-b0d6-d663034c1ccd` | 2026-10-30 15:42:05 | 20211~20262    | `foot-traffic-stat-v1`          |
| 행정동 매출 | `cf227b7c-e89b-40c6-8aee-7ab79ab203e4` | 2026-10-30 13:18:31 | 20251~20262    | `sales-stat-v1`                 |
| 행정동 점포 | `8ec56d06-0751-43c2-acf8-8ddbe2805c24` | 2026-10-30 11:09:49 | 20251~20262    | `store-stat-v1`                 |

| 단위·자료   | 원본 체크섬(SHA-256)                                               |
| ----------- | ------------------------------------------------------------------ |
| 자치구 인구 | `b29fbba82196f94eff890782e904d55b50fb1de6e0a5907fffa432a9e042a4fb` |
| 자치구 매출 | `d78b04e3367195f3bee78db3fb4c1cb95091b4e30ed2943b1f235c6abca85daa` |
| 자치구 점포 | `84702068872a5ab8c6c824f11294a16f8b306afb6c19a25689af4c135bf377fd` |
| 행정동 인구 | `2524e3a8383978353b869bcc2f9eae402fa55655fe60c43f0cfe8c588ff7f9f1` |
| 행정동 매출 | `57ce0737c3fc3c6a3f7ac63dd7cf3b7b40c2fff1bf2175d48f4d6509add9884a` |
| 행정동 점포 | `174b5e47f1874209b2f4246b2888a63ccc8a4a04819a5f18b675932c8adc632c` |

### 커버리지·NULL·0

분모는 최신 정상 경계의 **25구·425동**입니다. 통계가 관찰되는 지역만으로 분모를 줄이지 않았습니다. 점포·매출은 `CS100010`으로 먼저 제한하고 인구는 업종 조건 없이 지역·분기로 1:1 연결했습니다.

| 자료        | 정상 행/대상 지역 | 커버리지 | 부적격 출처 행 | 없는 행 | 존재 행의 NULL 셀 |
| ----------- | ----------------: | -------: | -------------: | ------: | ----------------: |
| 자치구 점포 |             25/25 |     100% |              0 |       0 |             0/175 |
| 자치구 매출 |             25/25 |     100% |              0 |       0 |             0/100 |
| 자치구 인구 |             25/25 |     100% |              0 |       0 |              0/75 |
| 행정동 점포 |           425/425 |     100% |              0 |       0 |           0/2,975 |
| 행정동 매출 |           421/425 |   99.06% |              0 |       4 |           0/1,684 |
| 행정동 인구 |           425/425 |     100% |              0 |       0 |           0/1,275 |

총 6,284개 존재 측정값의 NULL·음수·비유한 값은 각각 0개입니다. 대상 분기·업종의 통계 중 현행 경계 밖 지역도 0개였습니다. 매출 행 4개가 없는 것을 NULL 셀 16개나 매출 0원으로 계산하지 않습니다. 현행 키의 중복 없는 연결은 PK로 보장되며, 통계 경계의 역사적 호환성까지 보장하지는 않습니다.

| 매출 행이 없는 행정동 | 코드       | 점포 수 | 총 유동인구 | 판정                         |
| --------------------- | ---------- | ------: | ----------: | ---------------------------- |
| 중랑구 면목5동        | `11260550` |      18 |   2,333,237 | 점포·인구 있음, 매출 행 없음 |
| 노원구 하계2동        | `11350612` |       3 |   2,709,361 | 동일                         |
| 서대문구 북가좌1동    | `11410710` |       7 |   2,907,485 | 동일                         |
| 강남구 개포1동        | `11680660` |       3 |   2,249,031 | 동일                         |

핵심 후보 입력인 전체 점포 수(양수)·개업률·폐업률·당월 매출액·총 유동인구가 모두 있는 지역은 **25구·421동**입니다. 이는 입력 완비 수이며 점수 게시 가능 지역 수가 아닙니다. 누락 원인이 비공개·미제공·모집단 차이·적재 누락 중 무엇인지는 조사하지 못했습니다.

실제 0은 행정동의 프랜차이즈 점포 수 4행, 개업 점포 수·개업률 각각 95행, 폐업 점포 수·폐업률 각각 102행, 주중·주말 매출액 각각 1행입니다. 다른 측정값의 0은 없고 자치구의 14개 측정값에도 0은 없습니다. 개·폐업 수가 양수인데 대응 비율이 0인 행은 없었습니다.

- 관악구 삼성동(`11620745`): 당월 362,431원, 주중 **0원**, 주말 362,431원, 점포 6개.
- 성북구 돈암1동(`11290580`): 당월 406,669원, 주중 406,669원, 주말 **0원**, 점포 7개.

### 분포 산출 기준

아래 표는 DB의 원본 수치를 사용합니다. 점포는 개, 비율은 %, 매출액은 원, 인구는 원천 추정 유동 규모입니다. `당월`을 분기 총액·월평균으로 환산하지 않았고 인구를 고유 방문자·카페 고객·일평균으로 해석하지 않았습니다.

Q1·중앙값·Q3·P95는 지역 단위별 `percentile_disc`이며 NULL·없는 행을 제외합니다. **0은 포함**합니다. IQR 후보는 `x < Q1 - 1.5×IQR` 또는 `x > Q3 + 1.5×IQR`인 행 수이고 경계값은 포함하지 않습니다. 이는 탐색용 이상치 기준이며 오류·삭제·점수 제외 판정이 아닙니다. 매출 분포는 421동, 점포·인구는 425동으로 계산했으므로 아래 단변량 분포를 그대로 하나의 최종 정규화 집단으로 쓰면 안 됩니다.

### 자치구 분포

| 지표               | 유효값 n |   0 |          최소 |             Q1 |         중앙값 |             Q3 |            P95 |            최대 | IQR 후보 |
| ------------------ | -------: | --: | ------------: | -------------: | -------------: | -------------: | -------------: | --------------: | -------: |
| 전체 점포 수       |       25 |   0 |           429 |            758 |            940 |          1,381 |          2,306 |           2,568 |        1 |
| 일반 점포 수       |       25 |   0 |           310 |            533 |            696 |          1,016 |          1,913 |           1,937 |        2 |
| 프랜차이즈 점포 수 |       25 |   0 |           119 |            200 |            237 |            365 |            431 |             655 |        1 |
| 개업 점포 수       |       25 |   0 |            18 |             28 |             36 |             48 |             78 |              97 |        1 |
| 폐업 점포 수       |       25 |   0 |            15 |             27 |             32 |             49 |             87 |              93 |        2 |
| 개업률(%)          |       25 |   0 |           2.9 |            3.2 |            4.0 |            4.4 |            5.0 |             5.0 |        0 |
| 폐업률(%)          |       25 |   0 |           2.2 |            3.1 |            3.6 |            4.1 |            5.4 |             5.8 |        1 |
| 당월 매출액(원)    |       25 |   0 | 7,078,134,884 | 15,024,205,928 | 18,686,535,573 | 46,633,620,842 | 73,960,734,468 | 111,951,315,972 |        1 |
| 당월 매출 건수     |       25 |   0 |     1,132,813 |      2,419,225 |      2,931,292 |      5,867,811 |      9,346,102 |      12,906,415 |        1 |
| 주중 매출액(원)    |       25 |   0 | 4,734,162,882 | 11,021,808,860 | 13,835,059,696 | 32,196,930,559 | 60,928,179,235 |  88,136,910,628 |        1 |
| 주말 매출액(원)    |       25 |   0 | 2,343,972,002 |  4,002,397,068 |  6,245,422,038 |  9,370,035,147 | 21,669,913,838 |  23,814,405,344 |        3 |
| 총 유동인구        |       25 |   0 |    34,009,296 |     74,944,099 |     91,854,597 |    109,493,454 |    126,819,930 |     144,021,213 |        0 |
| 남성 유동인구      |       25 |   0 |    16,760,297 |     34,890,451 |     41,679,580 |     50,882,489 |     62,361,972 |      69,434,941 |        0 |
| 여성 유동인구      |       25 |   0 |    17,249,000 |     40,053,648 |     48,833,737 |     58,610,964 |     65,596,156 |      74,586,272 |        0 |

### 행정동 분포

| 지표               | 유효값 n |   0 |    최소 |          Q1 |      중앙값 |            Q3 |           P95 |           최대 | IQR 후보 |
| ------------------ | -------: | --: | ------: | ----------: | ----------: | ------------: | ------------: | -------------: | -------: |
| 전체 점포 수       |      425 |   0 |       3 |          26 |          44 |            79 |           172 |            702 |       29 |
| 일반 점포 수       |      425 |   0 |       2 |          18 |          32 |            59 |           144 |            605 |       31 |
| 프랜차이즈 점포 수 |      425 |   4 |       0 |           6 |          11 |            19 |            45 |            150 |       29 |
| 개업 점포 수       |      425 |  95 |       0 |           1 |           2 |             3 |             7 |             23 |       30 |
| 폐업 점포 수       |      425 | 102 |       0 |           1 |           2 |             3 |             7 |             27 |       28 |
| 개업률(%)          |      425 |  95 |       0 |           1 |           4 |             6 |            10 |             20 |        7 |
| 폐업률(%)          |      425 | 102 |       0 |           1 |           3 |             6 |            11 |             27 |        8 |
| 당월 매출액(원)    |      421 |   0 | 362,431 | 286,495,468 | 709,824,979 | 1,784,980,607 | 6,462,733,848 | 35,592,357,357 |       53 |
| 당월 매출 건수     |      421 |   0 |      32 |      46,977 |     104,781 |       258,836 |       855,085 |      3,730,910 |       40 |
| 주중 매출액(원)    |      421 |   1 |       0 | 195,266,143 | 498,647,663 | 1,210,881,750 | 5,040,647,082 | 28,398,869,739 |       52 |
| 주말 매출액(원)    |      421 |   1 |       0 |  84,028,900 | 217,669,360 |   506,447,168 | 1,687,167,488 | 11,085,296,359 |       41 |
| 총 유동인구        |      425 |   0 |  28,921 |   3,286,908 |   4,888,791 |     6,690,790 |    11,201,148 |     27,308,067 |       15 |
| 남성 유동인구      |      425 |   0 |  13,235 |   1,491,556 |   2,272,564 |     3,160,751 |     5,136,831 |     12,698,644 |       13 |
| 여성 유동인구      |      425 |   0 |  15,685 |   1,738,375 |   2,589,488 |     3,549,289 |     6,000,637 |     14,609,424 |       13 |

### 이상치·일관성의 해석

- 자치구 매출액의 최대는 강남구(`11680`) 111,951,315,972원이며 상단 IQR 기준 94,047,743,213원을 넘는 1행입니다. 점포 최대도 강남구 2,568개입니다. 행정동 매출 최대 역삼1동(`11680640`)은 35,592,357,357원으로 중앙값의 약 50.1배이고, IQR 매출 후보는 53/421동입니다. 원시 최솟값·최댓값 정규화는 대다수 동의 차이를 압축할 위험이 있습니다.
- 행정동 점포 최대는 서교동(`11440660`) 702개, 인구 최대는 북아현동(`11410555`) 27,308,067입니다. 인구 최소는 둔촌1동(`11740690`) 28,921로, 큰 격차의 원인이 지역 특성·경계·추정 방식 중 무엇인지는 확인하지 않았습니다.
- 폐업률 최대는 중랑구 5.8%, 보광동(`11170700`) 27%; 개업률 최대는 은평구·영등포구 5.0%, 마천1동(`11710540`) 20%입니다. 이번 카페·분기의 100% 초과 비율은 0행이지만, 기존 계약은 다른 분기·업종의 100% 초과도 허용합니다.
- 개업률의 서로 다른 값은 15개(구)·18개(동), 폐업률은 17개(구)·20개(동)입니다. 많은 0과 동률을 고려해야 하며 코드순 임의 순위로 동률을 깨면 안 됩니다.
- 전체 점포와 일반+프랜차이즈, 당월 매출액과 주중+주말 매출액의 불일치는 이번 범위에서 각각 0행입니다. 반면 총인구와 남녀 합계는 13/25구에서 차이 -2~+3, 200/425동에서 차이 -3~+3입니다. 성별 합계로 총인구를 교체하거나 오류로 거부하지 않습니다.
- 원시 Pearson 상관은 매출액–점포 수가 구 0.9114·동 0.8797, 인구–점포 수가 구 0.4790·동 0.4604, 매출액–인구가 구 0.2734·동 0.3376입니다. SQL `corr`의 부동소수 근사 결과를 소수 4자리로 표시했고 NULL 쌍은 제외했습니다(매출 관련 동 n=421, 인구–점포 동 n=425). 이는 규모 효과·중복 반영 검토의 근거이며 인과관계·예측력을 의미하지 않습니다.

구와 동 합계의 차이율·일치 여부는 계산하지 않았습니다. 가산성·판본·과거 경계 검증 없이 공식 구 통계를 동 합계에 맞출 근거가 없기 때문입니다.

### 점포당 지표의 적합성 탐색

아래는 **탐색용 나눗셈**입니다. 원본 비율을 재계산하거나 점수를 산출한 것이 아닙니다. 같은 단위·분기·카페 업종의 양수 `store_count`로만 나누었고 원본을 보정하지 않았습니다. 표시값은 소수 둘째 자리로 반올림합니다.

| 탐색 지표                | 단위 |   n |          최소 |        중앙값 |           P95 |           최대 |
| ------------------------ | ---- | --: | ------------: | ------------: | ------------: | -------------: |
| 당월 매출액/전체 점포 수 | 구   |  25 | 12,147,438.53 | 23,416,711.24 | 47,259,255.25 |  53,146,812.86 |
| 당월 매출액/전체 점포 수 | 동   | 421 |     58,095.57 | 16,651,005.38 | 54,037,370.87 | 127,600,147.66 |
| 총 유동인구/전체 점포 수 | 구   |  25 |     40,951.04 |    102,749.03 |    143,075.70 |     158,745.62 |
| 총 유동인구/전체 점포 수 | 동   | 425 |      1,807.56 |    109,861.40 |    264,754.40 |   1,241,275.77 |

매출의 관측 점포와 점포 통계의 모집단이 같은지 확인하지 않았으므로 첫 지표를 실제 카페의 평균 매출·예상 매출로 부르지 않습니다. 두 번째도 업종 구분 없는 추정 유동 규모를 카페 수로 나눈 참고값이며 카페당 실제 고객 수·전환율이 아닙니다.

점포 수 10개 미만은 15/425동, 20개 미만은 66/425동입니다(구는 둘 다 0). 하계2동은 점포 3개로 매출은 없는데 인구/점포는 903,120.33이고, 삼성동은 점포 6개·매출 362,431원인데 인구/점포는 1,124,607.83입니다. 점포가 적다는 이유만으로 창업 적합성이 높다고 볼 수 없습니다. 두 점포당 지표를 함께 쓰면 같은 분모의 효과가 두 번 반영되는 것도 검토해야 합니다.

## 4. 설계 제안: 집계 단위·분기·입력

### 단위와 기준 분기

- 구 점수는 공식 `district_*_stat`, 동 점수는 `dong_*_stat`만 사용합니다. 동 점수 평균으로 구 점수를 만들거나 공식 구 결측을 동 합산으로 대체하지 않습니다. 구·동 각각 서울 전체 같은 단위 내에서 비교하며 선택한 구의 동들만으로 요청마다 재정규화하지 않습니다.
- 이번 기준은 명시된 `20262`로 고정합니다. 자료마다 가장 최신 분기를 따로 고르지 않고 같은 지역의 점포·매출·인구가 모두 같은 분기인지 확인합니다. 게시일이 늦다는 이유로 기준 분기가 최신이라고 판단하지 않습니다.
- 향후 기본 분기를 고른다면 자료별 최신 분기의 최솟값만 취하지 말고 정상 출처·현재 대상 지역의 실제 커버리지까지 확인한 공통 분기를 검토합니다. 대체 분기가 있다면 사용자에게 기준 변경을 명시하고, 요청 분기의 결측을 다른 분기로 자동 채우지 않습니다.
- 구·동의 점수는 비교 집단이 다릅니다. 구 70점과 동 70점의 직접 비교, 여러 구의 점수 합계, 반경 500m·1km 및 개별 후보지 고유 점수로의 해석을 허용하지 않습니다.

### 지표별 후보와 방향

| 입력                                                    | 후보 역할·방향                                      | 적합성 제한                                                              |
| ------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| 전체 점포 수                                            | 경쟁 규모를 보는 보조 입력; 감소 방향은 후보에 한함 | 적은 점포는 수요 부족일 수도 있음; 지역 크기·면적을 통제한 밀집도와 다름 |
| 당월 추정매출액                                         | 소비 규모의 증가 방향 후보                          | 점포 수·지역 규모와 강한 상관; 당월 의미 유지, 수익·마진 아님            |
| 총 유동인구                                             | 잠재 활동 규모의 증가 방향 후보                     | 카페 업종 수요·고유 고객 아님; 총·남녀를 함께 가중해 중복하지 않음       |
| 폐업률                                                  | 낮을수록 안정적이라는 가설 후보                     | 짧은 기간·작은 모집단은 변동이 큼; 창업 실패 확률로 해석하지 않음        |
| 개업률                                                  | 초기에는 설명 지표, 가중치 0 후보                   | 높으면 유입·경쟁, 낮으면 안정·쇠퇴 모두 가능해 방향 미확정               |
| 매출액/점포 수, 인구/점포 수                            | 규모 보정 대안 후보                                 | 모집단·기간 호환과 소규모 분모 기준 검증 필요; 분모 효과 중복            |
| 개폐업 수·일반/프랜차이즈·매출 건수·주중/주말·남녀 인구 | 분포·품질·설명용                                    | 총계와 중복 가중하거나 별개 독립 수요로 더하지 않음                      |

개폐업률은 **원천 비율**을 사용하며 `개폐업 수/현재 store_count`로 재계산하지 않습니다. 순개업 수·개업률−폐업률을 곧바로 성장·안정성 점수로 해석하지 않습니다. 면적당 밀집도는 통계 시점 경계·면적 기준을 확인하지 않았으므로 이번 후보의 실제 계산에서 제외했습니다.

## 5. 설계 제안: 결측·0·산출 불가

| 조건                                                 | 제안하는 점수 처리                              | 현재 통계 계약과 구분                                     |
| ---------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| 최신 정상 경계 없음·선택 배치가 비어 있음            | 산출 중단, 경계 미준비 사유                     | 기존 API 503, 과거 경계 대체 금지                         |
| 현행 게시본에 지역 없음·동/부모 구 출처 불일치       | 산출 중단, 대상 지역 확인 필요                  | 기존 API 404                                              |
| 필수 데이터셋의 정상 출처 실제 행이 전혀 없음        | 산출 중단, 데이터셋 미준비                      | 기존 API 503                                              |
| 필수 지역·분기·업종 행 없음 또는 필수 셀 NULL        | 해당 지역 점수 산출 불가                        | 기존 API의 정상 `data: null`·실제 NULL 객체를 구분해 보존 |
| 부적격 source_batch_id·분기/업종/단위 불일치         | 해당 입력 사용 금지, 필수 입력이면 산출 불가    | 과거 정상 출처 자체는 제외 사유 아님                      |
| 분모가 0·NULL인 점포당 후보                          | 해당 후보 산출 불가                             | 1이나 작은 상수로 대체하지 않음                           |
| 검증된 실제 0                                        | 원본 0 유지; 지표별 수학적 정의가 가능하면 포함 | 결측 취급·평균 대체 금지; log 후보는 `log(1+x)` 검토      |
| 음수·NaN·Infinity·비정상 중복                        | 산출 중단·원인 확인                             | DB 제약 외의 계산 결과도 검사                             |
| 비교 집단 부족·n≤1·필수 지표가 전부 같은 값          | 정규화 기준 확정 전 산출 중단                   | 임의 중립점·가중치 재분배로 채우지 않음                   |
| 필수 자료의 경계·기간·모집단 호환성을 확인할 수 없음 | 공개 점수 채택 보류                             | 키/행 존재만으로 의미상 적합성 통과로 처리하지 않음       |

필수 지표 하나가 빠졌다고 남은 지표의 가중치를 자동 재분배하면 같은 점수의 의미가 지역별로 달라집니다. 평균·중앙값·0·직전 분기·구 값으로 채우는 방식을 기본으로 두지 않습니다. 현재 매출 결측 4개 동은 매출 필수 후보에서 산출 불가입니다.

소규모 점포는 10개·20개 등을 **검증할 임계값 후보**로만 남깁니다. 둘 중 어느 값도 확정하지 않았고 현재 자료를 일괄 제외하지 않았습니다. 신뢰 가능한 최소 표본 기준이 정해지기 전 작은 분모의 비율·점포당 지표를 무조건 최고 평가하지 않습니다. 분모 안정성·여러 분기 민감도를 먼저 확인하고, 미달을 경고만 할지 산출 불가로 할지 결정해야 합니다.

개업률·주중/주말·성별처럼 설명용으로만 쓰는 값의 결측은 곧바로 전체 점수 불가를 뜻하지 않습니다. **채택한 버전의 필수 입력 목록**으로 판정해야 하며 이 문서의 14개 필드를 모두 필수로 정한 것은 아닙니다.

## 6. 설계 제안: 정규화와 가중치 후보

### 정규화 대안

| 방식                                        | 장점                                 | 이번 데이터에서의 제한                                                          |
| ------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| 원시 min-max                                | 단순하고 값 차이를 직접 반영         | 역삼1동 등 극값에 민감하고 대부분의 매출 차이가 압축됨; 기본 채택은 권하지 않음 |
| 동률 평균 순위 기반 0~1 변환                | 긴 꼬리·단위 차이에 강하고 설명 가능 | 값 차이의 크기를 잃음; 25구는 순위 간격이 크고, 개폐업률은 동률이 많음          |
| `log(1+x)` 후 P05~P95 winsorization·min-max | 0을 유지하며 규모 차이와 꼬리를 완화 | 꼬리의 서로 다른 값이 같은 점수로 묶임; 소규모 분모·의미 불일치를 해결하지 못함 |

**우선 비교할 제안**은 동률 평균 순위 방식과 log/winsor 방식입니다. 양쪽의 지역 순위·동률·상하위 변동을 비교한 뒤 선택합니다. log는 순서를 바꾸지 않으므로 순위 방식 앞에 log를 중복 적용할 이유는 없습니다. 개폐업률처럼 이미 비율인 지표에 log를 일괄 적용하는 것도 보류합니다.

순위 후보를 구체화하면 증가 방향 지표는 `R(x)=(평균 순위(x)-1)/(n-1)`, 감소 방향은 `1-R(x)`입니다. 같은 값은 같은 점수를 받고, 0 동률을 코드순으로 나누지 않습니다. log 후보는 먼저 `y=ln(1+x)`, 같은 비교 집단의 P05·P95로 `y`를 제한한 후 두 경계로 0~1 변환합니다. 경계가 같으면 계산하지 않습니다. 이는 비교할 수학적 정의이며 구현·채택·최종 점수 계산을 하지 않았습니다. 원본을 100%로 자르는 것과 분석 변환에서 꼬리를 제한하는 것을 구분하고, 원본·변환값·기준을 따로 설명해야 합니다.

비교 집단은 단위·분기·업종·정상 출처·필수 입력·소규모 정책을 고정한 뒤 구성합니다. 현재 입력만 보면 구 25개, 동 421개가 공통 완비 후보이며, 추가 제외 기준을 정하면 집단을 다시 확정해야 합니다. 지표마다 편한 지역만 골라 서로 다른 기준으로 정규화하지 않습니다. 품질 보고의 425동 단변량 분포와 최종 점수 비교 집단을 혼동하지 않습니다.

### 가중치 후보

아래 숫자는 분포와 해석의 차이를 검토하기 위한 **예시 제안**입니다. 사용자 합의·성과 데이터 학습·검증으로 정한 값이 아니며 어느 후보로도 점수나 순위를 계산하지 않았습니다. `+`는 증가, `−`는 감소 방향의 정규화 결과를 뜻합니다.

| 후보             | 입력과 가중치(합계 1)                                                          | 장점                                       | 확인할 문제                                                             |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| A: 규모형 기준선 | 당월 매출액(+) 0.30, 총 유동인구(+) 0.30, 전체 점포 수(−) 0.20, 폐업률(−) 0.20 | 현재 직접 제공 지표로 근거를 추적하기 쉬움 | 규모 편향·매출/점포 상관, 점포 감소의 의미가 불명확                     |
| B: 점포당 대안   | 당월 매출액/점포 수(+) 0.40, 총 유동인구/점포 수(+) 0.35, 폐업률(−) 0.25       | 규모 보정 가능성을 비교할 수 있음          | 동일 분모가 두 번 반영됨, 작은 분모·매출 모집단 불일치·인구 업종 불일치 |
| C: B의 비중 비교 | B의 같은 세 지표에 각각 1/3                                                    | 특정 축의 우대를 줄인 민감도 기준          | 균등 비중도 객관적 정답이 아니며 B의 입력 한계는 그대로                 |

개업률은 세 후보 모두 가중치 0인 설명 지표로 둡니다. 총매출과 점포당 매출, 총인구와 점포당 인구, 총·성별 인구, 전체·일반·프랜차이즈 점포를 동시에 독립 점수로 더하지 않습니다. 각 후보의 점수 형식은 향후 `100 × Σ(wᵢ × 정규화 지표ᵢ)`를 검토할 수 있으나 이번에는 실행하지 않았습니다.

**현재 권고:** 최종 가중치를 확정하지 않습니다. A를 규모 편향 확인용 기준선, B·C를 분모 효과 확인용 대안으로 삼고, 입력의 의미가 검증된 뒤에만 후속 비교를 진행합니다. 그때 단위별 분포·동률·순위 상관·상하위 변동, 가중치 ±0.05 변화(다른 비중을 명시적으로 조정해 합계 1 유지), 정규화 대안 및 소규모 기준에 대한 민감도를 확인해야 합니다. 폐업률과 점포 수를 모두 감소 방향으로 반영하는 가설도 검토 대상입니다.

결측 동 4개를 제외해도 전체 대상 425동 중 누락 사실을 공개해야 합니다. 표본 부족·동일값일 때 임의 중립 점수를 주지 않고 해당 버전의 비교 기준을 재검토합니다. 0~100은 상대평가 범위이며 80점을 성공 확률 80%로 설명하거나 실제 검증 없이 좋음/나쁨 구간을 고정하지 않습니다.

## 7. 미확정 사항과 다음 검증

1. **경계·판본:** 20262 통계의 공간 기준과 현행 경계의 일치, 자료별 재배포 판본·기간 호환을 확인해야 합니다. 같은 분기·같은 코드·정상 게시만으로 해소되지 않습니다.
2. **결측 원인:** 4개 동의 매출 원천 행 존재 여부와 미제공·비공개·적재 차이를 대조해야 합니다. 이번에는 원본 재열람·외부 조회·재적재를 하지 않았습니다.
3. **분모·통계 의미:** 개폐업률 분자/분모/기간/반올림, 매출 관측 모집단과 전체 점포 수의 대응, 당월 필드의 상세 기간, 인구의 공간·시간 배분을 확인해야 합니다. 공식 구 비율을 재계산하거나 분기·일평균 환산하지 않습니다.
4. **이상치 사유:** 북아현동 인구, 둔촌1동 낮은 인구, 삼성동·돈암1동 매출 등은 오류로 확정하지 않습니다. 기준 시점·개발/정비·표본·공간 배분 등의 가능성을 실제 근거로 확인해야 합니다.
5. **기간 안정성:** 이번 검토는 20262 단면입니다. 과거 분기 추세·최신 분기 탐색·구/동 합계 차이·정규화/가중치별 실제 순위·백테스트·불확실성은 미실행입니다. 향후 같은 판본·의미가 호환되는 공통 분기로 확대하며, 문서의 전체 파일 기간이나 배치 period 범위를 완전성으로 대신하지 않습니다.
6. **채택 결정:** 필수 입력, 개업률 방향, 소규모 기준, 비교 집단의 최소 크기·필요 커버리지, 이상치 처리, 정규화·가중치·표시 반올림·점수 구간은 미확정입니다. 전처리·입력의 호환성이 확인되기 전에는 공개 점수로 확정하지 않습니다.
7. **재현성·저장:** 채택 시 지역 단위/코드·분기·업종·경계 배치·각 통계 행의 실제 배치·원본 지표·필수 입력 및 제외 사유·비교 집단 목록·정규화 기준·가중치·알고리즘 버전을 보존하는 방향을 제안합니다. 같은 분기의 재게시도 결과를 바꿀 수 있어 입력 식별이 필요합니다. 현재 통계 테이블은 키별 Upsert이므로 배치 ID만 알아도 과거 값이 항상 복원되는 구조는 아닙니다. 점수 사전 계산·저장 위치·캐시·새 API·마이그레이션은 설계/구현하지 않았습니다.

## 8. 검증 범위와 미실행 이유

실제 로컬 DB에서 정상 게시 조건·현행 경계·대상 행·14개 측정값의 커버리지/NULL/0/분위수/IQR·합계 차이·극값·소규모 분모·상관·점포당 탐색을 읽기 전용으로 확인했습니다. SQL은 오류 시 중단하도록 `ON_ERROR_STOP=1`을 사용했습니다. 분석 중 데이터 변경 SQL·DDL·임시 테이블·파일 산출은 사용하지 않았습니다.

문서만 추가하므로 제품 동작 테스트·빌드·마이그레이션·ETL·DB 통합 테스트는 실행하지 않습니다. 기존 문서에 기록된 합성 테스트·적재 검증과 이번 실제 읽기 전용 분석을 구분합니다. 최종 문서 검증은 링크·표·SQL 실행 결과 대조·변경 파일 범위·공백 오류 확인을 대상으로 합니다. 원천 의미·성과에 대한 검증과 실제 점수 계산은 위 미확정 목록에 남겨 둡니다.

## 부록: 읽기 전용 재현 SQL

저장소 루트의 현재 Compose DB에 아래처럼 접속할 수 있습니다. 사용자·DB는 컨테이너의 기존 환경변수를 사용하며 비밀번호를 출력하지 않습니다. 이 명령 자체는 접속만 수행하므로, 이후 SQL을 실행하고 반드시 `ROLLBACK`으로 종료합니다. DB 접근이 불가능한 환경에서는 실행 결과를 추정하지 말고 미실행 사유를 남겨야 합니다.

```sh
docker compose exec db sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

아래는 실행한 분석의 **커버리지·전체 분포 재현용 SQL**입니다. 다른 분기·업종을 검토할 때는 `raw`의 여섯 분기 조건과 점포·매출 네 업종 조건을 함께 바꿔야 합니다. `raw`를 현행 지역에 LEFT JOIN하므로 없는 행과 NULL 셀을 구분합니다. 최신 적격 경계에 실제 행이 없다면 분모가 사라지므로 정상 분석으로 해석하지 않습니다.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT transaction_timestamp(),current_setting('transaction_read_only'),
       current_setting('transaction_isolation');
WITH boundary AS (
 SELECT batch_id FROM etl_batch WHERE dataset_code='SEOUL_DONG_BOUNDARY'
 AND source_type='SHAPEFILE' AND scope_type='SEOUL' AND scope_code IS NULL
 AND status='PUBLISHED' AND published_at IS NOT NULL
 ORDER BY published_at DESC, started_at DESC, batch_id DESC LIMIT 1
), regions AS (
 SELECT 'district'::text AS unit,d.district_code AS code,d.district_name AS name,d.district_code
 FROM district d JOIN boundary b ON d.boundary_batch_id=b.batch_id
 UNION ALL
 SELECT 'dong',a.dong_code,a.dong_name,a.district_code
 FROM administrative_dong a JOIN district d ON d.district_code=a.district_code
 JOIN boundary b ON a.boundary_batch_id=b.batch_id AND d.boundary_batch_id=b.batch_id
), raw AS (
 SELECT 'district'::text AS unit,'store'::text AS kind,s.district_code AS code,
 s.source_batch_id, b.dataset_code,b.source_type,b.scope_type,b.scope_code,b.status,b.published_at,
 to_jsonb(s) AS val,
 (b.dataset_code='SEOUL_DISTRICT_STORE_STAT' AND b.source_type='CSV' AND b.scope_type='SEOUL'
 AND b.scope_code IS NULL AND b.status='PUBLISHED' AND b.published_at IS NOT NULL) AS eligible
 FROM district_store_stat s JOIN etl_batch b ON b.batch_id=s.source_batch_id
 WHERE s.quarter_code='20262' AND s.industry_code='CS100010'
 UNION ALL
 SELECT 'district'::text AS unit,'sales'::text AS kind,s.district_code AS code,
 s.source_batch_id, b.dataset_code,b.source_type,b.scope_type,b.scope_code,b.status,b.published_at,
 to_jsonb(s) AS val,
 (b.dataset_code='SEOUL_DISTRICT_SALES_STAT' AND b.source_type='CSV' AND b.scope_type='SEOUL'
 AND b.scope_code IS NULL AND b.status='PUBLISHED' AND b.published_at IS NOT NULL) AS eligible
 FROM district_sales_stat s JOIN etl_batch b ON b.batch_id=s.source_batch_id
 WHERE s.quarter_code='20262' AND s.industry_code='CS100010'
 UNION ALL
 SELECT 'district'::text AS unit,'foot'::text AS kind,s.district_code AS code,
 s.source_batch_id, b.dataset_code,b.source_type,b.scope_type,b.scope_code,b.status,b.published_at,
 to_jsonb(s) AS val,
 (b.dataset_code='SEOUL_DISTRICT_FOOT_TRAFFIC_STAT' AND b.source_type='CSV' AND b.scope_type='SEOUL'
 AND b.scope_code IS NULL AND b.status='PUBLISHED' AND b.published_at IS NOT NULL) AS eligible
 FROM district_foot_traffic_stat s JOIN etl_batch b ON b.batch_id=s.source_batch_id
 WHERE s.quarter_code='20262'
 UNION ALL
 SELECT 'dong'::text AS unit,'store'::text AS kind,s.dong_code AS code,
 s.source_batch_id, b.dataset_code,b.source_type,b.scope_type,b.scope_code,b.status,b.published_at,
 to_jsonb(s) AS val,
 (b.dataset_code='SEOUL_DONG_STORE_STAT' AND b.source_type='CSV' AND b.scope_type='SEOUL'
 AND b.scope_code IS NULL AND b.status='PUBLISHED' AND b.published_at IS NOT NULL) AS eligible
 FROM dong_store_stat s JOIN etl_batch b ON b.batch_id=s.source_batch_id
 WHERE s.quarter_code='20262' AND s.industry_code='CS100010'
 UNION ALL
 SELECT 'dong'::text AS unit,'sales'::text AS kind,s.dong_code AS code,
 s.source_batch_id, b.dataset_code,b.source_type,b.scope_type,b.scope_code,b.status,b.published_at,
 to_jsonb(s) AS val,
 (b.dataset_code='SEOUL_DONG_SALES_STAT' AND b.source_type='CSV' AND b.scope_type='SEOUL'
 AND b.scope_code IS NULL AND b.status='PUBLISHED' AND b.published_at IS NOT NULL) AS eligible
 FROM dong_sales_stat s JOIN etl_batch b ON b.batch_id=s.source_batch_id
 WHERE s.quarter_code='20262' AND s.industry_code='CS100010'
 UNION ALL
 SELECT 'dong'::text AS unit,'foot'::text AS kind,s.dong_code AS code,
 s.source_batch_id, b.dataset_code,b.source_type,b.scope_type,b.scope_code,b.status,b.published_at,
 to_jsonb(s) AS val,
 (b.dataset_code='SEOUL_DONG_FOOT_TRAFFIC_STAT' AND b.source_type='CSV' AND b.scope_type='SEOUL'
 AND b.scope_code IS NULL AND b.status='PUBLISHED' AND b.published_at IS NOT NULL) AS eligible
 FROM dong_foot_traffic_stat s JOIN etl_batch b ON b.batch_id=s.source_batch_id
 WHERE s.quarter_code='20262'
), wide AS (
 SELECT r.*,s.val AS stores,x.val AS sales,f.val AS foot,
 s.source_batch_id AS store_batch,x.source_batch_id AS sales_batch,f.source_batch_id AS foot_batch
 FROM regions r
 LEFT JOIN raw s ON s.unit=r.unit AND s.code=r.code AND s.kind='store' AND s.eligible
 LEFT JOIN raw x ON x.unit=r.unit AND x.code=r.code AND x.kind='sales' AND x.eligible
 LEFT JOIN raw f ON f.unit=r.unit AND f.code=r.code AND f.kind='foot' AND f.eligible
), metrics AS (
 SELECT w.unit,w.code,w.name,w.district_code,v.kind,v.metric,v.value,v.present
 FROM wide w CROSS JOIN LATERAL (VALUES
 ('store','store_count',(w.stores->>'store_count')::numeric,w.stores IS NOT NULL),
 ('store','general_store_count',(w.stores->>'general_store_count')::numeric,w.stores IS NOT NULL),
 ('store','franchise_store_count',(w.stores->>'franchise_store_count')::numeric,w.stores IS NOT NULL),
 ('store','opened_store_count',(w.stores->>'opened_store_count')::numeric,w.stores IS NOT NULL),
 ('store','closed_store_count',(w.stores->>'closed_store_count')::numeric,w.stores IS NOT NULL),
 ('store','opening_rate',(w.stores->>'opening_rate')::numeric,w.stores IS NOT NULL),
 ('store','closure_rate',(w.stores->>'closure_rate')::numeric,w.stores IS NOT NULL),
 ('sales','monthly_sales_amount',(w.sales->>'monthly_sales_amount')::numeric,w.sales IS NOT NULL),
 ('sales','monthly_sales_count',(w.sales->>'monthly_sales_count')::numeric,w.sales IS NOT NULL),
 ('sales','weekday_sales_amount',(w.sales->>'weekday_sales_amount')::numeric,w.sales IS NOT NULL),
 ('sales','weekend_sales_amount',(w.sales->>'weekend_sales_amount')::numeric,w.sales IS NOT NULL),
 ('foot','total_foot_traffic',(w.foot->>'total_foot_traffic')::numeric,w.foot IS NOT NULL),
 ('foot','male_foot_traffic',(w.foot->>'male_foot_traffic')::numeric,w.foot IS NOT NULL),
 ('foot','female_foot_traffic',(w.foot->>'female_foot_traffic')::numeric,w.foot IS NOT NULL)
 ) v(kind,metric,value,present)
), stat AS (
 SELECT unit,kind,metric,count(*) AS expected,
 count(*) FILTER(WHERE present) AS present_rows,
 count(*) FILTER(WHERE present AND value IS NULL) AS null_cells,
 count(*) FILTER(WHERE NOT present) AS absent_rows,
 count(*) FILTER(WHERE value=0) AS zero_cells,
 count(*) FILTER(WHERE value<0 OR value>='Infinity'::numeric) AS invalid_cells,
 min(value)::text AS min,percentile_disc(0.05) WITHIN GROUP(ORDER BY value)::text AS p05,
 percentile_disc(0.25) WITHIN GROUP(ORDER BY value) AS q1,
 percentile_disc(0.5) WITHIN GROUP(ORDER BY value)::text AS median,
 percentile_disc(0.75) WITHIN GROUP(ORDER BY value) AS q3,
 percentile_disc(0.95) WITHIN GROUP(ORDER BY value)::text AS p95,max(value)::text AS max
 FROM metrics GROUP BY unit,kind,metric
)
SELECT json_build_object('label','profiles','rows',(SELECT json_agg(t) FROM (
 SELECT s.*, (SELECT count(*) FROM metrics m WHERE m.unit=s.unit AND m.metric=s.metric
 AND (m.value<s.q1-1.5*(s.q3-s.q1) OR m.value>s.q3+1.5*(s.q3-s.q1))) AS tukey_outliers
 FROM stat s ORDER BY unit,kind,metric
) t));
ROLLBACK;
```

동일한 공통 `WITH boundary ... metrics AS (...)` 뒤의 마지막 SELECT를 아래 중 하나로 바꾸면 결측·실제 0·일관성과 파생 분포를 추가 확인할 수 있습니다. 각각 위와 같은 읽기 전용 트랜잭션에서 실행합니다. 아래 SELECT들은 공통 WITH 없이 단독 실행하는 쿼리가 아닙니다.

```sql
-- 없는 행과 실제 0을 지역 코드·이름으로 구분합니다.
SELECT unit,code,name,stores,sales,foot
FROM wide
WHERE stores IS NULL OR sales IS NULL OR foot IS NULL
   OR (sales->>'weekday_sales_amount')::numeric=0
   OR (sales->>'weekend_sales_amount')::numeric=0
ORDER BY unit,code;
```

```sql
-- 성별 합계와 총인구의 원천 차이를 보정하지 않고 조사합니다.
SELECT unit,
  count(*) FILTER (WHERE (foot->>'total_foot_traffic')::numeric
    <> (foot->>'male_foot_traffic')::numeric
     + (foot->>'female_foot_traffic')::numeric) AS mismatch_rows,
  min((foot->>'total_foot_traffic')::numeric
     -(foot->>'male_foot_traffic')::numeric
     -(foot->>'female_foot_traffic')::numeric) AS min_delta,
  max((foot->>'total_foot_traffic')::numeric
     -(foot->>'male_foot_traffic')::numeric
     -(foot->>'female_foot_traffic')::numeric) AS max_delta
FROM wide GROUP BY unit;
```

```sql
-- 분모 0·NULL은 나눗셈에서 제외하며, 없는 매출을 0으로 채우지 않습니다.
SELECT unit,v.metric,count(v.value) AS n,min(v.value) AS min,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY v.value) AS median,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY v.value) AS p95,
  max(v.value) AS max
FROM wide
CROSS JOIN LATERAL (VALUES
  ('sales_per_store',(sales->>'monthly_sales_amount')::numeric
    /NULLIF((stores->>'store_count')::numeric,0)),
  ('foot_per_store',(foot->>'total_foot_traffic')::numeric
    /NULLIF((stores->>'store_count')::numeric,0))
) v(metric,value)
GROUP BY unit,v.metric ORDER BY unit,v.metric;
```
