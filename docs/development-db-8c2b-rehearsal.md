# 8-C2B-1 실제 개발 DB 백업 기반 격리 리허설

완료일: 2026-10-09 (Asia/Seoul). 2026-10-08 시작 후 사용량 제한으로 중단됐고, 저장된 증거·Git·격리 identity를 확인해 V2부터 재개했습니다. 완료된 백업 복원을 반복하지 않았습니다.

**격리 리허설 PASS. 실제 개발 DB 적용 NOT_STARTED / NOT_AUTHORIZED.** 원본 role 속성·membership·로그인/인증·실제 migration 사용자 권한은 NOT_VERIFIED입니다. 8-C2B와 로드맵 8 전체를 완료 처리하지 않습니다.

## 1. Git 및 코드

시작·재개 시 main, local HEAD와 GitHub remote main 모두 deaed745b31fdcb16355ecc241f46b3dc2b46045, clean을 확인했습니다. V1/V2/V3 SQL은 변경하지 않았고 [8-C2A](development-db-8c2a-preflight.md)의 SHA-256과 일치했습니다.

| 파일 | SHA-256 |
| --- | --- |
| V1__initial_schema.sql | e610887d646e6f6efe1967e3862b0a3f76f91c4f4ab78573caf3e3f6d2895c01 |
| V2__spatial_schema.sql | eaf805c50ba32cd7a2d4875ff0aea31cea719d5522ea33cf833cab98580e00e3 |
| V3__semas_cafe_mapping_and_store_backfill.sql | d1065d224b841c0adbb09bc368f2f63c63c63d81a268d08e8affee9884dd52cc |

공개 변경은 이 기록 한 파일입니다. production·기존 runbook·roadmap·원본은 유지했습니다. 종료 시 main/동일 HEAD이며 이 기록만 untracked입니다. git diff --check와 새 파일의 별도 whitespace 검사 결과도 확인했습니다.

## 2. 기존 개발 DB 보호

startup-analysis-postgres / recycleyoungs_postgres_data에는 SQL/JDBC/psycopg/pg_dump/pg_restore 연결을 하지 않았습니다. migration·ETL·Spring·dbTest·container stop/restart/recreate·volume mount/삭제도 미실행입니다.

Docker metadata만 시작·재개·종료에 대조했습니다. full ID 983e738d45ac64e2c5c116117d739fde554b17041f417c2110938847c9edf951, image, StartedAt, RestartCount=0, running 및 단일 보호 volume mount가 동일했습니다.

이는 본 작업의 접속/변경 미실행과 container 상태 확인입니다. **개발 DB의 현재 rows/hash/history/writer는 재조회하지 않아 NOT_VERIFIED**입니다.

## 3. 사용한 backup identity

사용자가 지정한 8-C2A 백업을 해당 작업의 private backup metadata·원본 identity 기록으로 식별했습니다. 후보1개, 현재 사용자 소유 regular file, file0600/directory0700을 확인한 뒤 읽기 전용 해시를 계산했습니다.

| 항목 | 결과 |
| --- | --- |
| bytes | 11,690,636 |
| SHA-256 | 970cb9016b67b95b9e1c3bb291f762a229129f2a3884551e16053aca26f2089d |
| source container/system identifier | 8-C2A private metadata와 일치 |
| 시작·종료 hash | 일치 |
| 변경·복사·삭제·다른 백업 대체 | 미실행 |

백업의 실제 경로·credential·데이터 원문을 공개하지 않습니다. 현재 개발 DB의 최신 백업이라고 주장하지 않습니다.

## 4. 격리 환경·실제 복원

기존 connect_isolated guard와 호환되는 ry-8c1-* 이름을 사용하되 이번 run label/full ID로 소유 자원을 구분했습니다. 전용 internal network, host port 없음, Mounts=[], PGDATA/init tmpfs, 별도 DB 이름·원본과 다른 system identifier를 확인한 뒤 복원했습니다.

새 다운로드/빌드 없이 기존 이미지의 immutable local ID와 RepoDigest를 대조하고 다음 ID로 실행했습니다.

| 용도 | immutable image ID |
| --- | --- |
| PostgreSQL/PostGIS | sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5 |
| Flyway12.4.0 | sha256:5be18367a9b3979a9f37234c371b80da457a448fb9577bd94d4bf24d923fafac |
| 기존 Python/GIS ETL | sha256:b3bc55d2aeadd8ca3ef25e8c6be50a9f1651420983ded52cf20f98b3cee75536 |

