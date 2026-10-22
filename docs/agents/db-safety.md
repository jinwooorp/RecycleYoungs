# DB 안전 정책

> **에이전트용 문서:** 작업 기준·구현 계약·검증 기록을 관리합니다. 사람이 읽을 문서는 [문서 안내](../README.md)에서 확인하며, 이 문서는 일반 독자의 필수 읽기 대상이 아닙니다.

DB에 접속하거나 데이터를 바꾸기 전에 확인할 조건을 정리합니다. 정상 개발 실행은 [README](../../README.md#실행-방법), 구현 구조는 [기술 명세](technical.md)를 참고합니다.

문서 정리 기준일은 **2026-10-22**입니다. 기존 보호·승인 조건을 유지하며 후속 사용자 승인으로 새 영속 API 환경의 실제 준비·갱신·재시작·백업/독립 복원을 검증했습니다. 기존 팀·퇴역 DB는 이번 대상이 아닙니다. 아래의 실행 기록을 다른 대상의 현재 상태나 향후 실행 승인으로 사용하지 않습니다.

## 목차

- [적용 범위와 보호 대상](#적용-범위와-보호-대상)
- [별도 영속 API 개발 환경](#별도-영속-api-개발-환경)
- [접속·변경·정리의 승인 범위](#접속변경정리의-승인-범위)
- [연결 identity·writer·권한](#연결-identitywriter권한)
- [V1 보존과 허용 변경](#v1-보존과-허용-변경)
- [백업·독립 restore와 복구 가능성](#백업독립-restore와-복구-가능성)
- [STOP·복구·Go/No-Go](#stop복구gono-go)
- [실행·검증 계층과 결과 상태](#실행검증-계층과-결과-상태)
- [기존 DB 감사 수집기와 provenance 요구](#기존-db-감사-수집기와-provenance-요구)
- [기존 DB 변경 실행기와 검증 gate](#기존-db-변경-실행기와-검증-gate)
- [FINAL 검증의 분리](#final-검증의-분리)
- [과거 검증과 Git 근거](#과거-검증과-git-근거)

## 적용 범위와 보호 대상

| 읽는 목적 | 적용할 범위 |
| --- | --- |
| 현행 팀 환경 준비·조회·보존 | 아래의 팀 개발 환경과 [접속·변경 승인](#접속변경정리의-승인-범위), 구현 동작은 [기술 문서](technical.md#팀-공통-실자료-개발-환경) |
| 별도 영속 API 환경 | [API 대상](#별도-영속-api-개발-환경)과 공통 승인·identity 정책, 구현은 [영속 실행 계약](technical.md#영속-api-개발-환경과-예약-갱신) |
| 기존 DB 변경·복구 | 공통 identity·권한·백업·STOP 정책 |
| 과거 V1에서 V2/V3·경계 적용 검토 | [V1 보존 계약](#v1-보존과-허용-변경), 현행 팀 환경의 초기 준비와 구분 |
| 미구현 DB 감사·변경 도구 설계 | [감사 수집기](#기존-db-감사-수집기와-provenance-요구)와 [변경 실행 gate](#기존-db-변경-실행기와-검증-gate) |

이 문서의 `source_*`는 기존 DB의 감사·보존 검증 계약입니다. 공공 API 수집기와 정기 갱신 경로를 뜻하지 않습니다. API 기반 버전·공개·보존 코드는 실제 운영·복구 검증을 마쳐야 하며 새 경로도 이 문서의 접속·변경 승인 조건을 따릅니다.

API release/refresh/job의 수집 준비 CLI는 DB에 연결하지 않습니다. 격리 전용 `api_isolation`·`api_integration` 검증 이후, 후속 사용자 승인으로 별도 영속 `api_dev`·`api_worker`·Backend `api-dev` profile을 연결했습니다. 이 새 경로는 실제 DB 접속·적재·공개를 수행합니다. 선택적 V4는 `backend/src/main/resources/db/api-migration/`, runtime SQL은 별도 `db/api-runtime/`이며 기존 기본 Flyway·팀 reader는 유지합니다. 격리 성공·READY·callback이 다른 대상의 승인이나 고정 패키지 guard 우회를 뜻하지 않습니다.

### 새 기본 API 개발 환경

2026-10-22 사용자 승인 범위는 새 `recycleyoungs-dev`의 초기 준비·실제 API 수집/적재·재실행/재시작/실패 검증과 지정한 임시 검증 컨테이너7개·전용 네트워크 정리입니다. 기존 팀·별도 API 환경과 그 볼륨/백업/Releases 변경·삭제는 포함하지 않습니다. 지정한 tmpfs 검증 컨테이너7개·전용 네트워크6개는 사전검증 후 제거했고, 기존 원본/백업·모든 영속 볼륨과 보호 컨테이너 metadata는 보존했습니다. 완료 기록은 향후 실행 승인으로 사용하지 않습니다.

`docker-compose.yml`이 project 전용 `-db`, `-control`, `-data`, `-reader`, `-writer` named volume과 data/inspect/access network를 만듭니다. DB는 내부 `api-postgres:5432/recycleyoungs_api_dev`, PGDATA `/var/lib/postgresql/data/api`이며 호스트 port는 없습니다. Backend·scheduler는 역할별 제어 볼륨만 받습니다. 이름이 같은 기존 자원을 채택하지 않고 label·생성 정보·schema SHA·full IDs·실제 SID/owner/역할을 검증합니다. READY 재실행은 조회만 하며 초기화 중단이나 schema/키 불일치는 자동 복구하지 않습니다. 상세는 [기술 명세](technical.md#개발-환경과-안전한-시작)를 따릅니다.

`make dev-status`도 DB 조회이며, `dev-refresh`·`dev-reconcile`은 실제 쓰기입니다. 기본 Compose 재시작/재생성·볼륨 삭제·스키마/키 전환·전체 환경 복구는 실제 대상과 승인 범위를 먼저 확인합니다. 이 환경의 자동 준비가 기존 보호 DB나 다른 project의 변경 권한을 주지 않습니다.

### 현행 팀 개발 환경

Compose가 관리하는 대상은 다음과 같습니다. 이름은 코드상 식별자이며 실제 자원의 존재·소유권은 작업 전에 확인합니다.

| 대상 | 식별자 |
| --- | --- |
| Compose 프로젝트 | `recycleyoungs-team-dev` |
| DB | `recycleyoungs_team_dev`, 호스트 `127.0.0.1:55432` |
| DB 볼륨 | `recycleyoungs-team-dev-db` |
| 제어 기록 볼륨 | `recycleyoungs-team-dev-control` |
| 데이터 cache 볼륨 | `recycleyoungs-team-dev-cache` |

기존 DB·control·cache는 하나의 환경으로 보존합니다. 데이터 버전·계약·소유권이 다르면 기존 환경을 새 버전으로 자동 채택하거나 재적재하지 않습니다.

과거 팀 DB의 v1 기록과 신규 기본 `real-data-v2`는 다른 데이터 계약입니다. 신규 기본값은 기존 DB의 업그레이드 승인이 아닙니다. 보존 여부를 판단하려고 개인 설정을 덮어쓰지 않습니다.

### 별도 영속 API 개발 환경

2026-10-21 승인된 새 개발 대상입니다. 이 환경은 기존 별도 API 경로이며 아래 새 기본 환경·팀 DB와 별개입니다. 이름만 같다고 승인된 자원으로 간주하지 않고 기록한 daemon·full container/network ID·image·owner label·볼륨 생성 정보·mount·port·실제 SID를 대조합니다.

| 대상 | 식별자·제한 |
| --- | --- |
| Compose | `docker-compose.api.yml` / project `recycleyoungs-api-dev` |
| DB·볼륨 | `recycleyoungs_api_dev` / `recycleyoungs-api-dev-db` |
| DB 접속 | Docker 내부 `api-postgres:5432`, PGDATA `/var/lib/postgresql/data/api`, host DB port 없음 |
| HTTP | loopback `127.0.0.1:18090` |
| 역할 | 최초 준비/백업 `ry_api_owner`, API 갱신 `api_writer`, SELECT/READ ONLY `api_reader` |
| 원본·제어·백업 | 프로젝트 밖 사용자 private home, 디렉터리 0700·파일 0600. 실제 값·원본은 문서 조사로 열람/인덱싱하지 않음 |

`make api-init`은 신규 생성·migration·DDL/DML/GRANT, `api-up`은 Backend build와 서비스 시작, `api-refresh`는 실제 수집/적재/공개, `api-reconcile`은 검증 후 작업 상태 변경, `api-backup`은 DB backup과 새 독립 restore 자원 생성, `api-restart-check`는 API DB restart를 수행합니다. `api-status`도 실제 readonly DB 접속이므로 문서 검증 명령으로 쓰지 않습니다. 일반 Compose 명령으로 identity guard를 우회하거나 실패한 init을 자동 반복하지 않습니다.

2026-10-22 추가한 `make api-images`는 공개 소스 allowlist로 빌드·공식 이미지 pull만 수행하고 DB·API 키를 읽지 않습니다. 새 초기 준비는 검증한 image manifest를 요구하고 그 hash를 target에 결속합니다. 새 home은 image override로 host 코드/jar mount를 제거하며 DB 비밀번호도 read-only 파일로 전달합니다. DB mount 검사는 기존 owned volume1개와 정확한 owner-password bind1개만 허용합니다. manifest 없는 기존 home은 원래1volume·기존 image 계약을 유지하며 임의 전환하지 않습니다. 소스 이미지 성공·Compose config·DB 서버 없는 명령 smoke는 실제 신규 DB init/migration 승인·검증을 대신하지 않습니다.

주간 worker의 실행은 승인된 새 대상에 한정합니다. FAILED·불확실한 RUNNING은 자동 재시도하지 않으며 실제 공개 버전과 registry를 확인한 명시적 reconciliation 이후 향후 예약을 허용합니다. source run registry는 공개 전에 불변 저장하며 수집 원본은 덮어쓰지 않습니다. 점포월 후퇴·기간 누락·공개 CAS 충돌을 거부합니다.

snapshot-bound DB 백업·독립 복원에서 전체 값/EWKB/ID/이력/catalog/ACL/역할/sequence를 비교했습니다. dump는 원본 run·경계 파일·제어 기록·secret을 포함하지 않으므로 전체 worker 복구와 구분합니다. 새 백업/실패 증거/검증 restore 자원은 보존하며 삭제·정리 승인을 추정하지 않습니다. 이 기록은 기존 팀/퇴역 DB의 백업·복원이나 변경 승인이 아닙니다.

### 퇴역한 개발 DB와 백업

`startup-analysis-postgres` / `startup_analysis` / `recycleyoungs_postgres_data`는 과거 보호 대상입니다.

기존 기록에 따르면 2026-10-14 별도 승인으로 읽기 전용 감사, 백업, 독립 복원, 팀 DB 전수 대조를 수행한 뒤 해당 컨테이너·볼륨·전용 빈 네트워크를 제거했습니다.

이 기록은 같은 이름의 자원을 재생성·연결·삭제해도 된다는 뜻이 아닙니다. 다시 나타나면 소유권을 확인하고 별도 대상으로 검토합니다.

원본 백업·역할·권한 자료는 비공개 보존 대상입니다. 문서 정리를 위해 열람·인덱싱·이동·삭제하지 않습니다. private 경로나 접속값은 공개 문서에 적지 않습니다.

## 접속·변경·정리의 승인 범위

세션에서 승인한 대상과 작업만 수행합니다. 문서·일반 테스트에는 DB 접속이 필요하지 않습니다.

| 작업 | 실행 전 확인 |
| --- | --- |
| 최초 팀 환경 준비 | 이름·포트 충돌, 사용할 daemon과 생성 범위 |
| 기존 팀 상태 조회 | 자원 소유권·실제 연결 대상, 읽기 전용 범위 |
| 기존 DB migration·ETL | 변경 범위 승인, 보존 기준, 최신 백업·독립 복원 |
| 중지·재생성·복원·삭제 | 자원별 소유권과 명시적 승인 범위 |

`docker compose up -d`는 새 기본 API 환경입니다. `make db`, `make etl`은 `docker-compose.legacy.yml`의 기존 팀 준비 경로입니다. 새 환경을 만들거나 기존 컨테이너를 시작·재생성할 수 있으므로 실제 영향을 먼저 읽습니다.

`make db-info`, `make check-db`는 현재 읽기 전용 팀 status입니다. SQL 조회가 포함되므로 문서 검증용 명령으로 사용하지 않습니다.

`make db-migrate`와 `make db-baseline`은 현재 Makefile에서 거부합니다. 직접 Flyway로 우회하지 않습니다.

다음 작업은 해당 범위의 명시적 승인 없이 실행하지 않습니다.

- 기존 DB에 대한 Flyway migrate/baseline/repair/clean
- Polygon `--load`, 전체 CSV·점포 loader
- DDL/DML, GRANT·ALTER ROLE, sequence 변경
- 기존 컨테이너 stop/restart/recreate, 볼륨 mount/delete
- 기존 DB restore, 백업 복사·이동·삭제·덮어쓰기
- `docker compose down -v`

팀 `bootRun`은 READY 확인 후 읽기 전용 계정을 쓰고 Flyway를 끕니다. 일반 애플리케이션 설정·`dbTest`에는 같은 보장을 적용할 수 없으므로 설정을 먼저 확인합니다.

Git stage·commit·push도 별도 승인 범위를 따릅니다. 작업 규칙은 [AGENTS](../../AGENTS.md)가 기준입니다.

## 연결 identity·writer·권한

여기서 identity는 **실제로 접속한 DB가 승인된 대상인지 확인하는 정보**입니다. writer는 DB 값을 바꿀 수 있는 프로그램·계정·예약 작업입니다.

### 접속 전 대상 확인

- full container ID, 고정 image ID와 실제 image inspect 결과
- PGDATA·볼륨·mount와 소유권
- network ID·alias·DNS·host/내부 port
- 명시한 host·port·database·user와 승인된 secret

환경에 남은 libpq·Flyway 설정으로 다른 DB에 연결하지 않습니다. secret·JDBC URL·환경 전체·원본 행은 로그·Git·인덱스에 노출하지 않습니다.

### 같은 연결에서 재확인

반환해 사용할 **같은 연결**에서 다음을 확인합니다.

- current_database, current_user, session_user
- system identifier(SID), PGDATA, 내부 port
- READ ONLY와 격리 수준
- statement/lock timeout, idle·autocommit 상태

별도 사전 연결의 성공으로 실제 migration·publication 연결 검사를 대신하지 않습니다. 불일치하면 연결을 닫고 중단합니다.

승인된 조회는 READ ONLY 트랜잭션입니다. 권한을 시험하려고 임시 쓰기를 하지 않습니다.

### 쓰기 주체와 권한

DB client, Backend·ETL, prepared transaction, subscription, 예약 작업을 확인합니다. 잠깐 client가 없었다는 사실은 검증 중 쓰기가 없다는 보장이 아닙니다.

실제 변경 계정의 role 속성·membership과 객체 권한을 대조합니다. DB·schema·default ACL, table·column·sequence·function·type의 owner·유효 권한을 포함합니다.

V2 생성, Flyway history 기록, V3 잠금·행 변경, 매핑 sequence, 경계 trigger 권한을 따로 확인합니다. superuser 가정이나 catalog의 true 값만으로 실제 실행 성공을 주장하지 않습니다.

비밀번호·비밀번호 hash는 추출·복제하지 않습니다. 상세 권한 근거는 비공개로 보관합니다.

### 격리 도구의 연결 검사

과거 B-3 Flyway는 public schema와 target 2/3을 분리해 사용했습니다. 설정은 다음과 같습니다.

```text
createSchemas=false
baselineOnMigrate=false
cleanDisabled=true
group=false
outOfOrder=false
connectRetries=0
executeInTransaction=true
mixed=false
```

같은 JDBC 연결에서 DB·사용자·SID·PGDATA·port와 timeout을 검사했습니다. lock timeout은 5초, statement timeout은 10분이었습니다.

격리 Polygon factory도 같은 반환 연결을 검사해 publication에 전달합니다. 단독 CLI에는 이 검사가 없으므로 명시적 DSN만으로 안전 경로가 되지 않습니다.

[control](../../etl/control.py)·[backend](../../etl/control_backend.py)·[worker](../../etl/control_worker.py)의 검사는 격리용입니다. 기존 DB에 재사용하려면 별도 구현·리뷰·실사용자 검증이 필요합니다.

## V1 보존과 허용 변경

아래 허용 변화는 과거 V1 BASELINE에 V2/V3·경계를 적용하는 보존 계약입니다. 현재 팀 DB의 전체 데이터 갱신 허용 범위를 정의하지 않습니다. V1~V3는 스키마 버전이며 `real-data-v1/v2` 패키지와 구분합니다. 정확한 변경 정의는 [migration SQL](../../backend/src/main/resources/db/migration)이 기준입니다.

기존 V1 BASELINE의 NULL checksum과 history 원행을 유지합니다. SQL V1 checksum으로 바꾸거나 repair·rebaseline하지 않습니다. 기존 성공 migration의 checksum도 수정하지 않습니다.

| 단계 | 허용 변화 |
| --- | --- |
| V2 | 공간 테이블 3개와 관련 제약·인덱스·guard 추가 |
| V3 | SEMAS/I21201→CAFE 매핑과 해당 소분류의 빈 industry_id만 보완 |
| 경계 ETL | 별도 경계 테이블에 승인된 원본·조회용 도형과 버전 저장 |

V3는 매핑·stores 잠금과 CAFE 참조 검사를 수행합니다. 실제 대상 수와 변경 수, 잔존 NULL·분류 충돌을 확인합니다.

다른 소분류·이미 CAFE인 행은 바꾸지 않습니다. 예상 매핑 INSERT와 그 sequence 변화, 승인된 industry_id 변경 외에는 기존 데이터를 보존합니다.

보존 비교는 다음을 포함합니다.

- 모든 행·컬럼·ID·원천 ID·FK
- NULL·실제 0·빈 문자열
- POINT의 WKB·SRID
- sequence 값·정의·ownership·dependency
- 전체 Flyway history
- 컬럼 형식·nullability·default·identity·collation
- 제약·인덱스·trigger·schema·extension·function 정의
- owner·ACL·RLS

빈 테이블도 구조·권한 비교 대상입니다. 기존 history의 actor·시간·duration은 원행을 보존하되 새 실행 기대값으로 고정하지 않습니다.

새 V2/V3 history는 실제 계정·SQL·checksum·관찰 시점과 연결합니다. PENDING 오류를 ignoreMigrationPatterns로 숨기지 않습니다.

전체 loader는 TRUNCATE·ID 재시작이나 연도 DELETE를 수행할 수 있습니다. 기존 데이터 보존·backfill 검사에 사용하지 않으며, V2/V3/경계 승인에 빈 테이블 채우기를 포함하지 않습니다.

## 백업·독립 restore와 복구 가능성

기존 DB 변경 직전에는 변경 전 상태에 연결된 새 백업과 독립 복원이 필요합니다. 백업 파일의 존재나 과거 복원 성공만으로 충분하지 않습니다.

1. 검증 기간의 writer를 통제하고 하나의 DB 조회 시점을 확보합니다.
2. 비교 기준과 `pg_dump -Fc --snapshot`에 같은 exported snapshot을 사용합니다.
3. 새 격리 DB에 복원합니다.
4. 전체 값·ID·POINT·NULL·history·구조·권한을 원본과 비교합니다.
5. 실제 계정의 복구·접속 가능성과 전환·중단 계획을 확인합니다.

sequence는 MVCC 밖에서 움직이므로 last_value/is_called·정의·ownership을 따로 확인합니다. no-owner/no-acl 복원은 권한 복구의 증거가 아닙니다.

백업은 승인된 프로젝트 밖 비공개 위치에 둡니다. 디렉터리 0700·파일 0600, 소유자·추가 ACL·SHA·크기를 확인합니다.

symlink·덮어쓰기를 허용하지 않습니다. 내부 SSD의 복사본과 별도 매체의 재해 복구 백업을 구분합니다.

관리자·보존 기간·암호화 키·역할/ACL 자료 보관·복구 리허설 정책도 확인합니다. 백업 원본·복사본은 적용 리뷰와 복구 검증 종료까지 보존합니다.

격리 복원 대상은 다음 조건을 충족해야 합니다.

- 전용 internal network, host port 없음
- 기존 볼륨·mount 없음, data/init tmpfs
- 승인된 고정 이미지와 실제 소유권 확인
- 새 실행 ID와 실제 server identity 대조
- 만든 자원만 정리

이름 prefix만으로 격리를 증명하지 않습니다. 이 일회용 격리 조건은 호스트 포트를 사용하는 팀 개발 환경과 구분합니다.

## STOP·복구·Go/No-Go

다음이면 즉시 중단합니다.

- 연결 대상·입력·해시·실행 조건이 변경됨
- writer·권한·백업·복원 결과가 불일치함
- 새 충돌 또는 FAIL·UNKNOWN·누락된 증거가 있음
- 실행 종료 코드가 0이 아니거나 validator가 거부함
- 순서·중복·다른 실행의 증거·유효기간 오류가 있음
- 상태·로그·snapshot 변조가 감지됨

실제 기존 DB 적용의 중단은 자동·force·resume으로 해제하지 않습니다. 원인을 검토하고 새 실행의 PRECHECK와 필요한 승인을 다시 확보합니다.

프로세스 종료나 timeout은 rollback 증명이 아닙니다. 상태가 불명확하면 UNKNOWN/UNMEASURED로 두고, 승인된 조회로 확인하기 전 진행하지 않습니다.

| 실패 시점 | 처리 |
| --- | --- |
| V2 실패 | rollback·history·V1 보존 확인 후 중단 |
| V2 성공·V3 실패 | 남은 V2를 인정하고 V3 rollback·보존 확인 |
| 경계 적재 실패 | 실패한 종류만 rollback. 다른 종류 자동 삭제 금지 |
| 보존 실패 | reader 공개·후속 쓰기 중지, 증거 확보 |
| 복구 필요 | 새 분리 DB에 복원·검증 후 전환 범위 승인 |

복구를 위해 원본 초기화·DROP·볼륨 삭제·백업 덮어쓰기를 하지 않습니다. 사후에 identity 오류를 발견해도 이미 commit된 변경이 취소됐다고 주장하지 않습니다.

기존 DB용 crash 감지·영속 STOP·재시작 처리 기능은 미구현입니다. 합성 모델의 중단 상태나 격리 도구의 atomic state가 이를 대신하지 않습니다.

Go 검토에는 최신 증거·실제 연결·복구 계획·독립 리뷰·예상 변경 범위가 필요합니다. 마지막으로 대상과 변경 범위의 명시적 승인이 필요하며 READY만으로 실행하지 않습니다.

이 제한은 기존 DB 적용 경로에 대한 것입니다. 이미 구현된 팀 Compose의 보존·재검증 동작은 [기술 문서](technical.md#팀-공통-실자료-개발-환경)에서 따로 설명합니다.

## 실행·검증 계층과 결과 상태

| 모듈 | 하는 일 | 성공의 한계 |
| --- | --- | --- |
| control 계열 | 격리 환경의 단계 실행·검사 | 기존 DB 실행 모드 없음 |
| source_validation | 제공받은 전후 자료 비교 | 자료의 실제 출처·실행·복구 증명 아님 |
| source_control | 가짜 자료로 단계 전환 검사 | 실제 실행 거부, SIMULATED_ONLY |
| source_audit | 출처 기록의 형식·연결 검사 | CONTRACT_VALID_UNVERIFIED |
| 기존 DB 감사 수집기·변경 실행기 | 미구현 | 설정·flag로 활성화할 경로 없음 |

비교 결과는 PASS, UNEXPECTED_CHANGE, INSUFFICIENT_EVIDENCE, INDETERMINATE입니다. UNKNOWN·증거 누락·불명확한 sequence 변화는 PASS가 아닙니다.

source_control의 기본 검사는 `NOT_READY`, DB 상태는 `UNMEASURED`입니다. 모의 완료도 실제 실행을 허용하지 않습니다.

`source_validation`은 V1/V2/V3 단계만 지원합니다. 경계 적재 전후의 허용 변화·보존 비교는 후속 계약이 필요합니다.

`source_audit`의 db_observed와 execution_authorized는 false입니다. CONFIRMED 같은 입력 claim도 실제 관찰·승인을 뜻하지 않습니다.

과거 integration snapshot은 모든 catalog·ACL·sequence 정의·history 필드를 수집하지 않습니다. 신규 기존 DB 감사 자료로 그대로 사용하지 않습니다.

<a id="실제-source-collector와-provenance-요구"></a>

## 기존 DB 감사 수집기와 provenance 요구

이 절은 **미구현인 기존 DB 감사 자료 수집기의 요구사항**입니다. 공공 API 응답 수집·원본 파일 다운로드·팀 환경 초기화 도구와 구분합니다.

먼저 가짜 연결로 질문·응답 조립·실패·timeout 처리를 검사합니다. 그 다음에만 별도 승인된 DB에서 실제 수집을 검토합니다.

실제 수집은 같은 연결·READ ONLY REPEATABLE READ 트랜잭션·같은 조회 시점에서 수행해야 합니다. 재연결·재수집, 일부 항목 누락, 중간 실패는 거부합니다.

### 필요한 관찰 자료

- 전체 행의 값·ID·NULL·POINT WKB/SRID
- 컬럼·구조·전체 catalog·ACL·역할·membership
- sequence 상태·정의와 전체 Flyway history
- V3 대상 industries/mappings/stores의 전체 비교값
- 실행 계정·writer·수집 시간 범위
- 입력·코드·SQL·처리 기준·백업의 해시

확인된 빈 배열이나 SQL NULL ACL은 항목 누락·UNKNOWN과 다릅니다. 일부 샘플·행 수·ST_Equals만으로 전체 보존을 판정하지 않습니다.

### 전체 행 해시

정해진 PostgreSQL text 표현을 UTF-8 bytes로 변환합니다. ID순으로 정렬하고 각 행 길이를 8byte unsigned big-endian으로 붙인 뒤 SHA-256을 계산합니다.

물리 값, industry_id를 제외한 원천 값, 논리 분류의 해시를 분리합니다. 승인된 V3 변화만 허용하며 ID·POINT·NULL·sequence·구조·history도 따로 전수 검사합니다.

정확한 직렬화 기준은 [source_audit](../../etl/source_audit.py)의 고정 계약을 따릅니다.

### 출처 기록과 실행 연결

관찰 자료에는 실행·수집·단계, 1부터 시작하는 순서, 입력 파일과 이전 해시를 연결합니다. 연결·트랜잭션·조회 시점의 관찰 시간도 포함합니다.

현재 형식은 최대 1800초와 시작 시점의 신선도, reconnect/recollect=false 등을 검사하지만 입력자의 주장일 뿐입니다. 이전 해시의 실제 존재·성공은 미래 수집기·실행기가 증명해야 합니다.

NULL snapshot ID에 descriptor·local transaction ID를 기록해도 실제 PostgreSQL XID가 할당됐다는 뜻은 아닙니다.

전체 근거에는 collector·validator·adapter 의존 코드와 V2 참조 기준도 포함합니다. 공개 로그에는 고정 오류 category/field만 남기며 행·SQL·접속값·private 경로를 노출하지 않습니다.

<a id="향후-source-실행과-검증-gate"></a>

## 기존 DB 변경 실행기와 검증 gate

아래는 **미구현인 기존 DB 변경 실행기의 검토 기준**입니다. 과거 V1 보존 계약의 V2/V3·경계 적용 순서이며 공공 API 갱신 배치의 단계 정의가 아닙니다. 퇴역 DB의 복원 계획이나 실행 안내로 사용하지 않습니다.

| 단계 | 통과 조건 |
| --- | --- |
| 1 PRECHECK | 대상·writer·권한·history·구조·기준 데이터·입력 일치 |
| 2 BACKUP_RESTORE_VERIFIED | 새 백업·독립 복원·권한과 복구 가능성 확인 |
| 3 V2_APPLIED | 실제 JDBC 연결·종료 코드·이력·checksum 확인 |
| 4 V2_VERIFIED | V1 전체 보존, 새 공간 구조의 초기 상태 확인 |
| 5 V3_APPLIED | 잠금·매핑 충돌 검사, 허용된 빈 값만 보완 |
| 6 V3_VERIFIED | 실제 대상·변경 수·분류와 예상 sequence 변화 확인 |
| 7 ADMIN_POLYGON_APPLIED | 승인 입력·검사된 실제 연결로 행정동 공개 |
| 8 ADMIN_POLYGON_VERIFIED | 경계·버전·current와 V1 보존 확인 |
| 9 COMMERCIAL_POLYGON_APPLIED | 승인한 6개 보정만 포함해 상권 공개 |
| 10 COMMERCIAL_POLYGON_VERIFIED | 원본 속성·해시·버전·품질과 V1 보존 확인 |
| 11 FINAL_VERIFIED | 읽기 전용 전체 감사, ID·적재일·해시·current 보존 |

425 행정동과 1,644 유효·6 보정 상권은 고정 입력 기준의 기대값입니다. 현재 기존 DB 실측값으로 사용하지 않습니다. B/UNRESOLVED·H5 충돌도 그대로 보존해야 합니다.

새 V2 참조 구조와 실제 migration 계정은 독립 검토가 필요합니다. 일반 Makefile·직접 ETL로 단계를 생략하거나 격리 guard를 완화하지 않습니다.

격리 runner는 단계 전후에 코드·SQL·이미지·입력·백업·비교 기준·private config 해시를 함께 확인합니다. 실제 종료 코드·validator·연결·fingerprint를 수집하며 외부 PASS나 SIMULATED_ONLY를 받지 않습니다.

격리 증거는 프로젝트 밖 승인된 빈 private 위치에 생성합니다. 소유자·0700 권한·symlink 없음과 배타적 생성을 확인합니다.

새 nonce·순서·최대 30분 TTL, hash/HMAC chain, 로그·validator·snapshot SHA, atomic state·메모리 anchor를 검사합니다.

HMAC는 변조 탐지 수단입니다. 사람 승인이나 코드·설정·secret을 통제하는 주체에 대한 독립 보안 경계는 아닙니다. 모의 모델은 이런 실측 파일을 생성하지 않습니다.

## FINAL 검증의 분리

현재 [격리 runner의 final](../../etl/control_worker.py)은 경계 publication을 다시 호출해 재실행 동등성을 검사합니다. 승인된 격리 대상의 **쓰기 재시도 검사**입니다.

향후 기존 DB의 FINAL은 **읽기 전용 전수 감사**여야 합니다. load·retry publication·DDL/DML·ANALYZE를 실행하지 않습니다.

격리 final을 그대로 재사용하지 않습니다. source_control/source_audit의 FINAL label도 실제 구현·완료 증거가 아닙니다.

## 과거 검증과 Git 근거

과거 결과는 해당 입력·대상·승인 범위로 한정합니다. 현재 상태나 다음 실행 승인으로 확대하지 않습니다.

| 기록 | 핵심 범위 | 근거 |
| --- | --- | --- |
| 8-C1 | 새 격리 적재·백업·복원·전체 값 비교 | [b611358](https://github.com/jinwooorp/RecycleYoungs/blob/b6113585ea4c2ba10d1edf3d57ec999403e9b5dd/docs/integration-validation-8c1.md) |
| 8-C2A | 읽기 전용 감사·snapshot 연계 dump·복원 | [deaed745](https://github.com/jinwooorp/RecycleYoungs/blob/deaed745b31fdcb16355ecc241f46b3dc2b46045/docs/development-db-8c2a-preflight.md) |
| 8-C2B-1 | 백업 기반 V2→V3→경계 리허설 | [38e8732](https://github.com/jinwooorp/RecycleYoungs/blob/38e87328e843e78419e4a1c0dd5584fbf3a326b7/docs/development-db-8c2b-rehearsal.md) |
| 8-C2B-2 | 역할·ACL 재현과 같은 연결 검사 | [bde7050](https://github.com/jinwooorp/RecycleYoungs/blob/bde7050ee99e65c45fd276e20394bd41c720cb46/docs/development-db-8c2b-safety-gates.md) |
| 8-C2B-3 | 격리 runner·실측 증거·중단 처리 | [c36f44f](https://github.com/jinwooorp/RecycleYoungs/blob/c36f44fb204fa77ffd77cb4595a63be57f6967bb/docs/development-db-8c2b-execution-guard.md) |

8-C2A의 최초 no-owner/no-acl 복원은 권한 복구까지 증명하지 않았습니다. B-3의 영속 복사본은 과거 snapshot이며 최신 백업·별도 매체의 재해 복구를 보장하지 않습니다.

2026-10-14 퇴역 기록에서는 원본·복원본의 전체 행, NULL, 구조, sequence, history, 역할·ACL을 대조했습니다. 역할 비밀번호는 추출하지 않았고 임시 인증을 사용했으므로 실제 복구 인증은 별도 준비해야 합니다.

과거 기존 DB는 V1 BASELINE 상태였으며 stores·상권 목록·상권 매출이 비어 있었습니다. 전체 CSV가 적재돼 있었다고 설명하지 않습니다.

후속 팀 환경·독립 Ubuntu E2E는 [기술 문서 이력](technical.md#검증-이력)에 있습니다. 그 성공을 기존 DB 변경 경로의 구현 완료로 보지 않습니다.

개편 전 상세 감사 수치·보존 기록은 [기존 DB 정책](https://github.com/jinwooorp/RecycleYoungs/blob/e1668ca1100616b3f19d984fc6942ebc28b827b8/docs/db-safety.md)에 보존합니다. 원문은 `git show <SHA>:<문서 경로>`로 읽고 작업 트리를 reset·restore하지 않습니다.
