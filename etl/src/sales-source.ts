import { createHash } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CsvError, parse } from 'csv-parse';
import { z } from 'zod';
import { csvTextChunks, decodeCsv, readCsvInput } from './csv-source.js';

export type SalesStatRow = {
  dongCode: string;
  industryCode: string;
  quarterCode: string;
  monthlySalesAmount: string | null;
  monthlySalesCount: string | null;
  weekdaySalesAmount: string | null;
  weekendSalesAmount: string | null;
};
export type SalesSource = {
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
export class SalesSourceError extends Error {
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
    this.name = 'SalesSourceError';
    this.fetchedRows = metadata.fetchedRows ?? 0;
    this.validRows = metadata.validRows ?? 0;
    this.rejectedRows = metadata.rejectedRows ?? 0;
    this.checksum = metadata.checksum;
    this.periodFrom = metadata.periodFrom;
    this.periodTo = metadata.periodTo;
  }
}

/**
 * 십진수의 소수점 위치를 문자열로 옮겨 정확한 BIGINT 정수 문자열을 만듭니다.
 * Number로 원래 값을 읽지 않아 .0·지수 표기에서도 큰 정수의 끝자리를 잃지 않습니다.
 */
export function normalizeInteger(value: string): string {
  const match =
    /^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?(?![\s\S])/.exec(
      value,
    );
  if (!match)
    throw new Error('매출액·건수는 0 이상 정수 의미의 십진수여야 합니다.');
  const fraction = match[2] ?? match[3] ?? '';
  const digits = ((match[1] ?? '') + fraction).replace(/^0+/, '');
  // 0은 지수 크기와 무관합니다. 거대한 지수를 전개하거나 불필요한 BigInt로 만들지 않습니다.
  if (!digits) return '0';
  const exponentText = match[4] ?? '0';
  const exponentDigits = exponentText.replace(/^[+-]/, '').replace(/^0+/, '');
  // 원본 길이보다 훨씬 큰 지수는 소수 자릿수로 상쇄할 수 없습니다. 비정상 입력의
  // 거대한 BigInt 생성과 repeat 메모리 할당을 결과 계산 전에 차단합니다.
  if (exponentDigits.length > String(value.length + 19).length)
    throw new Error('지수 표기가 BIGINT 범위를 넘거나 비정수입니다.');
  const shift = BigInt(exponentText) - BigInt(fraction.length);
  let result: string;
  if (shift >= 0n) {
    if (BigInt(digits.length) + shift > 19n)
      throw new Error('매출액·건수가 PostgreSQL BIGINT 범위를 벗어났습니다.');
    // 여기서만 작은 자릿수(최대 18)를 Number로 바꿉니다. 측정값 자체는 변환하지 않습니다.
    result = digits + '0'.repeat(Number(shift));
  } else {
    const remove = -shift;
    if (remove > BigInt(digits.length))
      throw new Error('매출액·건수에 정수가 아닌 소수부가 있습니다.');
    const cut = digits.length - Number(remove);
    if (!/^0*(?![\s\S])/.test(digits.slice(cut)))
      throw new Error('매출액·건수에 정수가 아닌 소수부가 있습니다.');
    result = digits.slice(0, cut);
  }
  if (result.length > 19 || BigInt(result) > 9223372036854775807n)
    throw new Error('매출액·건수가 PostgreSQL BIGINT 범위를 벗어났습니다.');
  return result;
}

const integer = z.string().transform((value, context) => {
  try {
    return normalizeInteger(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : String(error),
    });
    return z.NEVER;
  }
});
// 빈 셀만 NULL로 취급하고 문자 NULL·공백·음수 표기는 임의로 보정하지 않습니다.
const nullableInteger = z.preprocess(
  (value) => (value === '' ? null : value),
  integer.nullable(),
);
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
  monthlySalesAmount: nullableInteger,
  monthlySalesCount: nullableInteger,
  weekdaySalesAmount: nullableInteger,
  weekendSalesAmount: nullableInteger,
});
const aliases: Record<keyof SalesStatRow, readonly string[]> = {
  dongCode: ['행정동_코드', 'ADSTRD_CD'],
  industryCode: ['서비스_업종_코드', 'SVC_INDUTY_CD'],
  quarterCode: ['기준_년분기_코드', 'STDR_YYQU_CD'],
  // 원본의 당월·주중·주말 의미를 보존하며 서로의 합계 일치는 강제하지 않습니다.
  monthlySalesAmount: ['당월_매출_금액', 'THSMON_SELNG_AMT'],
  monthlySalesCount: ['당월_매출_건수', 'THSMON_SELNG_CO'],
  weekdaySalesAmount: ['주중_매출_금액', 'MDWK_SELNG_AMT'],
  weekendSalesAmount: ['주말_매출_금액', 'WKEND_SELNG_AMT'],
};

/**
 * 추정매출 CSV를 검증하며 1000행 이하의 묶음으로 staging 콜백에 전달합니다.
 * 콜백 완료를 기다리므로 DB가 느려도 모든 통계 행을 메모리에 쌓지 않습니다.
 * 호출 측은 전체 판독 성공 전까지 서비스 테이블을 변경하지 않아야 합니다.
 */
export async function readSalesSource(
  path: string,
  onRows: (rows: SalesStatRow[]) => Promise<void>,
): Promise<SalesSource> {
  let fetchedRows = 0;
  let validRows = 0;
  let rejectedRows = 0;
  let checksum: string | undefined;
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  let columns: Partial<Record<keyof SalesStatRow, number>> | undefined;
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
              throw new Error(
                '추정매출 CSV 헤더가 비어 있거나 중복되었습니다.',
              );
            const mapping: Partial<Record<keyof SalesStatRow, number>> = {};
            for (const [field, names] of Object.entries(aliases)) {
              const indices = record.flatMap((name, index) =>
                names.includes(name) ? [index] : [],
              );
              if (indices.length !== 1)
                throw new Error(
                  `추정매출 CSV의 ${field} 헤더가 없거나 모호합니다.`,
                );
              mapping[field as keyof SalesStatRow] = indices[0];
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
          if (keys.has(key))
            throw new Error(`추정매출 통계 복합키 중복: ${key}`);
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
    let batch: SalesStatRow[] = [];
    const flush = async () => {
      if (batch.length) {
        const ready = batch;
        batch = [];
        await onRows(ready);
      }
    };
    const sink = new Writable({
      objectMode: true,
      write(row: SalesStatRow, _encoding, done) {
        batch.push(row);
        if (batch.length < 1000) done();
        else void flush().then(() => done(), done);
      },
      final(done) {
        void flush().then(() => done(), done);
      },
    });
    try {
      await pipeline(
        Readable.from(csvTextChunks(text)),
        parser,
        validator,
        sink,
      );
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
      throw new Error('추정매출 CSV에 통계 데이터가 없습니다.');
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
    throw new SalesSourceError(
      error instanceof Error ? error.message : String(error),
      { fetchedRows, validRows, rejectedRows, checksum, periodFrom, periodTo },
    );
  }
}
