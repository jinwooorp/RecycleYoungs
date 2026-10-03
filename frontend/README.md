# Frontend

React + TypeScript + Vite로 행정동·업종·분기를 선택하고 점포·추정매출 표를 조회합니다. API의 단일 기준은 [행정동 API 계약](../docs/api-contract.md)입니다. 지도·추세·점수·metadata UI는 포함하지 않습니다.

## 실행

Node.js 24 계열을 사용합니다. 공용 PostgreSQL에 행정동 통계를 적재하고 Spring을 별도 터미널에서 실행한 뒤 이 디렉터리에서 실행합니다([전체 실행](../README.md#시작하기)).

```sh
npm ci
npm run dev
```

기본 주소는 `http://localhost:5173`입니다. 기존 Vite `/api` 프록시가 `http://localhost:8080`의 Spring으로 전달합니다. frontend 소스는 상대 `/api` 경로만 사용하며 DB·CSV·manifest에 직접 접근하지 않습니다.

페이지 진입 시 행정동·내부 업종·분기 목록을 병렬로 불러옵니다. 자동 선택 없이 세 조건을 선택하고 조회하기를 누릅니다. 조건을 바꾸면 이전 결과와 요청을 정리하고, 조회 중 중복 제출을 막습니다. 목록 실패에는 다시 시도가 있고 통계 실패는 조건 선택을 유지합니다.

## 표시 규칙

- 응답의 행정동·업종·분기를 결과 기준으로 표시합니다. 금액은 원, 매출 건수는 건, 점포 수는 개입니다.
- BIGINT는 string으로 보관하며 BigInt와 Intl.NumberFormat으로 정확하게 표시합니다. Number·parseInt·parseFloat로 바꾸지 않습니다.
- 행이 있지만 metric이 NULL이면 해당 값만 ‘자료 없음’, 실제 0은 `0개`·`0원`·`0건`입니다.
- 한쪽 NO_ROW는 그 영역만 자료 없음으로 표시하고, 양쪽 NO_ROW도 조건을 유지한 정상 empty 결과입니다. API·network 실패와 구분합니다.
- 추정매출은 선택한 분기에 귀속된 원본 보고값입니다. 실제 매출·이익·월평균·분기 총액으로 재해석하지 않습니다. 개업·폐업 점포 수도 성공률·실패율이 아닙니다.

## 구조와 스타일

| 위치 | 책임 |
| --- | --- |
| `src/types/api.ts` | 계약의 identifier·응답·NULL 타입 |
| `src/api/adminDongApi.ts` | 네 GET API, HTTP/network 오류와 응답 형태 검증 |
| `src/hooks/useAdminDongStats.ts` | lookup·선택·조회 상태, AbortController와 늦은 응답 방지 |
| `src/components/SearchForm.tsx` | label이 연결된 select와 조회 버튼 |
| `src/components/StatsResult.tsx` | 기준 조건·통계 표·자료 없음·정밀한 숫자 표시 |
| `src/App.tsx`, `src/App.css`, `src/index.css` | 화면 조립·상태 안내·Vanilla CSS |

React core만 사용합니다. CSS는 기본 반응형·focus·숫자 가독성에 한정했고 자체 UI framework를 만들지 않았습니다. 향후 Tailwind + shadcn/ui 검토 시 폼·결과의 표현 계층을 교체하고 타입·API client·상태 hook은 유지할 수 있습니다.

## 검증

```sh
npm run lint
npm run test
npm run build
```

Vitest·React Testing Library·jest-dom·jsdom은 개발 테스트용입니다. fetch 경계만 대체하며 실제 client·hook·component로 로딩, 선택, 정상 통계, NULL/0, 부분/전체 NO_ROW, 400/500/network 실패, 잘못된 JSON/BIGINT, 요청 취소와 늦은 응답을 검사합니다. PostgreSQL이 없어도 실행됩니다. 이 테스트만으로 실제 서버 연결을 완료했다고 판단하지 않습니다.

2026-10-04에 기존 PostgreSQL·Spring·Vite를 실행하고 브라우저에서 다음을 확인했습니다.

| 조건(20251) | 실제 화면 |
| --- | --- |
| 청운효자동 `11110515` / `CAFE` | 점포 114개, 추정매출 4,535,266,422원, 매출 302,642건 |
| 면목5동 `11260550` / `CAFE` | 점포 17개, 추정매출 자료 없음 |
| 신정6동 `11470670` / `PUB` | 양쪽 자료 없음, 정상 empty 결과 |

검증용 Spring을 일시 중단해 통계/lookup 오류와 재시도 복구를 확인했고, 390px·1280px 배치를 확인했습니다. metric NULL·2^53 초과 값·순수 network 실패는 자동 테스트로 검증했습니다. 기존 DB 행 수·전체 checksum·Flyway 이력이 유지됐습니다. 상세 결과는 [프로젝트 기록](../docs/project-status.md), 다음 작업은 [로드맵](../docs/roadmap.md)을 확인합니다.
