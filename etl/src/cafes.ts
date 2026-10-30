import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  assertLocalDatabaseUrl,
  rollbackOrDiscard,
  safeMessage,
} from './database.js';
import {
  CafeSourceError,
  readCafeSource,
  type CafeOptions,
  type CafeRow,
  type CafeSource,
} from './cafe-source.js';

export type { CafeOptions } from './cafe-source.js';

const datasetCode = 'SEMAS_CAFE_STORE';
const etlVersion = 'cafe-store-v1';

/** 인증키의 원문·URL 인코딩 표현을 이력과 오류 문자열에서 함께 가립니다. */
function redactApiKey(value: string): string {
  const key = process.env.SEMAS_API_KEY;
  if (!key) return value;
  const variants = new Set([key, encodeURIComponent(key)]);
  try {
    variants.add(decodeURIComponent(key));
  } catch {
    /* 잘못된 인코딩도 원문은 제거합니다. */
  }
  for (const variant of variants) {
    if (variant)
      value = value
        .replaceAll(variant, '[API_KEY]')
        .replaceAll(JSON.stringify(variant).slice(1, -1), '[API_KEY]');
  }
  return value;
}
const columns = [
  'bizes_id',
  'store_name',
  'branch_name',
  'semas_industry_code',
  'semas_industry_name',
  'ksic_code',
  'ksic_name',
  'source_dong_code',
  'dong_code',
  'road_address',
  'lot_address',
  'geom',
];

/**
 * 서울 전체를 검증한 API 원본만 한 번에 게시합니다. 과거 업소를 삭제하지 않으며,
 * 최신 전체 배치와 현재 DB 값·출처까지 같을 때만 기존 출처를 유지하고 SKIPPED 처리합니다.
 */
