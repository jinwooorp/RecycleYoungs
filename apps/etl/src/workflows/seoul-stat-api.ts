import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { streamSeoulStatApiRows } from '../common/seoul-open-api.js';
import type { StatApiSource } from '../common/stat-api-publication.js';
import {
  aliases as footTrafficFields,
  readFootTrafficSource,
  rowSchema as footTrafficSchema,
  type FootTrafficStatRow,
  normalizeNumeric,
} from '../domains/foot-traffic/foot-traffic-source.js';
import { importFootTrafficStats } from '../domains/foot-traffic/foot-traffic.js';
import { industrySchema } from '../domains/industries/industry-source.js';
import {
  aliases as districtSalesFields,
  readDistrictSalesSource,
  rowSchema as districtSalesSchema,
} from '../domains/sales/district-sales-source.js';
import { importDistrictSalesStats } from '../domains/sales/district-sales.js';
import {
  aliases as salesFields,
  normalizeInteger,
  readSalesSource,
  rowSchema as salesSchema,
} from '../domains/sales/sales-source.js';
import { importSalesStats } from '../domains/sales/sales.js';
import {
  aliases as districtStoreFields,
  districtRowSchema as districtStoreSchema,
  readDistrictStoreSource,
} from '../domains/stores/district-store-source.js';
import { importDistrictStoreStats } from '../domains/stores/district-stores.js';
import {
  aliases as storeFields,
  readStoreSource,
  rowSchema as storeSchema,
} from '../domains/stores/store-source.js';
import { importStoreStats } from '../domains/stores/stores.js';

export type SeoulStatApiOptions = {
  expectedRows: number;
  allowInsecureHttp?: boolean;
  compareCsv?: string;
  csvPeriod?: boolean;
};

type StatRow = Pick<FootTrafficStatRow, 'quarterCode'> & {
  dongCode?: string;
  districtCode?: string;
  industryCode?: string;
};
type CsvReader<Row> = (
  path: string,
  onRows: (rows: Row[]) => Promise<void>,
) => Promise<{ checksum: string; validRows: number }>;

type Publisher<Row> = (
  pool: Pool,
  options: { source: string; expectedRows: number },
  csvReader: undefined,
  apiSource: StatApiSource<Row>,
) => Promise<unknown>;

type Dataset<Row extends StatRow> = {
  datasetId: string;
  serviceName: string;
  schema: z.ZodType<Row>;
  fields: Record<keyof Row, readonly string[]>;
  csv: CsvReader<Row>;
  publish: Publisher<Row>;
  stores?: boolean;
};

const csvMeasurementBudget = 128 * 1024 * 1024;

function compositeKey(row: StatRow) {
  return [
    row.dongCode ?? row.districtCode,
    row.industryCode ?? '',
    row.quarterCode,
  ].join(':');
}

function compareNumeric(value: string | null) {
  if (value === null) return null;
  const normalized = value.replace(/^0+(?=[0-9])/, '');
  return normalized.includes('.')
    ? normalized.replace(/0+$/, '').replace(/\.$/, '')
    : normalized;
}

