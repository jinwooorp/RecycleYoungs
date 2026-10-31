import { createHash } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CsvError, parse } from 'csv-parse';
import { z } from 'zod';
import { csvTextChunks, decodeCsv, readCsvInput } from './csv-source.js';
import {
  rowSchema as footTrafficRowSchema,
  FootTrafficSourceError,
  type FootTrafficSource,
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

export type DistrictFootTrafficSource = FootTrafficSource;

/** 원본 검증 실패 시 실제 카운터를 적재 계층에 전달하고 안전한 메시지만 노출한다. */
export class DistrictFootTrafficSourceError extends FootTrafficSourceError {
  constructor(
    message: string,
    metadata: ConstructorParameters<typeof FootTrafficSourceError>[1] = {},
  ) {
    super(message, metadata);
    this.name = 'DistrictFootTrafficSourceError';
  }
}

/** 원문·경로·라이브러리 오류를 포함하지 않는 내부 검증 오류만 외부에 전달합니다. */
class ProbeValidationError extends Error {}

/**
 * OA-22179 전체 입력을 검증하고 최대 1000행씩 순차 전달합니다.
 * 콜백의 완료를 기다려 staging이 파일 판독을 뒤쫓아 메모리에 쌓이지 않게 합니다.
 * DB 및 게시 여부는 호출 측 책임이며 전체 성공 전까지 서비스 테이블을 변경하면 안 됩니다.
 */
export async function readDistrictFootTrafficSource(
  path: string,
  onRows: (rows: DistrictFootTrafficStatRow[]) => Promise<void>,
): Promise<DistrictFootTrafficSource> {
  let fetchedRows = 0;
  let validRows = 0;
  let rejectedRows = 0;
  let checksum: string | undefined;
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  let columns:
    Partial<Record<keyof DistrictFootTrafficStatRow, number>> | undefined;
  let headerLength = 0;
  let rowError = false;
  try {
    let input: Awaited<ReturnType<typeof readCsvInput>>;
    let text: string;
    let encoding: string;
    try {
      input = await readCsvInput(path);
      checksum = createHash('sha256').update(input.bytes).digest('hex');
      ({ text, encoding } = decodeCsv(input.bytes));
    } catch {
      throw new ProbeValidationError(
        '자치구 길단위인구 원본 파일을 읽거나 해석할 수 없습니다.',
      );
    }
    const keys = new Set<string>();
    const parser = parse({ bom: true, max_record_size: 1024 * 1024 });
    const validator = new Transform({
      objectMode: true,
      transform(record: string[], _encoding, done) {
        try {
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
            headerLength = record.length;
            columns = mapping;
            done();
            return;
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
          done(
            error instanceof ProbeValidationError
              ? error
              : new ProbeValidationError(
                  '자치구 길단위인구 CSV 행을 검증할 수 없습니다.',
                ),
          );
        }
      },
    });
    let batch: DistrictFootTrafficStatRow[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const ready = batch;
      batch = [];
      await onRows(ready);
    };
    const sink = new Writable({
      objectMode: true,
      write(row: DistrictFootTrafficStatRow, _encoding, done) {
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
      if (error instanceof ProbeValidationError) throw error;
      if (error instanceof CsvError) {
        if (columns && !rowError) {
          fetchedRows += 1;
          rejectedRows += 1;
        }
        throw new Error(
          `자치구 길단위인구 CSV의 ${fetchedRows || 1}번째 데이터 행 구조가 올바르지 않습니다.`,
          { cause: error },
        );
      }
      // 콜백의 DB 오류 원문에는 접속정보나 SQL이 포함될 수 있어 고정 메시지만 전달합니다.
      throw new Error('자치구 길단위인구 staging 처리에 실패했습니다.', {
        cause: error,
      });
    }
    if (!columns || !validRows || !periodFrom || !periodTo)
      throw new ProbeValidationError(
        '자치구 길단위인구 CSV에 통계 데이터가 없습니다.',
      );
    return {
      path: input.path,
      ...(input.entry ? { entry: input.entry } : {}),
      encoding,
      checksum: checksum!,
      fetchedRows,
      validRows,
      rejectedRows,
      periodFrom,
      periodTo,
    };
  } catch (error) {
    throw new DistrictFootTrafficSourceError(
      error instanceof Error
        ? error.message
        : '자치구 길단위인구 입력 검증에 실패했습니다.',
      { fetchedRows, validRows, rejectedRows, checksum, periodFrom, periodTo },
    );
  }
}

/** DB 없이 전체 입력을 검증한 뒤 최대 5행만 반환합니다. */
export async function probeDistrictFootTrafficSource(
  options: DistrictFootTrafficProbeOptions,
): Promise<DistrictFootTrafficProbeResult> {
  if (options.probe !== true)
    throw new Error(
      '자치구 길단위인구 원본 검증에는 probe 모드(--probe)가 필요합니다.',
    );
  if (!Number.isSafeInteger(options.expectedRows) || options.expectedRows <= 0)
    throw new Error('예상 행 수는 양의 안전한 정수여야 합니다.');
  const sample: DistrictFootTrafficStatRow[] = [];
  const source = await readDistrictFootTrafficSource(
    options.source,
    async (rows) => {
      sample.push(...rows.slice(0, 5 - sample.length));
    },
  );
  if (source.fetchedRows !== options.expectedRows)
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
    fetchedRows: source.fetchedRows,
    validRows: source.validRows,
    rejectedRows: 0,
    periodFrom: source.periodFrom,
    periodTo: source.periodTo,
    checksum: source.checksum,
    encoding: source.encoding,
    sample,
  };
}
