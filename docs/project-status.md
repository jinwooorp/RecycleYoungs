# 프로젝트 분석·정리 기록

확인일: 2026-10-03(Asia/Seoul). 이전 검증과 이번 검증은 아래에서 구분합니다.

## 전체 분석

프로젝트는 개발 골격과 원본 CSV·초기 스키마·ETL이 있는 단계입니다. Spring API와 React 서비스 화면의 연결은 아직 없습니다. 초기 기능은 같은 행정동·업종·분기의 매출과 점포 통계를 조회하는 흐름으로 진행할 수 있습니다.

| 영역 | 확인한 상태 | 우선 남은 일 |
| --- | --- | --- |
| Backend | 실행 클래스·CORS·contextLoads 테스트 | DB 접근·마이그레이션·조회 API |
| Frontend | Vite 템플릿·개발 프록시 | 조건 선택·결과 표·상태 처리 |
| ETL | CSV 사전 검사·선택 실행·변환·일괄 트랜잭션, 행정동 매출·점포 실제 DB 검증 완료 | 나머지 자료의 실제 적재 검증 |
| DB | 7개 테이블·인덱스·서울시 업종 4개 매핑 | 출처·적재 이력·스냅샷 버전·경계 |
| 원본 | CSV 6개, 해시·행 수·기간·코드 연결 확인 | 좌표계·단위·경계 버전·이용 조건 확인 |
| 기존 코드 | 활성 코드의 실행 의존성이 없는 실험 프로젝트 | 필요한 설계 이전 후 별도 제거 |

행정동 매출·점포는 425개 행정동 코드와 2025년 4개 분기를 공유합니다. 상권 매출 1,577개 코드는 영역 자료 1,650개 코드에 모두 포함되지만, 영역 자료는 POINT 정보이며 Polygon이 아닙니다. 서울시 전체 인구 22행은 지역별 수요 분석에 사용하지 않습니다. 2025년 통계와 파일명 기준 2026년 6월 개별 점포의 시점을 구분해야 합니다.

## 정리한 내용

- 루트 README를 개요·현재 상태·시작 방법으로 축소하고 설계·개발 안내·데이터 목록·로드맵을 `docs/`로 분리했습니다.
- `README_temp.md`의 실행·입력 설명을 `etl/README.md`와 데이터 문서에 통합했습니다.
- `csv_server/`를 `legacy/csv_server/`로 이동했습니다. 기존 추적 파일 62개의 바이트가 원본과 같음을 확인했습니다.
- `.env.example`, 공용 Git 제외 규칙과 Makefile을 추가했습니다. CSV 6개는 제외하고 `.gitkeep`과 manifest는 추적할 수 있습니다.
- DB 이름·계정 기본값·볼륨은 유지하고 DB를 localhost에 바인딩했습니다. ETL은 선택 실행 서비스로 분리했습니다.
- NULL 직렬화 오류, 정수 정밀도 손실, 실패 전 삭제 commit, 입력 파일의 모호한 선택을 수정했습니다.
- 적재 전 파일·헤더·행 구조·키·2025년 4개 분기 완전성을 검사합니다. 선택한 DB 작업은 하나의 트랜잭션에서 처리합니다.
- 상권 좌표계는 미확인 기본값을 제거하고 명시 설정하도록 했습니다. DB 데이터 접근 기능과 점수·지도 기능은 로드맵에 남겼습니다.

## 2026-09-30 검증

| 검사 | 결과 |
| --- | --- |
| Frontend `npm run build` | 통과 |
| Frontend `npm run lint` | 통과 |
| Backend `./gradlew --offline test` | BUILD SUCCESSFUL; 변경 없는 작업은 기존 테스트 결과 재사용 |
| ETL unittest | 15개 통과: NULL·코드·정밀도·입력 오류·선택 실행·트랜잭션 실패 경계 |
| 실제 ETL 입력 `--validate-only` | CSV 5개·849,805행 통과, DB 연결 없음 |
| 원본 CSV 6개 | 해시·행 수·분기·후보키 중복·열 개수 검사 완료 |
| Compose | 기본 서비스 DB만 활성, ETL profile·입력 경로·내부 포트·localhost 바인딩 확인 |
| 문서·Git | 로컬 링크·공백 검사, `.gitkeep`·manifest 추적 가능 및 CSV 제외 확인 |

당시 Docker 데몬에 연결되지 않아 실제 PostgreSQL/PostGIS 적재·EWKT 처리·DB의 rollback과 영속 볼륨 재기동은 검증하지 못했습니다. 회귀 테스트의 transaction 검사는 fake connection으로 수행했습니다. 원본 CSV와 기존 DB 데이터는 수정하지 않았습니다.

## 2026-10-03 행정동 적재·복구 검증

작업 시작 시 `main`의 작업 디렉터리는 깨끗했고, Docker `desktop-linux` context에 기존 컨테이너·볼륨은 없었습니다. `.env`는 프로젝트 기본값과 일치하며 `AREA_SOURCE_CRS`는 공란으로 유지했습니다. 새 `recycleyoungs_postgres_data` 볼륨으로 DB를 시작하고 초기 대상 테이블이 비어 있음을 확인했습니다. PostgreSQL 16.4 연결·healthy 상태와 PostGIS 3.4.3 extension을 확인했습니다.

