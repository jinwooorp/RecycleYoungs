import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { probeOfficialSources } from './official-sources.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

const manifestPath = '/virtual/private/official-sources.json';
const storePath = '/virtual/private/inputs/stores.csv';
const salesPath = '/virtual/private/inputs/sales.zip';
const trafficPath = '/virtual/private/inputs/foot traffic.csv';
const files = new Map<string, Buffer>();
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

// 실제 판독기를 실행하되 파일·압축 원본은 메모리의 합성 바이트만 사용합니다.
const stores = Buffer.from(
  [
    'STDR_YYQU_CD,SIGNGU_CD,SVC_INDUTY_CD,SIMILR_INDUTY_STOR_CO,STOR_CO,FRC_STOR_CO,OPBIZ_STOR_CO,CLSBIZ_STOR_CO,OPBIZ_RT,CLSBIZ_RT',
    '20261,11110,CS100010,9007199254740993,0,,0,,0.1200,0',
    '20261,11110,CS100011,1,1,0,0,0,0,0',
    '20262,11140,CS100010,1,1,0,0,0,0,0',
  ].join('\n'),
);
const sales = Buffer.from(
  [
    'STDR_YYQU_CD,SIGNGU_CD,SVC_INDUTY_CD,THSMON_SELNG_AMT,THSMON_SELNG_CO,MDWK_SELNG_AMT,WKEND_SELNG_AMT',
    '20261,11140,CS100010,9007199254740993,0,,0',
    '20262,11110,CS100010,0,0,0,0',
  ].join('\n'),
);
const traffic = Buffer.from(
  [
    'STDR_YYQU_CD,SIGNGU_CD,TOT_FLPOP_CO,ML_FLPOP_CO,FML_FLPOP_CO',
    '20261,11110,9007199254740993.12345678901234567890,,0.000',
    '20262,11140,1e1,1,1',
  ].join('\n'),
);

const entries = [
  {
    datasetId: 'OA-22173',
    source: 'inputs/stores.csv',
    expectedRows: 3,
    expectedSha256: hash(stores),
  },
  {
    datasetId: 'OA-22176',
    source: salesPath,
    expectedRows: 2,
    expectedSha256: hash(sales).toUpperCase(),
  },
  { datasetId: 'OA-22179', source: 'inputs/foot traffic.csv', expectedRows: 2 },
] as const;

function setManifest(datasets: readonly unknown[] = entries) {
  files.set(manifestPath, Buffer.from(JSON.stringify({ datasets })));
}

beforeEach(() => {
  files.clear();
  files.set(storePath, stores);
  files.set(salesPath, Buffer.from(zipSync({ 'archive/sales.csv': sales })));
  files.set(trafficPath, traffic);
  setManifest();
  vi.mocked(readFile).mockReset();
  vi.mocked(readFile).mockImplementation(async (path) => {
    const contents = files.get(String(path));
    if (!contents) throw new Error('ENOENT: private source path');
    return Buffer.from(contents);
  });
});

