import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
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

export type BoundaryOptions = {
  source: string;
  expectedDongs: number;
  expectedDistricts: number;
};

export function assertLocalDatabaseUrl(value: string | undefined): void {
  if (!value) throw new Error('DATABASE_URL이 필요합니다.');
  const url = new URL(value);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    [...url.searchParams.keys()].some((key) =>
      ['host', 'hostaddr', 'service', 'servicefile'].includes(
        key.toLowerCase(),
      ),
    )
  )
    throw new Error(
      '경계 적재는 loopback 주소의 로컬 개발 DB에서만 허용합니다.',
    );
}

function safeMessage(error: unknown, connectionString?: string): string {
  let message = error instanceof Error ? error.message : '알 수 없는 적재 오류';
  if (connectionString) {
    const password = new URL(connectionString).password;
    message = message.replaceAll(connectionString, '[DATABASE_URL]');
    if (password) {
      message = message.replaceAll(password, '[password]');
      message = message.replaceAll(decodeURIComponent(password), '[password]');
    }
  }
  return message.slice(0, 4000);
}

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
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      datasetCode,
    ]);
    await client.query(
      'LOCK TABLE district, administrative_dong IN SHARE ROW EXCLUSIVE MODE',
    );
    await client.query(`CREATE TEMP TABLE boundary_stage (
      dong_code TEXT PRIMARY KEY, dong_name TEXT NOT NULL,
      district_code TEXT NOT NULL, district_name TEXT NOT NULL, area_m2 BIGINT NOT NULL,
      geom_source geometry(MultiPolygon,5181) NOT NULL,
      geom geometry(MultiPolygon,4326), label_point geometry(Point,4326)
    ) ON COMMIT DROP`);
    await client.query(
      `INSERT INTO boundary_stage
       (dong_code, dong_name, district_code, district_name, area_m2, geom_source)
       SELECT dong_code, dong_name, district_code, district_name, area_m2,
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(geometry),5181))
       FROM jsonb_to_recordset($1::jsonb) AS r(dong_code text, dong_name text,
         district_code text, district_name text, area_m2 bigint, geometry jsonb)`,
      [JSON.stringify(rows)],
    );
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
    await client.query(
      `UPDATE boundary_stage SET geom = ST_Transform(geom_source,4326)`,
    );
    await client.query(
      `UPDATE boundary_stage SET label_point = ST_PointOnSurface(geom)`,
    );
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
    if (transaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        client.release(true);
        released = true;
      }
    }
    if (error instanceof BoundarySourceError) {
      fetchedRows = error.fetchedRows;
      validRows = error.validRows;
      rejectedRows = error.rejectedRows;
      checksum = error.checksum;
    }
    const message = safeMessage(error, pool.options.connectionString);
    if (started) {
      try {
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