실측: Python3.12.15 / pyshp3.1.6 / Shapely2.1.2 / Python GEOS3.13.1 / pyproj3.7.0 / PROJ9.4.1. DB: PostgreSQL16.4(Debian package 표기 포함) / PostGIS3.4.3 / GEOS3.9.0-CAPI-1.16.2 / PROJ7.2.1.

새 빈 격리 DB에 **실제 8-C2A custom backup**을 stdin으로 pg_restore --exit-on-error, exit0으로 복원했습니다. --clean/--create/--no-owner/--no-acl은 사용하지 않았습니다. 원본 volume은 연결하지 않았습니다.

runner에는 필요한 app/tests·공간 원본·감사 근거만 read-only mount했습니다. CSV는 mount/적재하지 않았습니다. 이번 container/network는 제거했고 private 로그·감사 JSON·controller는 저장소 밖 제한된 임시 evidence 디렉터리에 보존했습니다.

## 5. owner/ACL·권한 검증 범위

private metadata의 owner 이름만 격리 cluster에 재현했습니다. 해당 role은 **NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT**의 제한된 이름 재현이며 원본 role 속성의 복원이 아닙니다. metadata에 없는 membership/GRANT/superuser를 추정하지 않았습니다.

- owner/ACL statements를 제외하지 않고 복원했습니다.
- 저장된 15개 relation/sequence/history 객체의 owner/ACL이 정확히 일치했습니다. 이 metadata 범위의 ACL은 모두 NULL(default)이었습니다.
- 해당 non-superuser owner role로 SET LOCAL ROLE 후 V1 7table SELECT가 가능함을 확인했습니다.
- **원본 role attributes/membership/LOGIN/password/authentication, 실제 앱 접속, metadata 밖 DB/schema/default ACL, 실제 migration 사용자 권한은 NOT_VERIFIED입니다.**

이름·객체 owner/ACL·조회권한 재현을 전체 권한 복구 성공과 구분합니다. extension 등 저장된15개 객체 밖의 owner/ACL까지 검증했다고 주장하지 않습니다.

## 6. V2 migration

복원 격리 DB에서 Flyway12.4.0 target=2 migrate → target=2 validate 모두 exit0입니다. BASELINE1 원행 보존, 성공 SQL2/checksum237765795, V3 미적용을 확인했습니다.

공간3table 최초0행입니다. 별도 reference DB에 실제 동일 V1/V2 SQL을 적용한 catalog와 공간 column/type/typmod/default·constraint·index·sequence dependency·function/trigger 정의·trigger 활성 상태가 정확히 일치했습니다. guard function2개/trigger3개, source Geometry5181·operational MultiPolygon5181, current UNIQUE 및 operational GiST를 포함합니다.

V1 전수 감사·7개 sequence가 복원 직후와 동일했습니다. 이 게이트 통과 후에만 V3를 실행했습니다.

## 7. V1 복원·보존 근거

8-C2A 보완 감사 함수·catalog SQL을 재사용했습니다. 개발 DB bridge를 import/실행하지 않고 필요한 감사 함수만 기존 table_query/digest_records와 격리 READ ONLY/REPEATABLE READ adapter에 연결했습니다.

physical/raw는 id 정렬, logical은 기존 business-key 정렬입니다. UTF-8 row bytes 앞에8byte big-endian 길이를 붙인 streaming SHA-256입니다. POINT NDR WKB/SRID를 포함하며 logical로 physical 보존을 대신하지 않았습니다.

| 테이블 | 복원 rows | 복원·V2 physical SHA-256 |
| --- | ---: | --- |
| industries | 5 | 388adedfe76b7076cad2d35345967ae233e956ce52d1a108cbcbcaff6039d2e4 |
| industry_mappings | 4 | 8d56e44ad87363ead88661b97b1742c2614e59789f8540ba7f454674d3e86a95 |
| commercial_areas | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| store_stats_dong | 141218 | 8a7c57aa887eb375b0c9d09dc92619b84259e332602fd9eb9fb855ab2be77f70 |
| sales_dong | 67113 | a7263ce0dba01f6a4d647319ee3981523acb785bbf8e70c5e9c7beb6306c8c6a |
| sales_commercial_area | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| stores | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

