import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readDistrictSalesSource,
  probeDistrictSalesSource,
} from './district-sales-source.js';

// 공식 헤더에 맞춘 합성 CSV·ZIP을 메모리로 공급하고 실제 판독·검증기를 실행한다.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
const files = new Map<string, Uint8Array>();
const header =
  'STDR_YYQU_CD,SIGNGU_CD,SVC_INDUTY_CD,THSMON_SELNG_AMT,THSMON_SELNG_CO,MDWK_SELNG_AMT,WKEND_SELNG_AMT';
const values = ['20262', '00111', 'CS100010', '101', '0', '50', '48'];
const encode = (text: string) => new TextEncoder().encode(text);
const csv = (rows: string[]) => encode(`${header}\n${rows.join('\n')}`);
const probe = (expectedRows = 1, source = 'district-sales.csv') =>
  probeDistrictSalesSource({ source, expectedRows, probe: true });
const distinctRows = (length: number) =>
  Array.from({ length }, (_, index) => {
    const row = [...values];
    row[1] = String(11000 + index);
    return row.join(',');
  });

beforeEach(() => {
  files.clear();
  vi.mocked(readFile).mockImplementation(async (path) => {
    const contents = files.get(String(path));
    if (!contents) throw new Error('ENOENT: secret-file-path');
    return Buffer.from(contents);
  });
});

