import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseDistrictSalesArguments } from './index.js';

const header =
  'STDR_YYQU_CD,SIGNGU_CD,SVC_INDUTY_CD,THSMON_SELNG_AMT,THSMON_SELNG_CO,MDWK_SELNG_AMT,WKEND_SELNG_AMT';
const syntheticCsv = [
  header,
  ...Array.from(
    { length: 7 },
    (_, index) =>
      `20262,${String(11110 + index)},CS100010,9007199254740993.0,0,,1e1`,
  ),
].join('\n');

// 파일은 메모리에서만 공급하고 실제 CLI의 DB 풀·소켓·공공 API 사용은 즉시 실패시킨다.
function runProbe(contents: string, args: string[], databaseUrl?: string) {
  const preload = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports, createRequire } from 'node:module';
    import { resolve } from 'node:path';
    import { pathToFileURL } from 'node:url';
    import net from 'node:net';
    const original = fs.readFile;
    fs.readFile = async (path, ...options) => String(path) === '/virtual/district-sales.csv'
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
      'district-sales',
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

const validArgs = [
  '--probe',
  '--source',
  '/virtual/district-sales.csv',
  '--expected-rows',
  '7',
];

describe('자치구 추정매출 읽기 전용 CLI', () => {
  it.each([undefined, 'invalid-database-url'])(
    'DB 설정 %s와 무관하게 풀·네트워크 없이 전체 파일을 검증한다',
    (databaseUrl) => {
      const result = runProbe(syntheticCsv, validArgs, databaseUrl);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({
        mode: 'PROBE',
        datasetId: 'OA-22176',
        serviceName: 'VwsmSignguSelngW',
        validationScope: 'LOCAL_FILE_FORMAT',
        databaseChecked: false,
        batchCreated: false,
        loadedRows: 0,
        expectedRows: 7,
        fetchedRows: 7,
        validRows: 7,
        rejectedRows: 0,
      });
      expect(output.sample).toHaveLength(5);
      expect(output.sample[0]).toEqual({
        districtCode: '11110',
        quarterCode: '20262',
        industryCode: 'CS100010',
        monthlySalesAmount: '9007199254740993',
        monthlySalesCount: '0',
        weekdaySalesAmount: null,
        weekendSalesAmount: '10',
      });
      expect(output).not.toHaveProperty('batchId');
      expect(result.stdout).not.toContain('/virtual/');
      expect(result.stdout).not.toContain('invalid-database-url');
    },
  );

  it('probe와 적재가 같은 원본·예상 건수 계약을 사용한다', () => {
    expect(
      parseDistrictSalesArguments(['district-sales', ...validArgs]),
    ).toEqual({
      source: '/virtual/district-sales.csv',
      expectedRows: 7,
      probe: true,
    });
    expect(
      parseDistrictSalesArguments(['district-sales', ...validArgs.slice(1)]),
    ).toEqual({
      source: '/virtual/district-sales.csv',
      expectedRows: 7,
      probe: false,
    });
  });

  it('probe 없는 적재 모드는 DB 설정이 필요하고 probe 성공을 반환하지 않는다', () => {
    const result = runProbe(syntheticCsv, validArgs.slice(1));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toMatch(/DB_POOL_FORBIDDEN|NETWORK_FORBIDDEN/);
  });

  it('도움말은 DB 없이 읽기 전용 명령을 안내한다', () => {
    const result = runProbe('', ['--help'], 'invalid-database-url');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('district-sales [--probe]');
    expect(result.stderr).toBe('');
  });

  it.each([
    ['--probe'],
    ['--probe', '--source', 'input.csv'],
    ['--probe', '--expected-rows', '1'],
    ['--probe', '--source', '', '--expected-rows', '1'],
    ['--probe', '--source', ' ', '--expected-rows', '1'],
    [...validArgs, '--probe'],
    [...validArgs, '--source', 'other.csv'],
    [...validArgs, '--expected-rows', '8'],
    [...validArgs, '--secret-postgresql://user:password@host'],
    [...validArgs, 'unexpected'],
    ...[
      '0',
      '-1',
      '1.5',
      '1e2',
      '1\n',
      '9007199254740992',
      'NaN',
      'Infinity',
      '',
    ].map((count) => [
      '--probe',
      '--source',
      'input.csv',
      '--expected-rows',
      count,
    ]),
  ])('부적절한 인자는 안전하게 실패한다: %j', (...args) => {
    const result = runProbe(syntheticCsv, args, 'invalid-database-url');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
    expect(result.stderr).not.toMatch(
      /DB_POOL_FORBIDDEN|NETWORK_FORBIDDEN|PUBLIC_API_FORBIDDEN|password|invalid-database-url/,
    );
  });

  it.each([
    [syntheticCsv, [...validArgs.slice(0, -1), '8']],
    [
      syntheticCsv + '\n20262,11190,CS100010,-1,0,0,0',
      [...validArgs.slice(0, -1), '8'],
    ],
    [
      syntheticCsv + '\n' + syntheticCsv.split('\n')[1],
      [...validArgs.slice(0, -1), '8'],
    ],
  ])(
    '전체 검증 실패 시 부분 sample이나 성공 JSON을 출력하지 않는다: %#',
    (csv, args) => {
      const result = runProbe(csv, args, 'invalid-database-url');
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toBe('');
      expect(result.stderr).not.toMatch(
        /DB_POOL_FORBIDDEN|NETWORK_FORBIDDEN|PUBLIC_API_FORBIDDEN/,
      );
    },
  );
});
