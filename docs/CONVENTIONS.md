# 개발 규칙

이 문서에서 앱별 포맷과 이름을 확인하고, 변경에 필요한 검사와 협업 절차를 찾을 수 있습니다. [저장소 지침](../AGENTS.md) · [검사 명령](TESTING.md)

## 작성과 포맷

| 영역 | 적용 기준 |
| --- | --- |
| Frontend TypeScript | ESLint와 Prettier로 검사합니다. 문자열은 작은따옴표를 쓰고 후행 쉼표는 Prettier 설정을 따릅니다. [ESLint](../apps/web/eslint.config.js) · [Prettier](../apps/web/.prettierrc.json) |
| ETL TypeScript | ESLint와 Prettier를 사용합니다. `npm run lint`에는 TypeScript 검사도 포함되며, Prettier는 문자열에 작은따옴표를 사용합니다. [ESLint](../apps/etl/eslint.config.js) · [Prettier](../apps/etl/.prettierrc.json) · [스크립트](../apps/etl/package.json) |
| Backend Java | Gradle의 Spotless가 `src/**/*.java`에 Google Java Format을 적용합니다. [Gradle 설정](../apps/api/build.gradle) |

화면을 작성할 때는 색상을 디자인 토큰으로 지정합니다. 기본 UI 컴포넌트의 스타일을 유지하고 필요한 배치를 화면에서 조정합니다. [웹 디자인 시스템](DESIGN_SYSTEM.md)

수정한 범위에 기존 스타일과 검사 규칙을 적용합니다. 검사를 통과시키기 위해 규칙을 완화하거나 관련 없는 파일까지 포맷하면 변경 범위가 달라지므로 피합니다.

## 이름과 파일 위치

기존 모듈을 수정할 때는 해당 모듈의 이름과 위치를 따릅니다. 아래는 역할별로 파일을 찾을 때 볼 수 있는 이름의 예입니다.

| 영역 | 현재 사용하는 패턴 |
| --- | --- |
| Frontend | 파일명에서 단어를 하이픈으로 구분하는 예로 `kakao-map.tsx`가 있습니다. React 컴포넌트는 `KakaoMapView`처럼 각 단어를 대문자로 시작하고, 화면 상태나 동작을 재사용하는 훅은 `useCurrentLocation`처럼 `use`로 시작합니다. [웹 소스 구조](ARCHITECTURE.md#웹-소스-구조) |
| Backend | `kr.ac.recycleyoungs` 아래에 업무 영역별 패키지를 두고, `CafeController`, `CafeService`, `CafeRepository`, `CafeResponse`처럼 역할을 이름에 표시합니다. [카페 패키지](../apps/api/src/main/java/kr/ac/recycleyoungs/cafe/) |
| ETL·DB | ETL의 개별 기능은 `domains/`에, 여러 단계를 잇는 흐름은 `workflows/`에 둡니다. 테이블·컬럼은 `dong_store_stat`, `source_batch_id`처럼 밑줄로 구분합니다. Flyway 파일은 `V7__create_district_foot_traffic_stat.sql`처럼 버전과 변경을 표시합니다. [ETL 소스](../apps/etl/src/) · [마이그레이션](../apps/api/src/main/resources/db/migration/) |

## 주석과 마이그레이션

- 신규·수정 코드의 주석은 한국어를 기본으로 하고 기술 용어·식별자·외부 API 이름은 원래 표기를 사용합니다.

  동작만 보고 알기 어려운 검증·예외 조건, 보안·트랜잭션·성능상의 이유를 해당 코드 가까이에 설명합니다.

  코드가 바뀌면 관련 주석도 함께 확인합니다.

- 테스트 주석은 입력과 기대 동작으로 드러나지 않는 검증 의도를 설명합니다.

  자동 생성 파일·외부 라이브러리·잠금 파일에는 주석을 추가하지 않습니다.

- 적용된 Flyway 파일은 체크섬을 보존합니다.

  후속 구조 변경과 한국어 주석은 새 버전에 반영합니다.

  [DB 마이그레이션](DATABASE.md#db-마이그레이션-방향)

## Git과 PR 협업

- 작업 전에 현재 브랜치와 작업 트리를 확인하고 기존 변경을 보존합니다.

  현재 브랜치의 작업 트리와 요청 범위에서 작업합니다.

- 브랜치 변경·커밋·푸시·병합은 명시적 요청에 따릅니다.

  기존 작업을 잃는 명령은 임의로 실행하지 않습니다.

- API·DB·ETL을 변경할 때는 영향을 받는 계약·코드·문서·테스트를 함께 확인합니다.

  작업 결과에는 주요 변경과 검증 결과, 실행하지 못한 검사와 그 이유를 남깁니다.

  현재 CI가 실행되는 Push·PR 조건은 테스트 문서를 따릅니다.

  [GitHub Actions CI](TESTING.md#github-actions-ci)

- 비밀정보는 코드·로그·출력에 남기지 않습니다.

  공유·운영 DB 접근, 데이터 삭제, 파괴적 마이그레이션, Docker 볼륨 삭제는 사전 승인이 필요합니다.

  [ETL 전송과 게시 절차](ETL.md#서울시-open-api-전체-수집-probe)
