# 기존 개발 DB 안전 기준

**NOT_READY / STOP. V2/V3 migration·행정동/상권 Polygon은 마지막 확인 기록에서 기존 개발 DB에 미적용입니다. 개발 DB 실행 runner는 구현/활성화되지 않았습니다.** 격리 PASS·백업 존재·READY 판정은 실제 mutation 승인이 아닙니다. 2026-10-10 문서 통합에서는 DB·Docker·백업에 접속하지 않았습니다.

## 보호 대상과 마지막 확인

보호 대상은 container `startup-analysis-postgres`, volume `recycleyoungs_postgres_data`입니다. 이름만으로 연결 대상을 확정하지 않으며 현재 full ID/image/PGDATA/network와 연결 자체의 SID를 다시 확인해야 합니다.

마지막 전수 SQL 감사는 **2026-10-09에 커밋된 8-C2B-2 기록**입니다. 8-C2A supplemental snapshot과 같았고 B-3은 source SQL 접속 없이 Docker metadata만 대조했습니다. 아래를 현재값으로 가정하지 않습니다.

| 항목 | 마지막 감사 기록 |
| --- | --- |
| Flyway | 성공 V1 BASELINE 1건, checksum NULL, failed row 없음, V2/V3 미적용 |
| V1 구조 | reference와 169column·19constraint·22index·7sequence/ownership 및 extension/trigger 대조 |
| industries / industry_mappings | 5 / SEOUL mapping 4, SEMAS/I21201 없음 |
| store_stats_dong / sales_dong | 141,218 / 67,113 |
| commercial_areas / sales_commercial_area / **stores** | **0 / 0 / 0** |
| V3 예상 backfill | I21201 대상·충돌 0, backfill **0건**. 원본 전체 점포 건수를 실행 조건으로 고정하지 않음 |
| 보존 증거 | 실제 전 column/ID/FK·169field NULL·POINT NDR/SRID·분포·sequence·history/catalog 비교 |

기존 개발 DB에 전체 CSV가 적재됐다고 주장하지 않습니다. 빈 세 table을 채우는 작업은 V2/V3/Polygon 적용 범위에 자동 포함하지 않습니다.

## V1 BASELINE과 예상 변경

V1 BASELINE의 **NULL checksum을 유지**합니다. SQL V1 checksum으로 바꾸거나 repair/rebaseline하지 않습니다. 성공 SQL migration checksum도 수정하지 않습니다. 과거 target=1 validate 성공과 전체 validate의 V2/V3 pending 오류는 별개였으며 ignoreMigrationPatterns로 숨기지 않았습니다.

정확한 DDL/DML은 [V1/V2/V3 SQL](../backend/src/main/resources/db/migration/)이 기준입니다.

- V2는 새 공간 3table·제약/index/guard를 추가하며 V1 table·값·ID·POINT·NULL·sequence를 보존합니다.
- V3는 mapping/stores에 SHARE ROW EXCLUSIVE lock을 걸고 CAFE 존재·mapping/non-CAFE 충돌을 검사합니다. SEMAS/I21201→CAFE를 추가하고 기존 I21201/industry_id NULL만 UPDATE합니다. 실제 대상 수=변경 수·NULL/충돌 잔존 0을 검증합니다.
- V3의 예상 mapping insert/sequence 변화와 대상 industry_id 외에는 V1 값·ID·FK·POINT·NULL·sequence·history/catalog를 보존합니다. 다른 소분류·이미 CAFE row는 바꾸지 않습니다.
- source와 operational Polygon만 별도 ETL로 적재합니다. V1 대표 POINT·stores/통계 재적재·원본 geometry 교체는 포함하지 않습니다.
- full CSV/점포 loader는 TRUNCATE/ID 재시작·연도 DELETE를 수행하므로 기존 DB backfill/일반 검증에 사용하지 않습니다.

## 과거 검증과 Git 근거

아래는 **당시의 실행 결과**입니다. 각 SHA의 원문 blob이 현재 HEAD의 원래 문서와 같음을 문서 통합 전에 확인했습니다. 상세 로그·수치는 Git에 두고 private 원본/백업/접속값은 공개 문서에 복제하지 않습니다.

