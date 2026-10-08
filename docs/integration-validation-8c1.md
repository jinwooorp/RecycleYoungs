# 8-C1 격리 전체 통합 검증

검증일: 2026-10-08(Asia/Seoul). 기준 `main/ad290d0878ea247eefc747682b6c7b616d648329`, local/remote 동일·clean 시작. 대상은 이미 구현된 V1/V2/V3, 기존 CSV ETL, Polygon ETL, SEMAS materialization입니다. production 기능·migration·원본·dependency·Compose/Makefile을 변경하지 않습니다. 기존 개발 DB 적용은 [별도 8-C2 실행 계획](development-db-8c2-runbook.md)이며 이 기록과 구분합니다.

## 검증 도구와 안전 조건

- [integration_support.py](../etl/tests/integration_support.py): 연결 전 isolation proof 확인, V1-only/empty snapshot fixture, 서버 cursor streaming snapshot, V1 보존/논리 비교.
- [integration_check.py](../etl/tests/integration_check.py): 명시적 inputs/v1-stores/snapshot/source/compare CLI. 기본 DSN 없음, `--help`·inputs·compare는 DB에 접속하지 않음.
- [integration_spatial.py](../etl/tests/integration_spatial.py): 실제 전체 geometry inventory, ST_Covers 고정 원본 표본과 13쌍 overlap, ANALYZE/EXPLAIN.
- [test_integration_support.py](../etl/tests/test_integration_support.py): DB-free guard/NULL·순서·length framing/ID·sequence·분류 변경 감지 검사. Python `-O`로 assertion을 비활성화한 실행은 거부.

DB mode는 Docker inspect에서 얻은 proof를 요구합니다. proof에는 container ID·internal network·port binding 없음·mount 없음·data/init-dir tmpfs·실제 PostgreSQL system_identifier를 기록합니다. DSN은 명시적인 host/port/dbname/user/password만 허용하며 localhost·hostaddr·service·개발 DB 이름/user를 거부합니다. 환경의 PGHOSTADDR/PGSERVICE/PGSERVICEFILE/PGSYSCONFDIR/PGOPTIONS override도 접속 전에 거부합니다. 임시 host `ry-8c1-db-*`와 테스트 DB prefix를 검사한 뒤 서버 identifier도 대조합니다. prefix/proof 파일만으로 실제 격리를 보증하지 않으므로 **매 Docker 명령 직전 실제 inspect를 재확인하는 실행 절차가 필요**합니다. proof를 수작업으로 조작해 연결 검사를 우회하지 않습니다.

V1 stores fixture는 위 guard를 거친 전용 connection에서만 동작하며 실제 Flyway V1-only·empty stores·SEMAS mapping 없음까지 검사합니다. production stores loader를 호출하거나 mapping을 mock하여 V1 적재를 우회하지 않습니다. 원본 UTF-8-SIG CSV를 streaming COPY하면서 기존 clean_text/좌표/POINT 규칙과 NULL industry_id 정책을 재현합니다. TRUNCATE는 없습니다. production/backfill 명령으로 사용하지 않습니다.

이번 환경의 생성/정리 driver·전체 실행 로그·JSON snapshot·백업은 저장소 밖 `/tmp/ry-8c1-xa4EnE/`에 보관합니다. 재사용할 검사 코드만 repository에 둡니다. 원본과 app/tests/migration은 read-only mount이고, 보고서 출력만 임시 경로에 씁니다. Docker socket을 ETL container에 mount하지 않습니다.

## 재현 순서

