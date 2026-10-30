import { createHash } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CsvError, parse } from 'csv-parse';
import { z } from 'zod';
import { csvTextChunks, decodeCsv, readCsvInput } from './csv-source.js';

export type FootTrafficStatRow = {
  dongCode: string;
  quarterCode: string;
  totalFootTraffic: string | null;
  maleFootTraffic: string | null;
  femaleFootTraffic: string | null;
};
export type FootTrafficSource = {
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

/** 파일·행 검증 또는 staging 실패 시에도 실제 검증 건수를 배치 이력에 전달합니다. */
export class FootTrafficSourceError extends Error {
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
    this.name = 'FootTrafficSourceError';
    this.fetchedRows = metadata.fetchedRows ?? 0;
    this.validRows = metadata.validRows ?? 0;
    this.rejectedRows = metadata.rejectedRows ?? 0;
    this.checksum = metadata.checksum;
    this.periodFrom = metadata.periodFrom;
    this.periodTo = metadata.periodTo;
  }
}

/**
 * 측정값을 Number로 읽지 않고 소수점만 이동해 정확한 NUMERIC 문자열로 만듭니다.
 * PostgreSQL의 정수부 131072자리·소수부 16383자리 한계를 적용하며 반올림하지 않습니다.
 * 표현 가능한 소수부 끝의 0도 보존하고, 정규화 후 소수 자릿수가 한계를 넘으면 거부합니다.
 */
function normalizeNumeric(value: string): string {
  const match =
    /^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?(?![\s\S])/.exec(
      value,
    );
  if (!match) throw new Error('유동인구는 0 이상 유한한 십진수여야 합니다.');
  const fraction = match[2] ?? match[3] ?? '';
  const digits = ((match[1] ?? '') + fraction).replace(/^0+/, '');
  const exponentText = match[4] ?? '0';
  const exponentDigits = exponentText.replace(/^[+-]/, '').replace(/^0+/, '');
  // 입력 길이로도 상쇄할 수 없는 지수는 BigInt·repeat 할당 전에 차단합니다.
  // 모든 유효숫자가 0인 경우 거대한 지수의 값도 정확히 0이므로 전개하지 않습니다.
  if (exponentDigits.length > String(value.length + 131072).length) {
    if (!digits) return '0';
    throw new Error(
      '유동인구 지수 표기가 PostgreSQL NUMERIC 범위를 벗어났습니다.',
    );
  }
  const shift = BigInt(exponentText) - BigInt(fraction.length);
  const scale = shift < 0n ? -shift : 0n;
  const integerDigits = digits ? BigInt(digits.length) + shift : 0n;
  // 표현 범위를 벗어난 지수 표기의 0은 전개 없이 0으로 보존합니다.
  // 지수 없는 소수 표기는 끝의 0을 포함한 원본 scale 한계를 그대로 적용합니다.
  if (!digits && match[4] !== undefined && (shift < -16383n || shift > 131072n))
    return '0';
  if (scale > 16383n || integerDigits > 131072n) {
    throw new Error(
      '유동인구가 PostgreSQL NUMERIC 정수부·소수부 범위를 벗어났습니다.',
    );
  }
  if (!digits) return scale ? '0.' + '0'.repeat(Number(scale)) : '0';
  // 범위를 확인한 뒤에만 최대 NUMERIC 자릿수의 문자열을 할당합니다.
  if (shift >= 0n) return digits + '0'.repeat(Number(shift));
  const decimalPosition = digits.length - Number(scale);
  if (decimalPosition > 0)
    return (
      digits.slice(0, decimalPosition) + '.' + digits.slice(decimalPosition)
    );
  return '0.' + '0'.repeat(-decimalPosition) + digits;
}

