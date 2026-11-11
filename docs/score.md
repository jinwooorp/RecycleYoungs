# 창업 환경 점수

## 1. 기능 소개와 현재 구현 상태

창업 환경 점수는 서울에서 카페 후보지를 살펴볼 때 **같은 분기·같은 지역 단위**의 상권 특성을 0~100점의 상대 지표로 설명하기 위한 기능입니다. 점수의 용도는 후보지 탐색과 원본 통계 해석입니다. 창업 성공 확률·예상 수익·위험 등급을 추정하는 모델은 검증하지 않았습니다.

| 영역         | 현재 상태                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 계산·조회    | A 후보 계산기, 서울 전체 입력 Repository, 내부 Service 및 집단 검증 구현                                                                  |
| 재현·검증    | R01 정규 입력 해시, R02 DB 없는 전체 재현, 명시 실행 도구, manifest·Trust Record 결합과 현재 DB 입력 대조 구현                            |
| 공개         | `NOT_APPROVED`, `sourceTrust=NOT_ESTABLISHED`, `R03_COMPLETE=false`. 유효한 점수 REST 요청은 HTTP 503                                     |
| 승인 전 설계 | A의 방향·가중치·예외·표시와 사용 판본·커버리지. 공개 200 응답, 서비스의 점수 화면, 운영 승인·철회 게이트와 보호된 신뢰 기준 공급은 미구현 |

**목차**

