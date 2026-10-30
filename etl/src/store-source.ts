import { createHash } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CsvError, parse } from 'csv-parse';
import { z } from 'zod';
import { decodeCsv, readCsvInput } from './csv-source.js';

export type StoreStatRow = {
  dongCode: string;
  industryCode: string;
  quarterCode: string;
  storeCount: string | null;
  generalStoreCount: string | null;
  franchiseStoreCount: string | null;
  openedStoreCount: string | null;
  closedStoreCount: string | null;
  openingRate: string | null;
  closureRate: string | null;
};
export type StoreSource = {
  checksum: string;
  fetchedRows: number;
  validRows: number;
  rejectedRows: number;
  periodFrom: string;
  periodTo: string;
  path: string;
  entry?: string;
  encoding: string;
};

/** 파일·행 검증 또는 staging 실패 시에도 실제 검증 건수를 배치 이력으로 전달합니다. */
export class StoreSourceError extends Error {
  readonly fetchedRows: number;
  readonly validRows: number;
  readonly rejectedRows: number;
  readonly checksum?: string;
  readonly periodFrom?: string;
  readonly periodTo?: string;

  constructor(
    message: string,
    metadata: {
      fetchedRows?: number;
      validRows?: number;
      rejectedRows?: number;
      checksum?: string;
      periodFrom?: string;
      periodTo?: string;
    } = {},
  ) {
    super(message);
    this.name = 'StoreSourceError';
    this.fetchedRows = metadata.fetchedRows ?? 0;
    this.validRows = metadata.validRows ?? 0;
    this.rejectedRows = metadata.rejectedRows ?? 0;
    this.checksum = metadata.checksum;
    this.periodFrom = metadata.periodFrom;
    this.periodTo = metadata.periodTo;
  }
}

// Number를 거치면 BIGINT나 긴 소수부가 반올림되므로 검증 후에도 원본 문자열을 유지합니다.
// (?![\s\S])는 문자열 끝을 엄격히 검사해 마지막 개행도 숫자 뒤에 허용하지 않습니다.
const count = z
  .string()
  .regex(/^[0-9]+(?![\s\S])/)
  .refine(
    (value) =>
      /^[0-9]+(?![\s\S])/.test(value) && BigInt(value) <= 9223372036854775807n,
    '점포 수는 PostgreSQL BIGINT 범위의 0 이상 정수여야 합니다.',
  );
const rate = z
  .string()
  .regex(/^[0-9]+(?:\.[0-9]+)?(?![\s\S])/)
  .refine((value) => {
    const [integer = '', fraction = ''] = value.split('.');
    return (
      integer.replace(/^0+/, '').length <= 131072 && fraction.length <= 16383
    );
  }, '비율이 PostgreSQL NUMERIC의 정수부·소수부 범위를 벗어났습니다.');
const nullable = (schema: typeof count | typeof rate) =>
  z.preprocess((value) => (value === '' ? null : value), schema.nullable());
const rowSchema = z.object({
  dongCode: z
    .string()
    .length(8)
    .regex(/^[0-9]{8}$/),
  industryCode: z
    .string()
    .length(8)
    .regex(/^CS[0-9]{6}$/),
  quarterCode: z
    .string()
    .length(5)
    .regex(/^[0-9]{4}[1-4]$/),
  storeCount: nullable(count),
  generalStoreCount: nullable(count),
  franchiseStoreCount: nullable(count),
  openedStoreCount: nullable(count),
  closedStoreCount: nullable(count),
  openingRate: nullable(rate),
  closureRate: nullable(rate),
});
const aliases: Record<keyof StoreStatRow, readonly string[]> = {
  dongCode: ['행정동_코드', 'ADSTRD_CD'],
  industryCode: ['서비스_업종_코드', 'SVC_INDUTY_CD'],
  quarterCode: ['기준_년분기_코드', 'STDR_YYQU_CD'],
  // 전체 점포 수와 일반 점포 수를 뒤바꾸지 않습니다. 원본 합계 일치는 강제하지 않습니다.
  storeCount: ['전체_점포_수', 'SIMILR_INDUTY_STOR_CO'],
  generalStoreCount: ['일반_점포_수', 'STOR_CO'],
  franchiseStoreCount: ['프랜차이즈_점포_수', 'FRC_STOR_CO'],
  openedStoreCount: ['개업_점포_수', 'OPBIZ_STOR_CO'],
  closedStoreCount: ['폐업_점포_수', 'CLSBIZ_STOR_CO'],
  openingRate: ['개업_율', 'OPBIZ_RT'],
  closureRate: ['폐업_률', 'CLSBIZ_RT'],
};

