import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  DistrictFootTrafficSourceError,
  readDistrictFootTrafficSource,
} from './district-foot-traffic-source.js';
import {
  DistrictSalesSourceError,
  readDistrictSalesSource,
} from './district-sales-source.js';
import {
  DistrictStoreSourceError,
  readDistrictStoreSource,
} from './district-store-source.js';

const datasetIds = ['OA-22173', 'OA-22176', 'OA-22179'] as const;
const readers = {
  'OA-22173': readDistrictStoreSource,
  'OA-22176': readDistrictSalesSource,
  'OA-22179': readDistrictFootTrafficSource,
};
const localPath = z
  .string()
  .refine(
    (value) =>
      value.trim().length > 0 &&
      !value.includes('\0') &&
      !/^(?:[a-z][a-z0-9+.-]*:\/\/|[/\\]{2})/i.test(value.trimStart()),
  );
const entrySchema = z.strictObject({
  datasetId: z.enum(datasetIds),
  source: localPath,
  expectedRows: z.number().int().positive(),
  expectedSha256: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/i)
    .transform((value) => value.toLowerCase())
    .optional(),
});
const manifestSchema = z.strictObject({
  datasets: z.array(entrySchema).length(datasetIds.length),
});

type ManifestEntry = z.infer<typeof entrySchema>;
type SourceError =
  | DistrictStoreSourceError
  | DistrictSalesSourceError
  | DistrictFootTrafficSourceError;
type CoverageRow = { districtCode: string; quarterCode: string };

export type OfficialSourcesProbeOptions = { manifest: string; probe: true };

/** 통합 명령에는 적재 분기가 없으며 명시적 probe와 로컬 manifest 하나를 요구합니다. */
export function parseOfficialSourcesArguments(
  args: string[],
): OfficialSourcesProbeOptions | null {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      tokens: true,
      options: {
        probe: { type: 'boolean' },
        manifest: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch {
    throw new Error(
      '공식 원본 검증 실행 인자가 올바르지 않습니다. --help를 확인하세요.',
    );
  }
  if (parsed.values.help) return null;
  const manifest = localPath.safeParse(parsed.values.manifest);
  const optionCount = (name: string) =>
    parsed.tokens.filter(
      (token) => token.kind === 'option' && token.name === name,
    ).length;
  if (
    !manifest.success ||
    !parsed.values.probe ||
    optionCount('manifest') !== 1 ||
    optionCount('probe') !== 1
  )
    throw new Error(
      '공식 원본 검증에는 --probe와 --manifest <로컬 파일>을 각각 한 번 지정해야 합니다.',
    );
  return { manifest: manifest.data, probe: true };
}

async function readManifest(path: string) {
  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)),
    );
  } catch {
    // 파일 경로와 파서 예외에는 로컬 경로나 입력 일부가 들어갈 수 있습니다.
    throw new Error(
      '공식 원본 manifest를 읽거나 UTF-8 JSON으로 해석할 수 없습니다.',
    );
  }
  const manifest = manifestSchema.safeParse(json);
  if (
    !manifest.success ||
    new Set(manifest.data.datasets.map(({ datasetId }) => datasetId)).size !==
      datasetIds.length
  )
    throw new Error(
      '공식 원본 manifest에는 OA-22173, OA-22176, OA-22179의 경로와 예상 행 수를 각각 한 번 지정해야 합니다. 예상 SHA-256은 선택 항목입니다.',
    );
  return manifest.data;
}

async function probeDataset(entry: ManifestEntry, manifestDir: string) {
  const { datasetId, expectedRows, expectedSha256 } = entry;
  const districts = new Set<string>();
  const byQuarter = new Map<string, Set<string>>();
  let source;
  let sourceError: SourceError | undefined;
  try {
    source = await readers[datasetId](
      resolve(manifestDir, entry.source),
      async (rows: CoverageRow[]) => {
        // 업종 차원이 다른 원본도 관찰된 자치구·분기 쌍으로 비교합니다.
        for (const { districtCode, quarterCode } of rows) {
          districts.add(districtCode);
          let quarterDistricts = byQuarter.get(quarterCode);
          if (!quarterDistricts) {
            quarterDistricts = new Set<string>();
            byQuarter.set(quarterCode, quarterDistricts);
          }
          quarterDistricts.add(districtCode);
        }
      },
    );
  } catch (error) {
    if (
      error instanceof DistrictStoreSourceError ||
      error instanceof DistrictSalesSourceError ||
      error instanceof DistrictFootTrafficSourceError
    )
      sourceError = error;
  }

  const checksum = source?.checksum ?? sourceError?.checksum ?? null;
  const checksumVerification = !expectedSha256
    ? 'NOT_PROVIDED'
    : !checksum
      ? 'NOT_CHECKED'
      : checksum === expectedSha256
        ? 'MATCHED'
        : 'MISMATCH';
  const issues: string[] = [];
  if (!source)
    issues.push(
      sourceError && !checksum ? 'SOURCE_UNREADABLE' : 'SOURCE_INVALID',
    );
  else if (source.fetchedRows !== expectedRows)
    issues.push('ROW_COUNT_MISMATCH');
  if (checksumVerification === 'MISMATCH') issues.push('CHECKSUM_MISMATCH');

  const quarters = [...byQuarter.keys()].sort();
  return {
    datasetId,
    status: issues.length ? ('FAIL' as const) : ('PASS' as const),
    issues,
    expectedRows,
    actualRows: source?.fetchedRows ?? null,
    validRows: source?.validRows ?? sourceError?.validRows ?? null,
    rejectedRows: source?.rejectedRows ?? sourceError?.rejectedRows ?? null,
    checksum,
    checksumVerification,
    periodFrom: source?.periodFrom ?? null,
    periodTo: source?.periodTo ?? null,
    coverage: source
      ? {
          quarters,
          districtCodes: [...districts].sort(),
          districtsByQuarter: Object.fromEntries(
            quarters.map((quarter) => [
              quarter,
              [...byQuarter.get(quarter)!].sort(),
            ]),
          ),
        }
      : null,
  };
}

/** 기존 CSV·ZIP 판독기를 순차 실행하고 DB 작업 없이 전체 결과와 커버리지 차이를 반환합니다. */
export async function probeOfficialSources(manifestPath: string) {
  const absolutePath = resolve(manifestPath);
  const manifest = await readManifest(absolutePath);
  const datasets = [];
  for (const entry of manifest.datasets)
    datasets.push(await probeDataset(entry, dirname(absolutePath)));

  const passed = datasets.every(({ status }) => status === 'PASS');
  const [first, ...others] = datasets.map(({ coverage }) => coverage);
  const coverageComparison =
    passed && first
      ? {
          sameQuarters: others.every(
            (coverage) =>
              JSON.stringify(coverage?.quarters) ===
              JSON.stringify(first.quarters),
          ),
          sameDistricts: others.every(
            (coverage) =>
              JSON.stringify(coverage?.districtCodes) ===
              JSON.stringify(first.districtCodes),
          ),
          sameDistrictsByQuarter: others.every(
            (coverage) =>
              JSON.stringify(coverage?.districtsByQuarter) ===
              JSON.stringify(first.districtsByQuarter),
          ),
        }
      : null;
  return {
    mode: 'PROBE',
    status: passed ? 'PASS' : 'FAIL',
    validationScope: 'LOCAL_FILE_FORMAT',
    databaseChecked: false,
    batchCreated: false,
    loadedRows: 0,
    datasets,
    coverageComparison,
  };
}