function defineDataset<Row extends StatRow>(dataset: Dataset<Row>) {
  const reference = {
    datasetId: dataset.datasetId,
    serviceName: dataset.serviceName,
    scope: 'SEOUL',
  } as const;
  const fields = Object.entries<readonly string[]>(dataset.fields).map(
    ([field, names]) => [field as keyof Row, names[1]!] as const,
  );
  const measurements = fields
    .map(([field]) => field)
    .filter(
      (field) =>
        !['dongCode', 'districtCode', 'quarterCode', 'industryCode'].includes(
          String(field),
        ),
    );
  const values = (row: Row) =>
    measurements.map((field) => row[field] as string | null);

  async function collect(
    options: SeoulStatApiOptions,
    publication?: {
      stage: (rows: Row[]) => Promise<void>;
      selectedIndustries: Map<string, string>;
      rowHashes: Map<string, string>;
    },
  ) {
    const csvRows = new Map<string, (string | null)[]>();
    const csvQuarters = new Set<string>();
    let csvSha256: string | undefined;
    let csvBytes = 0;
    if (options.csvPeriod && !options.compareCsv)
      throw new Error('CSV 분기 대조에는 --compare-csv가 필요합니다.');
    if (options.compareCsv) {
      try {
        const input = await dataset.csv(options.compareCsv, async (rows) => {
          for (const row of rows) {
            const key = compositeKey(row);
            const cells = values(row);
            csvBytes += Buffer.byteLength(JSON.stringify([key, cells]));
            if (csvBytes > csvMeasurementBudget)
              throw new Error('CSV 비교 메모리 제한');
            csvRows.set(key, cells);
            csvQuarters.add(row.quarterCode);
          }
        });
        csvSha256 = input.checksum;
      } catch {
        // 기존 파일 판독기의 오류에는 경로나 원본 셀이 포함될 수 있습니다.
        throw new Error(
          '대조 CSV를 검증할 수 없습니다. 파일 형식·복합키·비교 크기 제한을 확인하세요.',
        );
      }
    }

    const apiQuarters = new Set<string>();
    const industries = new Map<string, string>();
    let selectedRows = 0;
    let matchedRows = 0;
    let extraRows = 0;
    let differentValues = 0;
    let representationDifferences = 0;
    let periodFrom: string | undefined;
    let periodTo: string | undefined;

    const result = await streamSeoulStatApiRows<{
      row: Row;
      industry?: z.infer<typeof industrySchema>;
    }>(
      {
        ...reference,
        expectedRows: options.expectedRows,
        allowInsecureHttp: options.allowInsecureHttp,
        rowKey: ({ row }) => compositeKey(row),
        parseRow(input, index) {
          try {
            const projected = Object.fromEntries(
              fields.map(([field, apiField]) => {
                let value = input[apiField];
                if (
                  dataset.stores &&
                  typeof value === 'string' &&
                  value !== ''
                ) {
                  if (String(field).endsWith('Count'))
                    value = normalizeInteger(value);
                  else if (String(field).endsWith('Rate'))
                    value = normalizeNumeric(value);
                }
                return [field, value];
              }),
            );
            const row = dataset.schema.parse(projected);
            const industry = row.industryCode
              ? industrySchema.parse({
                  industryCode: row.industryCode,
                  industryName: input.SVC_INDUTY_CD_NM,
                })
              : undefined;
            return { row, industry };
          } catch {
            throw new Error(
              `서울시 통계 API ${index}번째 행의 코드·수치·업종 형식이 올바르지 않습니다.`,
            );
          }
        },
      },
      async (page) => {
        const selected: Row[] = [];
        for (const { row, industry } of page) {
          apiQuarters.add(row.quarterCode);
          if (industry) {
            const previous = industries.get(industry.industryCode);
            if (previous !== undefined && previous !== industry.industryName)
              throw new Error(
                '서울시 통계 API에서 같은 업종 코드의 명칭이 다릅니다.',
              );
            industries.set(industry.industryCode, industry.industryName);
          }
          if (options.csvPeriod && !csvQuarters.has(row.quarterCode)) continue;

          selectedRows++;
          if (!periodFrom || row.quarterCode < periodFrom)
            periodFrom = row.quarterCode;
          if (!periodTo || row.quarterCode > periodTo)
            periodTo = row.quarterCode;
          if (!csvSha256) continue;

          const key = compositeKey(row);
          const expected = csvRows.get(key);
          if (!expected) {
            extraRows++;
            continue;
          }
          matchedRows++;
          const cells = values(row);
          for (const [index, value] of cells.entries()) {
            const other = expected[index]!;
            if (compareNumeric(value) !== compareNumeric(other))
              differentValues++;
            else if (value !== other) representationDifferences++;
          }
          if (publication) {
            if (industry)
              publication.selectedIndustries.set(
                industry.industryCode,
                industry.industryName,
              );
            // DB에 저장할 정규화 값과 업종명은 복합키 순서로 해시합니다. 페이지 순서가 바뀌어도 같습니다.
            publication.rowHashes.set(
              key,
              createHash('sha256')
                .update(
                  JSON.stringify([key, cells, industry?.industryName ?? null]),
                )
                .digest('hex'),
            );
            selected.push(row);
          }
        }
        if (publication && selected.length && !differentValues && !extraRows)
          await publication.stage(selected);
      },
    );
    const missingRows = csvRows.size - matchedRows;
    if (csvSha256 && (missingRows || extraRows || differentValues))
      throw new Error(
        `서울시 통계 API·CSV 대조 실패 (CSV 전용 ${missingRows}행, API 전용 ${extraRows}행, 수치 불일치 ${differentValues}개)`,
      );
    if (!periodFrom || !periodTo)
      throw new Error('서울시 통계 API의 검증 대상 분기에 행이 없습니다.');

    return {
      ...reference,
      ...result,
      periodFrom,
      periodTo,
      apiQuarters: [...apiQuarters].sort(),
      selectedRows,
      excludedRows: result.totalRows - selectedRows,
      collectionMode: options.csvPeriod
        ? ('CSV_QUARTERS' as const)
        : ('FULL' as const),
      csvComparison: csvSha256
        ? {
            csvSha256,
            matchedRows,
            comparedValues: matchedRows * measurements.length,
            representationDifferences,
          }
        : undefined,
    };
  }

  async function verifyIndustries(
    client: PoolClient,
    selected: Map<string, string>,
  ) {
    if (!selected.size) return;
    // 게시자의 기존 기준 테이블 잠금 아래에서 확인하며 업종 마스터는 수정하지 않습니다.
    const result = await client.query<{ code: string; name: string }>(
      'SELECT industry_code AS code, industry_name AS name FROM service_industry WHERE industry_code = ANY($1::text[])',
      [[...selected.keys()]],
    );
    if (
      result.rows.length !== selected.size ||
      result.rows.some(({ code, name }) => selected.get(code) !== name)
    )
      throw new Error(
        '서울시 통계 API의 업종 코드·명칭이 게시 기준 데이터와 다릅니다.',
      );
  }

  return {
    async probe(options: SeoulStatApiOptions) {
      const result = await collect(options);
      return {
        mode: 'PROBE',
        ...result,
        databaseChecked: false,
        batchCreated: false,
        loadedRows: 0,
      };
    },
    publish(pool: Pool, options: SeoulStatApiOptions) {
      if (!options.compareCsv)
        throw new Error(
          '서울시 통계 API 게시에는 검증할 --compare-csv가 필요합니다.',
        );
      const industryNames = new Map<string, string>();
      return dataset.publish(
        pool,
        { source: options.compareCsv, expectedRows: options.expectedRows },
        undefined,
        {
          reference,
          async load(stage) {
            const rowHashes = new Map<string, string>();
            const verified = await collect(options, {
              stage,
              selectedIndustries: industryNames,
              rowHashes,
            });
            const hash = createHash('sha256');
            for (const key of [...rowHashes.keys()].sort())
              hash.update(rowHashes.get(key)!);
            return {
              checksum: hash.digest('hex'),
              fetchedRows: verified.totalRows,
              validRows: verified.selectedRows,
              rejectedRows: 0,
              periodFrom: verified.periodFrom,
              periodTo: verified.periodTo,
              reference: {
                ...verified,
                checksumFormat: 'sha256-sorted-row-hashes-v1',
              },
            };
          },
          verifyIndustries: (client) => verifyIndustries(client, industryNames),
        },
      );
    },
  };
}

