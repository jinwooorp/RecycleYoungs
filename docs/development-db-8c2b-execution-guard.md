# 8-C2B-3 실행 보호 도구·영속 백업 준비

검증일: 2026-10-09 (Asia/Seoul).

**격리 실행 보호 검증 PASS. 개발 DB 실행 모드는 구현/활성화하지 않았습니다. 실제 적용은 NOT_READY이며 이번 완료는 mutation 승인도 아닙니다.**

## 1. Git·수행 범위

시작 main/local·GitHub remote HEAD bde7050ee99e65c45fd276e20394bd41c720cb46, clean·diff-check0을 확인했습니다. 사용량 제한 후에는 영속 복사 완료 증거와 같은 Git 상태를 확인하고 구현부터 재개했으며 복사를 반복하지 않았습니다.

기존 개발 DB SQL 접속·Flyway·ETL·DDL/DML·GRANT·restore·sequence 변경, 기존 container/volume 변경, Spring/dbTest는 미실행입니다. Docker 보호 대상 metadata만 검사했고 전후 full ID·image·StartedAt·RestartCount·volume이 동일했습니다.

## 2. 영속 백업

사용자가 프로젝트 밖 위치를 명시 승인했습니다. 해당 경로의 symlink 구성요소를 거부하고 필요한 새 디렉터리를0700으로 생성했습니다. exclusive 생성으로 새 복사본1개만 만들고 원본은 유지했습니다. 기존 파일 덮어쓰기·원본 이동/삭제는 없습니다. 실제 경로/파일명은 Git에 기록하지 않습니다.

| 항목 | 실측 |
| --- | --- |
| 크기 | 11690636 bytes |
| SHA-256 | 970cb9016b67b95b9e1c3bb291f762a229129f2a3884551e16053aca26f2089d |
| 원본·복사본 SHA | 동일 |
| directory/file mode | 0700/0600 |
| 추가 ACL entry | 0/0 |
| 대상 매체 | 내부 SSD/APFS/FileVault=true |
| 여유 공간 | 약736GiB |
| 기존 파일 overwrite | 없음 |

이 복사본은 과거8-C2A snapshot입니다. 현재 DB의 최신 backup이라고 주장하지 않습니다. 최소한 최종 적용 리뷰·복구 검증 종료까지 보존하며 삭제는 별도 승인으로만 진행합니다. 관리자/접근은 현재 개발자에게 제한합니다.

동일 내부 디스크 복사는 단일 디스크 장애에 대한 별도 매체 백업이 아닙니다. 암호화된 외장/별도 저장 매체, 암호화 키 관리·retention은 후속 정책입니다. role/ACL 원문 근거는 기존 private evidence에 보관하며 영속 metadata archive는 별도 검토가 필요합니다. 실제 적용 직전 새 snapshot-bound backup/restore는 여전히 필요합니다.

## 3. 변경 파일·최소 ETL 변경

- etl/control.py: 기본 inspect/dry-run, 순서 dispatch·실측 ledger·STOP, isolated connection/target 및 Flyway init SQL guard
- etl/control_backend.py: Docker/SQL/backup/input artifact fingerprint, 실제 subprocess·validator 수집
- etl/control_worker.py: 기존 snapshot/audit/CLI 재사용, actual connection factory와 DB 검증
- etl/tests/test_control.py: 새 controller/guard/CLI 통합 계약27개
- etl/app/spatial_main.py: main의 선택적 keyword-only connection_factory와 연결 선택2곳
- 이 결과 문서

main의 기본값 None은 기존 connect_database를 그대로 사용합니다. CLI 인수·offline 검증·prepare-before-connect·finally close·종류별 transaction은 유지했습니다. spatial_load/geometry/sources 및 SQL·Backend·Frontend·기존 safety_gate와19개 테스트는 변경하지 않았습니다. main은 기존 processing profile의 구현 hash 대상이 아니므로 READY retry identity도 유지됐습니다.

## 4. 실행 도구 경계

기본 python etl/control.py는 로컬 Git과 비활성 정책을 출력하고 DB에 접속하지 않습니다. --isolated-run은 명시적인 private config/evidence와 ephemeral secret을 요구합니다. development/production/force/resume 옵션은 없습니다.

허용 target은 승인된 ry-8c1 이름·DB prefix·integration_test actor, full container ID/image/label, 전용 internal network/alias, host port 없음, Mounts=[], data/init tmpfs입니다. 보호 container ID·원본 system identifier는 무조건 거부합니다. Docker Aliases 또는 실제 DNSNames의 승인된 동일 이름을 검사합니다.

SQL은 고정 SHA, 이미지는 고정 immutable ID와 실제 image inspect, backup은 고정 SHA/size, restore reference/validator source도 SHA로 검증합니다. 실제 DB container image도 승인된 DB image ID와 직접 결속합니다. ZIP2/member10/report3 및 profile·app의 전체 Python source/controller/integration_support validator·Git/target를 fingerprint에 묶어 매 stage 전후 재검사합니다. private config 자체의 변경도 무효화합니다.