export async function importCafes(
  pool: Pool,
  options: CafeOptions,
  loadSource: (
    options: CafeOptions,
    onRows: (rows: CafeRow[]) => Promise<void>,
  ) => Promise<CafeSource> = readCafeSource,
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
  let reference: Record<string, unknown> = {
    collection_mode: 'FULL_SEOUL',
    complete: false,
  };
  try {
    // API 실패도 남도록 RUNNING은 데이터 반영 트랜잭션 밖에 확정합니다.
    await client.query(
      `INSERT INTO etl_batch
      (batch_id,dataset_code,source_type,scope_type,source_reference,etl_version,status,expected_rows,started_at)
      VALUES ($1,$2,'API','SEOUL',$3,$4,'RUNNING',$5,now())`,
      [
        batchId,
        datasetCode,
        redactApiKey(JSON.stringify(reference)),
        etlVersion,
        options.expectedRows ?? null,
      ],
    );
    started = true;
    const schema = await client.query<{ present: boolean }>(
      "SELECT to_regclass('cafe_store') IS NOT NULL AS present",
    );
    if (!schema.rows[0]!.present)
      throw new Error(
        'cafe_store가 없습니다. 기존 Flyway V4를 먼저 적용하세요.',
      );
    await client.query('BEGIN');
    transaction = true;
    await client.query(`CREATE TEMP TABLE cafe_stage (
      bizes_id TEXT PRIMARY KEY,store_name TEXT NOT NULL,branch_name TEXT,
      semas_industry_code TEXT NOT NULL,semas_industry_name TEXT NOT NULL,ksic_code TEXT,ksic_name TEXT,
      source_dong_code TEXT,source_district_code TEXT NOT NULL,dong_code TEXT,road_address TEXT,lot_address TEXT,geom geometry(Point,4326)
    ) ON COMMIT DROP`);
    const source = await loadSource(options, async (rows) => {
      // 페이지 크기와 무관하게 DB에는 1,000행씩 보내고 완료를 기다립니다.
      for (let offset = 0; offset < rows.length; offset += 1000) {
        const chunk = rows.slice(offset, offset + 1000).map((row) => ({
          bizes_id: row.bizesId,
          store_name: row.storeName,
          branch_name: row.branchName,
          semas_industry_code: row.semasIndustryCode,
          semas_industry_name: row.semasIndustryName,
          ksic_code: row.ksicCode,
          ksic_name: row.ksicName,
          source_dong_code: row.sourceDongCode,
          source_district_code: row.sourceDistrictCode,
          road_address: row.roadAddress,
          lot_address: row.lotAddress,
          longitude: row.longitude,
          latitude: row.latitude,
        }));
        await client.query(
          `INSERT INTO cafe_stage
          SELECT bizes_id,store_name,branch_name,semas_industry_code,semas_industry_name,ksic_code,ksic_name,
          source_dong_code,source_district_code,NULL,road_address,lot_address,
          CASE WHEN longitude IS NULL AND latitude IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint(longitude,latitude),4326) END
          FROM jsonb_to_recordset($1::jsonb) AS r(bizes_id text,store_name text,branch_name text,
          semas_industry_code text,semas_industry_name text,ksic_code text,ksic_name text,source_dong_code text,source_district_code text,
          road_address text,lot_address text,longitude double precision,latitude double precision)`,
          [JSON.stringify(chunk)],
        );
      }
    });
    ({ checksum, fetchedRows, validRows, rejectedRows, reference } = source);
    if (
      reference.collection_mode !== 'FULL_SEOUL' ||
      reference.complete !== true ||
      reference.classification_verified !== true
    )
      throw new Error(
        '공식 카페 분류와 서울 전체 수집 검증을 완료한 원본만 게시할 수 있습니다.',
      );
    if (
      !Number.isSafeInteger(fetchedRows) ||
      fetchedRows <= 0 ||
      validRows !== fetchedRows ||
      rejectedRows !== 0
    )
      throw new Error('수집·유효·거부 건수가 완전 수집 조건과 다릅니다.');
    if (
      options.expectedRows !== undefined &&
      fetchedRows !== options.expectedRows
    )
      throw new Error(
        `원본 행 수가 --expected-rows와 다릅니다: 예상 ${options.expectedRows}, 실제 ${fetchedRows}`,
      );
    const staged = await client.query<{ count: string }>(
      'SELECT count(*) FROM cafe_stage',
    );
    if (staged.rows[0]!.count !== String(validRows))
      throw new Error(
        `스테이징 행 수가 검증된 유효 행 수와 다릅니다: 유효 ${validRows}, 스테이징 ${staged.rows[0]!.count}`,
      );

    // 네트워크 수집 중에는 서비스 테이블을 잠그지 않고, 공개 직전에만 쓰기와 기준 경계 변경을 막습니다.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      datasetCode,
    ]);
    await client.query('LOCK TABLE cafe_store IN SHARE ROW EXCLUSIVE MODE');
    await client.query(
      'LOCK TABLE administrative_dong, district IN SHARE MODE',
    );
    const boundaries = await client.query<{ present: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM district WHERE district_code LIKE '11%') AS present",
    );
    if (!boundaries.rows[0]!.present)
      throw new Error(
        '서울 자치구 경계가 없습니다. 경계 ETL을 먼저 실행하세요.',
      );
    // 서울 접두사만으로 실재 코드를 확정하지 않습니다. 좌표·행정동이 없어도 원본 시군구는
    // 현재 서울 district와 대조하며, 이 검증은 SKIPPED 판단보다 먼저 수행합니다.
    const invalidDistricts = await client.query<{
      code: string;
      rows: string;
      rejected_rows: string;
    }>(
      `SELECT s.source_district_code AS code,count(*) AS rows,sum(count(*)) OVER () AS rejected_rows
       FROM cafe_stage s LEFT JOIN district d ON d.district_code=s.source_district_code
       WHERE d.district_code IS NULL OR d.district_code !~ '^11[0-9]{3}$'
       GROUP BY s.source_district_code ORDER BY count(*) DESC,s.source_district_code LIMIT 10`,
    );
    if (invalidDistricts.rows[0]) {
      rejectedRows = Number(invalidDistricts.rows[0].rejected_rows);
      validRows = fetchedRows - rejectedRows;
      reference = { ...reference, invalid_district_rows: rejectedRows };
      throw new Error(
        `서울 시군구 코드 불일치 ${rejectedRows}행: ${JSON.stringify(invalidDistricts.rows.map(({ code, rows }) => ({ code, rows })))}. 원본 signguCd와 district 기준 데이터를 확인하세요.`,
      );
    }
    // 원문을 자르거나 위치로 코드를 추측하지 않습니다. 현재 기준 코드와 정확히 같은 8자리만 연결합니다.
    await client.query(`UPDATE cafe_stage s SET dong_code=a.dong_code FROM administrative_dong a
      WHERE s.source_dong_code ~ '^[0-9]{8}$' AND s.source_dong_code=a.dong_code AND a.district_code=s.source_district_code`);
    const quality = (
      await client.query<{
        outside_rows: string;
        spatial_mismatch_rows: string;
        missing_coordinate_rows: string;
        unlinked_dong_rows: string;
      }>(
        `SELECT count(*) FILTER (WHERE s.geom IS NOT NULL AND
         (ST_IsEmpty(s.geom) OR NOT ST_IsValid(s.geom) OR NOT EXISTS (
          SELECT 1 FROM district d WHERE d.district_code LIKE '11%' AND ST_Covers(d.geom,s.geom)))) AS outside_rows,
       count(*) FILTER (WHERE s.geom IS NOT NULL AND a.dong_code IS NOT NULL AND NOT ST_Covers(a.geom,s.geom)) AS spatial_mismatch_rows,
       count(*) FILTER (WHERE s.geom IS NULL) AS missing_coordinate_rows,
       count(*) FILTER (WHERE s.dong_code IS NULL) AS unlinked_dong_rows
       FROM cafe_stage s LEFT JOIN administrative_dong a USING(dong_code)`,
      )
    ).rows[0]!;
    reference = {
      ...reference,
      spatial_mismatch_rows: Number(quality.spatial_mismatch_rows),
      missing_coordinate_rows: Number(quality.missing_coordinate_rows),
      unlinked_dong_rows: Number(quality.unlinked_dong_rows),
    };
    if (quality.outside_rows !== '0') {
      rejectedRows = Number(quality.outside_rows);
      validRows = fetchedRows - rejectedRows;
      throw new Error(
        `서울 경계 밖이거나 유효하지 않은 좌표 ${rejectedRows}행: 원본 좌표와 경계 버전을 확인하세요.`,
      );
    }

    // 과거 동일 체크섬을 찾지 않습니다. 더 최신의 전체 수집 뒤 예전 원본이 돌아오면 새 배치가 필요합니다.
    const previous = (
      await client.query<{
        batch_id: string;
        source_checksum: string;
        etl_version: string;
      }>(
        `SELECT batch_id,source_checksum,etl_version FROM etl_batch
       WHERE dataset_code=$1 AND source_type='API' AND scope_type='SEOUL' AND scope_code IS NULL
       AND status='PUBLISHED' AND source_reference::jsonb @> '{"collection_mode":"FULL_SEOUL","complete":true,"classification_verified":true}'
       ORDER BY published_at DESC,started_at DESC,batch_id DESC LIMIT 1`,
        [datasetCode],
      )
    ).rows[0];
    let unchanged = false;
    if (
      previous?.source_checksum === checksum &&
      previous.etl_version === etlVersion
    ) {
      const comparison = await client.query<{ unchanged: boolean }>(
        `SELECT NOT EXISTS (
        SELECT 1 FROM cafe_stage s LEFT JOIN cafe_store t USING(bizes_id)
        WHERE t.bizes_id IS NULL OR ROW(${columns.map((c) => `t.${c}`).join(',')},t.source_batch_id)
          IS DISTINCT FROM ROW(${columns.map((c) => `s.${c}`).join(',')},$1::uuid)
      ) AND NOT EXISTS (
        SELECT 1 FROM cafe_store t WHERE t.source_batch_id=$1 AND NOT EXISTS (SELECT 1 FROM cafe_stage s WHERE s.bizes_id=t.bizes_id)
      ) AS unchanged`,
        [previous.batch_id],
      );
      unchanged = comparison.rows[0]!.unchanged;
    }
    if (!unchanged) {
      await client.query(
        `INSERT INTO cafe_store (${columns.join(',')},source_batch_id)
        SELECT ${columns.join(',')},$1 FROM cafe_stage ORDER BY bizes_id
        ON CONFLICT (bizes_id) DO UPDATE SET
        ${columns
          .filter((c) => c !== 'bizes_id')
          .map((c) => `${c}=EXCLUDED.${c}`)
          .join(',')},source_batch_id=EXCLUDED.source_batch_id`,
        [batchId],
      );
    }
    const status = unchanged ? 'SKIPPED' : 'PUBLISHED';
    await client.query(
      `UPDATE etl_batch SET status=$2::varchar,source_checksum=$3,fetched_rows=$4,valid_rows=$5,
      rejected_rows=$6,source_reference=$7,finished_at=now(),published_at=CASE WHEN $2::varchar='PUBLISHED' THEN clock_timestamp() END
      WHERE batch_id=$1`,
      [
        batchId,
        status,
        checksum,
        fetchedRows,
        validRows,
        rejectedRows,
        redactApiKey(JSON.stringify(reference)),
      ],
    );
    await client.query('COMMIT');
    transaction = false;
    return { batchId, status, fetchedRows, validRows, rejectedRows };
  } catch (error) {
    if (transaction) released = await rollbackOrDiscard(client);
    if (error instanceof CafeSourceError) {
      ({ checksum, fetchedRows, validRows, rejectedRows, reference } = error);
    }
    // API 키는 URL뿐 아니라 DB 오류에 포함된 원본 값에 우연히 나타나도 이력·CLI에서 제거합니다.
    const message = redactApiKey(
      safeMessage(error, pool.options.connectionString),
    );
    reference = { ...reference, complete: false };
    if (started) {
      try {
        await (released ? pool : client).query(
          `UPDATE etl_batch SET status='FAILED',source_checksum=$2,fetched_rows=$3,
          valid_rows=$4,rejected_rows=$5,source_reference=$6,finished_at=now(),error_message=$7
          WHERE batch_id=$1 AND status='RUNNING'`,
          [
            batchId,
            checksum ?? null,
            fetchedRows,
            validRows,
            rejectedRows,
            redactApiKey(JSON.stringify(reference)),
            message,
          ],
        );
      } catch {
        throw new Error(
          `배치 ${batchId}: 실패 이력을 기록하지 못했습니다. DB 상태를 확인하세요.`,
        );
      }
    }
    // 원본 예외의 detail·cause·stack에는 인증정보가 있을 수 있으므로 안전한 원인으로 교체합니다.
    const failure = new Error(`배치 ${batchId}: ${message}`, {
      cause: new Error(message),
    });
    throw failure;
  } finally {
    if (!released) client.release();
  }
}
