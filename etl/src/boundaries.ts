import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import {
  assertLocalDatabaseUrl,
  rollbackOrDiscard,
  safeMessage,
} from './database.js';

// 기존 호출부도 같은 로컬 DB 제한을 계속 사용할 수 있도록 공개 경로를 유지합니다.
export { assertLocalDatabaseUrl } from './database.js';
import {
  BoundarySourceError,
  readBoundarySource,
  type BoundarySource,
} from './boundary-source.js';

// 행정표준코드관리시스템 서울 시군구 코드(시도 11 + 시군구 3자리), 2026-10 확인.
// https://www.code.go.kr/stdcode/sggCodeIL.do?sidoCd=11&disuseAt=0&searchOk=0
const districtNames: Readonly<Record<string, string>> = {
  '11110': '종로구',
  '11140': '중구',
  '11170': '용산구',
  '11200': '성동구',
  '11215': '광진구',
  '11230': '동대문구',
  '11260': '중랑구',
  '11290': '성북구',
  '11305': '강북구',
  '11320': '도봉구',
  '11350': '노원구',
  '11380': '은평구',
  '11410': '서대문구',
  '11440': '마포구',
  '11470': '양천구',
  '11500': '강서구',
  '11530': '구로구',
  '11545': '금천구',
  '11560': '영등포구',
  '11590': '동작구',
  '11620': '관악구',
  '11650': '서초구',
  '11680': '강남구',
  '11710': '송파구',
  '11740': '강동구',
};
const datasetCode = 'SEOUL_DONG_BOUNDARY';
const etlVersion = 'boundary-v1';

// 기대 건수는 데이터 버전마다 다를 수 있으므로 호출자가 입력 파일에 맞게 지정합니다.
export type BoundaryOptions = {
  source: string;
  expectedDongs: number;
  expectedDistricts: number;
};

/**
 * 원본 경계를 검증한 뒤 자치구·행정동과 배치 성공 이력을 한 번에 반영합니다.
 * options는 CLI에서 검증한 입력 경로·버전별 기대 건수이며 결과로 상태와 처리 건수를 돌려줍니다.
 * loadSource는 기본 파일 판독기이고, DB 테스트에서는 메모리 원본을 주입해 같은 반영 경로를 검사합니다.
 */
