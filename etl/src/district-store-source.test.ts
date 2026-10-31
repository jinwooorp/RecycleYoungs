import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { probeDistrictStoreSource } from './district-store-source.js';

// 공식 컬럼 명세에 맞춘 합성 입력입니다. 원본 다운로드 파일을 검증했다는 뜻은 아닙니다.
// 파일 생성 없이 읽기만 대체하고 CSV·ZIP·인코딩·수치 검증은 실제 구현을 실행합니다.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
const files = new Map<string, Uint8Array>();
const header =
  'STDR_YYQU_CD,SIGNGU_CD,SVC_INDUTY_CD,SIMILR_INDUTY_STOR_CO,STOR_CO,FRC_STOR_CO,OPBIZ_STOR_CO,CLSBIZ_STOR_CO,OPBIZ_RT,CLSBIZ_RT';
const values = [
  '20262',
  '00111',
  'CS100010',
  '749.0',
  '43.0',
  '2.0',
  '7',
  '1',
  '200.00',
  '300',
];
const encode = (text: string) => new TextEncoder().encode(text);
const csv = (rows: string[]) => encode(`${header}\n${rows.join('\n')}`);
const probe = (expectedRows = 1, source = 'district.csv') =>
  probeDistrictStoreSource({ source, expectedRows, probe: true });
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

