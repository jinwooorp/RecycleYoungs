import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { csvTextChunks, decodeCsv, readCsvInput } from './csv-source.js';
import { normalizeInteger, type SalesStatRow } from './sales-source.js';

export type DistrictSalesStatRow = Omit<SalesStatRow, 'dongCode'> & {
  districtCode: string;
};

export type DistrictSalesProbeOptions = {
  source: string;
  expectedRows: number;
  probe: true;
};

export type DistrictSalesProbeResult = {
  mode: 'PROBE';
  datasetId: 'OA-22176';
  serviceName: 'VwsmSignguSelngW';
  validationScope: 'LOCAL_FILE_FORMAT';
  databaseChecked: false;
  batchCreated: false;
  loadedRows: 0;
  expectedRows: number;
  fetchedRows: number;
  validRows: number;
  rejectedRows: 0;
  periodFrom: string;
  periodTo: string;
  checksum: string;
  encoding: string;
  sample: DistrictSalesStatRow[];
};

const integer = z.string().transform((value, context) => {
  try {
    // 기존 행정동 매출과 같은 정수 의미·BIGINT 범위를 사용하고 Number로 읽지 않는다.
    return normalizeInteger(value);
  } catch {
    context.addIssue({
      code: 'custom',
      message: '매출 수치 형식이 올바르지 않습니다.',
    });
    return z.NEVER;
  }
});
const nullableInteger = z.preprocess(
  (value) => (value === '' ? null : value),
  integer.nullable(),
);
const rowSchema = z.object({
  districtCode: z
    .string()
    .length(5)
    .regex(/^[0-9]{5}$/),
  industryCode: z
    .string()
    .length(8)
    .regex(/^CS[0-9]{6}$/),
  quarterCode: z
    .string()
    .length(5)
    .regex(/^[0-9]{4}[1-4]$/),
  monthlySalesAmount: nullableInteger,
  monthlySalesCount: nullableInteger,
  weekdaySalesAmount: nullableInteger,
  weekendSalesAmount: nullableInteger,
});
const aliases: Record<keyof DistrictSalesStatRow, readonly string[]> = {
  districtCode: ['자치구_코드', 'SIGNGU_CD'],
  industryCode: ['서비스_업종_코드', 'SVC_INDUTY_CD'],
  quarterCode: ['기준_년분기_코드', 'STDR_YYQU_CD'],
  monthlySalesAmount: ['당월_매출_금액', 'THSMON_SELNG_AMT'],
  monthlySalesCount: ['당월_매출_건수', 'THSMON_SELNG_CO'],
  weekdaySalesAmount: ['주중_매출_금액', 'MDWK_SELNG_AMT'],
  weekendSalesAmount: ['주말_매출_금액', 'WKEND_SELNG_AMT'],
};

/** 라이브러리의 오류 원문·원본 값·로컬 경로를 외부 오류 메시지에 포함하지 않는다. */
class ProbeValidationError extends Error {}

/** OA-22176 전체 파일을 읽기 전용으로 검증한다. DB·네트워크·적재 기능은 호출하지 않는다. */
export async function probeDistrictSalesSource(
  options: DistrictSalesProbeOptions,
): Promise<DistrictSalesProbeResult> {
  if (options.probe !== true)
    throw new Error('자치구 추정매출 원본 검증에는 probe 모드가 필요합니다.');
  if (!Number.isSafeInteger(options.expectedRows) || options.expectedRows <= 0)
    throw new Error('예상 행 수는 양의 안전한 정수여야 합니다.');

  let bytes: Uint8Array;
  let text: string;
  let encoding: string;
  try {
    ({ bytes } = await readCsvInput(options.source));
    ({ text, encoding } = decodeCsv(bytes));
  } catch {
    throw new Error('자치구 추정매출 원본 파일을 읽거나 해석할 수 없습니다.');
  }

  const sample: DistrictSalesStatRow[] = [];
  const keys = new Set<string>();
  let columns: Partial<Record<keyof DistrictSalesStatRow, number>> | undefined;
  let headerLength = 0;
  let fetchedRows = 0;
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  const parser = Readable.from(csvTextChunks(text)).pipe(
    parse({ bom: true, max_record_size: 1024 * 1024 }),
  );
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      if (!columns) {
        if (
          record.some((name) => !name.trim()) ||
          new Set(record).size !== record.length
        )
          throw new ProbeValidationError(
            '자치구 추정매출 CSV 헤더가 비어 있거나 중복되었습니다.',
          );
        const mapping: Partial<Record<keyof DistrictSalesStatRow, number>> = {};
        for (const [field, names] of Object.entries(aliases)) {
          const indices = record.flatMap((name, index) =>
            names.includes(name) ? [index] : [],
          );
          if (indices.length !== 1)
            throw new ProbeValidationError(
              '자치구 추정매출 CSV 필수 헤더가 없거나 모호합니다.',
            );
          mapping[field as keyof DistrictSalesStatRow] = indices[0];
        }
        columns = mapping;
        headerLength = record.length;
        continue;
      }
      fetchedRows += 1;
      if (record.length !== headerLength)
        throw new ProbeValidationError(
          `자치구 추정매출 CSV의 ${fetchedRows}번째 데이터 행 구조가 올바르지 않습니다.`,
        );
      const parsed = rowSchema.safeParse(
        Object.fromEntries(
          Object.entries(columns).map(([field, index]) => [
            field,
            record[index!],
          ]),
        ),
      );
      if (!parsed.success)
        throw new ProbeValidationError(
          `자치구 추정매출 CSV의 ${fetchedRows}번째 데이터 행 필수 코드 또는 수치 형식이 올바르지 않습니다.`,
        );
      const row = parsed.data;
      const key = `${row.districtCode}:${row.industryCode}:${row.quarterCode}`;
      if (keys.has(key))
        throw new ProbeValidationError(
          `자치구 추정매출 CSV의 ${fetchedRows}번째 데이터 행 복합키가 중복되었습니다.`,
        );
      keys.add(key);
      periodFrom =
        !periodFrom || row.quarterCode < periodFrom
          ? row.quarterCode
          : periodFrom;
      periodTo =
        !periodTo || row.quarterCode > periodTo ? row.quarterCode : periodTo;
      // 표본 제한 뒤에도 전체 행을 검증하며 미채택 컬럼이나 계산한 수치를 만들지 않는다.
      if (sample.length < 5) sample.push(row);
    }
  } catch (error) {
    if (error instanceof ProbeValidationError) throw error;
    throw new Error('자치구 추정매출 CSV 구조를 검증할 수 없습니다.', {
      cause: error,
    });
  }
  if (!columns || !fetchedRows || !periodFrom || !periodTo)
    throw new Error('자치구 추정매출 CSV에 통계 데이터가 없습니다.');
  if (fetchedRows !== options.expectedRows)
    throw new Error(
      '예상 행 수와 자치구 추정매출 CSV의 실제 행 수가 일치하지 않습니다.',
    );
  return {
    mode: 'PROBE',
    datasetId: 'OA-22176',
    serviceName: 'VwsmSignguSelngW',
    validationScope: 'LOCAL_FILE_FORMAT',
    databaseChecked: false,
    batchCreated: false,
    loadedRows: 0,
    expectedRows: options.expectedRows,
    fetchedRows,
    validRows: fetchedRows,
    rejectedRows: 0,
    periodFrom,
    periodTo,
    checksum: createHash('sha256').update(bytes).digest('hex'),
    encoding,
    sample,
  };
}
