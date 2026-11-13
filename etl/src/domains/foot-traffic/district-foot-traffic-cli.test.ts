import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

type PublishedRowFixture = {
  districtCode: string;
  quarterCode: string;
  totalFootTraffic: string | null;
  maleFootTraffic: string | null;
  femaleFootTraffic: string | null;
  published: boolean;
  sourceType: string | null;
  sourceChecksum: string | null;
};

// 실제 CLI에는 메모리의 CSV·API·DB 응답만 공급하고 실제 소켓 연결을 차단합니다.
function runProbe(
  contents: string,
  args: string[],
  databaseUrl?: string,
  forbidInput = false,
  apiKey?: string,
  apiPages?: { url: string; body: unknown }[],
  db?: { rows: PublishedRowFixture[]; error?: boolean; changedCsv?: string },
) {
  const preload = `
    import { readFileSync } from 'node:fs';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports, createRequire } from 'node:module';
    import { resolve } from 'node:path';
    import { pathToFileURL } from 'node:url';
    import net from 'node:net';
    // 전체 페이지 fixture는 운영체제의 단일 인자 길이 제한을 피하도록 stdin으로 전달합니다.
    const { csv, pages, db } = JSON.parse(readFileSync(0, 'utf8'));
    const original = fs.readFile;
    let csvReads = 0;
    fs.readFile = async (path, ...options) => {
      if (String(path) === '/virtual/district-foot-traffic.csv') {
        if (${forbidInput}) throw new Error('SOURCE_READ_FORBIDDEN');
        return Buffer.from(csvReads++ > 0 ? (db?.changedCsv ?? csv) : csv);
      }
      return original(path, ...options);
    };
    syncBuiltinESMExports();
    const require = createRequire(pathToFileURL(resolve('package.json')));
    const pg = require('pg');
    Object.defineProperty(pg, 'Pool', { configurable: true, value: class {
      constructor() { if (!db || pages?.length) process.exit(96); }
      async connect() {
        let step = 0;
        return {
          async query(sql) {
            step += 1;
            if (step === 1 && sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') return;
            if (step === 2 && /^\\s*SELECT\\b/.test(sql) &&
                sql.includes('FROM district_foot_traffic_stat') &&
                (sql.match(/_foot_traffic::text/g) || []).length === 3) {
              if (db.error) throw new Error('db-driver-private-detail');
              return { rows: db.rows };
            }
            if (step === 3 && sql === 'ROLLBACK') return;
            process.exit(95);
          },
          release(discarded) { if (step !== 3 || discarded) process.exit(94); },
        };
      }
      async end() {}
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
      input: JSON.stringify({ csv: contents, pages: apiPages, db }),
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
    expect(result.stdout).toContain(
      'district-foot-traffic [--probe [--compare-db]]',
    );
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

  it.each([false, true])(
    '합성 550행·1650개 수치를 전수 대조한다 (DB 대조: %s)',
    (compareDb) => {
      const key = 'cli-test-key';
      const rows = Array.from({ length: 550 }, (_, index) => ({
        SIGNGU_CD: String(11110 + (index % 25)),
        STDR_YYQU_CD: String(
          20211 + 10 * Math.floor(index / 100) + (Math.floor(index / 25) % 4),
        ),
        TOT_FLPOP_CO: '9007199254740993.12345678901234567890',
        ML_FLPOP_CO: null,
        FML_FLPOP_CO: 0,
      }));
      const csv = [
        header,
        ...rows.map((row) =>
          [row.STDR_YYQU_CD, row.SIGNGU_CD, row.TOT_FLPOP_CO, '', '0'].join(
            ',',
          ),
        ),
      ].join('\n');
      const checksum = createHash('sha256').update(csv).digest('hex');
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
      const dbRows = rows
        .map((row) => ({
          districtCode: row.SIGNGU_CD,
          quarterCode: row.STDR_YYQU_CD,
          totalFootTraffic: row.TOT_FLPOP_CO,
          maleFootTraffic: null,
          femaleFootTraffic: '0.00',
          published: true,
          sourceType: 'CSV',
          sourceChecksum: checksum,
        }))
        .reverse();
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
          ...(compareDb ? ['--compare-db'] : []),
        ],
        compareDb ? 'postgres://localhost/test' : 'invalid-database-url',
        false,
        key,
        pages,
        compareDb ? { rows: dbRows } : undefined,
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({
        validationScope: 'OPEN_API_FULL_COLLECTION',
        databaseChecked: compareDb,
        batchCreated: false,
        loadedRows: 0,
        reportedRows: 550,
        fetchedRows: 550,
        validRows: 550,
        rejectedRows: 0,
        pages: 6,
        periodFrom: '20211',
        periodTo: '20262',
        csvComparison: { matchedRows: 550, comparedValues: 1650 },
      });
      expect(output.csvComparison.csvSha256).toBe(checksum);
      if (compareDb) {
        expect(output.dbComparison).toMatchObject({
          csvSha256: output.csvComparison.csvSha256,
          matchedRows: 550,
          comparedValues: 1650,
          districtCount: 25,
          quarterCount: 22,
          missingDistrictQuarterPairs: 0,
          representationDifferences: 550,
          matchingCsvSourceRows: 550,
        });
      } else {
        expect(output).not.toHaveProperty('dbComparison');
      }
      expect(result.stdout).not.toMatch(
        /cli-test-key|http:\/\/|postgres:|\/virtual\//,
      );
    },
  );

  const dbRow = {
    districtCode: '11110',
    quarterCode: '20262',
    totalFootTraffic: '9007199254740993.12345678901234567890',
    maleFootTraffic: null,
    femaleFootTraffic: '0.000',
    published: true,
    sourceType: 'API',
    sourceChecksum: 'a'.repeat(64),
  };
  const singleCsv = `${header}\n20262,11110,${dbRow.totalFootTraffic},,0`;
  const secondDbRow = { ...dbRow, districtCode: '11140', quarterCode: '20261' };
  const twoRowCsv = singleCsv + `\n20261,11140,${dbRow.totalFootTraffic},,0`;
  const twoRowChecksum = createHash('sha256').update(twoRowCsv).digest('hex');

  it.each([
    ['API', twoRowChecksum, 0],
    ['CSV', twoRowChecksum, 1],
  ])(
    '정상 API 배치와 혼합 출처를 허용한다 (두 번째 배치: %s)',
    (sourceType, sourceChecksum, matchedCsvRows) => {
      const result = runProbe(
        twoRowCsv,
        [...validArgs.slice(0, -1), '2', '--compare-db'],
        'postgres://localhost/test',
        false,
        undefined,
        undefined,
        { rows: [dbRow, { ...secondDbRow, sourceType, sourceChecksum }] },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        dbComparison: {
          matchedRows: 2,
          comparedValues: 6,
          districtCount: 2,
          quarterCount: 2,
          missingDistrictQuarterPairs: 2,
          matchingCsvSourceRows: matchedCsvRows,
          representationDifferences: 2,
        },
      });
    },
  );

  it.each([
    [
      { rows: [{ ...dbRow, quarterCode: '20261' }] },
      /CSV 전용 1행, DB 전용 1행/,
    ],
    [
      { rows: [{ ...dbRow, districtCode: '11140' }] },
      /CSV 전용 1행, DB 전용 1행/,
    ],
    [{ rows: [] }, /CSV 전용 1행, DB 전용 0행/],
    [
      {
        rows: [
          {
            ...dbRow,
            totalFootTraffic: '9007199254740993.12345678901234567891',
            maleFootTraffic: '0',
          },
        ],
      },
      /수치 불일치 1행 \/ 2개/,
    ],
    [{ rows: [{ ...dbRow, published: false }] }, /게시 조건 불일치 1행/],
    [
      {
        rows: [
          {
            ...dbRow,
            sourceType: null,
            sourceChecksum: null,
            published: false,
          },
        ],
      },
      /게시 조건 불일치 1행/,
    ],
    ...['a'.repeat(64), null].map(
      (sourceChecksum) =>
        [
          { rows: [{ ...dbRow, sourceType: 'CSV', sourceChecksum }] },
          /CSV 출처 체크섬 불일치 1행/,
        ] as const,
    ),
    [{ rows: [dbRow, dbRow] }, /DB 복합키가 중복/],
    [{ rows: [dbRow], changedCsv: singleCsv + '\n' }, /CSV가 probe 이후 변경/],
    [{ rows: [dbRow], error: true }, /BLOCKED: .*읽기 전용/],
  ] as const)(
    'CSV·DB 비교 실패 시 부분 결과와 오류 원문을 폐기한다 (%#)',
    (db, message) => {
      const result = runProbe(
        singleCsv,
        [...validArgs.slice(0, -1), '1', '--compare-db'],
        'postgres://localhost/test',
        false,
        undefined,
        undefined,
        { ...db, rows: [...db.rows] },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(message);
      expect(result.stderr).not.toMatch(
        /db-driver-private-detail|postgres:|\/virtual\/|a{64}/,
      );
    },
  );

  it.each([
    ['--api'],
    ['--api', ...validArgs],
    ['--api', '--allow-insecure-http'],
    ['--api', '--probe', '--api'],
    ['--api', '--probe', '--allow-insecure-http', '--allow-insecure-http'],
    ['--api', '--probe', '--expected-rows', '0'],
    ['--api', '--probe', '--compare-csv', ' '],
    ['--api', '--probe', '--compare-csv', 'a.csv', '--compare-csv', 'b.csv'],
    ['--api', '--probe', '--compare-db'],
    [...validArgs, '--compare-db', '--compare-db'],
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
        /--api|--compare-csv|--compare-db|옵션은 중복|API 예상 행 수/,
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
    ['--api', '--publish', '--compare-db', '--expected-rows', '550'],
    ['--api', '--publish', '--publish', '--expected-rows', '550'],
    ['--api', '--expected-rows', '550'],
    [...validArgs.slice(1), '--publish'],
    [...validArgs.slice(1), '--compare-db'],
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
      /--publish|--compare-csv|--compare-db|--expected-rows|옵션은 중복/,
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
