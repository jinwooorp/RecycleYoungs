# 프로젝트 기획·현황·로드맵

서비스의 과거·현재·미래를 관리하는 기준 문서입니다. 기술/API/데이터/개발 방법은 [technical](technical.md), 실제 DB 보호·실측 증거·승인은 [db-safety](db-safety.md)에 둡니다.

최신 검증 기준은 **2026-10-14 최종 실자료 E2E**입니다. 새 독립 격리 DB의 전수 적재·무결성, 실제 지도 클릭 4개의 카페 SQL/API, 최종 3후보 Q3 통계 9개 지표 SQL/API/UI, 대표 source 경계 2개 SQL→HTTP, bridge abort·복구 3회 및 cleanup을 확인했습니다. **README 7~10단계는 캡스톤 MVP·일회용 격리 시연 범위에서 완료**입니다. 이전 단계/v1/v2 기록은 [실자료 통합 결과](#실자료-통합-결과)에서 날짜별로 구분합니다. 기존 보호 DB·백업에는 접속하지 않았고 이번 문서 갱신에서도 테스트·DB·Docker를 재실행하지 않습니다.

개발 인원은 1명이며 최종 목표는 **2026년 10월 31일까지 시연 가능한 MVP 완성**입니다. 카페는 우선 검증 업종이며 서비스를 카페 전용으로 제한하지 않습니다. 사용자 관점의 1~10단계 순서와 현재 단계는 [README 개발 로드맵](../README.md#개발-로드맵)에 둡니다.

## 목차

- [서비스 목적과 요구사항](#서비스-목적과-요구사항)
- [MVP와 비목표](#mvp와-비목표)
- [현재 흐름과 최종 사용자 시나리오](#현재-흐름과-최종-사용자-시나리오)
- [현재 위치와 지금 시작할 작업](#현재-위치와-지금-시작할-작업)
- [구현 과정과 주요 결정](#구현-과정과-주요-결정)
- [구현 상태와 검증 수준](#구현-상태와-검증-수준)
- [Now / Next / Later](#now--next--later)
- [트랙 A — 기존 DB에 안전하게 적용하기](#트랙-a--기존-db에-안전하게-적용하기)
- [트랙 B — 사용자 기능 완성하기](#트랙-b--사용자-기능-완성하기)
- [병렬로 진행할 수 있는 개발](#병렬로-진행할-수-있는-개발)
- [추가 지표와 점수 정책](#추가-지표와-점수-정책)
- [현재 blocker와 미확정 사항](#현재-blocker와-미확정-사항)

## 서비스 목적과 요구사항

“여기 창업해도 돼?”는 서울의 창업 후보 위치를 공공자료로 분석·비교하는 대학 캡스톤 서비스입니다. 주요 사용자는 후보지를 고르는 예비 창업자입니다. 사용자 인터뷰나 효과 검증이 저장소에서 확인된 것은 아니며 서비스 기획에서 도출한 대상입니다.

자료가 사이트·시점·지역 단위별로 흩어져 있어 후보지의 경쟁과 지역 환경을 같은 조건으로 비교하기 어렵다는 문제를 다룹니다. 시스템은 근거를 모아 보여주되 창업 성공·수익·폐업을 예측/보장하지 않습니다.

| 요구사항 | 제공해야 할 의미 |
| --- | --- |
| 후보 위치·조건 입력 | 좌표·업종·반경, 확보 가능한 자료에 따른 연령대/기간 조건 |
| 지역 판정 | 행정동/상권 소속과 경계 모호성·미지원 사유 |
| 주변 환경 | 경쟁 점포·지역 통계·원지표의 출처/기간/단위/한계 |
| 후보 비교 | 최대 3곳을 같은 업종·반경·연령대·분기·공간 유형·snapshot/version으로 비교 |
| 결측·오류 | NULL/실제0/NO_ROW·요청 실패를 구분하고 없는 값을 만들지 않음 |
| 재현 근거 | 데이터/경계/model version과 검증 범위를 실제 관리 자료에 연결 |

## MVP와 비목표

MVP는 처음 완성할 핵심 서비스 범위입니다. 현재 첫 흐름은 행정동 code 기반 통계이고, 최종 목표는 서울에서 위치 선택→지역 판정→경쟁 점포/통계와 근거 확인→최대 3곳 비교입니다. 초기 카페(CAFE) 경쟁군을 기준으로 개발하며 지원 업종 확장은 원천 코드를 내부 업종에 연결하는 mapping과 자료 검증에 의존합니다. 3~5개 업종·4~8개 공통 분기는 확장 검토 목표이며 현재 완료 범위가 아닙니다.

후보 판정에는 현재 조회용으로 선택한 행정동의 다각형 경계(operational Polygon)를 우선 사용하도록 설계했습니다. 이를 2025 통계 집계 당시 경계와 동일하다고 보증하지 않습니다. 반경 300m/500m/1km와 연령 조건도 실제 연결 자료·거리 계약을 검증해야 합니다.

지도·근거·비교와 출처/기간/단위/버전 같은 자료 설명(metadata)이 필수 흐름입니다. 추가 인구/시설/변화 지표와 규칙 점수는 자료 의미/계산식 검증 뒤 검토합니다. AI/머신러닝 예측·실시간 수집·전국 확대·수익 예측·전체 서비스 container 배포는 현재 필수 MVP가 아닙니다. 배포/시연 환경은 별도 결정합니다.

## 현재 흐름과 최종 사용자 시나리오

| 단계 | 현재 화면 | 최종 MVP |
| --- | --- | --- |
| 입력 | 지도 좌표 선택·최대 3후보 저장, 수동 조회와 별도 공통 CAFE/500m/분기 조건 | 실자료로 재현 가능한 후보 선택·공통 조건 |
| 지역 | 좌표 기반 동 0/1/복수·상권 0..N 판정, 단일 확정 동의 통계 조건 연결 | 실제 서울 경계 대조와 모호성·품질 한계 확인 |
| 정보 | 반경 500m 카페 count/목록·자료 한계, 행정동 단건 통계·2025 네 분기 표 | 검증된 원본 자료 연결·출처/기간/단위 확인 |
| 비교 | 최대 3후보 등록·삭제·공통 분기 통계, 공간 version 차이·snapshot 한계 안내 | 실자료 3곳 대조 및 통합 시연 |
| 결측/오류 | 독립 로딩·부분 성공·취소/stale 차단·NULL/0/NO_ROW·미지원·모호성·미준비503 | 실제 자료에서도 같은 의미와 오류 처리 검증 |

지도 클릭은 지역 판정과 지원 조건의 500m 경쟁 카페 API를 요청하며, 단일 확정 동이 통계 lookup에 있으면 동 조건을 반영합니다. 단건 통계·추세는 기존 조회 버튼을 사용하고 추세는 항상 20251~20254입니다. 최대 3후보 비교는 별도 공통 분기를 사용하며 분기 변경 후 통계를 명시 재조회합니다. 지역·카페·후보 결과에 dataset version·품질·출처·snapshot 한계를 표시합니다. 2026-10-14에 실제 원본부터 Kakao 지도·3후보 흐름과 오류 복구를 최종 검증했습니다. 기존 DB는 NOT_READY입니다.

## 현재 위치와 지금 시작할 작업

7~10단계의 캡스톤 MVP·일회용 격리 실자료 시연 검증을 2026-10-14에 완료했습니다. 대표 실제 source 경계 2개와 bridge abort·재요청도 PASS이며, README 완료 표시와 더 넓은 backlog의 운영·발표·배포 범위를 구분합니다. 다음 우선 작업은 **코드 스타일 도구 도입, 코드 가독성·UI 정보 정리**입니다. 개발 DB 적용은 별도 안전 승인 트랙이고 운영 배포·성능·데이터 출처 및 snapshot 검증은 후속입니다. Git stage/commit/push는 최종 리뷰와 명시 승인을 기다립니다.

### 최근 완료한 범위

- **7~10단계 MVP 최종 검증**: 실제 source 경계 2개, 카페 클릭 4개 SQL/API, 최종 3후보 Q3 지표 SQL/API/UI, 후보 관리·오류 복구 및 bridge RST·복구 3회를 확인했습니다. E2E 전후 전수 무결성이 동일했고 소유 컨테이너 11개·네트워크 1개 정리 후 잔여 0이었습니다. [현재 상태](#구현-상태와-검증-수준)와 [상세 계약](technical.md#공간-조회-설계--api격리-검증)에서 대표 경계 사례와 원천 snapshot·역사적 경계·운영 한계를 구분합니다.
- **카카오맵 단일 위치 선택의 과거 검증**: 지도 클릭 좌표 저장·단일 마커 이동을 구현했고, SDK 1차 연동 당시 10월 12일 프론트엔드 116개 테스트·lint·build 및 실제 Chrome 지도 동작 검증 기록이 있습니다. 이후 분석·비교의 합성 검증과 별개이며 live SDK+실자료 전체 시연 완료를 뜻하지 않습니다.
- **Source Preservation Validator**: 받은 변경 전후 자료로 값·ID·NULL·좌표·이력 등의 보존을 비교하는 코드입니다. 실제 DB에서 자료를 수집하지는 않습니다.
- **비활성 Source Control**: 가짜 증거로 단계 전이를 연습하는 모델이며 실제 실행은 막습니다. 결과는 SIMULATED_ONLY입니다.
- **Source Audit·Provenance 계약**: 입력·코드·관찰 과정의 출처를 기록하고 서로 맞는지 검사하는 형식입니다. 성공도 CONTRACT_VALID_UNVERIFIED로 실제 DB 관찰의 증명은 아닙니다.
- **문서 통합**: 2차에서 활성 문서를 5개로 정리했습니다. 문서 작업의 완료이며 실제 source 적용 완료가 아닙니다.

세 source 모듈은 2026-10-14 일반 ETL 회귀에서 합성 계약을 검사했습니다. 실제 source collector/executor나 보호 DB 성공의 증거는 아닙니다. 과거 커밋 기록, 일반 무접속 회귀, 별도 격리 실자료 검증을 구분합니다.

### DB 접속 없이 준비할 수 있는 일

우선 코드 스타일 도구의 적용 범위와 기존 lockfile 정책을 검토하고 코드 가독성·UI 정보 구성을 정리합니다. 아래 목록은 함께 진행할 수 있는 독립 후속 작업입니다. 실제 DB 대신 가짜 입력·응답(mock)을 사용하는 계약·화면·테스트 설계부터 준비할 수 있으며, 가짜 검증을 실제 source 성공으로 표현하지 않습니다.

1. **가짜 연결로 감사 자료 수집 흐름 만들기 — A-02.** DB에 접속하지 않고 수집기의 질문(SQL), 응답 조립, 중간 실패 처리를 확인할 구조를 만듭니다. [source_audit](../etl/source_audit.py)의 입력 계약을 먼저 읽고, 이를 사용하는 ETL 수집 모듈(아직 없음)과 [ETL tests](../etl/tests/)가 작업 영역입니다. A-01 계약 검토 뒤, 필요한 증거의 완전한 조립과 누락·NULL·재접속·timeout 거부를 가짜 연결로 확인하는 것이 완료 기준입니다.

2. **Polygon 전후 보존 비교 계약 준비 — A-01, 이후 A-05.** [source_validation](../etl/source_validation.py)은 V1/V2/V3만 지원하므로 Polygon 적용 전후의 허용 변화와 보존 범위를 정해야 합니다. [publication](technical.md#불변성과-publication)·[V1 보존 조건](db-safety.md#v1-보존과-허용-변경)을 읽고 validator·[회귀 테스트](../etl/tests/test_source_validation.py)의 합성 입력 계약을 검토합니다. 승인 밖 변경·증거 부족을 거부하는 모의 검사와 독립 계약 리뷰가 준비 단계의 완료 기준입니다. A-05 실측은 별도 선행 조건이 필요합니다.

3. **통계·점포 원본 snapshot catalog 계약 보강 — B-02.** 공간 version·품질과 점포 UNVERIFIED 한계 표시는 구현했습니다. 아직 제공되지 않는 통계/점포 원본 snapshot·기준일·완전성 계약은 [자료 의미](technical.md#데이터-출처와-의미)·[현재 metadata 한계](technical.md#단위와-metadata)·[Backend DTO](../backend/src/main/java/com/example/backend/admindong/ApiResponses.java)·[Frontend types](../frontend/src/types/api.ts)를 기준으로 보강합니다. 2025년 통계와 파일명 202606 점포를 같은 시점으로 취급하지 않으며 실제 catalog·기존 DB 적용·원천 검증은 별도 후속입니다.

4. **구현된 위치 조회 API의 합성 회귀 유지 — B-04/B-05.** [공간 조회 계약](technical.md#공간-조회-설계--구현-전)과 [Location API](../backend/src/main/java/com/example/backend/location/)는 동 0/1/복수·상권 0..N·미준비/오류를 구현·합성 검증했습니다. 후속 지원 범위/원본 대조 계획과 회귀 사례를 보강하되 실제 SQL fixture 재실행은 새 격리 대상의 별도 승인이 필요합니다.

5. **분석·비교 화면의 가독성·UI 정리와 발표 준비 — B-07/B-09.** [App](../frontend/src/App.tsx)·[결과 컴포넌트](../frontend/src/components/)·[단일 조회 hook](../frontend/src/hooks/useAdminDongStats.ts)·[후보 비교 hook](../frontend/src/hooks/useCandidateComparison.ts)에 위치→지역/카페→통계·최대 3곳 비교가 연결돼 있습니다. 2026-10-14 실자료 핵심 흐름과 대표 경계 검증을 완료했고, 팀원 재현·발표·운영 성능은 별도 후속입니다. Mock 오류/취소/부분 성공과 실제 시연 증거를 구분합니다.

### 먼저 조건을 갖춰야 하는 일

실제 Source DB evidence 수집(A-03)은 대상·조회 범위를 별도 승인받고 같은 연결/transaction/snapshot에서 완전한 증거를 얻어야 합니다. evidence는 판단에 쓰는 관찰 자료이고, writer control은 자료를 확인하는 동안 값을 바꿀 수 있는 프로그램·계정·예약 작업을 통제하는 일입니다.

최신 백업·독립 복원(A-06), 격리 DB 검사(A-09), 실제 V2/V3/Polygon 적용(A-11)은 각각 선행 검증과 실행 범위 승인이 필요합니다. 실제 source FINAL은 읽기 전용 감사여야 합니다. [DB 안전 정책](db-safety.md)을 먼저 읽습니다.

기존 개발 DB를 사용하는 반경/지도/비교에는 해당 DB 적용뿐 아니라 별도 점포 snapshot 적재와 metadata도 필요합니다. 이번 일회용 격리 MVP의 PASS가 이를 대체하지 않습니다. V3 backfill은 대상 빈 필드만 채우므로 stores 전체 적재를 대신하지 않습니다. 전체 순서는 [트랙 A](#트랙-a--기존-db에-안전하게-적용하기)·[트랙 B](#트랙-b--사용자-기능-완성하기)를 확인합니다.

## 구현 과정과 주요 결정

### 실자료 통합 결과

#### 2026-10-14 최종 검증

새 독립 internal network·data/init tmpfs·DB host port 없는 환경에서 입력 8개 identity/hash와 고정 image를 확인한 뒤 prepare→migrate→load→verify→seal→serve→final→bridge를 완료했습니다. 기존 실행의 SID·port·자원을 재사용하지 않았고 실제 SQL 연결의 identity guard와 reader SELECT-only 권한을 유지했습니다.

| 검증 | 최종 결과 | 범위·한계 |
| --- | --- | --- |
| 원본·적재 | Polygon 425/1,650개, 점포 통계 141,218행·추정매출 67,113행·SEMAS 554,092행 전수 무결성 PASS | 원천 기준일·snapshot 완전성 증명은 별개 |
| 대표 경계 | source 경계 2개에서 좌표 왕복 오차 0, 동일 좌표 SQL→HTTP 및 복수 행정동 AMBIGUOUS_BOUNDARY PASS | 모든 좌표·역사적 경계 호환성 보장 아님 |
| 카페 | I21201/CAFE 22,739행. 실제 클릭 4개 count 138/202/221/266 및 list/distance SQL/API 일치 | 목록 최대 100개와 전체 count 구분, snapshot UNVERIFIED |
| 최종 3후보 | Q3 통계 9개 지표와 카페 count SQL/API/UI 일치, nearby UI 100개 목록 대조 PASS | Q4는 SQL/API 대조와 초기 UI·분기 전환 확인 범위 |
| 지도·후보 | 실제 SDK/tile/click, 최대 3후보·4번째 제한·삭제/교체·분기·늦은 응답·단일 실패 복구·다른 후보 유지·desktop/mobile PASS | 오류·지연은 QA 주입, 운영 부하 검증 아님 |
| Bridge | 실제 TCP RST 뒤 정상 HTTP 200 복구 3회, 중복 응답·미처리 handler 예외 0 | 연결 종료는 응답 작성 시 감지, 즉시 Java/JDBC 취소 미구현 |
| 종료 | E2E 전후 전수 무결성 일치, 소유 컨테이너 11개·네트워크 1개 cleanup 후 잔여 0 | 기존 보호 DB에는 SQL 접속하지 않음 |

일반 회귀 기록은 Backend 230 PASS, Frontend 235 PASS 및 ESLint/TypeScript/Build PASS,
Python 3.12.14의 ETL 277 PASS / 15 SKIP입니다. Bridge 안전 테스트 33 PASS는 ETL 277에 포함합니다.
실행 절차·대표 좌표·과거 수치는 [technical](technical.md#실자료-격리-시연)에 둡니다.

#### 2026-10-13 v2 과거 검증

2026-10-13에 `etl/demo.py`의 독립 경로로 internal network·host port 없는 새 PostgreSQL/PostGIS·data/init tmpfs를 준비했습니다. V1/V2/V3는 원본 그대로 적용했습니다. 실제 Flyway·ETL·JDBC 연결에서 database/current_user/session_user/system identifier/PGDATA/port/timeout을 확인하고, 적재 후 reader SELECT 권한만 허용하며 owner의 새 로그인을 차단했습니다. 기존 source/test guard와 보호 DB 경로는 변경하지 않았습니다.

| 검증 | v2 당시 결과 | 당시 범위·한계 |
| --- | --- | --- |
| 원본·적재 | ZIP 2개·report 3개·CSV 3개 SHA 일치. 통계 141,218/67,113행, 점포 554,092행 전수 projection 일치 | 원본 기준일·배포 이력·완전성은 파일 identity와 별개 |
| 지역 | Polygon 425/1,650개 전수 geometry hash/SRID 대조, 실제 overlap·hole·복수 상권·H5 SQL/HTTP 일치 | 정확한 경계 점의 4326 왕복은 INTERIOR로 관측, 실자료 exact boundary 사례 미충족 |
| 카페 | I21201/CAFE 22,739행, 유효 POINT 554,092개, 3곳 count 155/291/123 및 목록·거리·정렬 일치 | snapshot UNVERIFIED, 실제 기준일 미확인 |
| 3곳 통계 | 명동·서교동·성수2가3동의 CAFE/500m, 2025 Q4·Q3 API/SQL/UI 일치. 실제 클릭 카페 196/289/119, 교체 좌표 92 | 클릭 좌표는 고정 기준 좌표와 다름. 원자적 원천 snapshot publication 증명은 아님 |
| Chrome v2 | 실제 SDK/tile/click·3후보/4번째 제한·삭제/교체·Q3/stale·단일 통신 중단/복구·1440/390px·키보드·가로 overflow 검증 | 통신 중단은 명시 QA 주입, Mock SDK/성공 API 데이터 주입 없음. exact boundary 별개 |
| 성능 | 실제 API SQL GiST 사용. Nearby 519~678ms, 지역 12~22ms SELECT EXPLAIN | Nearby 전역 554,092행 inventory 스캔 비용, 운영 SLA 증명 아님 |

v2의 source/DB 전후 projection은 동일했지만 당시 exact boundary 사례는 미충족이었습니다. 이 항목은 2026-10-14 대표 source 경계 2개에서 검증했으며 모든 좌표의 보장으로 확대하지 않습니다. 원천 snapshot의 기준일·원자적 publication을 VERIFIED로 바꾸지 않았습니다. 2025 행정동 매출은 파일명 202606 점포의 반경 매출이 아니며 추천·수익·성공 점수를 만들지 않습니다. 보호 개발 DB의 적용 준비 상태는 계속 NOT_READY입니다.

먼저 작은 통계 조회를 끝까지 연결하고, 이를 위치 기반 서비스로 확장할 자료와 안전 조건을 준비해 왔습니다. 아래 네 흐름을 읽은 뒤 상세 표의 단계 번호와 Git 근거를 확인하면 됩니다.

### 1. 통계를 조회하는 작은 흐름부터 만들었다

처음에는 어떤 자료가 있는지, 동·업종·분기로 연결할 수 있는지 확인했습니다. CSV를 읽고 검증·변환해 DB에 넣는 Python ETL을 만들고, 저장된 수치를 Spring API로 조회해 React에서 보여줬습니다. 이 연결을 확인한 뒤 같은 조건의 네 분기 추세를 추가했습니다.

[당시 계획](https://github.com/jinwooorp/RecycleYoungs/blob/16aa2313f3d77420fb1fe29d53fbef7b16c517e7/README.md)은 최종 지도/비교를 한 번에 만들기보다 카페 한 업종·공통 분기의 매출/점포 조회부터 시작하도록 정했습니다. 지도에 결과를 그리기 전에 자료의 코드·기간·NULL과 실제 조회값을 연결하는 개발 순서였습니다. 현재는 행정동 선택 통계 조회와 지도 단일 위치 선택을 각각 구현한 상태입니다.

DB 구조는 버전별 SQL 변경 작업인 Flyway migration으로 관리했습니다. 처음 통계/점포 구조가 V1입니다. 자료를 보존하고 조회하는 기준을 만든 뒤 API와 화면을 연결한 과정은 아래 기반 표에 있습니다.

### 2. 위치를 판정할 경계를 준비했다

행정동 이름 선택을 지도 위치 선택으로 바꾸려면 좌표가 어느 동·상권에 들어가는지 알아야 합니다. 대표 POINT는 지역을 대표하는 한 좌표라 지역 전체 범위를 설명하지 못합니다. 그래서 다각형 경계인 Polygon의 좌표계와 도형 품질을 조사했습니다.

경위도 좌표(EPSG:4326)와 이 프로젝트 경계의 평면 좌표(EPSG:5181)를 구분하고 원본 도형과 조회용 도형을 함께 보존했습니다. V2는 경계와 입력/처리 버전을 저장하는 구조, V3는 SEMAS 카페 코드를 내부 CAFE에 연결하고 대상 빈 필드만 채우는 backfill입니다. 경계 원본을 적재하는 Polygon ETL은 migration과 별도입니다.

현재 공식 경계가 2025년 통계 집계 당시와 같다는 근거는 아직 부족합니다. 이를 숨기지 않고 operational 경계로 MVP를 개발하도록 정했으며 원본 overlap·홍지문 속성 충돌도 남깁니다. [공간 자료 한계](technical.md#미해결-원본-한계)에 정확한 정책이 있습니다.

### 3. 기존 DB를 보호하는 검증을 진행했다

기존 개발 DB에는 적재한 통계값·ID·NULL·좌표와 Flyway 이력이 있습니다. 새 구조를 추가하고 일부 업종 필드를 채울 때 승인 밖에서 자료가 바뀌면 기존 결과를 신뢰하기 어렵습니다. full loader처럼 기존 행을 지우고 다시 채우는 명령은 이 보존 작업에 사용할 수 없습니다.

먼저 기존 DB와 분리한 격리 환경에서 migration·Polygon 적재를 실행하고, 백업을 새 DB에 독립 복원해 변경 전후를 대조했습니다. 실패 시 행 변경을 취소하는 rollback만 믿지 않고 sequence처럼 따로 움직이는 상태도 검사했습니다. 기능 개발 순서에 더해 기존 자료를 보호하기 위한 준비였습니다.

8-C 계열 번호는 이 검증 과정을 구분하는 작업명입니다. 격리 성공·실제 source read-only 관찰은 각각 범위가 다르고 실제 적용 승인도 별도입니다. 상세 기록은 아래 표와 [DB 검증 근거](db-safety.md#과거-검증과-git-근거)에 있습니다.

### 4. 지금은 실제 적용 전의 증거 수집과 실행 경계를 준비한다

현재 Source Preservation Validator는 **받은 변경 전후 자료를 비교하는 검사기**, Source Audit·Provenance는 **자료의 출처를 기록하고 묶는 형식**, 비활성 Source Control은 **가짜 증거로 순서를 연습하고 실제 실행을 막는 모델**입니다. 이들이 있다고 실제 DB의 증거가 자동 수집되거나 적용되는 것은 아닙니다.

실제 read-only collector는 같은 DB 연결에서 필요한 자료를 빠짐없이 읽는 수집기이고, 실제 source 실행 경계는 승인된 변경의 실행 결과를 증거와 보존 검사에 연결하는 경로입니다. 둘 다 아직 없습니다. 다음에는 가짜 연결로 수집 흐름을 검증하고 실제 수집·최신 백업/복원·권한·중단 정책을 준비해야 합니다.

그래서 SQL과 격리 검증 기록이 있어도 기존 DB는 NOT_READY입니다. **코드가 존재하는 단계와 실제 적용 가능한 단계는 다릅니다.** 사용자 기능은 별도 mock 설계와 승인된 격리 fixture 개발로 진행할 수 있습니다.

### 상세 마일스톤을 읽는 방법

각 행은 필요한 이유와 구현/선택, 당시 확인한 검증, 남은 범위를 연결합니다. 날짜는 2026년 Git 기록이고 링크는 고정 커밋입니다. 전체 commit 목록이나 실행 로그를 복사한 표는 아닙니다.

### 기반·통계·API·화면

| 시기·Git 근거 | 목적·구현·선택 | 검증과 남은 범위 |
| --- | --- | --- |
| 9/23 [초기 기획](https://github.com/jinwooorp/RecycleYoungs/commit/2cd0b66d9a93169c86d62ee0298496432f260d3b) | Spring/React 기반·CORS와 서울 후보 비교 목표. 기존 CSV/Prisma 실험과 서비스 분리 | 초기에는 분석 API/실자료/화면 미구현. legacy 보존 |
| 9/30 [e5642db](https://github.com/jinwooorp/RecycleYoungs/commit/e5642dba274a369a11a89fb8a9605e7b964b944c) | Python ETL·manifest·입력 검증·자료별 책임 정리 | 당시 일부 DB rollback은 fake connection. 실제 적재는 다음 단계 |
| 10/3 [2075100](https://github.com/jinwooorp/RecycleYoungs/commit/2075100f044774a03a2f0d0ce4137cb629de3762) | 행정동 두 통계의 key/NULL/정수 정밀도·적재 | 전수 대조·재실행·timeout rollback 기록. sequence 별도, 다른 세 table 미적재 |
| 10/3 [9975452](https://github.com/jinwooorp/RecycleYoungs/commit/9975452d0f1bb98a09de01d01410af05e6d9190b) | SQL 조회 중심 JdbcClient, 기존 SQL을 Flyway V1로 이전 | 당시 V1 기존/fresh 연결 검증. V2/V3 source 적용 아님 |
| 10/3 [d808b76](https://github.com/jinwooorp/RecycleYoungs/commit/d808b7681c6974e8ba7cf44347297a2137d3ff87) | 계약 확정 후 lookup/단건 API·무결성·결측/BIGINT | 당시 일반/DB/격리 fixture·HTTP 기록. 공간 API 없음 |
| 10/4 [28dd582](https://github.com/jinwooorp/RecycleYoungs/commit/28dd582565abf4776cb8d3f077ad4925f8af4e44) | 조건 선택·명시 조회·취소·오류/결측 UI | 당시 test/lint/build·실제 API·390/1280px 기록 |
| 10/6 [786cc6b](https://github.com/jinwooorp/RecycleYoungs/commit/786cc6b992285d871fbbed788bd91410367577de) | Tailwind/shadcn Button/Card, native 입력/표 유지 | 당시 회귀·proxy/API 재대조. 미사용 UI/Chart 미도입 |
| 10/6~7 [2f1997c](https://github.com/jinwooorp/RecycleYoungs/commit/2f1997c9097d0f24e1a44e41cdd3c840a654ec96)·[c8b7afa](https://github.com/jinwooorp/RecycleYoungs/commit/c8b7afa28e5f40d96bba2ec928be00de72b3dcea) | 고정 네 분기 API·표, 두 table 다중 분기 SQL, 독립 상태 | 당시 unit/DB/fixture/browser·precision. 기간 확대 후속 |
| 10/7 [02bf29d](https://github.com/jinwooorp/RecycleYoungs/commit/02bf29d4fa7ca6007f28543597a8e94cd7dc36ae) | 독립 clone/fresh DB에서 CSV=DB=API=React | 같은 PC 재현. 팀원 PC 증거 아님, fixture SKIP 분리 |
| 10/12 카카오맵 1차 연동 `b6be37c`·[KakaoMap](../frontend/src/components/KakaoMap.tsx)·[SDK 로더](../frontend/src/lib/loadKakaoMaps.ts) | SDK 공유 로딩·좌표 state·단일 마커·StrictMode·오류/정리 회귀 | 당시 프론트엔드 116 tests/lint/build PASS·Chrome 지도 검증 기록. 통계 API와의 전체 흐름 미검증 |

당시 검증 원문과 삭제된 Backend/Frontend README의 기록은 [technical Git 근거](technical.md#기술-결정과-git-근거)에 연결합니다. 과거 테스트 수는 현재 HEAD PASS 건수로 재사용하지 않습니다.

### 공간 자료·schema·ETL

| 시기·Git 근거 | 목적·구현·선택 | 검증과 남은 범위 |
| --- | --- | --- |
| 10/7 [60a7ca2](https://github.com/jinwooorp/RecycleYoungs/commit/60a7ca27822d6075099751e7bfdb2cab28d16831)·[e752278](https://github.com/jinwooorp/RecycleYoungs/commit/e752278a9f7a47710d15911f5f742f4a86571a35) | CRS·code/name·overlap·역사적 경계·H5 조사 | B/UNRESOLVED·H5 충돌. 파일/code 일치≠역사 경계 동일 |
| 10/7 [a72514a](https://github.com/jinwooorp/RecycleYoungs/commit/a72514a73c985a62f62ea554531a1d749e5fa4b7)·[c6ae60c](https://github.com/jinwooorp/RecycleYoungs/commit/c6ae60cf58ca085db1d827c300c3ee1511e48f44) | operational 경계 MVP·I21201 통합 CAFE 경쟁군 | 역사적 한계·overlap 유지, 순수 커피군/타 업종 확정 아님 |
| 10/7 [10384c5](https://github.com/jinwooorp/RecycleYoungs/commit/10384c550044839b73df99d44262f4db22432755) | 대안 비교 후 여섯 linework repair·hash/profile | buffer(0)은 진단용, 임의 repair/fallback 금지 |
| 10/7 [25f03ce](https://github.com/jinwooorp/RecycleYoungs/commit/25f03ce7bc6396606c9cc2656781d38f46efaed5) | source/operational·version/current·cardinality·V2/V3 분리 | 당시 DDL spike는 합성 격리. exact 정책은 technical |
| 10/8 [90c66fe](https://github.com/jinwooorp/RecycleYoungs/commit/90c66fe451836e703acf43409a1e823694b92ca4) | V2 공간 DDL·V3 SEMAS 최소 backfill | SQL 존재≠기존 DB 적용 |
| 10/8 [c514224](https://github.com/jinwooorp/RecycleYoungs/commit/c51422489427eac024ead14591df68f67b7ea829)·[ad290d0](https://github.com/jinwooorp/RecycleYoungs/commit/ad290d0878ea247eefc747682b6c7b616d648329) | 별도 Polygon 준비/publication·source별 점포 ETL | 당시 격리 geometry/rollback/동시성·전체 점포 logical replay. full loader는 source backfill용 아님 |

### 격리 검증·기존 DB 보호·source 계약

| 단계·Git 근거 | 필요했던 이유와 결과 | 여전히 남은 것 |
| --- | --- | --- |
| 8-C1 [b611358](https://github.com/jinwooorp/RecycleYoungs/commit/b6113585ea4c2ba10d1edf3d57ec999403e9b5dd) | Fresh/Populated 전체 ETL·V3·Polygon·backup/분리 restore·공간/index | 기존 DB 미접속. radius/API/UI·역사적 경계 증명 아님 |
| 8-C2A [deaed745](https://github.com/jinwooorp/RecycleYoungs/commit/deaed745b31fdcb16355ecc241f46b3dc2b46045) | source READ ONLY/RR 감사·exported snapshot dump·격리 restore | 최초 restore owner/ACL 제외, 적용 승인 없음 |
| 8-C2B-1 [38e8732](https://github.com/jinwooorp/RecycleYoungs/commit/38e87328e843e78419e4a1c0dd5584fbf3a326b7) | source backup 기반 V2→V3→Polygon 격리 리허설 | 원본 role/login/authentication·실사용자 source write 미검증 |
| 8-C2B-2 [bde7050](https://github.com/jinwooorp/RecycleYoungs/commit/bde7050ee99e65c45fd276e20394bd41c720cb46) | role/ACL clone·source read-only SDK·test-only gate | 격리 인증, 합성 gate=SIMULATED_ONLY, NOT_READY |
| 8-C2B-3 [c36f44f](https://github.com/jinwooorp/RecycleYoungs/commit/c36f44fb204fa77ffd77cb4595a63be57f6967bb) | 격리 11단계 runner·JDBC/publication identity·hash/STOP | 과거 backup/empty stores profile. source SQL 미접속 |
| 10/11 [21888b8](https://github.com/jinwooorp/RecycleYoungs/commit/21888b8792be9e4f5da6ee5ef5ad6826a1a8a614) | Source Preservation Validator: values/IDs/NULL/POINT/catalog/ACL/sequence/history | 순수 비교, V1/V2/V3만 지원, 실측 collector 없음 |
| 10/11 [eda3430](https://github.com/jinwooorp/RecycleYoungs/commit/eda3430ac0cd4ec405cd8d61ae4b2ca83e0d90f8) | 비활성 Source Control: inspect·합성 전이·실행 거부·UNKNOWN/STOP | SIMULATED_ONLY, validator 수집 wiring·durable state 없음 |
| 10/11 [d06f675](https://github.com/jinwooorp/RecycleYoungs/commit/d06f675921b1edc34d38ef6646fdbb48bc66533e) | Audit/Provenance serialization·claim 결속 | 성공도 CONTRACT_VALID_UNVERIFIED, collector/실행/이전 증거 실측 없음 |

8-C2B-4는 위 계약을 포함해 일부 준비가 진행됐지만 **최종 안전 설계·실측 경로 전체가 완료된 단계는 아닙니다.** 실측 환경·제한·고정 보고서는 [db-safety](db-safety.md#과거-검증과-git-근거)가 관리합니다.

## 구현 상태와 검증 수준

먼저 코드가 있는지, 어느 환경에서 검증 기록이 있는지, 기존 DB에 실제 적용됐는지를 나눠 읽습니다. IMPLEMENTED는 첫 번째 질문에만 답합니다. 테스트 파일과 실행 결과도 다릅니다. 아래 상태 설명을 참고해 마지막 열의 사용자 제공 범위와 남은 작업까지 확인합니다.

| 상태 | 의미 |
| --- | --- |
| IMPLEMENTED / PARTIALLY_IMPLEMENTED | 코드 존재 / 명시한 일부 범위만 구현. 테스트/사용자 완성/DB 적용 아님 |
| UNIT_VERIFIED | 확인한 단위 실행 기록. 해당 항목의 검증 날짜·범위로 한정 |
| ISOLATED_VERIFIED | 확인한 격리 실측 기록, source 성공 아님 |
| LIVE_VERIFIED | 명시한 날짜의 실제 SDK·격리 API/DB·UI 검증. 운영 배포·보호 DB 적용 아님 |
| SOURCE_READ_ONLY_VERIFIED | 당시 실제 source read-only 기록 |
| SOURCE_APPLIED | 당시 실제 source 구조/자료 적용 확인, 현재 재조회 아님 |
| DESIGNED_ONLY / NOT_IMPLEMENTED | 설계만 존재 / 구현 없음 |
| BLOCKED | 선행 계약·실측·승인 미충족 |

| 영역·코드 근거 | 구현 | 확인한 검증 기록 | 기존 DB 적용·사용자 제공·남은 작업 |
| --- | --- | --- | --- |
| [AdminDong API](../backend/src/main/java/com/example/backend/admindong/) | IMPLEMENTED | UNIT_VERIFIED·ISOLATED_VERIFIED(과거 및 이번 실자료 SQL/HTTP 대조) | 새 시연 DB의 2025년 통계 연결 검증. 기존 DB는 현재 미조회 |
| [App/client/hook](../frontend/src/App.tsx) | IMPLEMENTED | 과거 회귀 및 2026-10-14 LIVE_VERIFIED | 3후보/분기/삭제/교체/부분 실패·늦은 응답·통계 대조 PASS. 가독성·UI 정리 후속 |
| [KakaoMap](../frontend/src/components/KakaoMap.tsx)·[SDK 로더](../frontend/src/lib/loadKakaoMaps.ts) | IMPLEMENTED(단일 선택) | 2026-10-14 실제 SDK/tile/click·마커와 3후보 연결 | 등록된 localhost:5273과 서버 loopback 바인딩 구분. 원본/공간 한계 유지 |
| [V1](../backend/src/main/resources/db/migration/V1__initial_schema.sql)·동 통계 ETL | IMPLEMENTED | SOURCE_READ_ONLY_VERIFIED(당시 C2A/B2) | SOURCE_APPLIED(당시 V1 구조/두 통계), 현재 미조회 |
| [CSV ETL](../etl/app/main.py) | IMPLEMENTED | UNIT_VERIFIED·ISOLATED_VERIFIED(당시) | source 전체5job 적용 아님, full loader 별도 범위 |
| [V2/V3](../backend/src/main/resources/db/migration/) | IMPLEMENTED·BLOCKED | ISOLATED_VERIFIED(당시 C1/B1/B2/B3) | 마지막 source 미적용 기록, 최신 gate·승인 필요 |
| [Polygon ETL](../etl/app/spatial_main.py) | IMPLEMENTED | ISOLATED_VERIFIED(과거 및 이번 실제 서울 원본 전수 대조) | 새 시연 DB 적재 검증. 기존 DB 적용은 BLOCKED |
| [격리 control](../etl/control.py) | IMPLEMENTED | ISOLATED_VERIFIED(당시 B3) | 운영자 검증용·과거 고정 profile, source 모드 없음 |
| [source_validation](../etl/source_validation.py) | IMPLEMENTED | 2026-10-14 일반 ETL 단위 회귀 PASS, 과거 커밋 실행 결과 미확인 | 실제 수집 없음, Polygon stage 없음 |
| [source_control](../etl/source_control.py) | IMPLEMENTED | 2026-10-14 일반 ETL 단위 회귀 PASS, 과거 커밋 실행 결과 미확인 | inspect/합성 모델, 실행 불가 |
| [source_audit](../etl/source_audit.py) | IMPLEMENTED | 2026-10-14 일반 ETL 단위 회귀 PASS, 과거 커밋 실행 결과 미확인 | UNVERIFIED contract, 실제 source 실측 없음 |
| fake/실제 collector·executor·durable STOP | NOT_IMPLEMENTED·BLOCKED | 없음 | 트랙 A 선행 작업 |
| [7단계 좌표/동·상권 API](technical.md#공간-조회-설계--api격리-검증) | IMPLEMENTED | UNIT_VERIFIED·ISOLATED_VERIFIED·2026-10-14 LIVE_VERIFIED | 대표 source 경계 2개 SQL→HTTP·복수 membership·모호성 PASS. 모든 좌표·역사적 경계 호환성 보장 아님 |
| [8단계 반경 경쟁 카페](technical.md#반경-500m-경쟁-카페-api) | IMPLEMENTED | UNIT_VERIFIED·ISOLATED_VERIFIED·2026-10-14 LIVE_VERIFIED | SEMAS 전수 적재·분류/POINT·4개 클릭 SQL/API 및 UI 대조 PASS. snapshot UNVERIFIED·운영 부하 미검증 |
| [9단계 후보 비교·자료 한계 UI](technical.md#최대-3곳-후보-비교--frontend-orchestration) | IMPLEMENTED | UNIT_VERIFIED·MOCK_VERIFIED·2026-10-14 LIVE_VERIFIED | 3후보 관리·실패 복구·Q3 통계 9개 지표 SQL/API/UI 및 전후 무결성 PASS. 원자적 snapshot publication·운영 부하 미검증 |
| [10단계 실자료 통합](technical.md#실자료-격리-시연) | IMPLEMENTED | 2026-10-14 ISOLATED_VERIFIED·LIVE_VERIFIED | ETL→PostGIS→Spring→React→Kakao Maps·RST 복구3회·소유 자원 cleanup PASS. 운영 배포·기존 DB 적용은 별도 |
| 통계/점포 원본 snapshot catalog·추가 지표·점수 | DESIGNED_ONLY 또는 NOT_IMPLEMENTED | 없음 | 통계 snapshot/version 제공·원본 기간/완전성·추가 자료/계산식 계약 필요 |
| 역사적 B·홍지문 H5 | BLOCKED | 미해결을 확인한 원본 조사 | 공식 근거 없이 보정 금지 |

세 모듈의 이전 커밋 실행 기록은 확인하지 못했지만 2026-10-14 일반 ETL 회귀는 PASS였습니다. 실제 source 관찰·collector·executor·적용은 여전히 미완료입니다. 과거 보호 DB V1의 BASELINE 편입 기록과 새 시연 DB의 V1 SQL 실행 history를 구분합니다.

## Now / Next / Later

Now는 완료한 MVP와 구현·검증한 코드/계약, Next는 가독성·UI 및 별도 source 안전 준비, Later는 운영·자료 검증과 확장 범위입니다. 작은 착수 작업은 [현재 위치 안내](#현재-위치와-지금-시작할-작업), 정확한 의존성과 완료 기준은 다음 두 트랙에서 찾습니다.

| 구분 | 트랙 A | 트랙 B |
| --- | --- | --- |
| Now | Audit/보존/비활성 계약 구현, 기존 DB NOT_READY | 2026-10-14 7~10단계 MVP·격리 실자료 E2E·대표 경계·bridge 복구·cleanup 완료 |
| Next | 계약 리뷰→fake collector→실측 provenance·actor/writer·보존·backup/restore·durable STOP | 코드 스타일 도구 도입, 코드 가독성·UI 정보 정리, 발표·팀원 재현 준비 |
| Later | 추가 격리→독립 리뷰/명시 승인→V2/V3/Polygon-only | 운영 배포·성능·원천 출처/snapshot/catalog 검증. 추가 지표·업종·기간·점수는 자료/계산식 검증 뒤 검토 |

## 트랙 A — 기존 DB에 안전하게 적용하기

Audit 계약→fake connection collector→실측 수집/provenance→identity/writer/권한→보존 검증→최신 backup/독립 restore→durable STOP→격리 검증→독립 리뷰/승인→실제 적용 순서입니다. P0는 source 적용 필수 안전 조건입니다. 작업 ID는 관리 ID이며 기존 완료 단계 번호가 아닙니다. 표의 한 행이 한 작업입니다. 먼저 목적과 선행 조건을 읽고 완료 기준이 모의 검증인지 실제 관찰인지 구분합니다. DB 조회/변경 승인은 이 표로 대체되지 않습니다.

| ID·우선순위·현재 | 목적·구현 영역 | 선행 조건 | 완료 기준·검증 방법 |
| --- | --- | --- | --- |
| A-01 / P0 / 일부 IMPLEMENTED | Audit/보존 계약 리뷰, serialization/code hash·Polygon delta | source 세 모듈·SQL | supplied/합성/실측 구분, Polygon 계약·V2 reference 독립 리뷰, DB 없는 회귀 |
| A-02 / P0 / NOT_IMPLEMENTED | fake connection collector·실패 처리 | A-01 | 무접속 query/stream/evidence 조립·NULL/empty/불완전/재접속/timeout 모의 검증. 실측 PASS 아님 |
| A-03 / P0 / NOT_IMPLEMENTED | 실제 READ ONLY collector·provenance | A-02, source 조회 승인 | 같은 connection/RR transaction/snapshot의 full digest/catalog/ACL/history/sequence/projection, artifact/window/이전 증거 실존 결속. reconnect/recollect 거부 |
| A-04 / P0 / BLOCKED | actual identity·writer·role/ACL·actor | A-03, 대상/actor 정책 | full target/route·동일 반환 연결·effective privileges·writer 통제 창 확인. source 시험 write 금지 |
| A-05 / P0 / 일부 IMPLEMENTED | 실측 전후 V2/V3/Polygon 보존 결속 | A-03~04, 독립 V2 reference | 원행/ID/NULL/POINT/catalog/ACL/sequence/history·허용 delta만 전수 비교. legacy 부족/UNKNOWN 거부 |
| A-06 / P0 / BLOCKED | 최신 snapshot-bound backup·독립 restore | A-04~05, backup/격리 승인 | snapshot/sequence·owner/ACL/role·실사용자 복구 전수 대조, SHA/권한/private 보존. 과거 backup 대체 불가 |
| A-07 / P0 / NOT_IMPLEMENTED | durable crash/STOP·새 run·부분 복구 | A-03~06 | timeout/exit≠rollback, atomic 증거·중단 감지·자동 resume 금지·복구 별도 승인, 실패 모의/격리 검증 |
| A-08 / P0 / NOT_IMPLEMENTED | source 실행 경계·exit→collector→validator, RO FINAL | A-04~07 | 실제 JDBC/publication 동일 연결·최신 artifacts. flag 활성화 금지, FINAL load/retry dispatch 부재 확인 |
| A-09 / P0 / NOT_IMPLEMENTED | 동적 profile 격리 E2E·failure injection | A-08, 격리/raw 승인 | nonempty/zero/no-op/backfill/conflict·stale/tamper/UNKNOWN/timeout/부분 성공. 격리 retry 별도, 만든 자원만 정리 |
| A-10 / P0 / BLOCKED | 최종 설계·독립 리뷰·Go/No-Go·범위 승인 | A-01~09 | 최신 실측/복구/actor/예상변경/STOP 검토. READY만으로 실행 불가, 사람 승인 마지막 |
| A-11 / P0 / BLOCKED | V2→V3→admin→commercial Polygon-only source 적용 | A-10와 mutation 명시 승인 | 단계별 exit/history/checksum·전수 보존·실제 backfill·hash/profile/current 확인, 마지막 READ ONLY 감사 |

A-11은 full CSV/stores 적재·빈 table 채우기·metadata migration·기존 DB restore를 자동 포함하지 않습니다. 과거 B3 runner를 최신 source/backfill에 재사용하거나 격리 guard를 완화하는 것은 완료 방식이 아닙니다. 상세 판정은 [db-safety](db-safety.md)에 둡니다.

## 트랙 B — 사용자 기능 완성하기

통계·위치·500m 카페·최대 3후보의 핵심 MVP와 일회용 격리 실자료 시연을 2026-10-14에 완료했습니다. 아래 backlog는 README의 10단계보다 넓어 원천 catalog/controlled replacement·기존 DB 정책·운영·발표·배포까지 포함합니다. 따라서 일부 P1 항목이 미완료여도 이번 MVP 완료와 모순되지 않습니다. 원본 기준일·원자적 snapshot publication·운영 부하는 미검증이고 기존 DB는 NOT_READY입니다.

| ID·우선순위·현재 | 목적·구현 영역 | 선행 조건 | 완료 기준·검증 방법 |
| --- | --- | --- | --- |
| B-01 / P1 / BLOCKED | Backend dbTest·startup migration 정책 | V1~V3·안전 대상 구분 | version1 기대 검토, DB 없는/격리/source 명령 분리, 승인 격리 재현. 이번 코드 수정 없음 |
| B-02 / P1 / DESIGNED_ONLY | 통계/점포 catalog·DTO/API/UI | source/분기/snapshot/단위 정책 | 실제 관리값·missing/version/loadedAt 계약, fixture→원본→UI 대조. 공간/Flyway version 대체 금지 |
| B-03 / P1 / PARTIALLY_IMPLEMENTED | SEMAS controlled ingestion·보존/교체 정책 | B-02, mapping·별도 적재 승인 | 새 일회용 DB의 input/identity·전수 적재/분류/POINT 검증 완료. 운영 source 원자적 replacement·replay·snapshot 계약은 미완료 |
| B-04 / P1 / LIVE_VERIFIED | 좌표·행정동 membership API/DTO·통계 조건 연결 | 공간 정책·승인 READY 입력 | 2026-10-14 실제 source 경계 2개 SQL→HTTP·복수 membership/모호성 및 지도 연결 PASS. 모든 좌표·역사 호환성은 별개 |
| B-05 / P1 / PARTIALLY_IMPLEMENTED | 상권 0..N membership API/UI | B-04 좌표/version 계약 | 실자료 NO_MEMBERSHIP·복수 소속·H5 conflict 보존 및 live 결과 표시 PASS. 별도 상권 통계 선택 미구현 |
| B-06 / P1 / LIVE_VERIFIED | CAFE/I21201 반경 500m API·목록/UI | 새 격리 DB 전용 적재 승인 | 2026-10-14 전수 적재·4개 클릭 geography 거리/count/list100 SQL/API 및 UI 대조 PASS. EXPLAIN은 과거 기록, snapshot UNVERIFIED·운영 부하 미검증 |
| B-07 / P1 / LIVE_VERIFIED | 카카오맵 단일 선택·지역/카페 결과·수동 통계 연결 구현 | 현재 지원 범위의 B-04~06, 원천 metadata 한계 표시 | 2026-10-14 실제 SDK·실자료·취소/늦은 응답·오류 복구·desktop/mobile 핵심 시연 PASS. catalog/추가 지표는 후속 |
| B-08 / P1 / LIVE_VERIFIED | 최대3곳 Frontend 후보 비교 구현 | 현재 지원 범위의 B-04~07 | 2026-10-14 등록/삭제/교체/분기/단일 실패·늦은 응답 및 Q3 지표 SQL/API/UI PASS. 원자적 snapshot publication·운영 부하 미검증 |
| B-09 / P1 / PARTIALLY_IMPLEMENTED | 통합·a11y·성능·시연/발표/배포 | 넓은 B-01~08 계약·배포 대상 | 2026-10-14 핵심 MVP E2E·대표 경계·bridge 복구·mobile·cleanup 완료. a11y는 과거 v2 범위, 운영 부하·팀원 재현·발표/배포 후속 |
| B-10 / P2 / DESIGNED_ONLY | 인구/시설/변화 지표·기간 확대 | 공식 단위/기간/중복·경계 호환 | 의미→schema/ETL→API/UI, 반복값/중복합산 금지·공통 기간·원본/결측 대조 |
| B-11 / P2 / DESIGNED_ONLY | 설명 가능한 규칙 점수 | B-08와 필요한 B-10 자료 | 계산식/집단/가중치/model version·원지표·필수결측=null, fixture/수작업 검증 |
| B-12 / P2 / BLOCKED | 추가 SEMAS 업종·B/H5 조사 | 공식 분류/참조 경계/귀속 근거 | 포함/제외·mapping 충돌/NULL·최소변경 검증. 근거 전 UNRESOLVED 유지 |

상권 통계 확장의 commercial_areas/sales_commercial_area 적재도 별도 범위입니다. membership과 통계/대표점 부재는 다릅니다. 담당자·일정·기간은 근거 없이 지정하지 않습니다.

9단계 구현 당시인 2026-10-13에는 기존 location/nearby/stats·공유 lookup API를 재사용하고 Backend·DB/schema를 변경하지 않았습니다. Frontend 233개 테스트·lint/build·합성 API/Mock SDK Chrome 30개 체크는 그때의 검증이며 DB/Docker/Flyway/ETL/원본/백업에 접근하지 않았습니다. 이후 v2 실자료 시연과 2026-10-14 최종 E2E를 구분하며, 최신 Frontend 235 PASS는 표준 줌 버튼 회귀를 포함합니다. README 7~10단계는 MVP·격리 시연 완료이고 B-09 전체는 발표·운영·배포가 남아 부분 완료입니다. 분기 변경 정책과 통계/SEMAS의 시점·집계 단위·snapshot 한계를 유지하며 기존 DB는 NOT_READY입니다.

## 병렬로 진행할 수 있는 개발

source 적용 전 A-01~02 순수 계약/fake collector, B-02 metadata 설계·DTO/UI mock과 코드 스타일·가독성·UI 정리를 진행할 수 있습니다. B-04~08에서 구현한 API/화면/취소·결측 계약의 회귀를 유지합니다. 실제 SQL·geometry·점포 재검증은 승인된 새 격리 대상에서만 수행하며 보호 DB 적용이나 원천 출처/version 검증 완료로 보고하지 않습니다.

보호 DB 기반 통합·비교 완료는 안전 gate와 해당 자료 적용 검증에 의존합니다. A-11 뒤에도 stores가 자동 적재되지 않아 B-03이 필요합니다. 일반 test/mock과 opt-in·bootRun/dbTest를 [위험 명령](technical.md#위험-명령과-알려진-blocker)으로 구분합니다.

## 추가 지표와 점수 정책

서울 전체 인구를 후보 위치 수요로 쓰지 않습니다. 상주/직장인구 반복값·중복 합산, 시설의 지역 단위, 상권변화지표와 업종 성장률을 각각 검토합니다. 기간 확대는 공통 기간과 역사적 경계 호환성부터 확인합니다.

점수는 검증 자료 뒤 설명 가능한 규칙으로 검토합니다. 높은 값이 유리한 방향을 맞추고 같은 업종·분기·공간 유형 집단에서 정규화합니다. 계산식·가중치·집단을 model version으로 관리하고 원지표·기준 지역·기간·출처·결측을 제공합니다. 필수 자료 부재는 해당/종합 점수=null, 결측0점·후보별 가중치 재분배 금지입니다. 0~100은 상대 평가이며 성공확률이 아닙니다.

가중치는 확정 모델이 아닙니다. [caf6ace 당시 초안](https://github.com/jinwooorp/RecycleYoungs/blob/caf6ace7748717b05085fa30eac74df689952df8/docs/architecture.md#점수와-후보-비교--구현-전-정책)은 역사적 자료입니다. version은 실제 DB 관리 뒤 제공합니다.

## 현재 blocker와 미확정 사항

- 기존 개발 DB NOT_READY. actual collector/executor·실측 provenance·Polygon 보존 계약·durable STOP·최신 identity/writer/role/ACL·snapshot backup/restore·실사용자 경로·최종 리뷰/승인 미충족.
- PostgresConnectionTests version=1 기대와 startup migration 정책은 코드 검토 대상. 문서로 해결되지 않음.
- 7~10단계 MVP·격리 E2E는 2026-10-14 완료. 대표 경계 2개 PASS를 모든 좌표의 보장으로 확대하지 않으며 원본 기준일·원자적 snapshot publication·통계/점포 catalog·CAFE 외 SEMAS mapping 및 기존 DB 적용은 미완료.
- 역사적 B/UNRESOLVED·홍지문 H5/CONFLICT_OBSERVED·원본 overlap 보존. 공식 정의 미확보를 완료로 바꾸지 않음.
- B/H5 해결 미완료와 operational MVP 개발 가능 여부는 별개입니다. 한계 표시·확정 membership 정책을 지켜 개발하되 source 적용 안전 조건은 그대로 유지합니다.
- manifest 초기 CRS/후속 결론 시점·BOM 기록 차이는 [technical](technical.md#manifest와-후속-검증의-범위)에 구분. 2026-10-14 고정 입력 hash 검증과 원천 기간·완전성 검증은 별개.
- 카카오맵 SDK는 선택·연동됐으며 시연/배포 대상·추가 지표 필수 범위·점수 가중치는 미확정. 팀원 PC 재현 증거 별도 필요.
- 과거 합성/Mock·v1 SDK 실패·2026-10-13 v2와 2026-10-14 최종 검증을 구분함. 기존 DB/backup/권한/writer는 미조회. MVP·대표 exact boundary는 PASS이며 운영 부하·원천 snapshot 및 Git 최종 리뷰/승인은 별도.

완료는 코드·mock·몇 개 샘플만으로 판단하지 않습니다. 해당 환경의 입력/제외·원본/DB·값/NULL·단위/기간·연결·재실행·실패 보존을 대조하고 PASS/FAIL/SKIP·미실행·blocker를 구분합니다.
