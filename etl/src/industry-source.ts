import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import { parse } from 'csv-parse';
import { unzipSync } from 'fflate';
import { z } from 'zod';

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

const maxFileBytes = 512 * 1024 * 1024;
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

/** ZIP을 디스크에 풀지 않으며, 모호한 CSV 선택과 손상된 압축 데이터를 거부합니다. */
function readZip(bytes: Uint8Array): { bytes: Uint8Array; entry: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end -= 1) {
    if (view.getUint32(end, true) === 0x06054b50) break;
  }
  requireValid(
    end >= 0 &&
      end + 22 <= bytes.length &&
      view.getUint32(end, true) === 0x06054b50,
    '잘린 ZIP 종료 레코드입니다.',
  );
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  requireValid(
    view.getUint16(end + 4, true) === 0 &&
      view.getUint16(end + 6, true) === 0 &&
      view.getUint16(end + 8, true) === count &&
      count !== 65535 &&
      offset + directorySize === end &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length,
    '분할·ZIP64·손상된 ZIP 구조는 지원하지 않습니다.',
  );
  const selected: { crc: number; size: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    requireValid(
      offset + 46 <= end && view.getUint32(offset, true) === 0x02014b50,
      '손상된 ZIP 중앙 디렉터리입니다.',
    );
    const nameLength = view.getUint16(offset + 28, true);
    const length =
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    requireValid(offset + length <= end, '잘린 ZIP 항목입니다.');
    // 확장자는 ASCII이므로 비 UTF-8 파일명이 포함된 기존 ZIP도 선택할 수 있습니다.
    const rawName = Buffer.from(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    ).toString('latin1');
    if (/\.csv$/i.test(rawName)) {
      const size = view.getUint32(offset + 24, true);
      const local = view.getUint32(offset + 42, true);
      requireValid(
        (view.getUint16(offset + 8, true) & 1) === 0 &&
          view.getUint16(offset + 34, true) === 0 &&
          size <= maxFileBytes &&
          local + 30 <= bytes.length &&
          view.getUint32(local, true) === 0x04034b50,
        '암호화·대용량·손상된 ZIP CSV는 지원하지 않습니다.',
      );
      const dataOffset =
        local +
        30 +
        view.getUint16(local + 26, true) +
        view.getUint16(local + 28, true);
      requireValid(
        dataOffset + view.getUint32(offset + 20, true) <= offset,
        'ZIP CSV의 압축 길이가 올바르지 않습니다.',
      );
      selected.push({ crc: view.getUint32(offset + 16, true), size });
    }
    offset += length;
  }
  requireValid(
    offset === end && selected.length === 1,
    'ZIP에는 CSV 파일이 정확히 하나 있어야 합니다.',
  );
  const names: string[] = [];
  const contents = unzipSync(bytes, {
    filter(file) {
      if (!/\.csv$/i.test(file.name)) return false;
      names.push(file.name);
      return true;
    },
  });
  requireValid(names.length === 1, 'ZIP CSV 항목을 확인할 수 없습니다.');
  const entry = names[0]!;
  const result = contents[entry]!;
  // fflate의 압축 해제는 CRC를 검사하지 않으므로 저장된 원본 CRC와 별도로 대조합니다.
  requireValid(
    result.length === selected[0]!.size && crc32(result) === selected[0]!.crc,
    'ZIP CSV CRC 검증에 실패했습니다.',
  );
  return { bytes: result, entry };
}

function decode(bytes: Uint8Array): { text: string; encoding: string } {
  requireValid(
    !(bytes[0] === 255 && bytes[1] === 254) &&
      !(bytes[0] === 254 && bytes[1] === 255),
    'UTF-16 CSV는 지원하지 않습니다. UTF-8 또는 CP949 원본을 사용하세요.',
  );
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'UTF-8',
    };
  } catch {
    // BOM이 UTF-8이라고 선언한 파일은 오류를 다른 인코딩으로 감추지 않습니다.
    requireValid(
      !(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191),
      'UTF-8 BOM 뒤의 문자 인코딩이 잘못되었습니다.',
    );
    // WHATWG euc-kr 디코더는 CP949 확장 한글을 포함하며 대체 문자 없이 엄격하게 읽습니다.
    return {
      text: new TextDecoder('euc-kr', { fatal: true }).decode(bytes),
      encoding: 'CP949',
    };
  }
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
      const extension = extname(path).toLowerCase();
      requireValid(
        ['.csv', '.zip'].includes(extension),
        '업종 입력은 .csv 또는 .zip 경로여야 합니다.',
      );
      const bytes = await readFile(path);
      requireValid(
        bytes.length <= maxFileBytes,
        '원본 파일은 512 MiB 이하여야 합니다.',
      );
      inputs.push({
        role,
        path: resolve(path),
        ...(extension === '.zip' ? readZip(bytes) : { bytes }),
      });
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
      const { text, encoding } = decode(input.bytes);
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
