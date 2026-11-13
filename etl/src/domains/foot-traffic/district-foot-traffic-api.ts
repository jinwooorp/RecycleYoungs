import { createHash } from 'node:crypto';
import {
  districtFootTrafficKey,
  districtFootTrafficRowSchema,
  readDistrictFootTrafficSource,
  type DistrictFootTrafficStatRow,
} from './district-foot-traffic-source.js';
import { collectSeoulOpenApiRows } from '../../common/seoul-open-api.js';

const serviceName = 'VwsmSignguFlpopW';
const datasetId = 'OA-22179';
export const districtFootTrafficApiReference = {
  datasetId,
  serviceName,
  scope: 'SEOUL',
  collectionMode: 'FULL',
} as const;
const maxMeasurementCharacters = 32 * 1024 * 1024;
const measurementFields = [
  'totalFootTraffic',
  'maleFootTraffic',
  'femaleFootTraffic',
] as const;

export type DistrictFootTrafficApiProbeOptions = {
  api: true;
  probe: true;
  allowInsecureHttp?: boolean;
  expectedRows?: number;
  compareCsv?: string;
};

export type DistrictFootTrafficApiPublishOptions = {
  api: true;
  publish: true;
  allowInsecureHttp?: boolean;
  expectedRows: number;
};

function parseRow(
  value: Record<string, unknown>,
  rowNumber: number,
): DistrictFootTrafficStatRow {
  const row = districtFootTrafficRowSchema.safeParse({
    districtCode: value.SIGNGU_CD,
    quarterCode: value.STDR_YYQU_CD,
    totalFootTraffic: value.TOT_FLPOP_CO,
    maleFootTraffic: value.ML_FLPOP_CO,
    femaleFootTraffic: value.FML_FLPOP_CO,
  });
  if (!row.success)
    throw new Error(
      `자치구 길단위인구 API의 ${rowNumber}번째 행 필수 코드 또는 수치 형식이 올바르지 않습니다.`,
    );
  return row.data;
}

/** 비교에만 소수부 후행 0을 제거하며 출력과 CSV 원본의 scale은 유지합니다. */
function comparableNumeric(value: string | null) {
  return value?.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '')
    : value;
}

async function compareCsv(
  path: string,
  apiRows: Map<string, DistrictFootTrafficStatRow>,
) {
  let matchedRows = 0;
  let mismatchedRows = 0;
  const csv = await readDistrictFootTrafficSource(path, async (rows) => {
    for (const row of rows) {
      const apiRow = apiRows.get(districtFootTrafficKey(row));
      if (!apiRow) continue;
      matchedRows += 1;
      if (
        measurementFields.some(
          (field) =>
            comparableNumeric(apiRow[field]) !== comparableNumeric(row[field]),
        )
      )
        mismatchedRows += 1;
    }
  });
  const apiOnly = apiRows.size - matchedRows;
  const csvOnly = csv.validRows - matchedRows;
  if (apiOnly || csvOnly || mismatchedRows)
    throw new Error(
      `자치구 길단위인구 API·CSV 대조 실패 (API 전용 ${apiOnly}행, CSV 전용 ${csvOnly}행, 수치 불일치 ${mismatchedRows}행)`,
    );
  return {
    matchedRows,
    comparedValues: matchedRows * measurementFields.length,
  };
}

/** probe와 게시에 같은 전체 수집·수치 검증을 적용합니다. */
async function collectDistrictFootTrafficApi(
  options: Pick<
    DistrictFootTrafficApiProbeOptions,
    'expectedRows' | 'allowInsecureHttp'
  >,
) {
  let measurementCharacters = 0;
  const { rows, totalRows, pages } = await collectSeoulOpenApiRows({
    serviceName,
    allowInsecureHttp: options.allowInsecureHttp,
    expectedRows: options.expectedRows,
    parseRow(value, rowNumber) {
      const row = parseRow(value, rowNumber);
      // 짧은 지수 표기도 정규화 과정에서 길어질 수 있으므로 비교용 수치의 누적 크기를 제한합니다.
      for (const field of measurementFields)
        measurementCharacters += row[field]?.length ?? 0;
      if (measurementCharacters > maxMeasurementCharacters)
        throw new Error(
          '자치구 길단위인구 API 정규화 수치의 크기 제한을 초과했습니다.',
        );
      return row;
    },
    rowKey: districtFootTrafficKey,
  });
  let periodFrom = '';
  let periodTo = '';
  for (const row of rows.values()) {
    if (!periodFrom || row.quarterCode < periodFrom)
      periodFrom = row.quarterCode;
    if (!periodTo || row.quarterCode > periodTo) periodTo = row.quarterCode;
  }
  return { rows, totalRows, pages, periodFrom, periodTo };
}

/** API의 전체 정규화 행을 복합키 순으로 해시해 응답 순서에 관계없이 같은 원본을 식별합니다. */
export async function readDistrictFootTrafficApiSource(
  options: DistrictFootTrafficApiPublishOptions,
) {
  const { rows, totalRows, pages, periodFrom, periodTo } =
    await collectDistrictFootTrafficApi(options);
  const ordered = [...rows.keys()].sort().map((key) => rows.get(key)!);
  const hash = createHash('sha256');
  for (const row of ordered) {
    // 필드 순서, NUMERIC의 소수 자릿수, NULL을 고정하며 요청 정보는 포함하지 않습니다.
    hash.update(
      JSON.stringify([
        row.districtCode,
        row.quarterCode,
        row.totalFootTraffic,
        row.maleFootTraffic,
        row.femaleFootTraffic,
      ]) + '\n',
    );
  }
  return {
    rows: ordered,
    checksum: hash.digest('hex'),
    fetchedRows: rows.size,
    validRows: rows.size,
    rejectedRows: 0,
    periodFrom,
    periodTo,
    reference: JSON.stringify({
      ...districtFootTrafficApiReference,
      reportedRows: totalRows,
      pages,
      periodFrom,
      periodTo,
    }),
  };
}

/** 모든 API 페이지와 선택적 CSV 대조를 마친 후에만 읽기 전용 검증 결과를 반환합니다. */
export async function probeDistrictFootTrafficApi(
  options: DistrictFootTrafficApiProbeOptions,
) {
  const { rows, totalRows, pages, periodFrom, periodTo } =
    await collectDistrictFootTrafficApi(options);
  const csvComparison = options.compareCsv
    ? await compareCsv(options.compareCsv, rows)
    : undefined;
  const sample: DistrictFootTrafficStatRow[] = [];
  for (const row of rows.values()) {
    if (sample.length === 5) break;
    sample.push(row);
  }
  return {
    mode: 'PROBE',
    datasetId,
    serviceName,
    validationScope: 'OPEN_API_FULL_COLLECTION',
    databaseChecked: false,
    batchCreated: false,
    loadedRows: 0,
    expectedRows: options.expectedRows,
    reportedRows: totalRows,
    fetchedRows: rows.size,
    validRows: rows.size,
    rejectedRows: 0,
    pages,
    periodFrom,
    periodTo,
    csvComparison,
    sample,
  };
}
