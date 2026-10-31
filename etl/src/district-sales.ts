import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import {
  assertLocalDatabaseUrl,
  rollbackOrDiscard,
  safeMessage,
} from './database.js';
import {
  readDistrictSalesSource,
  DistrictSalesSourceError,
  type DistrictSalesSource,
  type DistrictSalesStatRow,
} from './district-sales-source.js';

const datasetCode = 'SEOUL_DISTRICT_SALES_STAT';
const etlVersion = 'district-sales-stat-v1';

export type DistrictSalesOptions = { source: string; expectedRows: number };

/**
 * 검증한 추정매출 통계를 작은 묶음으로 스테이징하고, FK 확인 후 한 번에 공개합니다.
 * 원본에 없는 기존 키는 보존하며 측정값과 출처가 같은 재실행은 SKIPPED로 기록합니다.
 */
export async function importDistrictSalesStats(
  pool: Pool,
  options: DistrictSalesOptions,
  loadSource: (
    path: string,
    onRows: (rows: DistrictSalesStatRow[]) => Promise<void>,
  ) => Promise<DistrictSalesSource> = readDistrictSalesSource,
) {
  if (!Number.isSafeInteger(options.expectedRows) || options.expectedRows <= 0)
    throw new Error('예상 행 수는 양의 안전한 정수여야 합니다.');
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
  let reference = JSON.stringify({
    datasetId: 'OA-22176',
    serviceName: 'VwsmSignguSelngW',
    path: resolve(options.source),
  });

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
      "SELECT to_regclass('district_sales_stat') IS NOT NULL AS present",
    );
    if (!schema.rows[0]!.present)
      throw new Error(
        'district_sales_stat이 없습니다. Flyway V6를 먼저 적용하세요.',
      );

    await client.query('BEGIN');
    transaction = true;
    await client.query(`CREATE TEMP TABLE district_sales_stage (
      district_code TEXT NOT NULL, industry_code TEXT NOT NULL, quarter_code TEXT NOT NULL,
      monthly_sales_amount BIGINT, monthly_sales_count BIGINT,
      weekday_sales_amount BIGINT, weekend_sales_amount BIGINT,
      source_record BIGINT NOT NULL, PRIMARY KEY (district_code,industry_code,quarter_code)
    ) ON COMMIT DROP`);
    const source = await loadSource(options.source, async (rows) => {
      // JSON에도 수치를 문자열로 넣어 BIGINT·NUMERIC을 Number로 변환하지 않습니다.
      // 한 번에 최대 1000행만 전송하고 await해 빠른 파일 판독이 DB 쓰기를 앞질러 쌓이지 않게 합니다.
      for (let offset = 0; offset < rows.length; offset += 1000) {
        const chunk = rows.slice(offset, offset + 1000).map((row, index) => ({
          district_code: row.districtCode,
          industry_code: row.industryCode,
          quarter_code: row.quarterCode,
          monthly_sales_amount: row.monthlySalesAmount,
          monthly_sales_count: row.monthlySalesCount,
          weekday_sales_amount: row.weekdaySalesAmount,
          weekend_sales_amount: row.weekendSalesAmount,
          source_record: stagedRows + index + 1,
        }));
        await client.query(
          `INSERT INTO district_sales_stage SELECT * FROM jsonb_to_recordset($1::jsonb)
           AS r(district_code text,industry_code text,quarter_code text,monthly_sales_amount bigint,
             monthly_sales_count bigint,weekday_sales_amount bigint,weekend_sales_amount bigint,source_record bigint)`,
          [JSON.stringify(chunk)],
        );
        stagedRows += chunk.length;
      }
    });
    ({ checksum, fetchedRows, validRows, rejectedRows, periodFrom, periodTo } =
      source);
    reference = JSON.stringify({
      datasetId: 'OA-22176',
      serviceName: 'VwsmSignguSelngW',
      path: source.path,
      ...(source.entry ? { entry: source.entry } : {}),
      encoding: source.encoding,
    });
    if (
      rejectedRows !== 0 ||
      validRows !== fetchedRows ||
      fetchedRows !== options.expectedRows
    )
      throw new Error(
        `원본 행 수가 --expected-rows와 다릅니다: 예상 ${options.expectedRows}, 실제 ${fetchedRows}`,
      );
    // 콜백에 전달한 건수가 아닌 DB의 실제 행 수를 확인해 누락·초과된 스테이징을 공개하지 않습니다.
    const staged = await client.query<{ staged_rows: string }>(
      'SELECT count(*) AS staged_rows FROM district_sales_stage',
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
      'LOCK TABLE district_sales_stat IN SHARE ROW EXCLUSIVE MODE',
    );
    await client.query('LOCK TABLE district, service_industry IN SHARE MODE');
    const invalid = await client.query<{ rejected: string }>(
      `SELECT count(*) AS rejected FROM district_sales_stage s
       LEFT JOIN district a USING(district_code)
       LEFT JOIN service_industry i USING(industry_code)
       WHERE a.district_code IS NULL OR i.industry_code IS NULL`,
    );
    rejectedRows = Number(invalid.rows[0]!.rejected);
    validRows = fetchedRows - rejectedRows;
    if (rejectedRows) {
      // 한 행에서 두 FK가 모두 빠져도 거부 건수는 한 번만 셉니다. 원본 이름으로 코드를 추측하거나
      // 과거 자치구을 임의 치환하지 않고, 코드별 영향 행·분기·첫 데이터 레코드를 제시합니다.
      const districts = await client.query(
        `SELECT s.district_code AS code,count(*) AS rows,min(quarter_code) AS from_quarter,
         max(quarter_code) AS to_quarter,min(source_record) AS first_record
         FROM district_sales_stage s LEFT JOIN district a USING(district_code)
         WHERE a.district_code IS NULL GROUP BY s.district_code ORDER BY count(*) DESC,s.district_code LIMIT 10`,
      );
      const industries = await client.query(
        `SELECT s.industry_code AS code,count(*) AS rows,min(quarter_code) AS from_quarter,
         max(quarter_code) AS to_quarter,min(source_record) AS first_record
         FROM district_sales_stage s LEFT JOIN service_industry i USING(industry_code)
         WHERE i.industry_code IS NULL GROUP BY s.industry_code ORDER BY count(*) DESC,s.industry_code LIMIT 10`,
      );
      throw new Error(
        `FK 불일치 ${rejectedRows}행: ${JSON.stringify({ districts: districts.rows, industries: industries.rows })}. 기준 데이터 적재 여부와 원본의 행정구역·업종 버전을 확인하세요.`,
      );
    }

    const previous = await client.query<{ batch_id: string }>(
      `SELECT batch_id FROM etl_batch WHERE dataset_code=$1 AND source_checksum=$2
       AND etl_version=$3 AND source_type='CSV' AND scope_type='SEOUL' AND scope_code IS NULL
       AND status='PUBLISHED' AND published_at IS NOT NULL ORDER BY published_at DESC,batch_id DESC LIMIT 1`,
      [datasetCode, checksum, etlVersion],
    );
    let unchanged = false;
    if (previous.rows[0]) {
      // NULL과 0을 구분해 모든 측정값·출처를 비교합니다. 입력에 없는 기존 키는 비교·삭제하지 않습니다.
      const result = await client.query<{ unchanged: boolean }>(
        `SELECT NOT EXISTS (
          SELECT 1 FROM district_sales_stage s LEFT JOIN district_sales_stat t USING(district_code,industry_code,quarter_code)
          WHERE t.district_code IS NULL OR
          ROW(t.monthly_sales_amount,t.monthly_sales_count,t.weekday_sales_amount,t.weekend_sales_amount,t.source_batch_id)
          IS DISTINCT FROM
          ROW(s.monthly_sales_amount,s.monthly_sales_count,s.weekday_sales_amount,s.weekend_sales_amount,$1::uuid)
        ) AS unchanged`,
        [previous.rows[0].batch_id],
      );
      unchanged = result.rows[0]!.unchanged;
    }
    if (!unchanged) {
      await client.query(
        `INSERT INTO district_sales_stat
         (district_code,industry_code,quarter_code,monthly_sales_amount,monthly_sales_count,
          weekday_sales_amount,weekend_sales_amount,source_batch_id)
         SELECT district_code,industry_code,quarter_code,monthly_sales_amount,monthly_sales_count,
          weekday_sales_amount,weekend_sales_amount,$1
         FROM district_sales_stage ORDER BY district_code,industry_code,quarter_code
         ON CONFLICT (district_code,industry_code,quarter_code) DO UPDATE SET
          monthly_sales_amount=EXCLUDED.monthly_sales_amount,monthly_sales_count=EXCLUDED.monthly_sales_count,
          weekday_sales_amount=EXCLUDED.weekday_sales_amount,weekend_sales_amount=EXCLUDED.weekend_sales_amount,
          source_batch_id=EXCLUDED.source_batch_id`,
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
    if (error instanceof DistrictSalesSourceError) {
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
