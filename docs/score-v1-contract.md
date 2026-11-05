# MVP v1 점수 계산·조회·REST API·재현 계약

이 문서는 **점수 백엔드를 구현·테스트하거나 검증 도구를 실행하는 개발자**를 위한 계산 명세와 실행 안내입니다. 모델의 목적·실험 해석은 [점수 설계](score-design.md), 원천 판본·승인 책임·manifest·Trust Record는 [공개 준비](score-20262-publication-readiness.md)에서 확인합니다.

**현재 구현:** 순수 A 계산기, 전체 입력 Repository, 내부 ScoreService, R01·R02 스냅샷 코어, 명시 실행 회귀·내보내기·오프라인 검증·Trust 사전 진단 도구, 내부 신뢰 검증과 현재 DB 전체 입력 대조 진입점, REST 미승인 차단 경로입니다. **미구현:** 공개 200 응답, 최종 지역 404 연결, 운영 신뢰 기준 공급·철회 전파·현재 DB 대조의 공개 게이트 연결과 `region_score`입니다.

A의 방향·비중·예외·표시 규칙은 승인 전 후보입니다. 내부 구현이 있다는 이유로 서비스 정책을 채택하지 않습니다. `NOT_APPROVED`, `sourceTrust=NOT_ESTABLISHED`, `R03_COMPLETE=false`를 유지하며 현재 판본의 분기·공간·업종 비교 가능성 확인 전에는 공개 점수를 제공하지 않습니다.