/**
 * 점포 CSV를 검증하며 1000행 이하의 묶음으로 staging 콜백에 전달합니다.
 * 콜백 완료를 기다리므로 DB가 느려도 모든 통계 행을 메모리에 쌓지 않습니다.
 * 호출 측은 전체 판독 성공 전까지 서비스 테이블을 변경하지 않아야 합니다.
 */
export async function readStoreSource(
  path: string,
  onRows: (rows: StoreStatRow[]) => Promise<void>,
): Promise<StoreSource> {
  let fetchedRows = 0;
  let validRows = 0;
  let rejectedRows = 0;
  let checksum: string | undefined;
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  let columns: Partial<Record<keyof StoreStatRow, number>> | undefined;
  let rowError = false;
  try {
    const input = await readCsvInput(path);
    checksum = createHash('sha256').update(input.bytes).digest('hex');
    const { text, encoding } = decodeCsv(input.bytes);
    const keys = new Set<string>();
    const parser = parse({ bom: true, max_record_size: 1024 * 1024 });
    // CSV 행을 즉시 검증·변환한 뒤 비동기 staging 단계에 전달합니다.
    const validator = new Transform({
      objectMode: true,
      transform(record: string[], _encoding, done) {
        try {
          if (!columns) {
            if (
              record.some((name) => !name) ||
              new Set(record).size !== record.length
            )
              throw new Error('점포 CSV 헤더가 비어 있거나 중복되었습니다.');
            const mapping: Partial<Record<keyof StoreStatRow, number>> = {};
            for (const [field, names] of Object.entries(aliases)) {
              const indices = record.flatMap((name, index) =>
                names.includes(name) ? [index] : [],
              );
              if (indices.length !== 1)
                throw new Error(
                  `점포 CSV의 ${field} 헤더가 없거나 모호합니다.`,
                );
              mapping[field as keyof StoreStatRow] = indices[0];
            }
            columns = mapping;
            done();
            return;
          }
          fetchedRows += 1;
          const row = rowSchema.parse(
            Object.fromEntries(
              Object.entries(columns).map(([field, index]) => [
                field,
                record[index!],
              ]),
            ),
          );
          const key = `${row.dongCode}:${row.industryCode}:${row.quarterCode}`;
          if (keys.has(key)) throw new Error(`점포 통계 복합키 중복: ${key}`);
          keys.add(key);
          validRows += 1;
          periodFrom =
            !periodFrom || row.quarterCode < periodFrom
              ? row.quarterCode
              : periodFrom;
          periodTo =
            !periodTo || row.quarterCode > periodTo
              ? row.quarterCode
              : periodTo;
          done(null, row);
        } catch (error) {
          rowError = true;
          if (columns) rejectedRows += 1;
          done(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    let batch: StoreStatRow[] = [];
    const flush = async () => {
      if (batch.length) {
        const ready = batch;
        batch = [];
        await onRows(ready);
      }
    };
    const sink = new Writable({
      objectMode: true,
      write(row: StoreStatRow, _encoding, done) {
        batch.push(row);
        if (batch.length < 1000) done();
        else void flush().then(() => done(), done);
      },
      final(done) {
        void flush().then(() => done(), done);
      },
    });
    function* chunks() {
      for (let offset = 0; offset < text.length;) {
        let end = Math.min(offset + 65536, text.length);
        const last = text.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) end += 1;
        yield text.slice(offset, end);
        offset = end;
      }
    }
    try {
      await pipeline(Readable.from(chunks()), parser, validator, sink);
    } catch (error) {
      // CSV 구조 오류는 검증 Transform에 도달하지 않으므로 실패 행을 한 번만 별도로 셉니다.
      // DB 콜백 실패는 검증을 마친 원본 행을 거부 행으로 바꾸지 않습니다.
      if (columns && !rowError && error instanceof CsvError) {
        fetchedRows += 1;
        rejectedRows += 1;
      }
      throw error;
    }
    if (!columns || !validRows || !periodFrom || !periodTo)
      throw new Error('점포 CSV에 통계 데이터가 없습니다.');
    return {
      path: input.path,
      ...(input.entry ? { entry: input.entry } : {}),
      encoding,
      checksum,
      fetchedRows,
      validRows,
      rejectedRows,
      periodFrom,
      periodTo,
    };
  } catch (error) {
    throw new StoreSourceError(
      error instanceof Error ? error.message : String(error),
      { fetchedRows, validRows, rejectedRows, checksum, periodFrom, periodTo },
    );
  }
}
