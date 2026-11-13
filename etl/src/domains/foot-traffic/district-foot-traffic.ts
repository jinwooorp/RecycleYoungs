import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import {
  assertLocalDatabaseUrl,
  rollbackOrDiscard,
  safeMessage,
} from '../../common/database.js';
import {
  districtFootTrafficApiReference,
  readDistrictFootTrafficApiSource,
  type DistrictFootTrafficApiPublishOptions,
} from './district-foot-traffic-api.js';
import {
  readDistrictFootTrafficSource,
  DistrictFootTrafficSourceError,
  type DistrictFootTrafficSource,
  type DistrictFootTrafficStatRow,
} from './district-foot-traffic-source.js';

const datasetCode = 'SEOUL_DISTRICT_FOOT_TRAFFIC_STAT';
const etlVersion = 'district-foot-traffic-stat-v1';

export type DistrictFootTrafficOptions = {
  source: string;
  expectedRows: number;
};

type CsvSourceReader = (
  path: string,
  onRows: (rows: DistrictFootTrafficStatRow[]) => Promise<void>,
) => Promise<DistrictFootTrafficSource>;

type PublishSource =
  | { type: 'CSV'; path: string; read: CsvSourceReader }
  | { type: 'API'; options: DistrictFootTrafficApiPublishOptions };

/** CSV 판독기의 바이트 체크섬과 경로 기반 출처를 기존 방식으로 기록합니다. */
export async function importDistrictFootTrafficStats(
  pool: Pool,
  options: DistrictFootTrafficOptions,
  loadSource: CsvSourceReader = readDistrictFootTrafficSource,
) {
  return publishDistrictFootTraffic(pool, options.expectedRows, {
    type: 'CSV',
    path: options.source,
    read: loadSource,
  });
}

/** 전체 수집을 검증한 API 입력만 공통 게시 트랜잭션에 전달합니다. */
export async function importDistrictFootTrafficApi(
  pool: Pool,
  options: DistrictFootTrafficApiPublishOptions,
) {
  if (options.publish !== true)
    throw new Error('서울시 API 게시에는 --publish가 필요합니다.');
  return publishDistrictFootTraffic(pool, options.expectedRows, {
    type: 'API',
    options,
  });
}

/**
 * 검증한 길단위인구 통계를 작은 묶음으로 스테이징하고, FK 확인 후 한 번에 공개합니다.
 * 원본에 없는 기존 키는 보존하며 측정값과 출처가 같은 재실행은 SKIPPED로 기록합니다.
 */