export async function importBoundaries(
  pool: Pool,
  options: BoundaryOptions,
  loadSource: (path: string) => Promise<BoundarySource> = readBoundarySource,
) {
  assertLocalDatabaseUrl(pool.options.connectionString);
  const batchId = randomUUID();
  const client = await pool.connect();
  let started = false;
  let transaction = false;
  let released = false;
  let checksum: string | undefined;
  let fetchedRows = 0;
  let validRows = 0;
  let rejectedRows = 0;
  try {
    // 파일을 읽기 전, 반영 트랜잭션 밖에서 시작 이력을 남겨 파일 오류도 추적할 수 있게 합니다.
    await client.query(
      `INSERT INTO etl_batch
       (batch_id, dataset_code, source_type, scope_type, source_reference,
        etl_version, status, expected_rows, started_at)
       VALUES ($1, $2, 'SHAPEFILE', 'SEOUL', $3, $4, 'RUNNING', $5, now())`,
      [
        batchId,
        datasetCode,
        resolve(options.source),
        etlVersion,
        options.expectedDongs,
      ],
    );
    started = true;
    const source = await loadSource(options.source);
    checksum = source.checksum;
    fetchedRows = source.features.length;
    const rows = source.features.map((feature) => {
      // 행정동 이름으로 구를 추측하지 않고 코드 앞 5자리와 공식 코드표를 대응합니다.
      const districtCode = feature.dongCode.slice(0, 5);
      const districtName = districtNames[districtCode];
      if (!districtName) {
        rejectedRows += 1;
        throw new Error(
          `공식 서울 자치구 코드표에 없는 행정동: ${feature.dongCode}`,
        );
      }
      return {
        dong_code: feature.dongCode,
        dong_name: feature.dongName,
        district_code: districtCode,
        district_name: districtName,
        area_m2: feature.areaM2,
        geometry: feature.geometry,
      };
    });
    if (
      fetchedRows !== options.expectedDongs ||
      new Set(rows.map((row) => row.district_code)).size !==
        options.expectedDistricts
    )
      throw new Error(
        '입력 버전의 행정동·자치구 수가 CLI 검증 기준과 다릅니다.',
      );

    await client.query('BEGIN');
    transaction = true;
    // 같은 데이터셋의 동시 실행을 순서대로 처리하고, 다른 쓰기 작업과의 경합도 막습니다.
    // 두 잠금은 트랜잭션 종료 시 풀리며 일반 조회는 계속 허용합니다.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      datasetCode,
    ]);
    await client.query(
      'LOCK TABLE district, administrative_dong IN SHARE ROW EXCLUSIVE MODE',
    );
    // 검증 중인 값은 임시 테이블에만 둡니다. COMMIT 시 삭제되고 ROLLBACK 시 생성도 취소됩니다.
    await client.query(`CREATE TEMP TABLE boundary_stage (
      dong_code TEXT PRIMARY KEY, dong_name TEXT NOT NULL,
      district_code TEXT NOT NULL, district_name TEXT NOT NULL, area_m2 BIGINT NOT NULL,
      geom_source geometry(MultiPolygon,5181) NOT NULL,
      geom geometry(MultiPolygon,4326), label_point geometry(Point,4326)
    ) ON COMMIT DROP`);
    // 이미 검증한 5181 좌표임을 지정하고 Polygon을 MultiPolygon으로 감쌉니다.
    // ST_SetSRID는 좌표 변환이 아니며, 잘못된 도형을 자동 보정하지 않습니다.
    await client.query(
      `INSERT INTO boundary_stage
       (dong_code, dong_name, district_code, district_name, area_m2, geom_source)
       SELECT dong_code, dong_name, district_code, district_name, area_m2,
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(geometry),5181))
       FROM jsonb_to_recordset($1::jsonb) AS r(dong_code text, dong_name text,
         district_code text, district_name text, area_m2 bigint, geometry jsonb)`,
      [JSON.stringify(rows)],
    );
    // 원본 투영 좌표의 면적 단위는 ㎡입니다. 양의 실제 면적과 원본 RELM_AR 값을 각각 확인합니다.
    // 저장할 area_m2는 계산 면적으로 대체하지 않고 원본의 정수 값을 보존합니다.
    const invalidSource = await client.query<{
      dong_code: string;
      reason: string;
    }>(
      `SELECT dong_code, ST_IsValidReason(geom_source) AS reason FROM boundary_stage
       WHERE ST_IsEmpty(geom_source) OR NOT ST_IsValid(geom_source)
          OR ST_Area(geom_source) <= 0 OR area_m2 <= 0`,
    );
    if (invalidSource.rows.length) {
      rejectedRows = invalidSource.rows.length;
      validRows = fetchedRows - rejectedRows;
      throw new Error(
        `유효하지 않은 원본 도형: ${JSON.stringify(invalidSource.rows.slice(0, 10))}`,
      );
    }
    // 실제 좌표 변환은 여기서 수행합니다. 대표점도 저장할 4326 도형에서 생성합니다.
    await client.query(
      `UPDATE boundary_stage SET geom = ST_Transform(geom_source,4326)`,
    );
    // 단순 중심점은 오목한 도형이나 구멍 밖에 놓일 수 있어 내부를 보장하는 점을 사용합니다.
    await client.query(
      `UPDATE boundary_stage SET label_point = ST_PointOnSurface(geom)`,
    );
    // 서울 인근 범위는 단위·축 오류를 잡는 검사이며, 정밀한 서울 행정 경계 판정은 아닙니다.
    const invalidTransformed = await client.query<{ dong_code: string }>(
      `SELECT dong_code FROM boundary_stage WHERE ST_SRID(geom) <> 4326
       OR NOT ST_IsValid(geom) OR ST_IsEmpty(geom) OR NOT ST_Contains(geom,label_point)
       OR NOT ST_CoveredBy(geom,ST_MakeEnvelope(126.6,37.3,127.4,37.9,4326))`,
    );
    rejectedRows = invalidTransformed.rows.length;
    validRows = fetchedRows - rejectedRows;
    if (rejectedRows)
      throw new Error(
        `변환 도형·내부 대표점·서울 인근 좌표 범위 검증 실패: ${JSON.stringify(invalidTransformed.rows.slice(0, 10))}`,
      );

    // 실제 저장하는 4326 행정동 도형을 결합해 변환 순서에 따른 자치구 경계 차이를 피합니다.
    await client.query(`CREATE TEMP TABLE district_stage ON COMMIT DROP AS
      SELECT district_code, district_name,
        ST_Multi(ST_UnaryUnion(ST_Collect(geom))) AS geom
      FROM boundary_stage GROUP BY district_code, district_name`);
    const invalidDistricts = await client.query(
      `SELECT district_code FROM district_stage WHERE NOT ST_IsValid(geom)
       OR ST_IsEmpty(geom) OR GeometryType(geom) <> 'MULTIPOLYGON'
       OR ST_SRID(geom) <> 4326 OR ST_Area(geom::geography) <= 0`,
    );
    if (invalidDistricts.rows.length)
      throw new Error('자치구 경계 결합 결과가 유효하지 않습니다.');
    // 빠진 기존 코드를 지우거나 서로 다른 스냅샷을 섞지 않고, 입력 확인이 필요하다고 보고합니다.
    const missingExisting = await client.query(
      `SELECT dong_code AS code FROM administrative_dong a
       WHERE NOT EXISTS (SELECT 1 FROM boundary_stage s WHERE s.dong_code=a.dong_code)
       UNION ALL SELECT district_code FROM district d
       WHERE NOT EXISTS (SELECT 1 FROM district_stage s WHERE s.district_code=d.district_code)`,
    );
    if (missingExisting.rows.length)
      throw new Error(
        '원본에 없는 기존 행정구역 코드가 있습니다. 삭제 없이 반영할 수 없어 중단합니다.',
      );

    // 체크섬만 같다고 건너뛰면 DB의 수정·다른 출처를 놓칠 수 있어 실제 값과 배치 연결도 비교합니다.
    const previous = await client.query<{ batch_id: string }>(
      `SELECT batch_id FROM etl_batch WHERE dataset_code=$1 AND source_checksum=$2
       AND etl_version=$3 AND status='PUBLISHED' ORDER BY published_at DESC LIMIT 1`,
      [datasetCode, checksum, etlVersion],
    );
    let unchanged = false;
    if (previous.rows[0]) {
      const result = await client.query<{ unchanged: boolean }>(
        `SELECT NOT EXISTS (
          SELECT 1 FROM boundary_stage s LEFT JOIN administrative_dong a USING(dong_code)
          WHERE a.dong_code IS NULL OR a.dong_name IS DISTINCT FROM s.dong_name
           OR a.district_code IS DISTINCT FROM s.district_code OR a.area_m2 IS DISTINCT FROM s.area_m2
           OR a.boundary_batch_id IS DISTINCT FROM $1::uuid
           OR NOT ST_Equals(a.geom,s.geom) OR NOT ST_Equals(a.label_point,s.label_point)
        ) AND NOT EXISTS (
          SELECT 1 FROM district_stage s LEFT JOIN district d USING(district_code)
          WHERE d.district_code IS NULL OR d.district_name IS DISTINCT FROM s.district_name
           OR d.boundary_batch_id IS DISTINCT FROM $1::uuid OR NOT ST_Equals(d.geom,s.geom)
        ) AS unchanged`,
        [previous.rows[0].batch_id],
      );
      unchanged = result.rows[0]!.unchanged;
    }
    if (!unchanged) {
      // 자치구를 먼저 반영해 행정동 FK를 만족시킵니다. 기본키를 삭제하지 않아 기존 참조도 유지됩니다.
      await client.query(
        `INSERT INTO district (district_code,district_name,geom,boundary_batch_id)
         SELECT district_code,district_name,geom,$1 FROM district_stage
         ON CONFLICT (district_code) DO UPDATE SET district_name=EXCLUDED.district_name,
           geom=EXCLUDED.geom,boundary_batch_id=EXCLUDED.boundary_batch_id`,
        [batchId],
      );
      await client.query(
        `INSERT INTO administrative_dong
         (dong_code,district_code,dong_name,geom,label_point,area_m2,boundary_batch_id)
         SELECT dong_code,district_code,dong_name,geom,label_point,area_m2,$1 FROM boundary_stage
         ON CONFLICT (dong_code) DO UPDATE SET district_code=EXCLUDED.district_code,
           dong_name=EXCLUDED.dong_name,geom=EXCLUDED.geom,label_point=EXCLUDED.label_point,
           area_m2=EXCLUDED.area_m2,boundary_batch_id=EXCLUDED.boundary_batch_id`,
        [batchId],
      );
    }
    // SKIPPED이면 경계와 기존 출처를 유지하고 새 실행 이력만 남깁니다.
    // PUBLISHED 이력과 경계 변경은 같은 트랜잭션에서 확정합니다.
    const status = unchanged ? 'SKIPPED' : 'PUBLISHED';
    await client.query(
      `UPDATE etl_batch SET status=$2::varchar,source_checksum=$3,fetched_rows=$4,valid_rows=$5,
       rejected_rows=$6,finished_at=now(),published_at=CASE WHEN $2::varchar='PUBLISHED' THEN now() END
       WHERE batch_id=$1`,
      [batchId, status, checksum, fetchedRows, validRows, rejectedRows],
    );
    await client.query('COMMIT');
    transaction = false;
    return {
      batchId,
      status,
      fetchedRows,
      validRows,
      rejectedRows,
      districts: options.expectedDistricts,
    };
  } catch (error) {
    // 실패 이력을 기록하기 전에 데이터 반영을 되돌려 이전 정상 경계를 보존합니다.
    if (transaction) released = await rollbackOrDiscard(client);
    if (error instanceof BoundarySourceError) {
      // 파일 판독 중 중단된 경우 실제 확인한 건수만 전달하며 미검증 행을 유효로 세지 않습니다.
      fetchedRows = error.fetchedRows;
      validRows = error.validRows;
      rejectedRows = error.rejectedRows;
      checksum = error.checksum;
    }
    const message = safeMessage(error, pool.options.connectionString);
    if (started) {
      try {
        // ROLLBACK 후 별도로 저장하고, 이미 성공한 상태를 실패로 덮어쓰지 않도록 RUNNING만 갱신합니다.
        await (released ? pool : client).query(
          `UPDATE etl_batch SET status='FAILED',source_checksum=$2,fetched_rows=$3,
           valid_rows=$4,rejected_rows=$5,finished_at=now(),error_message=$6
           WHERE batch_id=$1 AND status='RUNNING'`,
          [
            batchId,
            checksum ?? null,
            fetchedRows,
            validRows,
            rejectedRows,
            message,
          ],
        );
      } catch {
        throw new Error(
          `배치 ${batchId}: 실패 이력을 기록하지 못했습니다. DB 상태를 확인하세요.`,
        );
      }
    }
    throw new Error(`배치 ${batchId}: ${message}`, { cause: error });
  } finally {
    if (!released) client.release();
  }
}
