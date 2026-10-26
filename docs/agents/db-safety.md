# DB 안전 정책

> **에이전트용 문서:** 작업 기준·구현 계약·검증 기록을 관리합니다. 사람이 읽을 문서는 [문서 안내](../README.md)에서 확인하며, 이 문서는 일반 독자의 필수 읽기 대상이 아닙니다.

DB에 접속하거나 데이터를 바꾸기 전에 확인할 조건을 정리합니다. 정상 개발 실행은 [README](../../README.md#실행-방법), 구현 구조는 [기술 명세](technical.md)를 참고합니다.

문서 정리 기준일은 **2026-10-26**입니다. 아래의 10/21~22 영속 API 환경 준비·갱신·재시작·백업/독립 복원은 당시 승인 범위의 기록입니다. 후속 레거시 정리와 과거 보호·검증 이력을 구분하며, 과거 실행 기록을 다른 대상의 현재 상태나 향후 실행 승인으로 사용하지 않습니다.

**최신 승인/완료 상태 — 2026-10-26 전체 초기화·새 복원·Compose 재가동 PASS:** 사용자 승인으로 현재 데이터의 최신 full package65f6cb44…/새 격리 전체 복원/16API를 검증한 뒤 Docker Desktop container/image/volume/cache0을 실제 확인했습니다. 새 Compose DB(SID7700833237598617614/container b3fa6dd7c144c3c38b36e8ccce4a742144c402ee89ef02098a957865c735448a)의25테이블·3역할·모든 등록원본을 복원/전수검증했습니다. 기동 전 helper 라벨 오분류로 STOP한 뒤 수정/RO검증/리뷰와 사용자의 **새 재개 절차 명시 승인**을 받아 기존STOP을 보존한 별도 authorization/PRECHECK/supersession으로만 재개했습니다. helper를 별도 namespace로 교체하고 DB중지상태에서pending을해제한 뒤 `docker compose up -d`를 실행했습니다. 현재5서비스가 정상이며25테이블 snapshot·9개Compose모델의ID/image/config·22분기·16API38요청·공개값·다음11/2 11시가 PASS입니다. 임시helper/initdb/초기화종료컨테이너·불필요image/cache와control source-* 사본을 정리했고 활성control파일 해시는 유지했습니다. 현재4이미지/5볼륨/5running컨테이너/cache0이며비공개최신백업/최소기록 한세트약15.31GB를보존합니다. 아래의이전57b2…/11.84GB/정지/승인대기기록은당시이력이며현재상태가아닙니다. 실패기록은해당실행의불변증거로남겨두고새승인없는재시도에사용하지않습니다.

**현재 보존 정책 — 2026-10-26 사용자 정리 요청 완료:** 완료된 검증용 백업/중복 readback·사용 종료 환경의 백업·임시 볼륨의 두 cold 사본·퇴역 이미지 archive225.50GB를 삭제했습니다. 비공개 루트는237.34GB에서11.84GB로 감소했습니다. 마지막 복원 검증된10/25 전체 백업 한 세트(manifest57b2d0b0…)의 실제 무결성과 기존 독립 복원 PASS, 최신 worker/예약 복구 기록을 유지합니다. 아래의 이전 private 사본 보존 기록은 당시 이력이며 현재 파일 존재나 실행 가능성을 보장하지 않습니다. 현행 DB/볼륨과 유일한 현재 원본/인증은 삭제하지 않았고 DB 접속·서비스 변경·새 백업/복원은 하지 않았습니다. 현재 보존/정리 원칙은 [AGENTS](../../AGENTS.md)의2026-10-26 상시 지시를 따릅니다.

**현재 예약 정책 — 10/25 시각 변경·10/26 실제 예약/정리 검증 완료:** 사용자 요청으로 실제 갱신은매주 월11:00KST, 첫 확인/조건부정리는10/26 12:00KST입니다. 새scheduler와명시적 schedule supersession을 검증했고 업무 행/catalog/sequence·공개값·binding은 유지하며next_due/updated_at만 변경했습니다. 기존 V6 복원 증거를 보존하고 새worker archive·변경journal/새보호목록을 추가했습니다. 아래04:30/05:30·이전source/ID 기록은 당시 이력이며 현재 실행 입력이 아닙니다. 최신계획/안전범위는 이 문서의 월요일11시 변경 절과 project.md를 따릅니다.

**2026-10-25 현행 적용 이전의 V6·복구 작업 승인 경계:** 승인된 [전체 환경 복구·정보 확대 계획](project.md#전체-환경-복구검증된-정보-확대판단-지표-통합-계획)은 코드·공식 원천 검증·새 격리 자원의 생성/복원/전환/읽기 서비스 검증 범위입니다. 현행 `recycleyoungs-dev`는 V5·기존 고정 이미지·예약 상태를 보존합니다. V6를 일반 Compose·기존 V4→V5 도구로 적용하거나 기존 binding/READY의 해시만 고치는 것은 허용하지 않습니다. G의 최신 백업·독립 복원·대상/이미지/SQL/입력·복구 범위를 검토한 별도 명시 승인이 필요합니다.

`dev_reference_transition.py`·`dev_reference_operator.py`는 V5→V6의 별도30분 계획·원본 전체 대조 해시·기존 Flyway 모든 열·현재 공개값을 고정합니다. 단계 전후 같은 연결의 SID/GUC/역할·READ ONLY와 Docker/container/image/volume/network를 확인하며 기존 행·catalog·ACL·sequence를 보존합니다. 두 control의 pending과 공용 data의 pending으로 새 일반 writer를 막고, 마지막 shared pending 제거 전까지 차단을 유지합니다. 구 worker에는 shared guard가 없으므로 실제 전환에서는 구 scheduler/쓰기 주체의 중지·부재를 별도로 확인해야 합니다. 실패한 migration INTENT·부분 전환은 자동 재실행·TTL 연장·marker 삭제로 복구하지 않습니다.

**2026-10-25 후속 명시 승인:** 사용자가 [현행 V6 적용·Docker 정리 계획](project.md#전체-환경-복구검증된-정보-확대판단-지표-통합-계획)을 승인했습니다. 정확한 현행 대상의 최신 전체 백업·독립 복원, 구 writer 중지, V6/권한/3원천 공개·binding 전환과 Backend/scheduler 교체, 실제 공동 갱신·같은 DB 정상 재시작·V6 전체 백업/독립 복원 및 새 scheduler의 실제 예약 실행을 확인한 뒤 프로젝트 미사용 Docker 자원을 선별 삭제하는 범위입니다. 전체 백업 도구의5running 계약을 우회하지 않으며 백업·복원 동안 구 scheduler를 정확한 ID로 일시 동결하고 migration 직전 정상 종료합니다. 컨테이너 교체에 필수인 구 Backend/scheduler 제거는 복구 검증 후 허용하되 나머지 검증 자원은 전체 성공 전 삭제하지 않습니다. 현행 DB/5볼륨·필수 이미지/네트워크·private 백업/원본/실패 증거와 다른 프로젝트는 보호합니다. Git stage/commit/push·저장소 scratch 삭제·전역 prune·실패 자동 재시도는 포함하지 않습니다. 이 승인을 실행 완료 증거로 사용하지 않습니다.

후속 실행에서 적용 직전 V5 전체 백업·독립 복원과 백업/live/prepare baseline 전수 일치, 구 scheduler와 원본 인증을 보유한 완료 source helper5개의 정상 중지를 확인했습니다. 현행 V6·13,454건·좁은 권한·binding 전환과 새 Backend/scheduler 교체, 실제 공식 공동 갱신1회, 같은 DB의25개 테이블·3역할·참고6snapshot 재시작 보존과16개 API가 PASS입니다. 원래 DB/SID·5볼륨·3네트워크를 유지합니다. 생성 전 fsync activation gate와 pause/restart=no로 차단한 상태에서 V6 전체 백업·독립 복원(25tables/3roles/4registry)·복원16API와 실제 현행 PC/모바일/키보드를 통과했고, 현행 전체 snapshot을 보존본과 다시 대조한 후에만 activation 해제·operator 정상 종료·scheduler 재개와 PID1 시작을 확인했습니다. 다음 예약은10/26 04:30KST로 유지하며 첫 READ ONLY 자연 검증은WAITING_FOR_DUE입니다. 실제 예약과 후보59컨테이너/30볼륨/20네트워크/22이미지 삭제는 아직 PASS로 기록하지 않습니다. 복원 HTTP는 고정22 대신 같은 READ ONLY 연결에서 확인한 복원 target/release의 실제 분기 수와 비교합니다. 삭제할 네트워크는 중지/created를 포함한 모든 컨테이너 참조를 검사하며, 직접 프로젝트 귀속을 증명할 수 없는 공용 builder cache는 보존합니다.

`dev_recovery.py`·`dev_recovery_docker.py`는 원본을 덮어쓰지 않는 새 private package와 새 SID/container/volumes/internal networks를 사용합니다. 전체 DB·원본/registry·실제 역할 인증·제어·이미지·Frontend 소스를 대조한 뒤 복원 DB를 정상 중지하고 control pending을 제거하며, 완료 기록을 fsync한 후에만 DB를 재개합니다. 부분 unblock/실패는 STOP을 먼저 영속 기록하고 자동 재시작하지 않습니다. 이미지 메타데이터가 없는 실행 Frontend는 rootfs 전체 항목·바이트의 이중 대조가 필요합니다. 로컬 실패 기록은 민감값을 포함하지 않으며 보존 계획은 제안만 생성하고 삭제하지 않습니다. 같은 PC의 검증은 별도 장비·외부 알림·다른 저장 매체 재해 복구 증명이 아닙니다. 실패한 격리 자원과 모든 증거도 삭제 승인을 받기 전 보존합니다.

최신 실측은 현행 V5 전체22개 테이블의 새 백업·독립 복원, 그 새 대상의 V6·실제 공동 갱신과 모의 source 실패 후 명시적 정상 복구,25개 테이블·3역할·참고6snapshot의 정상 재시작 및16개 API입니다. V6 reconcile은 private 수집 경로와3개 current source·전체 등록 snapshot/raw/record를 같은 연결의 READ ONLY REPEATABLE_READ에서 확인한 뒤에만 상태를 회복합니다. 실패 target의 부모 권한을 바꾸거나 guard를 완화해 재실행하지 않았습니다. 원래 dev의5개 서비스·5개 볼륨·3개 네트워크·공개 버전·예약은 마지막 READ ONLY 확인에서도 그대로입니다. 이 결과를 현행 V6 적용 승인이나 V6 상태의 별도 전체 dump/복원 실측으로 확대하지 않습니다.

**현행 V4→V5 준비 승인과 한계:** 후속 사용자 승인으로 현행의 RO 사전 점검, scheduler 일시 중지, 새 snapshot-bound 백업·원본/제어/인증/이미지 보존, 독립 복원과 복제본 전환·실패/재시작 검증을 수행했습니다. 원본의19테이블·345,597행·catalog19종·sequence13개·계정3개의 독립 복원이 PASS이며, 준비 종료 전 RO 전수 비교에서 현행 DB·기존 볼륨과 컨테이너 ID/image/mount 보존도 확인했습니다. 새 전환 코어는 [기술 계약](technical.md#현행-v4v5-전환-코어)을 따릅니다. 이 도구는 과거V1 감사 수집기·범용 기존 DB 변경 실행기의 구현 완료를 뜻하지 않습니다.

준비 단계에서는 복제본에만 V5·22분기/context 후보를 적재·공개했고, 실제 COPY rollback·CAS 충돌·제어 볼륨 부분 전환/marker 제거 중단과 정상 완료·reader/writer 접속·재시작을 확인했습니다. tmpfs DB의 PostgreSQL 프로세스 재시작은 실제dev named-volume 컨테이너 재시작의 증거가 아닙니다. 이 준비 결과나 도구의 계획/receipt/flag로 기존 DB 변경 승인을 대신하지 않습니다.

**2026-10-24 후속 실제 전환 승인:** 사용자가 [통합 실행안 A~E](project.md#현행-개발-환경-적용과-갱신복구-통합-계획)의 정확한 검증 자원13개·볼륨2개·네트워크1개 정리, 현행 V5/권한/22분기·참고 적재·CAS·binding/receipt 전환·Backend/scheduler 교체, 수동 실 API 갱신·동일 DB/지정 서비스 재시작·scheduler 재개와 첫 자연 예약 확인을 명시 승인했습니다. 새 RO 전수 측정으로 백업 이후 DB·기존 자원 불변과 백업 실제 바이트를 재확인하고, 삭제할 테스트 제어 기록도 private 보존한 뒤 지정 검증 자원을 정리했습니다. 실제 현행 V5·계약2·22분기 공개와13개 API·이전 행/ID/geometry·legacy sequence·원본 registry13개·reader/writer 접속 대조는 PASS입니다. 실제 공식 API 수동 갱신·동일 named-volume DB 컨테이너 재시작·전수 보존과 새 scheduler 교체/재개도 PASS이며, 첫 자연 예약은2026-10-26 04:30 KST로 아직 결과 확인 대기입니다. 읽기 전용 후속 일정과 최신 결과는 프로젝트 기록을 따릅니다. 기존 백업·원본·실패 증거는 보존하며 commit/push·원본 전체 복원/교체는 이번 승인에 포함하지 않습니다. 실패 시 자동 재실행/repair·guard 우회 없이 STOP·writer 통제와 증거 보존을 유지합니다.

**2026-10-24 미사용 Docker 자원 추가 정리:** 사용자의 후속 명시 승인으로 완료된 초기 준비4개·전환 helper2개 컨테이너와 미사용 이미지4개·중복 태그3개를 정리했습니다. full ID·종료 상태·소유권·참조를 대조하고 로그를 private 보존했으며, 교체 전 Backend/migrator의 기존 이미지 보존본은 크기·SHA를 재검증했습니다. 실행 서비스5개·볼륨5개·네트워크3개·필수 이미지와 현재 공개/예약 상태는 전후 동일합니다. 미사용 볼륨은 없었으므로 볼륨 삭제·DB 접속 쓰기·서비스 중지/재생성·백업 변경은 없었습니다. 첫 자연 예약 확인 도구도 읽기 전용 대기 결과를 유지합니다. 삭제 목록과 남긴 이미지의 용도는 [프로젝트 기록](project.md#현행-개발-환경-적용과-갱신복구-통합-계획)을 따릅니다.

**2026-10-23 레거시 정리 완료:** 후속 사용자 명시 승인으로 소스 정리 `2324db7`과 기존 미공개 커밋을 일반 push하고, 새 백업·독립 복원 검증과 원격 소스 의존 제거 확인 뒤 팀·별도 API 환경과 GitHub Release를 삭제했습니다. 레거시 컨테이너 10개·볼륨 4개·네트워크 6개를 현행 `recycleyoungs-dev`와 구분해 full ID·image·소유권 label·생성 정보·mount·공유 여부를 확인했습니다. 원본 stopped DB를 재기동하거나 SQL에 접속하지 않고 읽기 전용 cold copy를 만들었으며, 복제본에서 같은 exported snapshot의 비교 기준과 논리 백업을 확보했습니다. 독립 internal network·tmpfs DB의 전체 값·geometry·catalog·역할/ACL·sequence·계정 접속 비교가 모두 PASS였습니다. 프로젝트 밖 0700 디렉터리·0600 파일의 새 백업·원본/제어/인증 보존본·검증 증거와 Git tag·공유 이미지는 유지합니다. 현행 dev의 migration·ETL·재생성·전환은 이번 승인에 포함하지 않았습니다. 아래의 팀·별도 API 실행 절차는 과거 이력입니다.

새 경로 검증은 `recycleyoungs-dev-check-eb62581c` 한 세트와 전용 이미지 태그로 수행했습니다. 새 볼륨5개·네트워크3개·Frontend loopback15173, DB 메모리2GiB로 기존 자원과 분리했고 실제 identity·migration·최초 수집·공개·HTTP·RO/READY 재실행을 확인했습니다. 완료 후 실행 중인5개를 정상 중지했으며, 위의 새 보존 검증으로 이 DB도 독립 복원한 뒤 컨테이너9개·볼륨5개·네트워크3개를 삭제했습니다. 수집 원본·제어·secret의 cold backup은 보존합니다. 새 환경 초기화 검증을 기존 레거시 DB의 백업 gate로 대체하지 않았습니다. 최종 정리 대상은 총 컨테이너19개·볼륨9개·네트워크9개이고 잔존 0개입니다. 보호 대상인 현행9개·볼륨5개·네트워크3개의 metadata와 실행 상태는 전후 동일합니다.

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

**선택적 초기화 도구(2026-10-28):** `reset` tools service의 기본 실행은 Docker metadata 미리보기이며 DB에 접속하지 않습니다. `--apply --confirm <project>`는 해당 프로젝트 DB·원본·제어 볼륨을 영구 삭제하는 별도 파괴적 명령입니다. 기존 데이터에는 아래의 변경 직전 최신 전체 백업·독립 복원 검증과 정확한 대상/범위 승인이 선행돼야 합니다. 이 도구는 그 백업·복원 조건을 자동 검증하거나 완료했다고 주장하지 않으며, 확인되지 않은 환경에서 삭제를 실행할 근거가 아닙니다. 실패 시 자동 retry/force/prune는 하지 않습니다. 이번 사용자 요청은 선택적 명령 추가 범위이며 현행 자원의 실제 삭제·재시작 승인이 아닙니다. 검증은 별도 namespace의 새 빈 합성 자원에 한정합니다.

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

2026-10-23의22분기/context 구현 승인은 새 격리 검증 대상만 포함합니다. 최초2세트에 더해 실패 원인 수정·리뷰 보완의 최종 fresh 검증용1세트와 그 정리를 별도 승인받았습니다. 기존dev/팀/별도API/퇴역 DB·볼륨·백업·원격 Releases는 제외합니다. 생성한 nonce/full ID·image·label·internal network·tmpfs/no host port와 실제 연결 identity를 대조하고, 실패 target에 migration/ETL을 자동 재실행하지 않습니다. 정리는 이 실행이 만든 정확한 자원으로 제한합니다. 중단 후 stopped 상태였던 두 번째 tmpfs DB는 재기동하지 않고 생성 full IDs·소유권·metadata·기존 검증 증거로 정리했으며 SID 재조회 미실행을 기록했습니다. source/원본/private 실패 증거는 보존합니다. 이 기록을 이후 대상의 실행 승인으로 사용하지 않습니다.

세션에서 승인한 대상과 작업만 수행합니다. 문서·일반 테스트에는 DB 접속이 필요하지 않습니다.

| 작업 | 실행 전 확인 |
| --- | --- |
| 최초 팀 환경 준비 | 이름·포트 충돌, 사용할 daemon과 생성 범위 |
| 기존 팀 상태 조회 | 자원 소유권·실제 연결 대상, 읽기 전용 범위 |
| 기존 DB migration·ETL | 변경 범위 승인, 보존 기준, 최신 백업·독립 복원 |
| 중지·재생성·복원·삭제 | 자원별 소유권과 명시적 승인 범위 |

`docker compose up -d`는 현재 기본 API 환경이며 자원을 생성·시작·재생성할 수 있습니다. `make db`·`make etl`·별도 API launcher는 퇴역했습니다. 기존 자원에 대한 작업은 실제 영향을 먼저 확인합니다.

`make dev-status`는 실제 DB 읽기 전용 조회이며 문서 검증용 명령으로 사용하지 않습니다. 과거 `db-info`·`check-db`는 제거했습니다.

과거 `db-migrate`·`db-baseline`은 제거했습니다. 직접 Flyway로 전환·승인 guard를 우회하지 않습니다.

다음 작업은 해당 범위의 명시적 승인 없이 실행하지 않습니다.

- 기존 DB에 대한 Flyway migrate/baseline/repair/clean
- Polygon `--load`, 전체 CSV·점포 loader
- DDL/DML, GRANT·ALTER ROLE, sequence 변경
- 기존 컨테이너 stop/restart/recreate, 볼륨 mount/delete
- 기존 DB restore, 백업 복사·이동·삭제·덮어쓰기
- `docker compose down -v`

팀 `bootRun`과 전용 reader profile은 퇴역했습니다. 일반 `bootRun`은 DB 접속 전에 중단합니다. 현행 Compose는 소유권을 확인하는 `api-dev` reader profile과 Flyway 비활성화를 사용하며, 일반 애플리케이션 설정·`dbTest`에 같은 보장을 적용하지 않습니다.

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

## 2026-10-25 월요일11시 예약 변경

사용자는 PC 절전을 고려해 실제 주간 갱신을11시로 옮기도록 명시 요청했습니다. 시간 계산 한 파일만 달라진 새 불변 worker를 검증하고 기존25개 테이블의 전체 snapshot이 검증된 V6 보존본과 일치함을 확인한 뒤, 정확한 원본SID/actor·advisory/row lock·이전값 CAS로 api_runtime.state.next_due/updated_at만 변경했습니다. 업무 행·catalog·sequence·공개 cafe/reference와 SQL binding/READY·인증·기존5볼륨을 보존했습니다. 영속 activation guard 아래 scheduler만 교체했고 실제 PID1 시작과다음10/26 11:00을 확인했습니다. 코드상 매주 월11시이며 후속 Codex 검증/조건부 정리는이번10/26 12:00입니다.

기존 V6 전체 백업/독립 복원 증거와 원본은 덮어쓰지 않고 재사용합니다. 새 worker archive·변경 전후 snapshot·시각 변경 journal과 명시적 supersession을 별도 보존했으며 새로운 전체 백업/복원을 반복했다고 보고하지 않습니다. 복구한 환경의 scheduler를 시작하기 전에는 최신 승인된 시각과 worker·제어/예약 상태를 대조해야 합니다. 자연 검증·cleanup에는 새 scheduler/source/runtime/시각과새 planSHA↔supersessionSHA를 결속합니다. 기존 후보에 정확한 중지 helper1개만 추가해60컨테이너/30볼륨/20네트워크/22이미지이며 실제 자연 PASS 전 삭제하지 않습니다. 과거04:30/05:30 기록은 당시 이력이며 현재 실행 입력으로 재사용하지 않습니다.

## 2026-10-26 실제 예약 확인·선별 정리 완료

새 scheduler의11시 자연 예약은11:29:52에 SUCCEEDED/published로 완료했고, READ ONLY의 정확한 대상·PID1 출처·전체 등록 원본/registry·22분기·16API/38요청 검증이 PASS입니다. 다음 예약은11/2 11시 KST입니다. 수동 refresh/reconcile·DB 쓰기·서비스 재생성·marker 제거는 하지 않았습니다.

새 schedule supersession·plan7b863156…와 기존 V6 전체 백업/독립 복원 PASS를 결속한 뒤 승인된 정리를 최초 한 번 실행했습니다.60후보의 불변metadata/소유권/모든 참조와 로그를 보존하고 정상 종료한 뒤30볼륨을 읽기 전용 mount로 cold archive 두 벌 생성/해시·구조 검증했으며,22이미지도 불변ID로 보존했습니다. 이후 해당60컨테이너·30볼륨·20네트워크·22이미지만 삭제했고 전역 prune/force는 사용하지 않았습니다. cold 보존본 자체의 독립 복원은 미실행이며 기존 V6 전체 복원 증거와 구분합니다. 현행 DB/SID·5서비스·5볼륨·필수 네트워크/이미지·25개 테이블 전체 값/catalog/sequence·공개/예약의 전후 동일성과16API 재검증이 PASS입니다. 공용 builder cache·기존 백업/원본/인증/실패 증거·저장소 scratch는 보존했습니다. 실제 주간 갱신은 계속 매주 월요일11시에 동작하며 일회성 결과 확인 자동화와 구분합니다.

완료된12시 Codex 일회성 결과 확인 자동화는 삭제했습니다. Docker scheduler의 매주 월요일11시 예약과 다음11/2 11시는 유지합니다. 이 후속에서 새로운 DB 조사·재설계 구현·Git stage/commit/push는 시작하지 않았습니다.

## 검증 산출물 보존 기간과 즉시 정리

사용자의2026-10-26 지시로, 검증 성공과 현재 실행/복구 의존 없음 확인 후 해당 작업의 일회용 캐시·readback·전체 복사본·preview/export를 같은 작업에서 정리합니다. 기본 장기 보존은 마지막 독립 복원 검증을 통과한 전체 백업 한 세트와 필요한 최신 worker/복구 기록이며, 추가 대용량 사본은 목적·예상 용량·삭제 조건을 먼저 합의합니다. 새 백업의 복원 검증과 대체 가능성 확인 후 불필요해진 이전 백업을 정리합니다. 검증 중 필요한 대조 사본을 무조건 영구 두 벌로 보관하지 않으며 새 대용량 사본을 만들 때는 종료/실패 시 정리 조건을 명시합니다.

이번 정리는 정확한7개 디렉터리의 소유권·inode·symlink 부재와 현재 mount 의존 없음을 확인해 수행했습니다. 남긴 전체 백업의manifest/파일metadata와 최신 worker archive의SHA, 현재5컨테이너의 ID/image/mount/state/network를 전후 대조했습니다. 보존한 백업의 기준 시점은10/25이며10/26 자연 갱신 이후 새 전체 백업을 만든 것으로 해석하지 않습니다. 현행 DB/볼륨·원본/인증과 아직 대체되지 않은 유일한 복구본은 즉시 정리 대상이 아닙니다.

## 2026-10-26 신규 클론 검증의 분리 범위

새클론 실행 점검 승인으로 생성한f7b211e2/새SID7700857980791156776은 현행b3fa6dd7…/SID7700833237598617614와 다릅니다. 새5볼륨/3네트워크/전용앱이미지·loopback15179의 최초공식수집과 V1~V6,16API를 확인했고 실제READ ONLY의 동일연결identity·전체등록원본/참고record와 READY 재실행의 공개·이력·파일metadata보존을 검증했습니다. 이 일회용초기화 데이터는 현행업무/복구 자산으로 채택하지 않았으며 새 백업/전체tar/readback을 생성하지 않았습니다. 통과 후 소유권/전체컨테이너 의존과 현행5서비스metadata 보존을 다시확인해 이번9컨테이너/5볼륨/3네트워크/5이미지·이번빌드이력/생성시각에결속된 정확한59캐시ID만 정상정리했습니다. 전역prune/강제삭제·현행볼륨 조작은 없고 최신전체복원검증백업 한세트는 유지합니다.

커밋전 전체읽기전용리뷰와 일반테스트 결과·초기화와현행데이터의차이는 project/README에 기록했습니다. 복구 도구 이미지ID의 OCI/legacy검증을 합성archive로 보강했으나 이를 현행새전체백업/복원실측으로 기록하지 않습니다. 보존제안의기본1세트도 파일검증 입력에 대한 제안일뿐이며 실제오래된백업삭제에는 새독립복원/대체가능성/의존없음 검증과 상시정리범위가 필요합니다.

## 2026-10-26 신규 22분기 초기화 검증 범위

새클론을 로컬의22Q/context5/reference3과 같은범위로 맞추라는 사용자 요청에 따라 공식 수집·schema/typed 적재·새공개는 새로운7c78702d namespace의 빈5볼륨에만 수행합니다. canonical SID7700833237598617614/5서비스/볼륨·보존백업은 보호합니다. 초기화guard·identity/READONLY·정확2격리/소비보류·기존expectedID 검증을 우회하지 않습니다. 현행의같은READONLY연결에서 최소 승인분류정책/공개분기만 확인했으며 원본행·비밀번호·backup/private증거를 조사하거나Git에포함하지 않았습니다. 독립재검증된bundle의원본·격리·인증과영속제어는유지하고 그bundle과동일함이확인된이번중복수집폴더만정리합니다. 실제검증의PASS/FAIL과이후일회용자원정리결과는project최신절에구분합니다.

해당새환경의실제초기화·25테이블/22Q/context5/reference3·같은READONLY연결의전체등록원본/격리/참고record와16API36요청이PASS입니다. 로컬공개판의분기·행수·참고동/분기키·현재목록건수와일치합니다. READY재실행후같은증거를다시확인해동일하며canonical5서비스의metadata/StartedAt은보존했습니다. 기존초기화/실패guard해제·현재DB쓰기·원본dump/전체backup/restore는수행하지않았습니다.

성공인수후소유권/모든참조·현재보호대상전후동일성을대조하고이번9컨테이너/5볼륨/3네트워크/4앱이미지/귀속이입증된신규55cacheID만정리했습니다. cache0B이며기존5서비스/5볼륨/4필수이미지·최신전체복원백업은유지합니다. 전역prune/force삭제·기존다른scratch삭제는하지않았습니다.
