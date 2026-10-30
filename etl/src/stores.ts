import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import {
  assertLocalDatabaseUrl,
  rollbackOrDiscard,
  safeMessage,
} from './database.js';
import {
  readStoreSource,
  StoreSourceError,
  type StoreSource,
  type StoreStatRow,
} from './store-source.js';

const datasetCode = 'SEOUL_DONG_STORE_STAT';
const etlVersion = 'store-stat-v1';

export type StoreOptions = { source: string; expectedRows: number };

/**
 * 검증한 점포 통계를 작은 묶음으로 스테이징하고, FK 확인 후 한 번에 공개합니다.
 * 원본에 없는 기존 키는 보존하며 측정값과 출처가 같은 재실행은 SKIPPED로 기록합니다.
 */
export async function importStoreStats(
  pool: Pool,
  options: StoreOptions,
  loadSource: (
    path: string,
    onRows: (rows: StoreStatRow[]) => Promise<void>,
  ) => Promise<StoreSource> = readStoreSource,
) {
  assertLocalDatabaseUrl(pool.options.connectionString);
  const batchId = randomUUID();
  const client = await pool.connect();
  let started = false;
  let transaction = false;
  let released = false;
  let checksum: string | undefined;
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  let fetchedRows = 0;
  let validRows = 0;
  let rejectedRows = 0;
  let stagedRows = 0;
  let reference = JSON.stringify({ path: resolve(options.source) });

  try {
    // 시작 이력은 반영 트랜잭션 밖에 확정해 파일·검증·DB 오류도 추적할 수 있게 합니다.
    await client.query(
      `INSERT INTO etl_batch
       (batch_id,dataset_code,source_type,scope_type,source_reference,etl_version,status,expected_rows,started_at)
       VALUES ($1,$2,'CSV','SEOUL',$3,$4,'RUNNING',$5,now())`,
      [batchId, datasetCode, reference, etlVersion, options.expectedRows],
    );
    started = true;
    const schema = await client.query<{ present: boolean }>(
      "SELECT to_regclass('dong_store_stat') IS NOT NULL AS present",
    );
    if (!schema.rows[0]!.present)
      throw new Error(
        'dong_store_stat이 없습니다. 기존 Flyway V3를 먼저 적용하세요.',
      );

    await client.query('BEGIN');
    transaction = true;
    await client.query(`CREATE TEMP TABLE store_stage (
      dong_code TEXT NOT NULL, industry_code TEXT NOT NULL, quarter_code TEXT NOT NULL,
      store_count BIGINT, general_store_count BIGINT, franchise_store_count BIGINT,
      opened_store_count BIGINT, closed_store_count BIGINT, opening_rate NUMERIC, closure_rate NUMERIC,
      source_record BIGINT NOT NULL, PRIMARY KEY (dong_code,industry_code,quarter_code)
    ) ON COMMIT DROP`);
    const source = await loadSource(options.source, async (rows) => {
      // JSON에도 수치를 문자열로 넣어 BIGINT·NUMERIC을 Number로 변환하지 않습니다.
      // 한 번에 최대 1000행만 전송하고 await해 빠른 파일 판독이 DB 쓰기를 앞질러 쌓이지 않게 합니다.
      for (let offset = 0; offset < rows.length; offset += 1000) {
        const chunk = rows.slice(offset, offset + 1000).map((row, index) => ({
          dong_code: row.dongCode,
          industry_code: row.industryCode,
          quarter_code: row.quarterCode,
          store_count: row.storeCount,
          general_store_count: row.generalStoreCount,
          franchise_store_count: row.franchiseStoreCount,
          opened_store_count: row.openedStoreCount,
          closed_store_count: row.closedStoreCount,
          opening_rate: row.openingRate,
          closure_rate: row.closureRate,
          source_record: stagedRows + index + 1,
        }));
        await client.query(
          `INSERT INTO store_stage SELECT * FROM jsonb_to_recordset($1::jsonb)
           AS r(dong_code text,industry_code text,quarter_code text,store_count bigint,
             general_store_count bigint,franchise_store_count bigint,opened_store_count bigint,
             closed_store_count bigint,opening_rate numeric,closure_rate numeric,source_record bigint)`,
          [JSON.stringify(chunk)],
        );
        stagedRows += chunk.length;
      }
    });
    ({ checksum, fetchedRows, validRows, rejectedRows, periodFrom, periodTo } =
      source);
    reference = JSON.stringify({
      path: source.path,
      ...(source.entry ? { entry: source.entry } : {}),
      encoding: source.encoding,
    });
    if (fetchedRows !== options.expectedRows)
      throw new Error(
        `원본 행 수가 --expected-rows와 다릅니다: 예상 ${options.expectedRows}, 실제 ${fetchedRows}`,
      );
    // 콜백에 전달한 건수가 아닌 DB의 실제 행 수를 확인해 누락·초과된 스테이징을 공개하지 않습니다.
    const staged = await client.query<{ staged_rows: string }>(
      'SELECT count(*) AS staged_rows FROM store_stage',
    );
    if (staged.rows[0]!.staged_rows !== String(validRows))
      throw new Error(
        `스테이징 행 수가 검증된 유효 행 수와 다릅니다: 유효 ${validRows}, 스테이징 ${staged.rows[0]!.staged_rows}`,
      );

    // 대량 판독 중에는 서비스 테이블을 잠그지 않습니다. 공개 직전에만 같은 데이터셋과
    // 대상 통계 쓰기를 직렬화하고, FK 기준 데이터의 동시 변경을 막아 검증 결과를 유지합니다.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      datasetCode,
    ]);
    await client.query(
      'LOCK TABLE dong_store_stat IN SHARE ROW EXCLUSIVE MODE',
    );
    await client.query(
      'LOCK TABLE administrative_dong, service_industry IN SHARE MODE',
    );
    const invalid = await client.query<{ rejected: string }>(
      `SELECT count(*) AS rejected FROM store_stage s
       LEFT JOIN administrative_dong a USING(dong_code)
       LEFT JOIN service_industry i USING(industry_code)
       WHERE a.dong_code IS NULL OR i.industry_code IS NULL`,
    );
    rejectedRows = Number(invalid.rows[0]!.rejected);
    validRows = fetchedRows - rejectedRows;
    if (rejectedRows) {
      // 한 행에서 두 FK가 모두 빠져도 거부 건수는 한 번만 셉니다. 원본 이름으로 코드를 추측하거나
      // 과거 행정동을 임의 치환하지 않고, 코드별 영향 행·분기·첫 데이터 레코드를 제시합니다.
      const dongs = await client.query(
        `SELECT s.dong_code AS code,count(*) AS rows,min(quarter_code) AS from_quarter,
         max(quarter_code) AS to_quarter,min(source_record) AS first_record
         FROM store_stage s LEFT JOIN administrative_dong a USING(dong_code)
         WHERE a.dong_code IS NULL GROUP BY s.dong_code ORDER BY count(*) DESC,s.dong_code LIMIT 10`,
      );
      const industries = await client.query(
        `SELECT s.industry_code AS code,count(*) AS rows,min(quarter_code) AS from_quarter,
         max(quarter_code) AS to_quarter,min(source_record) AS first_record
         FROM store_stage s LEFT JOIN service_industry i USING(industry_code)
         WHERE i.industry_code IS NULL GROUP BY s.industry_code ORDER BY count(*) DESC,s.industry_code LIMIT 10`,
      );
      throw new Error(
        `FK 불일치 ${rejectedRows}행: ${JSON.stringify({ dongs: dongs.rows, industries: industries.rows })}. 기준 데이터 적재 여부와 원본의 행정구역·업종 버전을 확인하세요.`,
      );
    }

    const previous = await client.query<{ batch_id: string }>(
      `SELECT batch_id FROM etl_batch WHERE dataset_code=$1 AND source_checksum=$2
       AND etl_version=$3 AND status='PUBLISHED' ORDER BY published_at DESC LIMIT 1`,
      [datasetCode, checksum, etlVersion],
    );
    let unchanged = false;
    if (previous.rows[0]) {
      // NULL과 0을 구분해 모든 측정값·출처를 비교합니다. 입력에 없는 기존 키는 비교·삭제하지 않습니다.
      const result = await client.query<{ unchanged: boolean }>(
        `SELECT NOT EXISTS (
          SELECT 1 FROM store_stage s LEFT JOIN dong_store_stat t USING(dong_code,industry_code,quarter_code)
          WHERE t.dong_code IS NULL OR
          ROW(t.store_count,t.general_store_count,t.franchise_store_count,t.opened_store_count,
              t.closed_store_count,t.opening_rate,t.closure_rate,t.source_batch_id)
          IS DISTINCT FROM
          ROW(s.store_count,s.general_store_count,s.franchise_store_count,s.opened_store_count,
              s.closed_store_count,s.opening_rate,s.closure_rate,$1::uuid)
        ) AS unchanged`,
        [previous.rows[0].batch_id],
      );
      unchanged = result.rows[0]!.unchanged;
    }
    if (!unchanged) {
      await client.query(
        `INSERT INTO dong_store_stat
         (dong_code,industry_code,quarter_code,store_count,general_store_count,franchise_store_count,
          opened_store_count,closed_store_count,opening_rate,closure_rate,source_batch_id)
         SELECT dong_code,industry_code,quarter_code,store_count,general_store_count,franchise_store_count,
          opened_store_count,closed_store_count,opening_rate,closure_rate,$1
         FROM store_stage ORDER BY dong_code,industry_code,quarter_code
         ON CONFLICT (dong_code,industry_code,quarter_code) DO UPDATE SET
          store_count=EXCLUDED.store_count,general_store_count=EXCLUDED.general_store_count,
          franchise_store_count=EXCLUDED.franchise_store_count,opened_store_count=EXCLUDED.opened_store_count,
          closed_store_count=EXCLUDED.closed_store_count,opening_rate=EXCLUDED.opening_rate,
          closure_rate=EXCLUDED.closure_rate,source_batch_id=EXCLUDED.source_batch_id`,
        [batchId],
      );
    }
    const status = unchanged ? 'SKIPPED' : 'PUBLISHED';
    await client.query(
      `UPDATE etl_batch SET status=$2::varchar,source_checksum=$3,fetched_rows=$4,valid_rows=$5,
       rejected_rows=$6,period_from=$7,period_to=$8,source_reference=$9,finished_at=now(),
       published_at=CASE WHEN $2::varchar='PUBLISHED' THEN now() END WHERE batch_id=$1`,
      [
        batchId,
        status,
        checksum,
        fetchedRows,
        validRows,
        rejectedRows,
        periodFrom,
        periodTo,
        reference,
      ],
    );
    await client.query('COMMIT');
    transaction = false;
    return {
      batchId,
      status,
      fetchedRows,
      validRows,
      rejectedRows,
      periodFrom,
      periodTo,
    };
  } catch (error) {
    // 스테이징과 일부 성공한 Upsert를 함께 롤백해 이전 정상 데이터와 출처를 보존합니다.
    if (transaction) released = await rollbackOrDiscard(client);
    if (error instanceof StoreSourceError) {
      ({
        checksum,
        fetchedRows,
        validRows,
        rejectedRows,
        periodFrom,
        periodTo,
      } = error);
    }
    const message = safeMessage(error, pool.options.connectionString);
    if (started) {
      try {
        await (released ? pool : client).query(
          `UPDATE etl_batch SET status='FAILED',source_checksum=$2,fetched_rows=$3,valid_rows=$4,
           rejected_rows=$5,period_from=$6,period_to=$7,source_reference=$8,finished_at=now(),error_message=$9
           WHERE batch_id=$1 AND status='RUNNING'`,
          [
            batchId,
            checksum ?? null,
            fetchedRows,
            validRows,
            rejectedRows,
            periodFrom ?? null,
            periodTo ?? null,
            reference,
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