export const seoulStatDatasets = {
  'foot-traffic': defineDataset({
    datasetId: 'OA-22178',
    serviceName: 'VwsmAdstrdFlpopW',
    schema: footTrafficSchema,
    fields: footTrafficFields,
    csv: readFootTrafficSource,
    publish: importFootTrafficStats,
  }),
  'district-stores': defineDataset({
    datasetId: 'OA-22173',
    serviceName: 'VwsmSignguStorW',
    schema: districtStoreSchema,
    fields: districtStoreFields,
    csv: readDistrictStoreSource,
    publish: importDistrictStoreStats,
    stores: true,
  }),
  'district-sales': defineDataset({
    datasetId: 'OA-22176',
    serviceName: 'VwsmSignguSelngW',
    schema: districtSalesSchema,
    fields: districtSalesFields,
    csv: readDistrictSalesSource,
    publish: importDistrictSalesStats,
  }),
  stores: defineDataset({
    datasetId: 'OA-22172',
    serviceName: 'VwsmAdstrdStorW',
    schema: storeSchema,
    fields: storeFields,
    csv: readStoreSource,
    publish: importStoreStats,
    stores: true,
  }),
  sales: defineDataset({
    datasetId: 'OA-22175',
    serviceName: 'VwsmAdstrdSelngW',
    schema: salesSchema,
    fields: salesFields,
    csv: readSalesSource,
    publish: importSalesStats,
  }),
};

export function isSeoulStatCommand(
  name: string | undefined,
): name is keyof typeof seoulStatDatasets {
  return name !== undefined && Object.hasOwn(seoulStatDatasets, name);
}