const numeric = z.string().transform((value, context) => {
  try {
    return normalizeNumeric(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : String(error),
    });
    return z.NEVER;
  }
});
// 빈 셀만 NULL로 취급합니다. 공백·문자 NULL·음수(-0 포함)·NaN·Infinity는 보정하지 않습니다.
const nullableNumeric = z.preprocess(
  (value) => (value === '' ? null : value),
  numeric.nullable(),
);
const rowSchema = z.object({
  dongCode: z
    .string()
    .length(8)
    .regex(/^[0-9]{8}$/),
  quarterCode: z
    .string()
    .length(5)
    .regex(/^[0-9]{4}[1-4]$/),
  totalFootTraffic: nullableNumeric,
  maleFootTraffic: nullableNumeric,
  femaleFootTraffic: nullableNumeric,
});
const aliases: Record<keyof FootTrafficStatRow, readonly string[]> = {
  dongCode: ['행정동_코드', 'ADSTRD_CD'],
  quarterCode: ['기준_년분기_코드', 'STDR_YYQU_CD'],
  // 원본의 총·성별 측정값을 독립적으로 보존하며 성별 합계 일치를 강제하지 않습니다.
  totalFootTraffic: ['총_유동인구_수', 'TOT_FLPOP_CO'],
  maleFootTraffic: ['남성_유동인구_수', 'ML_FLPOP_CO'],
  femaleFootTraffic: ['여성_유동인구_수', 'FML_FLPOP_CO'],
};

/**
 * CSV를 검증하며 1000행 이하 묶음으로 staging 콜백에 전달하고 완료를 기다립니다.
 * 호출 측은 전체 판독 성공 전까지 서비스 테이블을 변경하지 않아야 합니다.
 */
export async function readFootTrafficSource(
  path: string,
  onRows: (rows: FootTrafficStatRow[]) => Promise<void>,
): Promise<FootTrafficSource> {
  let fetchedRows = 0;
  let validRows = 0;
  let rejectedRows = 0;
  let checksum: string | undefined;
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  let columns: Partial<Record<keyof FootTrafficStatRow, number>> | undefined;
  let rowError = false;
  try {
    const input = await readCsvInput(path);
    checksum = createHash('sha256').update(input.bytes).digest('hex');
    const { text, encoding } = decodeCsv(input.bytes);
    const keys = new Set<string>();
    const parser = parse({ bom: true, max_record_size: 1024 * 1024 });
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
                '유동인구 CSV 헤더가 비어 있거나 중복되었습니다.',
              );
            const mapping: Partial<Record<keyof FootTrafficStatRow, number>> =
              {};
            for (const [field, names] of Object.entries(aliases)) {
              const indices = record.flatMap((name, index) =>
                names.includes(name) ? [index] : [],
              );
              if (indices.length !== 1)
                throw new Error(
                  `유동인구 CSV의 ${field} 헤더가 없거나 모호합니다.`,
                );
              mapping[field as keyof FootTrafficStatRow] = indices[0];
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
          const key = `${row.dongCode}:${row.quarterCode}`;
          if (keys.has(key))
            throw new Error(`유동인구 통계 복합키 중복: ${key}`);
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
    let batch: FootTrafficStatRow[] = [];
    const flush = async () => {
      if (batch.length) {
        const ready = batch;
        batch = [];
        await onRows(ready);
      }
    };
    const sink = new Writable({
      objectMode: true,
      write(row: FootTrafficStatRow, _encoding, done) {
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
      // CSV 구조 오류만 별도로 한 번 세며 staging 콜백 실패는 거부 행으로 세지 않습니다.
      if (columns && !rowError && error instanceof CsvError) {
        fetchedRows += 1;
        rejectedRows += 1;
      }
      throw error;
    }
    if (!columns || !validRows || !periodFrom || !periodTo)
      throw new Error('유동인구 CSV에 통계 데이터가 없습니다.');
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
    throw new FootTrafficSourceError(
      error instanceof Error ? error.message : String(error),
      { fetchedRows, validRows, rejectedRows, checksum, periodFrom, periodTo },
    );
  }
}
