# 프로젝트 상태와 로드맵

정리 기준: 2026-10-10. 코드와 커밋된 기록을 정적으로 대조했으며 이번 문서 작업에서 테스트·DB·Docker·백업을 확인하지 않았습니다.

## 목표와 MVP

“여기 창업해도 돼?”는 서울시 통계와 소상공인 점포 데이터로 창업 후보 위치를 분석·비교하는 대학 캡스톤 서비스입니다. 창업 성공·수익·폐업을 보장하지 않습니다. 출처·기준 시점·집계 단위·한계를 표시하고 같은 업종·반경·연령대·분기·공간 유형·점포 snapshot·경계/data/model version으로 최대 3개 위치를 비교하는 것이 MVP 목표입니다.

현재 MVP의 첫 흐름은 행정동 코드 기반 통계 조회입니다. 후보 좌표 판정은 operational 행정동 Polygon을 우선 사용하도록 설계했으며 역사적 통계 경계의 동일성은 보증하지 않습니다.

## 현재 구현과 완료 단계

| 영역 | 구현된 범위 | 완료 근거와 한계 |
| --- | --- | --- |
| Backend | Java 21·Spring MVC·JdbcClient, lookup 3개·단건 통계·4분기 추세 GET 5개 | 과거 실제 API·격리 fixture 검증. [현재 계약](api-contract.md) |
| Frontend | React·TypeScript·Vite·Tailwind/shadcn, 조건 선택·통계/추세 표·요청 취소·결측/오류 표시 | 과거 API 연결·브라우저·새 환경 검증. 지도·비교·metadata UI 없음 |
| CSV ETL | 서울시 통계·대표 POINT·SEMAS 점포 입력 검증과 적재 | [데이터 정책](data.md). 일반 full loader는 기존 DB backfill용이 아님 |
| 공간 DB·ETL | V2 version/경계 3table·제약/GiST/guard, V3 SEMAS CAFE mapping·최소 backfill, Polygon 별도 CLI | 코드와 격리 적재 검증 완료. 기존 개발 DB 적용과 구분 |
| 실행 보호 | `etl/control*.py`의 격리 11단계·실측 validator·identity/hash·STOP | 개발 DB 실행 모드는 없음. [DB 안전 기준](db-safety.md) |

1차 1~7단계의 행정동 통계 ETL → JDBC/Flyway → API → React → 2025년 4분기 추세·새 환경 연결을 완료했습니다. 2차는 원본/CRS 확인·operational geometry·CAFE 분류·공간 설계, 8-A/B1/B2/C1/C2A/C2B-1/2/3 구현과 격리 검증까지 진행했습니다. 각 과거 결과·commit은 [DB 검증 근거](db-safety.md#과거-검증과-git-근거)를 확인합니다.

**기존 개발 DB 적용은 NOT_READY이며 2차 8단계 전체는 미완료입니다.** 현재 DB를 재조회한 판정은 아니고 최신 기록과 구현된 실행 경로의 제한에 따른 상태입니다.

## 남은 로드맵과 완료 기준

| 순서 | 작업 | 완료 기준 |
| --- | --- | --- |
| 8-C2B-4 | 실제 개발 DB 적용 최종 안전 설계 | 실사용자 연결·writer/권한·최신 backup/restore·단계별 보존·STOP/복구·Go/No-Go 설계와 리뷰 |
| 8-C2 실제 적용 | 승인된 V2→V3→Polygon-only | 별도 명시적 승인 후 [DB 안전 gate](db-safety.md#실행과-검증-gate)와 전수 보존 증거. 격리 PASS로 대체하지 않음 |
| 9 | 후보 좌표 → 행정동/상권 판정 API | 확정 predicate/version/cardinality, 경계·hole·overlap·미지원·통계 연결을 후보 2~3곳에서 대조 |
| 10 | 300m/500m/1km 경쟁 점포 | SEMAS 분류·미터 거리/index·점포 snapshot을 검증. 통계 분기와 다른 시점 표시 |
| 11 | 지도 SDK·UI | 위치 선택·점포/경계 표시, 자료별 기간/version/한계·접근성·반응형 검증 |
| 12 | 최대 3개 후보 비교 | 같은 비교 조건·결측 정책을 적용하고 후보별 결과 수작업 대조 |
| 이후 | 지역 인구·시설·변화지표·metadata·점수 | 원본/단위/기간 → schema/ETL → API/UI 순으로 검증. 점수 정규화·가중치·모델 version은 확정 전 |

서울시 전체 인구를 위치별 수요로 쓰지 않습니다. 상주/직장인구의 반복 값·중복 합산, 시설의 지역 단위, 상권변화지표와 업종 성장률을 각각 검토합니다. 통계 기간 확대도 공통 기간과 경계 호환성을 먼저 확인합니다. 점수의 가중치 초안은 확정 모델이 아닙니다.

## 점수·비교의 후속 정책

서울·업종 3~5개·연결 가능한 4~8개 분기를 목표로 검토하되 현재 API는 2025년 4분기입니다. 지도·통계·근거·비교를 먼저 완성하고 자료/계산식을 검증한 뒤 설명 가능한 규칙 기반 점수를 검토합니다. AI 예측·실시간 수집·전국 확대·수익 예측·전체 container 배포는 현재 범위가 아닙니다.

점수는 높을수록 유리한 방향으로 맞추고 같은 업종·분기·공간 유형의 비교 집단으로 정규화합니다. 계산식·가중치·비교 집단을 모델 version으로 관리합니다. 필수 자료가 없으면 해당/종합 점수는 null이며 부족한 자료를 설명합니다. 결측을 0점으로 바꾸거나 후보마다 가중치를 재분배하지 않습니다. 0~100은 상대 평가이며 성공 확률이 아닙니다. 응답은 기준 지역·원지표·기간·출처·결측을 포함하고 version은 실제 DB 관리 후 제공합니다. 과거 미검증 가중치 초안은 [당시 설계](https://github.com/jinwooorp/RecycleYoungs/blob/caf6ace7748717b05085fa30eac74df689952df8/docs/architecture.md#점수와-후보-비교--구현-전-정책)에 남기며 확정 모델로 채택하지 않습니다.

## 현재 blocker와 미검증 범위

- DB 실행 경로·최신 identity/writer/role/ACL·snapshot-bound backup/독립 restore·실사용자 JDBC·실제 적용 승인이 남아 있습니다. 판단 기준은 [db-safety](db-safety.md)에 둡니다.
- `PostgresConnectionTests`의 Flyway version `1` 고정 기대가 현재 V1~V3 fresh DB와 맞지 않습니다. 테스트 기대값과 Spring startup migration 정책의 별도 코드 검토가 필요합니다.
- 공간 API·지도·반경 index·CAFE 외 SEMAS mapping·통계/점포 metadata는 미완료입니다.
- 역사적 경계 정합성 B/UNRESOLVED, 홍지문 H5/CONFLICT_OBSERVED와 원본 overlap은 [데이터 한계](data.md#공간-데이터와-한계)를 유지합니다. 미검증을 완료로 바꾸지 않습니다.
- 현재 DB·백업·권한·writer 상태와 현재 HEAD의 전체 재현 결과는 이번에 확인하지 않았습니다.

완료는 코드 존재나 mock PASS만으로 판단하지 않습니다. 입력/제외 건수·원본/DB 값·NULL·단위·기간·연결·재실행·실패 보존을 해당 환경에서 검증하고 PASS/FAIL/SKIP와 한계를 기록합니다. 실행 안내는 [development](development.md), 책임과 확정 설계는 [architecture](architecture.md)에 둡니다.
