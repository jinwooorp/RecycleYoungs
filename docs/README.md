# RecycleYoungs 문서 안내

프로젝트에 합류했거나 작업에 필요한 문서를 찾는 개발자를 위한 안내입니다.

앱을 처음 실행한다면 루트 README의 빠른 시작에서 출발합니다.

[프로젝트 소개와 빠른 시작](../README.md#빠른-시작)

## 작업별 읽는 순서

| 하고 싶은 일 | 읽는 순서 |
| --- | --- |
| 처음 개발 환경을 준비하거나 시스템 구조를 파악 | [SETUP.md](SETUP.md)에서 실행 방식을 고르고 [ARCHITECTURE.md](ARCHITECTURE.md)에서 서비스와 데이터의 연결을 확인합니다. |
| 제품 목표나 화면의 현재 범위를 확인 | [PRD.md](PRD.md)에서 사용자 요구사항, MVP, 표시 정책과 후속 범위를 확인합니다. |
| API 연동 또는 DB 변경을 검토 | [API.md](API.md)에서 요청·응답 계약을 확인한 뒤 [DATABASE.md](DATABASE.md)에서 테이블·저장·마이그레이션을 살펴봅니다. |
| 공공데이터를 적재하거나 검증 | [ETL.md](ETL.md)에서 수집·검증·게시 절차와 원천 판본·통계 비교의 검증 근거를 확인합니다. |
| 코드 변경을 준비하거나 CI 실패를 조사 | [CONVENTIONS.md](CONVENTIONS.md)에서 작성·협업 규칙을 확인한 뒤 [TESTING.md](TESTING.md)에서 필요한 검사를 골라 실행합니다. |

## 기능을 추가할 때 수정할 문서

먼저 [PRD.md](PRD.md)에서 사용자에게 제공할 범위가 바뀌는지 확인합니다.

아래 표는 변경이 결정된 뒤 문서를 갱신하는 순서입니다.

제품의 실제 구현 상태와 후속 계획은 PRD에서 구분해 기록합니다.

| 변경 상황 | 먼저 확인할 문서 | 변경에 따라 함께 수정할 문서 |
| --- | --- | --- |
| 새 업종 지원 | [PRD](PRD.md)에서 지원 범위와 화면 정책을 정리하고 [ETL](ETL.md)에서 업종 분류와 자료 범위를 확인합니다. | 저장 형식이나 응답이 바뀌면 [DATABASE](DATABASE.md)와 [API](API.md)를 갱신합니다. 업종별 검증 절차는 [TESTING](TESTING.md)에 반영합니다. |
| 서울 외 지역 지원 | [PRD](PRD.md)에서 서비스 지역을 정리하고 [ARCHITECTURE](ARCHITECTURE.md)에서 지역 처리의 영향을 확인합니다. | 경계와 통계 원천은 [ETL](ETL.md), 지역 키와 공간 조건은 [DATABASE](DATABASE.md)·[API](API.md)에 반영합니다. 실행 설정이나 검증 범위가 바뀌면 [SETUP](SETUP.md)·[TESTING](TESTING.md)도 갱신합니다. |
| 새 공공데이터 수집 | [ETL](ETL.md)에서 출처·판본·검증·게시 방법을 정리합니다. | 저장 구조는 [DATABASE](DATABASE.md), 공개 필드는 [API](API.md), 새 키나 실행 조건은 [SETUP](SETUP.md), 검증 절차는 [TESTING](TESTING.md)에 반영합니다. |
| 새 API 또는 DB 테이블 추가 | 요청·응답은 [API](API.md), 테이블과 마이그레이션은 [DATABASE](DATABASE.md)에서 시작합니다. | 데이터 흐름이 바뀌면 [ARCHITECTURE](ARCHITECTURE.md), 적재가 바뀌면 [ETL](ETL.md), 검증 절차가 바뀌면 [TESTING](TESTING.md)을 갱신합니다. |

현재 문서의 담당 절을 먼저 수정합니다.

한 설명의 상세 내용은 담당 문서에 두고 다른 곳에서는 링크로 연결합니다.

기존 문서에 담기 어려운 별도 책임이 생길 때 새 문서를 추가합니다.
