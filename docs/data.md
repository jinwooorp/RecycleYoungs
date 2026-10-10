# 데이터와 ETL 정책

정식 CSV 파일명·행 수·크기·SHA·헤더·기간은 [data/manifest.json](../data/manifest.json)이 기준입니다. 아래는 자료의 의미·연결·품질 정책이며 현재 DB 적재 건수를 뜻하지 않습니다. 원본 CSV/ZIP/SHP/report는 Git 제외 위치에 보존하고 문서 정리에서 열거나 바꾸지 않습니다.

## 출처와 기준 시점

| 자료 | 기준과 단위 | 사용 정책 |
| --- | --- | --- |
| 서울시 점포-행정동·추정매출-행정동 | 2025 Q1~Q4, 행정동+서비스 업종+분기 | 현재 통계 API의 공통 단위 |
| 서울시 추정매출-상권 | 2025 Q1~Q4, 상권+서비스 업종+분기 | 행정동 통계와 직접 결합하지 않음 |
| 서울시 영역-상권 CSV | 상권 code·대표 X/Y·면적, 기준 기간 열 없음 | 대표 POINT catalog. Polygon 포함 판정에 쓰지 않음 |
| SEMAS 서울 점포 | 파일명 기준 2026-06 snapshot, CSV 기준 날짜 열 없음 | 원본 점포 ID·소분류·경위도 보존, 반경 경쟁군 |
| 서울시 길단위인구-서울시 | 2021 Q1~2026 Q2, 서울시 전체 22행 | 위치별 수요 ETL에서 제외, 원본은 보관 |
| OA-22160/OA-15560 Polygon ZIP | 확보일 2026-10-07, 실제 역사적 경계 기준일 미확인 | 검증된 operational 경계와 통계 당시 경계를 구분 |

