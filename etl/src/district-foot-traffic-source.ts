import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { csvTextChunks, decodeCsv, readCsvInput } from './csv-source.js';
import {
  rowSchema as footTrafficRowSchema,
  type FootTrafficStatRow,
} from './foot-traffic-source.js';

export type DistrictFootTrafficStatRow = Omit<
  FootTrafficStatRow,
  'dongCode'
> & {
  districtCode: string;
};

export type DistrictFootTrafficProbeOptions = {
  source: string;
  expectedRows: number;
  probe: true;
};

export type DistrictFootTrafficProbeResult = {
  mode: 'PROBE';
  datasetId: 'OA-22179';
  serviceName: 'VwsmSignguFlpopW';
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
  sample: DistrictFootTrafficStatRow[];
};

// 기존 NUMERIC 정규화·범위·NULL 규칙은 그대로 사용하고 행정동 대신 자치구만 검증합니다.
const rowSchema = footTrafficRowSchema.omit({ dongCode: true }).extend({
  districtCode: z
    .string()
    .length(5)
    .regex(/^[0-9]{5}$/),
});
const aliases: Record<keyof DistrictFootTrafficStatRow, readonly string[]> = {
  districtCode: ['자치구_코드', 'SIGNGU_CD'],
  quarterCode: ['기준_년분기_코드', 'STDR_YYQU_CD'],
  totalFootTraffic: ['총_유동인구_수', 'TOT_FLPOP_CO'],
  maleFootTraffic: ['남성_유동인구_수', 'ML_FLPOP_CO'],
  femaleFootTraffic: ['여성_유동인구_수', 'FML_FLPOP_CO'],
};

/** 원문·로컬 경로·라이브러리 오류를 포함하지 않는 검증 오류만 출력합니다. */
class ProbeValidationError extends Error {}

/** OA-22179 전체 파일을 검증하고 최대 5행만 반환합니다. DB·네트워크를 호출하지 않습니다. */
export async function probeDistrictFootTrafficSource(
  options: DistrictFootTrafficProbeOptions,
): Promise<DistrictFootTrafficProbeResult> {
  if (options.probe !== true)
    throw new Error(
      '자치구 길단위인구 원본 검증에는 probe 모드(--probe)가 필요합니다.',
    );
  if (!Number.isSafeInteger(options.expectedRows) || options.expectedRows <= 0)
    throw new Error('예상 행 수는 양의 안전한 정수여야 합니다.');
  let bytes: Uint8Array;
  let text: string;
  let encoding: string;
  try {
    ({ bytes } = await readCsvInput(options.source));
    ({ text, encoding } = decodeCsv(bytes));
  } catch {
    throw new Error('자치구 길단위인구 원본 파일을 읽거나 해석할 수 없습니다.');
  }
  const sample: DistrictFootTrafficStatRow[] = [];
  const keys = new Set<string>();
  let columns:
    Partial<Record<keyof DistrictFootTrafficStatRow, number>> | undefined;
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
            '자치구 길단위인구 CSV 헤더가 비어 있거나 중복되었습니다.',
          );
        const mapping: Partial<
          Record<keyof DistrictFootTrafficStatRow, number>
        > = {};
        for (const [field, names] of Object.entries(aliases)) {
          const indices = record.flatMap((name, index) =>
            names.includes(name) ? [index] : [],
          );
          if (indices.length !== 1)
            throw new ProbeValidationError(
              '자치구 길단위인구 CSV 필수 헤더가 없거나 모호합니다.',
            );
          mapping[field as keyof DistrictFootTrafficStatRow] = indices[0];
        }
        columns = mapping;
        headerLength = record.length;
        continue;
      }
      fetchedRows += 1;
      if (record.length !== headerLength)
        throw new ProbeValidationError(
          `자치구 길단위인구 CSV의 ${fetchedRows}번째 데이터 행 구조가 올바르지 않습니다.`,
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
          `자치구 길단위인구 CSV의 ${fetchedRows}번째 데이터 행 필수 코드 또는 수치 형식이 올바르지 않습니다.`,
        );
      const row = parsed.data;
      const key = `${row.districtCode}:${row.quarterCode}`;
      if (keys.has(key))
        throw new ProbeValidationError(
          `자치구 길단위인구 CSV의 ${fetchedRows}번째 데이터 행 복합키가 중복되었습니다.`,
        );
      keys.add(key);
      periodFrom =
        !periodFrom || row.quarterCode < periodFrom
          ? row.quarterCode
          : periodFrom;
      periodTo =
        !periodTo || row.quarterCode > periodTo ? row.quarterCode : periodTo;
      // 표본 수에 도달해도 전체 검증을 계속하며 성별·기타 분류의 합계를 보정하지 않습니다.
      if (sample.length < 5) sample.push(row);
    }
  } catch (error) {
    if (error instanceof ProbeValidationError) throw error;
    throw new Error('자치구 길단위인구 CSV 구조를 검증할 수 없습니다.', {
      cause: error,
    });
  }
  if (!columns || !fetchedRows || !periodFrom || !periodTo)
    throw new Error('자치구 길단위인구 CSV에 통계 데이터가 없습니다.');
  if (fetchedRows !== options.expectedRows)
    throw new Error(
      '예상 행 수와 자치구 길단위인구 CSV의 실제 행 수가 일치하지 않습니다.',
    );
  return {
    mode: 'PROBE',
    datasetId: 'OA-22179',
    serviceName: 'VwsmSignguFlpopW',
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