1. 새로운 internal network와 `postgis/postgis:16-3.4` container를 만듭니다. host port/기존 volume mount 없이 data/init-dir tmpfs 사용. 별도 fresh/populated/restored DB 이름을 생성하고 identity를 기록합니다.
2. Flyway12.4.0에서 fresh는 target 제한 없이 실제 V1→V2→V3, populated는 `-target=1 migrate`로 시작합니다. baseline/repair/clean/group transaction 우회는 사용하지 않습니다.
3. 입력 검증을 먼저 실행합니다. CSV6개는 manifest의 SHA·byte size·strict encoding/header/key/count와 대조하고, Polygon은 기존 spatial CLI validate-only로 ZIP/member/report/acceptance를 대조합니다.
4. Fresh는 `AREA_SOURCE_CRS=EPSG:5181`, explicit 격리 DB env로 실제 `python -m app.main --data-dir /source/raw/dataset`의 5job을 실행합니다. 상권 POINT/stores는 full snapshot 교체, 통계는 2025 연도 DELETE/재삽입입니다. 이 명령은 격리 DB에서만 실행합니다.
5. Populated V1은 실제 app.main에서 stores를 제외한 4job만 실행한 뒤 `integration_check.py v1-stores`로 NULL industry_id의 실제 전체 점포를 적재합니다. full snapshot을 기록하고 custom pg_dump→TOC 검사→새 빈 격리 DB에 pg_restore→ID/값/sequence/history까지 같은 snapshot 확인을 완료합니다.
6. Populated에서 실제 Flyway target=2→V1 보존 검사→target=3→validate→최소 backfill 범위 검사를 합니다. 이 시점부터 CSV loader를 다시 실행하지 않습니다.
7. 양쪽에서 기존 `python -m app.spatial_main --load --dsn …`에 ZIP/report 경로를 모두 명시해 적재합니다. 두 종류는 각각 transaction입니다. 같은 입력 재실행에서 spatial-inclusive snapshot 전체를 비교합니다.
8. source mode에서 전체 저장 값/NULL/POINT를 원본과 EXCEPT ALL 양방향 비교하고, 두 경로의 logical snapshot을 비교합니다. 원본 6개를 다시 hash하고 이번 자원만 정리합니다.

CLI 예시의 `/proof.json`·`/source`는 위에서 검사한 임시 container의 mount입니다. 아래 명령에는 개발 DB 접속값을 넣지 않습니다.

```sh
python tests/integration_check.py inputs --data-dir /source/raw/dataset \
  --manifest /source/manifest.json --output /out/inputs.json
python tests/integration_check.py snapshot --dsn "$ISOLATED_DSN" \
  --proof /proof.json --spatial --output /out/snapshot.json
python tests/integration_check.py source --dsn "$ISOLATED_DSN" \
  --proof /proof.json --data-dir /source/raw/dataset --output /out/source.json
python tests/integration_check.py compare-preserved --migrated \
  --before /out/populated-v1.json --after /out/populated-v3.json --output /out/v3-preserved.json
python tests/integration_check.py compare-logical \
  --before /out/fresh-final.json --after /out/populated-final.json --output /out/logical.json
python tests/integration_spatial.py --dsn "$ISOLATED_DSN" --proof /proof.json \
  --spatial-root /source/raw/spatial --output /out/probes.json
```

## streaming checksum·독립 비교 정의

서버 cursor `itersize=5000`으로 각 row JSON text를 읽습니다. UTF-8 byte 길이를 8byte big-endian으로 먼저 기록한 뒤 row bytes를 SHA-256에 누적합니다. 전체 row를 Python list에 담지 않습니다. PostgreSQL JSONB의 실제 NULL은 JSON `null`이고 0/빈 문자열/행 없음과 구분됩니다. 행 수도 digest와 함께 보관합니다. `to_jsonb(t)`로 **모든 실제 column**을 포함하고 `information_schema.columns`도 기록합니다. numeric/BIGINT는 float를 거치지 않고 PostgreSQL JSON text로 hash합니다.

| 목적 | column 집합/제외 | 정렬 |
| --- | --- | --- |
| V1 physical | 전 column·id·FK 포함; POINT는 NDR WKB hex와 SRID로 표현 | id |
| stores raw 보존 | physical에서 industry_id만 제외. id/source_store_id/모든 원본 속성/POINT 포함 | id |
| V3 분류 | `(id,source_store_id,industry_code)`; 예상 값은 pre의 I21201+NULL만 CAFE | source_store_id |
| V3 대상 ID set | I21201의 `(id,source_store_id)` 전 row | source_store_id |
| logical reference | industries는 id 제외; mapping은 id/industry_id 대신 industry code | code / source,source_code |
| logical 통계 | id/industry_id 대신 industry code, 모든 지역 key·원본 업종·분기·값/NULL 유지 | quarter,지역 code,source_industry_code |
| logical stores | id/industry_id 대신 industry code; 나머지 모든 속성·POINT NDR/SRID | source_store_id |
| logical 대표점 | id만 제외, 모든 속성·POINT NDR/SRID | commercial_area_code |
| logical provenance | id/loaded_at만 제외. ZIP/report/profile·metadata·quality/current 유지 | dataset_id,ZIP SHA,profile SHA |
| logical boundary | id/dataset_version_id 대신 dataset_id/profile SHA. source/operational NDR WKB/SRID·quality·repair/raw 속성 포함 | dataset_id,profile SHA,source_feature_index |

