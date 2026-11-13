import {
  assertLocalDatabaseUrl,
  createDatabasePool,
  rollbackOrDiscard,
} from '../../common/database.js';
import {
  comparableDistrictFootTrafficValue,
  districtFootTrafficKey,
  districtFootTrafficMeasurements,
  readDistrictFootTrafficSource,
  type DistrictFootTrafficStatRow,
} from './district-foot-traffic-source.js';

type PublishedRow = DistrictFootTrafficStatRow & {
  published: boolean;
  sourceType: string | null;
  sourceChecksum: string | null;
};

async function readPublishedRows() {
  try {
    assertLocalDatabaseUrl(process.env.DATABASE_URL);
    const pool = createDatabasePool();
    try {
      const client = await pool.connect();
      let rows: PublishedRow[];
      let discarded: boolean;
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        // REST 조회의 게시 조건을 확인하되 잘못된 출처를 가진 행도 대조에서 빠뜨리지 않습니다.
        ({ rows } = await client.query<PublishedRow>(`
          SELECT s.district_code AS "districtCode", s.quarter_code AS "quarterCode",
                 s.total_foot_traffic::text AS "totalFootTraffic",
                 s.male_foot_traffic::text AS "maleFootTraffic",
                 s.female_foot_traffic::text AS "femaleFootTraffic",
                 COALESCE(b.dataset_code = 'SEOUL_DISTRICT_FOOT_TRAFFIC_STAT'
                   AND b.source_type IN ('CSV', 'API') AND b.scope_type = 'SEOUL'
                   AND b.scope_code IS NULL AND b.status = 'PUBLISHED'
                   AND b.published_at IS NOT NULL, false) AS published,
                 b.source_type AS "sourceType", b.source_checksum::text AS "sourceChecksum"
          FROM district_foot_traffic_stat s
          LEFT JOIN etl_batch b ON b.batch_id = s.source_batch_id
        `));
      } finally {
        discarded = await rollbackOrDiscard(client);
        if (!discarded) client.release();
      }
      if (discarded)
        throw new Error('자치구 길단위인구 DB 조회를 종료하지 못했습니다.');
      return rows;
    } finally {
      await pool.end();
    }
  } catch {
    // 드라이버 오류나 잘못된 환경설정에 포함될 수 있는 접속정보를 폐기합니다.
    throw new Error(
      'BLOCKED: 자치구 길단위인구 로컬 DB를 읽기 전용으로 조회할 수 없습니다.',
    );
  }
}

/** 같은 CSV 바이트를 사용해 앞선 probe 결과를 게시 DB의 전체 키·수치와 연결합니다. */
export async function compareDistrictFootTrafficDatabase(
  path: string,
  expectedCsvSha256: string,
) {
  const csvRows = new Map<string, DistrictFootTrafficStatRow>();
  const csv = await readDistrictFootTrafficSource(path, async (rows) => {
    for (const row of rows) csvRows.set(districtFootTrafficKey(row), row);
  });
  if (csv.checksum !== expectedCsvSha256)
    throw new Error('자치구 길단위인구 CSV가 probe 이후 변경되었습니다.');

  const districts = new Set<string>();
  const quarters = new Set<string>();
  for (const row of csvRows.values()) {
    districts.add(row.districtCode);
    quarters.add(row.quarterCode);
  }

  const dbRows = await readPublishedRows();
  let dbOnly = 0;
  let mismatchedRows = 0;
  let mismatchedValues = 0;
  let representationDifferences = 0;
  let unpublishedRows = 0;
  let matchingCsvSourceRows = 0;
  let mismatchedCsvSourceRows = 0;
  const keys = new Set<string>();
  for (const row of dbRows) {
    const key = districtFootTrafficKey(row);
    if (keys.has(key))
      throw new Error('자치구 길단위인구 DB 복합키가 중복되었습니다.');
    keys.add(key);
    if (!row.published) unpublishedRows += 1;
    // CSV는 원본 바이트, API는 정규화된 행으로 해시하므로 CSV 배치만 이 해시와 대조합니다.
    if (row.sourceType === 'CSV') {
      if (row.sourceChecksum === csv.checksum) matchingCsvSourceRows += 1;
      else mismatchedCsvSourceRows += 1;
    }
    const csvRow = csvRows.get(key);
    if (!csvRow) {
      dbOnly += 1;
      continue;
    }
    csvRows.delete(key);
    const differences = districtFootTrafficMeasurements.filter(
      (field) =>
        comparableDistrictFootTrafficValue(row[field]) !==
        comparableDistrictFootTrafficValue(csvRow[field]),
    ).length;
    if (differences) mismatchedRows += 1;
    mismatchedValues += differences;
    representationDifferences += districtFootTrafficMeasurements.filter(
      (field) => row[field] !== csvRow[field],
    ).length;
  }
  if (
    dbOnly ||
    csvRows.size ||
    mismatchedRows ||
    unpublishedRows ||
    mismatchedCsvSourceRows
  )
    throw new Error(
      `자치구 길단위인구 CSV·DB 대조 실패 (CSV 전용 ${csvRows.size}행, DB 전용 ${dbOnly}행, 수치 불일치 ${mismatchedRows}행 / ${mismatchedValues}개, 게시 조건 불일치 ${unpublishedRows}행, CSV 출처 체크섬 불일치 ${mismatchedCsvSourceRows}행)`,
    );
  return {
    csvSha256: csv.checksum,
    matchedRows: dbRows.length,
    comparedValues: dbRows.length * districtFootTrafficMeasurements.length,
    representationDifferences,
    districtCount: districts.size,
    quarterCount: quarters.size,
    missingDistrictQuarterPairs: districts.size * quarters.size - dbRows.length,
    matchingCsvSourceRows,
  };
}