공식 출처는 서울시 [점포-행정동 OA-22172](https://data.seoul.go.kr/dataList/OA-22172/S/1/datasetView.do), [추정매출-행정동 OA-22175](https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do), [추정매출-상권 OA-15572](https://data.seoul.go.kr/dataList/OA-15572/S/1/datasetView.do), [행정동 경계 OA-22160](https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do), [상권 영역 OA-15560](https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do), SEMAS [상가정보 안내](https://www.data.go.kr/data/15012005/openapi.do)와 [공식 분류표](https://bigdata.sbiz.or.kr/#/notice/267352041576902656)입니다. 확인된 과거 제공 파일과 보관 CSV의 byte/SHA 일치는 최초 다운로드·배포 이력·정확한 이용 조건의 증명이 아닙니다.

서울시 CSV는 CP949, SEMAS CSV는 UTF-8-SIG입니다. 입력은 `data/raw/dataset/`이고 ZIP의 dataset 폴더를 유지합니다. 새 clone에는 원본이 없으므로 별도 확보가 필요합니다. 다른 hash·기간·지역 code·헤더를 기존 version으로 덮어쓰지 말고 원본을 보존한 뒤 목록과 검증 근거를 갱신합니다.

2025 통계와 2026-06 점포를 같은 기간 관측으로 취급하지 않습니다. snapshot 누락만으로 폐업을 판정하지 않습니다. 지역 집계 매출/인구를 반경 면적 비율로 임의 배분하거나 추정매출을 창업 수익·성공 확률로 재해석하지 않습니다.

## 데이터 연결과 업종

통계 두 원본은 같은 425개 행정동 code/name을 공유하지만 원본 업종 범위와 조합별 행 존재는 다릅니다. API lookup 전체 조합에 양쪽 자료가 있다고 가정하지 않습니다. 상권 매출의 1,577개 code는 영역의 1,650개에 포함되고 나머지 73개에는 매출이 없습니다. 영역 CSV의 행정동은 399개로 통계 425개와 다르므로 영역을 행정동 목록의 기준으로 삼지 않습니다.

| 내부 업종 | 서울시 `SEOUL` 원본 code | SEMAS 원본 code |
| --- | --- | --- |
| CAFE | CS100010 | I21201 |
| HAIR | CS200028 | 미확정 |
| KFOOD | CS100001 | 미확정 |
| PUB | CS100009 | 미확정 |
| GYM | 미매핑 | 미확정 |

두 source 체계를 혼용하지 않습니다. V1은 SEOUL 4개, V3는 SEMAS/I21201→CAFE reference를 추가합니다. stores ETL은 등록된 `(source, source_code)` mapping으로 industry_id를 채우며 미매핑/빈 code는 NULL입니다. 동등 source 없는 서울시 code를 SEMAS 점포에 연결하지 않습니다.

SEMAS I21201의 공식 통합 범주 전체를 MVP CAFE 경쟁군으로 채택했습니다. 커피전문점·다방뿐 아니라 주스·보드게임/사주/전통찻집/애견카페 등을 포함하며 순수 커피만의 집합이 아닙니다. KSIC/상호명으로 임의 재분류하지 않습니다. 빵/떡/빙수·버거·편의점·음료 소매·독서실/스터디카페의 다른 소분류는 제외합니다. 과거 원본 검사에서 I21201은 22,739개 고유 점포였고 좌표·ID 품질 검사를 통과했습니다. bbox sanity는 정확한 행정동 포함 판정이 아닙니다.

## 공간 데이터와 한계

- source와 operational Polygon은 **EPSG:5181**, V1 대표/점포 POINT는 **EPSG:4326**입니다. 영역-상권의 공식 CRS를 근거로 `AREA_SOURCE_CRS=EPSG:5181`을 명시하고 미설정 시 적재를 거부합니다. 축 선언·X/Y·always_xy와 출력 longitude/latitude 순서를 구분하며 임의 SRID 부여·Force2D를 하지 않습니다.
- OA-22160은 425개 valid 원본 Polygon이며 code/name은 2025 네 분기 통계와 일치합니다. 그러나 실제 경계 기준일·표준단위구역→행정동 환산/재집계 정책이 없어 **B/UNRESOLVED, 4단계 미완료**입니다. 파일/페이지 날짜나 같은 code가 역사적 경계의 동일성을 증명하지 않습니다.
- 현재 공식 operational 경계로 MVP를 진행하기로 했지만 2025 집계 당시의 정확한 경계라고 주장하지 않습니다. 원본 배포/변경 이력과 참조 정책의 추가 공식 근거는 미확인입니다.
- 행정동 원본의 양의 면적 overlap **13쌍**, 최대 약 **0.024527336747 m²**를 보존합니다. 접촉 경계와 내부 overlap을 구분하고 snap/round/trim·LIMIT 1로 숨기지 않습니다. 다중 match의 AMBIGUOUS_BOUNDARY 처리와 상권 0..N 규칙은 [조회 설계](architecture.md#후보-좌표-조회-설계)를 따릅니다.
- 상권 source는 1,650개 중 valid 1,644·invalid 6개입니다. geometry 품질과 raw 속성·매출/대표점 이름 차이·통계 부재를 혼동하지 않습니다.
- 홍지문 **3110531**은 **H5/CONFLICT_OBSERVED**입니다. SHP의 SIGNGU_CD=11110, ADSTRD_CD=11410660이 충돌하고 CSV 귀속도 다릅니다. 어느 raw 속성도 canonical 행정구역으로 임의 선택·자동 교정·FK/fallback에 사용하지 않습니다. 다른 feature의 UNVERIFIED는 모순 없음의 보증이 아닙니다.
- SHP와 CSV의 같은 code에 이름 차이 3건이 있으며 raw 이름을 자동 치환하지 않습니다. 경계 membership과 관련 통계/대표점 부재는 별개입니다.

### geometry 품질과 hash

valid source Polygon은 ST_Multi, valid MultiPolygon은 그대로 사용합니다. 원본 valid 행정동/상권에 make_valid를 호출하지 않습니다. invalid 상권 **3110137, 3110270, 3110234, 3110407, 3110515, 3110542**만 고정 ZIP/code/feature index/source WKB SHA/report의 acceptance에 따라 `make_valid(method="linework", keep_collapsed=True)`를 적용합니다. 원본은 invalid 상태로 보존하고 operational만 valid non-empty 2D MultiPolygon으로 저장합니다.

검증 profile은 pyshp 3.1.6·Shapely 2.1.2/GEOS 3.13.1 등을 고정합니다. 도구/입력/profile 변경 시 새 version과 재검증이 필요합니다. buffer(0) fallback·GeometryCollection/line/point 자동 discard·의미 변화 은폐는 금지합니다.

| 품질 | 의미와 허용 |
| --- | --- |
| VALID_SOURCE | valid nonempty Polygon/MultiPolygon, operational=ST_Multi(source), repair metadata NULL |
| REPAIRED_OPERATIONAL | invalid 원본 보존, acceptance를 통과한 operational·정확한 method/인자·invalid reason 필수 |
| REVIEW_REQUIRED | 예상 밖 type/성분·의미 변화, 비공백 이유와 source 보존, operational/hash·repair NULL, current 금지 |
| UNSUPPORTED | NULL/empty/미지원 원본을 구분해 이유 보존, operational/hash·repair NULL, current 금지 |

hash는 2D little-endian OGC WKB, SRID 미포함, ring/vertex normalize 없음입니다. source geometry SHA는 SHP 파일 SHA와 다르고 repair 직후 Polygon SHA는 저장 MultiPolygon SHA와 다를 수 있습니다. ST_Equals와 byte/hash 일치를 별도로 검증합니다. 정확한 입력/hash/profile 기준은 [spatial_sources](../etl/app/spatial_sources.py)와 [processing profile](../etl/app/spatial_geometry.py)의 고정 계약·검증 report를 확인하며 값을 문서에 복제하지 않습니다.

offline_base_profile_sha256에는 DB 정보가 없으며 publication 때 실제 PostgreSQL/PostGIS/GEOS/PROJ version을 포함한 전체 profile SHA를 계산합니다. Python/pyshp/Shapely/GEOS/pyproj/PROJ·구현 파일 SHA도 결속합니다. 실행 시각·DB ID·물리 입력 경로는 identity에서 제외하지만 catalog의 논리 report 경로와 bytes/profile은 고정합니다. 실행 중 report를 새로 만들어 acceptance를 승인하거나 ZIP/SHP를 재저장/재압축하지 않습니다. CP949 ZIP 이름·UTF-8 strict DBF·PRJ/field/count/code/type/Z/M·unpaired shape/record를 검사하고 DBF 우측 저장 padding 외 code/name normalization을 하지 않습니다.

## ETL와 입력 검증

CSV CLI의 기본 선택은 commercial_areas/store_stats_dong/sales_dong/sales_commercial_area/stores 5job입니다. 상권 대표/점포는 full snapshot 교체(TRUNCATE/ID 재시작), 통계는 해당 연도 DELETE/재삽입입니다. 선택한 CSV job 전체는 caller transaction 하나에 참여하며 실패 시 이전 DB 상태로 rollback합니다. 내부 ID의 재실행 동일성을 보장하지 않습니다.

stores는 TRUNCATE 전에 CAFE와 SEMAS/I21201 mapping 존재·일치를 확인하고 transaction에서 mapping을 한 번 읽습니다. V3는 기존 I21201/industry_id NULL만 최소 backfill하므로 full stores loader를 기존 DB 보존/backfill에 사용하지 않습니다. 세부 승인·예상 변경은 [db-safety](db-safety.md)에 둡니다.

Polygon CLI는 CSV CLI와 독립적이고 기본은 검증만 합니다. 전체 입력을 prepare/검사한 뒤 explicit DSN과 guarded connection으로 kind별 publication을 수행합니다. READY/current·동등 재실행·rollback은 [architecture](architecture.md#불변성과-publication)의 계약입니다.

새 입력 검증은 encoding/header·복합 키·NULL/0·입력=유효+제외·기간/분포·source mapping·finite 좌표/축/CRS를 확인합니다. Polygon은 source feature/type/2D·code/name·NULL/empty/invalid·중복·overlap·hole·통계 코드 양방향 차집합과 네 분기 역사적 호환을 각각 기록합니다. 단순 행 수/code 일치·명령 성공·mock PASS를 실제 geometry/DB/역사적 호환 PASS로 바꾸지 않습니다.

실행과 DB 없는 테스트는 [development](development.md), 기존 DB mutation 전 검증은 [db-safety](db-safety.md)가 기준입니다. 상세 원본 검사·repair 수치와 공식 조사 기록은 [deaed745의 프로젝트 기록](https://github.com/jinwooorp/RecycleYoungs/blob/deaed745b31fdcb16355ecc241f46b3dc2b46045/docs/project-status.md)에 보존돼 있습니다.