두 DB는 같은 locale/도구 버전입니다. ID·sequence·loaded_at은 경로 간 일치를 요구하지 않지만 **동일 Populated DB 전후**의 V1 ID/sequence는 보존해야 합니다. 처음 Polygon publication으로 새 공간 sequence가 증가하는 것은 정상이며, 경계 재실행은 공간 sequence까지 포함한 snapshot 전체가 같아야 합니다.

원본 대비 source mode는 별도 `csv.DictReader`와 Decimal exact integer parsing·독립 `struct.pack('<BIdd',1,1,lon,lat)` POINT WKB를 사용합니다. 모든 저장된 통계 metric(금액/건수 포함)·문자열·NULL·좌표·source key를 임시 expected table에 COPY하고 `EXCEPT ALL` 양방향 차이가 0인지 검사합니다. 상권 대표 좌표는 고정 5181→4326 transform을 대조하며 이 transform 재사용만으로 최초 CRS 검증을 대신하지 않습니다. 내부 산업 code는 확정된 SEOUL4/SEMAS1 기준으로 독립 비교합니다.

실제 자료에 없는 key는 row를 생성하지 않으므로 NO_ROW가 보존됩니다. 원본 중복 key와 field count 검사는 입력 단계에서 수행합니다. V1/BIGINT/NULL의 저장·보존 검증과 Backend API 표현 검증을 구분합니다.

## 결과와 제한

원본·검증 근거가 없거나 실패한 항목을 합성 fixture 성공으로 대체하지 않습니다. 전체 공간 **B**, 4단계 known limitation·historical UNRESOLVED·홍지문 H5·2025 통계/파일명 기준2026-06 점포의 시점 구분을 유지합니다. 이 검증은 9단계 API·radius·Frontend 구현이 아닙니다.

### 격리 환경과 migration

- container `ry-8c1-db-xa4ene`, ID `009297b4b0d5c3a516541994eca06c626db2940bf2a4abeba43cd749a9b4e2cc`.
- internal network `ry-8c1-net-xa4ene`, host port 없음·mount 없음·data/init-dir tmpfs. PostgreSQL system identifier `7694236089990213671`.
- 서로 다른 fresh/populated/restored DB와 별도 conflict/regression DB를 사용했습니다. PostgreSQL16.4/PostGIS3.4.3, Flyway12.4.0, production Python3.12.15 image. DB GEOS3.9.0/PROJ7.2.1과 Python Shapely2.1.2/GEOS3.13.1/pyproj3.7.0/PROJ9.4.1을 구분합니다.
- 실제 Flyway history는 두 최종 경로에서 다음과 같습니다. Populated의 성공 V1 row/checksum은 V2/V3 후에도 보존했습니다. `validate`도 통과했습니다.

| version | type | checksum | success |
| --- | --- | ---: | --- |
| 1 | SQL | -2055107083 | true |
| 2 | SQL | 237765795 | true |
| 3 | SQL | 617267104 | true |

### 실제 입력 identity

CSV6개의 byte size·SHA·strict parsing·전체 count·후보 key 중복0을 manifest와 대조했습니다. 길단위인구22행은 검증만 하고 ETL에서 제외했습니다.

| CSV | rows | SHA-256 |
| --- | ---: | --- |
| 서울시 상권분석서비스(길단위인구-서울시).csv | 22 | `7bab6199f18c5824d023bab8f1ceb90512c8e9ad7526acd5831aa5ca42153ef7` |
| 서울시 상권분석서비스(영역-상권).csv | 1650 | `6a6e19141f39712594a2eb42199e38e98ca2c8c06c5d4c5bd3fa39aee06ffd15` |
| 서울시 상권분석서비스(점포-행정동)_2025년.csv | 141218 | `5eaffcefc4ff43d0a7e162f0b1f922815c501a823a6c05bf5fb5f060a3de938b` |
| 서울시 상권분석서비스(추정매출-상권)_2025년.csv | 85732 | `2e299cd3e78a98d9b46634af0cc768276d8d270eb4c38b5f1b1ce54f8dcd828f` |
| 서울시 상권분석서비스(추정매출-행정동)_2025년.csv | 67113 | `1030b432d218a5752bf4d3bf313c8424120bbc7b331926c2fd4205cdfda3e519` |
| 소상공인시장진흥공단_상가(상권)정보_서울_202606.csv | 554092 | `08d3fd08b37840256cccd4f09bad6fc33133b647cbff05f22f26fc962cf84152` |

