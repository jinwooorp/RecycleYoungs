# 8-C2A 기존 개발 DB 사전 점검·백업 복원 결과

검증일: 2026-10-08(Asia/Seoul). 시작 `main/b6113585ea4c2ba10d1edf3d57ec999403e9b5dd`, local/remote 동일·clean. [기존 runbook](development-db-8c2-runbook.md)의1~9단계를 적용했습니다. runbook을 재작성하지 않았으며 **V2/V3 migration·Polygon publication·CSV full loader·Spring startup·baseline/repair/clean은 실행하지 않았습니다**.

## 판정

**READY_FOR_8_C2B_REVIEW**입니다. 이는 실제 적용 승인이 아닙니다. 현재 적용된 V1 구조·읽기 전용 snapshot 안정성·backup/실제 격리 restore를 통과했고, 미래 pending V2/V3와 기존 BASELINE의 NULL checksum을 명확히 구분했습니다. 8-C2B 시작 직전에 identity·writer·history·전수 hash/sequence·입력 SHA를 다시 확인해야 합니다. 데이터가 바뀌면 이번 snapshot/backup을 최신 상태로 간주하지 말고 사전 검증을 다시 수행합니다. **8-C2 및 로드맵8 전체는 미완료**입니다.

## 접속 identity와 권한

| 항목 | 실제 결과 |
| --- | --- |
| 기존 container | `startup-analysis-postgres`, full ID `983e738d45ac64e2c5c116117d739fde554b17041f417c2110938847c9edf951` |
| image | postgis/postgis:16-3.4, image ID `sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5` |
| 실행 상태 | running/healthy. created `2026-10-03T07:30:18.888643544Z`, started `2026-10-08T09:57:14.538035291Z`, RestartCount=0. 동일 container이며 이 값만으로 과거 수동 재시작이 없었다고 주장하지 않음 |
| volume / PGDATA | 단일 `recycleyoungs_postgres_data` → `/var/lib/postgresql/data`, SQL data_directory도 일치 |
| network/alias | `recycleyoungs_default`, `startup-analysis-postgres`/`postgres` alias 확인. host port5432와 내부 port5432 확인. 상세 주소/DSN은 공개 기록에서 제외 |
| 실제 DB/user | 승인 container의 구성값과 current_database/current_user 일치. 임의로 다른 DB/user를 선택하지 않음 |
| SQL 감사/pg_dump 접속 | 승인 container 내부 Unix socket만 사용. inet_server_addr/port는 NULL(Unix socket), current_setting('port')=5432. default 및 실제 transaction READ ONLY, REPEATABLE READ 확인 |
| DB versions | PostgreSQL16.4 / PostGIS3.4.3 / DB GEOS3.9.0 / PROJ7.2.1 |
| system identifier | `7692329130053947430`; 각 단계 재확인 |
| 검증 권한 | V1 전7table SELECT 및 pg_stat_activity 전체 확인 권한 있음. 권한 확대 없음 |

8-C2A 전용 subprocess 경로를 프로젝트 밖 임시 경로에 작성했습니다. libpq 환경을 process-local whitelist로 제한하고 network/default DSN 대신 승인 container의 Unix socket에만 연결합니다. 읽기 SQL만 허용하며 server READ ONLY를 강제합니다. 8-C1의 `connect_isolated()`는 수정·우회하지 않았고 개발 DB에 사용하지 않았습니다. 비밀번호·JDBC URL·환경 전체·원본 row는 로그나 문서에 출력하지 않습니다.

## Flyway와 실제 V1 구조

현재 전체 history는 성공한 **version1/typeBASELINE/description `<< Flyway Baseline >>`/checksumNULL** 한 건입니다. V2/V3 적용과 failed row는 없습니다. public table은 V1의7개+PostGIS spatial_ref_sys+Flyway history뿐이며 history 밖의 V2 공간3table/guard도 없습니다. BASELINE의 NULL checksum을 V1 SQL CRC32와 같다고 주장하지 않습니다.

Flyway12.4.0의 실제 `info`/`validate`는 승인된 Docker network/alias의 JDBC 경로를 별도로 사용했습니다. 연결 초기화를 READ ONLY/REPEATABLE READ로 설정하고 `createSchemas=false`로 실행했습니다. 커맨드 allowlist는 info/validate만 허용합니다.