작업 디렉터리는 소유자 일치·0700·빈 디렉터리·symlink 우회 없음이 필수입니다. subprocess 로그와 worker의 snapshot JSON은 exclusive 생성하며, 생성된 validator JSON의 SHA를 메모리 registry와 sealed stage result에 연결합니다. 다음 worker와 stage에서 원래 SHA를 다시 확인하므로 baseline/snapshot 변경도 STOP입니다.

Source credential은 사용하지 않았습니다. 격리 secret·JDBC URL은 로그에서 감추고 raw backup/row/actual path를 Git/index로 보내지 않았습니다. runtime/source profile도 기존 고정값과 대조했습니다.

## 5. 실제 stage 및 증거

PRECHECK → BACKUP_RESTORE_VERIFIED → V2_APPLIED → V2_VERIFIED → V3_APPLIED → V3_VERIFIED → ADMIN_POLYGON_APPLIED → ADMIN_POLYGON_VERIFIED → COMMERCIAL_POLYGON_APPLIED → COMMERCIAL_POLYGON_VERIFIED → FINAL_VERIFIED.

CLI는 이 순서로만 dispatch합니다. Controller는 실행기를 직접 호출하고 실제 exit·DB validator·전후 identity·현재 fingerprint를 수집합니다. 외부 PASS 문자열이나 기존 SIMULATED_ONLY를 입력받지 않습니다. 각 실측 record는 fresh nonce·순서·로그 SHA·memory HMAC·private atomic state로 연결합니다.

FAULT/UNKNOWN/exit!=0/validator false/identity/input 변경/stale state는 terminal STOP이며 다음 stage는 시작되지 않습니다. 유효시간은 stage 시작과 완료 시점 모두 검사하고, 만료된 완료 상태도 fresh PASS로 반환하지 않습니다. 기존 state 재사용은 거부합니다. 수동 재개는 원인 리뷰 후 새 run/precheck로만 진행합니다.

hash/HMAC 자체는 사람의 승인이나 임의 Python code에 대한 보안 경계가 아닙니다. trusted 실행기·validator 측정을 연결하는 변조 탐지입니다. 코드/secret/config을 제어할 수 있는 actor에 대한 독립 인증이라고 주장하지 않습니다. 완료 record도 개발 DB 실행을 승인하지 않습니다.

## 6. Flyway 실제 JDBC 연결

Flyway12.4.0, schemas/defaultSchema=public, createSchemas=false, baselineOnMigrate=false, cleanDisabled=true, group=false, outOfOrder=false, connectRetries=0, executeInTransaction=true, mixed=false를 고정했습니다. target2와 target3를 분리했습니다.

initSql에서 같은 JDBC connection의 timeout을5s/10min으로 설정하고 current_database/current_user/system_identifier/실제 data_directory/port 및 timeout predicate가 false이면 SELECT의 division-by-zero로 실행을 거부합니다. 별도 사전 connection만 검사한 것이 아닙니다.

실제 격리 target2/target3 migrate·validate와 history/checksum을 확인했습니다. validate는 exit0뿐 아니라 operation/version/errorDetails/validationSuccessful/invalidMigrations도 검사합니다.

별도 작은 격리 DB에서 **잘못된 SID initSql의 실제 JDBC info 호출이 실패하고 public table 수가 그대로**임을 확인했습니다. 이 테스트에서도 기존 개발 DB는 사용하지 않았습니다.

## 7. 실제 publication connection

새 factory는 기존 connect_isolated 사전 guard를 유지하고, 반환할 같은 SDK connection에서 DB/user/session-user/SID/PGDATA/port, idle autocommit, write session과 timeout을 검사합니다. 검증 실패는 close 후 main에 반환하지 않습니다.

실제 main(connection_factory=...)은 이 exact connection을 publish에 전달합니다. 성공/실패 후 main의 기존 finally가 close합니다. factory 검증 실패는 factory가 자체 close합니다.

별도 격리 DB에서 실제 SDK의 잘못된 SID를 거부·close했고, main(factory) rc1 및 publication 이전 DB 불변을 확인했습니다. connection change 사후 검출은 이미 commit된 kind를 되돌리지 않고 STOP하는 경계입니다.

## 8. 실제 격리 pipeline 결과

승인된 영속 복사본을 새 빈 tmpfs DB에 owner/ACL 포함 restore한 뒤 기존8-C2A full audit/reference와169 NULL·ID/POINT/sequence/history/catalog를 대조했습니다. target container의 ambient libpq/Flyway 환경도 거부하며 psql/pg_restore는 container 내부127.0.0.1:5432를 명시해 restore 연결 경로를 고정했습니다.

11개 stage를 모두 실제로 통과했습니다.

- V2 target2 migrate/validate, V1 값·sequence 불변, 공간3table0행
- V3 target3 migrate/전체validate, expected history/checksum, SEOUL4 보존·SEMAS/I21201→CAFE1개·backfill0·mapping sequence4→5
- 행정동425 VALID_SOURCE, 상권1644 VALID_SOURCE/6 REPAIRED_OPERATIONAL
- operational valid nonempty MultiPolygon5181·source/operational WKB/SHA, source invalid6 및 H5 보존
- 종류별 READY/current, B/UNRESOLVED 및 고정 profile 유지
- 최종 full spatial retry snapshot 동일, V1 full audit는V3 직후와 동일