- OA-22160 ZIP: `969f7033bd3609a5fd586790f5b2cfedc638d7647ef45c78f9c75e1dabf79f68`.
- OA-15560 ZIP: `38bb8fab4e45a1171af4989cd7fa1275f68e5d644aa770f5431ce7ccc38384dd`.
- 고정 report SHA: admin `9358769876c8c30e62d8ef9e7b62daba6aee16e11ad4a9033f1ea9821e01477b`, commercial quality `86f92f57ca36b222238171ce4977ce29ce456a66cfce0f3c454339201e43c548`, repair `5654305c2d205575932159746a32a950ea9b06a03b83b7c65f321e347bae2297`.
- 기존 spatial CLI가 ZIP/member/report/CRS/schema·6건 acceptance와 WKB를 검증했습니다. 자료를 새로 다운로드/교체하거나 report를 재생성하지 않았습니다.

### Fresh / Populated 전수 결과

| table | 최종 rows (양 경로 동일) | 동일한 logical SHA-256 |
| --- | ---: | --- |
| admin_dong_boundaries | 425 | `291dfc86c373a07b0b42e18c477f00451bd1b9deaf65bb5ee0911fff9c3c093a` |
| commercial_area_boundaries | 1650 | `6e40dd2edb57e6ab6a807df3d7aaec56217441ae87bb821062b19c7f263af9a3` |
| commercial_areas | 1650 | `b1b281b094415641bfd3bbab6bff854766be37d1958212f3abf8a36b75fce589` |
| industries | 5 | `ebdcf9b6e05d18f55bf69d2bc9416f294b66a1dc50047eff774e0d255fac086d` |
| industry_mappings | 5 | `ebf2420f3fcb01a19685f6caecaf6b9cbac7bbce8b975f7e9f7f68b3b03501f7` |
| sales_commercial_area | 85732 | `6dd59f54a59057858646f3eacfd759ac52136ef1441c843970d1522df0a83aca` |
| sales_dong | 67113 | `efdb375cb7a0eccbf29a63bed6835d373ca210f55733c4c2bf06436cf26d63a6` |
| spatial_dataset_versions | 2 | `8180e2d9e502f1f60db11a199a2bbe79269a6ff377318f37df10f7bdfee94d52` |
| store_stats_dong | 141218 | `6e38c1b427c4a202ba310d68750dc458f2545ce30c69b59d282805ce45270fd1` |
| stores | 554092 | `cc67c887b02974b63693f70a4e18441231d202e98cda26689f36d4e4577cec3b` |

원본 대비 source mode의 5table 양방향 EXCEPT ALL mismatch는 양 경로 모두 **0**입니다. SEOUL4 mapping row 보존, SEMAS/I21201→CAFE1 추가, 실제 stores554092 중 I2120122739 전부 CAFE·NULL0/non-CAFE0·기타 미매핑 non-NULL0입니다. 다른 SEMAS mapping을 생성하지 않았습니다.

Populated V1은 stores 전체 industry_id NULL로 시작했습니다. V3의 정확한 변경 대상은 pre-snapshot의 I21201+NULL22739행이며, `(id,source_store_id,industry_code)` 전수 digest가 예상 NULL→CAFE 결과와 일치했습니다. V2 후 V1 전체 physical digest가 같았고, V3 후 통계3table·상권 대표 POINT·industries의 전체 값/ID도 보존됐습니다.

- stores industry_id 제외 **id 포함 전체 값·POINT digest**: `feb82579d6df2ac9b136ffea2ec63939aa85f9d60abe8c913ea45daaaea3c121`, 전후 동일.
- I21201 `(id,source_store_id)` target digest: `a582b7baca0456249eee155fcae3d9eb38101a91ab8c11aba4f66ed1d0c7690e`, 전후 동일.
- stores sequence: last_value=554092/is_called=true, V1→V2→V3→Polygon 후 동일. 기존 V1 다른 sequence도 보존, 새 reference INSERT의 mappings sequence 증가만 허용.
- Polygon-only 전후 V1 physical digest/sequence 보존. 같은 입력 재실행은 전체 spatial-inclusive snapshot(경계/version id·loaded_at·해시·sequence 포함)이 동일했습니다.

