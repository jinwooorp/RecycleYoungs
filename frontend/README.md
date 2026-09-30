# Frontend

React + TypeScript + Vite 프로젝트입니다. 현재 화면은 기본 템플릿이며 지도·통계·후보지 비교와 API 호출은 아직 구현하지 않았습니다.

## 실행

Node.js 24 계열을 사용합니다. 이 디렉터리에서 실행합니다.

```sh
npm ci
npm run dev
```

기본 주소는 `http://localhost:5173`입니다. 개발 서버의 `/api` 요청은 `http://localhost:8080`의 Spring으로 전달합니다.

## 검증

```sh
npm run build
npm run lint
```

첫 화면은 행정동·업종·분기 선택과 통계 표, 로딩·오류·자료 없음 상태를 구현하는 것이 목표입니다. API 경로·타입은 backend와 합의한 뒤 추가합니다.

프로젝트 전체 실행은 [루트 README](../README.md), 작업 순서는 [로드맵](../docs/roadmap.md)을 확인합니다.
