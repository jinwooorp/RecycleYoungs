# 2026-10-31 공식 자치구 통계 원천 조사

2026-10-31에 서울 열린데이터광장의 설명, Open API 출력항목, Sheet 컬럼과 공개 `sample`을 확인했습니다. 이 최초 조사에서는 서비스별로 1~5행만 요청했고, 개인 인증키 사용·CSV 다운로드·개발 DB 접속은 없었습니다. 이후 제공된 로컬 CSV를 별도로 검증했습니다.

## 당시 메타데이터와 조사 경로

- 세 데이터셋의 제공기관은 서울신용보증재단, 갱신주기는 분기, 표시된 데이터 갱신일은 `2026-09-11`, 메타정보 수정일은 `2026-06-19`였습니다. 공공누리 제1유형의 출처 표시 조건을 확인했습니다. [OA-22173 점포](https://data.seoul.go.kr/dataList/OA-22173/A/1/datasetView.do) · [OA-22176 추정매출](https://data.seoul.go.kr/dataList/OA-22176/A/1/datasetView.do) · [OA-22179 길단위인구](https://data.seoul.go.kr/dataList/OA-22179/A/1/datasetView.do)
- 포털은 데이터셋 공개 폼 값으로 Open API 탭 `/dataList/openApiView.do?infId=…&srvType=A`와 Sheet 탭 `/dataList/sheetView.do?infId=…&srvType=S`를 POST 조회했습니다. 정적 추출에서 목록이 비어 보여도 컬럼·파일 제공 여부는 확인되지 않습니다. Sheet는 최대 1,000행 미리보기였고, Open API 안내는 일반 요청 최대 1,000건과 공개 sample의 1~5 범위를 명시했습니다.

## 공개 API 표본

| 자치구 원천 | 5행에서 관찰한 분기                | 응답의 `list_total_count` | 당시 표본 출처                                                                     |
| ----------- | ---------------------------------- | ------------------------: | ---------------------------------------------------------------------------------- |
| 점포        | `20262`                            |                    54,765 | [공개 XML 1~5행](http://openapi.seoul.go.kr:8088/sample/xml/VwsmSignguStorW/1/5/)  |
| 추정매출    | `20223`, `20224`, `20244`, `20261` |                    33,803 | [공개 XML 1~5행](http://openapi.seoul.go.kr:8088/sample/xml/VwsmSignguSelngW/1/5/) |
| 길단위인구  | `20242`, `20243`, `20244`          |                       550 | [공개 XML 1~5행](http://openapi.seoul.go.kr:8088/sample/xml/VwsmSignguFlpopW/1/5/) |

점포 표본에서 `SIGNGU_CD=11740`과 점포 수 `749.0`, `43.0`, `2.0`의 정수 의미 소수 표기를 확인했습니다. 표본은 필드와 값 표현을 확인한 기록입니다. 응답 메타데이터와 5행의 분기로 전체 제공 기간·최신 분기·구와 업종의 완전성을 판정하지 않았습니다. 위 HTTP 링크는 인증키 없는 당시 공개 표본 출처입니다. [현재 OA-22179 인증 probe와 HTTPS 차단](../etl-guide.md#서울시-open-api-전체-수집-probe)

## 구·동 출력 구조와 로컬 점포 CSV의 추가 관찰

| 지표       | 행정동 서비스                                                                                  | 자치구 서비스      | 당시 포털 출력 구조                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| 점포       | [OA-22172](https://data.seoul.go.kr/dataList/OA-22172/A/1/datasetView.do) · `VwsmAdstrdStorW`  | `VwsmSignguStorW`  | 각각 12개 필드                                                            |
| 추정매출   | [OA-22175](https://data.seoul.go.kr/dataList/OA-22175/A/1/datasetView.do) · `VwsmAdstrdSelngW` | `VwsmSignguSelngW` | 각각 53개 필드. 채택한 측정값 4개의 출력명 일치                           |
| 길단위인구 | [OA-22178](https://data.seoul.go.kr/dataList/OA-22178/A/1/datasetView.do) · `VwsmAdstrdFlpopW` | `VwsmSignguFlpopW` | 각각 25개 필드. 채택한 측정값 3개의 출력명 일치. 양쪽 모두 업종 차원 없음 |

지역 코드와 명칭은 행정동의 `ADSTRD_CD`·`ADSTRD_CD_NM`, 자치구의 `SIGNGU_CD`·`SIGNGU_CD_NM`으로 구분했습니다. 필드 구조가 대응해도 산정 기준·수치·판본의 동등성은 확인되지 않았습니다. 당시 매출 시간대 건수의 일부 Sheet label에는 `시간대_건수~06_매출_건수` 표기가 있었습니다. 현재 미채택 필드를 다룰 때는 실제 CSV와 영문 출력명을 다시 대조합니다.

공개 표본 조사 이후 제공된 점포 CP949 CSV에서는 12개 공식 한글 헤더와 개업률 최댓값 `100.0`을 확인했습니다. 비율 범위는 같은 로컬 파일의 독립 대조 결과입니다. [점포 CSV probe와 독립 조사](etl-validation-history.md#자치구-점포-csv-probe와-독립-조사-2026-10-31)

CSV 3종의 SHA-256·행 수·독립 조사·격리 적재·실제 개발 DB 배치 기록은 ETL 검증·적재 이력에 보존합니다. 조회일 공식 파일과 로컬 원본의 바이트 대조는 별도 후속 조사입니다. [CSV·DB 검증 기록](etl-validation-history.md#공공데이터-검증-현황) · [2026-11-05 공식 원천 후속 검증](official-source-verification-20261-20262.md)