1. [기능 소개와 현재 구현 상태](#1-기능-소개와-현재-구현-상태)
2. [사용 데이터와 알고리즘 설계](#2-사용-데이터와-알고리즘-설계)
3. [현재 A 계산 규칙과 예외](#3-현재-a-계산-규칙과-예외)
4. [Backend 조회·계산·REST API 계약](#4-backend-조회계산rest-api-계약)
5. [입력 스냅샷·재현·검증 도구](#5-입력-스냅샷재현검증-도구)
6. [원천 신뢰 검증](#6-원천-신뢰-검증)
7. [공개 승인 조건과 차단 정책](#7-공개-승인-조건과-차단-정책)
8. [남은 설계 결정과 후속 작업](#8-남은-설계-결정과-후속-작업)
9. [과거 실험과 검증 기록](#9-과거-실험과-검증-기록)

## 2. 사용 데이터와 알고리즘 설계

내부 후보의 지원 범위는 2026년 2분기(`20262`), 카페(`CS100010`, 커피-음료)입니다. 자치구는 공식 구 원천을 읽고 행정동과 별도 집단으로 비교합니다. 반경 내 카페 검색 건수는 점수의 입력에 포함되지 않습니다. [서비스 이용 범위](service-spec.md#점수-평가-범위) · [자치구 집계 정책](data-design.md#지표별-집계-정책)

| 입력                | 해석                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| S · 당월 추정매출액 | 카드 자료와 보정값으로 추정한 지역 소비 규모. 원본의 기간 의미를 유지하며 임의 환산을 피합니다.     |
| F · 총 유동인구     | 길 구간에 공간 배분한 생활인구 규모. 업종 조건을 적용하지 않으며 고유 고객 수로 해석할 수 없습니다. |
| N · 전체 점포 수    | 일반 점포와 프랜차이즈를 포함한 카페 업종 통계. 수요 규모와 경쟁 환경을 함께 반영할 수 있습니다.    |
| c · 원천 폐업률     | 원천이 계산한 비율. 원천 값과 자릿수를 보존하며 점포 수로 재산정하거나 100%로 제한하지 않습니다.    |

### A~E 모델과 판단 근거

모든 모델은 같은 실험 안에서 동일한 완비 집단을 비교했습니다. A·D·E의 `z`는 3절에서 정의하는 매출·인구 증가, 점포·폐업률 감소 방향 순위값입니다. `w=(0.30,0.30,0.20,0.20)`을 사용했습니다. B·C의 `u=R(S/N)`, `v=R(F/N)`, `t=1−R(c)`는 같은 집단의 점포당 규모와 폐업률 순위값입니다. `N>0`을 먼저 검사합니다.

| 모델 | 결합 방식                                                                                                      | 기존 검증에서 확인한 한계                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | `100 × Σ(wᵢzᵢ)`                                                                                                | 항목별 기여를 설명할 수 있습니다. 높은 다른 항목이 낮은 매출을 보상할 수 있습니다. 내부 구현의 기준선입니다.                                                                                    |
| B    | `100 × (0.40u + 0.35v + 0.25t)`                                                                                | 점포가 적으면 점포당 지표가 커집니다. 점포·매출 모집단의 일치도 미확인입니다.                                                                                                                   |
| C    | `100 × (u + v + t)/3`                                                                                          | B의 세 항목에 정확히 같은 비중을 적용해도 작은 분모의 민감도가 남았습니다.                                                                                                                      |
| D    | `100 × ∏zᵢ^wᵢ`                                                                                                 | 낮은 항목의 보상을 줄이며, 양의 비중 항목 하나의 정규화값이 0이면 전체가 0입니다. 작은 상수나 하한을 넣지 않았습니다.                                                                           |
| E    | 항목별 `pⱼ=maxᵢ(zᵢⱼ)`, `qⱼ=minᵢ(zᵢⱼ)`. 지역별 `d⁺=√Σⱼ[wⱼ(zᵢⱼ−pⱼ)²]`, `d⁻=√Σⱼ[wⱼ(zᵢⱼ−qⱼ)²]`, `100 × d⁻/(d⁺+d⁻)` | 기존 순위값을 재사용한 TOPSIS형 변형입니다. 가중치는 제곱 거리 항에 한 번 곱합니다. 거리 합이 0이면 산출 불가이며 추가 벡터 정규화는 적용하지 않습니다. 상위 후보가 달라지고 보상도 남았습니다. |

가상 지역의 `z=(0.75,0.75,0.75,0.25)`에서 A는 65점입니다. 별도 가상 두 지역에서 S=1,000,000원, F=10,000, c=2%가 같고 N만 10개·100개라면, `t=0.5`이고 B는 87.5·12.5, C는 약 83.33·16.67점입니다. 이 검산은 작은 분모가 순위에 미치는 영향을 보여줍니다. 같은 가상 5지역에서 ‘라’의 D는 약 60.21점, E는 기준점 `p=(1,1,1,1)`, `q=(0,0,0,0)`일 때 가중 제곱 거리 합 0.1625·0.4625로 약 62.78점입니다. 실제 실험의 관측 최댓값은 구 `(1,1,1,47/48)`, 동 `(1,1,839/840,53/60)`였고 최솟값은 두 단위 모두 `(0,0,0,0)`였습니다. 동률로 끝값이 좁아진 범위를 다시 늘리지 않았습니다.

E에서 기존 순위값을 바로 사용하는 선택의 비교 기준은 다음 연구의 TOPSIS 절차입니다. [다기준 의사결정 방법 비교 연구](https://link.springer.com/article/10.1186/s40537-023-00788-3)

### 실험용 log/winsor 정규화

**입력:** 같은 비교 집단의 비음수 규모형 값 x. **출력:** 0~1 값 H(x). S·F·N·S/N·F/N에 적용하며, N은 결과 방향을 반전합니다. **폐업률은 3절의 순위 정규화를 유지합니다.** D·E의 기존 비교는 순위 방식만 사용했습니다.

계산 순서는 **로그 변환 → 로그값의 P05·P95 산출 → 경계 밖 값 제한 → 0~1 변환**입니다. y는 로그값, L·U는 하위·상위 경계, b는 제한한 값입니다. ln은 자연로그, max·min은 각각 큰 쪽·작은 쪽을 고르는 함수입니다.

$$
y=\ln(1+x),\quad L=q(0.05),\quad U=q(0.95)
$$

$$
b=\min(\max(y,L),U),\qquad H(x)=\frac{b-L}{U-L}
$$

1을 더하므로 원본 x=0도 y=0으로 계산할 수 있습니다. 원본 9·99·999는 로그 뒤 약 2.3026·4.6052·6.9078이 됩니다. 큰 값의 차이를 줄이지만 원본 크기를 그대로 보존하지는 않습니다.

**type 7:** 먼저 로그값 y를 오름차순으로 정렬하고 0부터 번호를 매깁니다. p는 분위수 비율, h는 그 위치, j는 정수 위치, t는 다음 값까지의 보간 비율입니다. floor는 아래 정수로 내림, y[j]는 j번째 값입니다.

$$
h=(n-1)p,\quad j=\operatorname{floor}(h),\quad t=h-j
$$

$$
q(p)=(1-t)y[j]+t\,y[j+1]
$$

t=0이면 y[j]만 사용합니다. 원본 분위수에 나중에 로그를 취하는 방식으로 바꾸지 않습니다.

**최소 검산:** 가상 로그값 0, 1, 3.4, 5, 7에서 P05 위치는 0.2, P95 위치는 3.8입니다.

- L=0.8×0+0.2×1=0.2, U=0.2×5+0.8×7=6.6입니다.
- y=0은 b=0.2로 제한돼 H=0, y=3.4는 H=(3.4−0.2)/6.4=0.5, y=7은 b=6.6으로 제한돼 H=1입니다.

U=L이면 계산하지 않습니다. 원본이 양수여도 P05 이하이면 H=0이 될 수 있습니다. 경계 밖 값을 삭제하거나 결측을 0으로 바꾸지 않습니다.

### 작은 분모와 정규화 실험

2026-11-01 비교는 각각 별도 읽기 전용 스냅샷에서 수행했습니다. 각 실험 안에서 완비 25구·421동의 입력과 출처를 고정했습니다.

공통 421동 중 점포 10개 미만은 12동, 20개 미만은 62동입니다. 다음은 **상위 약 10%인 43동에 포함된 수**입니다. 전체 집단에서 상위 10% 경계에 걸친 동점 지역까지 포함한 결과가 43동이었습니다. 상위 경계는 `ceil(n×0.10)`번째 점수이며 그 점수의 동률까지 포함합니다. 작은 집단별로 다시 정규화하지 않았습니다.

| 점포 수 구간 | 동 수 | 순위 A | 순위 B | 순위 C | 혼합 B | 혼합 C |
| ------------ | ----- | ------ | ------ | ------ | ------ | ------ |
| 10개 미만    | 12    | 0      | 4      | 6      | 4      | 6      |
| 20개 미만    | 62    | 0      | 13     | 16     | 14     | 16     |

10개 미만은 20개 미만의 부분집합입니다. 이 기준은 위험을 살피기 위한 구간이며 산출 제외 정책으로 채택한 것이 아닙니다.

가양3동은 **점포 7개·폐업률 14%**인데 A **28.76점·408위**, B **66.81점·35위**, C **59.52점·91.5위**였습니다. 점포당 지표가 높은 값을 받아 높은 폐업률을 메울 수 있었습니다. 상계9동은 점포 7개로 B·C 모두 4위였습니다.

행정동 A–B 순위 상관은 0.5655, B–C는 0.9658입니다. 여기서 **순위 상관**은 동률 평균 순위로 구한 Spearman 상관으로, 두 모델이 지역을 비슷한 순서로 놓는 정도입니다. 1에 가까울수록 전체 순서가 비슷하며, 이번에는 A와 B보다 B와 C가 더 비슷한 순서를 만들었습니다. 다만 B·C도 개별 지역의 최대 순위차가 96.5등이어서 비중 선택을 가볍게 볼 수 없습니다. 실제 성과가 없으므로 어느 지역이 과대평가됐는지 확정한 것은 아닙니다.

#### 혼합 정규화에서의 변화

혼합 방식에서 20개 미만 지역의 상위 진입은 B 13→14동, C 16동 유지였습니다. 작은 집단과 점포 20개 이상 집단의 평균 점수 격차는 줄었지만, 상위 진입 수는 일관되게 줄지 않았습니다.

가양3동의 B 순위는 35위에서 59위로 내려갔고 상계9동은 B·C 모두 4위를 유지했습니다. 돈암1동·삼성동 등 5동은 꼬리 제한으로 서로 다른 원본값이 같은 점수로 묶였습니다. 혼합 B **57.08점·189위**, C **62.78점·103위**입니다.

행정동 B의 두 정규화 사이 순위 상관은 0.9697이지만 최대 순위차는 97등입니다. 혼합 B·C의 평균도 50점에서 각각 55.06·54.53점으로 이동했습니다. 순위 기반 가중합의 평균 50점은 계산 방식에서 생기는 값이며 성능 기준이 아닙니다. **개별 점수 상승이나 높은 전체 상관만으로 개선을 판단할 수 없습니다.** 전체 순서가 비슷해도 한 동네가 97등 이동하면 살펴볼 후보지가 달라질 수 있고, 평균 상승은 실제 지역 환경이 좋아졌다는 뜻이 아닙니다.

### 실험에서 남은 판단

- 11월 2일 A의 점포 방향을 증가로 바꾸면 동 상위 5곳 중 2곳만 겹쳤고 최대 192등이 변했습니다. 매출과 점포 수는 양의 순위 상관을 보여 증가 방향은 규모를 중복 반영할 수 있습니다.
- 기본 A·E에서는 매출 하위 약 10%에서 종합 상위 약 10%에 든 곳이 없었습니다. A의 매출 비중을 0.30에서 0.25로 낮추고 나머지를 비례 조정하자 저매출 3동이 상위 43동에 들었습니다. 공개용 저매출 경고나 점포 10·20개 제외 기준은 채택하지 않았습니다.
- D는 강남구·서교동에서 점포 지표의 정규화 0이 전체 0점으로 이어졌습니다. E는 A와의 전체 순위 상관이 높았지만 동 상위 5곳은 1곳만 겹쳤습니다. 6분기 자료가 일부 존재해도 경계·산정 호환성을 확보할 때까지 분기 간 순위 안정성은 보류합니다. [A·D·E 및 민감도 원문](archive/score-mvp-criteria-validation.md)

## 3. 현재 A 계산 규칙과 예외

버전 `a-rank-v1-candidate.1`은 서울 전체의 해당 단위에서 **네 입력이 모두 유효한 하나의 집단**을 만든 뒤 지표별로 정규화합니다. 선택 구·동·검색 반경으로 집단을 재구성하지 않습니다. 아래 방향과 비중은 실행 중인 내부 후보의 규칙이며 최종 공개 정책은 승인 전입니다.

### 입력 검증과 집단 보류

| 조건                                                 | 처리                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 통계 행 없음 / 행은 있으나 출처 부적격 / 측정값 NULL | `INPUT_ROW_MISSING` / `SOURCE_NOT_ELIGIBLE` / `INPUT_NULL`로 구분해 제외                                   |
| 음수 / 비유한 값 / 점포 수 0                         | `INPUT_NEGATIVE` / `INPUT_NON_FINITE` / `ZERO_STORE_COUNT`로 제외                                          |
| 매출·인구·폐업률 실제 0                              | 유효. 비음수의 유한한 폐업률은 100% 초과도 원본대로 유지                                                   |
| 완비 지역 수 `n≤1`                                   | `INSUFFICIENT_COHORT`. 계산 전에 보류                                                                      |
| 필수 지표 하나 이상이 전체 지역에서 동일             | 순수 계산기는 정규화 0.5와 진단을 반환할 수 있고, Service·재현의 집단 판정은 `CONSTANT_INDICATOR`로 보류   |
| 승인된 전체 경계·완비·제외 코드 또는 사유 불일치     | 공개 게이트 후속 계약의 `COVERAGE_REVIEW_REQUIRED`. 현재 관찰된 25구·421동을 영구 기대값으로 사용하지 않음 |

실제 계산된 0점은 유효한 결과입니다. 입력 제외나 집단 보류는 점수 없이 사유를 기록합니다. 원본 비유한 표현은 숫자 파싱 전에 구분하고, 정의되지 않은 비수치 텍스트·매핑 오류는 내부 오류로 처리합니다. 내부 집단 사유의 `INSUFFICIENT_COHORT`는 지표가 NULL이고, `CONSTANT_INDICATOR`는 동일값을 가진 지표별로 남깁니다. 제외 사유는 코드 선언 순서, 같은 코드에서는 매출·유동인구·점포·폐업률 순서로 정렬합니다.

### 순위 정규화와 정확한 계산

한 지표에서 작은 값의 개수를 `a`, 같은 값의 개수를 `k`, 집단 크기를 `n`이라 하면 오름차순 평균 순위는 `r=a+(k+1)/2`, 정규화는 `R=(r−1)/(n−1)`입니다. 매출·인구에는 `R`, 점포·폐업률에는 `1−R`을 적용합니다. 예를 들어 100, 200, 200, 400, 500에서 두 200은 평균 순위 2.5와 `R=3/8`을 공유합니다. 동률 최솟값의 정규화도 0으로 고정하지 않습니다. 기존 421동의 폐업률 0인 99동은 평균 순위 50과 감소 방향 `371/420`을 공유했습니다.

BIGINT는 문자열에서 `BigInteger`로, NUMERIC은 원본 문자열에서 `BigDecimal`로 파싱합니다. `1.0`과 `1.00`은 수치상 동률이며 원본 표기는 각각 보존합니다. 중간 계산에는 `long` 변환, 부동소수점, 정수 나눗셈을 사용하지 않습니다.

한 지표에서 a는 더 작은 값의 개수, k는 같은 값의 개수, n은 공통 지역 수입니다. 평균 순위의 두 배인 `t=2a+k+1`을 구합니다. 정규화 분모는 `d=2(n−1)`입니다.

- 증가 방향인 매출·인구의 정규화 분자는 `v=t−2`입니다.
- 감소 방향인 점포·폐업률의 정규화 분자는 `v=2n−t`입니다.
- 방향 통일값은 정확히 `z=v/d`입니다. 중간 소수 반올림은 없습니다.
- 비중의 정수 표현은 매출·인구 m=3, 점포·폐업률 m=2이며 실제 비중은 m/10입니다.
- 항목별 100점 기준 기여는 `5mv/(n−1)`입니다.
- `K=3vS+3vF+2vN+2vc`이면 **A=`5K/(n−1)`**입니다. 같은 집단은 분모가 같으므로 K의 내림차순으로 정확한 점수 동률·순위를 판정할 수 있습니다.

정수 연산은 BigInteger로 하고 외부에 보낼 분수는 최대공약수로 약분해 분모를 양수로 둡니다. 0은 0/1입니다. 집단이 다른 결과끼리 K를 비교하지 않습니다. 코드 순서는 동률 결과의 안정적인 나열에만 쓰고 평균 순위를 깨지 않습니다.

### 표시 정밀도와 가상 검산

정확한 결과에서 표시값을 따로 생성합니다. 승인 전 REST 표현안에서는 원본·비중·정규화 소수·점수·기여·평균 순위를 JSON 문자열로 표현합니다. 지역 수·동률 지역 수 같은 작은 개수만 JSON 정수입니다. 정확한 분수는 `{numerator, denominator}` 문자열 쌍으로 제공합니다.

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

정밀도 검증에서는 `9007199254740992`와 `9007199254740993`, `1.00000000000000000001`과 `1.00000000000000000002`를 구분합니다. 정확한 50.004와 50.003은 표시가 모두 50.00이어도 다른 순위이며 50.005는 50.01로 표시합니다. 예를 들어 `n=31`에서 각 지표의 정규화 분자 `v=1`이면 기여의 표시 합은 1.66, 정확한 점수는 5/3으로 표시값은 1.67입니다. 두 지역의 (S,F,N,c)가 (0,0,2,2)와 (1,1,1,1)일 때 두 점수 0과 100은 모두 산출된 값입니다.

## 4. Backend 조회·계산·REST API 계약

### Backend 실행 경계

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

### 입력 조회 계약

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

### 현재 점수 REST

Controller는 `db` 프로필에서 요청을 검증하고 미승인 요청을 차단합니다. DB나 내부 계산·승인 컴포넌트를 호출하는 경로와 요청·헤더·환경변수로 공개 승인을 지정하는 경로는 없습니다.

#### 요청

- `GET /api/v1/districts/{districtCode}/score?quarterCode=20262&industryCode=CS100010`
- `GET /api/v1/dongs/{dongCode}/score?quarterCode=20262&industryCode=CS100010`

지역 코드는 ASCII 숫자 5자리·8자리, quarterCode는 `[0-9]{4}[1-4]`, industryCode는 `CS[0-9]{6}`이어야 합니다. 필수 query는 각 1개만 허용하고 동일 값 중복도 400입니다. trim·쉼표 분할·다른 분기 대체는 하지 않습니다. 형식이 맞아도 `20262`·`CS100010`이 아니면 400 `INVALID_PARAMETER`입니다. **점수 경로는 이 두 query 외 파라미터도 400으로 거부하도록 구현했습니다.** 기존 Controller의 다른 파라미터 처리 정책을 바꾸는 것은 아닙니다.

#### 상태와 오류

오류는 기존 `ApiException`·`ApiErrorCode`·`ProblemDetail`을 사용합니다.

| 현재 경로/요청                                     | 응답                    | DB·내부 점수 노출 |
| -------------------------------------------------- | ----------------------- | ----------------- |
| 두 경로의 누락·중복·추가 query, 형식·지원 값 오류  | 400 `INVALID_PARAMETER` | 없음              |
| `db`의 유효한 요청, 형식만 유효한 미존재 코드 포함 | 503 `DATA_NOT_READY`    | 없음              |
| 기본 프로필                                        | 점수 Controller 미등록  | 없음              |

현재 503의 ProblemDetail에는 `title`, `status`, `detail`, `instance`, `code`가 있습니다. `about:blank` 타입과 별도 `reason`은 현재 직렬화에서 생략됩니다. 형식상 유효한 지역 코드의 존재나 자료 준비 여부를 조회하기 전에 차단합니다.

### 승인 후 REST 응답 제안

이 절의 200·404, DB 오류 매핑과 추가 `reason`은 승인 게이트 후속 구현에서 사용할 제안입니다.

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

성공과 산출 불가는 아래 필드 구조를 공유하는 안입니다. 정확한 분수의 분자·분모는 문자열로 표현하고 표시에만 3절의 반올림을 적용합니다.

| 필드                             | 제안 구조                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 지역·지원 범위                   | `regionType` (`DISTRICT` 또는 `DONG`), `regionCode`, `regionName`, `quarterCode`, `industryCode`, `algorithmVersion`                                                                                                                                                                                        |
| 상태                             | `status`와 `reasons`. `CALCULATED`이면 사유는 빈 배열                                                                                                                                                                                                                                                       |
| `inputs`                         | `sales`, `footTraffic`, `storeCount`, `closureRate`의 원본 문자열 또는 NULL                                                                                                                                                                                                                                 |
| `data`                           | `score`는 `{numerator, denominator, display}`, `rank`는 정수 또는 .5 문자열, `tieCount`는 JSON 정수. `components`의 각 항목은 `metric`, `direction` (`INCREASE` 또는 `DECREASE`), 문자열 `weight`, `normalized` (`{numerator, denominator, decimal}`), `contribution` (`{numerator, denominator, display}`) |
| `coverage`                       | `boundaryRegionCount`, `eligibleRegionCount`, `excludedRegions`의 `{regionCode, reasons}` 목록                                                                                                                                                                                                              |
| `boundaryBatch`, `sourceBatches` | 경계와 요청 지역의 `store`, `sales`, `footTraffic`별 `{batchId, publishedAt}`. 전체 비교 집단의 행별 출처는 스냅샷에 보존                                                                                                                                                                                   |
| `reproducibility`                | `snapshotSchemaVersion`, API 표시용 `inputSnapshotId` (`sha256:<hex>`), `policyApprovalId`, `coverageApprovalId`, `sourceVerificationId`                                                                                                                                                                    |
| `warnings`                       | `RELATIVE_REFERENCE_ONLY`, `SOURCE_INTERPRETATION_LIMITED`, `COMPENSATION_ALLOWED`를 고정 안내로 제공. UI는 추정매출 기간, 인구와 고유 고객의 차이, 점포 기록의 한계를 설명                                                                                                                                 |

예를 들어 가상 ‘라’의 점수는 `{"numerator":"65","denominator":"1","display":"65.00"}`, `rank="1"`, `tieCount=1`입니다. 매출 항목의 정규화는 `3/4`(`decimal="0.750000000000"`), 기여는 `45/2`(`display="22.50"`)입니다.

`NOT_CALCULABLE`은 `data=null`을 반환하며 부분 기여·순위는 제공하지 않는 안입니다. 원천 행 부재는 해당 입력과 출처를 NULL로, 행이 있는 측정값 NULL은 해당 입력만 NULL로 표시합니다. 승인 미충족은 `503 DATA_NOT_READY`를 반환하는 조건입니다. 기존 통계의 `200, data:null` 및 지원 범위는 독립적으로 유지합니다.

## 5. 입력 스냅샷·재현·검증 도구

구·동별 전체 입력을 메모리에서 봉인하고 정규 JSON으로 인코딩한 뒤 DB 없이 검증·재현합니다. 코어는 DB·파일·HTTP·Spring Context에서 독립적이며 일반 Service 호출에서 자동 실행하지 않습니다. 2026-11-02의 실제 입력 보존과 R03 범위는 9절에 정리합니다.

### 입력 스냅샷 스키마

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

`BatchMetadata`의 JSON 필드는 `batchId`, `datasetCode`, `sourceType`, `scopeType`, `scopeCode`, `periodFrom`, `periodTo`, `sourceChecksum`, `etlVersion`, `status`, `startedAt`, `finishedAt`, `publishedAt`입니다. 원천 경로·`source_reference`·`error_message`·인증정보는 넣지 않습니다. 원본 숫자 문자열의 소수 자릿수를 유지하므로 `1.0`과 `1.00`은 계산상 동률이어도 입력 해시는 다릅니다.

`input`의 키는 `unit`, `quarterCode`, `industryCode`, `boundary`, `boundaryRowsPresent`, `readiness`, `regions`입니다. 준비 상태는 `stores`, `sales`, `footTraffic` 각각의 불리언입니다. 지역 식별에는 `regionCode`, `regionName`, `districtCode`, `districtName`을 씁니다. `coverage`는 `boundaryRegionCount`, `eligibleRegionCount`, `excludedRegionCount`를 기록합니다.

`expected`는 `eligibleCount`, `excluded`, `reasons`, `scores`를 가집니다. 각 점수 행에는 `regionCode`, 네 지표의 `components` (`normalized`·`contribution`), `score`, `averageRank`, `tieCount`가 있습니다. 점수·평균 순위·정규화·기여는 `{numerator, denominator}`로 보존합니다. 후보 정책의 모든 키와 값은 `ScoreSnapshotArtifact.candidatePolicy()`에서 확인할 수 있습니다. [입력 모델](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreInputSnapshot.java) · [스냅샷 모델과 정책 맵](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreSnapshotArtifact.java)

전체 경계 코드와 입력 행의 코드가 정확히 같아야 하고, 완비·제외 목록은 중복·누락 없이 전체 경계를 분할해야 합니다. 실제 행 참조와 배치 목록도 같아야 합니다. 기대 목록·제외 사유를 재계산하므로 한 지역만 빼거나 제외를 숨기면 해시를 다시 만들어도 거부합니다.

단, 호출자가 전체 경계 목록과 행·기대 결과를 **함께 축소**하면 파일만으로 ‘진짜 서울 전체’를 증명할 수 없습니다. 생성 시 동일 Repository 스냅샷의 전체 경계를 사용하고 후속 독립 승인 목록과 대조해야 합니다. 25구·421동을 영구 상수로 두지 않습니다. 경계·데이터셋 미준비는 봉인하지 않으며 n≤1·필수 지표 전체 동일은 점수 대신 기존 내부 보류 사유를 재현합니다.

### 정규 JSON과 SHA-256 R01

1. 지역·완비·제외 코드는 Unicode 코드 포인트 오름차순, 배치는 UUID 문자열 오름차순입니다. 사유는 `ReasonCode` 선언 순서 뒤 지표 선언 순서입니다. 중복 목록은 거부합니다.
2. 모든 객체 키는 로케일과 무관한 Unicode 코드 포인트순입니다. UTF-16 코드 유닛과 순서가 다른 보충 문자도 포함합니다.
3. UTF-8, BOM·불필요한 공백·끝 개행 없음. 비ASCII와 `/`는 그대로 쓰며 따옴표·역슬래시는 이스케이프합니다. 제어문자는 `\b`·`\f`·`\n`·`\r`·`\t` 우선, 나머지는 소문자 4자리 `\u`입니다. 잘못된 UTF-8·짝 없는 surrogate는 거부합니다.
4. UUID는 소문자, 시각은 UTC ISO-8601 `Z`이며 불필요한 소수 초 끝 0과 정수 초 소수부를 생략합니다. `09:00:00.100+09:00` → `00:00:00.1Z`입니다.
5. 원본 숫자와 분수 분자/분모는 문자열, 집단 크기·동률 수는 JSON 정수입니다. 분수는 약분·양수 분모를 유지합니다.
6. **payload 전체 바이트**의 SHA-256이 `inputSnapshotId`입니다. 자기 해시·요청 시각·기대 결과·승인 메타데이터는 제외합니다. 승인 대상 목록의 내용은 payload에 있지만 승인 ID·담당자·근거 URL은 독립 manifest에 있습니다.

`decode`는 중복 키·누락·알 수 없는 필드·잘못된 버전/타입·primitive NULL·손상·추가 JSON 값·해시 불일치를 거부합니다. 유효한 공백·키 순서는 정규화합니다. 기대 결과 변경은 입력 해시를 바꾸지 않을 수 있지만 **재현 대조가 실패하므로 거부**됩니다. 오류에 원본 입력·접속정보·예외 원문을 붙이지 않습니다.

Python 표준 `json`·`hashlib`로 독립 검산한 **합성 5지역** payload는 14,935바이트, 기대 SHA-256은 `c671ee9b6263f5ff92334f7cc2a5e522f5f84872fe0cda2d38c1f1db71759f95`입니다. 작은 JSON 벡터로 제어문자·한글·보충 문자 정렬과 해시도 확인했습니다. 실제 원본 fixture가 아닙니다.

비중·방향·예외·표시·지원 범위를 바꾸면 새 정책 버전으로 기록합니다. 출처 재게시만으로 수식 버전을 바꾸지는 않지만 입력 해시와 승인 연결은 재검토합니다. 버전에 v1이 들어간다고 채택되지는 않습니다.

### DB 없는 생성과 재현 R02

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

### 명시 실행 도구와 환경변수

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

### 외부 파일·권한·실패 복구

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

### 검증 명령과 종료값

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

### 오프라인 Trust 사전 진단

`scoreTrustPreflight`는 기존 Trust Record → manifest → 구·동 스냅샷 검증 흐름을 명시적으로 실행합니다. 파일 읽기에는 [외부 파일 규칙](#외부-파일권한실패-복구)의 `ScoreSnapshotFiles.read()`를 사용합니다. DB·웹 서버·실제 승인 발급·파일 저장을 수행하지 않고 제품 JAR·Service·Controller와 분리합니다. Gradle 자체의 빌드/캐시 산출물은 진단 입력·결과 파일과 별개입니다.

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

## 6. 원천 신뢰 검증

신뢰 검증은 **독립적으로 지정한 기준**에 Trust Record, manifest, 스냅샷의 바이트와 승인 주장을 결합합니다. 정규 JSON 기본 규칙은 R01을 공유합니다. 기대 해시와 근거 ID의 출처·최신성·보호 권한은 운영에서 별도로 확보해야 합니다. 결합 모델·Codec·검증기와 묶음 검증·안전 읽기는 `main`에 있어 제품 JAR에 포함되며 내부 진입점과 CLI가 공유합니다.

### 독립 manifest와 입력 결합 검증

| 클래스                                                                                                                 | 책임                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [ScoreApprovalManifest](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreApprovalManifest.java)                 | 불변 승인 주장, 구·동 전체 목록과 실제 배치 메타데이터 |
| [ScoreApprovalManifestCodec](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreApprovalManifestCodec.java)       | 엄격한 JSON 입출력과 별도 manifest SHA-256             |
| [ScoreApprovalManifestVerifier](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreApprovalManifestVerifier.java) | 실제 묶음 바이트·두 아티팩트·호출자 기대 근거 ID 대조  |

#### 독립 manifest 스키마

`manifestSchemaVersion`은 `score-approval-manifest-v1`입니다. 현재 대상은 `20262`(2026년 2분기)·`CS100010`·`a-rank-v1-candidate.1`만 지원합니다. 이름에 v1이 포함돼도 정책 채택을 뜻하지 않습니다.

| 필드                                              | 내용                                                           |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `manifestSchemaVersion`                           | manifest 자체의 스키마 버전                                    |
| `quarterCode`, `industryCode`, `algorithmVersion` | 구·동에 공통인 입력 범위와 계산 버전                           |
| `policyVersion`, `policy`                         | 호출자가 지정하는 정책 버전 식별자와 정확한 정책 맵            |
| `district`, `dong`                                | 각각 아래 `CohortBinding`. 서로 바꾸거나 단위를 혼합할 수 없음 |
| `fileSha256`                                      | 보존 묶음 파일 전체 바이트의 소문자 SHA-256 64자리             |
| `policyApproval`                                  | 정책 승인 주장과 `policyApprovalId`에 해당하는 근거            |
| `sourceVerification`                              | 해당 원천 판본의 비교 가능성 근거 ID와 승인 주장               |
| `coverageApproval`                                | `coverageApprovalId`에 해당하는 커버리지 승인 주장             |

`CohortBinding`에는 `unit`, `inputSnapshotId`, `boundaryRegionCodes`, `eligibleRegionCodes`, `excludedRegions`, `batches`를 넣습니다. 전체 경계 코드는 비어 있을 수 없고, 완비·제외 목록은 중복·누락 없이 전체 경계를 분할해야 합니다. 제외 지역은 코드와 모든 지표별 사유를 보존합니다. 지역 수를 25·421로 고정하지 않습니다.

`batches`는 스냅샷이 참조한 경계와 통계 배치 전체입니다. UUID·데이터셋·원천 종류·범위·기간·체크섬·ETL 버전·상태·시작/종료/게시 시각을 기존 `BatchMetadata`대로 보존합니다. 이 스키마는 체크섬·ETL 버전 등 판본 식별 정보를 필수로 요구합니다. NULL을 허용하는 기간·범위 코드·종료/게시 시각도 JSON 키 자체는 있어야 합니다. 실제 입력의 행별 출처 연결은 기존 아티팩트 검증기로 확인합니다.

세 근거는 같은 `ApprovalEvidence` 구조를 사용합니다.

| 필드          | 규칙                                                        |
| ------------- | ----------------------------------------------------------- |
| `approvalId`  | 해당 역할의 근거 ID. 정책·원천·커버리지 기대 ID와 각각 대조 |
| `status`      | 작성자의 주장: `APPROVED`, `PENDING`, `REJECTED`            |
| `approvedAt`  | `APPROVED`일 때 필수. 나머지 상태에서는 NULL                |
| `reviewer`    | 공백·제어문자가 아닌 필수 담당자 식별 문자열                |
| `evidenceUrl` | 호스트가 있고 인증정보가 없는 절대 HTTP(S) URL              |

ID와 `policyVersion`은 영문·숫자로 시작하는 최대 128자의 영문·숫자·`.`·`_`·`:`·`-` 문자열입니다. URL은 방문하지 않으며 담당자의 자격·근거 문서의 존재나 진위를 확인하지 않습니다. `policyVersion`은 외부 기대값과 비교할 표식이며, 현재 입력에는 독립적인 정책 버전 필드가 없으므로 **정책 맵 전체를 입력과 추가로 대조**합니다. 버전 등록·정책 승인 체계가 구현된 것은 아닙니다.

#### 정규 JSON과 해시의 적용 범위

기존 `ScoreSnapshotCodec.canonicalJson()`·SHA-256을 재사용합니다. 객체 키는 Unicode 코드 포인트 순서, UTF-8, BOM·불필요한 공백·끝 개행 없음입니다. UUID는 소문자, 시각은 UTC `Z`와 불필요한 소수 초 끝 0 제거 규칙을 따릅니다. 지역·배치는 코드·UUID순, 제외 사유는 기존 사유·지표 선언 순서로 정렬합니다. 컬렉션은 방어적으로 복사하고 불변으로 반환합니다.

- **구·동 `inputSnapshotId`:** 기존 입력 payload의 정규 바이트 해시입니다. 승인 담당자·시각·ID·URL은 payload에 넣지 않으므로 manifest 변경으로 이 해시는 달라지지 않습니다.
- **`fileSha256`:** 전달받은 실제 묶음 파일의 전체 바이트 해시입니다. 아티팩트를 별도 매개변수로 받아 파일과 무관하게 검증하는 대신, 바로 그 바이트를 기존 `ScoreSnapshotBundle.decode()`로 해석·재현합니다.
- **manifest SHA-256:** manifest 전체 정규 바이트의 별도 해시입니다. manifest 안에는 자기 해시나 신뢰 기준 필드를 두지 않습니다. 공백·키/목록 순서만 다른 동등한 JSON은 같은 정규 해시를 갖습니다.

중복 키·알 수 없는 필드·누락된 키·잘못된 타입·숫자 enum·숫자 epoch 시각·지원하지 않는 버전·잘못된 UTF-8·BOM·JSON 뒤 추가 값·손상된 문자열을 거부합니다. 시각은 ISO 문자열 또는 허용된 NULL만 받으며, nullable 키 누락과 명시적 NULL을 구분합니다. 오류에는 입력·담당자·URL·원본 예외를 포함하지 않습니다.

#### manifest 결합 검증

`verify(manifestJson, bundleJson, expectedReferences, expectedManifestSha256)`은 다음 순서로 동작합니다. 파일을 읽거나 DB를 조회하지 않습니다.

1. manifest를 엄격하게 해석합니다. 호출자가 별도로 정한 `ExpectedReferences`는 필수입니다.
2. 묶음 파일을 기존 Codec으로 해석해 구·동의 입력 해시·전체 집단·행별 출처와 정확한 A 계산 결과를 재현합니다. 두 단위의 공통 경계·정책·분기·업종·조회 시각과 부모 구 연결도 기존 규칙으로 확인합니다.
3. 파일 전체 해시와 정책 버전·정책 승인 ID·원천 근거 ID·커버리지 승인 ID를 각각 대조합니다. 근거 상태가 `APPROVED`라는 주장까지 완비됐는지 검사하며, 미완성/거부 주장은 성공으로 처리하지 않습니다.
4. 각 단위의 입력 해시·정책 맵·전체 경계·완비·제외 코드와 사유·참조 배치 메타데이터를 정확히 대조합니다.
5. 외부 manifest 해시가 제공되면 형식과 정규 해시 일치를 검사합니다. 생략 시 `NOT_PROVIDED`, 일치 시 `MATCHED`로 기록합니다. 빈 값이나 불일치는 실패입니다.

재게시·원본값 또는 scale·출처 ID/체크섬/판본·경계·제외 목록/사유가 달라지면 과거 manifest와의 결합 검증은 실패합니다. 현재 입력을 과거 입력으로 자동 대체하지 않습니다. 한 항목만 맞는 부분 성공도 반환하지 않습니다.

현재 내부 진단에서는 외부 manifest 해시 생략을 허용합니다. 후속 공개 게이트에서는 이를 필수로 하고 보호된 Trust Record에서 공급하는 안을 권장합니다. 해시 대조 성공 자체를 공개 승인으로 바꾸지 않습니다.

### 독립 Trust Record와 이력 결합 검증

| 클래스                                                                                                       | 책임                                                 |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| [ScoreTrustRecord](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreTrustRecord.java)                 | manifest와 분리된 불변 기대값, 활성 상태와 철회 목록 |
| [ScoreTrustRecordCodec](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreTrustRecordCodec.java)       | 엄격한 JSON 해석, 정규 바이트와 별도 SHA-256         |
| [ScoreTrustRecordVerifier](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreTrustRecordVerifier.java) | 활성·철회·이력 검사 후 기존 manifest 검증기 연결     |

#### 신뢰 기록 스키마

대상은 `20262`(2026년 2분기)·카페 `CS100010`·A `a-rank-v1-candidate.1`입니다. 아래 필드는 nullable 필드도 JSON 키 자체가 반드시 있어야 합니다.

| 필드                                                               | 규칙                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `trustRecordSchemaVersion`                                         | `score-trust-record-v1`만 지원                                               |
| `revision`                                                         | 1부터 `9223372036854775807`까지의 JSON 정수. 문자열·소수·NULL·범위 초과 거부 |
| `activeReleaseId`                                                  | 대상 릴리스 식별자. `INACTIVE`에서만 명시적 NULL 허용                        |
| `releaseStatus`                                                    | `ACTIVE`, `INACTIVE`, `REVOKED`. 검증 성공 후보는 `ACTIVE`뿐                 |
| `quarterCode`, `industryCode`, `algorithmVersion`, `policyVersion` | 입력 범위와 계산·정책 판본. manifest와 대조                                  |
| `manifestSha256`                                                   | 승인 대상으로 지목한 manifest의 **정규 바이트** SHA-256. 소문자 64자리       |
| `policyApprovalId`, `sourceVerificationId`, `coverageApprovalId`   | 역할별 기대 근거 ID. manifest의 해당 역할 `approvalId`와 정확히 대조         |
| `revocations`                                                      | 철회 목록. 없으면 빈 배열이며 NULL·키 누락은 거부                            |

릴리스·정책 버전·근거 ID는 기존 manifest와 동일하게 영문·숫자로 시작하는 최대 128자의 영문·숫자·`.`·`_`·`:`·`-` 식별자입니다. 릴리스 ID는 입력 해시나 승인 ID를 대신하지 않습니다.

##### 철회 항목

각 항목은 `{target, targetId, reason, revokedAt}`입니다. `target`은 `RELEASE`, `POLICY_APPROVAL`, `SOURCE_VERIFICATION`, `COVERAGE_APPROVAL` 중 하나입니다. 같은 문자열 ID라도 역할이 다르면 별도 대상입니다.

- `targetId`는 해당 대상의 식별자입니다. `reason`은 앞뒤 공백·제어문자가 없는 비어 있지 않은 문자열입니다.
- `revokedAt`은 필수 ISO-8601 오프셋 시각이며 UTC로 정규화합니다. 시각의 숫자 epoch 표현은 거부합니다.
- 같은 대상 종류·ID의 중복 철회는 거부합니다. 사유나 시각을 덮어쓰는 수정 기능은 없습니다.
- 릴리스 상태가 `REVOKED`이면 그 릴리스의 철회 항목이 필요합니다. `ACTIVE`이더라도 자기 릴리스나 세 기대 승인 ID가 철회 목록에 있으면 검증을 거부합니다.

`ACTIVE`는 이 기록의 활성 주장일 뿐 공개 승인 상태가 아닙니다. 정책·원천·커버리지의 `PENDING`·`REJECTED` 주장은 기존 manifest 검증기가 거부합니다. 이번 스키마는 manifest v1에 `REVOKED`를 추가하지 않습니다.

#### Trust Record JSON과 해시

기존 [manifest 정규화 규칙](#정규-json과-해시의-적용-범위)을 따릅니다. 객체 키는 Unicode 코드 포인트순, UTF-8, BOM·불필요한 공백·끝 개행 없음입니다. 철회 목록은 대상 종류의 선언 순서와 대상 ID 코드 포인트순으로 정렬합니다. 시각은 UTC `Z` 표기이며 불필요한 소수 초 끝 0을 제거합니다.

중복 키·알 수 없는 필드·필수 키 누락·잘못된 타입·숫자 enum·잘못된 UTF-8·짝 없는 surrogate·뒤따르는 JSON 값·지원하지 않는 스키마를 거부합니다. 컬렉션은 방어적으로 복사하고 불변으로 반환합니다. 오류에는 원문·기대값·철회 사유·원본 예외를 넣지 않습니다.

`ScoreTrustRecordCodec.sha256()`은 신뢰 기록 전체의 정규 바이트를 식별합니다. **이 해시 자체는 승인이나 신뢰 기준의 진위 증거가 아닙니다.** 이 기록과 manifest는 입력 payload 밖에 있으므로 어느 쪽을 바꾸더라도 기존 구·동 `inputSnapshotId`는 바뀌지 않습니다.

#### 검증 호출과 기본 차단

호출은 다음 네 인수를 받습니다. 파일 경로·DB 연결 정보는 받지 않습니다.

```java
verifier.verify(
    trustRecordJson,
    manifestJson,
    bundleJson,
    independentlyTrustedPreviousRecord); // 없으면 null
```

1. 신뢰 기록을 엄격하게 해석하고 `ACTIVE`인지 확인합니다.
2. 현재 릴리스와 세 기대 승인 ID가 철회됐는지 확인합니다.
3. 이전 신뢰 기록이 제공되면 아래 이력 검사를 수행합니다.
4. 신뢰 기록의 분기·업종·알고리즘을 manifest와 대조합니다.
5. **신뢰 기록의** 정책 버전·세 기대 ID·정규 manifest SHA-256을 기존 `ScoreApprovalManifestVerifier`에 전달합니다. manifest나 입력에서 기대값을 생성하는 경로는 없습니다.
6. 기존 검증기가 묶음 파일 해시, 구·동 입력 해시, 정책 맵, 전체 경계·완비·제외 목록과 사유, 실제 배치 메타데이터, 정확한 계산 결과를 검사합니다. 일부만 일치하는 성공이나 과거 입력 폴백은 없습니다.

누락·손상·범위/버전/ID/해시 불일치, 비활성·철회, 이력 위반, manifest/입력 결합 실패는 모두 `IllegalArgumentException`으로 실패합니다. 성공 결과에는 리비전·활성 릴리스 ID·정규 manifest 해시와 이력 검사 여부만 남기며, 공개 승인 상태는 항상 `NOT_APPROVED`입니다.

##### 독립 이전 기록과의 이력 검사

`independentlyTrustedPreviousRecord`는 호출자가 **독립적으로 신뢰할 수 있는 이전 기록**이어야 합니다. 현재 manifest·입력·현재 신뢰 기록에서 복사한 값을 이전 기준처럼 전달하면 안 됩니다.

| 조건                                                                         | 결과                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 이전 기록 없음                                                               | 현재 결합만 진단. `revisionCheck=NOT_PROVIDED`. 과거 리비전 재사용 방지 보장 없음 |
| 현재 리비전 < 이전 리비전                                                    | 거부                                                                              |
| 같은 리비전·다른 내용                                                        | 거부. 같은 리비전은 정규화된 모델 내용이 정확히 같아야 함                         |
| 이전 철회 목록의 삭제·사유/시각 변경                                         | 거부. 이전 항목을 모두 그대로 포함해야 함                                         |
| 제공된 이전 기록과 같은 활성 릴리스 ID를 다른 manifest·정책·기대 ID로 재지정 | 새 리비전이라도 거부                                                              |
| 더 높은 리비전·새 릴리스·철회 이력 유지·모든 결합 일치                       | `revisionCheck=CHECKED`. 공개 승인은 여전히 불가                                  |

이전 철회 이력을 유지하므로 철회된 릴리스나 역할별 승인 ID를 다시 활성 대상으로 쓰면 거부됩니다. 이전 기록이 철회 정보를 갖고 있는데 현재 기록에서 이를 지워도 검사에 실패합니다. 반면 비철회 릴리스의 전체 ID→manifest 이력은 보존하지 않습니다. 중간에 다른 릴리스가 활성화된 뒤 과거의 비철회 ID를 다른 내용으로 재사용하는 상황까지 탐지하는 기능은 없습니다.

단, `CHECKED`는 **전달받은 이전 기록에 대한 검사**입니다. 이 코드에는 영구 단조 카운터·최신성 서버·신뢰 이력 저장소가 없습니다. 누락된 더 최신 기록, 양쪽에서 사라진 철회 이력, 보호된 설정 전체의 악의적 교체를 탐지했다고 주장하지 않습니다. 호출자는 알려진 철회 이력을 보존한 이전 기준의 출처·최신성·무결성을 별도로 확보해야 합니다.

### Backend 내부 신뢰 검증 진입점

[ScoreTrustVerification](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreTrustVerification.java)은 명시적으로 전달받은 `TrustBasis`와 `InputFiles`만 처리합니다. 생성자에는 제외 기준이 될 실제 저장소 루트를 전달합니다. 기존 안전 판독기는 그 루트의 `.git` 존재를 확인하므로 임의 경로로 대체하지 않습니다. 환경변수·Spring 설정·파일 존재를 보고 신뢰 기준을 구성하지 않으며 Spring Bean으로 자동 등록하지 않습니다. 파일·DB 쓰기, 점수 계산·공개 여부 결정도 하지 않습니다.

```java
var verifier = new ScoreTrustVerification(repositoryRoot);
var basis = new ScoreTrustVerification.TrustBasis(
    independentlyExpectedTrustSha256, independentlyExpectedPreviousSha256, minimumRevision);
var files = new ScoreTrustVerification.InputFiles(
    trustRecordPath, manifestPath, snapshotBundlePath, previousRecordPath);
var result = verifier.verify(basis, files); // BINDING_VERIFIED는 결합 진단이다.
```

`TrustBasis(expectedTrustSha256, previousExpectedSha256, minimumRevision)`의 현재 해시는 필수입니다. 이전 기록 경로와 이전 기대 해시는 함께 지정하고, 최소 리비전은 선택적인 양의 정수입니다. 기대값의 진위는 파일에서 추론하지 않습니다. 이전 기록이 없으면 `historyCheck=NOT_PROVIDED`, 최소 리비전만 제공하면 `REVISION_FLOOR_ONLY`, 독립 해시와 이전 기록을 검증한 경우에만 `CHECKED`입니다. 리비전 하한만으로 동일 리비전 변조·철회 이력 보존을 검사했다고 주장하지 않습니다.

| 내부 결과 `status`               | 의미                                                                    |
| -------------------------------- | ----------------------------------------------------------------------- |
| `TRUST_BASIS_MISSING`            | 기준·입력·저장소 설정 누락/형식 오류. 파일 읽기 전 거부                 |
| `FILE_OR_INTEGRITY_FAILURE`      | 경로/권한/읽기/파일 안정성 또는 Trust Record 형식·독립 해시 실패        |
| `REVOCATION_OR_REVISION_FAILURE` | 비활성·철회, 최소 리비전 미달, 기존 이력 검사 위반                      |
| `BINDING_FAILURE`                | 기존 manifest·묶음 형식/해시/재현/범위/근거 ID/정책/제외 목록 결합 실패 |
| `BINDING_VERIFIED`               | 이번에 읽은 파일과 지정 기준에 대한 결합 진단 완료. 공개 승인 아님      |

기존 `ScoreTrustRecordVerifier`는 거부 규칙과 예외 메시지를 유지하고 실패 단계만 타입으로 구분합니다. CLI도 같은 내부 진입점을 사용하므로 별도 검증 체계를 추가하지 않습니다. 결과에는 경로·JSON·근거 ID·원본 예외가 없고, 모든 상태에서 `publicationState=NOT_APPROVED`, `sourceTrust=NOT_ESTABLISHED`, `r03Complete=false`입니다.

결과는 읽은 바이트에만 해당하며 재사용 가능한 공개 허용 토큰이 아닙니다. 각 호출은 캐시 없이 읽고 성공 직전에 재대조하지만, 여러 파일의 원자적 스냅샷·종료 후 변경/철회의 즉시 전파·전역 리비전 단조성은 보장하지 않습니다. 이전 기준 전체를 함께 교체한 공격이나 누락된 더 최신 기록도 탐지하지 못합니다. 영구 신뢰 저장소 대신 메모리 변수를 두지 않았고, 실제 배포 신뢰 공급·현재 DB 대조의 공개 경로 연결·운영 공개 게이트는 여전히 후속입니다.

### 현재 DB 전체 입력 대조

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

### 독립 신뢰 기준 공급과 변경 차단

[ScoreTrustBasisProvider](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreTrustBasisProvider.java)는 인수 없는 읽기 전용 `read()` 하나만 제공합니다. 반환하는 불변 `Snapshot`의 의미는 다음과 같습니다. 실제 운영 구현·보호 경로·계정·자동 설정은 추가하지 않았습니다.

| 필드                               | 공급자 책임과 조건                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `changeId`                         | 일관된 기준 판본의 식별자. 내용 변경·되돌림 때 새 식별자를 사용하고 재사용하지 않음    |
| `activeReleaseId`, `releaseStatus` | 독립적으로 정한 활성 릴리스와 상태. 검증을 진행할 수 있는 주장은 `ACTIVE`뿐            |
| `expectedTrustSha256`              | 현재 파일에서 자동 생성하지 않는 독립 정규 Trust Record SHA-256. 소문자 64자리         |
| `minimumRevision`                  | 독립적으로 확보한 양의 리비전 하한. 이 컴포넌트의 메모리 최댓값으로 대체하지 않음      |
| `previous`                         | 선택: 독립 `ScoreTrustRecord` 모델과 그 정규 기대 해시. 알려진 철회 이력도 그대로 포함 |

식별자는 기존 manifest 식별자 규칙을 사용합니다. `previous`가 있으면 모델·해시가 모두 필수입니다. 공급자는 각 조회를 원자적으로 일관된 하나의 기준으로 구성하고 진위·최신성·과거 기준/철회 보존을 책임져야 합니다. 인터페이스 구현체를 주입했다는 사실, `ACTIVE` 문자열과 올바른 해시만으로 그 책임이 검증되지는 않습니다. HTTP 요청·사용자 헤더·일반 환경변수의 승인 주장을 공급원으로 삼지 않습니다. 제품에는 그런 자동 공급자나 가짜 운영 승인 파일이 없습니다.

[ScoreTrustStateVerification](../backend/src/main/java/kr/ac/recycleyoungs/score/ScoreTrustStateVerification.java)은 신뢰할 애플리케이션 구성에서 공급자와 기존 `ScoreTrustVerification`을 명시적으로 주입받습니다.

```java
var diagnostic = new ScoreTrustStateVerification(
    independentProvider, new ScoreTrustVerification(repositoryRoot));
var result = diagnostic.verify(currentInputFiles); // previousRecord 경로는 null
// DB 대조까지 같은 시작/종료 확인에 포함할 때는 위 호출 대신 아래 메서드를 사용한다.
// diagnostic.verifyCurrentInputs(currentInputFiles, currentInputVerifier);
```

1. 공급자·검증기가 없거나 시작 기준이 불완전하면 기본 거부합니다. 시작 조회 오류·null을 이전 기준으로 대체하지 않습니다. 공급 기준이 비활성·철회이면 파일 검증 전에 차단합니다.
2. 공급자의 해시·리비전 하한·활성 ID를 기존 `TrustBasis`로 전달합니다. 기존 세 인수 생성자는 유지하며 선택적 `expectedActiveReleaseId`만 추가했습니다. 기대 활성 ID가 다르면 `ScoreTrustVerification`은 `TRUST_BASIS_MISMATCH`를 반환합니다.
3. 공급자가 이전 모델을 주면 새 `inspect(basis, files, previousRecord)` 오버로드가 기존 Codec으로 독립 해시를 대조하고 `ScoreTrustRecordVerifier`의 이력 검사를 재사용합니다. 별도 철회/이력 규칙을 복제하지 않습니다. 이 경로는 호출자의 `InputFiles.previousRecord` 파일 경로를 거부해 기준을 바꿔 끼울 수 없게 합니다. 기존 CLI의 이전 파일·해시 방식은 유지합니다.
4. `verifyCurrentInputs()`를 명시적으로 호출하면 결합 성공의 같은 불변 참조를 기존 DB 대조기에 전달합니다. `MATCHED`와 참조 파일 해시가 모두 맞아야 이 단계가 완료됩니다. 일반 `verify()`는 DB를 조회하지 않습니다.
5. 완전한 활성 시작 기준으로 검증을 진행했다면 중간 실패도 포함해 종료 시 공급자를 다시 읽습니다. `changeId`뿐 아니라 활성 ID·상태·기대 해시·최소 리비전·이전 모델/해시 전체가 같아야 합니다. 변경·불완전·종료 조회 오류이면 중간 결합/DB 성공을 폐기합니다.

| 결과 `status`                                  | 의미                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `TRUST_BASIS_MISSING`                          | 공급자/검증기/입력/필수 기준 미설정·불완전, 호출자 이전 파일 경로 사용                |
| `TRUST_BASIS_UNAVAILABLE`                      | 시작 공급자 조회 오류                                                                 |
| `TRUST_BASIS_MISMATCH`                         | 활성 릴리스 또는 현재/이전 독립 pin·기록 대조 실패                                    |
| `REVOCATION_OR_REVISION_FAILURE`               | 비활성·철회·리비전 하한·기존 이력 검증 위반                                           |
| `TRUST_BASIS_CHANGED`                          | 종료 시 기준 변경·불완전·조회 오류. 중간 실패 사유보다 우선하며 성공 결과 재사용 없음 |
| `FILE_OR_INTEGRITY_FAILURE`, `BINDING_FAILURE` | 기존 안전 읽기 또는 manifest/스냅샷 결합 실패                                         |
| `CURRENT_INPUT_FAILURE`                        | 명시 DB 대조 미일치/오류 또는 다른 기준 파일에 대한 결과                              |
| `VERIFIED`                                     | 요청한 진단이 완료되고 양 끝의 공급 기준이 같음. 공개 허용 아님                       |

결과는 상태·이력 검사 범위·선택적 `currentInputStatus`만 담고 원본 기준·승인 ID·해시·경로·예외를 출력하지 않습니다. DB 미요청/미실행 또는 변경으로 무효화된 경우 `currentInputStatus`는 null이며 이를 DB 일치로 해석하지 않습니다. 이전 모델이 없으면 최소 리비전 검사만의 `REVISION_FLOOR_ONLY`, 독립 이전 모델의 이력 비교까지 통과하면 `CHECKED`입니다. 실제 원천 신뢰·공개 승인은 계속 `NOT_ESTABLISHED`·`NOT_APPROVED`, `R03_COMPLETE=false`입니다.

이 검사는 관찰한 양 끝 사이의 제한된 진단입니다. 중간 변경 후 원래 내용으로 돌아오는 경우에는 공급자가 새 `changeId`를 보존해야 탐지할 수 있습니다. 공급자의 식별자/과거 기준 재사용, 누락된 더 최신 이력, 기준 저장소 전체의 악의적 교체를 독자적으로 탐지하지 못합니다. 영구 리비전 보호·종료 이후 즉시 철회 전파·다중 인스턴스 동기화·실제 승인과 REST 공개 게이트는 미구현입니다. [합성 공급자 테스트](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreTrustStateVerificationTests.java)의 성공은 운영 공급자나 공식 승인을 대신하지 않습니다.

## 7. 공개 승인 조건과 차단 정책

### 공식 원천 조사와 남은 비교 조건

2026-11-03 공식 조사의 ‘현재 판본’은 2026-11-02 20:56 KST에 보존한 후보 입력입니다. 아래 내용은 당시의 공개 설명과 관찰 범위입니다. 구 25개·동 425개 중 완비 25구·421동과 매출 누락 4동은 그 실행의 관찰값입니다. [초기 원천 조사](archive/score-source-verification.md) · [입력 보존 기록](archive/score-20262-snapshot-preservation.md)

#### 분기·매출·업종

- **공식 기재 확인:** [제공정보 PDF 1쪽](https://golmok.seoul.go.kr/images/seoul_info.pdf#page=1)은 분기 제공과 2분기 4~6월을 설명합니다. 그러나 제공 주기만으로 `THSMON_SELNG_AMT`가 3개월 합계인지 월평균인지 결정할 수는 없습니다. PDF의 2019년 이후 제공 안내와 달리, [구 매출](https://data.seoul.go.kr/dataList/OA-22176/S/1/datasetView.do)·[동 매출](https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do)의 날짜가 명시된 공지는 2026-07-03부터 2021년 이후 자료를 제공한다고 안내합니다. 일반 소개를 현재 판본의 명세로 대신하지 않습니다.
- **2026-11-03 추가 확인한 일반 설명:** [상권 매출 OA-15572의 FAQ](https://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do)는 분기당 매출에 개인·법인 금액을 포함하며 성·연령 합계와 차이가 날 수 있다고 설명합니다. 이는 **상권 자료**의 설명입니다. 구·동 OA-22176/22175 및 현재 CSV의 `THSMON_SELNG_AMT` 기간을 확정하거나 기존 값을 3배/3분의 1로 환산할 근거로 사용하지 않습니다.
- **별도 지역 사례:** 동대문 상권 분석 자료는 ‘당월 매출액’을 분기 월평균으로 설명합니다. 현재 구·동 CSV에 같은 정의가 적용되는지 확인할 근거는 남아 있습니다. [서울시 배포 자료 8쪽](https://culture.seoul.go.kr/culture/cmmn/file/fileDown.do?atchFileId=af365d87d23c4c5b8411d3ba236292f6&bbsId=&fileSn=2&menuNo=200050#page=8)
- **2026-11-03 추가 확인한 업종 표기:** [공식 100대 업종 분류표 2쪽](https://golmok.seoul.go.kr/images/100_v3.pdf#page=2)은 `CS100010`을 ‘커피-음료’로 분류하고 커피 전문점의 예를 제시합니다. 프로젝트의 ‘카페’ 표기는 이 코드의 표시명입니다. 그 코드의 분류·사업체 포함 기준이 현재 매출·점포 CSV의 모든 지역에서 같다는 판본별 확인은 별도로 필요합니다.

#### 점포·폐업률

**일반 설명만 확인:** [제공정보 PDF 2쪽](https://golmok.seoul.go.kr/images/seoul_info.pdf#page=2)은 운영 및 당기 폐업 점포를 포함하는 점포 개념과 당기 폐업 신고 사업체를 전체 점포로 나누는 비율을 설명합니다. [구 점포](https://data.seoul.go.kr/dataList/OA-22173/S/1/datasetView.do)·[동 점포](https://data.seoul.go.kr/dataList/OA-22172/A/1/datasetView.do)는 전체 점포가 일반 점포와 프랜차이즈의 합임을 안내합니다.

**현재 판본 미연결:** 이 설명만으로 `CLSBIZ_RT`의 실제 분모가 어느 컬럼인지, ‘당기’가 정확히 어떤 기간인지, 기준일·사업체 중복·반올림·분모 0을 어떻게 처리했는지는 확정할 수 없습니다. 원천 폐업률을 재계산하거나 0·100%로 보정하지 않습니다.

#### 길단위인구·원천 산정 기준

OA-22178은 행정동 생활인구 자료로 안내됩니다. [행정동 길단위인구 안내](https://data.seoul.go.kr/dataList/OA-22178/A/1/datasetView.do)

**일반 설명만 확인:** [데이터 출처](https://golmok.seoul.go.kr/source.do)의 2026-08-18 표는 점포·추정매출·생활인구·길단위인구의 기준시점을 2026년 6월로 제시합니다. 같은 표의 카드 원천은 BC·KB가 3월, SH가 6월입니다. 생활인구를 50×50 격자와 집객시설 등을 거쳐 길에 배분하는 설명도 있습니다. 이 시점 표시는 우리 CSV의 전체 기간·실제 투입 카드 조합·지역별 동일 산정의 증거는 아닙니다.

[제공정보 PDF 4쪽](https://golmok.seoul.go.kr/images/seoul_info.pdf#page=4)의 10m 길 단위 설명과 50×50 격자는 서로 다른 생성 단계의 공간 단위입니다. 이를 모순이라고 단정하거나 격자 크기·도로 길이로 값을 나누지 않습니다. `TOT_FLPOP_CO`의 시간 합/평균, 고유 인원 중복 제거, 경계에 걸친 길의 배분, 내·외국인 포함 범위는 현재 판본에서 미확인입니다.

또한 [서비스 소개](https://golmok.seoul.go.kr/introduce.do)와 [제공정보 안내](https://golmok.seoul.go.kr/policy/sectorAnalysis.do)는 매출 카드 원천과 보정 설명이 일치하지 않는 부분이 있습니다. 이를 하나의 산식으로 합치지 않고 적용 판본을 문의합니다.

**2026-11-03 추가 확인한 원천 변경 공지:** [생활인구·생활이동 개편 공지](https://data.seoul.go.kr/together/notice/boardView.do?seq=721010a1522630fbf7a78d381a8326ee)는 2026-07-31 이후 메뉴 개편, 250m 격자 기반 구·동 자료의 재생산과 기존 자료의 아카이브 보존을 안내합니다. 이는 생활인구 원천 서비스의 공지이며 **상권분석 OA-22178/22179의 `20262`가 새 방식으로 재산출됐다는 근거는 아닙니다.** 현재 길단위 CSV에 어느 원천·배분 판본이 적용됐는지 확인할 질문이 추가됐습니다.

#### 공간 경계·누락 4동

**2026-11-03 추가 확인한 공식 영역 안내:** [행정동 OA-22160](https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do)·[자치구 OA-22161](https://data.seoul.go.kr/dataList/OA-22161/S/1/datasetView.do)은 주민등록 행정기관코드와 EPSG:5181을 안내합니다. 열람된 ZIP 목록의 수정일은 2023-10-31이고 페이지 데이터 갱신일은 2026-09-11입니다. 어느 날짜도 `20262`의 실제 경계 기준일이나 우리 경계 ZIP과의 동일성을 입증하지 않습니다. 파일이 오래돼 잘못됐다고 단정하지도 않습니다.

통계 페이지의 2024년 표준단위구역 전환 공지 역시 현재 구·동 통계와 표시 폴리곤의 연결표·유효 기간을 대신하지 못합니다. 코드 일치와 좌표계 변환 성공만으로 실제 공간 집계가 같다고 판단하지 않습니다.

[공식 구·동 코드표](https://golmok.seoul.go.kr/images/adstrd_code.pdf)에는 면목5동 `11260550`, 하계2동 `11350612`, 북가좌1동 `11410710`, 개포1동 `11680660`이 있습니다. **이 표에는 네 동의 카페 매출 행 부재 사유가 설명돼 있지 않습니다.** 확인한 공식 안내와 제한 검색에서도 원인을 특정하지 못했습니다. 0매출·소수 점포 비공개·재개발·추정 불가·추출 오류 중 어느 것도 원인으로 채택하지 않습니다.

#### 2026-11-05 후속 대조

조회일의 공식 Sheet CSV 6종과 OA-22160 ZIP의 응답 바이트가 로컬 원본과 일치했고, 두 분기의 채택 필드와 실제 게시 출처 2,692행을 읽기 전용 DB로 대조해 차이 0건을 확인했습니다. 누락 4동은 조회일 공식 CSV에도 없었습니다. 경계 배치의 `07c8…`은 SHP·DBF·PRJ·CPG 결합 체크섬이며 ZIP 전체의 `969f…`과 구분합니다. 공식 출력과의 파일 대응 이후에도 원천 릴리스와 적용 산식·경계 기준은 미확인입니다. 이번 대조 범위는 기존 원본·DB였으며 과거 12:17 fixture 및 20:56 보존 묶음은 범위 밖이었습니다. [공식 원천 후속 검증표](archive/official-source-verification-20261-20262.md) · [전분기 비교 검증](archive/quarter-comparison-verification.md)

### 공개에 필요한 원천 근거

다음은 이 문서의 승인 책임·신뢰 기준에 따른 **공개 전 확인 조건**입니다. 모든 비공개 보정계수를 복원하자는 요구가 아니라, 각 비교 집단 안에서 같은 의미의 값을 비교할 수 있는지 확인하자는 것입니다.

| 필수 조건                    | 아직 부족한 근거                                                                            | 해소 기준                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 입력 판본 식별               | 현재 공식 출력과 로컬 바이트 대응은 확인. 원천 생성·고정 릴리스·적용 명세와의 연결은 미확인 | 파일/추출 버전·생성 시점·적용 분기 또는 제공기관의 대응 확인. 체크섬만 맞는다고 의미까지 승인하지 않음 |
| 같은 단위 안의 동일 기준     | 매출 기간·업종 포함 범위, 폐업률 기간·분모 규칙, 인구 집계·배분 방식이 지역마다 같은지      | 구 집단·동 집단 각각에서 공통 적용 범위와 예외 확인. 구/동 간 점수를 직접 비교하지 않음                |
| 통계와 표시 경계의 대응      | `20262`의 코드·소속·영역 적용 시점과 앱의 보존 경계 관계                                    | 공식 경계 판본·유효 기간·연결 규칙 확인. 최신 코드나 게시 이력만으로 대체하지 않음                     |
| 원천 변경·재배포의 적용 범위 | 카드/생활인구 변경과 과거 분기 재생산이 해당 CSV에 적용됐는지                               | 변경 이력과 실제 사용 판본의 적용 여부 확인. 달라졌다면 별도 입력·커버리지 검토                        |

이 조건은 사용자의 ‘한계를 수용한다’는 선언이나 정상 `PUBLISHED`·해시·재현 성공으로 대신할 수 없습니다. 현재 원천 비교 가능성 승인에 충분한 근거는 확보하지 못했습니다.

### 조건부로 수용할 수 있는 해석상 한계

**위의 필수 조건이 해소되고 별도 정책·커버리지 승인을 받은 뒤에만 검토할 수 있는 안**입니다. 이번에 수용·채택한 정책이 아닙니다.

| 남은 한계                        | 잠정 제공을 검토할 수 있는 범위                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 매출의 정확한 환산·세부 보정계수 | 지역별 동일 기간·적용 규칙이 확인된 원천값의 상대 순위만 사용. 월매출·실수익·절대 하한을 제공하거나 임의 환산하지 않음                                                           |
| 매출·점포 모집단의 완전한 일치   | A의 별개 규모 지표로 한정하고 차이를 안내. 실제 점포당 매출·효율을 뜻하는 B·C 해석으로 확대하지 않음                                                                             |
| 인구 중복·상세 배분 계수         | 같은 기준의 원천 규모로 한정. 고유 통행자·카페 고객 수라고 설명하지 않음. 지역별 방식 혼재는 수용 가능한 한계가 아니라 필수 조건 위반                                            |
| 폐업률의 상세 반올림 등          | 기간·분모 규칙의 지역별 일관성이 먼저 확인된 원천 비율을 그대로 사용. 창업 실패 확률로 설명하거나 재산정하지 않음                                                                |
| 누락 4동의 상세 사유             | 사용 파일과 공식 제공 범위의 대응 및 제외 목록이 확인된 뒤 원인 미확인을 명시할지 결정. 결측은 0이 아니며 제외 이유·지역을 공개. 원인이 집단 전반의 기준 혼재를 뜻하면 공개 보류 |
| 과거 분기·실제 창업 성과         | 단일 분기 상대 참고값으로 제한. 시계열 안정성·성공 확률 검증을 주장하지 않음                                                                                                     |

### 승인 책임과 독립 기준 운영안

#### 역할별 판단과 기록

| 역할             | 승인·수행할 내용                                                               | 남길 근거                                                      |
| ---------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 정책 검토자      | 평가 목적, 점포 방향, 비중, 보상·결측·동일값·표시 규칙을 한 정책 버전으로 판단 | 정책 승인 ID, 정확한 정책 맵·버전, 선택 이유·수용한 한계       |
| 원천 판본 검토자 | 실제 사용할 분기·공간·업종의 비교 가능성을 확인                                | 원천 근거 ID, 공식 자료·답변의 적용 판본, 배치·체크섬과의 연결 |
| 커버리지 검토자  | 구·동별 전체 경계·완비·제외 코드와 모든 사유를 검토                            | 커버리지 승인 ID, 전체 목록, 누락·부적격 출처의 처리 이유      |
| 배포 담당자      | 검토 완료 묶음과 manifest를 식별하고 독립 기대값을 배포                        | 릴리스 식별자, 세 근거 ID, 해시, 검증·배포 기록                |
| 철회 담당자      | 오류·근거 변경·침해 의심 시 점수 공개를 우선 중단                              | 철회 대상·사유·시각, 차단 적용 확인, 복구 검토 기록            |

**권장 절차:** 개인 개발자가 모두 맡아도 역할별 검토를 별도 기록으로 남깁니다. 같은 사람을 여러 승인자로 꾸미지 않습니다. 작성·계산 검증 뒤 체크리스트를 다시 읽는 검토 단계와 배포 단계를 분리합니다. 이는 실수 예방 절차이지 독립적인 제3자 심사가 아닙니다.

각 결정 기록에는 역할, 근거 ID, 대상 분기·업종·정책/알고리즘 버전, 검토 일시·검토자, 상태·사유, 근거 URL과 문서 판본을 남깁니다. 승인 시각은 별도로 기록하며 UTC ISO-8601을 권장합니다. 정책·원천·커버리지 ID는 manifest의 각 `approvalId`와 역할별로 연결합니다. 이 문서에서는 실제 ID를 발급하지 않습니다.

근거 URL만 적지 말고 검토한 문서의 버전 또는 내용 해시를 보존할 책임도 정합니다. Git 커밋 SHA는 코드·문서 판본 식별에 쓰되 승인이나 입력 해시를 대신하지 않습니다. 승인 범위나 판단을 바꾸면 새 결정 기록을 남기고 과거 기록은 덮어쓰지 않습니다.

#### 승인 상태 전이

| 상태       | 의미와 공개 판단                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `PENDING`  | 검토 중·필수 근거 미확보. 기본 상태이며 공개 불가                                                     |
| `APPROVED` | 명시한 범위의 판단을 책임자가 수용함. 다른 역할의 승인과 현재 유효성까지 모두 확인해야 공개 검토 가능 |
| `REJECTED` | 해당 요청·범위를 수용하지 않음. 사유를 보존하고 수정안은 새 검토 대상으로 제출                        |
| `REVOKED`  | 이전 승인 또는 릴리스의 효력을 철회함. 해시가 맞아도 공개 불가                                        |

`PENDING`에서 승인 또는 거부로 결정하고, 유효한 승인은 필요하면 철회합니다. 철회한 기록을 같은 ID로 다시 승인하지 않고 새 검토·릴리스로 처리하는 안을 권장합니다. 배포 담당자는 근거 부족을 대신 승인할 권한이 없으며, 철회 담당자는 긴급 차단을 먼저 할 수 있지만 차단 해제에는 다시 검토가 필요합니다.

동일인이 데이터·manifest·신뢰 기준까지 모두 바꿀 수 있으면 악의적인 변경이나 계정 탈취에 대한 독립성이 없습니다. 별도 파일·폴더 또는 검토 시간 차이만으로 이 한계를 해결했다고 주장하지 않습니다.

#### 고정 SHA-256과 전자서명 비교

| 방식                            | 장점                                                                 | 필요한 신뢰·운영 부담                                                                                          |
| ------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 별도 배포 설정의 SHA-256 고정값 | 현재 Codec의 정규 해시를 재사용하고 소규모 수동 배포에 적용하기 쉬움 | 누가 기대값을 정하고 바꾸는지 보호해야 함. 해시 자체는 비밀도 승인자 신원 증명도 아님                          |
| 전자서명과 신뢰 공개키          | 개인키로 서명한 내용과 서명 주체의 연결을 검증하는 기반              | 개인키 보호, 공개키의 신뢰 설정, 키 교체·폐기와 철회 절차 필요. 서명 성공만으로 현재 유효한 승인을 뜻하지 않음 |

해시는 내용을 고정 길이 값으로 대응시키며, 서명은 변경 탐지와 서명자 인증에 사용됩니다. 공개키는 대응 개인키로 만든 서명을 확인하는 데 사용됩니다. 기술적 구분은 [NIST 해시 정의](https://csrc.nist.gov/glossary/term/hash_function), [FIPS 186-5 설명](https://csrc.nist.gov/pubs/fips/186-5/final), [공개키 정의](https://csrc.nist.gov/glossary/term/public_key)를 확인했습니다(2026-11-02). 이 자료가 본 프로젝트의 승인이나 특정 운영안을 권고한 것은 아닙니다.

**MVP 권장안은 별도 권한의 배포 설정에 정규 manifest SHA-256을 고정하는 방식입니다.** 단일 운영자·제한된 배포라는 현재 규모에서 새 서명 키 관리보다 검토·배포 경계를 먼저 만드는 것이 현실적이라는 설계 판단입니다. 외부 배포처나 승인자가 늘면 서명 방식으로 전환할지 다시 결정합니다. 어느 방식도 원천 통계의 의미나 창업 적합성을 증명하지 않습니다.

#### 독립 보관·배포·복구

후속 구현에서는 하나의 **신뢰 기록**을 승인된 배포 설정으로 관리하는 안을 권장합니다. 여기에는 신뢰 기록 리비전, 현재 활성 릴리스, 대상 범위·알고리즘·정책 버전, 정규 manifest SHA-256, 정책·원천·커버리지 기대 ID와 현재 상태, 철회 기록의 연결을 둡니다. 묶음 파일 SHA-256과 구·동 입력 ID는 그 manifest에 고정된 값과 대조합니다.

6절의 순수 모델·Codec·검증기는 이 구조를 사용합니다. 스키마 구현은 운영안 채택이나 실제 기록 발급을 뜻하지 않으며 실제 경로·저장 서비스·배포 도구는 정하지 않았습니다. **신뢰의 시작점은 또 다른 자체 해시가 아니라 배포 설정을 변경할 수 있는 주체와 보호된 배포 경로**입니다.

| 단계      | 권장 권한과 금지 사항                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 발급      | 검토 담당자가 세 결정의 범위와 실제 manifest 바이트를 대조한 후 배포 담당자에게 기대값 전달. 도구 성공만으로 자동 등록 금지            |
| 보관      | 입력·manifest 생성 경로와 분리한 배포 설정 권한으로 관리. 애플리케이션 실행 계정은 읽기만 가능하고 파일과 부모 디렉터리 모두 수정 불가 |
| 배포      | 배포 담당자만 승인된 리비전을 설치. manifest·API 요청·DB·환경의 임의 기본값에서 기대 해시나 근거 ID를 자동 추출하지 않음               |
| 변경·철회 | 지정 책임자만 근거와 새 리비전을 남겨 변경. 현재 허용값을 바꾼 뒤 이전 승인 이력을 삭제하거나 조용히 되살리지 않음                     |
| 복구      | 보존본·신뢰 기록·철회 이력을 함께 복원·대조. 오래된 허용 목록만 복원해 철회를 취소하지 않음                                            |

실제 권한은 운영 계정 소유의 읽기 전용 배포 파일·읽기 전용 마운트 또는 이에 준하는 보호된 설정으로 확정해야 합니다. 동일 사용자가 두 파일을 쓸 수 있는 로컬 경로 분리만으로는 충족되지 않습니다. 해시는 공개돼도 되지만 변경 권한은 보호해야 합니다. 이 권한 모델을 마련하지 못하면 점수 공개는 계속 차단합니다.

manifest 안의 `APPROVED`·자체 선언 해시, 검증 도구 출력, GitHub에 올라온 승인 주장, 같은 파일에서 읽은 기대 ID는 독립 신뢰 기준이 아닙니다. 별도 URL에 파일을 올렸다는 사실만으로도 신뢰가 생기지 않습니다.

### 공개 차단과 철회

다음은 **후속 점수 공개 게이트의 권장 정책**입니다. 기존 통계 API는 영향받지 않습니다. 실패한 점수는 과거 스냅샷·다른 분기·다른 지역 집단·0점으로 대신하지 않습니다.

| 상황                                           | 공개 판단                             | 복구·재검토 조건                                                        |
| ---------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| 승인 manifest 없음·누락 필드·손상              | 차단                                  | 완전한 manifest와 별도 신뢰 기록을 검토·배포                            |
| 정책 또는 원천 판본 `PENDING`·`REJECTED`       | 차단                                  | 해당 역할의 범위·근거를 먼저 검토. 다른 승인으로 대체 불가              |
| 커버리지 미승인                                | 차단                                  | 전체 경계·완비·제외 코드와 모든 사유 승인                               |
| 신뢰 기준 미설정·근거 ID/버전/해시 불일치·변조 | 차단                                  | 권한 있는 담당자가 원인 확인. 현재 파일에서 기대값 자동 재생성 금지     |
| 경계·출처·원본값·scale 변경                    | 차단                                  | 새 입력을 보존·재현하고 판본·커버리지와 새 manifest 연결 재검토         |
| 제외 지역 추가·삭제 또는 사유 변경             | 차단                                  | 숫자 비율만 비교하지 않고 새 목록·사유로 커버리지 재검토                |
| 기존 역할 승인 또는 활성 릴리스 철회           | 차단                                  | 철회 원인 해소, 새 결정·릴리스 검토. 이전 해시 일치로 우회 불가         |
| 새 버전 게시 후 이전 버전 요청                 | 차단                                  | MVP는 활성 릴리스 하나만 제공. 과거 결과 조회는 별도 계약 전까지 미지원 |
| 보존 스냅샷·manifest·신뢰 기록 접근 실패       | 차단                                  | 접근·권한·파일 무결성 복구 후 재검증. 캐시·이전 파일로 진행 금지        |
| 응답 직전 신뢰 리비전·활성 상태 변경           | 차단                                  | 새 상태로 다시 검증. 변경 전 결과 공개 금지                             |
| 모든 신뢰·승인·현재 입력 결합 조건 충족        | 후속 게이트에서만 공개 여부 판단 가능 | 기존 집단·지역별 산출 가능 조건과 표시 계약도 별도로 충족               |

재게시 때 알고리즘 자체가 같으면 알고리즘 버전을 임의로 올릴 필요는 없습니다. 그러나 입력 해시·manifest 해시와 승인 연결은 다시 검토합니다. 변경 없는 정책 근거는 범위가 그대로임을 확인한 뒤 재사용할 수 있지만, 출처·커버리지 근거를 자동 승계하지 않습니다.

**철회 적용 권장 절차:** 점수 공개를 먼저 차단하고 진행 중인 점수 응답을 종료·차단한 뒤, 철회 사유·시각을 추가하고 새 신뢰 리비전을 배포합니다. 모든 실행 인스턴스에서 차단 적용을 확인한 후에만 작업 완료로 기록합니다. 이미 전달한 응답까지 취소할 수는 없습니다. 재개는 새 검토 후 별도 절차로 합니다.

MVP는 신뢰 기록을 요청마다 읽고 응답 전 리비전·활성 상태를 다시 확인하며, 승인 결과를 무기한 캐시하지 않는 안을 권장합니다. 복잡한 실시간 갱신 체계 대신 변경 중에는 공개를 막고 검증 후 전환합니다. 신뢰 기록의 원자적 교체와 전체 인스턴스 적용 확인은 후속 구현·운영 책임입니다.

과거 신뢰 기록의 재배포도 승인 변경으로 취급하고 리비전 퇴행을 허용하지 않습니다. 다만 보호된 배포 설정과 철회 이력을 함께 장악한 공격자나 운영자의 잘못된 복원까지 암호학적으로 막는 체계는 현재 없으며, 이 문서로 구현됐다고 주장하지 않습니다.

### 승인 게이트 연결 후 요청 순서

아래는 **후속 공개 게이트 연결 후의 목표 순서**입니다. 현재는 1단계 검증 직후 DB 조회 없이 503 `DATA_NOT_READY`를 반환합니다. 따라서 형식이 유효하면 미존재 지역 코드도 임시로 503이며, 최종 지역 미존재 404·데이터 준비 판단은 아직 연결하지 않았습니다.

1. Controller에서 문법·지원 분기·업종을 검증합니다. 사용자에게 비중·방향·비교 집단·승인 상태를 바꾸는 파라미터를 받지 않습니다.
2. Service의 한 읽기 전용 REPEATABLE_READ 트랜잭션에서 최신 경계와 요청 지역을 확인합니다. 경계 미준비는 503, 현행 지역 미존재는 404가 우선입니다.
3. 해당 단위의 점포·매출·인구 데이터셋 각각에 적격 출처를 참조하는 실제 통계 행이 있는지 확인합니다. 하나라도 전혀 없으면 503입니다. 현재 코드와 같이 데이터셋 전체 준비와 특정 분기·업종 행 부재를 구분합니다.
4. 서울 전체의 해당 단위 입력과 실제 배치 메타데이터를 일괄 조회합니다. 경계·세 통계·집단을 서로 다른 요청·트랜잭션에서 가져오지 않습니다.
5. 정책 승인 및 현재 입력 판본의 의미·경계 비교 가능성 승인을 확인합니다. 승인 근거가 없거나 승인한 입력 스냅샷과 다르면 503 `DATA_NOT_READY`로 공개 계산을 막습니다. 정상 게시 검증으로 이 승인을 대신하지 않습니다.
6. 지역별 검증 후 완비 목록·제외 사유를 만들고 승인된 커버리지 목록과 대조합니다. 집단 n≤1, 승인 목록 불일치, 필수 지표 전체 동일을 차례로 검사합니다. 실패 시 집단 전체가 산출 불가입니다. 여러 사유가 있으면 이 순서로 정렬해 모두 남깁니다.
7. 집단이 가능해도 요청 지역이 제외됐다면 그 지역은 산출 불가입니다. 정상 대상이면 네 입력 순위 → 방향 반전 → 비중 적용 → 정확한 A → 집단 전체 점수 순위 → 표시값 순으로 계산합니다.
8. 한 번 읽은 입력으로 설명·재현 식별자를 구성합니다. DB 트랜잭션 밖에서 계산하더라도 재조회하지 않고 검증한 불변 입력만 사용합니다. 이 설계의 계산 경로는 DB 쓰기·ETL·Flyway를 호출하지 않습니다.

승인 입력과 커버리지 근거는 200 산출 불가 응답에도 필요합니다. [승인 후 REST 응답 제안](#승인-후-rest-응답-제안)

### 제공기관 문의 초안과 미발송 상태

공식 페이지의 수신 부서는 **서울신용보증재단 데이터분석팀**, 공개 연락처는 `02-2174-5075`입니다. 공식 수신 이메일 주소는 미확보 상태이므로 발송 전 기관 창구에서 확인합니다. 이 문서에서는 실제 발송·문의 접수·승인을 수행하지 않았습니다.

#### 발송 전 확인

- 발신자·회신 주소와 공식 수신 창구를 확인합니다. 주소를 추측하지 않습니다.
- [후속 검증표](archive/official-source-verification-20261-20262.md#1-공식-데이터셋과-이번-조회-판본)의 조회일·폼 조건·파일명·정확한 해시를 문의에 동봉할지 확인합니다. 통계는 CSV 전체 바이트, 행정동 경계는 ZIP 전체 `969f…`와 ETL 구성 파일 결합 `07c8…`을 구별합니다. 개인 경로·인증정보·원본 전체·보존 점수 묶음은 첨부하지 않습니다.
- 아래 초안은 공식 출력과의 단순 동일성 질문을 줄이고 **미해결인 적용 명세·기간·공간 기준·행 부재 사유**만 묻도록 갱신했습니다. 답변도 해당 분기·업종·파일/추출 판본에 연결되지 않으면 일반 설명으로만 기록합니다.

---

**수신:** 서울신용보증재단 데이터분석팀 담당자님 — [공식 수신 이메일 확인 후 기입]

**제목:** [원천 명세 문의] 20261·20262 커피-음료 통계의 판본·기간·경계 기준 및 매출 행 부재

안녕하세요. 서울시 공공데이터를 활용한 카페 창업 참고 서비스 개발 중 원천의 적용 기준을 확인하고자 합니다. 현재 점수와 미검증 증감 수치는 공개하지 않고 있으며, 모델 승인이나 창업 성과 보증을 요청하는 문의는 아닙니다.

대상은 **20261·20262, 커피-음료 CS100010**의 구/동 점포(OA-22173/22172), 추정매출(OA-22176/22175), 업종 차원이 없는 길단위인구(OA-22179/22178), 영역(OA-22160/22161)입니다. 2026-11-05 공식 Sheet CSV 출력 6종과 OA-22160 첨부 ZIP이 사용 중인 로컬 파일과 바이트 단위로 일치함을 확인했습니다. 동 점포·매출은 공식 페이지의 기본 최근 기간 조건으로 출력했습니다.

가능하면 각 답변에 **공식 문서 URL·변경 이력·적용 분기/판본·지역별 예외**를 함께 안내 부탁드립니다.

1. **공식 판본·적용 기준:** 조회일의 CSV에 대응하는 고정 배포/추출 버전과 원천 생성·수정 이력을 확인할 수 있을까요? 2026-07-03 제공기간 변경 및 2024년 표준단위구역 전환이 두 분기에 어떻게 적용됐는지, CS100010의 포함 기준이 같은지 확인 부탁드립니다. 점포 정의와 `CLSBIZ_RT`의 분모 컬럼·기준 기간·반올림/분모 0 규칙을 명시한 적용 정의서도 요청드립니다.
2. **지역 코드·경계:** 두 분기의 코드·행정동 소속·공간 경계 기준일과 유효 기간, 변경 이력/연결표가 있을까요? OA-22160/22161 첨부 경계 및 표준단위구역에서 구/동으로 배분하는 규칙과의 관계를 확인 부탁드립니다.
3. **매출 기간·보정:** 구/동 CSV의 `THSMON_SELNG_AMT`는 각 분기에서 어느 기간의 어떤 합계·평균·시점 금액인가요? 서비스의 월평균 표시와 CSV의 관계, 적용 카드 원천·보정 방식의 연도/지역/두 분기 일관성 및 예외를 설명한 명세 URL을 부탁드립니다. 임의로 3을 곱하거나 나누지 않으려는 목적입니다.
4. **길단위인구 집계:** `TOT_FLPOP_CO`의 시간 합/평균·관측 중복·내외국인 범위와 길/격자→구/동 배분 기준은 무엇인가요? 두 분기의 동일 규칙 여부 및 2026-07-31 생활인구 개편이 해당 CSV의 원천·재산출에 적용됐는지 확인할 자료를 요청드립니다.
5. **카페 매출 행 부재:** 두 분기 모두 면목5동 `11260550`, 하계2동 `11350612`, 북가좌1동 `11410710`, 개포1동 `11680660`의 CS100010 매출 행이 조회일 공식 CSV에도 없습니다. 행 부재의 공식 원인·제공/추정/비공개 규칙이나 정정 이력이 있을까요? 현재는 이를 0매출로 대체하지 않습니다.

미확인 항목은 미확인으로 답변해 주셔도 좋습니다. 감사합니다.

[이름 / 회신 이메일]

---

이번 초안은 발송 전 검토용입니다. 실제 문의·회신 확보는 별도 사용자 결정 후 진행합니다.

## 8. 남은 설계 결정과 후속 작업

| 결정 영역      | 남은 판단                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 평가 목적·정책 | 단일 분기 참고 비교의 사용 범위, 점포 방향, 비중, 저매출 보상, 동일값 보류와 결측·예외, 표시 자릿수·경고의 공개 채택                                                       |
| 판본·집단      | 사용 판본의 같은 단위·분기·업종 비교 가능성, 최소 집단·정확한 전체 경계/완비/제외 목록과 승인 범위. 임의 90% 하한·관찰 건수 고정·가중치 재배분은 현재 후보에 포함하지 않음 |
| 운영 신뢰      | 각 역할의 승인 ID 발급과 독립 공급자·영구 리비전 하한, 실제 활성/철회 기록·인스턴스 적용·복구 책임                                                                         |
| REST와 화면    | 승인 후 200/404와 오류 사유, 집단·제외 설명, 보존본과 현재 DB가 일치할 때의 공개 게이트 구현                                                                               |
| 실데이터 재현  | 과거 12:17 전체 입력 fixture 미확보. 과거 R03 요구 처리와 승인된 전체 fixture로의 공개 전 검증은 별도 결정                                                                 |

### 조회 시 계산과 region_score 선택

| 방식                        | 장점                                                               | 한계·v1 판단                                                                                       |
| --------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 조회 시 집단 전체 계산      | 한 스냅샷의 원본·집단·설명 일치. 별도 점수 테이블·갱신 작업 불필요 | 반복 계산 비용이 있음. 실제 지연·부하 검증은 구현 후 필요. **우선 권장**                           |
| 사전 계산·region_score 저장 | 반복 조회 비용 감소, 결과 이력 관리 가능                           | 입력 스냅샷·게시 원자성·버전·재계산·캐시 무효화 설계가 필요. 테이블만 만들어서는 재현성 해결 안 됨 |

현재 규모의 계산 비용을 이번에 측정하지 않았으므로 응답 시간을 보장하지 않습니다. v1은 캐시도 우선 넣지 않습니다. 향후 필요하면 경계·전체 입력 해시·정책 버전을 함께 키로 사용하고 게시 변경을 반영해야 합니다. 지역 코드·분기만 키로 삼으면 다른 비교 집단 결과를 재사용할 수 있습니다.

### 후속 구현 순서

1. 공식 수신 창구와 미발송 문의의 범위를 결정합니다. 회신은 실제 파일 판본·적용 분기·공간·업종에 연결해 보존합니다.
2. 정책·원천·커버리지 승인, 근거 발급과 운영 배포 권한을 정합니다. 기존 결합 검증을 재사용하되 공개 경로에는 독립 기대 해시와 활성 기준을 필수로 둡니다.
3. 보호된 로더와 롤백 방지·철회 판정, 현재 전체 입력 대조와 응답 직전 상태 확인을 연결합니다. 변경·검증 실패 시 기본 차단하고 기존 통계 조회는 유지합니다.
4. 합성 테스트에서 기준 누락·허위 주장·철회·이전 해시·동시 갱신·원본과 제외 목록 변경을 검증하고, 승인 fixture의 회귀·재현, 백업 복원 및 전체 인스턴스 철회 적용을 확인합니다. 공개 판단은 그 뒤 별도 승인으로 기록합니다.

호환되는 과거 분기 자료를 확보한 뒤 순위 안정성과 실제 창업 성과의 관련성을 검증할 수 있습니다. AHP의 가중치 결정, ELECTRE의 조건별 우월·거부, Huff의 거리·매력도에 따른 선택은 당시 후속 검토 후보이며 실험 범위 밖이었습니다.

## 9. 과거 실험과 검증 기록

| 기록                                                                                                                                     | 구분해서 읽을 범위                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [모델 실험과 평가 기준](archive/score-mvp-criteria-validation.md)                                                                        | 2026-11-01 A·D·E 비교와 2026-11-02 12:17 점포 방향·가중치 민감도. 실행별 스냅샷과 입력 출처를 별도로 기록 |
| [R03 대조와 입력 보존](archive/score-20262-snapshot-preservation.md)                                                                     | 17:38 대표 6곳·현재 446개 검산, 20:56 실제 전체 입력 보존 및 DB 없는 재현. 12:17의 전체 fixture는 미확보  |
| [이전 공식 원천 조사](archive/score-source-verification.md)                                                                              | 11월 2일 당시의 공식 설명, 비교 가능성에 필요한 조건, A 단일 분기 권장 후보                               |
| [공식 출력과 파일 대조](archive/official-source-verification-20261-20262.md) · [전분기 검증](archive/quarter-comparison-verification.md) | 11월 5일의 파일/DB 대조와 별개 초기 API 표본. 원천 비교 가능성과 전분기 증감의 현재 보류 근거             |

R03의 대표 대조 기준은 강남구 72.50/2위, 서교동 67.76/23위, 신촌동 73.31/3위, 삼성동 60.36/83위, 돈암1동 41.36/322.5위, 북아현동 64.50/45위입니다. 당시 전체 fixture 없이 이 수치만 맞는 경우에는 `R03_COMPLETE=false`를 유지합니다.

### R01·R02 합성 검증 기록

아래는 **각 구현 당시의 별도 실행 기록**이며 이번 문서 통합에서 테스트를 다시 실행한 결과가 아닙니다. 서로 다른 시점의 합계로 현재 전체 테스트 수를 추정하지 않습니다.

| 시점·단계                             | 당시 결과                                                          | 범위·한계                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 2026-11-02 R01·R02 코어, 도구 추가 전 | 스냅샷 44개, 전체 단위 526개·통합 828개, 실패/건너뜀 0             | 합성 전체 집단. 행 존재+출처 ID/메타데이터 필수 조건을 포함한 보완 7개도 포함. 실제 개발 DB 도구 미실행 |
| 2026-11-02 내보내기·오프라인 도구     | 신규 단위 22개·통합 5개, 전체 단위 548개·통합 833개, 실패/건너뜀 0 | 합성 전체 3구·3동·JUnit 소유 임시 디렉터리·일회용 PostGIS. 기존 코어 44개·고정 SHA fixture 유지         |

두 단계 모두 빌드·Spotless·문서 Prettier·링크·표·신규 파일 공백 검사를 확인한 과거 기록입니다. 도구 테스트는 비활성·안전 속성 덮어쓰기·외부 경로/권한/기존 파일/링크/경로 교체·부분 저장 정리·변조·외부 기준·오프라인 재현을 다룹니다. 일회용 DB에서는 실제 읽기 전용·ROLLBACK·두 단위 저장·동시 변경의 동일 스냅샷·인증 실패·빈 최신 경계·게시 실패를 확인했습니다. 테스트 fixture 쓰기/마이그레이션은 내보내기 도구의 쓰기가 아닙니다.

R01은 순서·시각 불변성, 변경 탐지·고정 해시·JSON 왕복/손상 거부를 검증합니다. R02는 원본 표현·전체 집단·정확한 결과·제외/보류의 DB 없는 재현입니다. 합성 코어 성공과 이후 실제 입력 보존 성공을 동일 실행으로 합치거나 승인된 실데이터라고 부르지 않습니다. 정책·원천 판본·커버리지·실제 창업 성과 승인은 어느 단계도 수행하지 않았습니다.

### manifest·Trust Record 합성 검증과 조사 한계

#### 합성 테스트 범위

[ScoreApprovalManifestTests](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreApprovalManifestTests.java)는 합성 전체 3구·3동 중 매출 행 없는 1동을 포함합니다. 실제 원본 스냅샷·실제 승인 ID를 사용하지 않고 manifest 파일도 발급·저장하지 않습니다.

새 테스트는 정상 결합, 역할별 근거 누락·불일치, 입력/파일 해시, 정책·출처·커버리지 변조, 잘못된 JSON 타입과 손상, 정확한 재현, 순서·시각 정규화와 불변성, 외부 기준 부재·위조 주장에도 공개 불가, 기존 Service의 `NOT_APPROVED` 유지를 확인합니다.

[ScoreTrustRecordTests](../backend/src/test/java/kr/ac/recycleyoungs/score/ScoreTrustRecordTests.java)는 합성된 전체 3구·3동 스냅샷과 테스트 전용 기대값만 사용합니다. 실제 승인·철회 기록·manifest를 발급하거나 파일로 저장하지 않습니다.

- 정상 결합과 미승인 유지, 누락·변조·잘못된 형식, 역할별 근거와 정책·판본 혼용 거부.
- 릴리스·각 역할의 철회, 철회 이력 삭제/수정, 이전 리비전 재사용, 동일 릴리스 재지정 거부.
- 외부 기준 부재의 명시, JSON 왕복·정규 정렬·UTC 시각·불변 컬렉션, 독립 고정 SHA-256 fixture.
- 기존 R01·R02 고정 fixture와 manifest 테스트 유지.

기존 검증 명령은 `backend/`의 `./gradlew test`, `./gradlew integrationTest`, `./gradlew build`, `./gradlew spotlessCheck`입니다. 아래 통합 검증은 기존 일회용 PostGIS를 사용했고 실제 개발 DB·보존 스냅샷·내보내기·실데이터 회귀 도구에는 접근하지 않았습니다. **각 기록은 해당 구현 당시의 별도 실행 기록이며 이번 문서 정리의 실행 결과가 아닙니다. 합산하지 않습니다.**

#### 2026-11-02 manifest 구현 검증 기록

신규 manifest **57개**, 전체 단위 **605개**, 일회용 DB 통합 **833개**가 통과했으며 실패·오류·건너뜀은 없습니다. 기존 R01·R02 스냅샷 44개와 고정 SHA-256 fixture를 유지했습니다. 빌드·Spotless, 제품 JAR의 도구 제외, 문서 Prettier·상대 링크·표와 신규 파일 공백 검사도 확인했습니다. 읽기 전용 독립 코드 리뷰에서 수정이 필요한 사항은 발견하지 못했습니다.

#### 2026-11-02 Trust Record 구현 검증 기록

신규 신뢰 기록 **68개**, 전체 단위 **673개**, 일회용 DB 통합 **833개**가 통과했으며 실패·오류·건너뜀은 없습니다. 기존 스냅샷 **44개**·manifest **57개**와 고정 SHA-256 fixture를 유지했습니다. 빌드·Spotless, 제품 JAR 2개의 도구 제외, 문서 Prettier·링크·표·신규 파일 공백 검사를 확인했습니다. 별도 읽기 전용 코드 리뷰에서 지적된 이력 검사 범위도 위와 같이 명시했습니다.

신규 합성 테스트의 성공과 실제 원천 비교 가능성·정책·커버리지 승인은 별개입니다. 실제 창업 성과도 검증하지 않았습니다. 과거 12:17 전체 입력 fixture가 없어 **R03 완전 재현은 여전히 미완료**입니다.

#### 2026-11-03 공식 조사 범위와 한계

- 공식 HTML과 PDF 추출 본문을 확인했습니다. PDF 페이지 이미지 조회는 이미지가 반환되지 않아 시각 대조는 하지 못했습니다. 동적 API 탭의 새로운 필드별 산정 명세나 공개 배포 파일의 체크섬 대응표는 확보하지 못했습니다.
- OA-22172·OA-22179의 첫 열람에 오류/서비스 지연이 있었으나 공식 A 경로에서 안내를 확인했습니다. 이 열람 문제를 데이터 누락의 원인으로 해석하지 않습니다.
- 공식 검색에서 답을 찾지 못한 것은 해당 규칙이 존재하지 않는다는 증거가 아닙니다. 이번에 새로 확인한 FAQ·분류표·영역 메타정보·생활인구 공지도 현재 CSV의 의미적 비교 가능성을 확정하지 못합니다.

2026-11-03의 문서 통합은 문서 내용·구조·참조 정리만 수행했습니다. 당시에는 기존 공식 조사·테스트 실행 기록을 보존했으며 새 공식 조회, DB·보존 스냅샷 접근, Gradle·내보내기·회귀 도구 실행을 하지 않았습니다. 문의 발송이나 실제 승인·ID·manifest·서명·키·Trust Record 발급도 하지 않습니다.
