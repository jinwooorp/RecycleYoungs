import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import {
  assertLocalDatabaseUrl,
  rollbackOrDiscard,
  safeMessage,
} from './database.js';
import {
  readFootTrafficSource,
  FootTrafficSourceError,
  type FootTrafficSource,
  type FootTrafficStatRow,
} from './foot-traffic-source.js';

const datasetCode = 'SEOUL_DONG_FOOT_TRAFFIC_STAT';
const etlVersion = 'foot-traffic-stat-v1';

export type FootTrafficOptions = { source: string; expectedRows: number };

/**
 * 행정동·분기별 유동인구를 검증·스테이징한 뒤 한 트랜잭션으로 공개합니다.
 * 입력에 없는 기존 키는 보존하며 실제 측정값·출처가 같은 재실행만 건너뜁니다.
 */
export async function importFootTrafficStats(
  pool: Pool,
  options: FootTrafficOptions,
  loadSource: (
    path: string,
    onRows: (rows: FootTrafficStatRow[]) => Promise<void>,
  ) => Promise<FootTrafficSource> = readFootTrafficSource,
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
    // 시작 이력은 반영 트랜잭션 밖에 남겨 파일·검증·DB 오류도 추적합니다.
    await client.query(
      `INSERT INTO etl_batch
       (batch_id,dataset_code,source_type,scope_type,source_reference,etl_version,status,expected_rows,started_at)
       VALUES ($1,$2,'CSV','SEOUL',$3,$4,'RUNNING',$5,now())`,
      [batchId, datasetCode, reference, etlVersion, options.expectedRows],
    );
    started = true;
    const schema = await client.query<{ present: boolean }>(
      "SELECT to_regclass('dong_foot_traffic_stat') IS NOT NULL AS present",
    );
    if (!schema.rows[0]!.present)
      throw new Error(
        'dong_foot_traffic_stat이 없습니다. 기존 Flyway V3를 먼저 적용하세요.',
      );

    await client.query('BEGIN');
    transaction = true;
    await client.query(`CREATE TEMP TABLE foot_traffic_stage (
      dong_code TEXT NOT NULL, quarter_code TEXT NOT NULL,
      total_foot_traffic NUMERIC, male_foot_traffic NUMERIC, female_foot_traffic NUMERIC,
      source_record BIGINT NOT NULL, PRIMARY KEY (dong_code,quarter_code)
    ) ON COMMIT DROP`);
    const source = await loadSource(options.source, async (rows) => {
      // 소수와 큰 정수는 JSON에도 문자열로 넣어 Number의 반올림을 피합니다.
      // 각 쓰기를 기다리며 최대 1000행만 전송해 DB 쓰기가 밀려도 행이 계속 쌓이지 않게 합니다.
      for (let offset = 0; offset < rows.length; offset += 1000) {
        const chunk = rows.slice(offset, offset + 1000).map((row, index) => ({
          dong_code: row.dongCode,
          quarter_code: row.quarterCode,
          total_foot_traffic: row.totalFootTraffic,
          male_foot_traffic: row.maleFootTraffic,
          female_foot_traffic: row.femaleFootTraffic,
          source_record: stagedRows + index + 1,
        }));
        await client.query(
          `INSERT INTO foot_traffic_stage SELECT * FROM jsonb_to_recordset($1::jsonb)
           AS r(dong_code text,quarter_code text,total_foot_traffic numeric,
             male_foot_traffic numeric,female_foot_traffic numeric,source_record bigint)`,
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
    // 콜백 건수가 아닌 실제 DB 건수를 확인해 누락·초과된 스테이징은 게시와 SKIPPED 모두 차단합니다.
    const staged = await client.query<{ staged_rows: string }>(
      'SELECT count(*) AS staged_rows FROM foot_traffic_stage',
    );
    if (staged.rows[0]!.staged_rows !== String(validRows))
      throw new Error(
        `스테이징 행 수가 검증된 유효 행 수와 다릅니다: 유효 ${validRows}, 스테이징 ${staged.rows[0]!.staged_rows}`,
      );

    // 원본 판독 중에는 서비스 테이블을 잠그지 않고, 공개 직전에만 쓰기를 직렬화합니다.
    // 행정동 기준 데이터도 잠가 FK 검사 후 경계 코드가 바뀌는 일을 막습니다.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      datasetCode,
    ]);
    await client.query(
      'LOCK TABLE dong_foot_traffic_stat IN SHARE ROW EXCLUSIVE MODE',
    );
    await client.query('LOCK TABLE administrative_dong IN SHARE MODE');
    const invalid = await client.query<{ rejected: string }>(
      `SELECT count(*) AS rejected FROM foot_traffic_stage s
       LEFT JOIN administrative_dong a USING(dong_code) WHERE a.dong_code IS NULL`,
    );
    rejectedRows = Number(invalid.rows[0]!.rejected);
    validRows = fetchedRows - rejectedRows;
    if (rejectedRows) {
      // 과거 행정동을 현재 코드로 임의 치환하지 않고 원본에서 확인할 위치를 진단에 포함합니다.
      const dongs = await client.query(
        `SELECT s.dong_code AS code,count(*) AS rows,min(quarter_code) AS from_quarter,
         max(quarter_code) AS to_quarter,min(source_record) AS first_record
         FROM foot_traffic_stage s LEFT JOIN administrative_dong a USING(dong_code)
         WHERE a.dong_code IS NULL GROUP BY s.dong_code ORDER BY count(*) DESC,s.dong_code LIMIT 10`,
      );
      throw new Error(
        `FK 불일치 ${rejectedRows}행: ${JSON.stringify({ dongs: dongs.rows })}. 행정동 경계 적재 여부와 원본의 행정구역 버전을 확인하세요.`,
      );
    }

    const previous = await client.query<{ batch_id: string }>(
      `SELECT batch_id FROM etl_batch WHERE dataset_code=$1 AND source_checksum=$2
       AND etl_version=$3 AND status='PUBLISHED' ORDER BY published_at DESC LIMIT 1`,
      [datasetCode, checksum, etlVersion],
    );
    let unchanged = false;
    if (previous.rows[0]) {
      // NUMERIC 값과 출처를 NULL까지 구분해 비교합니다. 입력에 없는 기존 키는 보존합니다.
      const result = await client.query<{ unchanged: boolean }>(
        `SELECT NOT EXISTS (
          SELECT 1 FROM foot_traffic_stage s LEFT JOIN dong_foot_traffic_stat t USING(dong_code,quarter_code)
          WHERE t.dong_code IS NULL OR
          ROW(t.total_foot_traffic,t.male_foot_traffic,t.female_foot_traffic,t.source_batch_id)
          IS DISTINCT FROM
          ROW(s.total_foot_traffic,s.male_foot_traffic,s.female_foot_traffic,$1::uuid)
        ) AS unchanged`,
        [previous.rows[0].batch_id],
      );
      unchanged = result.rows[0]!.unchanged;
    }
    if (!unchanged) {
      await client.query(
        `INSERT INTO dong_foot_traffic_stat
         (dong_code,quarter_code,total_foot_traffic,male_foot_traffic,female_foot_traffic,source_batch_id)
         SELECT dong_code,quarter_code,total_foot_traffic,male_foot_traffic,female_foot_traffic,$1
         FROM foot_traffic_stage ORDER BY dong_code,quarter_code
         ON CONFLICT (dong_code,quarter_code) DO UPDATE SET
          total_foot_traffic=EXCLUDED.total_foot_traffic,male_foot_traffic=EXCLUDED.male_foot_traffic,
          female_foot_traffic=EXCLUDED.female_foot_traffic,source_batch_id=EXCLUDED.source_batch_id`,
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
    // 일부 Upsert가 성공했더라도 모두 롤백하고 실패 이력만 별도로 확정합니다.
    if (transaction) released = await rollbackOrDiscard(client);
    if (error instanceof FootTrafficSourceError) {
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
