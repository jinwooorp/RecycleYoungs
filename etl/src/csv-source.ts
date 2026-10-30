import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { unzipSync } from 'fflate';

const maxFileBytes = 512 * 1024 * 1024;

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

export function decodeCsv(bytes: Uint8Array): {
  text: string;
  encoding: string;
} {
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

/** CSV 또는 CSV 한 개를 담은 ZIP의 원본 바이트와 출처를 반환합니다. 디스크에 압축을 풀지 않습니다. */
export async function readCsvInput(path: string): Promise<{
  bytes: Uint8Array;
  path: string;
  entry?: string;
}> {
  const extension = extname(path).toLowerCase();
  requireValid(
    ['.csv', '.zip'].includes(extension),
    'CSV 입력은 .csv 또는 .zip 경로여야 합니다.',
  );
  const bytes = await readFile(path);
  requireValid(
    bytes.length <= maxFileBytes,
    '원본 파일은 512 MiB 이하여야 합니다.',
  );
  return {
    path: resolve(path),
    ...(extension === '.zip' ? readZip(bytes) : { bytes }),
  };
}