169개 필드의 NULL object/key-set, 전체 ID/FK·POINT·분포·sequence 상태/설정/column dependency·전체 history row·V1 semantic catalog가 8-C2A supplemental snapshot과 일치했습니다.

sequence의 last_value/is_called은 industries5/true, mappings4/true, store_stats423658/true, sales_dong134230/true, 나머지3개1/false입니다. row count/MAX(id)로 재생성하지 않았습니다. POINT 대상 table은0행이므로 실제 점 샘플 복원이 아닌 빈 table의 digest/NULL/type 조건 확인입니다.

## 8. V3 migration·mapping

target=3 migrate와 target 없는 전체 validate 모두 exit0입니다. history는 BASELINE1 → SQL2 → SQL3, checksum은 V2 237765795/V3 617267104입니다. BASELINE checksum NULL을 유지했습니다.

- 기존 SEOUL4 mapping ID/값 보존, SEMAS/I21201→기존 CAFE 정확히1개 추가
- stores0/I21201대상0/backfill0: 복원된 실제 백업의 정상 기대값
- industry_mappings_id_seq만4/true→5/true, 다른 V1 sequence 동일
- 새 mapping physical SHA: 3f1064a3fe11ae55b8503c6bf1c8535bcc807d69cc953bda145ae1b724407a3c
- 나머지 V1 physical SHA는 위 표와 같음

기존 migrated 비교 외에 새 mapping의 필수 존재·분류·history/checksum·허용 sequence 변화도 별도로 assert했습니다.

## 9. Polygon publication·retry·공간 표본

실제 app.spatial_main을 --only admin --load --dsn, 이어 --only commercial --load --dsn으로 실행했습니다. 고정 ZIP2/member10/report3 SHA를 입력·종료에 대조했습니다.

| 대상 | 실제 결과 |
| --- | --- |
| 행정동 | 425 VALID_SOURCE; source425 Polygon; raw invalid0 |
| 상권 | 1644 VALID_SOURCE+6 REPAIRED_OPERATIONAL; source1561 Polygon/89 MultiPolygon; raw invalid6 |
| operational | 전수 valid/non-empty MultiPolygon5181 |
| geometry | source/operational SRID·NDR WKB·저장 SHA 전수 일치 |
| publication | 종류별 READY/current 정확히1개 |
| provenance | B/UNRESOLVED; reference_date NULL/verified=false; PASSED_WITH_LIMITATIONS |
| 홍지문 | raw SIGNGU11110/ADSTRD11410660; CONFLICT_OBSERVED/H5 unresolved |

동일 입력 재실행 전후 **전체 spatial-inclusive snapshot**이 동일했습니다. version/row ID·loaded_at·WKB/hash·current·sequence를 포함합니다.

최종 processing-profile SHA는 행정동 bee5ea9d4ac157c06a007a5c3b782f4de755ba1843c6b9667aa6c26304c552b9, 상권 cdea9f4c69bb5c46dcc9cb1caaa1d746df4e9a45b0b6cf2787e4b6c782eef63e로8-C1의 동일 환경 결과와 같습니다.

기존 integration_spatial.verify로 **32개 exact5181 ST_Covers 표본·13 overlap pair**를 독립 Shapely 후보와 대조했습니다. 내부·exterior vertex·0 membership·6개 repaired hole 내부/경계·다중 행정동·상권 overlap을 포함합니다.

catalog70constraints/34indexes/2functions/3triggers 및 operational GiST2개를 기록했습니다. 격리 세션 seqscan-off index 접근 검사가 통과했고 normal plan도 보존했습니다. 강제 planner 설정은 운영 정책이 아닙니다. ANALYZE는 격리 DB에서만 실행했습니다.

## 10. V1 최종 보존

각 Polygon 종류 적재 후·retry 후·회귀 테스트 후의 V1 full audit는 V3 직후와 동일했습니다. ID·POINT·169 NULL·분포·sequence·전체 history·V1 catalog를 포함합니다.

최종 복원 DB는 industries5/mappings5/store_stats141218/sales67113이며 stores/commercial_areas/sales_commercial_area는0입니다. 개발 DB의 현재 실측값으로 표현하지 않습니다.