| 단계 | 핵심 결과·제한 | 보존된 commit SHA와 원문 |
| --- | --- | --- |
| 8-C1 | 실제 전체 Fresh/Populated 격리 적재·백업/분리 복원·전수 값/ID/sequence·geometry/hash·rollback·공간/index 검증. 기존 DB 미접속 | [b6113585ea4c2ba10d1edf3d57ec999403e9b5dd](https://github.com/jinwooorp/RecycleYoungs/blob/b6113585ea4c2ba10d1edf3d57ec999403e9b5dd/docs/integration-validation-8c1.md) |
| 8-C2A | source READ ONLY/REPEATABLE READ 감사·exported snapshot 연계 dump·격리 전수 restore. 최초 restore는 no-owner/no-acl로 권한 복구까지 증명하지 않음 | [deaed745b31fdcb16355ecc241f46b3dc2b46045](https://github.com/jinwooorp/RecycleYoungs/blob/deaed745b31fdcb16355ecc241f46b3dc2b46045/docs/development-db-8c2a-preflight.md) |
| 8-C2B-1 | source 백업으로 V2→보존→V3→Polygon/retry 격리 리허설. 원본 role/authentication 전체 재현과 실사용자 write 경로는 미검증 | [38e87328e843e78419e4a1c0dd5584fbf3a326b7](https://github.com/jinwooorp/RecycleYoungs/blob/38e87328e843e78419e4a1c0dd5584fbf3a326b7/docs/development-db-8c2b-rehearsal.md) |
| 8-C2B-2 | 원본 권한 catalog·role/ACL 격리 재현/실행, source same-connection READ ONLY SDK 검사, 테스트용 SIMULATED_ONLY gate. 인증 secret은 격리용 | [bde7050ee99e65c45fd276e20394bd41c720cb46](https://github.com/jinwooorp/RecycleYoungs/blob/bde7050ee99e65c45fd276e20394bd41c720cb46/docs/development-db-8c2b-safety-gates.md) |
| 8-C2B-3 | 승인된 영속 백업 복사, 실측 격리 runner/validator 결속·JDBC/publication 연결 검사·STOP | [c36f44fb204fa77ffd77cb4595a63be57f6967bb](https://github.com/jinwooorp/RecycleYoungs/blob/c36f44fb204fa77ffd77cb4595a63be57f6967bb/docs/development-db-8c2b-execution-guard.md) |

B-3 일반 회귀 결과는 **93 PASS / 0 FAIL / 15 SKIP**입니다. 별도 격리 **11단계 pipeline 성공**과 잘못된 SID를 넣은 실제 JDBC/SDK 연결 거부는 이 건수에 합산하지 않았습니다. 15 SKIP은 spatial DB 8·실제 ZIP 2·stores DB 4·실제 CSV 1이며 DB/raw opt-in 없는 결과를 실제 DB 성공으로 확대하지 않습니다.

B-3 pipeline은 V2/V3 history/checksum·V1 보존, mapping 1건 추가/0건 backfill, 격리 mapping sequence 4→5, 행정동 425·상권 1644 valid/6 repair, source invalid/H5/B/UNRESOLVED 보존, READY/current·최종 retry snapshot 동등성을 확인했습니다. 이는 원본 개발 DB의 migration·권한/authentication 검증 결과가 아닙니다.

이전 날짜별 구현·원본 조사·DDL spike 기록도 [deaed745의 프로젝트 기록](https://github.com/jinwooorp/RecycleYoungs/blob/deaed745b31fdcb16355ecc241f46b3dc2b46045/docs/project-status.md)에 있습니다. Git 조회는 `git show <SHA>:<원래 문서 경로>`로 수행하며 reset/restore로 작업 트리를 바꾸지 않습니다.

## 연결 identity·writer·권한

접속 전 full container ID·image immutable ID·실제 image inspect·PGDATA/volume·network ID/alias/DNS/port를 확인합니다. 접속은 승인된 explicit host/port/database/user/secret으로 고정하고 ambient libpq/Flyway override·잘못된 route를 거부합니다. secret·JDBC URL·환경 전체·원본 row를 로그/인덱스/Git에 노출하지 않습니다.

반환할 **같은 연결**에서 current_database/current_user/session_user/SID·PGDATA/내부 port·READ ONLY/격리수준·timeout·idle/autocommit을 검사합니다. 별도 사전 연결의 PASS를 실제 write/publication 연결 증거로 사용하지 않습니다. 실패하면 연결을 닫고 STOP합니다. source 조회는 READ ONLY transaction이며 권한 검사를 위한 시험 쓰기는 금지합니다.

writer 확인은 DB client·프로젝트 backend/ETL·prepared transaction·subscription·예약 실행 등 관찰 가능한 쓰기 경로와 실제 통제 범위를 포함합니다. 일시적으로 client가 없었다는 사실은 미래 writer 부재의 보장이 아닙니다. snapshot/dump/migration 전후 검증 창의 변화는 STOP입니다.

권한은 실제 migration actor의 role attributes/membership·DB/schema/default ACL·table/column/sequence/function/type owner/ACL/effective privileges를 대조합니다. V2 생성·history INSERT/조회·V3 row lock/SELECT/UPDATE·mapping INSERT/sequence·Polygon lifecycle/trigger 권한을 나누며 superuser라는 가정이나 catalog true만으로 실제 실행 성공을 주장하지 않습니다. password/hash 원문은 조회/복제하지 않고 상세 근거는 private 보관합니다.

격리 B-3 Flyway는 public schema 고정, createSchemas=false·baselineOnMigrate=false·cleanDisabled=true·group=false·outOfOrder=false·connectRetries=0·executeInTransaction=true·mixed=false, target 2/3 분리입니다. initSql이 **같은 JDBC 연결**의 database/user/SID/PGDATA/port·5s lock/10min statement timeout을 검사하고 불일치 시 division-by-zero로 거부합니다. source의 과거 readonly info/validate와 source mutation JDBC 경로의 승인을 혼동하지 않습니다.

Polygon factory는 실제 반환 연결의 user/session_user/SID/PGDATA/port·write session/timeout·idle autocommit을 검사하고 그 연결을 publish에 전달합니다. 보호 구조는 [control.py](../etl/control.py), [control_backend.py](../etl/control_backend.py), [control_worker.py](../etl/control_worker.py), [spatial_main.py](../etl/app/spatial_main.py)에 있습니다. 현재 개발 DB 경로의 구현·리뷰·실사용자 검증은 남아 있습니다.

## 백업·독립 restore와 복구 가능성

8-C2A는 READ ONLY/REPEATABLE READ coordinator의 exported snapshot을 baseline과 pg_dump -Fc --snapshot에 공유하고 전후 전수 값을 대조했습니다. sequence는 MVCC 밖이므로 last_value/is_called·설정·ownership/dependency를 별도로 검사했습니다. 새 격리 restore의 값/ID/POINT/NULL·history/catalog를 원본 snapshot과 비교했습니다.

B-2의 영속 위치 미승인 blocker 이후 B-3에서 승인된 private 위치에 새 복사본을 만들고 원본을 유지했습니다. byte/SHA·0700 directory/0600 file·추가 ACL 없음·소유자·symlink/overwrite 방지를 확인했습니다. **이 복사본은 과거 8-C2A snapshot**이고 최신성이나 별도 디스크 재해복구 백업을 보증하지 않습니다.

실제 적용 직전 writer 통제·새 snapshot-bound backup·새 독립 restore·owner/ACL/role·실사용자 복구/접속 가능성을 다시 확인해야 합니다. 내부 SSD/FileVault 복사와 별도 암호화 매체를 구분하고 role/ACL metadata 영속 보관·관리자·retention·키 관리·복구 리허설 정책을 확정합니다. 백업 원본/복사본은 최종 적용 리뷰·복구 검증 종료까지 보존하며 삭제/이동/덮어쓰기·기존 DB restore는 별도 승인 대상입니다.

격리 대상은 전용 internal network, host port 없음, 기존 volume/mount 없음, data/init tmpfs, 승인된 고정 image·자원 소유 label·새 run을 사용합니다. 이름 prefix/proof만으로 격리를 주장하지 않고 실제 inspect와 server identity를 대조합니다. 만든 자원만 정리합니다.

## 실행과 검증 gate

아래는 승인 전 검토할 계약입니다. 일반 Makefile/직접 ETL로 단계를 건너뛰거나 격리 guard를 완화해 source에 연결하지 않습니다.

| 순서 | 실행/검증 | 통과 조건 |
| --- | --- | --- |
| 1 PRECHECK | Git·실제 대상/연결·writer·권한·history·catalog·전수 baseline·입력 검사 | 예상 상태와 일치, source 보호, 최신 proof·고정 SQL/image/manifest |
| 2 BACKUP_RESTORE_VERIFIED | 새 snapshot-bound backup·독립 restore | backup SHA/size·복원 값/ID/POINT/NULL/sequence/history/권한·복구 가능성 |
| 3 V2_APPLIED | Flyway target=2 migrate | 실제 JDBC identity·exit/history/checksum, V1 변경 없음 |
| 4 V2_VERIFIED | target=2 validate·전수 보존 | V1 전 값/ID/sequence·history 원행, 공간 3table 초기 상태 |
| 5 V3_APPLIED | target=3 migrate | lock·충돌 검사·reference·NULL 대상 최소 backfill |
| 6 V3_VERIFIED | 전체 validate·전수 보존 | 예상 대상 수/변경/분류, 허용 mapping/sequence 변화만, 다른 V1 값 불변 |
| 7 ADMIN_POLYGON_APPLIED | explicit 입력·실제 guarded 연결로 admin-only | 승인 profile·source/operational/hash와 transaction publication |
| 8 ADMIN_POLYGON_VERIFIED | 전수 경계·current·V1 보존 | 425 VALID_SOURCE·READY/current·B/UNRESOLVED·원본 불변 |
| 9 COMMERCIAL_POLYGON_APPLIED | explicit 입력·guarded 연결로 commercial-only | 승인 6건 외 repair 없음, transaction publication |
| 10 COMMERCIAL_POLYGON_VERIFIED | 전수 경계·current·V1 보존 | 1644 VALID_SOURCE/6 REPAIRED_OPERATIONAL, H5/raw 속성·hash·version 유지 |
| 11 FINAL_VERIFIED | 최종 전수·동등 retry·source hash·공간/index | V3 이후 V1 유지, 같은 spatial ID/loaded_at/hash·snapshot, 실패/skip 분리 |

snapshot 검증은 실제 모든 column과 NULL/0/빈 문자열/NO_ROW를 구분하고 ID 정렬·UTF-8 row의 8byte big-endian 길이 framing으로 streaming digest를 계산합니다. physical·industry_id 제외 raw·논리 분류 digest를 분리하며 예상 V3 변경만 마스킹합니다. ID/source ID/FK·POINT NDR/SRID·전 field NULL·sequence·history/catalog를 별도 대조합니다. count·몇 개 샘플·ST_Equals만으로 전수 보존을 주장하지 않습니다. 구현 기준은 [integration_support](../etl/tests/integration_support.py)입니다.

SQL·DB/Flyway/ETL image·backup/reference·ZIP/member/report·processing profile·app/controller/전이 validator source·Git/target·private config hash를 stage 전후 결속합니다. 실측 exit와 validator·연결 identity·현재 fingerprint를 runner가 수집하며 외부 PASS나 SIMULATED_ONLY를 받아 승인하지 않습니다.

증거는 project 밖 소유자 일치/0700·빈 private 작업 위치에 symlink 없이 exclusive 생성합니다. fresh nonce·순서·최대 30분 TTL·hash/HMAC chain·로그/validator/snapshot SHA·atomic state·메모리 anchor를 검사합니다. hash/HMAC는 변조 탐지이며 사람 승인이나 코드/config/secret을 통제하는 actor에 대한 독립 보안 경계가 아닙니다.

## STOP·복구·Go/No-Go

identity/input/hash/context 변화, writer/권한·backup/restore 불일치, 새로운 충돌, missing/FAIL/UNKNOWN gate, exit!=0/validator false, 순서/중복·stale/future/cross-run·TTL 만료·state/log/snapshot 변조는 **terminal STOP**입니다. 자동/force/resume 재개는 없고 원인 리뷰 후 새 run/PRECHECK와 필요한 승인을 요구합니다.

- V2 실패: script rollback·history·V1 보존을 확인하고 중단합니다.
- V2 성공/V3 실패: V2 schema는 남습니다. V3 rollback·기존 값 보존을 확인하며 repair/full ETL로 통과시키지 않습니다.
- Polygon 실패: 실패 kind transaction만 rollback합니다. 이미 성공한 다른 kind를 자동 삭제하거나 사후 identity 검출이 commit을 되돌렸다고 주장하지 않습니다.
- 보존 실패: reader 공개/후속 쓰기를 중지하고 증거를 확보합니다. 원본 초기화·DROP·volume 삭제·backup 덮어쓰기를 하지 않습니다.
- 복구가 필요하면 검증된 backup을 **새 분리 DB**에 복원·검증하고, 기존 DB restore/접속 전환 범위를 별도 승인받습니다. 자동 원본 restore는 없습니다.

Go 검토는 최신 모든 조건·실제 연결 경로·복구 계획·독립 리뷰·예상 변경 범위가 충족돼야 합니다. 이 조건이나 과거 PASS만으로 mutation은 허용되지 않으며 **대상과 V2/V3/Polygon 범위의 명시적 사용자 승인**이 마지막에 필요합니다. 현재는 개발 DB runner·최신 snapshot/권한/연결 검증·승인이 없어 NOT_READY입니다.

`make db`/`make db-info`/`docker compose up`도 container 시작·재생성 범위를 확인합니다. `make db-migrate`·`make etl`·`make db-baseline`·Flyway migrate/baseline/repair/clean·Polygon --load·DDL/DML·role/ACL/sequence 변경과 기존 container stop/restart/recreate·volume mount/delete·restore는 승인 없이 실행하지 않습니다. Spring bootRun·dbTest는 pending migration을 자동 실행할 수 있어 사전 점검 경로가 아닙니다.

Git stage/commit/push는 해당 범위의 별도 명시적 승인 후에만 수행하며 코드 리뷰 전 실행하지 않습니다. reset/restore/clean/stash·임의 branch/worktree·자동 merge/rebase·force push로 상태를 복구하지 않습니다. 필수 에이전트 규칙은 [AGENTS](../AGENTS.md)를 함께 따릅니다.