[정책안](#1-권장하는-v1-정책안) · [예외 규칙](#2-승인이-필요한-정책-규칙) · [코드와 조회](#3-spring-boot-조회계산-경계) · [정확한 계산](#4-정밀도와-출력-규칙) · [현재/목표 API](#5-점수-rest-api-제안) · [스냅샷·실행 도구](#6-계산-시점과-재현-정보-보존) · [검증 계약](#7-구현할-테스트-계약) · [공개 전 조건](#8-승인과-구현-착수-조건)

## 1. 권장하는 v1 정책안

권장하는 한 가지 안은 **A의 단일 분기 상대 참고 점수**입니다. 점포가 적을수록 좋다는 가정과 아래 비중을 검증된 정답으로 채택하는 것이 아닙니다.

| 항목      | 권장안                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 대상      | 우선 `20262`·카페 `CS100010`. 유동인구는 업종 필터 없이 사용                                          |
| 비교      | 서울 전체 자치구끼리, 서울 전체 행정동끼리 별도 계산. 특정 구를 선택해도 동의 정규화 집단은 서울 전체 |
| 필수 입력 | 원본 추정매출 S, 원본 인구 F, 전체 점포 N, 원천 폐업률 c                                              |
| 계산      | 동률 평균 순위 정규화, A 가중합을 0~100점으로 환산                                                    |
| 비중·방향 | S·F 각각 0.30·증가, N·c 각각 0.20·감소                                                                |
| 보상      | A의 지표 간 보상을 허용하는 후보. 임의 매출 하한·감점·점수 상한·가중치 재배분 없음                    |
| 설명      | 원본 수치, 방향, 비중, 항목별 기여, 비교 집단·제외, 분기·단위, 원천 해석 한계를 함께 제공             |
| 해석 제한 | 성공 확률·예상 수익·좋음/나쁨 등급이 아님. 구/동 간 직접 비교·반경 점수·분기 간 증감은 제공하지 않음  |

### 선택 이유와 위험

기존 [민감도 검증](archive/score-mvp-criteria-validation.md#4-점포-수-방향-비교)에서 점포 방향만 바꿔도 동 상위 5곳은 2곳만 겹쳤고 최대 192등 이동했습니다. 방향은 사소한 구현 선택이 아닙니다. 기존 감소 방향은 비교 기준선을 이어가는 선택이며, 기록상 점포 수가 현재 영업 중 경쟁점 수와 같거나 적은 점포가 실제 창업에 유리하다는 증거는 없습니다.

매출 비중을 0.30→0.25로 낮추고 다른 비중을 기존 비율대로 재배분한 조건에서는 삼성동·북아현동·삼양동이 A 상위 43동에 진입했습니다. 기존 비중을 유지하는 이유는 설명과 검증의 연속성이지 최적화가 아닙니다. 삼성동의 기존 A 60.36점·83위처럼 낮은 매출을 다른 항목이 메우는 현상을 사용자에게 설명해야 합니다.

A는 항목별 기여를 더해 결과를 설명할 수 있습니다. B·C의 작은 분모, D의 한 항목 0에 따른 전체 0점, E의 추가 복잡성과 보상 잔존은 이번 v1 목적에 대한 더 강한 근거가 아닙니다. [기존 A·D·E 기록](archive/score-mvp-criteria-validation.md#2026-11-01-ade-결합-방식-비교)을 근거로 합니다.

## 2. 승인이 필요한 정책 규칙

‘기존’은 현재 DB·통계 API 계약 또는 기존 실험에서 이미 사용한 규칙을 뜻하며, 그 실험 규칙이 공개 점수 정책으로 승인됐다는 뜻은 아닙니다. **아래 권장 규칙은 모두 v1 정책 묶음으로 최종 승인이 필요합니다.** ‘새 제안’ 중 일부는 내부 진단·재현에 구현했지만 공개 서비스 정책으로 적용하지 않습니다.

| 결정           | 권장 규칙 하나·구분                                                                                                    | 이유                                                                                              | 대안의 단점                                                                                | 최종 승인                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| 필수 입력      | 기존 보존 원칙: 행 없음·NULL·음수·비유한 값은 제외, 0 대체 금지. S·F·c의 실제 0은 허용, N=0은 제외                     | 결측과 0을 구분하고 기존 공통 비교 조건 N>0 유지. A 자체에 N 나눗셈이 필요해서 제외하는 것은 아님 | 결측 대체·가중치 재배분은 다른 모델. N=0 허용은 비교 집단과 의미가 바뀜                    | 필요: N=0 제외의 서비스 채택 포함  |
| 집단·커버리지  | 기존 서울 전체 완비 집단 + 새 제안: 승인된 경계 코드 집합·완비 목록·제외 사유와 정확히 일치할 때만 게시. 계산상 n≥2    | 임의 90% 같은 하한 없이 어떤 지역이 왜 빠졌는지 심사 가능                                         | n≥2만으로 게시하면 극소 집단도 정상처럼 보임. 고정 25/421 하드코딩은 경계·재게시 변화 은폐 | 필요: 승인 목록과 변경 재검토 절차 |
| 지표 전체 동일 | 새 제안: 필수 지표 하나라도 집단 전체에서 수치상 동일하면 종합 점수 산출 보류                                          | 변별력이 없는 항목에 고정 비중을 부여하는 결정을 숨기지 않음                                      | 평균 순위 0.5로 계속 계산하면 고정 기여가 생김. 항목 제거·재배분은 별도 모델               | 필요: 보수적인 보류 규칙           |
| 동률           | 기존 평균 순위. 원본은 정확한 수치 비교, 최종 A는 정확한 계산값이 같을 때만 동률. 내림차순 평균 순위                   | NUMERIC scale·표시 반올림에 순위가 흔들리지 않음                                                  | 문자열 비교·double·임의 epsilon은 동률과 순위를 바꿈                                       | 필요: 수치 표현까지 승인           |
| 저매출·보상    | 기존 A 보상 유지 + 새 제안: 원본 매출·기여 설명은 필수, 자동 하위 10% 경고 배지는 v1에 넣지 않음                       | 하위 10%는 탐색 기준이었음. 새 위험 임계값을 만들지 않고 보상 구조를 설명                         | 임의 하한은 집단·점수를 변경. 자동 경고는 실제 위험이 검증된 것처럼 오해할 수 있음         | 필요: 보상 허용 및 설명 문구       |
| 정밀도·표시    | 새 제안: 내부 정수·유리수로 정확히 계산. 점수·기여 표시 2자리 HALF_UP, 정규화 표시 12자리 HALF_UP. 순위는 표시 전 계산 | BIGINT·NUMERIC 원본과 정확한 동률 보존. 표시 규칙은 계산과 분리                                   | 고정 소수점으로 중간 반올림하면 가까운 점수·동률 왜곡. float는 큰 정수 손실                | 필요: 자릿수·반올림의 서비스 채택  |
| 기간·업종      | 새 제안: 점수 요청은 `20262`·`CS100010`만 허용. 과거·다른 업종·자동 최신 분기는 미지원                                 | 현재 조사·검증 범위로 한정. 과거 커버리지 확인은 순위 안정성 검증이 아님                          | 묵시적 최신 분기·대체 분기는 요청과 다른 평가. 과거 혼합은 경계·정의 호환 미확인           | 필요: 지원 범위                    |
| 버전·재현      | 기존 재현 요구 + 새 제안: 불변 정책 버전, 전체 원본 입력 스냅샷과 승인 기록을 배포 아티팩트로 보존                     | Upsert·배치 ID만으로 과거 입력을 복원할 수 없음                                                   | 로그나 배치 UUID만 저장하면 전체 집단의 과거 점수 재현 불가                                | 필요: 보존 위치·책임·절차          |

n은 완비 비교 지역 수, N은 한 지역의 점포 수입니다. 점포 10개·20개 기준이나 저매출 하위 10%는 제외 기준으로 사용하지 않습니다. 100%를 넘는 원천 폐업률도 유한한 비음수이면 보존하며 재산정·상한 적용을 하지 않습니다.

누락 4동의 현재 제외를 승인하더라도 다른 누락을 자동 승인한 것이 아닙니다. 새로운 결측·부적격 출처·경계 코드 변경·제외 사유 변경이 생기면 집단 승인을 다시 검토합니다. 승인된 부분 집단도 제외 수·코드·이유와 전체 경계 수를 응답에 표시합니다.

## 3. Spring Boot 조회·계산 경계

### 3.1 현재 코드에서 확인한 패턴

Java 21·Spring Boot와 `db` 프로필의 Controller → Service → JdbcClient Repository 패턴을 따릅니다. 현재 공개 Controller와 내부 진단 경로는 분리돼 있습니다.

| 코드                                                                                                                                                                                                                                                                                                                                                          | 구현된 책임                                                                        | 확인할 테스트                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ScoreController](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreController.java)                                                                                                                                                                                                                                                                    | `db`에서 요청 검증 후 항상 차단. DB·Service·승인 도구 호출 없음                    | [MockMvc](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreControllerTests.java), [기본 프로필](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreControllerDefaultProfileTests.java)       |
| [ScoreService](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreService.java)·[InternalScoreResult](../backend/src/main/java/kr/ac/recycleyoungs/score/InternalScoreResult.java)                                                                                                                                                                       | 읽기 전용 REPEATABLE_READ 안의 내부 진단과 상태 구분. 공개 DTO가 아님              | [단위](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreServiceTests.java), [통합](../backend/src/integrationTest/java/kr/ac/recycleyoungs/score/ScoreServiceIntegrationTests.java)               |
| [ScoreInputRepository](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreInputRepository.java)·[ScoreInputSnapshot](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreInputSnapshot.java)                                                                                                                                                         | 상위 트랜잭션 필수. 단위별 SQL 한 번으로 전체 경계·원본·행별 출처 조회             | [모델](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreInputSnapshotTests.java), [통합](../backend/src/integrationTest/java/kr/ac/recycleyoungs/score/ScoreInputRepositoryIntegrationTests.java) |
| [ScoreCohortEvaluator](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreCohortEvaluator.java)                                                                                                                                                                                                                                                          | Service와 오프라인 재현이 공유하는 순수 입력 검증·집단 보류. 승인 검사는 하지 않음 | Service·스냅샷 테스트에서 함께 검증                                                                                                                                                                      |
| [AScoreCalculator](../backend/src/main/java/kr/ac/recycleyoungs/score/AScoreCalculator.java)·[ScoreInput](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreInput.java)·[ScoreCalculation](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreCalculation.java)·[ScoreMetric](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreMetric.java) | DB·HTTP·Spring·시각·파일과 독립된 A 계산 및 불변 결과                              | [계산기](../backend/src/test/java/kr/ac/recycleyoungs/score/AScoreCalculatorTests.java)                                                                                                                  |
| [ExactFraction](../backend/src/main/java/kr/ac/recycleyoungs/score/ExactFraction.java)                                                                                                                                                                                                                                                                        | 약분·양수 분모의 정확한 정수/분수, 출력 소수 변환 분리                             | [분수](../backend/src/test/java/kr/ac/recycleyoungs/score/ExactFractionTests.java)                                                                                                                       |
| [ScoreSnapshotArtifact](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreSnapshotArtifact.java)·[ScoreSnapshotCodec](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreSnapshotCodec.java)                                                                                                                                                       | 전체 입력 봉인·정규 JSON·해시·재현. 파일 저장이나 자동 캡처 없음                   | [R01·R02](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreSnapshotTests.java)                                                                                                                    |

기존 [RegionRepository](../backend/src/main/java/kr/ac/recycleyoungs/region/RegionRepository.java)의 경계 선택, [점포](../backend/src/main/java/kr/ac/recycleyoungs/store/DistrictStoreStatRepository.java)·[매출](../backend/src/main/java/kr/ac/recycleyoungs/sales/DistrictSalesStatRepository.java)·[인구 Repository](../backend/src/main/java/kr/ac/recycleyoungs/foottraffic/DistrictFootTrafficStatRepository.java)의 행별 출처 검증과 [ApiExceptionHandler](../backend/src/main/java/kr/ac/recycleyoungs/api/ApiExceptionHandler.java)의 ProblemDetail·DB 오류 분류를 유지합니다. [점포 Controller](../backend/src/main/java/kr/ac/recycleyoungs/store/DistrictStoreStatController.java)·[Service](../backend/src/main/java/kr/ac/recycleyoungs/store/DistrictStoreStatService.java)도 같은 계층 패턴을 사용합니다.

**내부 실행 순서:** Repository의 한 번 조회 결과를 재사용해 경계 준비 → 요청 지역 존재 → 데이터셋 준비 → 전체 입력 검증 → 계산을 판정합니다. 구·동은 각각 서울 전체 완비 집단이며 지역 선택·입력 순서로 재정규화하지 않습니다.

`InternalScoreResult.Status`는 `INTERNAL_CALCULATED`, `NOT_CALCULABLE`, `BOUNDARY_NOT_READY`, `REGION_NOT_FOUND`, `DATASET_NOT_READY`, `UNSUPPORTED_INPUT`, `DATABASE_UNAVAILABLE`, `INTERNAL_ERROR`를 구분합니다. 연결·자원·시간 초과와 SQL·매핑·불변식 오류를 결측이나 정상 0점으로 숨기지 않습니다. 트랜잭션 시작 전 연결 실패는 프록시 호출 경계에 전파될 수 있습니다. 결과의 `publicationState()`는 항상 `NOT_APPROVED`입니다.

### 3.2 입력 조회 계약

| 입력 | 자치구 / 행정동 테이블                                  | 컬럼·조회 방식                                              |
| ---- | ------------------------------------------------------- | ----------------------------------------------------------- |
| S    | `district_sales_stat` / `dong_sales_stat`               | `monthly_sales_amount` BIGINT → 문자열 → BigInteger         |
| F    | `district_foot_traffic_stat` / `dong_foot_traffic_stat` | `total_foot_traffic` NUMERIC → SQL text → 문자열·BigDecimal |
| N    | `district_store_stat` / `dong_store_stat`               | `store_count` BIGINT → 문자열 → BigInteger                  |
| c    | 위 점포 테이블                                          | `closure_rate` NUMERIC → SQL text → 문자열·BigDecimal       |

점포·매출 키는 지역 코드 + 분기 + 업종, 인구 키는 지역 코드 + 분기입니다. 구는 공식 구 테이블을 읽으며 동 합계로 만들지 않습니다. 전체 점포를 `general_store_count`로 바꾸지 않습니다.

경계는 `SEOUL_DONG_BOUNDARY / SHAPEFILE / SEOUL / scope_code IS NULL / PUBLISHED / published_at IS NOT NULL` 중 `published_at DESC, started_at DESC, batch_id DESC` 첫 배치를 선택한 뒤 실제 행을 확인합니다. 빈 최신 게시본 대신 과거 경계로 돌아가지 않습니다. 구는 그 게시본, 동과 부모 구는 함께 그 게시본을 참조해야 합니다.

통계는 **각 행의 실제 `source_batch_id`**를 `etl_batch`에 연결해 해당 단위의 `SEOUL_DISTRICT_{STORE,SALES,FOOT_TRAFFIC}_STAT` 또는 `SEOUL_DONG_{STORE,SALES,FOOT_TRAFFIC}_STAT`인지 검사합니다. 중괄호는 자료별 치환 표기입니다. `CSV / SEOUL / scope_code IS NULL / PUBLISHED / published_at IS NOT NULL`도 모두 필요합니다. 전역 최신 통계 배치를 강제하지 않습니다.

전체 경계 목록을 기준으로 통계를 연결해 **행 없음·부적격 출처·행은 있으나 측정값 NULL**을 구분합니다. 필수 값만 inner join해서 제외 지역이 조용히 사라지는 구현은 하지 않습니다. 부적격 출처의 측정값은 공개 입력으로 쓰지 않고, 해당 사실과 제외 사유만 기록합니다. 선택 지역별로 기존 통계 HTTP API를 반복 호출하거나 지역 수만큼 단건 조회하지 않습니다.

### 3.3 한 요청의 처리 순서

아래는 **후속 공개 게이트 연결 후의 목표 순서**입니다. 현재는 1단계 검증 직후 DB 조회 없이 503 `DATA_NOT_READY`를 반환합니다. 따라서 형식이 유효하면 미존재 지역 코드도 임시로 503이며, 최종 지역 미존재 404·데이터 준비 판단은 아직 연결하지 않았습니다.

1. Controller에서 문법·지원 분기·업종을 검증합니다. 사용자에게 비중·방향·비교 집단·승인 상태를 바꾸는 파라미터를 받지 않습니다.
2. Service의 한 읽기 전용 REPEATABLE_READ 트랜잭션에서 최신 경계와 요청 지역을 확인합니다. 경계 미준비는 503, 현행 지역 미존재는 404가 우선입니다.
3. 해당 단위의 점포·매출·인구 데이터셋 각각에 적격 출처를 참조하는 실제 통계 행이 있는지 확인합니다. 하나라도 전혀 없으면 503입니다. 현재 코드와 같이 데이터셋 전체 준비와 특정 분기·업종 행 부재를 구분합니다.
4. 서울 전체의 해당 단위 입력과 실제 배치 메타데이터를 일괄 조회합니다. 경계·세 통계·집단을 서로 다른 요청·트랜잭션에서 가져오지 않습니다.
5. 정책 승인 및 현재 입력 판본의 의미·경계 비교 가능성 승인을 확인합니다. 승인 근거가 없거나 승인한 입력 스냅샷과 다르면 503 `DATA_NOT_READY`로 공개 계산을 막습니다. 정상 게시 검증으로 이 승인을 대신하지 않습니다.
6. 지역별 검증 후 완비 목록·제외 사유를 만들고 승인된 커버리지 목록과 대조합니다. 집단 n≤1, 승인 목록 불일치, 필수 지표 전체 동일을 차례로 검사합니다. 실패 시 집단 전체가 산출 불가입니다. 여러 사유가 있으면 이 순서로 정렬해 모두 남깁니다.
7. 집단이 가능해도 요청 지역이 제외됐다면 그 지역은 산출 불가입니다. 정상 대상이면 네 입력 순위 → 방향 반전 → 비중 적용 → 정확한 A → 집단 전체 점수 순위 → 표시값 순으로 계산합니다.
8. 한 번 읽은 입력으로 설명·재현 식별자를 구성합니다. DB 트랜잭션 밖에서 계산하더라도 재조회하지 않고 검증한 불변 입력만 사용합니다. 이 설계의 계산 경로는 DB 쓰기·ETL·Flyway를 호출하지 않습니다.

승인된 정상 입력과 커버리지 문서가 없을 때 6단계의 200 산출 불가를 이용해 5단계를 우회하지 않습니다. 현재는 승인 전이므로 아래 성공 응답을 공개 제공할 수 없습니다.

## 4. 정밀도와 출력 규칙

### 4.1 원본과 동률

원본 문자열을 별도로 보존합니다. BIGINT는 BigInteger, NUMERIC은 문자열에서 만든 BigDecimal로 처리하고 `long` 변환·`double`·정수 나눗셈을 중간 계산에 사용하지 않습니다. BigDecimal 비교는 수치 순서로 하므로 `1.0`과 `1.00`은 동률입니다. 원본 문자열의 자릿수·NULL은 응답과 재현 입력에 남깁니다. 비유한 값은 소수 파싱 전에 검출해 제외 사유로 처리하고, 숫자가 아닌 비정상 텍스트·매핑 오류는 내부 오류로 구분합니다.

동률 평균 순위와 A는 [기술 부록](score-design.md#b-순위-정규화와-동률)의 정의를 그대로 사용합니다. 다음 정수식은 **같은 계산을 반올림 없이 구현하는 방법**이며 새 정규화가 아닙니다.

### 4.2 정확한 정수·분수 계산

한 지표에서 a는 더 작은 값의 개수, k는 같은 값의 개수, n은 공통 지역 수입니다. 평균 순위의 두 배인 `t=2a+k+1`을 구합니다. 정규화 분모는 `d=2(n−1)`입니다.

- 증가 방향인 매출·인구의 정규화 분자는 `v=t−2`입니다.
- 감소 방향인 점포·폐업률의 정규화 분자는 `v=2n−t`입니다.
- 방향 통일값은 정확히 `z=v/d`입니다. 중간 소수 반올림은 없습니다.
- 비중의 정수 표현은 매출·인구 m=3, 점포·폐업률 m=2이며 실제 비중은 m/10입니다.
- 항목별 100점 기준 기여는 `5mv/(n−1)`입니다.
- `K=3vS+3vF+2vN+2vc`이면 **A=`5K/(n−1)`**입니다. 같은 집단은 분모가 같으므로 K의 내림차순으로 정확한 점수 동률·순위를 판정할 수 있습니다.

정수 연산은 BigInteger로 하고 외부에 보낼 분수는 최대공약수로 약분해 분모를 양수로 둡니다. 0은 0/1입니다. 집단이 다른 결과끼리 K를 비교하지 않습니다. 코드 순서는 동률 결과의 안정적인 나열에만 쓰고 평균 순위를 깨지 않습니다.

### 4.3 표시 계약과 검산 예시

**새 제안:** 원본·비중·정규화 소수·점수·기여·평균 순위는 JSON 문자열입니다. 지역 수·동률 지역 수 같은 작은 개수만 JSON 정수입니다. 정확한 분수는 `{numerator, denominator}` 문자열 쌍으로 제공합니다.

정규화의 `decimal`은 12자리 HALF_UP, 점수·기여의 `display`는 2자리 HALF_UP입니다. 표시값을 다시 합산하거나 순위 입력으로 쓰지 않습니다. 기여 표시의 합과 최종 표시가 0.01점 등 다를 수 있으며, 정확한 분수의 합으로 최종 점수를 검증합니다. 최종 평균 순위는 정수 또는 `.5` 문자열이고 별도 반올림하지 않습니다.

아래는 기존의 **가상 5지역**이며 실제 DB와 무관합니다. 모든 입력 단위는 설명용입니다.

| 가상 지역 | S    | F   | N   | c   | A   | 최종 평균 순위 |
| --------- | ---- | --- | --- | --- | --- | -------------- |
| 가        | 1000 | 100 | 10  | 1   | 40  | 4.5            |
| 나        | 2000 | 200 | 30  | 2   | 40  | 4.5            |
| 다        | 3000 | 300 | 40  | 3   | 45  | 3              |
| 라        | 4000 | 400 | 20  | 4   | 65  | 1              |
| 마        | 5000 | 500 | 50  | 5   | 60  | 2              |

‘라’의 v는 (6,6,6,2), d=8이고, 방향 통일값은 (0.75,0.75,0.75,0.25)입니다. 기여 22.5+22.5+15+5=65, K=52이므로 5×52/4=65입니다. 이 예시는 원천 의미의 타당성이나 실제 창업 성과를 검증한 결과가 아닙니다.

## 5. 점수 REST API 제안

**현재는 `db` 프로필의 미승인 차단 경로만 구현했습니다.** 두 GET 경로는 잘못된 요청에 400 `INVALID_PARAMETER`, 유효한 요청에 항상 503 `DATA_NOT_READY`를 반환합니다. 점수·순위·원본값·기여·내부 진단은 공개하지 않으며, 요청·헤더·환경변수로 승인을 허용하는 분기도 없습니다. 기본 프로필에서는 경로를 등록하지 않습니다. 기존 통계·카페 API의 계약은 그대로 유지합니다.

### 5.1 요청

- `GET /api/v1/districts/{districtCode}/score?quarterCode=20262&industryCode=CS100010`
- `GET /api/v1/dongs/{dongCode}/score?quarterCode=20262&industryCode=CS100010`

지역 코드는 ASCII 숫자 5자리·8자리, quarterCode는 `[0-9]{4}[1-4]`, industryCode는 `CS[0-9]{6}`이어야 합니다. 필수 query는 각 1개만 허용하고 동일 값 중복도 400입니다. trim·쉼표 분할·다른 분기 대체는 하지 않습니다. 형식이 맞아도 `20262`·`CS100010`이 아니면 400 `INVALID_PARAMETER`입니다. **점수 경로는 이 두 query 외 파라미터도 400으로 거부하도록 구현했습니다.** 기존 Controller의 다른 파라미터 처리 정책을 바꾸는 것은 아닙니다.

### 5.2 상태와 오류

현재 응답은 기존 `ApiException`·`ApiErrorCode`·`ProblemDetail`을 사용한 400/503뿐이며 별도 `reason`을 추가하지 않습니다.

| 현재 경로/요청                                     | 응답                    | DB·내부 점수 노출                           |
| -------------------------------------------------- | ----------------------- | ------------------------------------------- |
| 두 경로의 누락·중복·추가 query, 형식·지원 값 오류  | 400 `INVALID_PARAMETER` | 없음                                        |
| `db`의 유효한 요청, 형식만 유효한 미존재 코드 포함 | 503 `DATA_NOT_READY`    | 없음. 존재·데이터 준비를 조회한 결과가 아님 |
| 기본 프로필                                        | 점수 Controller 미등록  | 없음                                        |

현재 503은 `title`, `status`, `detail`, `instance`, `code`의 기존 오류 형식이며 `about:blank` 타입은 현재 직렬화에서 생략됩니다. 점수·순위·입력·기여·내부 상태는 없습니다. **아래 표의 200·404와 DB 조회 오류는 승인 게이트 연결 후의 목표 계약**입니다. 현재의 고정 503을 지역·통계 준비 상태를 조회한 결과로 해석하지 않습니다.

| HTTP·상태                  | 조건                                                         | 표현                                                           |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 200 `CALCULATED`           | 승인·집단·요청 지역이 계산 조건 충족                         | data에 점수·순위·기여. reasons는 빈 배열                       |
| 200 `NOT_CALCULABLE`       | 데이터셋은 준비됐으나 집단 또는 요청 지역의 계산 조건 미충족 | data는 명시적 null, reasons에 사유. 실제 0점으로 대신하지 않음 |
| 400 `INVALID_PARAMETER`    | 형식·필수·중복·지원 값·점수 경로의 허용 query 위반           | 기존 ProblemDetail 형식                                        |
| 404 `REGION_NOT_FOUND`     | 최신 정상 경계에 요청 지역 없음                              | 기존 코드·고정 문구                                            |
| 503 `DATA_NOT_READY`       | 경계·자료 미준비 또는 정책·원천 판본·입력 스냅샷 승인 미충족 | 기존 코드·문구 + 점수 경로에만 새 reason 필드 제안             |
| 503 `DATABASE_UNAVAILABLE` | 연결·자원 접근 실패·시간 초과                                | 기존 공통 오류 분류. 산출 불가로 숨기지 않음                   |
| 500 `INTERNAL_ERROR`       | SQL·매핑·불변식·일반 구현 오류                               | 기존 코드. SQL·접속정보·예외 원문 비노출                       |

503의 추가 reason 후보는 `POLICY_NOT_APPROVED`, `SOURCE_VERSION_UNVERIFIED`, `INPUT_SNAPSHOT_CHANGED`입니다. 기존 자료 미준비는 기존 형태를 유지합니다. 이 필드를 위해 공통 예외 처리를 확장할지는 구현 단계의 검토 대상이며 기존 모든 API에 필드를 추가하겠다는 계약은 아닙니다.

200 reasons는 `{code, metric}` 목록입니다. metric은 S·F·N·c에 대응하는 `sales`, `footTraffic`, `storeCount`, `closureRate` 또는 집단 사유의 null입니다. 지역 사유는 `INPUT_ROW_MISSING`, `INPUT_NULL`, `INPUT_NEGATIVE`, `INPUT_NON_FINITE`, `ZERO_STORE_COUNT`, `SOURCE_NOT_ELIGIBLE`입니다. 집단 사유는 `INSUFFICIENT_COHORT`, `COVERAGE_REVIEW_REQUIRED`, `CONSTANT_INDICATOR`입니다. 집단 사유를 먼저, 지역 사유는 이 코드 순서·지표 순서로 안정 정렬합니다.

### 5.3 합성 성공 응답

다음은 **가상 ‘라’ 지역의 테스트 응답**입니다. 코드·UUID·시각·해시는 합성값이며 현재 DB·실제 API의 응답이 아닙니다. 비교 집단 5개와 데이터·정책 승인이 있다고 가정한 계약 예시입니다. 실제 `20262`의 25구·421동 결과와 섞지 않습니다.

```json
{
  "regionType": "DONG",
  "regionCode": "00100004",
  "regionName": "라",
  "quarterCode": "20262",
  "industryCode": "CS100010",
  "algorithmVersion": "a-rank-v1-candidate.1",
  "status": "CALCULATED",
  "reasons": [],
  "inputs": {
    "sales": "4000",
    "footTraffic": "400",
    "storeCount": "20",
    "closureRate": "4"
  },
  "data": {
    "score": { "numerator": "65", "denominator": "1", "display": "65.00" },
    "rank": "1",
    "tieCount": 1,
    "components": [
      {
        "metric": "sales",
        "direction": "INCREASE",
        "weight": "0.30",
        "normalized": {
          "numerator": "3",
          "denominator": "4",
          "decimal": "0.750000000000"
        },
        "contribution": {
          "numerator": "45",
          "denominator": "2",
          "display": "22.50"
        }
      },
      {
        "metric": "footTraffic",
        "direction": "INCREASE",
        "weight": "0.30",
        "normalized": {
          "numerator": "3",
          "denominator": "4",
          "decimal": "0.750000000000"
        },
        "contribution": {
          "numerator": "45",
          "denominator": "2",
          "display": "22.50"
        }
      },
      {
        "metric": "storeCount",
        "direction": "DECREASE",
        "weight": "0.20",
        "normalized": {
          "numerator": "3",
          "denominator": "4",
          "decimal": "0.750000000000"
        },
        "contribution": {
          "numerator": "15",
          "denominator": "1",
          "display": "15.00"
        }
      },
      {
        "metric": "closureRate",
        "direction": "DECREASE",
        "weight": "0.20",
        "normalized": {
          "numerator": "1",
          "denominator": "4",
          "decimal": "0.250000000000"
        },
        "contribution": {
          "numerator": "5",
          "denominator": "1",
          "display": "5.00"
        }
      }
    ]
  },
  "coverage": {
    "boundaryRegionCount": 5,
    "eligibleRegionCount": 5,
    "excludedRegions": []
  },
  "boundaryBatch": {
    "batchId": "00000000-0000-0000-0000-000000000001",
    "publishedAt": "2026-10-01T00:00:00Z"
  },
  "sourceBatches": {
    "store": {
      "batchId": "00000000-0000-0000-0000-000000000002",
      "publishedAt": "2026-10-01T00:00:00Z"
    },
    "sales": {
      "batchId": "00000000-0000-0000-0000-000000000003",
      "publishedAt": "2026-10-01T00:00:00Z"
    },
    "footTraffic": {
      "batchId": "00000000-0000-0000-0000-000000000004",
      "publishedAt": "2026-10-01T00:00:00Z"
    }
  },
  "reproducibility": {
    "snapshotSchemaVersion": "score-input-v1",
    "inputSnapshotId": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "policyApprovalId": "synthetic-policy-1",
    "coverageApprovalId": "synthetic-coverage-1",
    "sourceVerificationId": "synthetic-source-1"
  },
  "warnings": [
    "RELATIVE_REFERENCE_ONLY",
    "SOURCE_INTERPRETATION_LIMITED",
    "COMPENSATION_ALLOWED"
  ]
}
```

`sourceBatches`는 요청 지역의 세 원천 행 출처이며 전체 비교 집단의 단일 배치를 뜻하지 않습니다. 다른 지역의 실제 출처는 보존 스냅샷에 모두 남깁니다. `coverage.excludedRegions`는 `{regionCode, reasons}` 목록입니다. warnings는 위험 등급이 아니라 상대 비교·원천 해석 한계·보상 허용에 관한 고정 안내 코드입니다. 그 뜻과 원본 매출 기간 미확인·고유 고객 수 아님·기록상 점포의 한계를 UI에 함께 설명하는 것이 응답 소비 계약입니다.

### 5.4 산출 불가와 승인 미충족 예시

200 산출 불가는 위 식별자·입력·출처·coverage·reproducibility·warnings 필드를 유지하되 `status="NOT_CALCULABLE"`, `data=null`로 합니다. 없는 원천 행의 input과 sourceBatch는 null입니다. 일부만 NULL인 유효 행은 그 측정값만 null이고 출처는 유지합니다. 기여·순위의 부분 결과는 제공하지 않습니다. 다음은 이 상태를 설명하기 위한 **변경 필드 발췌**이며 완전 응답은 아닙니다.

```json
{
  "status": "NOT_CALCULABLE",
  "data": null,
  "reasons": [{ "code": "INPUT_ROW_MISSING", "metric": "sales" }],
  "inputs": {
    "sales": null,
    "footTraffic": "400",
    "storeCount": "20",
    "closureRate": "4"
  },
  "sourceBatches": { "sales": null }
}
```

미승인은 200 산출 불가가 아닙니다. 예를 들어 판본 비교 가능성을 확인하지 못한 경우의 **후속 제안** 응답은 다음과 같습니다. 현재 차단 응답에는 아래 `reason` 필드를 넣지 않습니다. instance는 요청 경로이고 다른 ProblemDetail 필드는 기존 패턴을 따릅니다.

```json
{
  "type": "about:blank",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "조회할 데이터가 아직 준비되지 않았습니다.",
  "instance": "/api/v1/dongs/00100004/score",
  "code": "DATA_NOT_READY",
  "reason": "SOURCE_VERSION_UNVERIFIED"
}
```

기존 통계의 `200, data: null`을 점수의 NOT_CALCULABLE로 변경하지 않습니다. 기존 통계는 점수의 지원 분기 제한이나 새 승인 절차의 영향을 받지 않습니다.

## 6. 계산 시점과 재현 정보 보존

### 6.1 권장: 조회 시 계산, v1에는 region_score 미도입

| 방식                        | 장점                                                               | 한계·v1 판단                                                                                       |
| --------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 조회 시 집단 전체 계산      | 한 스냅샷의 원본·집단·설명 일치. 별도 점수 테이블·갱신 작업 불필요 | 반복 계산 비용이 있음. 실제 지연·부하 검증은 구현 후 필요. **우선 권장**                           |
| 사전 계산·region_score 저장 | 반복 조회 비용 감소, 결과 이력 관리 가능                           | 입력 스냅샷·게시 원자성·버전·재계산·캐시 무효화 설계가 필요. 테이블만 만들어서는 재현성 해결 안 됨 |

현재 규모의 계산 비용을 이번에 측정하지 않았으므로 응답 시간을 보장하지 않습니다. v1은 캐시도 우선 넣지 않습니다. 향후 필요하면 경계·전체 입력 해시·정책 버전을 함께 키로 사용하고 게시 변경을 반영해야 합니다. 지역 코드·분기만 키로 삼으면 다른 비교 집단 결과를 재사용할 수 있습니다.

### 6.2 승인 입력 스냅샷을 불변 배포 아티팩트로 보존

**구현된 코어와 명시 도구:** 전체 집단을 메모리에서 봉인하고, JSON·해시를 검증해 DB 없이 재현할 수 있습니다. 명시적 내보내기·파일 검증도 구현했습니다. 실제 입력의 로컬 단일 사본 보존은 [2026-11-02 실행 기록](archive/score-20262-snapshot-preservation.md)이며 운영 보관·백업·승인이 완료됐다는 뜻은 아닙니다.

**공개 운영 권장안:** 전체 스냅샷과 독립 manifest를 읽기 전용 배포 아티팩트로 보관하고, 요청 시 DB 입력과 승인 스냅샷이 같은지 확인한 뒤 계산합니다. 현재 이 게이트는 미구현입니다. 과거 보존본을 현재 DB 대신 쓰는 폴백은 없으며, 재게시로 달라지면 새 판본·커버리지 검토 전까지 공개를 차단하는 안입니다. 요청마다 파일이나 DB 행을 쓰지 않습니다.

[현재 DB 대조 진단](#611-현재-db-전체-입력-대조)은 구현했지만 위 운영 공개 흐름에 연결하지 않았습니다. 합성 기준에 대한 `MATCHED`를 실제 승인 스냅샷이나 공개 허용으로 취급하지 않습니다.

스냅샷 코어는 파일·DB·HTTP·Spring Context를 사용하지 않고 Service 호출에도 자동 연결되지 않습니다. 정책·판본·커버리지 승인과 기대 아티팩트의 진위는 [공개 준비의 독립 신뢰 계약](score-20262-publication-readiness.md)에서 다룹니다.

### 6.3 스키마와 전체 집단 검증

구와 동은 각각 별도 아티팩트입니다. 생성 대상은 `20262`·`CS100010`의 준비된 전체 경계·데이터셋입니다. nullable 필드도 키는 필수이고 정의하지 않은 필드는 거부합니다.

| 최상위 필드       | 내용                                                | 입력 해시 대상        |
| ----------------- | --------------------------------------------------- | --------------------- |
| `payload`         | 아래 전체 입력 스키마                               | 전체 포함             |
| `inputSnapshotId` | 정규 payload 바이트의 소문자 SHA-256 64자리         | 제외                  |
| `expected`        | 완비 수·제외/집단 보류 사유·모든 결과의 정확한 분수 | 제외. 재계산으로 대조 |
| `requestedAt`     | nullable 감사용 요청 시각. 계산에 사용하지 않음     | 제외                  |

| payload 필드            | 내용                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `snapshotSchemaVersion` | `score-input-v1`. 다른 버전 거부                                             |
| `algorithmVersion`      | `a-rank-v1-candidate.1`. 현재 이 후보만 재현 지원                            |
| `policy`                | 컬럼·방향·비중·순위 정규화·입력/집단 예외·표시·분기·업종·보상 규칙           |
| `coverage`              | 전체 경계·완비·제외 수. 실제 목록 크기와 대조                                |
| `input`                 | `ScoreInputSnapshot` 전체: 단위·분기·업종·경계·준비 상태·모든 지역과 네 입력 |
| `boundaryRegionCodes`   | 호출자가 명시한 전체 경계 코드 목록                                          |
| `batches`               | 실제 참조한 경계·통계 메타데이터. UUID별 한 건                               |
| `eligibleRegionCodes`   | 입력 검증을 통과한 모든 코드. 동일값으로 보류해도 보존                       |
| `excludedRegions`       | 제외 코드와 모든 지표별 사유                                                 |

`input.regions`는 지역 코드·명칭·부모 구 코드/명칭과 `sales`, `footTraffic`, `storeCount`, `closureRate`를 보존합니다. 각 지표에는 `raw` 문자열/NULL, `source.rowPresent`, 실제 `sourceBatchId`, `eligible`, 안전한 `batch` 메타데이터가 있습니다. 실제 0·행 없음·측정값 NULL·음수·비유한 값·N=0·부적격 출처를 합치지 않습니다.

**행 출처 완전성:** `rowPresent=true`이면 출처 ID와 BatchMetadata가 필수이며 두 ID가 같아야 합니다. 부적격 배치도 실제 ID·메타데이터를 유지합니다. 행은 있고 측정값만 NULL인 경우는 유효하게 보존합니다. `rowPresent=false`이면 원본값·ID·배치 메타데이터가 모두 없어야 합니다. 적격성 모순과 같은 UUID의 메타데이터 충돌도 거부합니다.

메타데이터는 UUID·dataset_code·source_type·scope_type/scope_code·period_from/to·source_checksum·etl_version·status·started/finished/published 시각입니다. 원천 경로·`source_reference`·`error_message`·인증정보는 넣지 않습니다. 원본 숫자 문자열의 소수 자릿수를 유지하므로 `1.0`과 `1.00`은 계산상 동률이어도 입력 해시는 다릅니다.

전체 경계 코드와 입력 행의 코드가 정확히 같아야 하고, 완비·제외 목록은 중복·누락 없이 전체 경계를 분할해야 합니다. 실제 행 참조와 배치 목록도 같아야 합니다. 기대 목록·제외 사유를 재계산하므로 한 지역만 빼거나 제외를 숨기면 해시를 다시 만들어도 거부합니다.

단, 호출자가 전체 경계 목록과 행·기대 결과를 **함께 축소**하면 파일만으로 ‘진짜 서울 전체’를 증명할 수 없습니다. 생성 시 동일 Repository 스냅샷의 전체 경계를 사용하고 후속 독립 승인 목록과 대조해야 합니다. 25구·421동을 영구 상수로 두지 않습니다. 경계·데이터셋 미준비는 봉인하지 않으며 n≤1·필수 지표 전체 동일은 점수 대신 기존 내부 보류 사유를 재현합니다.

### 6.4 정규 JSON·SHA-256 — R01

1. 지역·완비·제외 코드는 Unicode 코드 포인트 오름차순, 배치는 UUID 문자열 오름차순입니다. 사유는 `ReasonCode` 선언 순서 뒤 지표 선언 순서입니다. 중복 목록은 거부합니다.
2. 모든 객체 키는 로케일과 무관한 Unicode 코드 포인트순입니다. UTF-16 코드 유닛과 순서가 다른 보충 문자도 포함합니다.
3. UTF-8, BOM·불필요한 공백·끝 개행 없음. 비ASCII와 `/`는 그대로 쓰며 따옴표·역슬래시는 이스케이프합니다. 제어문자는 `\b`·`\f`·`\n`·`\r`·`\t` 우선, 나머지는 소문자 4자리 `\u`입니다. 잘못된 UTF-8·짝 없는 surrogate는 거부합니다.
4. UUID는 소문자, 시각은 UTC ISO-8601 `Z`이며 불필요한 소수 초 끝 0과 정수 초 소수부를 생략합니다. `09:00:00.100+09:00` → `00:00:00.1Z`입니다.
5. 원본 숫자와 분수 분자/분모는 문자열, 집단 크기·동률 수는 JSON 정수입니다. 분수는 약분·양수 분모를 유지합니다.
6. **payload 전체 바이트**의 SHA-256이 `inputSnapshotId`입니다. 자기 해시·요청 시각·기대 결과·승인 메타데이터는 제외합니다. 승인 대상 목록의 내용은 payload에 있지만 승인 ID·담당자·근거 URL은 독립 manifest에 있습니다.

`decode`는 중복 키·누락·알 수 없는 필드·잘못된 버전/타입·primitive NULL·손상·추가 JSON 값·해시 불일치를 거부합니다. 유효한 공백·키 순서는 정규화합니다. 기대 결과 변경은 입력 해시를 바꾸지 않을 수 있지만 **재현 대조가 실패하므로 거부**됩니다. 오류에 원본 입력·접속정보·예외 원문을 붙이지 않습니다.

Python 표준 `json`·`hashlib`로 독립 검산한 **합성 5지역** payload는 14,935바이트, 기대 SHA-256은 `c671ee9b6263f5ff92334f7cc2a5e522f5f84872fe0cda2d38c1f1db71759f95`입니다. 작은 JSON 벡터로 제어문자·한글·보충 문자 정렬과 해시도 확인했습니다. 실제 원본 fixture가 아닙니다.

비중·방향·예외·표시·지원 범위를 바꾸면 새 정책 버전으로 기록합니다. 출처 재게시만으로 수식 버전을 바꾸지는 않지만 입력 해시와 승인 연결은 재검토합니다. 버전에 v1이 들어간다고 채택되지는 않습니다.

### 6.5 DB 없는 생성·재현 — R02

`fullBoundaryCodes`는 선택 지역이 아닌 같은 조회의 전체 경계입니다. 다음 Java 호출은 파일을 쓰거나 DB·Spring Context를 시작하지 않습니다.

```java
var artifact = ScoreSnapshotArtifact.capture(input, fullBoundaryCodes, requestedAt);
var codec = new ScoreSnapshotCodec();
byte[] json = codec.encode(artifact);
var restored = codec.decode(json);
var reproduced = restored.replay();
String hash = restored.inputSnapshotId();
// publicationState()는 항상 NOT_APPROVED이다.
```

`replay()`는 지원 알고리즘·정책 확인 → 공통 입력 검증 → 기존 A 계산 순서입니다. 완비·제외 목록과 모든 지표별/집단 사유, 모든 지역의 정규화·기여·최종 A·평균 순위·동률 수가 정확히 같아야 합니다. 원본·분수를 표시 소수로 바꾸지 않습니다. 다른 정책으로 만든 해시가 유효해도 지원 정책으로 자동 채택하지 않으며 재현을 거부합니다.

### 6.6 명시 실행 도구와 환경변수

CLI 도구는 [scoreRegression 소스셋](../backend/build.gradle)에 있어 제품 JAR·공개 API에 포함되지 않고 일반 `test`·`integrationTest`·`build`에서 자동 실행하지 않습니다. 명령행 인자를 받거나 `.env`를 자동 로드하지 않습니다. 공통 Trust Record·manifest 검증, 묶음·안전 읽기와 내부 진입점은 `main`에서 공유합니다. 파일 쓰기는 CLI 전용 `ScoreSnapshotOutput`으로 분리했습니다. `build`의 `verifyScorePackaging`이 두 제품 JAR의 공통 코드 포함 및 CLI/내보내기 제외를 검사합니다.

| 작업·코드                                                                                                                                                                                                                                                                                                                        | 접근 대상·조건                                                                         | 검증                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scoreRegression`: [Main](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreRegressionMain.java)·[Verifier](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreRegressionVerifier.java)                                                                                                         | 명시 활성화 후 실제 개발 DB의 대표값·현재 전체 결과 검산. 파일 저장 없음               | [단위](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreRegressionTests.java)·[통합](../backend/src/integrationTest/java/kr/ac/recycleyoungs/score/ScoreRegressionIntegrationTests.java)            |
| `scoreSnapshotExport`: [ExportMain](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreSnapshotExportMain.java)                                                                                                                                                                                                  | 명시 활성화 후 한 읽기 전용 스냅샷의 구·동 전체 입력을 검증·롤백하고 외부 새 파일 보존 | [도구 단위](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreSnapshotToolTests.java)·[통합](../backend/src/integrationTest/java/kr/ac/recycleyoungs/score/ScoreSnapshotExportIntegrationTests.java) |
| `scoreSnapshotVerify`: [VerifyMain](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreSnapshotVerifyMain.java)                                                                                                                                                                                                  | 지정한 외부 파일 하나를 DB·Spring Context 없이 검증·재현                               | 같은 도구 단위 테스트                                                                                                                                                                                      |
| `scoreTrustPreflight`: [PreflightMain](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreTrustPreflightMain.java)                                                                                                                                                                                               | 명시 활성화 후 외부 Trust Record·manifest·묶음과 독립 해시를 오프라인 결합 진단        | [사전 진단 단위 테스트](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreTrustPreflightTests.java)                                                                                                  |
| 공통 [ScoreSnapshotBundle](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreSnapshotBundle.java)·[ScoreSnapshotFiles](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreSnapshotFiles.java), CLI 전용 [ScoreSnapshotOutput](../backend/src/scoreRegression/java/kr/ac/recycleyoungs/score/ScoreSnapshotOutput.java) | 두 단위의 일관성·안전 읽기와 CLI 전용 새 파일 보존                                     | 같은 도구 테스트                                                                                                                                                                                           |

| 환경변수                                | 사용처·의미                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `SCORE_REGRESSION_ENABLED`              | 실데이터 회귀 작업을 허용할 때만 `1`                                        |
| `SCORE_SNAPSHOT_EXPORT_ENABLED`         | 내보내기를 허용할 때만 `1`                                                  |
| `DB_JDBC_URL`, `DB_USER`, `DB_PASSWORD` | 회귀·내보내기에만 사용. 완전히 해석된 PostgreSQL JDBC URL과 안전한 인증정보 |
| `SCORE_SNAPSHOT_OUTPUT_PATH`            | 내보낼 저장소 외부 실제 절대 경로. 기존 파일 금지                           |
| `SCORE_SNAPSHOT_INPUT_PATH`             | 검증할 외부 파일의 실제 절대 경로                                           |
| `SCORE_SNAPSHOT_EXPECTED_DISTRICT_ID`   | 선택: 별도로 확보한 구 payload SHA-256                                      |
| `SCORE_SNAPSHOT_EXPECTED_DONG_ID`       | 선택: 별도로 확보한 동 payload SHA-256                                      |
| `SCORE_SNAPSHOT_EXPECTED_FILE_SHA256`   | 선택: 별도로 확보한 파일 전체 바이트 SHA-256                                |

DB URL에 `${DB_NAME}`·`${DB_PORT:-5432}` 같은 참조가 남아 있으면 안 됩니다. 필요한 해석은 안전한 환경 준비 과정에서 메모리 안에서만 하고 값·접속 문자열을 출력하지 않습니다. URL query는 `sslmode`·`ssl`·`currentSchema`만 허용하며 `options`·`readOnly`·`readOnlyMode`·추가 설정 파일·인증정보로 안전 설정을 덮어쓸 수 없습니다. **운영·공유 DB를 대상으로 삼지 않습니다.**

회귀·내보내기는 `default_transaction_read_only=on`, JDBC 읽기 전용·REPEATABLE_READ·`SET TRANSACTION READ ONLY`와 실제 설정 확인을 사용하며 종료는 ROLLBACK입니다. Flyway 자동 구성·마이그레이션·ETL을 시작하지 않습니다. 내보내기는 같은 트랜잭션에서 구·동을 각각 한 번 조회하고 `capture()`한 뒤, 분기·업종·스키마·알고리즘·정책·경계 메타데이터·조회 시각, 부모 구 코드/명칭과 동일 UUID의 배치를 대조합니다. **ROLLBACK 완료 통지와 Context 종료 후** 바이트 재검증에 성공해야 저장합니다.

보존 파일은 `bundleSchemaVersion="score-snapshot-bundle-v1"`, `district`, `dong` 세 필드뿐입니다. 한 단위 누락·중복 키·추가 필드·다른 버전은 거부합니다. 두 단위는 독립된 입력 해시와 비교 집단을 유지하며 manifest가 아닙니다. 파일 SHA-256은 요청 시각까지 포함한 묶음 바이트 전체이므로 같은 입력을 다른 시각에 보존하면 입력 해시는 같아도 파일 해시는 달라질 수 있습니다.

### 6.7 외부 파일·권한·실패 복구

보관 담당자가 준비한 **현재 사용자 소유 POSIX 0700 디렉터리**를 사용합니다. 도구는 부모를 만들거나 권한을 고치지 않습니다. 실제 절대 경로만 허용하며 `..`·중간/최종 심볼릭 링크·저장소 내부를 거부합니다. macOS 별칭도 실제 경로로 준비합니다. 상위 디렉터리는 root/현재 사용자 소유이며 비보호 쓰기 경로는 거부하고 `/tmp` 유형 sticky 디렉터리의 소유자 보호를 확인합니다. 실행 중 이동·권한 변경이나 보관 계정 공유를 하지 않습니다.

지원 provider는 `SecureDirectoryStream`으로 디렉터리를 고정합니다. 기존 macOS 검증 환경은 미지원이므로 POSIX 소유권·sticky 보호·링크·부모 inode 동일성 검사를 사용했습니다. 필요한 POSIX·파일 식별·하드 링크 기능이 없으면 중단합니다. Linux 고정 디렉터리 분기는 이 macOS 검증으로 입증하지 않았습니다.

같은 디렉터리에 무작위 `.score-snapshot-*.part`를 `CREATE_NEW`·`NOFOLLOW`·0600으로 만들고 전체 기록·파일 동기화 후 0400으로 제한합니다. 하드 링크로 완성된 두 아티팩트를 원자적으로 게시해 기존 파일·디렉터리·링크를 덮어쓰지 않으며 성공 후 임시 이름을 지웁니다. 일반 실패는 식별자가 같은 이번 실행 항목만 정리합니다. 이전 파일은 임의 삭제하지 않습니다.

강제 종료·전원 장애·신뢰하는 보관 계정의 경로 변경까지 자동 복구한다고 보장하지 않습니다. 파일 동기화는 백업이나 디렉터리 게시의 전원 장애 내구성을 대신하지 않습니다. 검증은 링크·비정규 파일·읽는 중 변경을 거부하고 파일 크기를 **64 MiB**로 제한합니다. 이는 점수·커버리지 임계값이 아닙니다.

복구 순서는 다음과 같습니다.

1. 종료값과 안전한 실패 단계를 확인하고 `NOT_COMPLETED`를 성공으로 취급하지 않습니다.
2. 담당자가 비공개 보관 위치를 확인합니다. `.part`를 완성본으로 쓰거나 자동 승인하지 않으며 소유·생성 이력이 확인된 항목만 별도로 정리합니다.
3. 기존 최종 파일은 덮어쓰지 말고 검증합니다. 재시도는 새 출력 이름을 지정합니다.
4. 권한·공간·파일시스템 지원과 원인을 확인하되 원본·접속 문자열·예외 원문을 로그/이슈에 붙이지 않습니다.

권장 파일명은 `*.score-snapshot.json`이며 패턴과 임시 파일은 `.gitignore`로 보호합니다. 이름을 바꿔도 원본의 Git 추가가 허용되지는 않습니다. 실제 보관·백업/복원·보존 기간·배포 책임과 독립 해시 보관 경로는 여전히 운영 전 결정 사항입니다.

### 6.8 실행 명령과 결과 해석

**일반 검증 — 합성 입력만 사용, 실제 개발 DB·보존 파일 불필요.** 저장소 루트에서 `cd backend`한 뒤 실행합니다. 통합 테스트만 Docker의 일회용 PostGIS가 필요하며 기존 DB 환경변수는 필요하지 않습니다. DB 없는 기본 프로필 테스트도 유지합니다.

```bash
cd backend
./gradlew test --tests '*ScoreSnapshotTests'
# 전체 검증이 필요할 때
./gradlew test integrationTest build spotlessCheck
```

**명시 실데이터/파일 작업 — 아래는 실행 안내이며 문서 정리 작업에서 실행하지 않습니다.** 같은 `backend/` 위치에서 필요한 환경변수를 미리 안전하게 준비합니다. 실제 개발 DB 여부·권한을 확인한 후 회귀/내보내기만 별도로 실행합니다. 출력·입력 경로는 사용자 선택의 외부 절대 경로이며 이 문서에 개인 경로를 쓰지 않습니다.

```bash
# DB 조회만: SCORE_REGRESSION_ENABLED와 DB 설정 필요
SCORE_REGRESSION_ENABLED=1 ./gradlew scoreRegression --quiet --console=plain 2>/dev/null

# DB 조회와 새 파일 보존: DB 설정·SCORE_SNAPSHOT_OUTPUT_PATH 필요
SCORE_SNAPSHOT_EXPORT_ENABLED=1 ./gradlew scoreSnapshotExport --quiet --console=plain 2>/dev/null

# DB 없는 파일 검증: SCORE_SNAPSHOT_INPUT_PATH 필요
./gradlew scoreSnapshotVerify --quiet --console=plain 2>/dev/null
```

외부 해시를 대조하려면 세 `SCORE_SNAPSHOT_EXPECTED_*` 변수를 독립 기록에서 준비합니다. 소문자 64자리만 허용하고 제공한 값이 비거나 다르면 실패합니다. 파일 안에서 읽은 해시를 그대로 기대값으로 쓰는 것은 독립 검증이 아닙니다. `externalPins=0`은 외부 기준 없이 내부 일관성만 확인한 상태이며 3개 일치도 진위·의미·전체 목록의 독립 승인을 증명하지 않습니다.

회귀 Java 도구는 0=대표 대조·현재 검산 성공, 1=기준선 차이/검산 실패, 2=설정·접속·안전 조건 등 미완료입니다. 내보내기·파일 검증은 0=성공, 2=오류입니다. Gradle은 비정상 종료를 작업 실패로 전달하므로 외부 Gradle 종료값만으로 1/2를 구분하지 말고 안전한 표준출력 단계도 확인합니다. **0도 R03 완전 재현이나 공개 승인은 아닙니다.** 도구 결과는 `publication=NOT_APPROVED`, `sourceTrust=NOT_ESTABLISHED`, `R03_COMPLETE=false`를 유지합니다.

표준출력은 수·제외·해시·읽기 전용/롤백·미승인 상태와 안전한 실패 단계만 담습니다. Gradle 오류에 로컬 Java 경로가 섞일 수 있어 위 명령은 표준오류를 버립니다. 실패 시 `--debug`·`--info`·`--stacktrace` 로그나 접속 설정을 공유하지 않습니다. 새 해시·기대 결과까지 함께 변조한 파일은 신뢰할 수 있는 외부 기준/서명 없이 탐지할 수 없습니다.

### 6.9 오프라인 Trust 사전 진단

`scoreTrustPreflight`는 기존 Trust Record → manifest → 구·동 스냅샷 검증 흐름을 명시적으로 실행합니다. 파일 읽기에는 6.7절의 `ScoreSnapshotFiles.read()`를 사용합니다. DB·웹 서버·실제 승인 발급·파일 저장을 수행하지 않고 제품 JAR·Service·Controller와 분리합니다. Gradle 자체의 빌드/캐시 산출물은 진단 입력·결과 파일과 별개입니다.

| 환경변수                               | 조건                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `SCORE_TRUST_PREFLIGHT_ENABLED`        | 정확히 `1`일 때만 실행                                                     |
| `SCORE_TRUST_RECORD_PATH`              | 필수: 현재 Trust Record JSON의 외부 정규 절대 경로                         |
| `SCORE_APPROVAL_MANIFEST_PATH`         | 필수: 승인 manifest JSON의 외부 정규 절대 경로                             |
| `SCORE_SNAPSHOT_INPUT_PATH`            | 필수: 기존 구·동 입력 스냅샷 묶음의 외부 정규 절대 경로                    |
| `SCORE_TRUST_RECORD_EXPECTED_SHA256`   | 필수: **독립적으로 지정한 현재 기록의 정규 바이트 SHA-256**, 소문자 64자리 |
| `SCORE_TRUST_PREVIOUS_RECORD_PATH`     | 선택: 독립적으로 신뢰할 수 있는 이전 기록. 지정 시 아래 해시도 필수        |
| `SCORE_TRUST_PREVIOUS_EXPECTED_SHA256` | 이전 기록의 독립 정규 SHA-256. 지정 시 이전 경로도 필수                    |

필수 설정과 선택 쌍을 전부 검사한 뒤 첫 파일에 접근합니다. 경로·해시 누락/빈 값·잘못된 형식은 오류이며, 현재 기록에서 기대값을 계산하거나 manifest/입력에서 승인 ID를 만들어 채우지 않습니다. 두 기대 해시는 원시 JSON 파일의 `shasum` 결과가 아니라 기존 `ScoreTrustRecordCodec.sha256()` 정규화 규칙의 식별값입니다. 검증 대상과 별도로 보호·검토한 배포 기준에서 확보해야 합니다. 대상 파일을 지금 해시해 그대로 환경변수에 넣는 절차는 독립 검증이 아닙니다. 실제 배포 경로·권한·승인 주체는 아직 확정하지 않았습니다.

`backend/`에서 필요한 환경변수를 안전하게 준비한 뒤 실행합니다. `.env`를 자동 로드하지 않고 명령행 인자를 받지 않습니다. 도구는 설정된 DB 환경변수를 사용하지 않습니다.

```bash
# 위 필수 경로·독립 기대 해시를 사전에 준비합니다. 파일이나 승인 기준을 생성하지 않습니다.
SCORE_TRUST_PREFLIGHT_ENABLED=1 ./gradlew scoreTrustPreflight --quiet --console=plain 2>/dev/null
```

성공은 종료값 0과 `PREFLIGHT_VERIFIED binding=TRUST_BINDING_VERIFIED externalTrustPin=MATCHED`입니다. `revisionCheck=NOT_PROVIDED`는 이전 기록 미제공으로 이력 검증을 하지 않았다는 뜻이고, `CHECKED`도 지정한 이전 기록과의 비교만 뜻합니다. 원천 비교 가능성과 실제 공개 승인은 각각 `sourceComparabilityApproval=NOT_ESTABLISHED`, `publicationApproval=NOT_APPROVED`입니다. 공통 상태 `publication=NOT_APPROVED sourceTrust=NOT_ESTABLISHED R03_COMPLETE=false`는 바뀌지 않습니다.

실패는 Java 종료값 2와 `NOT_COMPLETED: phase=...` 또는 비활성의 `NOT_EXECUTED`로 표시합니다. 단계는 `CONFIGURATION`, `INPUT_FILES`, `TRUST_PIN`, `PREVIOUS_TRUST_PIN`, `BINDING`, `FILE_STABILITY`뿐이며 원문·경로·예외는 출력하지 않습니다. Gradle은 비정상 종료를 작업 실패로 전달하므로 표준출력의 단계를 함께 확인합니다. 파일 변경·접근 실패·검증 실패를 이전 파일이나 캐시된 성공으로 대체하지 않습니다. 성공 직전 모든 파일을 다시 대조하지만 복수 파일의 원자적 읽기·검증 종료 이후 최신성·전역 리비전 단조성을 보장하는 운영 게이트는 아닙니다.

실제 공개까지는 [독립 신뢰·공개 조건](score-20262-publication-readiness.md#명시-실행-오프라인-사전-진단)의 공식 산정·경계 기준, 정책·원천·커버리지 승인, 보호된 운영 배포·철회·현재 DB 대조 게이트와 R03 전체 입력 재현이 필요합니다. 합성 테스트 성공으로 이 조건들을 대체하지 않습니다.

### 6.10 Backend 내부 진입점

[ScoreTrustVerification](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreTrustVerification.java)은 환경변수·Spring·DB에 의존하지 않는 명시 호출 컴포넌트입니다. 운영 신뢰 공급자는 아직 구현하지 않았습니다. 호출자는 검증 대상과 독립적으로 확보한 정규 기대 해시를 제공해야 하며, API 요청·manifest·현재 파일에서 기대값을 만들지 않습니다.

```java
var verifier = new ScoreTrustVerification(repositoryRoot);
var basis = new ScoreTrustVerification.TrustBasis(
    independentlyExpectedTrustSha256, independentlyExpectedPreviousSha256, minimumRevision);
var files = new ScoreTrustVerification.InputFiles(
    trustRecordPath, manifestPath, snapshotBundlePath, previousRecordPath);
var result = verifier.verify(basis, files); // BINDING_VERIFIED여도 공개 허용 아님
```

현재 해시는 필수입니다. 이전 경로와 해시는 둘 다 없거나 둘 다 있어야 하며, 선택적 최소 리비전은 1 이상입니다. 저장소 루트·입력·기준이 없거나 잘못되면 파일 접근 전 `TRUST_BASIS_MISSING`을 반환합니다. 안전 읽기·해시 대조·기존 검증기·파일 재대조는 CLI와 공유합니다. 결과는 파일/무결성 실패, 철회/리비전 실패, manifest/스냅샷 결합 실패와 완료를 구분하며, 원본 예외·JSON·경로·승인 ID를 담지 않습니다.

이전 기록 미제공은 `NOT_PROVIDED`, 리비전 하한만 검증하면 `REVISION_FLOOR_ONLY`, 독립 해시와 이전 기록의 이력 대조까지 완료하면 `CHECKED`입니다. 어느 경우도 최신성 서버·영구 단조 저장소·전체 철회 이력의 검증을 뜻하지 않습니다. 성공 직전 파일을 재대조해도 복수 파일의 원자적 스냅샷·검증 이후 철회 전파·현재 DB 동일성은 보장하지 않습니다. 매 호출 새로 읽고 실패 시 캐시나 과거 정상 파일을 사용하지 않습니다.

상세 결과·공급자 책임·운영에 남은 조건은 [공개 준비](score-20262-publication-readiness.md#backend-내부-신뢰-검증-진입점)를 따릅니다. `ScoreController`·`ScoreService`에는 연결하지 않으며 `NOT_APPROVED`, `sourceTrust=NOT_ESTABLISHED`, `R03_COMPLETE=false`를 유지합니다. [내부 진입점 테스트](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreTrustVerificationTests.java)는 합성 파일만 사용하고 기존 CLI·점수 API 회귀 테스트도 유지합니다.

### 6.11 현재 DB 전체 입력 대조

[ScoreCurrentInputVerification](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreCurrentInputVerification.java)은 명시적으로 전달한 DataSource와 보존 입력만 사용합니다. 생성 시 DB에 연결하거나 Spring Context·Flyway·ETL을 시작하지 않습니다. `ScoreController`·`ScoreService`·기존 CLI의 외부 동작도 바꾸지 않습니다.

- `verify(byte[])`: 바이트를 방어적으로 복사하고 기존 `ScoreSnapshotBundle`·Codec의 형식·해시·재현 검사 후 DB에 접근합니다. 손상된 기준은 DB 접근 전 `REFERENCE_INVALID`입니다.
- `verify(ScoreSnapshotReference)`: 이미 캡처한 불변 기준을 사용합니다. [ScoreSnapshotReference](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreSnapshotReference.java)는 구조 검증된 구·동 묶음과 정확한 파일 SHA-256을 연결하며 파일 경로를 재개방하지 않습니다. 공개 `decode()`는 임의 입력의 구조 검증일 뿐 독립 신뢰나 승인이 아닙니다.
- `ScoreTrustVerification.inspect()`는 기존 결합 검증과 파일 안정성 검사를 통과한 **그 바이트의** 참조를 반환합니다. 실패 시 참조는 null입니다. 기존 `verify()` 결과 계약은 유지합니다. 후속 DB 대조에는 이 참조를 그대로 전달하고 파일을 다시 읽어 기준을 바꾸지 않습니다.

```java
var binding = trustVerifier.inspect(independentBasis, inputFiles);
// 결합 성공 후의 별도 진단 단계다. 실패하면 reference가 null이며 DB 접근 없이 거부한다.
var current = new ScoreCurrentInputVerification(dataSource).verify(binding.reference());
// 두 결과 모두 공개 승인/REST 성공 응답을 의미하지 않는다.
```

구·동은 `20262`·`CS100010` 전체 Repository 조회를 각각 한 번 사용합니다. 유동인구의 업종 조건은 기존 Repository 계약대로 적용하지 않습니다. `REQUIRES_NEW`의 새 읽기 전용 `REPEATABLE_READ` 트랜잭션을 열고 `JdbcTransactionManager.setEnforceReadOnly(true)`로 **SQL `SET TRANSACTION READ ONLY`**를 강제합니다. PostgreSQL의 실제 `transaction_read_only=on`, `transaction_isolation=repeatable read`도 확인합니다. 구·동 조회 사이 재게시가 커밋돼도 같은 MVCC 입력을 읽으며 모든 경로를 롤백합니다. 호출자가 이미 가진 트랜잭션은 잠시 중단하고 별도 진단을 수행합니다.

[ScoreInputComparison](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreInputComparison.java)은 파일·DB 없이 대조할 수 있습니다. 기존 `ScoreSnapshotArtifact.capture()`·`requireReady()`·`canonicalPayload()`를 재사용해 구·동 각각 입력 ID와 정규 payload 바이트를 모두 비교합니다. 스키마·알고리즘·후보 정책, 분기·업종·단위, 전체 지역 코드/명칭/부모 연결, 원본 문자열·행 존재·적격 상태·배치 메타데이터, 완비·제외 목록과 사유가 대상입니다. 요청 시각·파일 포장 공백·기대 점수 등 입력 해시 밖의 값은 현재 입력 비교 대상이 아닙니다. 기준의 기대 계산 결과는 사전 재현 검사에서 확인합니다.

조회 순서는 기존 코드 정렬 규칙으로 정규화하고 배치 시각은 기존 UTC 규칙을 따릅니다. 숫자를 재포맷하거나 Number/부동소수점으로 비교하지 않으므로 `1.0`과 `1.00`, NULL·0·행 없음·부적격, 같은 값의 다른 실제 배치 UUID/체크섬/ETL 판본/게시 시각은 서로 다릅니다. 개별 행 결측은 제외 사유까지 대조하고, 전체 경계·데이터셋 미준비와 구분합니다. 자치구는 공식 구 통계이며 동 합계로 대체하지 않습니다.

| 결과 `status`          | 의미                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `MATCHED`              | 현재 구·동 전체 정규 입력과 보존 기준이 정확히 일치. 승인 아님       |
| `INPUT_MISMATCH`       | 한 단위라도 범위·지역·원본·출처·커버리지/제외 등이 달라짐            |
| `REFERENCE_INVALID`    | 기준 누락·형식·해시·재현 실패. DB 미접근                             |
| `DATA_NOT_READY`       | 현재 전체 경계·지원 통계 자료가 준비되지 않음. 과거 게시본 폴백 없음 |
| `DATABASE_UNAVAILABLE` | 연결·인증·자원/시간 초과·트랜잭션 완료 실패                          |
| `INTERNAL_ERROR`       | 실제 트랜잭션 조건 불일치·SQL/매핑·모순된 출처/숫자 등 예상 밖 오류  |

결과에는 상태와 사용한 기준의 `referenceFileSha256`만 담습니다. 원본값·SQL·인증정보·경로·원본 예외는 반환하지 않습니다. 매 호출 새로 조회하며 과거 정상 결과를 보관하지 않습니다. `MATCHED`도 원천/정책 승인·커버리지 수용·R03 재현을 뜻하지 않으며 `NOT_APPROVED`, `sourceTrust=NOT_ESTABLISHED`, `R03_COMPLETE=false`입니다.

DB 일치는 해당 읽기 트랜잭션의 입력에 한정됩니다. 롤백 이후 재게시나 Trust Record 변경까지 잠그지 않으며 즉각적인 철회 전파·여러 파일의 원자적 읽기·운영 기준 공급·현재 DB와 신뢰 기준을 공개 응답 직전까지 결합하는 게이트는 미구현입니다. 파일 결합 성공과 DB 일치는 독립된 결과이고, 임의 스냅샷의 DB 일치만으로 신뢰 기준을 만들지 않습니다. 실제 승인된 실데이터 기준은 아직 없으며 [단위](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreInputComparisonTests.java)·[통합](../backend/src/integrationTest/java/kr/ac/recycleyoungs/score/ScoreCurrentInputVerificationIntegrationTests.java)은 합성 자료만 사용합니다.

## 7. 구현할 테스트 계약

**아래는 전체 테스트 계약이며 모든 항목이 구현됐다는 뜻은 아닙니다.** 내부 계산·재현 검증에 더해 [미승인 차단 MockMvc 테스트](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreControllerTests.java)를 구현했으며, 승인 후 200·404와 운영 게이트 연결 검증은 후속입니다. 기존 [단위·MockMvc 테스트](../backend/src/test/java/kr/ac/recycleyoungs/store/DistrictStoreStatServiceTests.java)와 [일회용 PostGIS 통합 테스트](../backend/src/integrationTest/java/kr/ac/recycleyoungs/DistrictStoreStatApiIntegrationTests.java)의 분리를 따릅니다. 개발 DB·실제 ETL·기존 데이터 변경을 테스트 전제로 삼지 않습니다.

### 7.1 순수 계산·정밀도

| ID  | 입력·상황                                                                                                         | 기대 결과                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| C01 | 4.3절 가상 5지역 전체                                                                                             | A=(40,40,45,65,60), 최종 평균 순위=(4.5,4.5,3,1,2). ‘라’ 네 기여=22.5,22.5,15,5                                                                  |
| C02 | 한 지표 값 100,200,200,400,500                                                                                    | 200 두 건 평균 순위 2.5, 증가 정규화 3/8. 감소 방향은 5/8. 배열 순서가 바뀌어도 동일                                                             |
| C03 | NUMERIC 1.0과 1.00                                                                                                | 수치상 동률. 원본 문자열은 각자 유지. 코드순 정렬이 동률 순위를 쪼개지 않음                                                                      |
| C04 | 가상 5지역 점포의 오름차순                                                                                        | 점포가 많을수록 해당 기여 감소. m=(3,3,2,2), 합계 비중=1. 방향 반전·비중 변경이 들어가면 회귀 실패                                               |
| C05 | 두 합성 지역의 S=9007199254740992/9007199254740993, F=1.00000000000000000001/1.00000000000000000002, N=1/2, c=0/1 | 네 입력 순서 모두 구분, A=40/60. double로 합쳐지면 실패. 원본 0은 NULL이 아님                                                                    |
| C06 | 출력·정렬 계층에 정확한 점수 50.004와 50.003                                                                      | 둘 다 표시 50.00이지만 다른 점수·다른 순위. 50.005는 HALF_UP으로 50.01. 허용오차 동률 금지                                                       |
| C07 | 동일 정확한 A를 갖는 가·나                                                                                        | 모두 4.5위, tieCount=2. 응답 배열은 코드순이어도 순위 유지                                                                                       |
| C08 | 정확한 항목 기여 합과 A. 표시 검산은 n=31, 네 v 모두 1                                                            | 분수 합이 항상 일치, 0≤정규화≤1·0≤A≤100. 이 fixture의 기여 표시는 0.50+0.50+0.33+0.33=1.66이지만 A=5/3, 표시 1.67. 표시 합으로 A를 덮어쓰면 실패 |
| C09 | 임의의 양의 공통 배수로 한 지표 전체 값 변경                                                                      | 순위·A 불변. 이는 계산기 성질만 검증하며 실제 판본 동등성을 입증하지 않음                                                                        |
| C10 | 두 합성 지역 (S,F,N,c)=(0,0,2,2), (1,1,1,1)                                                                       | A=0/100, 모두 CALCULATED. 정상 계산의 0점과 NOT_CALCULABLE·data=null 구분                                                                        |

C06은 실제 지역 실험이 아니라 표현 계층에 주입하는 분수 fixture입니다. C05의 작은 집단도 합성 단위 테스트일 뿐 실제 2지역 공개 커버리지를 승인한 것이 아닙니다.

### 7.2 입력·집단·서비스 상태

| ID  | 상황                                               | 기대 결과                                                                                                                                        |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| S01 | 유효 행 없음 / 유효 행 S=NULL / S=0                | 승인된 제외 목록 전제에서 앞 둘은 서로 다른 사유로 NOT_CALCULABLE, 마지막은 계산 참여. 0점 대체 금지                                             |
| S02 | F·c의 실제 0, c=200, 또는 N=0·음수·NaN             | F·c의 0 및 c=200은 허용. N=0은 ZERO_STORE_COUNT, 음수는 INPUT_NEGATIVE, NaN은 INPUT_NON_FINITE로 제외. 새 제외면 커버리지 재검토                 |
| S03 | n=0 또는 n=1                                       | 집단 INSUFFICIENT_COHORT, 나눗셈 호출 없음, data=null. 승인 미충족이면 그보다 앞선 503 유지                                                      |
| S04 | 모든 지역에서 한 필수 지표가 같은 값               | 집단 CONSTANT_INDICATOR로 보류. 순수 순위 함수가 반환할 0.5와 서비스의 보류 정책을 별도 검증                                                     |
| S05 | 승인된 매출 누락 4동·완비 421동                    | 동 421개만 공통 기준으로 사용, 제외 4동은 자기 사유와 data=null. 영구 건수 하드코딩 없음                                                         |
| S06 | 승인 목록에 없던 한 동이 추가 누락되거나 사유 변경 | COVERAGE_REVIEW_REQUIRED. 단, 입력 해시 승인도 달라졌다면 선행 INPUT_SNAPSHOT_CHANGED 503을 먼저 반환. coverage 검사는 독립 단위 테스트로도 검증 |
| S07 | 구 데이터와 동 데이터, 특정 구·동 선택             | 각각 자기 단위 서울 전체 완비 집단. 동 선택이나 지도 범위로 재정규화하지 않음. 구는 공식 테이블만 사용                                           |
| S08 | 최저 매출이지만 나머지 항목이 높음                 | A 가중합 결과 그대로, 임의 하한·감점·재분배·저매출 배지 없음. 세 고정 해석 경고와 원본·기여 유지                                                 |
| S09 | 정책·판본 근거·승인 입력 해시 각각 미충족          | 계산·성공 응답 공개 없이 503. request로 승인 상태를 우회할 수 없음                                                                               |

### 7.3 Controller·출처·재게시

| ID  | 조건                                                                           | 기대 결과                                                                                                        |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| A01 | 코드 길이·전각 숫자·공백·필수 누락·동일 query 중복·미지원 분기/업종·추가 query | 서비스 호출 전 400 INVALID_PARAMETER. 기존 통계 Controller 동작은 변경 없음                                      |
| A02 | 최신 정상 경계가 비었고 과거 경계에는 행 존재                                  | 503. 과거 경계 폴백 없음. 현행 지역 미존재는 통계 미준비보다 먼저 404                                            |
| A03 | 동과 부모 구의 boundary_batch_id가 다름                                        | 현행 동으로 인정하지 않음. 다른 단위 통계로 대체하지 않음                                                        |
| A04 | 세 자료 각각 잘못된 dataset/source/scope/scope_code/status/published_at        | 부적격 출처가 입력으로 들어오지 않음. 적격 실제 행이 전무하면 DATA_NOT_READY. 게시 이력만으로 준비 판정 금지     |
| A05 | 오래된 정상 통계 행 + 최신 빈 게시 또는 SKIPPED 이력                           | 원래 유효 행을 가리지 않음. 점수의 입력 승인 해시와 일치할 때만 계산                                             |
| A06 | 두 세션에서 조회 중 재게시·Upsert 발생                                         | 한 요청의 경계·세 통계·집단·입력 해시는 하나의 REPEATABLE_READ 스냅샷. 다음 요청은 변경을 탐지해 새 승인 전 503  |
| A07 | DB 연결·자원·시간 초과 / SQL·매핑 오류                                         | 각각 기존 503 DATABASE_UNAVAILABLE / 500 INTERNAL_ERROR. NULL 점수나 정상 0점으로 변환하지 않음                  |
| A08 | CALCULATED·NOT_CALCULABLE·503 응답 직렬화                                      | 정확한 분수·원본 수치 문자열, data의 명시적 null, sourceBatch NULL/유지, 고정 사유. 예외 원문·경로·인증정보 없음 |

출처·재게시 통합 검증은 기존 integrationTest 방식의 일회용 DB에 한정합니다. 실제 개발 DB에서 재게시해 검증하지 않습니다. 현재 점수 Controller의 요청 처리는 DB에 연결하지 않습니다.

### 7.4 재현·기존 결과 회귀

- **R01:** 같은 payload를 입력 순서만 바꿔도 정렬·직렬화 후 동일 해시. 원본 scale·경계·출처·제외 사유·정책 중 하나가 달라지면 다른 해시. 요청 시각만 바꾸면 동일 해시.
- **R02:** 보존한 전체 스냅샷을 DB 없이 계산기에 넣으면 정규화 분수·기여·A·최종 평균 순위가 정확히 일치. 요청 지역 한 건이나 UUID만 있는 자료로 재현 성공을 주장하지 않음.
- **R03:** 승인된 `20262` 전체 원본 fixture를 확보한 뒤, 구 25·동 421 및 기존 누락 4동을 대조하고 아래 기준 결과를 검증. 새 DB에서 비슷한 숫자가 나온 것으로 과거 스냅샷 재현을 대신하지 않음.

| 기존 실제 지역    | A 표시 / 평균 순위 |
| ----------------- | ------------------ |
| 강남구            | 72.50 / 2          |
| 마포구 서교동     | 67.76 / 23         |
| 서대문구 신촌동   | 73.31 / 3          |
| 관악구 삼성동     | 60.36 / 83         |
| 성북구 돈암1동    | 41.36 / 322.5      |
| 서대문구 북아현동 | 64.50 / 45         |

[기준 검증](archive/score-mvp-criteria-validation.md)과 [R03·실제 입력 보존 기록](archive/score-20262-snapshot-preservation.md)을 구분해 읽습니다. 2026-11-02 17:38에는 대표 6곳·현재 446개를 검산했고 20:56에는 별도 실제 입력을 보존·오프라인 재현했습니다. **과거 12:17 전체 입력 fixture는 없어 R03 완전 재현은 미완료**입니다. 체크섬·배치·대표값으로 과거 전체 입력을 역산하지 않습니다. 과거 분기 순위 안정성과 실제 창업 성과는 보장 범위가 아닙니다.

### 7.5 기존 검증 결과와 재실행 경계

아래는 **각 구현 당시의 별도 실행 기록**이며 이번 문서 통합에서 테스트를 다시 실행한 결과가 아닙니다. 서로 다른 시점의 합계로 현재 전체 테스트 수를 추정하지 않습니다.

| 시점·단계                             | 당시 결과                                                          | 범위·한계                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 2026-11-02 R01·R02 코어, 도구 추가 전 | 스냅샷 44개, 전체 단위 526개·통합 828개, 실패/건너뜀 0             | 합성 전체 집단. 행 존재+출처 ID/메타데이터 필수 조건을 포함한 보완 7개도 포함. 실제 개발 DB 도구 미실행 |
| 2026-11-02 내보내기·오프라인 도구     | 신규 단위 22개·통합 5개, 전체 단위 548개·통합 833개, 실패/건너뜀 0 | 합성 전체 3구·3동·JUnit 소유 임시 디렉터리·일회용 PostGIS. 기존 코어 44개·고정 SHA fixture 유지         |

두 단계 모두 빌드·Spotless·문서 Prettier·링크·표·신규 파일 공백 검사를 확인한 과거 기록입니다. 도구 테스트는 비활성·안전 속성 덮어쓰기·외부 경로/권한/기존 파일/링크/경로 교체·부분 저장 정리·변조·외부 기준·오프라인 재현을 다룹니다. 일회용 DB에서는 실제 읽기 전용·ROLLBACK·두 단위 저장·동시 변경의 동일 스냅샷·인증 실패·빈 최신 경계·게시 실패를 확인했습니다. 테스트 fixture 쓰기/마이그레이션은 내보내기 도구의 쓰기가 아닙니다.

R01은 순서·시각 불변성, 변경 탐지·고정 해시·JSON 왕복/손상 거부를 검증합니다. R02는 원본 표현·전체 집단·정확한 결과·제외/보류의 DB 없는 재현입니다. 합성 코어 성공과 이후 실제 입력 보존 성공을 동일 실행으로 합치거나 승인된 실데이터라고 부르지 않습니다. 정책·원천 판본·커버리지·실제 창업 성과 승인은 어느 단계도 수행하지 않았습니다.

## 8. 승인과 구현 착수 조건

1. **정책 승인:** 1~2절의 감소 방향·비중·보상·입력 및 동일값 예외·커버리지·표시·지원 범위를 하나의 버전으로 결정합니다. 보상을 허용하지 않는다면 A를 먼저 구현하고 임의 하한을 덧붙이지 말고 정책부터 다시 정합니다.
2. **데이터 승인:** [원천 조사](archive/score-source-verification.md)의 미확인 범위를 인정하되, 실제 사용할 판본의 같은 분기·공간·업종 비교 가능성을 확인합니다. 확인 전에는 공개 점수 제공 불가입니다. 과거 분기·성공 예측은 승인 범위에서 제외합니다.
3. **구현 계약 승인:** 요청·응답·새 예외 사유·정밀도·아티팩트의 보존 위치와 책임을 확정합니다. 기존 [데이터 계약](data-design.md#5-평가-결과의-재현성)과 [서비스 요구사항](service-spec.md#3-창업-환경-점수-확인)의 후속 변경은 실제 구현 단계에서 함께 검토합니다.
4. **구현 후 공개 조건:** 합성 단위·MockMvc·일회용 DB 통합 테스트, 승인 입력 fixture의 회귀·재현 검증을 통과해야 합니다. 현재 내부 계산·입력 조회·재현/결합 검증과 REST의 미승인 차단 경로만 구현했습니다. `region_score`·공개 200 응답·운영 승인/철회 게이트·실제 승인 아티팩트는 미구현입니다. 내부 상태는 계속 `NOT_APPROVED`, `sourceTrust=NOT_ESTABLISHED`이며 과거 R03 완전 재현도 미완료입니다.

다음 작업은 위 정책 선택의 승인, 실제 원천 판본 비교 가능성 확인, 보호된 신뢰 기록 로더와 승인·철회·현재 DB 대조 게이트 구현입니다. 이 문서는 승인 전 명세이며 공개 제공 허가·창업 적합성 검증을 대신하지 않습니다.
