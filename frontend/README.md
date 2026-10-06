# Frontend

React + TypeScript + Vite로 행정동·업종·분기를 선택하고 점포·추정매출 표를 조회합니다. Tailwind CSS v4와 shadcn/ui Button·Card를 점진적으로 적용했습니다. API의 단일 기준은 [행정동 API 계약](../docs/api-contract.md)입니다. Chart·분기 추세·지도·후보 비교·점수·metadata UI는 포함하지 않습니다.

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
| `src/components/ui/button.tsx`, `card.tsx` | shadcn/ui 기반 공통 Button·Card |
| `src/lib/utils.ts` | clsx·tailwind-merge 기반 className 조합 |
| `src/App.tsx`, `src/App.css`, `src/index.css` | 화면 조립·상태 안내·Tailwind 레이아웃·light theme·CSS layer |

상태 처리는 React core·fetch·AbortController를 유지합니다. 타입·API client·상태 hook은 표현 계층과 분리되어 있으며 UI 기반 도입으로 동작을 바꾸지 않았습니다. 별도 상태·폼 라이브러리나 theme provider를 추가하지 않았습니다.

Tailwind는 공식 `@tailwindcss/vite` 플러그인과 `@import "tailwindcss"`로 구성합니다. shadcn/ui는 공식 new-york-v4 Button·Card 소스를 수동 도입하고 `components.json`을 설정했습니다. Button은 light theme·44px 최소 클릭 영역·명확한 disabled/focus 스타일로 조정했고 animation·미사용 variant는 제외했습니다. Card의 `asChild`는 Radix Slot으로 기존 `section`·`aria-labelledby`를 유지합니다. 별도 Button/Card wrapper는 없습니다.

실제 적용은 조회/재시도 Button과 조회 조건/점포/추정매출 Card까지입니다. 조건 입력은 native `select`, 통계 표는 `table`·`caption`·`th scope="row"`를 유지합니다. Select·Combobox·Chart·지도 SDK는 도입하지 않았습니다.

`src/index.css`는 녹색 계열의 light theme 토큰과 `base`/접근성 utility를, `src/App.css`는 native 입력·통계 표·상태 안내의 `components` layer를 관리합니다. Preflight의 margin·box-sizing·font reset과 중복된 규칙은 정리했습니다. 레이아웃/패딩은 Tailwind utility를 사용하며 layer 밖 전역 스타일로 공통 Button/Card를 덮어쓰지 않습니다. 모바일/데스크톱 전환은 기존 760px 경계를 유지합니다.

`@/*`는 `src/*`를 가리킵니다. TypeScript의 루트/app 설정, Vite, 별도 Vitest 설정에 동일한 alias를 적용했고 기존 상대 import는 유지했습니다. TypeScript 6에서 불필요한 `baseUrl`은 추가하지 않았습니다. Vite `/api` proxy도 그대로입니다.

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

2026-10-06 Tailwind/shadcn 도입 후에도 기존 테스트 36개를 수정 없이 통과했고 lint·build를 통과했습니다. 실제 Vite `/api` 프록시 → Spring → 기존 PostgreSQL로 위 세 조건의 HTTP 200 응답과 브라우저 표시를 다시 확인했습니다. 검증용 Spring은 Flyway를 비활성화하고 JDBC 세션을 읽기 전용으로 실행했습니다.

실제 브라우저의 390px·1280px에서 native select·카드 배치·가로 넘침 없음과 3px 키보드 focus를 확인했습니다. DB에 없는 signed BIGINT 최대/최소값·metric NULL·실제 0·지연/HTTP 오류 표시는 저장소 밖 임시 API fixture를 사용하는 별도 Vite 서버로 확인했습니다. 이 fixture 확인은 실제 DB 사례와 구분하며 production 코드·DB에 fixture를 추가하지 않았습니다. 정상 화면에서 console error/warning은 없었습니다.