describe('자치구 추정매출 로컬 파일 probe', () => {
  it('공식 영문 헤더·식별 코드·채택한 4개 수치와 검증 메타데이터를 반환한다', async () => {
    const bytes = csv([values.join(',')]);
    files.set('district-sales.csv', bytes);
    expect(await probe()).toEqual({
      mode: 'PROBE',
      datasetId: 'OA-22176',
      serviceName: 'VwsmSignguSelngW',
      validationScope: 'LOCAL_FILE_FORMAT',
      databaseChecked: false,
      batchCreated: false,
      loadedRows: 0,
      expectedRows: 1,
      fetchedRows: 1,
      validRows: 1,
      rejectedRows: 0,
      periodFrom: '20262',
      periodTo: '20262',
      checksum: createHash('sha256').update(bytes).digest('hex'),
      encoding: 'UTF-8',
      sample: [
        {
          districtCode: '00111',
          quarterCode: '20262',
          industryCode: 'CS100010',
          monthlySalesAmount: '101',
          monthlySalesCount: '0',
          weekdaySalesAmount: '50',
          weekendSalesAmount: '48',
        },
      ],
    });
  });

  it('한글 헤더·명칭·미채택 항목을 허용하며 합계 불일치와 당월 값을 보정하지 않는다', async () => {
    files.set(
      'district-sales.csv',
      encode(
        '기준_년분기_코드,자치구_코드,서비스_업종_코드,당월_매출_금액,당월_매출_건수,주중_매출_금액,주말_매출_금액,자치구_코드_명,월요일_매출_금액\n' +
          `${values.join(',')},"구 이름,\n두 줄",not-a-number`,
      ),
    );
    const result = (await probe()).sample[0]!;
    expect(result.monthlySalesAmount).toBe('101');
    expect(result.weekdaySalesAmount).toBe('50');
    expect(result.weekendSalesAmount).toBe('48');
    expect(result).not.toHaveProperty('월요일_매출_금액');
    expect(Object.keys(result)).toHaveLength(7);
  });

  it.each([
    ['9223372036854775807', '9223372036854775807'],
    ['9007199254740993.0', '9007199254740993'],
    ['9.223372036854775807e18', '9223372036854775807'],
    ['9223372036854775807000e-3', '9223372036854775807'],
    ['+00001.000E+003', '1000'],
    ['.1e1', '1'],
    ['0e999999999999999999999', '0'],
  ])(
    '4개 수치의 정수 의미 %s를 정밀도 손실 없이 검증한다',
    async (value, expected) => {
      files.set(
        'district-sales.csv',
        csv([[...values.slice(0, 3), ...Array(4).fill(value)].join(',')]),
      );
      const row = (await probe()).sample[0]!;
      expect([
        row.monthlySalesAmount,
        row.monthlySalesCount,
        row.weekdaySalesAmount,
        row.weekendSalesAmount,
      ]).toEqual(Array(4).fill(expected));
    },
  );

  it('빈 셀만 NULL이며 실제 0과 분기 범위를 유지한다', async () => {
    files.set(
      'district-sales.csv',
      csv(['20211,00111,CS100010,,,,', '20262,00111,CS100010,0,0.0,0e10,0']),
    );
    const result = await probe(2);
    expect(result).toMatchObject({ periodFrom: '20211', periodTo: '20262' });
    for (const field of [
      'monthlySalesAmount',
      'monthlySalesCount',
      'weekdaySalesAmount',
      'weekendSalesAmount',
    ] as const) {
      expect(result.sample[0]![field]).toBeNull();
      expect(result.sample[1]![field]).toBe('0');
    }
  });

  it.each([
    [0, '20260'],
    [0, '20265'],
    [0, '２０２６１'],
    [0, '"20261\n"'],
    [1, '1111'],
    [1, '111111'],
    [1, '１１１１１'],
    [1, '"11111\n"'],
    [2, 'cs100010'],
    [2, 'CS10001A'],
    [2, '"CS100010\n"'],
    [3, '9223372036854775808'],
    [3, '9.223372036854775808e18'],
    [3, '1.1'],
    [3, '1e-1'],
    [3, '1e9999999999999999999999'],
    [3, '-0'],
    [3, ' 1'],
    [3, 'NULL'],
    [3, 'NaN'],
    [3, 'Infinity'],
    [3, '１'],
    [4, '-1'],
    [5, '-1'],
    [6, '-1'],
  ])(
    '잘못된 코드·수치 입력을 안전하게 거부한다: %s=%s',
    async (index, value) => {
      const row = [...values];
      row[Number(index)] = String(value);
      files.set('district-sales.csv', csv([row.join(',')]));
      await expect(probe()).rejects.toThrow(/1번째 데이터 행/);
    },
  );

  it('5행 뒤도 검증하고 전체 파일 체크섬만 반환한다', async () => {
    const bytes = csv(distinctRows(1001));
    files.set('district-sales.csv', bytes);
    const result = await probe(1001);
    expect(result.sample).toHaveLength(5);
    expect(result.fetchedRows).toBe(1001);
    expect(result.checksum).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
  });

  it.each(['duplicate', 'invalid', 'syntax'])(
    '마지막 행의 %s 오류가 있으면 전체 성공 결과를 거부한다',
    async (kind) => {
      const rows = distinctRows(6);
      rows.push(
        kind === 'duplicate'
          ? rows[0]!
          : kind === 'invalid'
            ? '20262,11999,CS100010,secret-value,0,0,0'
            : '20262,"secret-unclosed',
      );
      files.set('district-sales.csv', csv(rows));
      const error = await probe(7).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toMatch(/secret|sample/);
    },
  );

  it.each([
    `${header},THSMON_SELNG_AMT\n${values.join(',')},1`,
    `${header},당월_매출_금액\n${values.join(',')},1`,
    `${header.replace('SIGNGU_CD', 'ADSTRD_CD')}\n${values.join(',')}`,
    `${header.replace('THSMON_SELNG_CO', '')}\n${values.join(',')}`,
    `${header.replace('THSMON_SELNG_CO', ' ')}\n${values.join(',')}`,
    `${header}\n${values.join(',')},extra`,
    `${header}\n${values.slice(0, -1).join(',')}`,
    `${header}\n`,
    '',
  ])('필수·중복·모호한 헤더와 행 길이·빈 입력을 거부한다: %#', async (text) => {
    files.set('district-sales.csv', encode(text));
    await expect(probe()).rejects.toThrow(/자치구 추정매출 CSV/);
  });

  it('CP949·단일 CSV ZIP 판독을 재사용하며 내부 CSV 체크섬을 유지한다', async () => {
    const bytes = Buffer.concat([
      Buffer.from(`${header},SIGNGU_CD_NM\n${values.join(',')},`),
      Buffer.from('c4bfc7c72dc0bdb7e1', 'hex'),
    ]);
    files.set('district-sales.csv', bytes);
    files.set('district-sales.zip', zipSync({ '원본/SALES.CSV': bytes }));
    const plain = await probe();
    const zipped = await probe(1, 'district-sales.zip');
    expect(plain.encoding).toBe('CP949');
    expect(zipped).toEqual(plain);
  });

  it('손상 ZIP·모호한 ZIP·인코딩·파일 오류 원문을 노출하지 않는다', async () => {
    const bytes = csv([values.join(',')]);
    const corrupt = zipSync({ 'secret.csv': bytes }, { level: 0 });
    corrupt[40] = corrupt[40]! ^ 1;
    for (const input of [
      corrupt,
      zipSync({ 'first.csv': bytes, 'second.csv': bytes }),
      Buffer.from('504b0304', 'hex'),
    ]) {
      files.set('secret.zip', input);
      await expect(probe(1, 'secret.zip')).rejects.toThrow(
        /^자치구 추정매출 원본 파일을 읽거나 해석할 수 없습니다\.$/,
      );
    }
    files.set('district-sales.csv', Buffer.from('efbbbf80', 'hex'));
    await expect(probe()).rejects.toThrow(/^자치구 추정매출 원본 파일/);
    await expect(probe(1, 'secret-path.csv')).rejects.toThrow(
      /^자치구 추정매출 원본 파일/,
    );
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    '예상 행 수 %s는 파일 판독 전에 거부한다',
    async (expectedRows) => {
      await expect(probe(expectedRows)).rejects.toThrow(/예상 행 수/);
      expect(readFile).not.toHaveBeenCalled();
    },
  );

  it('실제 전체 행 수가 예상과 다르면 성공 결과를 반환하지 않는다', async () => {
    files.set('district-sales.csv', csv(distinctRows(7)));
    await expect(probe(5)).rejects.toThrow(/예상 행 수.*일치하지/);
  });

  it('프로그램 호출도 probe 생략을 파일 판독 전에 거부한다', async () => {
    await expect(
      probeDistrictSalesSource({
        source: 'secret-path.csv',
        expectedRows: 1,
        probe: false,
      } as never),
    ).rejects.toThrow(/probe 모드/);
    expect(readFile).not.toHaveBeenCalled();
  });
});

// 콜백의 backpressure와 오류 카운터는 파일 전체 성공 전에 공개하지 않는 적재 계약이다.
describe('자치구 매출 staging 원본', () => {
  it('1000행 이하 묶음을 순차 전달하고 전체 메타데이터를 반환한다', async () => {
    files.set('district-sales.csv', csv(distinctRows(2001)));
    const chunks: number[] = [];
    let total = 0;
    let active = false;
    const source = await readDistrictSalesSource(
      'district-sales.csv',
      async (rows) => {
        expect(active).toBe(false);
        active = true;
        expect(rows[0]!.districtCode).toBe(String(11000 + total));
        expect(rows[0]!.monthlySalesAmount).toBe('101');
        chunks.push(rows.length);
        total += rows.length;
        await Promise.resolve();
        active = false;
      },
    );
    expect(chunks).toEqual([1000, 1000, 1]);
    expect(source).toMatchObject({
      fetchedRows: 2001,
      validRows: 2001,
      rejectedRows: 0,
      periodFrom: '20262',
      periodTo: '20262',
      encoding: 'UTF-8',
    });
  });

  it('마지막 행 오류는 실제 검증 건수와 체크섬을 유지하고 전체 성공을 거부한다', async () => {
    const rows = distinctRows(1001);
    rows.push('20262,15000,CS100010,-1,0,0,0');
    files.set('district-sales.csv', csv(rows));
    await expect(
      readDistrictSalesSource('district-sales.csv', async () => {}),
    ).rejects.toMatchObject({
      fetchedRows: 1002,
      validRows: 1001,
      rejectedRows: 1,
    });
  });

  it('staging 콜백 실패는 유효 원본을 거부 행으로 바꾸거나 DB 오류 원문을 노출하지 않는다', async () => {
    files.set('district-sales.csv', csv(distinctRows(2)));
    const error = await readDistrictSalesSource(
      'district-sales.csv',
      async () => {
        throw new Error('postgresql://user:password@private/db');
      },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ validRows: 2, rejectedRows: 0 });
    expect((error as Error).message).not.toMatch(/password|private|postgresql/);
  });
});
