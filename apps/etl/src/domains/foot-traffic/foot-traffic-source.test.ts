import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FootTrafficSourceError,
  readFootTrafficSource,
  type FootTrafficStatRow,
} from './foot-traffic-source.js';

// 디스크에 임시 파일을 만들지 않고 실제 CSV·ZIP·인코딩 처리와 검증을 검사합니다.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
const files = new Map<string, Uint8Array>();
const header = 'STDR_YYQU_CD,ADSTRD_CD,TOT_FLPOP_CO,ML_FLPOP_CO,FML_FLPOP_CO';
const values = ['20262', '11740700', '6416905', '2970054', '3446852'];
const encode = (text: string) => new TextEncoder().encode(text);
const csv = (rows: string[]) => encode(header + '\n' + rows.join('\n'));
const collect = async (path = 'foot-traffic.csv') => {
  const rows: FootTrafficStatRow[] = [];
  const result = await readFootTrafficSource(path, async (batch) => {
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

describe('길단위 유동인구 원본', () => {
  it('한글 헤더를 세 측정값으로 매핑하고 성별 합계 일치를 강제하지 않는다', async () => {
    files.set(
      'foot-traffic.csv',
      encode(
        '기준_년분기_코드,행정동_코드,총_유동인구_수,남성_유동인구_수,여성_유동인구_수\n' +
          values.join(','),
      ),
    );
    expect((await collect()).rows).toEqual([
      {
        dongCode: '11740700',
        quarterCode: '20262',
        totalFootTraffic: '6416905',
        maleFootTraffic: '2970054',
        femaleFootTraffic: '3446852',
      },
    ]);
  });

  it.each([
    [
      '9007199254740993.12345678901234567890',
      '9007199254740993.12345678901234567890',
    ],
    ['9.007199254740993123456789e15', '9007199254740993.123456789'],
    ['+00001.2300E+003', '1230.0'],
    ['.00100', '0.00100'],
    ['1.', '1'],
    ['000001', '1'],
    ['10e-1', '1.0'],
    ['0.000', '0.000'],
    ['0e99999999999999999999999', '0'],
    ['0e-99999999999999999999999', '0'],
  ])('정확한 십진수 %s를 손실 없이 %s로 전달한다', async (input, expected) => {
    const row = [...values];
    for (const index of [2, 3, 4]) row[index] = input;
    files.set('foot-traffic.csv', csv([row.join(',')]));
    const actual = (await collect()).rows[0]!;
    expect([
      actual.totalFootTraffic,
      actual.maleFootTraffic,
      actual.femaleFootTraffic,
    ]).toEqual([expected, expected, expected]);
  });

  it('빈 셀만 NULL로 취급하며 0과 소수 정밀도를 구분한다', async () => {
    files.set('foot-traffic.csv', csv(['20262,11740700,,0,0.00']));
    expect((await collect()).rows[0]).toMatchObject({
      totalFootTraffic: null,
      maleFootTraffic: '0',
      femaleFootTraffic: '0.00',
    });
  });

  it('긴 소수와 PostgreSQL NUMERIC 정수부·소수부 경계값을 정확히 보존한다', async () => {
    const integer = '9'.repeat(131072);
    const fraction = '0.' + '0'.repeat(16382) + '1';
    files.set(
      'foot-traffic.csv',
      csv([
        `20262,11740700,${integer},${fraction},1.123456789012345678901234567890`,
      ]),
    );
    expect((await collect()).rows[0]).toMatchObject({
      totalFootTraffic: integer,
      maleFootTraffic: fraction,
      femaleFootTraffic: '1.123456789012345678901234567890',
    });
  });

  it('긴 계수와 지수가 상쇄되는 정확한 값을 처리한다', async () => {
    files.set(
      'foot-traffic.csv',
      csv([
        `20262,11740700,1${'0'.repeat(20000)}e-10000,0.${'0'.repeat(20000)}1e20001,1e131071`,
      ]),
    );
    const row = (await collect()).rows[0]!;
    expect(row.totalFootTraffic).toBe(
      '1' + '0'.repeat(10000) + '.' + '0'.repeat(10000),
    );
    expect(row.maleFootTraffic).toBe('1');
    expect(row.femaleFootTraffic).toBe('1' + '0'.repeat(131071));
  });

  it.each([
    '-1',
    '-0',
    '-0.0',
    'NaN',
    'Infinity',
    '+Infinity',
    'NULL',
    ' 1',
    '1 ',
    ' ',
    '１',
    '--1',
    '1e',
    '1e+',
    '1.2.3',
    '"1\n"',
    '1e131072',
    '1e-16384',
    '1e999999999999999999999',
    '1e-999999999999999999999',
    '9'.repeat(131073),
    '0.' + '0'.repeat(16383) + '1',
    '1.' + '0'.repeat(16384),
  ])('잘못되거나 NUMERIC 범위를 넘는 측정값을 거부한다: %s', async (input) => {
    const row = [...values];
    row[2] = input;
    files.set('foot-traffic.csv', csv([row.join(',')]));
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 1,
      validRows: 0,
      rejectedRows: 1,
    });
  });

  it.each([2, 3, 4])('세 측정값 모두 음수를 거부한다: %s', async (index) => {
    const row = [...values];
    row[index] = '-1';
    files.set('foot-traffic.csv', csv([row.join(',')]));
    await expect(collect()).rejects.toThrow(FootTrafficSourceError);
  });

  it('거대한 지수는 전개 전에 거부하며 0의 의미는 보존한다', async () => {
    files.set(
      'foot-traffic.csv',
      csv([`20262,11740700,1e${'9'.repeat(30000)},0,0`]),
    );
    await expect(collect()).rejects.toThrow();
    files.set(
      'foot-traffic.csv',
      csv([`20262,11740700,0e-${'9'.repeat(30000)},0,0`]),
    );
    expect((await collect()).rows[0]!.totalFootTraffic).toBe('0');
  });

  it('ZIP 내부 CSV 바이트 기준 체크섬과 출처를 반환한다', async () => {
    const bytes = csv([values.join(',')]);
    files.set('foot-traffic.csv', bytes);
    files.set('foot-traffic.zip', zipSync({ '원본/POPULATION.CSV': bytes }));
    const plain = await collect();
    const zipped = await collect('foot-traffic.zip');
    expect(zipped.rows).toEqual(plain.rows);
    expect(zipped.result.checksum).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    expect(zipped.result.checksum).toBe(plain.result.checksum);
    expect(zipped.result.entry).toBe('원본/POPULATION.CSV');
  });

  it('CP949와 UTF-8 BOM·인용부호·쉼표·개행을 지원한다', async () => {
    files.set(
      'foot-traffic.csv',
      Buffer.concat([
        Buffer.from(`${header},NOTE\n${values.join(',')},`),
        Buffer.from('c4bfc7c72dc0bdb7e1', 'hex'),
      ]),
    );
    expect((await collect()).result.encoding).toBe('CP949');
    files.set(
      'foot-traffic.csv',
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
  ])('잘못된 코드·분기를 거부한다: %s=%s', async (index, value) => {
    const row = [...values];
    row[Number(index)] = String(value);
    files.set('foot-traffic.csv', csv([row.join(',')]));
    await expect(collect()).rejects.toMatchObject({
      validRows: 0,
      rejectedRows: 1,
    });
  });

  it('동·분기가 같은 복합키는 수치가 같아도 거부한다', async () => {
    files.set('foot-traffic.csv', csv([values.join(','), values.join(',')]));
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 2,
      validRows: 1,
      rejectedRows: 1,
    });
  });

  it.each([
    `${header},TOT_FLPOP_CO\n${values.join(',')},1`,
    `${header},총_유동인구_수\n${values.join(',')},1`,
    `${header},\n${values.join(',')},1`,
    `${header.replace('FML_FLPOP_CO', 'OTHER')}\n${values.join(',')}`,
    `${header}\n${values.join(',')},extra`,
    `${header}\n`,
    '',
  ])('누락·중복·모호한 헤더·열 수·빈 원본 오류를 거부한다', async (text) => {
    files.set('foot-traffic.csv', encode(text));
    await expect(collect()).rejects.toThrow(FootTrafficSourceError);
  });

  it('후반 CSV 구조 오류에도 검증 건수와 분기 범위를 보존한다', async () => {
    const bytes = encode(
      `${header}\n${values.join(',')}\n20262,"닫히지 않은 인용부호`,
    );
    files.set('foot-traffic.csv', bytes);
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 2,
      validRows: 1,
      rejectedRows: 1,
      periodFrom: '20262',
      periodTo: '20262',
      checksum: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('1000행 묶음별 콜백 완료를 기다리며 분기 범위와 건수를 기록한다', async () => {
    files.set(
      'foot-traffic.csv',
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
    const result = await readFootTrafficSource(
      'foot-traffic.csv',
      async (batch) => {
        expect(inFlight).toBe(false);
        inFlight = true;
        sizes.push(batch.length);
        await new Promise<void>((resolve) => setImmediate(resolve));
        inFlight = false;
      },
    );
    expect(sizes).toEqual([1000, 1000, 1]);
    expect(result).toMatchObject({
      fetchedRows: 2001,
      validRows: 2001,
      rejectedRows: 0,
      periodFrom: '20251',
      periodTo: '20262',
    });
  });

  it('staging 실패는 검증된 원본을 거부 건수로 바꾸지 않는다', async () => {
    files.set('foot-traffic.csv', csv([values.join(',')]));
    await expect(
      readFootTrafficSource('foot-traffic.csv', async () => {
        throw new Error('staging failure');
      }),
    ).rejects.toMatchObject({ fetchedRows: 1, validRows: 1, rejectedRows: 0 });
  });
});