### 테스트 DB 백업·실제 복원

Populated V1의 custom pg_dump는 exit0, 79579490 bytes이며 SHA `f9fdb38a117fd7be1f6a5ff310226ed8561c69619dd28e2ad35ce645463db281`입니다. pg_restore TOC 검사 exit0 후 별도의 빈 restored 격리 DB에 실제 pg_restore --exit-on-error가 exit0으로 완료됐습니다. 복원 전후 7table의 전체 ID 포함 physical/raw/logical digest·분류·POINT·sequence·Flyway history/checksum snapshot이 정확히 같았습니다. 이 파일은 **격리 테스트 DB 백업**이며 기존 개발 DB 백업이 아닙니다.

파일/JSON/로그는 `/tmp/ry-8c1-xa4EnE/`의 `inputs.json`, `fresh-*.json`, `populated-*.json`, `restored-v1.json`, `backup.json`, `populated-v1.dump`, `full-pipeline.log`에 있습니다. raw 주소/점포명 row dump를 Git에 추가하지 않습니다.

### 검증 도구 수정 기록

첫 보존 검사에서 새 공간 sequence까지 V1 불변 대상으로 비교해 실패했습니다. 전수 진단 결과 V1 행/ID/sequence는 같았고 정상 Polygon INSERT의 새 sequence 증가만 달랐습니다. 해당 경우를 RED로 재현해 V1 sequence 비교 범위를 명시했습니다. 경계 재실행의 전체 snapshot 비교는 공간 sequence까지 계속 검사합니다. production 코드/기대 데이터 값을 바꾸지 않았습니다.

### 추가 실패·공간/index·회귀 결과

| 항목 | 실제 결과 |
| --- | --- |
| V3 mapping 충돌 | 별도 actual V1 fixture→V2→V3 실패. 기존 conflicting mapping·V1 ID/값/POINT/sequence/history snapshot 동일, V2 유지·V3 기록 없음 |
| V3 stores 충돌 | I21201의 기존 PUB 연결로 V3 실패. mapping 추가/backfill 전부 rollback, V1 snapshot 동일·V2 유지 |
| 이미 CAFE fixture | I21201의 이미 CAFE 행 유지, NULL 대상만 CAFE. 다른 코드 NULL 및 id/원본/POINT/sequence 보존 |
| 전체 unittest | 통합시점 production Python3.12에서 **61 PASS / 0 FAIL / 0 SKIP**, opt-in spatial DB/raw·stores DB/전체 CSV 포함. 리뷰 guard 검사1개 추가 후 최종 local 전체는 **47 PASS / 0 FAIL / 15 SKIP**(총62, DB/raw env 없음); production 전체+raw archive는 **49 PASS / 0 FAIL / 13 SKIP**(총62, DB opt-in 변수 미지정) |
| 기존 실패/retry 검사 재사용 | Polygon partial INSERT/current 전환 실패 rollback·기존 current/V1 보존·PENDING 거부·중복 current·UPDATE/DELETE guard·동시 profile 직렬화; ZIP/report SHA 거부·stores 중간 COPY/좌표 오류 rollback 모두 기존 suite를 새 격리 DB에서 재실행 |
| 실제 geometry/current | 양쪽 행정동425 VALID_SOURCE, 상권1644 VALID_SOURCE/6 REPAIRED_OPERATIONAL·raw invalid6 유지. source Polygon425 및 상권1561Polygon/89MultiPolygon, 모든 operational valid/non-empty MultiPolygon5181·Python/DB WKB/SHA 검사 |
| provenance/repair/H5 | source/member/report/processing profile·6건 acceptance 일치, reference_date NULL/verified=false·historical UNRESOLVED·PASSED_WITH_LIMITATIONS. 홍지문 raw11110/11410660·CONFLICT_OBSERVED/H5 유지 |
| 실제 공간 표본 | 각 DB **32개 exact5181 표본**: 내부/정확한 exterior vertex/0 membership, 6개 repaired hole의 내부 제외·ring 경계 포함, 알려진13 overlap pair의 다중 match, 실제 상권 overlap의0..N collection. 독립 Shapely 후보 목록과 PostGIS ST_Covers 일치 |
| overlap | 고정 report의13쌍을 전수 확인. 원본 geometry/정밀도 유지·자동 제거 없음. 상권 overlap 표본 `3001491`/`3110082` 복수 membership, 공식 의미/전수 overlap 분포를 확정하지 않음 |
| index/schema | catalog70 constraints·34 indexes(V1 포함)·공통 guard2functions/3triggers 확인. operational partial GiST2개 존재. ANALYZE 후 두 경계 normal plan/격리 세션 enable_seqscan=off plan 모두 Index Scan. 강제 planner 설정은 production 정책이 아님 |
| 복원 구조 | restored V1 및 양 최종 DB의 V1 column/type/nullability/default·constraint·index catalog도 전수 동일 |
| 원본 보존 | 종료 전 CSV6/ZIP2/report3의 SHA를 다시 확인해 모두 고정 입력과 같음 |

