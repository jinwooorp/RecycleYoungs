# 8-C2 기존 개발 DB 적용 절차 — 실행 전 검토용

이 문서는 **8-C1에서 작성한 계획**이며 기존 개발 DB에서 실행한 결과가 아닙니다. 8-C1은 별도 internal network/tmpfs DB의 Fresh·Populated·백업 복원을 검증합니다. 아래의 개발 DB 명령은 8-C1에서 실행하지 않습니다. 8-C1 diff/결과 리뷰 후 별도 8-C2 승인과 실제 대상 상태 확인이 필요합니다.

보호 대상은 `startup-analysis-postgres`, `recycleyoungs_postgres_data`, 개발 host port 5432입니다. 기존 volume을 유지하며 CSV full loader·`make etl`·TRUNCATE·volume 삭제·container 재생성·Flyway repair/clean/자동 baseline을 이 절차에 사용하지 않습니다.

## 1. 접속 identity 확인

실행 승인 후 우선 Docker metadata만 확인합니다. 승인한 container ID/image·mount의 volume name/destination·network/alias·host port와 실제 DB 이름/user를 대조합니다. `.env` 값을 무조건 현재 DB 사실로 취급하지 않고, 비밀값을 로그에 출력하지 않습니다. 다른 container·volume·DB를 발견하면 중단합니다.

```sh
# 검토용: 8-C1에서는 실행하지 않음
C2_CONTAINER=startup-analysis-postgres
docker inspect --format '{{.Id}} {{.Config.Image}} {{json .Mounts}} {{json .NetworkSettings.Networks}} {{json .HostConfig.PortBindings}}' "$C2_CONTAINER"
# 실제 값을 확인한 다음에만 설정: C2_DB_NAME, C2_DB_USER, C2_DB_NETWORK, C2_DB_ALIAS
: "${C2_DB_NAME:?확인한 DB 이름 필요}" "${C2_DB_USER:?확인한 DB user 필요}"
```

이후 처음 연결하는 read-only SQL에서 `current_database()`, `current_user`, server 주소/port, PostgreSQL/PostGIS version, `pg_control_system().system_identifier`를 기록합니다. 내부 container port 5432와 host port를 구분합니다. 작업 중 매 명령 전에 같은 container ID·DB 이름·system identifier를 다시 확인합니다.

## 2. Flyway history/checksum/validate

`flyway_schema_history`의 전 row를 기록합니다. 성공한 V1 또는 기존에 검증해 편입한 BASELINE 1 상태인지 확인합니다. BASELINE의 NULL checksum은 V1 SQL checksum과 동일하다고 주장하지 않고 3절의 구조 대조로 보완합니다. history 부재·실패 row·예상 밖 V2/V3·checksum 불일치는 중단 조건입니다. 새 baseline/repair로 덮지 않습니다.

승인한 network/alias·DB/user/password를 명시한 Flyway12.4.0으로 `info`와 `validate`를 수행합니다. SQL 디렉터리는 read-only mount, `baselineOnMigrate=false`, `cleanDisabled=true`, script별 transaction(`group=false`)을 유지합니다. 현재 코드의 V1/V2/V3 파일 SHA도 기록합니다.

## 3. 실제 V1 구조 대조

V1의 7table·column/type/nullability/default·PK/UNIQUE/FK/CHECK·index·sequence ownership·PostGIS extension을 catalog SQL/`pg_dump --schema-only`로 수집합니다. 별도 격리 DB에 실제 V1만 적용해 얻은 구조와 비교합니다. 타입·누락 컬럼·제약·추가 객체의 의미를 설명하지 못하면 migration하지 않습니다. Flyway validate만으로 legacy 구조 일치를 보증하지 않습니다.

## 4. 전수 row count/checksum

ETL 및 다른 writer를 중지한 검증 창을 확보합니다. V1의 7table을 read-only REPEATABLE READ snapshot에서 기록합니다. 장기 snapshot의 시작/종료와 backup 사이에 데이터가 바뀌지 않았는지도 확인합니다.

[8-C1 snapshot 구현](../etl/tests/integration_support.py)의 `table_query`와 length-framed streaming SHA 규칙을 사용합니다. 그 도구의 `connect_isolated`는 개발 DB를 거부하므로 개발 DB용으로 override/해제하지 않습니다. 8-C2에서는 검토된 read-only 접속 경로에서 동일 SELECT를 실행하고 streaming digest만 재사용합니다. 실제 접속값과 SQL 목록을 8-C2 실행 전에 별도로 리뷰합니다.