async function publishDistrictFootTraffic(
  pool: Pool,
  expectedRows: number,
  input: PublishSource,
) {
  if (!Number.isSafeInteger(expectedRows) || expectedRows <= 0)
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
  let reference = JSON.stringify(
    input.type === 'API'
      ? districtFootTrafficApiReference
      : {
          datasetId: 'OA-22179',
          serviceName: 'VwsmSignguFlpopW',
          path: resolve(input.path),
        },
  );

  try {
    // 시작 이력은 반영 트랜잭션 밖에 확정해 파일·검증·DB 오류도 추적할 수 있게 합니다.
    await client.query(
      `INSERT INTO etl_batch
       (batch_id,dataset_code,source_type,scope_type,source_reference,etl_version,status,expected_rows,started_at)
      VALUES ($1,$2,$3,'SEOUL',$4,$5,'RUNNING',$6,now())`,
      [batchId, datasetCode, input.type, reference, etlVersion, expectedRows],
    );
    started = true;
    const schema = await client.query<{ present: boolean }>(
      "SELECT to_regclass('district_foot_traffic_stat') IS NOT NULL AS present",
    );
    if (!schema.rows[0]!.present)
      throw new Error(
        'district_foot_traffic_stat이 없습니다. Flyway V7를 먼저 적용하세요.',
      );

    // API 오류는 배치에 기록하되, 모든 페이지를 확인하기 전에는 staging이나 통계 쓰기를 시작하지 않습니다.
    const apiSource =
      input.type === 'API'
        ? await readDistrictFootTrafficApiSource(input.options)
        : undefined;
    if (apiSource) {
      ({
        checksum,
        fetchedRows,
        validRows,
        rejectedRows,
        periodFrom,
        periodTo,
        reference,
      } = apiSource);
    }

    await client.query('BEGIN');
    transaction = true;
    await client.query(`CREATE TEMP TABLE district_foot_traffic_stage (
      district_code TEXT NOT NULL, quarter_code TEXT NOT NULL,
      total_foot_traffic NUMERIC, male_foot_traffic NUMERIC, female_foot_traffic NUMERIC,
      source_record BIGINT NOT NULL, PRIMARY KEY (district_code,quarter_code)
    ) ON COMMIT DROP`);
    const stageRows = async (rows: DistrictFootTrafficStatRow[]) => {
      // JSON에도 수치를 문자열로 넣어 BIGINT·NUMERIC을 Number로 변환하지 않습니다.
      // 한 번에 최대 1000행만 전송하고 await해 빠른 파일 판독이 DB 쓰기를 앞질러 쌓이지 않게 합니다.
      for (let offset = 0; offset < rows.length; offset += 1000) {
        const chunk = rows.slice(offset, offset + 1000).map((row, index) => ({
          district_code: row.districtCode,
          quarter_code: row.quarterCode,
          total_foot_traffic: row.totalFootTraffic,
          male_foot_traffic: row.maleFootTraffic,
          female_foot_traffic: row.femaleFootTraffic,
          source_record: stagedRows + index + 1,
        }));
        await client.query(
          `INSERT INTO district_foot_traffic_stage SELECT * FROM jsonb_to_recordset($1::jsonb)
           AS r(district_code text,quarter_code text,total_foot_traffic numeric,
             male_foot_traffic numeric,female_foot_traffic numeric,source_record bigint)`,
          [JSON.stringify(chunk)],
        );
        stagedRows += chunk.length;
      }
    };
    if (apiSource) await stageRows(apiSource.rows);
    if (input.type === 'CSV') {
      const source = await input.read(input.path, stageRows);
      ({
        checksum,
        fetchedRows,
        validRows,
        rejectedRows,
        periodFrom,
        periodTo,
      } = source);
      reference = JSON.stringify({
        datasetId: 'OA-22179',
        serviceName: 'VwsmSignguFlpopW',
        path: source.path,
        ...(source.entry ? { entry: source.entry } : {}),
        encoding: source.encoding,
      });
    }
    if (
      rejectedRows !== 0 ||
      validRows !== fetchedRows ||
      fetchedRows !== expectedRows
    )
      throw new Error(
        `원본 행 수가 --expected-rows와 다릅니다: 예상 ${expectedRows}, 실제 ${fetchedRows}`,
      );
    // 콜백에 전달한 건수가 아닌 DB의 실제 행 수를 확인해 누락·초과된 스테이징을 공개하지 않습니다.
    const staged = await client.query<{ staged_rows: string }>(
      'SELECT count(*) AS staged_rows FROM district_foot_traffic_stage',
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
      'LOCK TABLE district_foot_traffic_stat IN SHARE ROW EXCLUSIVE MODE',
    );
    await client.query('LOCK TABLE district IN SHARE MODE');
    const invalid = await client.query<{ rejected: string }>(
      `SELECT count(*) AS rejected FROM district_foot_traffic_stage s
       LEFT JOIN district a USING(district_code)
       WHERE a.district_code IS NULL`,
    );
    rejectedRows = Number(invalid.rows[0]!.rejected);
    validRows = fetchedRows - rejectedRows;
    if (rejectedRows) {
      // 자치구를 임의 치환하지 않고 코드별 영향 행·분기·첫 데이터 레코드를 제시합니다.
      const districts = await client.query(
        `SELECT s.district_code AS code,count(*) AS rows,min(quarter_code) AS from_quarter,
         max(quarter_code) AS to_quarter,min(source_record) AS first_record
         FROM district_foot_traffic_stage s LEFT JOIN district a USING(district_code)
         WHERE a.district_code IS NULL GROUP BY s.district_code ORDER BY count(*) DESC,s.district_code LIMIT 10`,
      );
      throw new Error(
        `FK 불일치 ${rejectedRows}행: ${JSON.stringify({ districts: districts.rows })}. 기준 데이터 적재 여부와 원본의 행정구역 버전을 확인하세요.`,
      );
    }

    const previous = await client.query<{ batch_id: string }>(
      `SELECT batch_id FROM etl_batch WHERE dataset_code=$1 AND source_checksum=$2
      AND etl_version=$3 AND source_type=$4 AND scope_type='SEOUL' AND scope_code IS NULL
       AND status='PUBLISHED' AND published_at IS NOT NULL ORDER BY published_at DESC,batch_id DESC LIMIT 1`,
      [datasetCode, checksum, etlVersion, input.type],
    );
    let unchanged = false;
    if (previous.rows[0]) {
      // NUMERIC을 text로 비교해 NULL·0뿐 아니라 소수 자릿수와 출처까지 확인합니다.
      // 수학적으로 같아도 저장 scale이 바뀌었다면 재게시하며 입력에 없는 키는 보존합니다.
      const result = await client.query<{ unchanged: boolean }>(
        `SELECT NOT EXISTS (
          SELECT 1 FROM district_foot_traffic_stage s LEFT JOIN district_foot_traffic_stat t USING(district_code,quarter_code)
          WHERE t.district_code IS NULL OR
          ROW(t.total_foot_traffic::text,t.male_foot_traffic::text,t.female_foot_traffic::text,t.source_batch_id)
          IS DISTINCT FROM
          ROW(s.total_foot_traffic::text,s.male_foot_traffic::text,s.female_foot_traffic::text,$1::uuid)
        ) AS unchanged`,
        [previous.rows[0].batch_id],
      );
      unchanged = result.rows[0]!.unchanged;
    }
    if (!unchanged) {
      await client.query(
        `INSERT INTO district_foot_traffic_stat
         (district_code,quarter_code,total_foot_traffic,male_foot_traffic,female_foot_traffic,source_batch_id)
         SELECT district_code,quarter_code,total_foot_traffic,male_foot_traffic,female_foot_traffic,$1
         FROM district_foot_traffic_stage ORDER BY district_code,quarter_code
         ON CONFLICT (district_code,quarter_code) DO UPDATE SET
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
    // 스테이징과 일부 성공한 Upsert를 함께 롤백해 이전 정상 데이터와 출처를 보존합니다.
    if (transaction) released = await rollbackOrDiscard(client);
    if (error instanceof DistrictFootTrafficSourceError) {
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
