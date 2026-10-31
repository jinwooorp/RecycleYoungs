import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CsvError, parse } from 'csv-parse';
import { z } from 'zod';
import { csvTextChunks, decodeCsv, readCsvInput } from './csv-source.js';
import { normalizeInteger } from './sales-source.js';
import {
  rowSchema as storeRowSchema,
  type StoreStatRow,
} from './store-source.js';

export type DistrictStoreStatRow = Omit<StoreStatRow, 'dongCode'> & {
  districtCode: string;
};

export type DistrictStoreProbeOptions = {
  source: string;
  expectedRows: number;
  probe: true;
};

export type DistrictStoreProbeResult = {
  mode: 'PROBE';
  datasetId: 'OA-22173';
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
  sample: DistrictStoreStatRow[];
};

const integer = z.string().transform((value, context) => {
  try {
    return normalizeInteger(value);
  } catch {
    // 공용 정규화기의 오류에 원문이나 다른 데이터셋 명칭이 들어가지 않도록 제한합니다.
    context.addIssue({
      code: 'custom',
      message: '점포 수 형식이 올바르지 않습니다.',
    });
    return z.NEVER;
  }
});
const nullableInteger = z.preprocess(
  (value) => (value === '' ? null : value),
  integer.nullable(),
);
// 비율은 기존 점포 계약의 정밀도·NUMERIC 한계를 그대로 사용합니다.
// 자치구를 행정동으로 보정하거나 FK 존재 여부를 추정하지 않습니다.
const districtRowSchema = storeRowSchema.omit({ dongCode: true }).extend({
  districtCode: z
    .string()
    .length(5)
    .regex(/^[0-9]{5}$/),
  storeCount: nullableInteger,
  generalStoreCount: nullableInteger,
  franchiseStoreCount: nullableInteger,
  openedStoreCount: nullableInteger,
  closedStoreCount: nullableInteger,
});

const aliases: Record<keyof DistrictStoreStatRow, readonly string[]> = {
  districtCode: ['자치구_코드', 'SIGNGU_CD'],
  industryCode: ['서비스_업종_코드', 'SVC_INDUTY_CD'],
  quarterCode: ['기준_년분기_코드', 'STDR_YYQU_CD'],
  storeCount: ['전체_점포_수', 'SIMILR_INDUTY_STOR_CO'],
  generalStoreCount: ['일반_점포_수', 'STOR_CO'],
  franchiseStoreCount: ['프랜차이즈_점포_수', 'FRC_STOR_CO'],
  openedStoreCount: ['개업_점포_수', 'OPBIZ_STOR_CO'],
  closedStoreCount: ['폐업_점포_수', 'CLSBIZ_STOR_CO'],
  openingRate: ['개업_율', 'OPBIZ_RT'],
  closureRate: ['폐업_률', 'CLSBIZ_RT'],
};

/** 원문·경로·라이브러리 오류를 포함하지 않는 내부 검증 오류만 외부에 전달합니다. */
class ProbeValidationError extends Error {}

/**
 * OA-22173 로컬 파일의 전체 행 형식만 검증합니다. DB·배치에는 접근하지 않습니다.
 * 중복 확인용 키와 최대 5개 샘플만 보관하며 공식 원본·FK 검증 성공으로 해석하지 않습니다.
 */