각 row의 모든 실제 column을 포함하며 물리 보존 비교는 `id`/FK를 제외하지 않습니다. stores에는 industry_id를 제외한 추가 digest와 `(id,source_store_id,industry_code)`·예상 V3 분류 digest를 기록합니다. 모든 table의 정렬 key·NULL·column 집합을 결과와 함께 저장합니다. 행 수만 비교하지 않습니다.

## 5. ID/sequence 상태

stores의 id/source_store_id 집합과 모든 V1 `*_id_seq`의 `last_value`/`is_called`·ownership을 기록합니다. V3에서 stores sequence와 기존 다른 V1 sequence는 변경되지 않아야 합니다. 새 mapping INSERT에 따른 industry_mappings sequence 변화만 허용합니다. sequence를 setval/RESTART해 일치시키지 않습니다.

## 6. POINT WKB/NULL 및 V3 대상

stores·commercial_areas의 `ST_AsBinary(location,'NDR')` hex와 SRID를 row digest에 포함합니다. POINT NULL·경도/위도 NULL·업종 NULL 수, I21201 전체/NULL/이미 CAFE/non-CAFE 수와 대상 source_store_id/id 목록 digest를 기록합니다. 대상 건수는 실제 DB에서 계산하며 554092/22739를 적용 조건으로 hard-code하지 않습니다. 값 NULL과 행 없음(NO_ROW)을 0으로 합치지 않습니다.

## 7. 실제 DB 백업

1~6절 통과 후 pg_dump custom format을 프로젝트 밖 제한된 백업 경로에 저장합니다. 종료 코드·stderr·파일 크기·SHA·`pg_restore --list` 성공을 확인합니다. 비어 있거나 실패한 dump는 승인하지 않습니다. DB의 role/ACL/extension·복원에 필요한 환경도 별도로 기록합니다.

```sh
# 검토용: 실제 8-C2에서 identity·writer 정지·권한 확인 후에만 실행
C2_BACKUP_DIR=$(mktemp -d /tmp/ry-8c2-backup-XXXXXX)
chmod 700 "$C2_BACKUP_DIR"
docker exec "$C2_CONTAINER" pg_dump -U "$C2_DB_USER" -d "$C2_DB_NAME" -Fc > "$C2_BACKUP_DIR/pre-v2-v3.dump"
# 위 명령 exit 0 확인 후
shasum -a 256 "$C2_BACKUP_DIR/pre-v2-v3.dump"
docker exec -i "$C2_CONTAINER" pg_restore --list < "$C2_BACKUP_DIR/pre-v2-v3.dump" > "$C2_BACKUP_DIR/toc.txt"
```

8-C1의 `populated-v1.dump`는 테스트 DB 백업이므로 이 실제 백업을 대신하지 않습니다.

## 8. 새 격리 DB에 복원·무결성 검증

기존 volume과 분리된 새 tmpfs/internal-network/no-host-port PostGIS container를 생성하고 metadata를 검사합니다. 빈 새 DB에 `pg_restore --exit-on-error`를 수행합니다. 테스트 환경에서 `--no-owner/--no-acl`을 쓴다면 role/권한 복원을 보증하지 않는다는 사실을 기록하고 실제 복구에 필요한 owner/ACL 조건은 따로 검증합니다.

복원 DB와 실제 DB pre-snapshot의 7table 전 row/ID/POINT·NULL·모든 V1 sequence·Flyway history/checksum·구조를 비교합니다. 하나라도 다르거나 실제 복원이 실패하면 V2/V3를 적용하지 않습니다. 백업 파일 존재/TOC 통과만으로 복구 가능하다고 판단하지 않습니다.

## 9. migration 직전 중단 조건

다음 중 하나라도 해당하면 중단하고 원인을 보고합니다.

- identity/volume/DB/user/version이 승인 값과 다름
- writer가 남거나 snapshot/backup 이후 row/hash/sequence/history 변화
- V1 구조/성공 checksum 불일치 또는 설명되지 않은 migration 상태
- 백업·실제 복원·전수 비교 실패
- CAFE 부재, SEMAS/I21201이 다른 업종 연결, I21201에 non-CAFE industry 존재
- 고정 ZIP/member/report SHA·repair acceptance·도구 버전 불일치/누락
- 원본 보존·source/operational 정책을 충족하지 못함

이미 V2/V3가 적용된 DB라면 같은 절차를 억지로 실행하지 않고 현재 history에 맞춰 새 계획을 검토합니다.

## 10. V2 → V3 적용 순서

승인된 접속 identity와 schema writer 중지 상태에서 먼저 **실제 Flyway target=2 migrate**를 실행합니다. V2 schema와 V1 전수 보존을 확인한 뒤 target=3으로 V3를 적용합니다. V3는 script transaction에서 mapping/stores writer를 잠그고 충돌 검사→mapping→NULL 대상 최소 backfill을 수행합니다. 둘을 한 transaction으로 합치지 않습니다.

