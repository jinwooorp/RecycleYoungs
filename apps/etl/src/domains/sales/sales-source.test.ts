import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSalesSource, type SalesStatRow } from './sales-source.js';

// 파일만 메모리로 제공하고 CSV·ZIP·문자 해석과 실제 수치 검증을 함께 검사합니다.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
const files = new Map<string, Uint8Array>();
const header =
  'STDR_YYQU_CD,ADSTRD_CD,SVC_INDUTY_CD,THSMON_SELNG_AMT,THSMON_SELNG_CO,MDWK_SELNG_AMT,WKEND_SELNG_AMT';
const values = [
  '20262',
  '11740700',
  'CS100010',
  '6612246',
  '25',
  '3064212',
  '3548034',
];
const encode = (text: string) => new TextEncoder().encode(text);
const csv = (rows: string[]) => encode(header + '\n' + rows.join('\n'));
const collect = async (path = 'sales.csv') => {
  const rows: SalesStatRow[] = [];
  const result = await readSalesSource(path, async (batch) => {
    rows.push(...batch);
  });
  return { rows, result };
};
beforeEach(() => {
  files.clear();
  vi.mocked(readFile).mockImplementation(async (path) => {
    const contents = files.get(String(path));
    if (!contents) throw new Error('ENOENT: source missing');
    return Buffer.from(contents);
  });
});

