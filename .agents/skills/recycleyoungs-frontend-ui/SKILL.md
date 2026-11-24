---
name: recycleyoungs-frontend-ui
description: RecycleYoungs의 React 화면, Kakao 지도, 장소 검색, 지역 필터, 상권 분석이나 후보지 비교를 구현·수정·검증할 때 사용합니다. 화면에 영향이 없는 문서·Backend·ETL 작업에는 적용하지 않습니다.
---

# RecycleYoungs Frontend UI

1. [제품 요구사항](../../../docs/PRD.md)과 [웹 소스 구조](../../../docs/ARCHITECTURE.md#웹-소스-구조)에서 변경할 흐름과 계층을 찾는다. `apps/web/src/app/routes.tsx`에서 라우팅을, `pages/`, `widgets/`, `features/`에서 화면과 상태 조합을 확인한다. API 연동에 영향이 있으면 `apps/web/src/entities/`와 [REST API 계약](../../../docs/API.md)을 확인한다.
2. 영향받는 흐름과 상태를 고른다. 조회와 상호작용이 바뀌면 정상·로딩·빈 결과·오류·재시도 중 변경과 관련된 상태를 확인한다. 화면이나 조작 방식이 바뀌면 모바일과 데스크톱의 배치, 필요한 키보드 조작과 포커스 이동도 확인한다. [개발 규칙](../../../docs/CONVENTIONS.md)의 기존 UI 컴포넌트와 디자인 토큰을 따른다.
3. 변경한 동작은 `apps/web/`에서 `npm test -- 파일경로`로 관련 Vitest 테스트부터 확인한다. 이후 변경 범위에 맞춰 [테스트와 CI](../../../docs/TESTING.md)의 검사와 브라우저 검증을 선택한다.
   - 오류·복구·후보지 등 합성 흐름에는 `npm run e2e:serve`를 사용하고, 실제 지도·검색·마커 확인에는 [Kakao Maps 설정](../../../docs/SETUP.md#kakao-maps-설정)이 갖춰진 개발 환경을 사용한다.
   - 로컬 브라우저 검증은 [로컬 UI 확인](../../../docs/TESTING.md#로컬-ui-확인)을 따른다. `ego-browser`가 제공되면 우선 사용하고, 사용할 수 없을 때는 현재 환경에 연결된 Chrome이 있는지 확인한다.
   - 로컬의 `npm run e2e:check`와 `npm run test:e2e:list`는 타입·Mock과 테스트 목록을 확인한다. `npm run test:e2e`로 브라우저를 띄우는 검사는 GitHub-hosted Linux Runner에서 실행한다.
4. 사용한 도구, 합성·실제 지도 환경, 확인한 화면과 시나리오를 보고한다. 도구·키·권한 문제로 검증할 수 없었던 경우에는 남은 항목과 이유를 기록한다.