2025 통계와2026-06 점포 snapshot 시점 구분, historical UNRESOLVED/전체B/4단계 미완료, 고정6건 외 repair 금지 정책을 유지했습니다.

## 11. 테스트 및 실패 재개

합성 fixture·실패 주입은 **실제 백업 복원 DB와 다른 DB**에서만 수행했습니다.

| 검사 | 결과 |
| --- | --- |
| 기존 unittest62 | 57 PASS/0 FAIL/0 ERROR/5 SKIP |
| V2 첫 DDL 충돌 | 예상 migrate exit1; V1 snapshot 불변; V2/V3 history 및 추가 boundary/guard 없음 |
| V3 mapping 충돌 | 예상 exit1; V2 유지·V3 부재·전후 snapshot 동일 |
| V3 점포 분류 충돌 | 예상 exit1; V2 유지·V3 부재·전후 snapshot 동일 |
| 실제 두 종류 CLI 부분 실패 | 행정동 commit 유지; 상권 publication에만 명시적 실패 주입; 상권 row/version rollback·V1 보존 |
| 실패 종류 재개 | 상권만 재시도 성공; 행정동 ID/loaded_at/hash 보존 |
| 전체 retry | 전체 spatial snapshot 동일 |
| sequence gap | 실패한 신규 공간 INSERT gap 실측; V1 sequence 불변; setval/RESTART 없음 |

5 SKIP은 StoreDbTests4개/실제 전체CSV RealStoreTests1개입니다. CSV full-loader opt-in을 지정하지 않았고 skip을 성공으로 집계하지 않았습니다. Polygon DB8개·실제ZIP2개 opt-in은 별도 fixture DB에서 실행했습니다.

V3 fixture SQL은 기존8-C1 실패 harness를 재사용했습니다. 기존 suite에 없던 **두 종류 CLI 부분 성공→실패 종류만 재개**만 private adapter로 보완했으며 production/repository test는 수정하지 않았습니다. 사전충돌 시 sequence 불변을 INSERT 이후 모든 실패에 일반화하지 않습니다.

초기 runner는 기본 CSV ENTRYPOINT 때문에 인수 파싱 exit2로 중단됐고 loader/DB 연결은 실행되지 않았습니다. --entrypoint python을 명시해 해결했습니다. 이어 단축 버전 비교가 Debian/CAPI 접미사를 거부해 감사 adapter exit1이 발생했고 실제 문자열을 확인해 정확한 기대값으로 수정했습니다. 두 초기 실패 로그를 보존했고 **복원 전수 게이트 통과 전 V2를 실행하지 않았습니다.**

## 12. 실측 Go/No-Go·실제 명령 검토

**격리 리허설 조건 PASS. 실제 개발 DB Go 판정은 미실행입니다.**

