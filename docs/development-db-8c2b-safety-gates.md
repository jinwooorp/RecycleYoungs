# 8-C2B-2 실제 적용 전 안전 조건 검증

검증일: 2026-10-09 (Asia/Seoul).

**최종 판정: NOT_READY / STOP. 실제 V2/V3 migration·Polygon/CSV ETL은 기존 개발 DB에서 실행하지 않았습니다.** 승인된 영속 백업 위치와 실제 쓰기 실행 wrapper 검토가 남아 있습니다. 이번 결과는 실제 적용 승인이 아닙니다.

## 1. 시작 Git 상태

main / local HEAD 및 GitHub remote main 38e87328e843e78419e4a1c0dd5584fbf3a326b7 / clean, git diff --check exit0을 확인했습니다. Production ETL·Backend·Frontend·V1/V2/V3 SQL·기존 runbook을 변경하지 않았습니다. 기존 문서와 검증 도구를 조사하고 읽기 전용 subagent3개의 권한·백업·guard 검토를 통합했습니다.

## 2. 기존 개발 DB identity와 V1 재확인

startup-analysis-postgres / recycleyoungs_postgres_data의 Docker full ID·running/healthy·image·단일 volume/PGDATA·network/alias를 읽고 8-C2A의 승인된 DB/user와 대조했습니다. source 조회는 기존 READ ONLY bridge를 재사용했습니다.

접속 직후 같은 session에서 current_database/current_user/system_identifier=7692329130053947430, transaction_read_only=on, REPEATABLE READ 및 승인 Unix socket 경로를 확인한 뒤 SELECT만 실행했습니다. 비밀번호/hash는 DB catalog에서 조회하지 않았습니다.

시작·격리 검사 후 원본 전수 감사가 8-C2A supplemental snapshot과 일치했습니다: physical/raw/logical digest, ID/FK, 169 NULL fields, POINT NDR/SRID, 분포, sequence 값/설정/column dependency, 전체 Flyway history 및 V1 catalog. history는 성공 BASELINE1/checksum NULL 한 건이고 V2/V3는 미적용입니다.

| 테이블 | 실측 rows |
| --- | ---: |
| industries | 5 |
| industry_mappings | 4 |
| commercial_areas | 0 |
| store_stats_dong | 141218 |
| sales_dong | 67113 |
| sales_commercial_area | 0 |
| stores | 0 |

이 관찰은 적용 직전 재검증을 대신하지 않습니다. 최신 exported snapshot·새 backup은 이번에 만들지 않았습니다.

## 3. 실제 role/owner/ACL/membership

승인된 현재 접속 사용자를 migration 후보 사용자로 대조했습니다. pg_roles에서 LOGIN/SUPERUSER/CREATEDB/CREATEROLE/INHERIT/REPLICATION/BYPASSRLS/connlimit/validuntil을 명시 조회했으며 password/hash 필드는 제외했습니다.

pg_auth_members의 admin/inherit/set_option, DB owner/CONNECT/CREATE/ACL, public schema owner/USAGE/CREATE/ACL, default ACL, V1 table·sequence·history·PostGIS 객체와 함수 signature별 owner/ACL/effective privileges, 관련 column ACL을 확인했습니다. 상세 role 이름·속성 원문·membership·ACL은 프로젝트 밖 private evidence에만 보관합니다.

현재 actor의 직접 membership은 없고 default ACL은 비어 있었습니다. public 객체 ACL 중 비기본 항목1개가 있어 NULL로 가정하지 않고 격리 복원 결과와 정확히 대조했습니다.

source에서 GRANT/REVOKE/ALTER ROLE/SET ROLE·시험 DDL/DML은 미실행입니다. Unix socket 실제 로그인을 관찰했습니다.

## 4. migration 사용자 권한 판정

카탈로그상 다음 12개 요구 그룹이 모두 true입니다. 여러 privilege를 comma로 묶지 않고 개별 검사했습니다.