```sh
# 검토용 template: 실제 alias/network/secret을 확인하고 안전하게 제공한 뒤 실행
# FLYWAY_PASSWORD는 승인한 방식으로 전달하며 출력하지 않음
: "${C2_DB_NETWORK:?확인한 network 필요}" "${C2_DB_ALIAS:?확인한 DB alias 필요}"
docker run --rm --network "$C2_DB_NETWORK" \
  -v "$PWD/backend/src/main/resources/db/migration:/flyway/sql:ro" \
  -e FLYWAY_PASSWORD flyway/flyway:12.4.0 \
  "-url=jdbc:postgresql://$C2_DB_ALIAS:5432/$C2_DB_NAME" "-user=$C2_DB_USER" \
  -baselineOnMigrate=false -cleanDisabled=true -group=false -target=2 migrate
# V2/보존 확인 후 위 명령의 target만 3으로 변경해 migrate; 이어 validate
```

## 11. V3 전후 분류·변경 범위

기존 통계3table·대표 POINT catalog·industries의 ID 포함 digest가 같아야 합니다. stores의 industry_id 제외 전 column/ID/POINT digest·sequence와 target id set이 같아야 합니다. 실제 분류 digest는 pre-snapshot에서 I21201+NULL만 CAFE로 바꾼 예상 digest와 정확히 같아야 합니다. 이미 CAFE는 유지, 다른 code의 기존 업종은 유지, NULL/non-CAFE I21201은 0이어야 합니다. 기존 mapping 4row의 id/값을 보존하고 SEMAS/I21201→CAFE만 추가됐는지 확인합니다.

## 12. Polygon-only 실행

V3 검증과 ZIP/report/도구 버전 확인 후 승인한 ETL image에 원본·app을 read-only mount합니다. profile에 실제 버전을 기록합니다. 명시적 DSN을 사용하며 `app.main`, `make etl`, stores/commercial_areas loader는 실행하지 않습니다.

```sh
# 검토용: 실제 8-C2 전용 검토 환경에서 explicit DSN/경로를 준비한 뒤 실행
python -m app.spatial_main --load --dsn "$C2_APPROVED_SPATIAL_DSN" \
  --admin-zip "$C2_ADMIN_ZIP" --admin-report "$C2_ADMIN_REPORT" \
  --commercial-zip "$C2_COMMERCIAL_ZIP" --commercial-report "$C2_COMMERCIAL_REPORT" \
  --commercial-repair-report "$C2_REPAIR_REPORT"
```

종류별 transaction입니다. 행정동 성공 후 상권 실패가 가능하며 전체 두 종류가 한 transaction이라고 주장하지 않습니다. 기존 READY/current가 있다면 동일 profile 재실행은 row/id/hash/loaded_at을 유지하고 불일치는 중단합니다.

## 13. 적재 후 전수 보존 및 공간 확인

V3 직후 snapshot과 Polygon 직후 snapshot의 V1 전 값/ID/sequence를 비교합니다. current READY 각각1개, 행정동425 VALID_SOURCE·상권1644 VALID_SOURCE/6 REPAIRED_OPERATIONAL, SRID5181/type/validity/hash·H5 raw 속성·B/UNRESOLVED를 확인합니다. 동일 입력 재실행에서 경계 id/loaded_at/hash 불변도 확인합니다. ANALYZE/EXPLAIN·ST_Covers는 서비스 API 완성을 뜻하지 않습니다.

## 14. 장애 발생 시 중단·복구

- V2 실패: 해당 script rollback 여부/history/기존 데이터 보존을 확인하고 중단합니다.
- V2 성공·V3 실패: V2 schema는 남습니다. V3 mapping/backfill rollback과 이전 V1 rows를 확인하고 충돌 원인을 보고합니다. repair/수동 덮어쓰기/full ETL로 통과시키지 않습니다.
- Polygon 실패: 실패 kind의 transaction rollback·이전 current/V1 보존을 확인합니다. 이미 성공한 다른 kind를 자동 삭제하지 않습니다.
- 보존 비교 실패: reader 공개/후속 쓰기를 중지하고 증거를 확보합니다. 자동 초기화·backup 덮어쓰기·DROP/volume 삭제를 수행하지 않습니다.
- 실제 복구가 필요하면 검증된 backup을 **새 분리 DB**에 복원해 다시 검증하고, 사용자 승인 후 접속 전환/복구 범위를 정합니다. 기존 DB에 자동 restore하지 않습니다.

8-C2의 실제 적용과 보존 증거가 완료되기 전에는 로드맵 8-C 전체를 완료 처리하지 않습니다.
