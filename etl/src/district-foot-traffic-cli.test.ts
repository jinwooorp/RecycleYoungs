import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseDistrictFootTrafficArguments } from './index.js';

const header = 'STDR_YYQU_CD,SIGNGU_CD,TOT_FLPOP_CO,ML_FLPOP_CO,FML_FLPOP_CO';
const syntheticCsv = [
  header,
  ...Array.from(
    { length: 7 },
    (_, index) =>
      `20262,${String(11110 + index)},9007199254740993.12345678901234567890,,1e1`,
  ),
].join('\n');

// 파일은 메모리에서만 공급하고 실제 CLI의 DB 풀·소켓·공공 API 사용은 즉시 실패시킨다.
function runProbe(
  contents: string,
  args: string[],
  databaseUrl?: string,
  forbidInput = false,
) {
  const preload = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports, createRequire } from 'node:module';
    import { resolve } from 'node:path';
    import { pathToFileURL } from 'node:url';
    import net from 'node:net';
    const original = fs.readFile;
    fs.readFile = async (path, ...options) => {
      if (String(path) === '/virtual/district-foot-traffic.csv') {
        if (${forbidInput}) throw new Error('SOURCE_READ_FORBIDDEN');
        return Buffer.from(${JSON.stringify(contents)});
      }
      return original(path, ...options);
    };
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
      'district-foot-traffic',
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
  '/virtual/district-foot-traffic.csv',
  '--expected-rows',
  '7',
];

describe('자치구 길단위인구 읽기 전용 CLI', () => {
  it.each([undefined, 'invalid-database-url'])(
    'DB 설정 %s와 무관하게 풀·네트워크 없이 전체 파일을 검증한다',
    (databaseUrl) => {
      const result = runProbe(syntheticCsv, validArgs, databaseUrl);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({
        mode: 'PROBE',
        datasetId: 'OA-22179',
        serviceName: 'VwsmSignguFlpopW',
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
        totalFootTraffic: '9007199254740993.12345678901234567890',
        maleFootTraffic: null,
        femaleFootTraffic: '10',
      });
      expect(output).not.toHaveProperty('batchId');
      expect(result.stdout).not.toContain('/virtual/');
      expect(result.stdout).not.toContain('invalid-database-url');
    },
  );

  it('프로그램 인자 파서는 probe와 명시적 적재 모드를 구분한다', () => {
    expect(
      parseDistrictFootTrafficArguments([
        'district-foot-traffic',
        ...validArgs,
      ]),
    ).toEqual({
      source: '/virtual/district-foot-traffic.csv',
      expectedRows: 7,
      probe: true,
    });
    expect(
      parseDistrictFootTrafficArguments([
        'district-foot-traffic',
        ...validArgs.slice(1),
      ]),
    ).toEqual({
      source: '/virtual/district-foot-traffic.csv',
      expectedRows: 7,
      probe: false,
    });
  });

  it('probe 생략은 적재 분기로 진입하고 잘못된 DB 설정에서 파일 판독 전에 실패한다', () => {
    const result = runProbe(
      syntheticCsv,
      validArgs.slice(1),
      'invalid-database-url',
      true,
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toMatch(
      /SOURCE_READ_FORBIDDEN|invalid-database-url/,
    );
  });

  it('도움말은 DB 없이 읽기 전용 명령을 안내한다', () => {
    const result = runProbe('', ['--help'], 'invalid-database-url');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('district-foot-traffic [--probe]');
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
    [syntheticCsv + '\n20262,11190,-1,0,0', [...validArgs.slice(0, -1), '8']],
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