- DB CONNECT, public USAGE/CREATE, plpgsql·geometry/trigger type USAGE
- history SELECT/INSERT, 필요한 PostGIS/내장/advisory 함수 EXECUTE
- mappings/stores 각각 SHARE ROW EXCLUSIVE 잠금에 필요한 table-level UPDATE/DELETE/TRUNCATE 중 하나
- industries FOR KEY SHARE를 위한 SELECT(id,code)와 최소 한 column UPDATE
- mapping 입력 column INSERT/조회, serial sequence USAGE 또는 UPDATE
- stores 조회 column SELECT와 industry_id UPDATE

V2 새 객체의 생성자 소유권·index/function/trigger/FK 조건과 Polygon의 versions SELECT/INSERT/UPDATE·boundary INSERT/검증 SELECT·sequence·SECURITY INVOKER guard 권한을 구분했습니다. 아직 없는 V2 객체의 권한은 생성 전 catalog만으로 실행 성공을 증명할 수 없어 격리에서 확인했습니다.

정상 Flyway history 경로의 최소 SELECT/INSERT와 repair용 UPDATE/DELETE를 구분합니다. 이번 source에서는 Flyway info/validate도 실행하지 않았습니다. Flyway12.4 PostgreSQL connection 구현의 SET ROLE 경로를 원본 감사에 섞지 않고 history를 직접 SELECT했습니다.

