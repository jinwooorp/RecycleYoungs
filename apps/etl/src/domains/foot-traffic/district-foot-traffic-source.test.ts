import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readDistrictFootTrafficSource,
  DistrictFootTrafficSourceError,
  probeDistrictFootTrafficSource,
} from './district-foot-traffic-source.js';

// 공식 헤더에 맞춘 합성 CSV·ZIP을 메모리로 공급하고 실제 판독·검증기를 실행한다.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
const files = new Map<string, Uint8Array>();
const header = 'STDR_YYQU_CD,SIGNGU_CD,TOT_FLPOP_CO,ML_FLPOP_CO,FML_FLPOP_CO';
const values = ['20262', '00111', '101', '50', '48'];
const encode = (text: string) => new TextEncoder().encode(text);
const csv = (rows: string[]) => encode(`${header}\n${rows.join('\n')}`);
const probe = (expectedRows = 1, source = 'district-foot-traffic.csv') =>
  probeDistrictFootTrafficSource({ source, expectedRows, probe: true });
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

describe('자치구 길단위인구 로컬 파일 probe', () => {
  it('공식 영문 헤더·식별 코드·채택한 3개 수치와 검증 메타데이터를 반환한다', async () => {
    const bytes = csv([values.join(',')]);
    files.set('district-foot-traffic.csv', bytes);
    expect(await probe()).toEqual({
      mode: 'PROBE',
      datasetId: 'OA-22179',
      serviceName: 'VwsmSignguFlpopW',
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
          totalFootTraffic: '101',
          maleFootTraffic: '50',
          femaleFootTraffic: '48',
        },
      ],
    });
  });

  it('한글 헤더·명칭·미채택 항목을 허용하며 성별 합계 불일치를 보정하지 않는다', async () => {
    files.set(
      'district-foot-traffic.csv',
      encode(
        '기준_년분기_코드,자치구_코드,총_유동인구_수,남성_유동인구_수,여성_유동인구_수,자치구_코드_명,월요일_유동인구_수\n' +
          `${values.join(',')},"구 이름,\n두 줄",not-a-number`,
      ),
    );
    const result = (await probe()).sample[0]!;
    expect(result.totalFootTraffic).toBe('101');
    expect(result.maleFootTraffic).toBe('50');
    expect(result.femaleFootTraffic).toBe('48');
    expect(result).not.toHaveProperty('월요일_유동인구_수');
    expect(Object.keys(result)).toHaveLength(5);
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
    ['0e999999999999999999999', '0'],
    ['0e-999999999999999999999', '0'],
  ])(
    '세 NUMERIC 수치의 십진수 정밀도와 소수 자릿수를 보존한다: %#',
    async (value, expected) => {
      files.set(
        'district-foot-traffic.csv',
        csv([['20262', '00111', value, value, value].join(',')]),
      );
      const row = (await probe()).sample[0]!;
      expect([
        row.totalFootTraffic,
        row.maleFootTraffic,
        row.femaleFootTraffic,
      ]).toEqual([expected, expected, expected]);
    },
  );

  it('빈 셀만 NULL이며 실제 0과 분기 범위를 유지한다', async () => {
    files.set(
      'district-foot-traffic.csv',
      csv(['20211,00111,,,', '20262,00111,0,0e10,0']),
    );
    const result = await probe(2);
    expect(result).toMatchObject({ periodFrom: '20211', periodTo: '20262' });
    for (const field of [
      'totalFootTraffic',
      'maleFootTraffic',
      'femaleFootTraffic',
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
    [0, ' 20261'],
    [1, '1111'],
    [1, '111111'],
    [1, '１１１１１'],
    [1, '"11111\n"'],
    [1, '1111A'],
    [1, '11111 '],
  ])(
    'ASCII 자치구·분기 형식 오류를 안전하게 거부한다: %#',
    async (index, value) => {
      const row = [...values];
      row[Number(index)] = String(value);
      files.set('district-foot-traffic.csv', csv([row.join(',')]));
      await expect(probe()).rejects.toThrow();
    },
  );

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
  ])('잘못되거나 NUMERIC 한계를 넘는 수치를 거부한다: %#', async (value) => {
    files.set('district-foot-traffic.csv', csv([`20262,00111,${value},0,0`]));
    await expect(probe()).rejects.toThrow();
  });

  it.each([2, 3, 4])('세 측정값 모두 음수를 거부한다: %s', async (index) => {
    const row = [...values];
    row[index] = '-1';
    files.set('district-foot-traffic.csv', csv([row.join(',')]));
    await expect(probe()).rejects.toThrow();
  });

  it('NUMERIC 정수부·소수부 경계와 긴 소수 자릿수를 보존한다', async () => {
    const integer = '9'.repeat(131072),
      fraction = '0.' + '0'.repeat(16382) + '1';
    files.set(
      'district-foot-traffic.csv',
      csv([
        `20262,00111,${integer},${fraction},1.123456789012345678901234567890`,
      ]),
    );
    expect((await probe()).sample[0]).toMatchObject({
      totalFootTraffic: integer,
      maleFootTraffic: fraction,
      femaleFootTraffic: '1.123456789012345678901234567890',
    });
  });

  it('550행·25구 완전성을 강제하지 않고 5행 뒤도 전체 검증한다', async () => {
    const bytes = csv(distinctRows(1001));
    files.set('district-foot-traffic.csv', bytes);
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
            ? '20262,11999,secret-value,0,0'
            : '20262,"secret-unclosed',
      );
      files.set('district-foot-traffic.csv', csv(rows));
      const error = await probe(7).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toMatch(/secret|sample/);
    },
  );

  it.each([
    `${header},TOT_FLPOP_CO\n${values.join(',')},1`,
    `${header},총_유동인구_수\n${values.join(',')},1`,
    `${header.replace('SIGNGU_CD', 'ADSTRD_CD')}\n${values.join(',')}`,
    `${header.replace('SIGNGU_CD', 'SVC_INDUTY_CD')}\n${values.join(',')}`,
    `${header},ignored,ignored\n${values.join(',')},1,1`,
    `${header.replace('ML_FLPOP_CO', '')}\n${values.join(',')}`,
    `${header.replace('ML_FLPOP_CO', ' ')}\n${values.join(',')}`,
    `${header}\n${values.join(',')},extra`,
    `${header}\n${values.slice(0, -1).join(',')}`,
    `${header}\n`,
    '',
  ])('필수·중복·모호한 헤더와 행 길이·빈 입력을 거부한다: %#', async (text) => {
    files.set('district-foot-traffic.csv', encode(text));
    await expect(probe()).rejects.toThrow();
  });

  it('UTF-8 BOM도 같은 식별자와 수치로 읽는다', async () => {
    files.set(
      'district-foot-traffic.csv',
      encode('\ufeff' + header + '\n' + values.join(',')),
    );
    expect((await probe()).sample[0]).toEqual({
      districtCode: '00111',
      quarterCode: '20262',
      totalFootTraffic: '101',
      maleFootTraffic: '50',
      femaleFootTraffic: '48',
    });
  });

  it('CP949·단일 CSV ZIP 판독을 재사용하며 내부 CSV 체크섬을 유지한다', async () => {
    const bytes = Buffer.concat([
      Buffer.from(`${header},SIGNGU_CD_NM\n${values.join(',')},`),
      Buffer.from('c4bfc7c72dc0bdb7e1', 'hex'),
    ]);
    files.set('district-foot-traffic.csv', bytes);
    files.set(
      'district-foot-traffic.zip',
      zipSync({ '원본/POPULATION.CSV': bytes }),
    );
    const plain = await probe();
    const zipped = await probe(1, 'district-foot-traffic.zip');
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
      await expect(probe(1, 'secret.zip')).rejects.toThrow(/원본 파일/);
    }
    files.set('district-foot-traffic.csv', Buffer.from('efbbbf80', 'hex'));
    await expect(probe()).rejects.toThrow(/원본 파일/);
    await expect(probe(1, 'secret-path.csv')).rejects.toThrow(/원본 파일/);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    '예상 행 수 %s는 파일 판독 전에 거부한다',
    async (expectedRows) => {
      await expect(probe(expectedRows)).rejects.toThrow(/예상 행 수/);
      expect(readFile).not.toHaveBeenCalled();
    },
  );

  it('실제 전체 행 수가 예상과 다르면 성공 결과를 반환하지 않는다', async () => {
    files.set('district-foot-traffic.csv', csv(distinctRows(7)));
    await expect(probe(5)).rejects.toThrow(/예상 행 수/);
  });

  it('프로그램 호출도 probe 생략을 파일 판독 전에 거부한다', async () => {
    await expect(
      probeDistrictFootTrafficSource({
        source: 'secret-path.csv',
        expectedRows: 1,
        probe: false,
      } as never),
    ).rejects.toThrow(/probe 모드/);
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('자치구 길단위인구 적재용 전체 판독', () => {
  it('최대 1000행씩 전달하며 콜백 완료 후 다음 묶음을 처리한다', async () => {
    files.set('rows.csv', csv(distinctRows(1001)));
    const sizes: number[] = [];
    let active = false;
    const source = await readDistrictFootTrafficSource(
      'rows.csv',
      async (rows) => {
        expect(active).toBe(false);
        active = true;
        sizes.push(rows.length);
        await Promise.resolve();
        active = false;
      },
    );
    expect(sizes).toEqual([1000, 1]);
    expect(source).toMatchObject({
      fetchedRows: 1001,
      validRows: 1001,
      rejectedRows: 0,
    });
  });

  it('앞선 묶음 전달 후 마지막 오류도 실패하며 카운터를 보존한다', async () => {
    files.set('rows.csv', csv([...distinctRows(1000), '20262,99999,-1,0,0']));
    await expect(
      readDistrictFootTrafficSource('rows.csv', async () => {}),
    ).rejects.toMatchObject({
      fetchedRows: 1001,
      validRows: 1000,
      rejectedRows: 1,
    });
  });

  it('staging 콜백 오류는 민감한 원문을 감추고 오류 메타데이터를 전달한다', async () => {
    files.set('rows.csv', csv([values.join(',')]));
    const error = await readDistrictFootTrafficSource('rows.csv', async () => {
      throw new Error('postgresql://secret:password@host/database');
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(DistrictFootTrafficSourceError);
    expect((error as Error).message).toMatch(/staging/);
    expect((error as Error).message).not.toMatch(/secret|password|postgresql/);
  });
});