export async function probeDistrictStoreSource(
  options: DistrictStoreProbeOptions,
): Promise<DistrictStoreProbeResult> {
  if (!Number.isSafeInteger(options.expectedRows) || options.expectedRows <= 0)
    throw new Error('예상 행 수는 양의 안전한 정수여야 합니다.');
  if (options.probe !== true)
    throw new Error('자치구 점포 원본 검증에는 probe 모드가 필요합니다.');

  let bytes: Uint8Array;
  let text: string;
  let encoding: string;
  try {
    ({ bytes } = await readCsvInput(options.source));
    ({ text, encoding } = decodeCsv(bytes));
  } catch {
    throw new Error('자치구 점포 원본 파일을 읽거나 해석할 수 없습니다.');
  }
  const checksum = createHash('sha256').update(bytes).digest('hex');
  let columns: Partial<Record<keyof DistrictStoreStatRow, number>> | undefined;
  let headerLength = 0;
  let fetchedRows = 0;
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  const keys = new Set<string>();
  const sample: DistrictStoreStatRow[] = [];
  const parser = parse({ bom: true, max_record_size: 1024 * 1024 });
  const validator = new Writable({
    objectMode: true,
    write(record: string[], _encoding, done) {
      try {
        if (!columns) {
          if (
            record.some((name) => !name.trim()) ||
            new Set(record).size !== record.length
          )
            throw new ProbeValidationError(
              '자치구 점포 CSV 헤더가 비어 있거나 중복되었습니다.',
            );
          const mapping: Partial<Record<keyof DistrictStoreStatRow, number>> =
            {};
          for (const [field, names] of Object.entries(aliases)) {
            const indices = record.flatMap((name, index) =>
              names.includes(name) ? [index] : [],
            );
            if (indices.length !== 1)
              throw new ProbeValidationError(
                '자치구 점포 CSV 필수 헤더가 없거나 모호합니다.',
              );
            mapping[field as keyof DistrictStoreStatRow] = indices[0];
          }
          headerLength = record.length;
          columns = mapping;
          done();
          return;
        }
        fetchedRows += 1;
        if (record.length !== headerLength)
          throw new ProbeValidationError(
            `자치구 점포 CSV의 ${fetchedRows}번째 데이터 행 구조가 올바르지 않습니다.`,
          );
        const parsed = districtRowSchema.safeParse(
          Object.fromEntries(
            Object.entries(columns).map(([field, index]) => [
              field,
              record[index!],
            ]),
          ),
        );
        if (!parsed.success)
          throw new ProbeValidationError(
            `자치구 점포 CSV의 ${fetchedRows}번째 데이터 행 필수 코드 또는 수치 형식이 올바르지 않습니다.`,
          );
        const row = parsed.data;
        const key = `${row.districtCode}:${row.quarterCode}:${row.industryCode}`;
        if (keys.has(key))
          throw new ProbeValidationError(
            `자치구 점포 CSV의 ${fetchedRows}번째 데이터 행 복합키가 중복되었습니다.`,
          );
        keys.add(key);
        periodFrom =
          !periodFrom || row.quarterCode < periodFrom
            ? row.quarterCode
            : periodFrom;
        periodTo =
          !periodTo || row.quarterCode > periodTo ? row.quarterCode : periodTo;
        if (sample.length < 5) sample.push(row);
        done();
      } catch (error) {
        done(
          error instanceof ProbeValidationError
            ? error
            : new ProbeValidationError(
                '자치구 점포 CSV 행을 검증할 수 없습니다.',
              ),
        );
      }
    },
  });
  try {
    await pipeline(Readable.from(csvTextChunks(text)), parser, validator);
  } catch (error) {
    if (error instanceof ProbeValidationError) throw error;
    if (error instanceof CsvError)
      throw new Error(
        `자치구 점포 CSV의 ${fetchedRows + 1}번째 데이터 행 구조가 올바르지 않습니다.`,
        // 원인은 내부 진단용으로 보존하고 CLI에는 이 고정 메시지만 출력합니다.
        { cause: error },
      );
    throw new Error('자치구 점포 CSV 구조를 검증할 수 없습니다.', {
      cause: error,
    });
  }
  if (!columns || !fetchedRows || !periodFrom || !periodTo)
    throw new Error('자치구 점포 CSV에 통계 데이터가 없습니다.');
  if (fetchedRows !== options.expectedRows)
    throw new Error(
      '예상 행 수와 자치구 점포 CSV의 실제 행 수가 일치하지 않습니다.',
    );
  return {
    mode: 'PROBE',
    datasetId: 'OA-22173',
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
    checksum,
    encoding,
    sample,
  };
}