- 매 명령 전 owned container/network full ID·label·image·internal/no-port/no-volume/tmpfs 확인
- 기존 five-key proof DSN·ambient libpq override 거부·접속 후 system identifier guard 유지, DB 이름 별도 고정
- Flyway public/schema·baselineOnMigrate=false·cleanDisabled=true·group=false·outOfOrder=false·executeInTransaction=true·mixed=false·createSchemas=false·connectRetries=0 고정
- 실제 Flyway connection initSql에서 lock_timeout=5s/statement_timeout=10min 설정, 같은 connection의 DO guard로 확인
- 실제 Polygon CLI DSN에는 고정 timeout options만 명시했습니다. CLI와 동일한 connect_database 함수·DSN의 **별도 사전 연결**에서 identity/timeout을 확인하고 실제 적재 연결에도 동일한 options를 전달했습니다. 적재 connection 자체의 identity 조회는 별도로 계측하지 않았습니다. 별도 감사 connection의 SET가 전파된다고 가정하지 않습니다. [PostgreSQL16 options](https://www.postgresql.org/docs/16/libpq-connect.html)
- 기본 CSV ENTRYPOINT를 명시적으로 override, image tag만으로 승인 판정하지 않음
- 오류 시 다음 gate 자동 진행·baseline/repair/clean·자동 재시도·sequence 원복 없음

실제 개발 DB용 mutation shell script는 작성/실행하지 않았습니다. private controller는 기본 실행이 읽기 전용 inspect이고 explicit flag가 필요합니다. **격리 resource/name/proof만 허용하여 개발 DB 실행 경로가 없습니다.**

후속 실제 적용 명령은 별도 승인 후 다음 순서를 유지해야 합니다.

1. Git/실제 identity/실사용자 권한/writer 재검증
2. 영속 private 보관과 새 exported snapshot 연계 backup·새 격리 restore 확보
3. 고정 Flyway target2 migrate→target2 validate→V1 보존
4. target3 migrate→전체 validate→mapping/backfill/sequence 검사
5. explicit route·secret·timeout·고정 ETL entrypoint로 admin→gate→commercial→gate
6. 최종/retry 비교, 실패 시 STOP; 원본 자동 restore/접속 전환 금지

비밀번호·실제 DSN·backup path를 공개 명령/기록에 넣지 않습니다. make db-migrate/make etl/Spring/dbTest는 사전 점검 경로가 아닙니다.

## 13. 실제 적용 전 blocker / NOT_VERIFIED

- 별도 명시적 실제 적용 승인: 없음
- 현재 개발 DB identity/history/checksum/schema/rows/digests/sequences/writer: NOT_VERIFIED
- migration 직전 새 snapshot+backup 연계·현재 데이터의 restore: 미실행
- 영속 backup 보관/retention: 기존 private 임시 경로 유지, 이동/복사 미실행
- 원본 role attributes/membership/login/authentication, DB/schema/default ACL, 실사용자 DDL/UPDATE 권한: NOT_VERIFIED
- Backend version1 고정 테스트 수정·startup migrate 억제: 미실행, 별도 코드 변경

백업 재복원 성공은 최신성·전체 권한 복구·실제 적용 승인을 대신하지 않습니다. 장애 복구는 새 분리 DB 복원·검증 후 별도 승인으로 접속 전환 범위를 결정해야 합니다.

## 14. 변경 파일·증거

저장소 변경은 docs/development-db-8c2b-rehearsal.md 신규 파일뿐입니다. production·V1/V2/V3·기존 runbook·CSV/ZIP/SHP/report는 변경하지 않았습니다.

controller/worker/ledger, 보호 metadata 전후 비교, backup SHA, Docker proof, runtime, restore/Flyway stdout·stderr·exit, 각 단계 audit/snapshot/catalog, unittest/negative-case/probe 결과는 저장소 밖 private evidence에 보존합니다. backup·credential·row 원문은 Git/context-mode index에 넣지 않았습니다.

실행 단계는 inspect→setup→restore→원인 분석 후 audit-restored→재개 identity 확인→v2→v3→admin→commercial→retry→regression→cleanup입니다. mutation은 explicit isolated flag/guard로 통제했습니다. 코드·명령·기대값·실제 종료코드는 private 로그/ledger로 보존합니다.

Superpowers 실행/systematic debugging/verification, 읽기 전용 subagent3개로 범위를 조사했습니다. GitHub로 remote HEAD, Context7로 PostgreSQL16 options를 확인했습니다. context-mode는 중단 전 문서 탐색에 사용했고 재개 후 MCP 미노출은 설치/우회 없이 로컬 요약으로 대체했습니다. Build Web Apps는 미사용입니다.

독립 최종 읽기 전용 리뷰에서 Critical/Important 지적은 없었습니다. CLI identity 검사의 범위 문구를 위처럼 명확히 했습니다. private controller의 stage는 독립 호출 가능하며 앞선 gate 성공을 자동 선행조건으로 강제하지 않습니다. 이번 실행에서는 메인이 PASS 증거를 확인한 뒤 다음 stage를 호출했고 ledger/각 gate를 보존했습니다. 자동 순서 강제를 구현했다고 주장하지 않습니다. 후속 실제 개발 DB 실행 경로는 별도로 검토해야 합니다.

## 15. 종료·Git 쓰기 미실행

이번 exact container/network ID만 제거했고 transient runner는 --rm으로 종료했습니다. 보호 container metadata와 backup SHA는 종료에도 동일합니다. private evidence/원본 backup은 삭제하지 않았습니다.

Git stage/commit/push·branch/worktree·reset/restore/clean/stash는 미실행입니다. 이 기록은 리뷰 대상 untracked 파일이며, 실제 개발 DB V2/V3/Polygon 적용을 자동 시작하지 않았습니다.
