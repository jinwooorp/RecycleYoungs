import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndustrySourceError, readIndustrySource } from './industry-source.js';

// 파일 생성 없이 IO 경계만 대체합니다. CSV·ZIP 판독과 업종 검증은 실제 구현을 실행합니다.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
const files = new Map<string, Uint8Array>();
const encode = (text: string) => new TextEncoder().encode(text);
const header = 'SVC_INDUTY_CD,SVC_INDUTY_CD_NM';
const koreanHeader = '서비스_업종_코드,서비스_업종_코드_명';
const csv = (rows: string) => encode(`${header}\n${rows}`);

beforeEach(() => {
  files.clear();
  vi.mocked(readFile).mockImplementation(async (path) => {
    const contents = files.get(String(path));
    if (!contents) throw new Error('ENOENT: input file not found');
    return Buffer.from(contents);
  });
});

describe('서비스 업종 원본 판독', () => {
  it('반복 업종을 허용하고 원본 행 수와 고유 업종 수를 구분한다', async () => {
    files.set(
      'stores.csv',
      csv('CS100010,커피-음료\nCS100010,커피-음료\nCS100001,한식음식점'),
    );
    const result = await readIndustrySource({ source: 'stores.csv' });
    expect(result).toMatchObject({
      fetchedRows: 3,
      validRows: 3,
      rejectedRows: 0,
    });
    expect(result.industries).toEqual([
      { industryCode: 'CS100001', industryName: '한식음식점' },
      { industryCode: 'CS100010', industryName: '커피-음료' },
    ]);
    expect(result.sources).toMatchObject([
      { role: 'stores', encoding: 'UTF-8', rows: 3, industries: 2 },
    ]);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('UTF-8 BOM·한글 헤더·인용부호·쉼표·다른 컬럼 안의 개행을 올바르게 읽는다', async () => {
    files.set(
      'stores.csv',
      encode(
        `\uFEFF${koreanHeader},비고\r\nCS100010,"커피, ""음료""","두 줄\r\n설명"\r\n`,
      ),
    );
    expect(await readIndustrySource({ source: 'stores.csv' })).toMatchObject({
      fetchedRows: 1,
      validRows: 1,
      industries: [{ industryCode: 'CS100010', industryName: '커피, "음료"' }],
    });
  });

  it('실제 원본과 같은 CP949의 한글 헤더와 명칭을 보존한다', async () => {
    // CP949로 인코딩한 고정 바이트입니다. UTF-8 대체 문자로 손상된 이름을 만들면 실패합니다.
    files.set(
      'stores.csv',
      Buffer.from(
        'bcadbaf1bdba5fbef7c1be5fc4dab5e52cbcadbaf1bdba5fbef7c1be5fc4dab5e55fb8ed0a43533130303031302cc4bfc7c72dc0bdb7e1',
        'hex',
      ),
    );
    expect(await readIndustrySource({ source: 'stores.csv' })).toMatchObject({
      industries: [{ industryCode: 'CS100010', industryName: '커피-음료' }],
      sources: [{ encoding: 'CP949' }],
    });
  });

  it('ZIP 내부 CSV 하나만 읽고 이름·압축 방식과 무관한 체크섬을 만든다', async () => {
    const bytes = csv('CS100010,커피-음료');
    files.set('stores.csv', bytes);
    files.set(
      'stores.zip',
      zipSync({ '폴더/STORES.CSV': bytes, '안내.txt': encode('안내') }),
    );
    const plain = await readIndustrySource({ source: 'stores.csv' });
    const zipped = await readIndustrySource({ source: 'stores.zip' });
    expect(zipped.checksum).toBe(plain.checksum);
    expect(zipped.industries).toEqual(plain.industries);
    expect(zipped.sources[0]).toMatchObject({
      entry: '폴더/STORES.CSV',
      rows: 1,
    });
  });

  it('매출 원본에만 있는 업종도 합집합에 포함한다', async () => {
    files.set('stores.csv', csv('CS100010,커피-음료'));
    files.set('sales.csv', csv('CS100010,커피-음료\nCS300001,슈퍼마켓'));
    const result = await readIndustrySource({
      source: 'stores.csv',
      salesSource: 'sales.csv',
    });
    expect(result).toMatchObject({
      fetchedRows: 3,
      validRows: 3,
      rejectedRows: 0,
    });
    expect(result.industries).toEqual([
      { industryCode: 'CS100010', industryName: '커피-음료' },
      { industryCode: 'CS300001', industryName: '슈퍼마켓' },
    ]);
    expect(result.sources).toMatchObject([
      { role: 'stores', rows: 1, industries: 1 },
      { role: 'sales', rows: 2, industries: 2 },
    ]);
    expect(result.checksum).not.toBe(
      (await readIndustrySource({ source: 'stores.csv' })).checksum,
    );
  });

  it.each([
    '',
    'CS10001',
    'CS1000100',
    'cs100010',
    'CS10001A',
    ' CS100010',
    'ＣＳ１０００１０',
  ])('잘못된 코드를 거부한다: %s', async (code) => {
    files.set('stores.csv', csv(`${code},커피-음료`));
    await expect(
      readIndustrySource({ source: 'stores.csv' }),
    ).rejects.toMatchObject({ fetchedRows: 1, validRows: 0, rejectedRows: 1 });
  });

  it.each([
    '',
    '   ',
    ' 커피-음료',
    '커피-음료 ',
    '커피\u0000음료',
    '커피\uFFFD음료',
    '"커피\n음료"',
  ])('빈 명칭·공백 보정·제어 문자·손상된 명칭을 거부한다: %s', async (name) => {
    files.set('stores.csv', csv(`CS100010,${name}`));
    await expect(
      readIndustrySource({ source: 'stores.csv' }),
    ).rejects.toMatchObject({ fetchedRows: 1, validRows: 0, rejectedRows: 1 });
  });

  it('같은 원본의 동일 코드·상이한 명칭을 첫 충돌에서 거부한다', async () => {
    files.set(
      'stores.csv',
      csv('CS100010,커피-음료\nCS100010,다른 업종\nCS300001,슈퍼마켓'),
    );
    await expect(
      readIndustrySource({ source: 'stores.csv' }),
    ).rejects.toMatchObject({ fetchedRows: 2, validRows: 1, rejectedRows: 1 });
  });

  it('점포·매출 사이의 명칭 충돌을 임의로 해결하지 않는다', async () => {
    files.set('stores.csv', csv('CS100010,커피-음료'));
    files.set('sales.csv', csv('CS100010,다른 이름'));
    await expect(
      readIndustrySource({ source: 'stores.csv', salesSource: 'sales.csv' }),
    ).rejects.toMatchObject({ fetchedRows: 2, validRows: 1, rejectedRows: 1 });
  });

  it.each([
    'SVC_INDUTY_CD,OTHER\nCS100010,커피-음료',
    'SVC_INDUTY_CD,SVC_INDUTY_CD_NM,SVC_INDUTY_CD_NM\nCS100010,커피-음료,커피-음료',
    `${header},서비스_업종_코드\nCS100010,커피-음료,CS100010`,
    `${header}\nCS100010,커피-음료,extra`,
    `${header}\nCS100010,"열리지 않은 끝`,
    `${header}\nCS100010,커"피`,
    `${header}\n`,
    '',
  ])('헤더·열 수·인용부호·빈 원본 오류를 거부한다', async (text) => {
    files.set('stores.csv', encode(text));
    await expect(
      readIndustrySource({ source: 'stores.csv' }),
    ).rejects.toBeInstanceOf(IndustrySourceError);
  });

  it('UTF-8 BOM 뒤의 깨진 바이트를 CP949로 추측하지 않는다', async () => {
    files.set('stores.csv', Uint8Array.from([239, 187, 191, 255, 255]));
    await expect(
      readIndustrySource({ source: 'stores.csv' }),
    ).rejects.toMatchObject({
      fetchedRows: 0,
      validRows: 0,
      rejectedRows: 0,
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('같은 청크 뒤쪽의 CSV 문법 오류가 앞서 검증한 건수를 지우지 않는다', async () => {
    files.set(
      'stores.csv',
      csv('CS100010,커피-음료\nCS300001,"끝나지 않은 인용부호'),
    );
    await expect(
      readIndustrySource({ source: 'stores.csv' }),
    ).rejects.toMatchObject({
      fetchedRows: 2,
      validRows: 1,
      rejectedRows: 1,
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('CSV 청크 경계의 Unicode 서로게이트 쌍을 손상시키지 않는다', async () => {
    const prefix = `${header}\nCS100010,`;
    // 이모지 첫 UTF-16 코드 단위가 64 KiB 문자열 조각의 끝에 놓이도록 맞춥니다.
    const name = 'a'.repeat(65535 - prefix.length) + '😀';
    files.set('stores.csv', encode(prefix + name));
    expect(await readIndustrySource({ source: 'stores.csv' })).toMatchObject({
      fetchedRows: 1,
      validRows: 1,
      rejectedRows: 0,
      industries: [{ industryCode: 'CS100010', industryName: name }],
    });
  });

  it('지원하지 않는 인코딩과 UTF-16 BOM을 거부한다', async () => {
    files.set('stores.csv', Uint8Array.from([255, 254, 65, 0]));
    await expect(
      readIndustrySource({ source: 'stores.csv' }),
    ).rejects.toBeInstanceOf(IndustrySourceError);
  });

  it.each([
    zipSync({ 'readme.txt': encode('CSV 없음') }),
    zipSync({
      'a.csv': csv('CS100010,커피-음료'),
      'b.csv': csv('CS100010,커피-음료'),
    }),
    Uint8Array.from([80, 75, 3, 4]),
  ])('CSV가 없거나 여러 개이거나 잘린 ZIP을 거부한다', async (bytes) => {
    files.set('stores.zip', bytes);
    await expect(
      readIndustrySource({ source: 'stores.zip' }),
    ).rejects.toBeInstanceOf(IndustrySourceError);
  });

  it('ZIP의 저장 데이터가 손상되면 CRC 검증으로 거부한다', async () => {
    const bytes = zipSync({
      'a.csv': [csv('CS100010,커피-음료'), { level: 0 }],
    });
    // local header 뒤의 CSV 바이트만 바꿔도 원래 CRC와 다르면 적재하면 안 됩니다.
    bytes[35] = bytes[35]! ^ 1;
    files.set('stores.zip', bytes);
    await expect(readIndustrySource({ source: 'stores.zip' })).rejects.toThrow(
      /CRC/,
    );
  });

  it('파일 부재와 지원하지 않는 확장자도 실패 이력용 오류로 전달한다', async () => {
    await expect(
      readIndustrySource({ source: 'missing.csv' }),
    ).rejects.toMatchObject({ fetchedRows: 0, validRows: 0, rejectedRows: 0 });
    files.set('stores.json', csv('CS100010,커피-음료'));
    await expect(
      readIndustrySource({ source: 'stores.json' }),
    ).rejects.toBeInstanceOf(IndustrySourceError);
  });
});