사용한 계정은 격리 검증 계정이며 원본 권한 재현 성공을 이번에 새로 주장하지 않습니다. 권한 차이 검증 근거는8-C2B-2를 참조합니다. 새 container/network와 --rm runner는 제거했습니다. 기존 source metadata는 동일했습니다.

## 9. 실패·재개 검증

새27개 테스트는 잘못된 resource/volume/DB/user/SID/PGDATA/timeout, SQL/backup/image SHA, ambient PG/Flyway, missing/FAIL/stale/order, state/log 위조, migration·V3 validator·admin 실패 후 dispatch 차단, 전체 fake PASS 후 development 거부를 확인합니다. main의 exact factory 전달·close·publication 미호출, secret/JDBC 로그 감춤도 포함합니다.

독립 리뷰에서 validator의 전이 import hash 누락, 실행 도중 TTL 만료, 실제 DB image 결속, private/fresh work 및 snapshot 무결성, restore 접속 환경의 다섯 범주를 발견했습니다. 실패 회귀를 먼저 확인한 뒤 보완했고 재리뷰에서 중요한 결함이 남지 않았습니다. 변경한 보호 코드의 새 격리 DB에서11개 stage를 다시 통과했습니다. 기존 백업 복사는 반복하지 않았습니다.

실제 JDBC wrong-SID와 실제 publication wrong-SID는 별도 격리 실측입니다. full run 중 실행 artifact SHA가 변경된 사건도 terminal STOP으로 거부했고 다음 gate를 승인하지 않았습니다. 해당 증거를 유지한 뒤 고정 코드의 새 run/새 DB에서 PRECHECK부터 성공했습니다. 이전 PASS를 재사용하지 않았습니다.

초기 격리 startup readiness 및 Docker DNSNames 형식 문제는 restore 이전에 중단됐습니다. 검사 조건을 제거하지 않고 실제 SQL 준비/같은 승인 DNS 이름을 확인하도록 보완했습니다. 테스트 patch 구문 오류도 실행 전에 수정하고 전체 suite를 다시 확인했습니다.

## 10. 테스트 PASS/FAIL/SKIP

새27개와 기존81개 전체 결과는108개: 93 PASS /0 FAIL /15 SKIP입니다. 기존 safety_gate19개는 유지됩니다. DB/raw opt-in 없이 network=none 회귀 runner에서 실행했습니다.15 skip은 기존 spatialDB8/realZIP2/storesDB4/realCSV1이며 PASS로 간주하지 않습니다.

실제11stage pipeline과 두 연결 negative는 별도 격리 실측이며 위 unittest count에 합산하지 않습니다. 실패 원인·STOP 로그 및 성공 로그는 private evidence로 보존합니다.

## 11. 기존 DB 및 승인 경계

기존 개발 DB는 이번에 SQL·migration·ETL·restore·권한 변경·sequence 변경을 하지 않았습니다. Docker metadata만 읽었고 기존 container/volume을 변경하지 않았습니다. 실제 source mutation mode는 없습니다.

실제 적용에 필요한 최신 identity/user/role/writer·hash/sequence/history 재검증, 새 snapshot-bound backup/restore, 실제 사용자의 JDBC 경로, runner activation 코드 리뷰와 명시적 승인은 남아 있습니다. 이번 영속 복사와 격리 성공은 이 조건을 대신하지 않습니다.

## 12. 백업 정책 후속

내부 디스크/FileVault의 보호와 별도 재해복구 매체를 구분합니다. 향후 암호화된 별도 장치·role/ACL metadata의 영속 보관·관리자/retention/키 관리·복구 리허설을 결정해야 합니다. 기존 원본과 새 복사본은 삭제/이동하지 않았고 자동 삭제 정책을 만들지 않았습니다.

## 13. Git·변경 범위

main/기준 HEAD를 유지하며 stage/commit/push·branch/worktree·reset/restore/clean/stash는 미실행입니다. 변경1개와 신규5개를 별도 확인하며 diff-check/status/stat을 수행합니다. SQL·Backend·Frontend·기존 safety gate 및 runbook은 그대로입니다.

## 14. 도구·한계

Superpowers 계획/TDD/debugging/verification·리뷰, context-mode 코드/로그 요약, GitHub HEAD 대조와 읽기 전용 Flyway/Polygon/backup-gate 조사 결과를 사용했습니다. Flyway 조사 agent는 사용량 제한으로 종료돼 제공된 부분 결과와 실제12.4.0 격리 관찰을 구분합니다. Build Web Apps는 미사용입니다.

실행기 완성 범위는 **측정 가능한 격리 제어·중단 조건**입니다. 완성된 production write runner라고 주장하지 않으며 이번 완료는 기존 개발 DB 적용 허가가 아닙니다.