describe('공식 자치구 원본 통합 probe', () => {
  it('세 CSV·ZIP의 전체 행과 내부 CSV 체크섬을 검증하고 분기별 구 차이를 보고한다', async () => {
    const result = await probeOfficialSources(manifestPath);
    expect(result).toMatchObject({
      mode: 'PROBE',
      status: 'PASS',
      validationScope: 'LOCAL_FILE_FORMAT',
      databaseChecked: false,
      batchCreated: false,
      loadedRows: 0,
      datasets: [
        {
          datasetId: 'OA-22173',
          status: 'PASS',
          issues: [],
          expectedRows: 3,
          actualRows: 3,
          validRows: 3,
          rejectedRows: 0,
          checksum: hash(stores),
          checksumVerification: 'MATCHED',
          periodFrom: '20261',
          periodTo: '20262',
          coverage: {
            quarters: ['20261', '20262'],
            districtCodes: ['11110', '11140'],
            districtsByQuarter: { '20261': ['11110'], '20262': ['11140'] },
          },
        },
        {
          datasetId: 'OA-22176',
          status: 'PASS',
          actualRows: 2,
          checksum: hash(sales),
          checksumVerification: 'MATCHED',
          coverage: {
            districtsByQuarter: { '20261': ['11140'], '20262': ['11110'] },
          },
        },
        {
          datasetId: 'OA-22179',
          status: 'PASS',
          actualRows: 2,
          checksum: hash(traffic),
          checksumVerification: 'NOT_PROVIDED',
        },
      ],
      coverageComparison: {
        sameQuarters: true,
        sameDistricts: true,
        sameDistrictsByQuarter: false,
      },
    });
    expect(vi.mocked(readFile).mock.calls.map(([path]) => path)).toEqual([
      manifestPath,
      storePath,
      salesPath,
      trafficPath,
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /\/virtual|archive\/sales\.csv|9007199254740993/,
    );
  });

  it('분기·자치구가 다른 판본도 원본별 검증에 성공하면 통과한다', async () => {
    files.set(
      trafficPath,
      Buffer.from(traffic.toString().replace('20261,11110', '20263,11170')),
    );
    const result = await probeOfficialSources(manifestPath);
    expect(result).toMatchObject({
      status: 'PASS',
      coverageComparison: {
        sameQuarters: false,
        sameDistricts: false,
        sameDistrictsByQuarter: false,
      },
    });
    expect(result.datasets[2]).toMatchObject({
      periodFrom: '20262',
      periodTo: '20263',
      coverage: {
        quarters: ['20262', '20263'],
        districtCodes: ['11140', '11170'],
      },
    });
  });

  it('행 수·체크섬 불일치 각각을 표시하고 전체를 실패 처리한다', async () => {
    setManifest([
      { ...entries[0], expectedRows: 2 },
      { ...entries[1], expectedSha256: '0'.repeat(64) },
      entries[2],
    ]);
    const result = await probeOfficialSources(manifestPath);
    expect(result).toMatchObject({
      status: 'FAIL',
      coverageComparison: null,
      datasets: [
        {
          status: 'FAIL',
          issues: ['ROW_COUNT_MISMATCH'],
          actualRows: 3,
          checksumVerification: 'MATCHED',
        },
        {
          status: 'FAIL',
          issues: ['CHECKSUM_MISMATCH'],
          actualRows: 2,
          checksumVerification: 'MISMATCH',
        },
        { status: 'PASS', actualRows: 2 },
      ],
    });
  });

  it('원본 누락에는 전체 건수나 체크섬 일치를 표시하지 않는다', async () => {
    files.delete(salesPath);
    const result = await probeOfficialSources(manifestPath);
    expect(result.status).toBe('FAIL');
    expect(result.datasets[1]).toMatchObject({
      status: 'FAIL',
      issues: ['SOURCE_UNREADABLE'],
      actualRows: null,
      checksum: null,
      checksumVerification: 'NOT_CHECKED',
      coverage: null,
    });
    expect(result.datasets[2]?.status).toBe('PASS');
    expect(JSON.stringify(result)).not.toContain('private source path');
  });

  it.each([
    [
      'OA-22173',
      storePath,
      () =>
        Buffer.from(stores.toString().replace('OPBIZ_RT', 'INVALID_HEADER')),
    ],
    [
      'OA-22176',
      salesPath,
      () =>
        Buffer.from(
          zipSync({
            'sales.csv': Buffer.from(
              sales.toString().replace('9007199254740993', '1.25'),
            ),
          }),
        ),
    ],
    [
      'OA-22179',
      trafficPath,
      () =>
        Buffer.from(traffic.toString().replace('20262,11140', '20261,11110')),
    ],
  ] as const)(
    '기존 스키마·수치·복합키 오류를 이어서 거부한다 (%s)',
    async (datasetId, path, bytes) => {
      files.set(path, bytes());
      const result = await probeOfficialSources(manifestPath);
      expect(result.status).toBe('FAIL');
      expect(
        result.datasets.find((dataset) => dataset.datasetId === datasetId),
      ).toMatchObject({
        status: 'FAIL',
        issues: expect.arrayContaining(['SOURCE_INVALID']),
        actualRows: null,
        periodFrom: null,
        periodTo: null,
        coverage: null,
      });
    },
  );

  it('CSV가 여러 개인 ZIP은 원본 선택을 거부한다', async () => {
    files.set(
      salesPath,
      Buffer.from(zipSync({ 'sales.csv': sales, 'another.csv': sales })),
    );
    const result = await probeOfficialSources(manifestPath);
    expect(result.status).toBe('FAIL');
    expect(result.datasets[1]).toMatchObject({
      issues: ['SOURCE_UNREADABLE'],
      actualRows: null,
    });
  });

  it.each([
    [entries.slice(0, 2)],
    [[entries[0], entries[1], entries[1]]],
    [[entries[0], entries[1], { ...entries[2], datasetId: 'OA-22178' }]],
    [
      [
        entries[0],
        entries[1],
        { ...entries[2], expectedRows: Number.MAX_SAFE_INTEGER + 1 },
      ],
    ],
    [[entries[0], entries[1], { ...entries[2], expectedSha256: 'abc' }]],
    [
      [
        entries[0],
        entries[1],
        { ...entries[2], source: 'https://example.invalid/source.csv' },
      ],
    ],
    [[entries[0], entries[1], { ...entries[2], unexpected: true }]],
  ])('잘못된 manifest는 원본을 읽기 전에 거부한다 (%#)', async (datasets) => {
    setManifest(datasets);
    await expect(probeOfficialSources(manifestPath)).rejects.toThrow(
      'OA-22173, OA-22176, OA-22179',
    );
    expect(readFile).toHaveBeenCalledExactlyOnceWith(manifestPath);
  });

  it('manifest 읽기·UTF-8·JSON 오류에서 입력 원문을 숨긴다', async () => {
    for (const contents of [
      undefined,
      Buffer.from([0xff]),
      Buffer.from('sensitive-manifest-value'),
    ]) {
      if (contents) files.set(manifestPath, contents);
      else files.delete(manifestPath);
      await expect(probeOfficialSources(manifestPath)).rejects.toThrow(
        /^공식 원본 manifest를 읽거나 UTF-8 JSON으로 해석할 수 없습니다\.$/,
      );
    }
  });
});

// CLI 자식 프로세스에서도 풀·소켓·fetch를 차단하고 합성 파일만 공급합니다.
function runCli(args: string[]) {
  const preload = `
    import fs from 'node:fs/promises';
    import { createRequire, syncBuiltinESMExports } from 'node:module';
    import net from 'node:net';
    import { resolve } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const files = new Map(${JSON.stringify([...files].map(([path, bytes]) => [path, bytes.toString('base64')]))});
    const originalRead = fs.readFile;
    fs.readFile = async (path, ...options) => {
      if (files.has(String(path))) return Buffer.from(files.get(String(path)), 'base64');
      if (String(path).startsWith('/virtual/')) throw new Error('TEST_FILE_MISSING');
      return originalRead(path, ...options);
    };
    syncBuiltinESMExports();
    const pg = createRequire(pathToFileURL(resolve('package.json')))('pg');
    Object.defineProperty(pg, 'Pool', { configurable: true, value: class {
      constructor() { process.exit(97); }
    }});
    net.Socket.prototype.connect = () => { throw new Error('NETWORK_FORBIDDEN'); };
    globalThis.fetch = () => { process.exit(97); };
  `;
  return spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      '--import',
      'tsx',
      'src/index.ts',
      'official-sources',
      ...args,
    ],
    {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        DATABASE_URL: 'invalid-database-url',
        SEOUL_OPEN_API_KEY: undefined,
      },
    },
  );
}

describe('공식 자치구 원본 통합 CLI', () => {
  it('DB 없이 유효한 manifest의 전체 성공 JSON을 출력한다', () => {
    const result = runCli(['--probe', '--manifest', manifestPath]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'PASS',
      databaseChecked: false,
    });
  });

  it('원본 검증 실패를 JSON과 종료 코드 1로 반환한다', () => {
    files.delete(salesPath);
    const result = runCli(['--probe', '--manifest', manifestPath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'FAIL',
      databaseChecked: false,
    });
  });

  it.each([
    ['--manifest', manifestPath],
    ['--probe'],
    ['--probe', '--probe', '--manifest', manifestPath],
    ['--probe', '--manifest', manifestPath, '--manifest', manifestPath],
    ['--probe', '--manifest', 'https://example.invalid/manifest.json'],
  ])('부적절한 옵션은 DB나 파일 검증 분기 전에 실패한다 (%#)', (...args) => {
    const result = runCli(args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/공식 원본 검증에는/);
  });
});