로컬 `etl/.venv`가 없어 프로젝트 ETL Docker 이미지로 기존 unittest 15개를 실행해 모두 통과했습니다. `make etl-validate`는 DB 연결 없이 CSV 5개·849,805행을 검증했습니다. `make etl ETL_ARGS="--only store_stats_dong sales_dong"`로 아래 두 자료만 적재하고 동일 명령을 다시 실행했습니다.

| 테이블 | 원본 = DB 행 수 | 20251 | 20252 | 20253 | 20254 | 복합 키 중복 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `store_stats_dong` | 141,218 | 35,281 | 35,294 | 35,326 | 35,317 | 0 |
| `sales_dong` | 67,113 | 16,770 | 16,794 | 16,831 | 16,718 | 0 |

복합 키는 `quarter_code + dong_code + source_industry_code`입니다. 원본을 `csv.DictReader`로 별도 파싱해 두 테이블의 모든 키와 저장 필드를 대조했습니다. 정수는 Python `int`, 비율은 `Decimal`로 비교했고 모두 일치했습니다. `SEOUL / CS100010 → CAFE`의 `industry_id=1` 연결은 카페 점포 1,700행·매출 1,683행 모두 일치했으며 나머지 서울시 매핑 3개도 확인했습니다.

카페 `CS100010`·20251의 다음 세 행정동에서 점포·개폐업·프랜차이즈 통계와 매출·건수·주중/주말·시간대·연령대 값을 원본과 직접 비교했습니다.

| 행정동 코드 | 행정동 | 점포 수 | 추정매출 원본 값 = DB 값 | 매출 건수 |
| --- | --- | ---: | ---: | ---: |
| `11110515` | 청운효자동 | 114 | 4,535,266,422 | 302,642 |
| `11110530` | 사직동 | 178 | 9,462,371,274 | 954,826 |
| `11110540` | 삼청동 | 89 | 5,548,781,022 | 296,777 |

원본 최대 `sales_amount`는 20254·노량진2동(`11590520`)·`CS300008`의 `866223000000`이며 DB BIGINT와 정확히 일치했습니다. 두 원본에는 빈 필드나 2^53 초과 금액이 없어 해당 원본 사례로 NULL·정밀도 경계를 검증하지는 못했습니다. 대신 원본 밖의 임시 4분기 CSV를 실제 loader로 적재해 빈 통계값의 SQL NULL 보존과 `9007199254740993`의 정확한 저장을 확인한 뒤 검증 트랜잭션을 강제 rollback했습니다. 업종 미매핑의 `industry_id`도 NULL로 유지됐습니다(점포 134,439행·매출 60,460행).

재실행 전후 행 수·분기·키·샘플·원본 값은 동일했습니다. 키 순으로 각 행의 `to_jsonb(t)-'id'`를 MD5 집계한 checksum도 같았습니다: 점포 `f5f45056c75fc4066cf2d8bf5a02e972`, 매출 `4445ff3ff1d895ac76e0386dfa7bcebc`. 현재 연도별 DELETE/재삽입 방식은 내부 `id`를 재발급하므로 재실행의 동일성은 복합 키와 통계 필드 기준입니다.

실제 rollback은 별도 PostgreSQL 세션에서 `BEGIN; LOCK TABLE sales_dong IN ACCESS EXCLUSIVE MODE;`를 실행한 뒤 다음 명령으로 검증했습니다.

```sh
docker compose run --rm --no-deps \
  -e PGOPTIONS='-c lock_timeout=15s' -e PGAPPNAME=etl-rollback-probe \
  etl --only store_stats_dong sales_dong
```

첫 job이 실제 점포 행을 DELETE·INSERT한 후 둘째 job의 매출 DELETE가 잠금 대기하는 것을 `pg_stat_activity`·`pg_locks`로 확인했습니다. 의도한 lock timeout으로 ETL이 종료 코드 1을 반환했고, `pg_stat_user_tables`의 점포 INSERT·DELETE 누적 건수가 각각 141,218 증가해 첫 작업의 실제 DB 변경도 확인했습니다. 잠금 세션은 `ROLLBACK` 후 종료했습니다. 실패 전후 건수·분기·키·샘플과 `id`를 포함한 전체 행 checksum이 동일하고 원본 전수 대조도 통과했습니다. PostgreSQL sequence는 rollback 대상이 아니므로 점포 sequence 값은 증가했지만 저장된 행은 보존됐습니다.

ETL production 코드·스키마 수정 없이 검증했습니다. 원본 CSV 6개의 SHA-256은 작업 전후 같고, 미선택 `commercial_areas`·`sales_commercial_area`·`stores`는 0행을 유지했습니다. DB와 새 볼륨은 보존했습니다. 상권 좌표/EWKT·기존 볼륨 재사용/재기동·Spring/React 연결은 이번에 검증하지 않았습니다.

후속 작업과 완료 기준은 [로드맵](roadmap.md), 실행 방법은 [개발 안내](development.md)를 확인합니다.