describe('자치구 점포 로컬 파일 probe', () => {
  it('검증된 영문 컬럼으로 자치구 코드를 보존하고 DB 미검사 결과를 반환한다', async () => {
    const bytes = csv([values.join(',')]);
    files.set('district.csv', bytes);
    expect(await probe()).toEqual({
      mode: 'PROBE',
      datasetId: 'OA-22173',
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
          industryCode: 'CS100010',
          quarterCode: '20262',
          storeCount: '749',
          generalStoreCount: '43',
          franchiseStoreCount: '2',
          openedStoreCount: '7',
          closedStoreCount: '1',
          openingRate: '200.00',
          closureRate: '300',
        },
      ],
    });
  });

  it('한글 별칭과 선택적 이름 컬럼을 처리하며 합계·100% 제한을 강제하지 않는다', async () => {
    files.set(
      'district.csv',
      encode(
        '기준_년분기_코드,자치구_코드,서비스_업종_코드,전체_점포_수,일반_점포_수,프랜차이즈_점포_수,개업_점포_수,폐업_점포_수,개업_율,폐업_률,자치구_코드_명,서비스_업종_코드_명\n' +
          `${values.join(',')},"이름, 두 줄\n표기",서비스`,
      ),
    );
    expect((await probe()).sample[0]).toMatchObject({
      districtCode: '00111',
      storeCount: '749',
      generalStoreCount: '43',
      franchiseStoreCount: '2',
      openingRate: '200.00',
      closureRate: '300',
    });
  });

  it.each([
    ['9223372036854775807', '9223372036854775807'],
    ['9007199254740993.0', '9007199254740993'],
    ['9.223372036854775807e18', '9223372036854775807'],
    ['9223372036854775807000e-3', '9223372036854775807'],
    ['+00001.000E+003', '1000'],
    ['.1e1', '1'],
    ['0e999999999999999999999999', '0'],
  ])(
    '다섯 점포 수의 정수 의미 %s를 정확한 문자열 %s로 보존한다',
    async (input, expected) => {
      const row = [...values];
      for (const index of [3, 4, 5, 6, 7]) row[index] = input;
      files.set('district.csv', csv([row.join(',')]));
      const result = (await probe()).sample[0]!;
      expect([
        result.storeCount,
        result.generalStoreCount,
        result.franchiseStoreCount,
        result.openedStoreCount,
        result.closedStoreCount,
      ]).toEqual(Array(5).fill(expected));
    },
  );

  it('빈 셀은 null이며 실제 0과 긴 비율의 소수부·후행 0을 보존한다', async () => {
    const empty = [...values];
    empty[0] = '20251';
    for (const index of [3, 4, 5, 6, 7, 8, 9]) empty[index] = '';
    const precise = [...values];
    precise[3] = '0.0';
    precise[8] = '12345678901234567890.1234567890123456789000';
    precise[9] = '0';
    files.set('district.csv', csv([empty.join(','), precise.join(',')]));
    const result = await probe(2);
    expect(result).toMatchObject({ periodFrom: '20251', periodTo: '20262' });
    expect(result.sample[0]).toMatchObject({
      storeCount: null,
      generalStoreCount: null,
      franchiseStoreCount: null,
      openedStoreCount: null,
      closedStoreCount: null,
      openingRate: null,
      closureRate: null,
    });
    expect(result.sample[1]).toMatchObject({
      storeCount: '0',
      openingRate: '12345678901234567890.1234567890123456789000',
      closureRate: '0',
    });
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
    [3, '1e99999999999999999999999'],
    [3, '1e-99999999999999999999999'],
    [3, '-0'],
    [3, ' 1'],
    [3, 'NULL'],
    [3, 'NaN'],
    [3, 'Infinity'],
    [3, '１'],
    [4, '-1'],
    [5, '-1'],
    [6, '-1'],
    [7, '-1'],
    [8, '-0.1'],
    [8, '1e2'],
    [8, 'NULL'],
    [8, 'NaN'],
    [8, 'Infinity'],
    [8, '"1.2\n"'],
    [9, '-1'],
  ])('잘못된 코드·수치 입력을 거부한다: %s=%s', async (index, value) => {
    const row = [...values];
    row[Number(index)] = String(value);
    files.set('district.csv', csv([row.join(',')]));
    await expect(probe()).rejects.toThrow(/1번째 데이터 행/);
  });

  it.each([
    ['9'.repeat(131072), true],
    ['0.' + '1'.repeat(16383), true],
    ['9'.repeat(131073), false],
    ['0.' + '1'.repeat(16384), false],
  ])(
    '기존 NUMERIC 정수부·소수부 경계를 따른다: %#',
    async (input, accepted) => {
      const row = [...values];
      row[8] = input as string;
      files.set('district.csv', csv([row.join(',')]));
      if (accepted) expect((await probe()).sample[0]!.openingRate).toBe(input);
      else await expect(probe()).rejects.toThrow(/수치/);
    },
  );

  it('다섯 샘플 이후도 전부 검증·집계하고 전체 바이트 체크섬을 계산한다', async () => {
    const bytes = csv(distinctRows(11));
    files.set('district.csv', bytes);
    const result = await probe(11);
    expect(result.sample).toHaveLength(5);
    expect(result.sample.map((row) => row.districtCode)).toEqual([
      '11000',
      '11001',
      '11002',
      '11003',
      '11004',
    ]);
    expect(result).toMatchObject({
      fetchedRows: 11,
      validRows: 11,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('다섯 샘플 이후의 복합키 중복도 실패시키며 값을 출력하지 않는다', async () => {
    const rows = distinctRows(6);
    rows.push(rows[0]!);
    files.set('district.csv', csv(rows));
    await expect(probe(7)).rejects.toThrow(/7번째 데이터 행.*중복/);
  });

  it('다섯 샘플 이후의 잘못된 값도 실패시키며 민감한 원문을 숨긴다', async () => {
    const row = [...values];
    row[8] = 'https://user:secret@private.example';
    files.set('district.csv', csv([...distinctRows(5), row.join(',')]));
    const error = await probe(6).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/6번째 데이터 행/);
    expect((error as Error).message).not.toMatch(
      /user|secret|private|https|sample/,
    );
  });

  it.each([
    `${header},STOR_CO\n${values.join(',')},43`,
    `${header},일반_점포_수\n${values.join(',')},43`,
    `${header.replace(',SIGNGU_CD,', ',ADSTRD_CD,')}\n${values.join(',')}`,
    `${header.replace(',SIGNGU_CD,', ',자치구_코드_명,')}\n${values.join(',')}`,
    `${header.replace(',STOR_CO,', ',,')}\n${values.join(',')}`,
    `${header}\n${values.join(',')},extra`,
    `${header}\n${values.slice(0, -1).join(',')}`,
    `${header}\n`,
    '',
  ])(
    '누락·모호·중복 헤더, 열 수 불일치, 빈 파일을 거부한다: %#',
    async (text) => {
      files.set('district.csv', encode(text));
      await expect(probe()).rejects.toThrow(/자치구 점포 CSV/);
    },
  );

  it('뒤쪽 CSV 문법 오류와 원본 1 MiB 초과 레코드를 안전하게 거부한다', async () => {
    files.set(
      'district.csv',
      encode(`${header}\n${values.join(',')}\n20262,"secret-unclosed`),
    );
    await expect(probe(2)).rejects.toThrow(/CSV.*구조/);
    files.set(
      'district.csv',
      encode(`${header},NAME\n${values.join(',')},${'a'.repeat(1024 * 1024)}`),
    );
    await expect(probe()).rejects.toThrow(/CSV.*구조/);
  });

  it('CP949 원본은 실제 디코더로 읽으며 ZIP과 CSV의 체크섬은 같다', async () => {
    const bytes = Buffer.concat([
      Buffer.from(`${header},SIGNGU_CD_NM\n${values.join(',')},`),
      Buffer.from('c4bfc7c72dc0bdb7e1', 'hex'),
    ]);
    files.set('district.csv', bytes);
    files.set('district.zip', zipSync({ '원본/DISTRICT.CSV': bytes }));
    const plain = await probe();
    const zipped = await probe(1, 'district.zip');
    expect(plain.encoding).toBe('CP949');
    expect(zipped.checksum).toBe(plain.checksum);
    expect(zipped.sample).toEqual(plain.sample);
  });

  it('손상·모호한 ZIP과 잘못된 인코딩을 안전한 파일 오류로 변환한다', async () => {
    const bytes = csv([values.join(',')]);
    const corrupt = zipSync({ 'secret.csv': bytes }, { level: 0 });
    corrupt[30 + 'secret.csv'.length] = corrupt[30 + 'secret.csv'.length]! ^ 1;
    const inputs = [
      corrupt,
      zipSync({ 'first.csv': bytes, 'second.csv': bytes }),
      Buffer.from('504b0304', 'hex'),
    ];
    for (const input of inputs) {
      files.set('secret.zip', input);
      await expect(probe(1, 'secret.zip')).rejects.toThrow(
        /^자치구 점포 원본 파일을 읽거나 해석할 수 없습니다\.$/,
      );
    }
    files.set('district.csv', Buffer.from('efbbbf80', 'hex'));
    await expect(probe()).rejects.toThrow(/^자치구 점포 원본 파일/);
    await expect(probe(1, 'secret-path.csv')).rejects.toThrow(
      /^자치구 점포 원본 파일을 읽거나 해석할 수 없습니다\.$/,
    );
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    '프로그램 호출에서도 예상 건수 %s를 거부한다',
    async (expectedRows) => {
      files.set('district.csv', csv([values.join(',')]));
      await expect(probe(expectedRows)).rejects.toThrow(/예상 행 수/);
    },
  );

  it('예상 건수와 실제 전체 행 수가 다르면 샘플 성공 결과를 반환하지 않는다', async () => {
    files.set('district.csv', csv(distinctRows(7)));
    await expect(probe(5)).rejects.toThrow(/예상 행 수.*일치하지/);
  });

  it('프로그램 호출에서 probe가 명시되지 않아도 파일 처리를 시작하지 않는다', async () => {
    await expect(
      probeDistrictStoreSource({
        source: 'district.csv',
        expectedRows: 1,
        probe: false,
      } as never),
    ).rejects.toThrow(/probe 모드/);
  });
});
