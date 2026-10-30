import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import {
  assertLocalDatabaseUrl,
  rollbackOrDiscard,
  safeMessage,
} from './database.js';
import {
  IndustrySourceError,
  readIndustrySource,
  type IndustryInput,
  type IndustrySource,
} from './industry-source.js';

const datasetCode = 'SEOUL_SERVICE_INDUSTRY';
const etlVersion = 'industry-v1';

export type IndustryOptions = IndustryInput & { expectedIndustries: number };

/**
 * 점포·선택 매출 원본에서 검증한 고유 업종을 반영하고 원본 행 수를 배치 이력에 남깁니다.
 * 원본에 없는 기존 업종은 통계 FK와 이전 출처를 보존하며 삭제하지 않습니다.
 */
export async function importIndustries(
  pool: Pool,
  options: IndustryOptions,
  loadSource: (
    input: IndustryInput,
  ) => Promise<IndustrySource> = readIndustrySource,
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
  const reference = {
    stores: resolve(options.source),
    ...(options.salesSource ? { sales: resolve(options.salesSource) } : {}),
    expectedIndustries: options.expectedIndustries,
  };

  try {
    // 고유 업종 수를 expected_rows에 넣지 않습니다. 이 컬럼과 처리 건수는 원본 행 단위입니다.
    // 시작 이력을 먼저 확정해야 파일 누락·파싱 오류도 FAILED로 기록할 수 있습니다.
    await client.query(
      `INSERT INTO etl_batch
       (batch_id,dataset_code,source_type,scope_type,source_reference,etl_version,status,started_at)
       VALUES ($1,$2,'CSV','SEOUL',$3,$4,'RUNNING',now())`,
      [batchId, datasetCode, JSON.stringify(reference), etlVersion],
    );
    started = true;
    const source = await loadSource(options);
    checksum = source.checksum;
    ({ fetchedRows, validRows, rejectedRows } = source);
    // 원본별 인코딩·행 수·고유 업종 수도 출처와 함께 보관합니다. 파일 경로는 체크섬에 포함하지 않습니다.
    await client.query(
      'UPDATE etl_batch SET source_reference=$2 WHERE batch_id=$1',
      [batchId, JSON.stringify({ ...reference, sources: source.sources })],
    );
    if (source.industries.length !== options.expectedIndustries) {
      throw new Error(
        `고유 업종 수가 입력 버전의 검증 기준과 다릅니다: 예상 ${options.expectedIndustries}, 실제 ${source.industries.length}`,
      );
    }

    await client.query('BEGIN');
    transaction = true;
    // 같은 데이터셋은 순서대로 반영하고, 다른 업종 쓰기와도 충돌하지 않게 합니다. 조회는 허용합니다.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      datasetCode,
    ]);
    await client.query(
      'LOCK TABLE service_industry IN SHARE ROW EXCLUSIVE MODE',
    );
    await client.query(`CREATE TEMP TABLE industry_stage (
      industry_code TEXT PRIMARY KEY, industry_name TEXT NOT NULL
    ) ON COMMIT DROP`);
    await client.query(
      `INSERT INTO industry_stage
       SELECT industry_code,industry_name FROM jsonb_to_recordset($1::jsonb)
       AS r(industry_code text,industry_name text)`,
      [
        JSON.stringify(
          source.industries.map((industry) => ({
            industry_code: industry.industryCode,
            industry_name: industry.industryName,
          })),
        ),
      ],
    );

    const previous = await client.query<{ batch_id: string }>(
      `SELECT batch_id FROM etl_batch WHERE dataset_code=$1 AND source_checksum=$2
       AND etl_version=$3 AND status='PUBLISHED' ORDER BY published_at DESC LIMIT 1`,
      [datasetCode, checksum, etlVersion],
    );
    let unchanged = false;
    if (previous.rows[0]) {
      // 원본 체크섬이 같아도 DB 이름이나 출처가 바뀌었다면 다시 반영합니다.
      // 이번 원본에 없는 기존 업종은 유지하므로 비교 범위도 입력 업종으로 한정합니다.
      const result = await client.query<{ unchanged: boolean }>(
        `SELECT NOT EXISTS (
          SELECT 1 FROM industry_stage s LEFT JOIN service_industry i USING(industry_code)
          WHERE i.industry_code IS NULL OR i.industry_name IS DISTINCT FROM s.industry_name
          OR i.source_batch_id IS DISTINCT FROM $1::uuid
        ) AS unchanged`,
        [previous.rows[0].batch_id],
      );
      unchanged = result.rows[0]!.unchanged;
    }
    if (!unchanged) {
      // 기본키를 지우지 않는 upsert로 통계 테이블의 FK와 입력에 없는 과거 업종을 보존합니다.
      await client.query(
        `INSERT INTO service_industry (industry_code,industry_name,source_batch_id)
         SELECT industry_code,industry_name,$1 FROM industry_stage ORDER BY industry_code
         ON CONFLICT (industry_code) DO UPDATE SET industry_name=EXCLUDED.industry_name,
         source_batch_id=EXCLUDED.source_batch_id`,
        [batchId],
      );
    }
    const status = unchanged ? 'SKIPPED' : 'PUBLISHED';
    await client.query(
      `UPDATE etl_batch SET status=$2::varchar,source_checksum=$3,fetched_rows=$4,
       valid_rows=$5,rejected_rows=$6,finished_at=now(),
       published_at=CASE WHEN $2::varchar='PUBLISHED' THEN now() END WHERE batch_id=$1`,
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
      industries: source.industries.length,
      sources: source.sources,
    };
  } catch (error) {
    // 성공 이력과 업종 변경을 함께 되돌린 뒤 실패 이력만 별도 트랜잭션으로 확정합니다.
    if (transaction) released = await rollbackOrDiscard(client);
    if (error instanceof IndustrySourceError) {
      ({ fetchedRows, validRows, rejectedRows, checksum } = error);
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
