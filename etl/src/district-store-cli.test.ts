import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseDistrictStoreArguments } from './index.js';

// 실제 CLI를 실행하되 원본 파일은 메모리로 공급하고 DB 풀·네트워크 생성을 즉시 실패시킨다.
const header =
  'STDR_YYQU_CD,SIGNGU_CD,SVC_INDUTY_CD,SIMILR_INDUTY_STOR_CO,STOR_CO,FRC_STOR_CO,OPBIZ_STOR_CO,CLSBIZ_STOR_CO,OPBIZ_RT,CLSBIZ_RT';
const syntheticCsv = [
  header,
  ...Array.from(
    { length: 7 },
    (_, index) =>
      `20262,${String(11110 + index)},CS100010,9007199254740993.0,0,,2.0,1,200.123456789012345678900,0.0000`,
  ),
].join('\n');

function runProbe(contents: string, args: string[] = [], databaseUrl?: string) {
  const preload = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports, createRequire } from 'node:module';
    import { resolve } from 'node:path';
    import { pathToFileURL } from 'node:url';
    import net from 'node:net';
    const original = fs.readFile;
    fs.readFile = async (path, ...options) => String(path) === '/virtual/district-stores.csv'
      ? Buffer.from(${JSON.stringify(contents)}) : original(path, ...options);
    syncBuiltinESMExports();
    const require = createRequire(pathToFileURL(resolve('package.json')));
    const pg = require('pg');
    Object.defineProperty(pg, 'Pool', { configurable: true, value: class {
      constructor() { throw new Error('DB_POOL_FORBIDDEN'); }
    }});
    net.Socket.prototype.connect = function () { throw new Error('NETWORK_FORBIDDEN'); };
    globalThis.fetch = async () => { throw new Error('PUBLIC_API_FORBIDDEN'); };
  `;
  return spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      '--import',
      'tsx',
      'src/index.ts',
      'district-stores',
      ...args,
    ],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        SEMAS_API_KEY: undefined,
      },
    },
  );
}

describe('자치구 점포 읽기 전용 CLI', () => {
  it('적재와 probe 모두 입력 버전의 전체 행 수를 요구한다', () => {
    expect(
      parseDistrictStoreArguments([
        'district-stores',
        '--source',
        'input.csv',
        '--expected-rows',
        '7',
      ]),
    ).toEqual({ source: 'input.csv', expectedRows: 7, probe: false });
    expect(
      parseDistrictStoreArguments([
        'district-stores',
        '--probe',
        '--source',
        '/virtual/district-stores.csv',
        '--expected-rows',
        '7',
      ]),
    ).toEqual({
      source: '/virtual/district-stores.csv',
      expectedRows: 7,
      probe: true,
    });
    expect(
      parseDistrictStoreArguments(['district-stores', '--help']),
    ).toBeNull();
  });

  it.each([
    ['district-stores', '--probe', '--expected-rows', '7'],
    ['district-stores', '--probe', '--source', 'input.csv'],
    ['district-stores', '--probe', '--source', '', '--expected-rows', '7'],
    ['district-stores', '--probe', '--source', ' ', '--expected-rows', '7'],
    [
      'district-stores',
      '--probe',
      '--probe',
      '--source',
      'input.csv',
      '--expected-rows',
      '7',
    ],
    [
      'district-stores',
      '--probe',
      '--source',
      'input.csv',
      '--source',
      'other.csv',
      '--expected-rows',
      '7',
    ],
    [
      'district-stores',
      '--probe',
      '--source',
      'input.csv',
      '--expected-rows',
      '7',
      '--expected-rows',
      '8',
    ],
    [
      'district-stores',
      '--probe',
      '--source',
      'input.csv',
      '--expected-rows',
      '7',
      '--write',
    ],
    ['stores', '--probe', '--source', 'input.csv', '--expected-rows', '7'],
  ])('부적절한 실행 인자는 DB 분기에 들어가기 전에 거부한다: %j', (...args) => {
    expect(() => parseDistrictStoreArguments(args)).toThrow();
  });

  it.each([
    '0',
    '-1',
    '1.5',
    '1e2',
    '1\n',
    '9007199254740992',
    'NaN',
    'Infinity',
    '',
  ])('예상 원본 건수 %s를 엄격하게 검증한다', (count) => {
    expect(() =>
      parseDistrictStoreArguments([
        'district-stores',
        '--probe',
        '--source',
        'input.csv',
        '--expected-rows',
        count,
      ]),
    ).toThrow();
  });

  it.each([undefined, 'invalid-database-url'])(
    'DB 설정이 %s이어도 실제 풀·네트워크를 생성하지 않고 전체 파일을 검증한다',
    (databaseUrl) => {
      const result = runProbe(
        syntheticCsv,
        [
          '--probe',
          '--source',
          '/virtual/district-stores.csv',
          '--expected-rows',
          '7',
        ],
        databaseUrl,
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({
        mode: 'PROBE',
        datasetId: 'OA-22173',
        databaseChecked: false,
        batchCreated: false,
        loadedRows: 0,
        fetchedRows: 7,
        validRows: 7,
        rejectedRows: 0,
        expectedRows: 7,
        periodFrom: '20262',
        periodTo: '20262',
      });
      expect(output.sample).toHaveLength(5);
      expect(output.sample[0]).toMatchObject({
        districtCode: '11110',
        storeCount: '9007199254740993',
        generalStoreCount: '0',
        franchiseStoreCount: null,
        openingRate: '200.123456789012345678900',
        closureRate: '0.0000',
      });
      expect(output).not.toHaveProperty('batchId');
      expect(result.stdout).not.toContain('invalid-database-url');
    },
  );

  it('5행 표본 뒤에 있는 오류도 실패로 처리하고 성공 JSON이나 부분 표본을 출력하지 않는다', () => {
    const invalid = syntheticCsv + '\n20262,11190,CS100010,-1,0,0,0,0,0,0';
    const result = runProbe(invalid, [
      '--probe',
      '--source',
      '/virtual/district-stores.csv',
      '--expected-rows',
      '8',
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
    expect(result.stderr).not.toContain('DB_POOL_FORBIDDEN');
    expect(result.stderr).not.toContain('invalid-database-url');
  });

  it('예상 행 수가 다르면 DB·배치 없이 실패한다', () => {
    const result = runProbe(syntheticCsv, [
      '--probe',
      '--source',
      '/virtual/district-stores.csv',
      '--expected-rows',
      '8',
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('행 수');
    expect(result.stderr).not.toContain('DB_POOL_FORBIDDEN');
  });

  it('적재 모드는 DB 설정을 요구하고 probe 성공으로 오인시키지 않는다', () => {
    const result = runProbe(syntheticCsv, [
      '--source',
      '/virtual/district-stores.csv',
      '--expected-rows',
      '7',
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('DB_POOL_FORBIDDEN');
  });
});