- info: schemaVersion1, V1 SQL은 Ignored(Baseline), BASELINE1 존재, V2/V3 Pending.
- **전체 기본 validate는 validationSuccessful=false**입니다. 두 원인은 V2/V3의 `RESOLVED_VERSIONED_MIGRATION_NOT_APPLIED`이며 CHECKSUM/TYPE/DESCRIPTION mismatch는 없습니다. exit code만 보고 PASS로 해석하지 않았습니다.
- **현재 적용 범위의 `validate -target=1`은 true**입니다. `ignoreMigrationPatterns`/repair로 오류를 숨기지 않았습니다. 이는 현재 V1 기준 검사이며 미적용V2/V3의 DB 적용 결과를 검증한 것이 아닙니다. [Redgate validate/error 규칙](https://documentation.red-gate.com/flyway/reference/exit-codes-and-error-codes/validate-error-codes).

새 internal-network/no-port/tmpfs/no-volume container의 독립 reference DB에 **V1 SQL 파일만 직접 적용**했습니다. 기존 DB DDL과 Flyway migrate는 실행하지 않았습니다. 실제 catalog는 reference와 **169column/type/nullability/default/identity·19PK/UNIQUE/FK/CHECK·22index/validity·7sequence type/cache/ownership·extension·비내부 trigger**까지 정확히 일치했습니다. RLS 활성화 등 V1과 다른 table 속성도 없습니다.

| repository migration | SHA-256 |
| --- | --- |
| V1__initial_schema.sql | `e610887d646e6f6efe1967e3862b0a3f76f91c4f4ab78573caf3e3f6d2895c01` |
| V2__spatial_schema.sql | `eaf805c50ba32cd7a2d4875ff0aea31cea719d5522ea33cf833cab98580e00e3` |
| V3__semas_cafe_mapping_and_store_backfill.sql | `d1065d224b841c0adbb09bc368f2f63c63c63d81a268d08e8affee9884dd52cc` |

## 실제 V1 baseline과 전수 hash

8-C1의 pure `table_query`/`digest_records`만 재사용했습니다. ID·FK를 포함한 모든 실제 column과 POINT NDR WKB/SRID를 `to_jsonb` text로 표현하여 **id 정렬**, UTF-8 row bytes 앞에8byte big-endian 길이를 붙인 streaming SHA-256입니다. 전체 행을 list에 모으거나 개인정보성 row를 출력하지 않았습니다. JSON null·0·빈 문자열·행 없음은 합치지 않습니다. stores에는 industry_id 제외 raw digest·id/source_store_id·예상V3분류 digest도 별도 수집했습니다.169field NULL count는 아래 최종 리뷰 보완까지 포함해 기록했습니다. 통계 code/분기 분포·업종 count·sequence last_value/is_called/ownership도 기록했습니다.

| table | rows | ID 포함 physical SHA-256 |
| --- | ---: | --- |
| industries | 5 | `388adedfe76b7076cad2d35345967ae233e956ce52d1a108cbcbcaff6039d2e4` |
| industry_mappings | 4 | `8d56e44ad87363ead88661b97b1742c2614e59789f8540ba7f454674d3e86a95` |
| commercial_areas | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| store_stats_dong | 141218 | `8a7c57aa887eb375b0c9d09dc92619b84259e332602fd9eb9fb855ab2be77f70` |
| sales_dong | 67113 | `a7263ce0dba01f6a4d647319ee3981523acb785bbf8e70c5e9c7beb6306c8c6a` |
| sales_commercial_area | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| stores | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

현재 상권 대표점·상권매출·stores가0행인 것은 8-C1의 전체 source 테스트와 다릅니다. [2026-10-03 기록](project-status.md#2026-10-03-행정동-적재복구-검증)의 `--only store_stats_dong sales_dong` 두 job 적재와 일치합니다. 자동으로 실패 처리하거나 CSV를 재적재하지 않았습니다. 현재 개발 DB에 전체6CSV가 적재돼 있다고 주장하지 않습니다.

V3 예상 대상은 I21201 total0/NULL0/이미CAFE0/non-CAFE0, 미매핑 SEMAS 점포0입니다. CAFE industry는 실제1개이며 기존 SEOUL4 mapping만 존재하고 SEMAS/I21201은 아직 없습니다. 이 상태는 V3 reference 추가를 허용하며 **현재 backfill 예상0건**입니다. 이미 등록된 충돌 mapping/점포는 없습니다. 554092/22739를 적용 조건으로 사용하지 않았습니다.

stores/대표 POINT는 table 자체가0행이며 POINT NULL0/non-POINT4326 0입니다. POINT digest와 NULL분포 검사는 수행했으나 실제 점포/대표점 샘플이 없는 상태임을 명시합니다. 통계값·ID는 아래 전수 digest에 포함돼 복원/보존을 검사했습니다.

| V1 sequence | last_value | is_called |
| --- | ---: | --- |
| commercial_areas_id_seq | 1 | false |
| industries_id_seq | 5 | true |
| industry_mappings_id_seq | 4 | true |
| sales_commercial_area_id_seq | 1 | false |
| sales_dong_id_seq | 134230 | true |
| store_stats_dong_id_seq | 423658 | true |
| stores_id_seq | 1 | false |

## Writer·snapshot·백업

다른 DB client0·prepared transaction0·subscription0, repository backend/ETL process0·실행 Docker앱은 기존DB만·현재 사용자 cron없음을 확인했습니다. 보이는 writer를 종료하거나 서비스 중단을 하지 않았습니다. 관찰된 검증 창에서 다른 client가 생기면 중단하도록 했습니다. 숨겨진 미래 writer의 영구 부재를 주장하지 않고 8-C2B 전에 검증 창을 재확인합니다.

한 READ ONLY/REPEATABLE READ coordinator에서 전수 baseline을 기록하고 `pg_export_snapshot()`으로 snapshot을 공유했습니다. 새 독립 read snapshot으로 최초/직전 값과 ID/sequence/history를 다시 대조한 뒤에만 **pg_dump -Fc --snapshot**을 실행했습니다. 이 방식은 [PostgreSQL16 synchronized snapshot](https://www.postgresql.org/docs/16/app-pgdump.html)으로 dump와 baseline의 동일 MVCC view를 보장합니다. sequence는 MVCC와 별개이므로 전후 별도로 비교했습니다.

- 백업 시작 `2026-10-08T21:07:27.501707+09:00`, 완료 `2026-10-08T21:07:35.758796+09:00`.
- 11690636bytes, SHA-256 `970cb9016b67b95b9e1c3bb291f762a229129f2a3884551e16053aca26f2089d`.
- pg_dump exit0 / stderr0byte / pg_restore TOC exit0.
- 프로젝트 밖 private 임시 경로, directory0700·파일0600. 실제 backup과 검증 근거는 후속 리뷰/승인 시점까지 보관하며 Git에 넣거나 첨부하지 않습니다.
- snapshot 최초→backup직전→dump직후→restore검증종료/최종 기존DB 비교에서 모든 V1 row/hash/ID/POINT/NULL/sequence/history/schema 동일.
- database/user-table insert/update/delete counter와 stats_reset 값도 검증 창에서 동일. 데이터 통계 counter는 모두0을 유지했습니다.

## 실제 격리 복원과 한계

새 container `ry-8c2a-db-rctqfk`·별도 internal network·host port 없음·mount 없음·data/init-dir tmpfs로 원본 volume과 완전히 분리했습니다. reference와 실제 restore 대상은 별도 DB이고 restore DB의 public table이0인 것을 확인했습니다. **pg_restore --exit-on-error**는 exit0으로 실제 완료됐습니다.

복원 DB와 원본 pre-snapshot의7table physical/raw/logical digest·모든ID·POINT NDR/SRID·169field NULL분포·분기/원본업종분포·mappings·분류·sequence 상태/ownership·Flyway history 전체 row·V1 구조가 모두 같습니다. 복원 후 원본 DB 전수 비교도 다시 통과했습니다.

원본 owner/ACL은 private metadata와 dump에 기록됐으나 격리 restore에는 **--no-owner/--no-acl**을 사용했습니다. 따라서 **원본 owner/ACL/role 권한 복원 성공까지 검증한 것은 아닙니다**. 실제 복구/접속전환이 필요하면 별도 권한 복원 계획이 필요합니다. 기존 DB에 restore하거나 role/ACL을 수정하지 않았습니다.

## 적용 전 조건과 후속 경로

| 조건 | 결과 |
| --- | --- |
| 승인 identity·권한 | PASS |
| V1 구조/reference | PASS |
| 현재 history/적용V1 validate | PASS (BASELINE1/target1). 전체 validate의 예정V2/V3 pending 오류는 별도로 기록 |
| 검증 창 안정성·V1 전수 보존 | PASS |
| SEMAS/I21201·기존분류 충돌 | PASS (없음, target0) |
| custom backup/TOC | PASS |
| 실제 새 격리 DB restore·전수 비교 | PASS (owner/ACL 제외 한계 있음) |
| Polygon ZIP2/고정 report3 SHA | PASS, 원본 수정 없음 |
| 후속 도구/경로 재현 | Python3.12.15/pyshp3.1.6/Shapely2.1.2/GEOS3.13.1/pyproj3.7.0/PROJ9.4.1, Flyway12.4.0 확인. DB없는network-none/read-only image에서 version만 확인 |

8-C2B 리뷰 후에만 V2→보존검사→V3→보존검사→Polygon-only를 별도 승인 범위로 진행할 수 있습니다. identity/history/hash/sequence/입력 SHA 변경·writer/일관성 조건 미충족·새 conflict·backup/restore 불일치·예상 밖 validation 오류는 **NOT_READY/STOP**입니다. 적용과 CSV재적재를 섞지 않습니다. 현재 비어 있는3table을 채우는 작업은 8-C2B에 자동 포함하지 않습니다. POINT가 없더라도 boundary는 독립적이지만 점포 경쟁 데이터 확보까지 완료했다고 주장하지 않습니다.

이번 작업에서 기존 DB에는 읽기 SQL·세션 READ ONLY 정책·pg_dump만 사용했으며 INSERT/UPDATE/DELETE/TRUNCATE/DDL/sequence변경/migration/ETL은 없습니다. 기존 container stop/restart/recreate·volume mount/삭제도 하지 않았습니다. runbook·production code·SQL migration·Compose/Makefile·원본은 유지했습니다. 전체 공간B·4단계 known limitation·historical UNRESOLVED·홍지문H5는 그대로입니다.

## 검증 도구·테스트 기록

임시 read-only bridge guard 테스트2개 PASS, 기존 Python unittest62개는47PASS/fail0/skip15입니다. DB/raw opt-in은 개발 DB에 연결/쓰기를 유발하지 않도록 지정하지 않았습니다. 이 skip을 실제 복원 증거로 쓰지 않고 별도 실제 backup/restore 전수 비교로 확인했습니다. repository에 새 DB 접속 코드나 credential을 추가하지 않았습니다.

초기 임시 도구에서 SQL 문자열 literal의 write 키워드를 잘못 거부한 검사, wide sales NULL 집계의 PostgreSQL100argument 제한, 빈 table 집계의 SQL NULL parser, 성공 Flyway JSON의 nullable errorDetails를 보완했습니다. mutation 거부 조건과 모든 field/NULL 비교는 유지했으며 실패를 PASS로 취급하거나 기존 DB 값을 바꾸지 않았습니다. Flyway는 JSON validationSuccessful을 최종 판단에 사용했습니다. 전체 기본 validate가 pending2건으로 false였다는 사실은 위에 남겼습니다.

## 최종 읽기 전용 리뷰 보완

리뷰에서 임시 NULL 집계의 `to_jsonb(x)`가 commercial_areas의 실제 x column과 충돌해13field count 대신 숫자0을 반환한 사실을 확인했습니다. 초기에는156/169field만 object로 기록돼 있었습니다. 임시 도구를 unambiguous `to_jsonb(null_counts_row.*)`로 고치고 object type·전체 column key set을 필수로 검사했습니다. 격리 READ ONLY 상수 SELECT로 RED(actual0)→GREEN(x/y object)을 확인했으며 fixture 쓰기는 없습니다.

원본과 복원 DB에서 보완 전수 audit를 READ ONLY로 수행해169field NULL count가 모두 같은 object임을 확인했습니다. 원본의 physical/raw/logical digest·ID/POINT·sequence·schema/history와 write counter는 기존 기록과 같았습니다. backup 전 commercial_areas 자체가0행임은 원래 ID 포함 전수 snapshot으로 입증돼 있으므로 누락13field count는 당시에도 모두0이어야 합니다. 보완 실측도 모두0이었습니다. 이전 증거 파일을 덮어써 당시의 측정 누락을 숨기지 않고 supplemental evidence로 연결했습니다. backup/전수 복원의 유효성은 유지되며 기존 DB 값은 수정하지 않았습니다.

접속 문구도 SQL 감사/pg_dump의 Unix socket과 Flyway info/validate의 승인된 Docker network JDBC를 구분했습니다. 그 외 Critical/Important 지적은 없었습니다.

이번 작업의 격리 reference/restore container와 internal network는 제거했습니다. 원본 container는 ID·StartedAt·RestartCount·volume이 시작과 같고 healthy임을 Docker metadata로 최종 확인했습니다. 실제 backup과 private 검증 근거는 제한된 프로젝트 밖 임시 경로에 보관합니다. backup/원본 row/접속값/credential은 Git에 추가하거나 첨부하지 않았고 stage/commit/push도 하지 않았습니다.