실제 profile SHA는 OA-22160 `bee5ea9d4ac157c06a007a5c3b782f4de755ba1843c6b9667aa6c26304c552b9`, OA-15560 `cdea9f4c69bb5c46dcc9cb1caaa1d746df4e9a45b0b6cf2787e4b6c782eef63e`로 양 경로가 같습니다. DB id/loaded_at을 profile identity에 넣지 않습니다. 정확한 5181 vertex 표본은 4326 왕복 투영/측위 오차까지 보증하지 않습니다.

강제 실패 테스트 두 개에서 기존 pandas reader의 `ResourceWarning`이 재관찰됐습니다. 정상 전체 적재와 rollback은 통과했고 경고를 숨기거나 production 코드를 변경하지 않았습니다. source/보고서 SHA 검사 실패 등 기존 test의 합성 입력 검사와 실제 full-data 성공을 구분합니다.

**8-C1 전체 실제 격리 통합 검증 완료**입니다. **8-C2/8-C 전체는 미완료**이며 실제 개발 DB 데이터·backup·현재 Flyway/구조·현재 POINT/sequence는 이번에 조회하지 않았습니다. 8-C2에서 실제 identity·writer 중지·백업/격리 복원·전후 보존과 중단 조건을 확인해야 합니다. API/Frontend/radius와 역사적 경계 증명은 이 검증 범위가 아닙니다.

### 최종 리뷰의 접속 guard 보강

읽기 전용 리뷰에서 명시적 DSN 검사만으로 ambient libpq PGHOSTADDR/PGSERVICE route를 막지 못하는 경로를 지적했습니다. 설치된 psycopg의 환경 fallback 구현으로 원인을 확인하고, mocked connect가 호출되는 RED5case를 재현했습니다. PGHOSTADDR/PGSERVICE/PGSERVICEFILE/PGSYSCONFDIR/PGOPTIONS가 있으면 connect 전에 ValueError로 거부하도록 최소 보강했고, connect-not-called GREEN으로 확인했습니다. 기본 CLI에서 환경을 지우거나 service 설정을 바꾸지 않습니다.

이번 Docker image ENV와 실제 driver의 전달 변수에는 이 PG override가 없었으므로 앞선 격리 검증 증거는 유지됩니다. 강화된 guard로 실제 Fresh DB의 source 전수 비교도 다시 실행해 mismatch0을 확인했습니다. 후속 전체 suite의 DB opt-in skip13은 이미 초기61개에서 실행한 DB/store raw 검사를 같은 비어 있지 않은 regression DB에 재실행하지 않은 것입니다. 새 guard 검사와 파일/unit/raw archive 회귀는 재실행했고, 현재62개 서로 다른 unittest는 이번 작업 중 모두 최소 한 번 통과했습니다. 리뷰의 다른 Critical/Important 지적은 없었습니다.

이번 작업의 임시 DB container·internal network는 검증 후 제거했습니다. 기존 개발 container는 시작과 같은 ID `983e738d45ac64e2c5c116117d739fde554b17041f417c2110938847c9edf951`/healthy·기존 volume 연결 상태를 Docker metadata로만 확인했습니다. DB/volume에 연결하거나 쓰지 않았습니다. 검토용 백업·JSON·로그는 저장소 밖 `/tmp/ry-8c1-xa4EnE/`에 유지하며 Git에 포함하지 않습니다.