describe('추정매출 원본', () => {
  it('실제 한글 헤더를 매출액·건수 네 컬럼으로 매핑한다', async () => {
    files.set(
      'sales.csv',
      encode(
        '기준_년분기_코드,행정동_코드,서비스_업종_코드,당월_매출_금액,당월_매출_건수,주중_매출_금액,주말_매출_금액\n' +
          values.join(','),
      ),
    );
    expect((await collect()).rows).toEqual([
      {
        dongCode: '11740700',
        industryCode: 'CS100010',
        quarterCode: '20262',
        monthlySalesAmount: '6612246',
        monthlySalesCount: '25',
        weekdaySalesAmount: '3064212',
        weekendSalesAmount: '3548034',
      },
    ]);
  });

  it.each([
    ['9007199254740993.0', '9007199254740993'],
    ['9.223372036854775807e18', '9223372036854775807'],
    ['9223372036854775807000e-3', '9223372036854775807'],
    ['10e-1', '1'],
    ['1.2300e2', '123'],
    ['+00001.000E+003', '1000'],
    ['.0', '0'],
    ['.1e1', '1'],
    ['1.', '1'],
    ['0e999999999999999999999999', '0'],
    ['0.000e-999999999999999999999999', '0'],
    ['00000000000000000000001', '1'],
  ])('정확한 정수 표기 %s를 %s로 정규화한다', async (input, expected) => {
    const row = [...values];
    for (const index of [3, 4, 5, 6]) row[index] = input;
    files.set('sales.csv', csv([row.join(',')]));
    const actual = (await collect()).rows[0]!;
    expect([
      actual.monthlySalesAmount,
      actual.monthlySalesCount,
      actual.weekdaySalesAmount,
      actual.weekendSalesAmount,
    ]).toEqual([expected, expected, expected, expected]);
  });

  it.each([
    '-1',
    '-0',
    '1.1',
    '9007199254740993.1',
    '1e-1',
    '1.0001e3',
    '9223372036854775808',
    '9.223372036854775808e18',
    '1e99999999999999999999999',
    '1e-99999999999999999999999',
    'NaN',
    'Infinity',
    'NULL',
    ' 1',
    '1 ',
    '１',
    '--1',
    '1e',
    '1e+',
    '1.2.3',
    '"1\n"',
  ])('잘못된 수치 %s를 반올림하거나 0으로 보정하지 않는다', async (value) => {
    const row = [...values];
    row[3] = value;
    files.set('sales.csv', csv([row.join(',')]));
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 1,
      validRows: 0,
      rejectedRows: 1,
    });
  });

  it.each([3, 4, 5, 6])(
    '네 컬럼 모두 비정수·음수 입력을 검증한다: %s',
    async (index) => {
      const row = [...values];
      row[index] = '-1';
      files.set('sales.csv', csv([row.join(',')]));
      await expect(collect()).rejects.toThrow();
    },
  );

  it('빈 셀과 실제 0을 구분하고 주중·주말 합계 일치를 강제하지 않는다', async () => {
    const row = [...values];
    row[3] = '';
    row[4] = '0.0';
    row[5] = '17';
    row[6] = '23';
    files.set('sales.csv', csv([row.join(',')]));
    expect((await collect()).rows[0]).toMatchObject({
      monthlySalesAmount: null,
      monthlySalesCount: '0',
      weekdaySalesAmount: '17',
      weekendSalesAmount: '23',
    });
  });

  it('긴 정수부와 음의 지수가 상쇄되는 값은 임의의 자릿수 제한 없이 처리한다', async () => {
    const row = [...values];
    row[3] = '1' + '0'.repeat(20000) + 'e-20000';
    files.set('sales.csv', csv([row.join(',')]));
    expect((await collect()).rows[0]!.monthlySalesAmount).toBe('1');
  });

  it('거대한 지수는 숫자를 전개하지 않고 판정하되 0의 의미는 보존한다', async () => {
    const row = [...values];
    row[3] = '1e' + '9'.repeat(30000);
    files.set('sales.csv', csv([row.join(',')]));
    await expect(collect()).rejects.toThrow();
    row[3] = '0e-' + '9'.repeat(30000);
    files.set('sales.csv', csv([row.join(',')]));
    expect((await collect()).rows[0]!.monthlySalesAmount).toBe('0');
  });

  it('ZIP·경로가 달라도 같은 CSV 체크섬과 값을 반환한다', async () => {
    const bytes = csv([values.join(',')]);
    files.set('sales.csv', bytes);
    files.set('sales.zip', zipSync({ '원본/SALES.CSV': bytes }));
    const plain = await collect();
    const zipped = await collect('sales.zip');
    expect(zipped.rows).toEqual(plain.rows);
    expect(zipped.result.checksum).toBe(plain.result.checksum);
    expect(zipped.result.entry).toBe('원본/SALES.CSV');
  });

  it('CP949와 UTF-8 BOM·인용부호·쉼표·개행을 지원한다', async () => {
    files.set(
      'sales.csv',
      Buffer.concat([
        Buffer.from(
          `${header},비고\n${values.join(',')},`.replace('비고', 'NOTE'),
        ),
        Buffer.from('c4bfc7c72dc0bdb7e1', 'hex'),
      ]),
    );
    expect((await collect()).result.encoding).toBe('CP949');
    files.set(
      'sales.csv',
      encode(
        `\uFEFF${header},비고\r\n${values.join(',')},"쉼표, ""표시""\r\n다음 줄"\r\n`,
      ),
    );
    expect((await collect()).result.encoding).toBe('UTF-8');
  });

  it.each([
    [0, '20260'],
    [0, '20265'],
    [0, '2026Q1'],
    [0, '"20262\n"'],
    [1, '1174070'],
    [1, '１１７４０７００'],
    [1, '"11740700\n"'],
    [2, 'cs100010'],
    [2, 'CS10001A'],
    [2, '"CS100010\n"'],
  ])('잘못된 코드·분기를 거부한다: %s=%s', async (index, value) => {
    const row = [...values];
    row[Number(index)] = String(value);
    files.set('sales.csv', csv([row.join(',')]));
    await expect(collect()).rejects.toMatchObject({
      validRows: 0,
      rejectedRows: 1,
    });
  });

  it('같은 복합키는 동일한 수치여도 거부한다', async () => {
    files.set('sales.csv', csv([values.join(','), values.join(',')]));
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 2,
      validRows: 1,
      rejectedRows: 1,
    });
  });

  it.each([
    `${header},THSMON_SELNG_AMT\n${values.join(',')},1`,
    `${header},당월_매출_금액\n${values.join(',')},1`,
    `${header.replace('WKEND_SELNG_AMT', 'OTHER')}\n${values.join(',')}`,
    `${header}\n${values.join(',')},extra`,
    `${header}\n`,
    '',
  ])('헤더 누락·중복·모호함·열 수·빈 원본 오류를 거부한다', async (text) => {
    files.set('sales.csv', encode(text));
    await expect(collect()).rejects.toThrow();
  });

  it('후반 CSV 오류에도 앞서 확인한 처리 건수를 보존한다', async () => {
    files.set(
      'sales.csv',
      encode(`${header}\n${values.join(',')}\n20262,"닫히지 않은 인용부호`),
    );
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 2,
      validRows: 1,
      rejectedRows: 1,
    });
  });

  it('1000행씩 콜백 완료를 기다리며 전달하고 분기 범위를 기록한다', async () => {
    files.set(
      'sales.csv',
      csv(
        Array.from({ length: 2001 }, (_, index) => {
          const row = [...values];
          row[1] = String(11000000 + index);
          if (index === 0) row[0] = '20251';
          return row.join(',');
        }),
      ),
    );
    let inFlight = false;
    const sizes: number[] = [];
    const summary = await readSalesSource('sales.csv', async (batch) => {
      expect(inFlight).toBe(false);
      inFlight = true;
      sizes.push(batch.length);
      await Promise.resolve();
      inFlight = false;
    });
    expect(sizes).toEqual([1000, 1000, 1]);
    expect(summary).toMatchObject({
      fetchedRows: 2001,
      validRows: 2001,
      periodFrom: '20251',
      periodTo: '20262',
    });
  });

  it('콜백 실패는 이미 검증한 원본 행을 거부 행으로 바꾸지 않는다', async () => {
    files.set('sales.csv', csv([values.join(',')]));
    await expect(
      readSalesSource('sales.csv', async () => {
        throw new Error('staging failure');
      }),
    ).rejects.toMatchObject({ fetchedRows: 1, validRows: 1, rejectedRows: 0 });
  });
});
