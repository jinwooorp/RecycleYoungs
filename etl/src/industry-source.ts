import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { decodeCsv, readCsvInput } from './csv-source.js';

export type IndustryInput = {
  source: string;
  salesSource?: string;
};
export type IndustrySource = {
  checksum: string;
  industries: { industryCode: string; industryName: string }[];
  fetchedRows: number;
  validRows: number;
  rejectedRows: number;
  sources: {
    role: 'stores' | 'sales';
    path: string;
    entry?: string;
    encoding: string;
    rows: number;
    industries: number;
  }[];
};

/** 원본 검증에 실패해도 배치 이력에 실제로 확인한 건수와 체크섬을 전달합니다. */
export class IndustrySourceError extends Error {
  readonly fetchedRows: number;
  readonly validRows: number;
  readonly rejectedRows: number;
  readonly checksum?: string;

  constructor(
    message: string,
    metadata: {
      fetchedRows?: number;
      validRows?: number;
      rejectedRows?: number;
      checksum?: string;
    } = {},
  ) {
    super(message);
    this.name = 'IndustrySourceError';
    this.fetchedRows = metadata.fetchedRows ?? 0;
    this.validRows = metadata.validRows ?? 0;
    this.rejectedRows = metadata.rejectedRows ?? 0;
    this.checksum = metadata.checksum;
  }
}

const industrySchema = z.object({
  industryCode: z.string().regex(/^CS[0-9]{6}$/),
  // 앞뒤 공백을 자동 제거하면 서로 다른 원본 명칭의 충돌이 숨겨질 수 있어 그대로 거부합니다.
  industryName: z
    .string()
    .min(1)
    .refine(
      (value) => value === value.trim() && !/[\p{Cc}\uFFFD]/u.test(value),
      '업종 명칭의 공백·제어 문자·대체 문자를 확인하세요.',
    ),
});

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * 점포를 기본 원본으로 읽고 선택적 매출 원본의 업종을 합칩니다.
 * 통계 값은 적재하지 않으며, 동일 코드의 명칭 충돌은 원본 내부·원본 사이 모두 실패합니다.
 */
export async function readIndustrySource(
  options: IndustryInput,
): Promise<IndustrySource> {
  let checksum: string | undefined;
  let fetchedRows = 0;
  let validRows = 0;
  let rejectedRows = 0;
  try {
    const inputs: {
      role: 'stores' | 'sales';
      path: string;
      bytes: Uint8Array;
      entry?: string;
    }[] = [];
    for (const [role, path] of [
      ['stores', options.source],
      ['sales', options.salesSource],
    ] as const) {
      if (path === undefined) continue;
      inputs.push({ role, ...(await readCsvInput(path)) });
    }
    // 원본 역할과 바이트 길이를 포함해 점포·매출 구분과 파일 경계를 보존합니다.
    // 경로·ZIP 포장 메타데이터는 제외하므로 같은 CSV를 다른 경로로 옮겨도 같은 체크섬입니다.
    const hash = createHash('sha256');
    for (const input of inputs)
      hash.update(`${input.role}:${input.bytes.length}:`).update(input.bytes);
    checksum = hash.digest('hex');
    const industries = new Map<string, string>();
    const sources: IndustrySource['sources'] = [];
    for (const input of inputs) {
      const { text, encoding } = decodeCsv(input.bytes);
      let columns: string[] | undefined;
      let codeIndex = -1;
      let nameIndex = -1;
      let rows = 0;
      let rowError = false;
      const codes = new Set<string>();
      const parser = parse({ bom: true, max_record_size: 1024 * 1024 });
      parser.on('data', (record: string[]) => {
        if (rowError) return;
        try {
          if (!columns) {
            requireValid(
              record.length > 0 &&
                record.every((name) => name.length > 0) &&
                new Set(record).size === record.length,
              'CSV 헤더가 비어 있거나 중복되었습니다.',
            );
            const codeIndices = record
              .map((name, index) =>
                ['SVC_INDUTY_CD', '서비스_업종_코드'].includes(name)
                  ? index
                  : -1,
              )
              .filter((index) => index >= 0);
            const nameIndices = record
              .map((name, index) =>
                ['SVC_INDUTY_CD_NM', '서비스_업종_코드_명'].includes(name)
                  ? index
                  : -1,
              )
              .filter((index) => index >= 0);
            requireValid(
              codeIndices.length === 1 && nameIndices.length === 1,
              'CSV의 업종 코드·명칭 헤더가 없거나 모호합니다.',
            );
            codeIndex = codeIndices[0]!;
            nameIndex = nameIndices[0]!;
            columns = record;
            return;
          }
          fetchedRows += 1;
          const industry = industrySchema.parse({
            industryCode: record[codeIndex],
            industryName: record[nameIndex],
          });
          const previous = industries.get(industry.industryCode);
          requireValid(
            previous === undefined || previous === industry.industryName,
            `같은 업종 코드의 명칭이 다릅니다: ${industry.industryCode}`,
          );
          industries.set(industry.industryCode, industry.industryName);
          codes.add(industry.industryCode);
          validRows += 1;
          rows += 1;
        } catch (error) {
          rowError = true;
          if (columns) rejectedRows += 1;
          parser.destroy(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
      // 전체 레코드를 배열로 만들지 않고 작은 조각으로 공급합니다. data 이벤트에서 즉시
      // 검증해 같은 조각 뒤쪽의 CSV 오류가 앞서 검증한 행 수를 지우지 않게 합니다.
      function* chunks() {
        for (let offset = 0; offset < text.length;) {
          let end = Math.min(offset + 65536, text.length);
          // UTF-16 문자열의 서로게이트 쌍을 자르면 스트림의 UTF-8 변환에서 문자가 손상됩니다.
          const last = text.charCodeAt(end - 1);
          if (last >= 0xd800 && last <= 0xdbff) end += 1;
          yield text.slice(offset, end);
          offset = end;
        }
      }
      try {
        await pipeline(Readable.from(chunks()), parser);
      } catch (error) {
        // CSV 문법·열 수 오류는 data 이벤트에 도달하지 않으므로 현재 실패 행을 따로 셉니다.
        if (columns && !rowError) {
          fetchedRows += 1;
          rejectedRows += 1;
        }
        throw new Error(
          `${input.role} 원본: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      requireValid(
        columns && rows > 0,
        `${input.role} CSV에 업종 데이터가 없습니다.`,
      );
      sources.push({
        role: input.role,
        path: input.path,
        ...(input.entry ? { entry: input.entry } : {}),
        encoding,
        rows,
        industries: codes.size,
      });
    }
    return {
      checksum,
      fetchedRows,
      validRows,
      rejectedRows,
      sources,
      industries: [...industries]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([industryCode, industryName]) => ({
          industryCode,
          industryName,
        })),
    };
  } catch (error) {
    throw new IndustrySourceError(
      error instanceof Error ? error.message : String(error),
      {
        checksum,
        fetchedRows,
        validRows,
        rejectedRows,
      },
    );
  }
}
