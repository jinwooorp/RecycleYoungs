import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseDistrictFootTrafficArguments } from '../../cli/arguments.js';

const header = 'STDR_YYQU_CD,SIGNGU_CD,TOT_FLPOP_CO,ML_FLPOP_CO,FML_FLPOP_CO';
const syntheticCsv = [
  header,
  ...Array.from(
    { length: 7 },
    (_, index) =>
      `20262,${String(11110 + index)},9007199254740993.12345678901234567890,,1e1`,
  ),
].join('\n');

// 메모리의 CSV만 공급하고 실제 CLI가 DB 풀·소켓·fetch에 접근하면 실패시킵니다.
function runProbe(
  contents: string,
  args: string[],
  databaseUrl?: string,
  forbidInput = false,
  apiKey?: string,
  apiPages?: { url: string; body: unknown }[],
) {
  const preload = `
    import { readFileSync } from 'node:fs';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports, createRequire } from 'node:module';
    import { resolve } from 'node:path';
    import { pathToFileURL } from 'node:url';
    import net from 'node:net';
    // 전체 페이지 fixture는 운영체제의 단일 인자 길이 제한을 피하도록 stdin으로 전달합니다.
    const { csv, pages } = JSON.parse(readFileSync(0, 'utf8'));
    const original = fs.readFile;
    fs.readFile = async (path, ...options) => {
      if (String(path) === '/virtual/district-foot-traffic.csv') {
        if (${forbidInput}) throw new Error('SOURCE_READ_FORBIDDEN');
        return Buffer.from(csv);
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
    globalThis.fetch = async (url, options) => {
      const page = pages?.shift();
      if (!page || url !== page.url || options?.redirect !== 'manual') {
        process.exit(97);
      }
      return Response.json(page.body);
    };
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
      input: JSON.stringify({ csv: contents, pages: apiPages }),
      timeout: 10000,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        SEMAS_API_KEY: undefined,
        SEOUL_OPEN_API_KEY: apiKey,
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
    expect(result.stdout).toContain('district-foot-traffic --api --probe');
    expect(result.stdout).toContain('district-foot-traffic --api --publish');
    expect(result.stdout).toContain('--allow-insecure-http');
    expect(result.stderr).toBe('');
  });

  it('기본 HTTP 주소의 인증 probe는 fetch 호출 없이 BLOCKED로 종료한다', () => {
    const result = runProbe(
      '',
      ['--api', '--probe'],
      'invalid-database-url',
      true,
      'cli-test-key',
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(
      'BLOCKED: 공식 HTTP 주소의 인증 요청에는 --allow-insecure-http가 필요합니다.',
    );
    expect(result.stderr).not.toContain('cli-test-key');
  });

  it('API 키가 없으면 DB나 API에 접근하지 않고 BLOCKED로 종료한다', () => {
    const result = runProbe(
      '',
      ['--api', '--probe', '--allow-insecure-http'],
      'invalid-database-url',
      true,
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('BLOCKED: 전체 수집용 SEOUL_OPEN_API_KEY');
  });

  it('HTTP 옵션으로 합성 550행 전부를 수집하고 DB 없이 CSV와 대조한다', () => {
    const key = 'cli-test-key';
    const rows = Array.from({ length: 550 }, (_, index) => ({
      STDR_YYQU_CD: String(
        20211 + 10 * Math.floor(index / 100) + (Math.floor(index / 25) % 4),
      ),
      SIGNGU_CD: String(11110 + (index % 25)),
      TOT_FLPOP_CO: '9007199254740993.12345678901234567890',
      ML_FLPOP_CO: null,
      FML_FLPOP_CO: 0,
    }));
    const csv = [
      header,
      ...rows.map(
        (row) => `${row.STDR_YYQU_CD},${row.SIGNGU_CD},${row.TOT_FLPOP_CO},,0`,
      ),
    ].join('\n');
    const pages = Array.from({ length: 6 }, (_, index) => {
      const start = index * 100;
      const end = Math.min(start + 100, rows.length);
      return {
        url: `http://openapi.seoul.go.kr:8088/${key}/json/VwsmSignguFlpopW/${start + 1}/${end}/`,
        body: {
          VwsmSignguFlpopW: {
            RESULT: { CODE: 'INFO-000' },
            list_total_count: rows.length,
            row: rows.slice(start, end),
          },
        },
      };
    });
    const result = runProbe(
      csv,
      [
        '--api',
        '--probe',
        '--allow-insecure-http',
        '--expected-rows',
        '550',
        '--compare-csv',
        '/virtual/district-foot-traffic.csv',
      ],
      'invalid-database-url',
      false,
      key,
      pages,
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      validationScope: 'OPEN_API_FULL_COLLECTION',
      databaseChecked: false,
      batchCreated: false,
      loadedRows: 0,
      reportedRows: 550,
      fetchedRows: 550,
      validRows: 550,
      rejectedRows: 0,
      pages: 6,
      csvComparison: { matchedRows: 550, comparedValues: 1650 },
    });
    expect(result.stdout).not.toMatch(/cli-test-key|http:\/\/|\/virtual\//);
  });

  it.each([
    ['--api'],
    ['--api', ...validArgs],
    ['--api', '--allow-insecure-http'],
    ['--api', '--probe', '--api'],
    ['--api', '--probe', '--allow-insecure-http', '--allow-insecure-http'],
    ['--api', '--probe', '--expected-rows', '0'],
    ['--api', '--probe', '--compare-csv', ' '],
    ['--api', '--probe', '--compare-csv', 'a.csv', '--compare-csv', 'b.csv'],
    [...validArgs, '--compare-csv', 'a.csv'],
    [...validArgs, '--allow-insecure-http'],
    [...validArgs.slice(1), '--allow-insecure-http'],
  ])(
    '부적절한 API 인자는 외부 요청과 DB 분기 전에 거부한다 (%#)',
    (...args) => {
      const result = runProbe(
        '',
        args,
        'invalid-database-url',
        true,
        'cli-test-key',
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(
        /--api|--compare-csv|옵션은 중복|API 예상 행 수/,
      );
      expect(result.stderr).not.toMatch(/cli-test-key|DATABASE_URL/);
    },
  );

  it.each([
    ['--api', '--publish'],
    ['--api', '--publish', '--expected-rows', '0'],
    ['--api', '--publish', '--probe', '--expected-rows', '550'],
    ['--api', '--publish', '--source', 'a.csv', '--expected-rows', '550'],
    ['--api', '--publish', '--compare-csv', 'a.csv', '--expected-rows', '550'],
    ['--api', '--publish', '--publish', '--expected-rows', '550'],
    ['--api', '--expected-rows', '550'],
    [...validArgs.slice(1), '--publish'],
  ])('게시 충돌 인자를 DB 연결과 fetch 전에 거부한다 (%#)', (...args) => {
    const result = runProbe(
      '',
      args,
      'invalid-database-url',
      true,
      'cli-test-key',
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(
      /--publish|--compare-csv|--expected-rows|옵션은 중복/,
    );
    expect(result.stderr).not.toMatch(
      /cli-test-key|DATABASE_URL|DB_POOL_FORBIDDEN/,
    );
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
      /DB_POOL_FORBIDDEN|NETWORK_FORBIDDEN|password|invalid-database-url/,
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
      expect(result.stderr).not.toMatch(/DB_POOL_FORBIDDEN|NETWORK_FORBIDDEN/);
    },
  );
});