Catalog 판정은 실제 source mutation 성공의 완전한 증거가 아닙니다. [PostgreSQL16 privileges](https://www.postgresql.org/docs/16/ddl-priv.html), [LOCK](https://www.postgresql.org/docs/16/sql-lock.html), [SELECT row lock](https://www.postgresql.org/docs/16/sql-select.html)

## 5. 백업·영속 보관

8-C2A 원본의 존재·소유자·regular file·11690636 bytes·SHA를 읽기 전용으로 재확인했습니다.

SHA-256: 970cb9016b67b95b9e1c3bb291f762a229129f2a3884551e16053aca26f2089d

file0600/directory0700, 추가 ACL entry0을 확인했습니다. 부모 temp 영역은1777입니다. 매체 조회는 내부 SSD/APFS·FileVault=true이며 개별 Encrypted 속성은 NOT_VERIFIED입니다. 파일시스템 잔여 공간은 약736GiB였으나 이는 승인된 보관 위치의 용량 검증이 아닙니다.

**사용자는 승인된 영속 위치가 아직 없음을 확인했습니다.** 기존 파일은 temp 경로이므로 영속 보관 PASS로 처리하지 않습니다. 복사·이동·삭제·덮어쓰기는 미실행입니다.

후보는 (a) temp/Git 밖 사용자 소유 private 디렉터리, (b) 암호화된 별도 외장 저장장치입니다. 실제 경로를 확정하거나 생성하지 않았습니다. 위치·접근 정책·관리자·retention·암호화/키 관리·복구 시 접근 가능성을 별도로 승인해야 합니다. 복사 승인 후에는 원본을 유지하고 새 복사본 byte/SHA·0700/0600·ACL을 검증해야 합니다.

현재 DB digest 일치는 과거 backup의 최신성 보증이 아닙니다. 실제 적용 직전 writer 통제와 새 exported snapshot 연계 dump, 새 격리 restore가 필요합니다.

## 6. 격리 권한 복구 차이 검증

8-C2B-1의 제한된 owner-name role과 실제 원본 속성에 차이가 있어 새 internal network/no-host-port/no-volume/data+init tmpfs cluster에서 해당 차이만 확인했습니다. 승인된 immutable PostGIS/Flyway/ETL 이미지를 사용했습니다.

원본에서 관찰한 role 속성을 동일하게 재현했고 직접 membership 없음·전체 기본 membership·DB/schema/default ACL·공개 table/sequence 및 관련 함수 owner/ACL을 원본과 대조했습니다. 원본 password/hash는 복사하지 않고 **격리 전용 임시 secret**으로 로그인했습니다.

고정 백업을 새 빈 격리 DB에 owner/ACL 포함 restore, 같은 role로 V2→V1 보존→V3→변경 범위를 검증했습니다. 기존 fixture 유틸리티의 소규모 합성 Polygon을 종류별 publication/retry했습니다. 전체425/1650 재적재 리허설은 반복하지 않았습니다.

원본 V1 값·ID·POINT·sequence를 격리에서 보존했고 V3의 mapping1건 추가/0건 backfill 외 변화가 없었습니다. Polygon 후 V1 audit는 V3 직후와 동일했습니다. 종료 후 이번 clone/container/network만 제거했습니다.

이는 관찰한 권한 구조와 격리 실행 권한의 검증입니다. 인증 구성은 격리용이며 원본 JDBC client 경로를 그대로 복원했다고 주장하지 않습니다.

## 7. 실제 connection 보호 검증

tests/safety_gate.py는 production 경로에 연결하지 않은 테스트 전용 계약입니다. 기본 실행은 접속/SQL/실행 없이 비활성 상태만 출력합니다. 실제 쓰기 활성화 API와 execution callback runner는 없습니다.

open_checked는 strict explicit5키 connection params, ambient PG/libpq/Flyway override, 예상 container/network/alias/volume/PGDATA/image proof를 먼저 검증합니다. 반환될 동일 connection에서 DB/current_user/session_user/SID·READ ONLY/default READ ONLY·isolation·timeout·idle/autocommit을 조회합니다. 오류/누락/불일치는 반환하지 않고 close를 요청하며 에러 상세를 감춥니다.

격리 SDK connection으로 동일 connection 검사를 실행했습니다. 최종 input-manifest 계약 확장 후에는 **원본의 승인된 network/alias에도 READ ONLY SDK connection으로 재검증**했습니다. Docker identity/proof를 먼저 확인하고 같은 connection의 SID/DB/user/session/PGDATA/내부port/timeout을 확인했습니다.

현재 configured credential로 network/libpq 로그인 PASS입니다. secret은 메모리와 일회성 runner 환경으로만 전달했고 파일/로그/Git에는 저장하지 않았습니다. password/hash catalog 조회는 없었습니다. **JDBC/Flyway client 경로 자체는 NOT_VERIFIED**입니다.

Source READ ONLY options는 실제 신규 connection 시작에 적용됐습니다. 별도 사전 연결의 결과를 적재 connection 검사라고 표현하지 않습니다. 이번에는 원본 적재 connection이나 source write mode를 생성하지 않았습니다.

## 8. 단계별 gate 계약

단일 순서는 preflight→backup_restore→v2_migrate→v2_verify→v3_migrate→v3_verify→admin_polygon→admin_verify→commercial_polygon→commercial_verify→final_verify입니다.

테스트 전용 GateSession은 fresh run ID·고정 context·최대30분 TTL·Git/DB/container/network/volume/image·backup/SQL/role-ACL/input manifest SHA를 묶습니다. 순서 누락/역전/중복, 이전 FAIL/UNKNOWN, stale/future/cross-run PASS, context 변경, state/log 변조는 terminal STOP입니다.

증거는 project 밖0700/0600 private 경로, symlink 제한, atomic state, memory anchor·hash chain·log SHA로 검사합니다. 기존 state/STOP을 새 session에서 재사용하지 않습니다. 실패 재개는 자동/force 방식이 아니라 수동 검토 후 새 preflight/run을 요구합니다.

**SIMULATED_ONLY 증거입니다.** hash chain은 변조 탐지이지 사람 승인/실제 실행 증명이 아닙니다. 실제 runner의 성공 로그·validator·fresh snapshot 연결과 전체 ZIP/member/report/implementation/profile manifest 수집은 후속 통합 검토 대상입니다. 실제 실행 코드를 승인했다고 주장하지 않습니다.

require_development_write는 모든 stage와 전체 PASS 후에도 무조건 거부합니다. production spatial_main/load를 수정하거나 guard를 배포 경로에 연결하지 않았습니다.

## 9. 실패 테스트

로컬 TempDir/fake connection 테스트19개를 작성했습니다. 최초 미구현18 FAIL을 확인한 뒤 구현했고, connector 실패 상세 누출도 RED→GREEN으로 보완했습니다.

| 요구 사례 | 결과 |
| --- | --- |
| 잘못된 container/DB/user/SID | 접속 전 거부 또는 동일 connection 검사 후 close 요청 |
| backup/SQL/image/role-ACL/input manifest 변경 | context 무효화·STOP |
| 이전 gate 누락/FAIL/순서 오류 | STOP, 다음 단계 불가 |
| evidence log/state 변경 | hash/anchor 검사 거부 |
| stale/future/cross-run/이전 PASS | 거부 |
| ambient libpq/Flyway override | 접속 전 거부 |
| 성공 문자열·symlink·넓은 접근권한 | 거부 |
| migration/한 종류 Polygon 실패 | 이후 stage 차단 |
| 전체 모의 PASS·write 요청 | 실제 쓰기 항상 거부 |
| connector/identity 조회 실패 | 상세 감춤·connection 반환 없음 |

원본에 실패 주입·trial mutation을 하지 않았습니다. tests의 credential은 합성값입니다.

## 10. 실제 변경 미실행

기존 개발 DB INSERT/UPDATE/DELETE/TRUNCATE/DDL/GRANT/REVOKE/SET ROLE, Flyway/migration/ETL, sequence 변경, backup restore, container/volume 변경은 없었습니다. Spring/dbTest도 미실행입니다. 원본 full audit가 시작·종료에 C2A 기준과 같고 보호 container ID·StartedAt·RestartCount·volume도 동일했습니다.

새 권한 clone에서만 restore·V2/V3·합성 publication을 수행했습니다. source 데이터와 분리된 제한된 검사입니다.

## 11. Go/No-Go

**NOT_READY / STOP**

권한 catalog/격리 권한·원본 READ ONLY same-connection guard·순수 gate 실패 계약은 확인했지만, 영속 백업 위치가 승인되지 않았고 실제 source mutation wrapper는 구현/승인되지 않았습니다.

## 12. 남은 blocker·별도 승인

1. 영속 위치·보관 정책 및 backup 복사 승인
2. 적용 직전 source identity/user/writer/role-ACL/history/full digest/sequence 재확인
3. 새 exported snapshot-bound backup와 새 restore
4. 원본 JDBC/Flyway client 경로 검증
5. 실제 load connection identity 검증과 stage execution/validator binding의 별도 검토
6. 전체 입력/실행 artifact manifest·수동 재개 정책 확정
7. 실제 V2/V3/Polygon 적용의 명시적 별도 승인

이전 PASS나 이번 현재 상태로 직전 재검사를 생략하지 않습니다. 실제 mutation 실행 정책은 비활성입니다.

## 13. 변경 파일·tests

신규3개: docs/development-db-8c2b-safety-gates.md, etl/tests/safety_gate.py, etl/tests/test_safety_gate.py. 기존 production/SQL/runbook을 수정하지 않았습니다.

새 guard19개 PASS. DB/raw opt-in 없는 전체 ETL suite는81개: **66 PASS/0 FAIL/15 SKIP**입니다. 기존 DB8/실제ZIP2/storesDB4/전체CSV1은 미실행이며 skip을 PASS로 집계하지 않았습니다. 격리 권한/live-source readonly 검증은 별도 실제 증거입니다.

Raw role/ACL·audit·clone·인증·로그는 project 밖 private evidence에만 보관합니다. Backup path·credential·점포 row는 Git/index에 넣지 않았습니다. 초기 host psycopg import 문제는 SQL 접속 전 실패했고 기존 순수 함수 AST 재사용으로 해결했습니다. clone의 비기본 ACL은 가정하지 않고 실제 대조로 검증했습니다.

## 14. 최종 Git·도구

main/기준 HEAD를 유지하며 staged 파일은 없습니다. 신규3개 untracked를 별도 확인하고 git diff --check/status/stat을 수행했습니다. stage/commit/push·branch/worktree·reset/restore/clean/stash는 미실행입니다.

Superpowers 계획/TDD/검증/리뷰, Context7/공식 자료, context-mode 문서·로그 요약, GitHub HEAD 확인과 읽기 전용 subagent를 사용했습니다. 비밀값을 문서 검색/index 입력으로 보내지 않았습니다. Build Web Apps는 사용하지 않았습니다.

독립 최종 읽기 전용 리뷰에서 Critical/Important 지적은 없었습니다. 공통 open_checked 자체는 PGDATA/내부 port를 조회하지 않으며, 이번 원본 검증에서는 반환된 동일 connection에 추가 SELECT로 이 두 항목을 확인했습니다. 실사용 wrapper 통합 시 공통 검사에 포함하는 보완은 후속 경계로 남깁니다. 이 미통합 상태를 실제 실행 코드 승인으로 처리하지 않습니다.
