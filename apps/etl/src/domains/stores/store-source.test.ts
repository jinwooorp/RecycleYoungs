import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoreSource, type StoreStatRow } from './store-source.js';

// 파일 생성 없이 파일 읽기만 대체하고, 실제 CSV·ZIP 판독과 수치 검증을 실행합니다.
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
const files = new Map<string, Uint8Array>();
const header =
  'STDR_YYQU_CD,ADSTRD_CD,SVC_INDUTY_CD,SIMILR_INDUTY_STOR_CO,STOR_CO,FRC_STOR_CO,OPBIZ_STOR_CO,CLSBIZ_STOR_CO,OPBIZ_RT,CLSBIZ_RT';
const values = [
  '20262',
  '11740700',
  'CS100010',
  '33',
  '30',
  '3',
  '2',
  '1',
  '200',
  '300',
];
const encode = (text: string) => new TextEncoder().encode(text);
const csv = (rows: string[]) => encode(header + '\n' + rows.join('\n'));
const collect = async (path = 'stores.csv') => {
  const rows: StoreStatRow[] = [];
  const result = await readStoreSource(path, async (batch) => {
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

describe('점포 통계 원본', () => {
  it('실제 원본의 한글 헤더를 V3 필드로 명시적으로 매핑한다', async () => {
    files.set(
      'stores.csv',
      encode(
        '기준_년분기_코드,행정동_코드,서비스_업종_코드,전체_점포_수,일반_점포_수,프랜차이즈_점포_수,개업_점포_수,폐업_점포_수,개업_율,폐업_률\n' +
          values.join(','),
      ),
    );
    expect((await collect()).rows[0]).toMatchObject({
      storeCount: '33',
      generalStoreCount: '30',
      openingRate: '200',
      closureRate: '300',
    });
  });

  it('CP949 원본의 한글 문자열을 대체 문자 없이 읽는다', async () => {
    files.set(
      'stores.csv',
      Buffer.concat([
        Buffer.from(`${header},NAME\n${values.join(',')},`),
        Buffer.from('c4bfc7c72dc0bdb7e1', 'hex'),
      ]),
    );
    expect((await collect()).result.encoding).toBe('CP949');
  });

  it('V3 컬럼 의미와 100% 초과 비율을 보존한다', async () => {
    files.set('stores.csv', csv([values.join(',')]));
    expect(await collect()).toMatchObject({
      rows: [
        {
          dongCode: '11740700',
          industryCode: 'CS100010',
          quarterCode: '20262',
          storeCount: '33',
          generalStoreCount: '30',
          franchiseStoreCount: '3',
          openedStoreCount: '2',
          closedStoreCount: '1',
          openingRate: '200',
          closureRate: '300',
        },
      ],
      result: {
        fetchedRows: 1,
        validRows: 1,
        rejectedRows: 0,
        periodFrom: '20262',
        periodTo: '20262',
        encoding: 'UTF-8',
      },
    });
  });

  it('NULL과 0 및 BIGINT·NUMERIC의 원본 정밀도를 보존한다', async () => {
    const row = [...values];
    row[3] = '9223372036854775807';
    row[4] = '';
    row[5] = '0';
    row[8] = '12345678901234567890.12345678901234567890';
    row[9] = '';
    files.set('stores.csv', csv([row.join(',')]));
    expect((await collect()).rows[0]).toMatchObject({
      storeCount: '9223372036854775807',
      generalStoreCount: null,
      franchiseStoreCount: '0',
      openingRate: '12345678901234567890.12345678901234567890',
      closureRate: null,
    });
  });

  it('ZIP 포장과 경로가 달라도 동일 CSV 체크섬을 사용한다', async () => {
    const bytes = csv([values.join(',')]);
    files.set('stores.csv', bytes);
    files.set('stores.zip', zipSync({ '원본/STORES.CSV': bytes }));
    const plain = await collect();
    const zipped = await collect('stores.zip');
    expect(zipped.rows).toEqual(plain.rows);
    expect(zipped.result.checksum).toBe(plain.result.checksum);
    expect(zipped.result.entry).toBe('원본/STORES.CSV');
  });

  it.each([
    [0, '20260'],
    [0, '20265'],
    [0, '2026Q1'],
    [0, ''],
    [0, '"20262\n"'],
    [1, '1174070'],
    [1, '１１７４０７００'],
    [1, ''],
    [1, '"11740700\n"'],
    [2, 'cs100010'],
    [2, 'CS10001A'],
    [2, ''],
    [2, '"CS100010\n"'],
    [3, '-1'],
    [3, '1.0'],
    [3, '1e3'],
    [3, '9223372036854775808'],
    [3, ' 1'],
    [3, '"1\n"'],
    [8, '-0.1'],
    [8, 'NaN'],
    [8, 'Infinity'],
    [8, '1e2'],
    [8, 'NULL'],
    [8, '"1.2\n"'],
  ])('잘못된 필수 코드·분기·수치를 거부한다: %s=%s', async (index, value) => {
    const row = [...values];
    row[Number(index)] = String(value);
    files.set('stores.csv', csv([row.join(',')]));
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 1,
      validRows: 0,
      rejectedRows: 1,
    });
  });

  it('같은 복합키는 수치가 같아도 거부하며 앞선 유효 행 수를 보존한다', async () => {
    files.set('stores.csv', csv([values.join(','), values.join(',')]));
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 2,
      validRows: 1,
      rejectedRows: 1,
    });
  });

  it.each(['9'.repeat(131073), '0.' + '1'.repeat(16384)])(
    'NUMERIC 저장 한계를 넘는 비율을 사전에 거부한다',
    async (value) => {
      const row = [...values];
      row[8] = value;
      files.set('stores.csv', csv([row.join(',')]));
      await expect(collect()).rejects.toMatchObject({
        fetchedRows: 1,
        validRows: 0,
        rejectedRows: 1,
      });
    },
  );

  it('같은 청크 뒤쪽의 문법 오류에도 이미 검증한 행 수를 보존한다', async () => {
    files.set(
      'stores.csv',
      encode(`${header}\n${values.join(',')}\n20262,"닫히지 않은 인용부호`),
    );
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 2,
      validRows: 1,
      rejectedRows: 1,
    });
  });

  it('다른 분기는 별도 행으로 허용하고 기간 범위를 계산한다', async () => {
    const earlier = [...values];
    earlier[0] = '20251';
    files.set('stores.csv', csv([values.join(','), earlier.join(',')]));
    expect((await collect()).result).toMatchObject({
      fetchedRows: 2,
      periodFrom: '20251',
      periodTo: '20262',
    });
  });

  it.each([
    `${header},STOR_CO\n${values.join(',')},30`,
    `${header.replace('STOR_CO,FRC_STOR_CO', '일반_점포_수,STOR_CO')}\n${values.join(',')}`,
    `${header}\n${values.join(',')},extra`,
    `${header}\n`,
    '',
  ])('잘못된 헤더·열 수·빈 원본을 거부한다', async (text) => {
    files.set('stores.csv', encode(text));
    await expect(collect()).rejects.toThrow();
  });

  it('인용부호·쉼표·개행은 다른 컬럼에 있어도 올바르게 처리한다', async () => {
    files.set(
      'stores.csv',
      encode(
        `\uFEFF${header},비고\r\n${values.join(',')},"쉼표, 인용부호 ""표시""\r\n두 줄"\r\n`,
      ),
    );
    expect((await collect()).rows).toHaveLength(1);
  });

  it('대량 행은 한 번에 1000개 이하로 전달하고 다음 처리는 callback 완료를 기다린다', async () => {
    const rows = Array.from({ length: 2001 }, (_, index) => {
      const row = [...values];
      row[1] = String(11000000 + index);
      return row.join(',');
    });
    files.set('stores.csv', csv(rows));
    let inFlight = false;
    const sizes: number[] = [];
    const result = await readStoreSource('stores.csv', async (batch) => {
      expect(inFlight).toBe(false);
      inFlight = true;
      sizes.push(batch.length);
      await Promise.resolve();
      inFlight = false;
    });
    expect(sizes).toEqual([1000, 1000, 1]);
    expect(result.validRows).toBe(2001);
  });

  it('staging callback 오류는 원본 거부 행으로 잘못 세지 않는다', async () => {
    files.set('stores.csv', csv([values.join(',')]));
    await expect(
      readStoreSource('stores.csv', async () => {
        throw new Error('staging failure');
      }),
    ).rejects.toMatchObject({
      fetchedRows: 1,
      validRows: 1,
      rejectedRows: 0,
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});
