import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { runCli } from '../cli/runner.js';
import { parseSeoulStatArguments } from '../cli/seoul-stat-arguments.js';
import { seoulStatDatasets } from './seoul-stat-api.js';

const statFixtures = [
  {
    command: 'foot-traffic',
    service: 'VwsmAdstrdFlpopW',
    table: 'dong_foot_traffic_stat',
    region: 'ADSTRD_CD',
    code: '11110515',
    measurements: ['TOT_FLPOP_CO', 'ML_FLPOP_CO', 'FML_FLPOP_CO'],
  },
  {
    command: 'district-stores',
    service: 'VwsmSignguStorW',
    table: 'district_store_stat',
    region: 'SIGNGU_CD',
    code: '11110',
    measurements: [
      'SIMILR_INDUTY_STOR_CO',
      'STOR_CO',
      'FRC_STOR_CO',
      'OPBIZ_STOR_CO',
      'CLSBIZ_STOR_CO',
      'OPBIZ_RT',
      'CLSBIZ_RT',
    ],
  },
  {
    command: 'district-sales',
    service: 'VwsmSignguSelngW',
    table: 'district_sales_stat',
    region: 'SIGNGU_CD',
    code: '11110',
    measurements: [
      'THSMON_SELNG_AMT',
      'THSMON_SELNG_CO',
      'MDWK_SELNG_AMT',
      'WKEND_SELNG_AMT',
    ],
  },
  {
    command: 'stores',
    service: 'VwsmAdstrdStorW',
    table: 'dong_store_stat',
    region: 'ADSTRD_CD',
    code: '11110515',
    measurements: [
      'SIMILR_INDUTY_STOR_CO',
      'STOR_CO',
      'FRC_STOR_CO',
      'OPBIZ_STOR_CO',
      'CLSBIZ_STOR_CO',
      'OPBIZ_RT',
      'CLSBIZ_RT',
    ],
  },
  {
    command: 'sales',
    service: 'VwsmAdstrdSelngW',
    table: 'dong_sales_stat',
    region: 'ADSTRD_CD',
    code: '11110515',
    measurements: [
      'THSMON_SELNG_AMT',
      'THSMON_SELNG_CO',
      'MDWK_SELNG_AMT',
      'WKEND_SELNG_AMT',
    ],
  },
] as const;

type StatFixture = (typeof statFixtures)[number];

function fixtureRow(
  f: StatFixture,
  quarter = '20262',
  code: string = f.code,
): Record<string, string | null> {
  const measurements =
    f.measurements.length === 3
      ? ['9007199254740993.0000000000000000010', null, '0']
      : ['9007199254740993', null, '0', '7', '5', '0.2500', '0.00'];
  return {
    STDR_YYQU_CD: quarter,
    [f.region]: code,
    ...(f.measurements.length > 3
      ? { SVC_INDUTY_CD: 'CS100010', SVC_INDUTY_CD_NM: '커피-음료' }
      : {}),
    ...Object.fromEntries(
      f.measurements.map((name, i) => [name, measurements[i]!]),
    ),
  };
}

function fixtureCsv(rows: Record<string, string | null>[]) {
  const keys = Object.keys(rows[0]!);
  return [
    keys.join(','),
    ...rows.map((row) => keys.map((key) => row[key] ?? '').join(',')),
  ].join('\n');
}

function fixturePage(
  f: StatFixture,
  rows: Record<string, string | null>[],
  total = rows.length,
) {
  // JS Number를 거치지 않은 실제 숫자 토큰과 JSON null로 정밀도 보존을 검증합니다.
  const jsonRows = rows.map(
    (row) =>
      '{' +
      Object.entries(row)
        .map(
          ([key, value]) =>
            JSON.stringify(key) +
            ':' +
            (f.measurements.some((field) => field === key) && value !== null
              ? value
              : JSON.stringify(value)),
        )
        .join(',') +
      '}',
  );
  return new Response(
    `{${JSON.stringify(f.service)}:{"list_total_count":${total},"RESULT":{"CODE":"INFO-000"},"row":[${jsonRows.join(',')}]}}`,
  );
}

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  readFile: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();
const options = {
  allowInsecureHttp: true,
  compareCsv: '/virtual/source.csv',
  expectedRows: 1001,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(readFile).mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('SEOUL_OPEN_API_KEY', 'synthetic-seoul-test-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(statFixtures)('$command API 전수 검증', (fixture) => {
  it('두 페이지의 모든 키와 측정값을 기존 CSV와 대조한다', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) =>
      fixtureRow(fixture, '20262', String(Number(fixture.code) + i)),
    );
    vi.mocked(readFile).mockResolvedValue(Buffer.from(fixtureCsv(rows)));
    fetchMock
      .mockResolvedValueOnce(fixturePage(fixture, rows.slice(0, 1000), 1001))
      .mockResolvedValueOnce(fixturePage(fixture, rows.slice(1000), 1001));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runCli([
        fixture.command,
        '--api',
        '--probe',
        '--allow-insecure-http',
        '--expected-rows',
        '1001',
        '--compare-csv',
        options.compareCsv,
      ]);
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
        totalRows: 1001,
        pages: 2,
        selectedRows: 1001,
        excludedRows: 0,
        databaseChecked: false,
        csvComparison: {
          matchedRows: 1001,
          comparedValues: 1001 * fixture.measurements.length,
        },
      });
    } finally {
      log.mockRestore();
    }
    expect(
      fetchMock.mock.calls.map(([url]) =>
        new URL(String(url)).pathname.split('/').slice(-3, -1),
      ),
    ).toEqual([
      ['1', '1000'],
      ['1001', '1001'],
    ]);
  });

  it('과거 분기를 분리하고 동일한 CSV 분기의 누락·값 차이를 차단한다', async () => {
    const current = fixtureRow(fixture);
    const past = fixtureRow(fixture, '20211');
    vi.mocked(readFile).mockResolvedValue(Buffer.from(fixtureCsv([current])));
    const scaleField =
      fixture.measurements.length === 3 ? 'TOT_FLPOP_CO' : 'OPBIZ_RT';
    const scaleChanged =
      fixture.measurements.length === 4
        ? current
        : { ...current, [scaleField]: current[scaleField]!.slice(0, -1) };
    fetchMock.mockResolvedValueOnce(fixturePage(fixture, [past, scaleChanged]));
    const probe = seoulStatDatasets[fixture.command].probe;
    const opts = { ...options, expectedRows: 2, csvPeriod: true };
    await expect(probe(opts)).resolves.toMatchObject({
      apiQuarters: ['20211', '20262'],
      periodFrom: '20262',
      periodTo: '20262',
      excludedRows: 1,
      selectedRows: 1,
      csvComparison: {
        matchedRows: 1,
        representationDifferences: fixture.measurements.length === 4 ? 0 : 1,
      },
    });
    fetchMock.mockResolvedValueOnce(fixturePage(fixture, [past, current]));
    await expect(probe({ ...opts, csvPeriod: false })).rejects.toThrow(
      'API 전용 1행',
    );
    const changed = { ...current, [fixture.measurements[1]]: '0' };
    fetchMock.mockResolvedValueOnce(fixturePage(fixture, [past, changed]));
    await expect(probe(opts)).rejects.toThrow('수치 불일치 1개');
    fetchMock.mockResolvedValueOnce(
      fixturePage(fixture, [past, fixtureRow(fixture, '20212')]),
    );
    await expect(probe(opts)).rejects.toThrow('CSV 전용 1행');
  });
});

it('10만 행을 초과하는 API의 모든 페이지를 처리한다', async () => {
  const f = statFixtures[4];
  const total = 100001;
  fetchMock.mockImplementation(async (url) => {
    const [, start, end] = String(url).match(/\/(\d+)\/(\d+)\/$/)!;
    const rows = Array.from(
      { length: Number(end) - Number(start) + 1 },
      (_, i) => fixtureRow(f, '20262', String(11110000 + Number(start) + i)),
    );
    return fixturePage(f, rows, total);
  });
  await expect(
    seoulStatDatasets.sales.probe({
      expectedRows: total,
      allowInsecureHttp: true,
    }),
  ).resolves.toMatchObject({
    totalRows: total,
    selectedRows: total,
    pages: 101,
    excludedRows: 0,
  });
  expect(fetchMock).toHaveBeenCalledTimes(101);
}, 15000);

it('복합키 중복, 업종 명칭 충돌, 부족한 페이지와 건수 변경을 거부한다', async () => {
  const f = statFixtures[1];
  const row = fixtureRow(f);
  const probe = seoulStatDatasets[f.command].probe;
  const opts = { expectedRows: 2, allowInsecureHttp: true };
  fetchMock.mockResolvedValueOnce(fixturePage(f, [row, row]));
  await expect(probe(opts)).rejects.toThrow('복합키가 중복');
  fetchMock.mockResolvedValueOnce(
    fixturePage(f, [
      row,
      { ...row, STDR_YYQU_CD: '20261', SVC_INDUTY_CD_NM: '다른 업종' },
    ]),
  );
  await expect(probe(opts)).rejects.toThrow('업종 코드의 명칭');
  fetchMock.mockResolvedValueOnce(fixturePage(f, [row], 2));
  await expect(probe(opts)).rejects.toThrow('구간의 행 수');
  fetchMock.mockResolvedValueOnce(fixturePage(f, [row], 1));
  await expect(probe(opts)).rejects.toThrow('예상 행 수');
});

it('승인 옵션이나 비교 파일 없는 게시 인자를 거부하며 URL에 접근하지 않는다', async () => {
  const f = statFixtures[0];
  await expect(
    seoulStatDatasets[f.command].probe({ expectedRows: 1 }),
  ).rejects.toThrow('BLOCKED');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(() =>
    parseSeoulStatArguments(['--api', '--publish', '--expected-rows', '1']),
  ).toThrow('--compare-csv');
  expect(() =>
    parseSeoulStatArguments(['--api', '--probe', '--expected-rows', '1000001']),
  ).toThrow('1000000');
});

describe.runIf(process.env.RUN_SEOUL_STAT_API_DB_TESTS === '1')(
  '서울시 통계 API 격리 PostGIS 게시',
  () => {
    let container: string | undefined;
    let pool: Pool;
    const password = 'synthetic-stat-publication-test';
    const migrations = [
      'V1__enable_postgis.sql',
      'V2__create_core_tables.sql',
      'V3__create_dong_stat_tables.sql',
      'V4__create_cafe_store.sql',
      'V5__create_district_store_stat.sql',
      'V6__create_district_sales_stat.sql',
      'V7__create_district_foot_traffic_stat.sql',
    ];
    const referenceBatch = '00000000-0000-0000-0000-000000000001';
    const migrationsRoot = '../../../backend/src/main/resources/db/migration/';

    beforeAll(async () => {
      // 기존 DB 설정을 사용하지 않고 새 컨테이너가 배정한 루프백 포트에만 연결합니다.
      container = execFileSync(
        'docker',
        [
          'run',
          '--rm',
          '--detach',
          '--publish',
          '127.0.0.1::5432',
          '--env',
          `POSTGRES_PASSWORD=${password}`,
          'postgis/postgis:17-3.5',
        ],
        { encoding: 'utf8' },
      ).trim();
      const mapping = execFileSync('docker', ['port', container, '5432/tcp'], {
        encoding: 'utf8',
      }).trim();
      const port = /^127\.0\.0\.1:([0-9]+)$/.exec(mapping)?.[1];
      if (!port || port === '5432') throw new Error('격리 DB 포트 확인 실패');
      pool = new Pool({
        connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
      });
      for (let attempt = 0; ; attempt++) {
        try {
          await pool.query('SELECT postgis_version()');
          break;
        } catch (error) {
          if (attempt === 60) throw error;
          await delay(250);
        }
      }
      const fs =
        await vi.importActual<typeof import('node:fs/promises')>(
          'node:fs/promises',
        );
      for (const migration of migrations)
        await pool.query(
          await fs.readFile(
            new URL(migrationsRoot + migration, import.meta.url),
            'utf8',
          ),
        );
      await pool.query(`
      INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,etl_version,status,started_at,published_at)
      VALUES ('${referenceBatch}','SYNTHETIC_REFERENCE','CSV','SEOUL','synthetic reference','test','PUBLISHED',now(),now());
      INSERT INTO district VALUES ('11110','합성 구',ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),'${referenceBatch}');
      INSERT INTO administrative_dong VALUES ('11110515','11110','합성 동',
        ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),ST_SetSRID(ST_MakePoint(127.005,37.005),4326),1000,'${referenceBatch}');
      INSERT INTO service_industry VALUES ('CS100010','커피-음료','${referenceBatch}');
    `);
    }, 40000);

    afterAll(async () => {
      await pool?.end();
      if (container)
        execFileSync('docker', ['stop', container], { stdio: 'ignore' });
    }, 30000);

    it.each(statFixtures)(
      '$command 게시, 재실행 및 롤백이 기존 행·출처를 보존한다',
      async (f) => {
        const dataset = seoulStatDatasets[f.command];
        const prior = fixtureRow(f, '20211');
        const current = fixtureRow(f);
        const opts = {
          expectedRows: 2,
          allowInsecureHttp: true,
          compareCsv: '/virtual/source.csv',
          csvPeriod: true,
        };
        const snapshot = async () =>
          (await pool.query(`SELECT * FROM ${f.table} ORDER BY quarter_code`))
            .rows;
        const priorRow = { ...prior, [f.measurements[0]]: '17' };
        vi.mocked(readFile).mockResolvedValue(
          Buffer.from(fixtureCsv([priorRow])),
        );
        fetchMock.mockResolvedValueOnce(fixturePage(f, [priorRow]));
        await expect(
          dataset.publish(pool, { ...opts, expectedRows: 1 }),
        ).resolves.toMatchObject({ status: 'PUBLISHED' });
        const [previous] = await snapshot();

        vi.mocked(readFile).mockResolvedValue(
          Buffer.from(fixtureCsv([current])),
        );
        const page = () => fixturePage(f, [prior, current]);
        fetchMock.mockResolvedValueOnce(page());
        const published = await dataset.publish(pool, opts);
        expect(published).toMatchObject({
          status: 'PUBLISHED',
          fetchedRows: 2,
          validRows: 1,
          rejectedRows: 0,
          periodFrom: '20262',
          periodTo: '20262',
        });
        const stored = await snapshot();
        expect(stored).toHaveLength(2);
        expect(stored[0]).toEqual(previous);
        if (f.measurements.length === 3) {
          expect(stored[1]).toMatchObject({
            total_foot_traffic: '9007199254740993.0000000000000000010',
            male_foot_traffic: null,
            female_foot_traffic: '0',
          });
        } else if (f.measurements.length === 7) {
          expect(stored[1]).toMatchObject({
            store_count: '9007199254740993',
            general_store_count: null,
            franchise_store_count: '0',
            opening_rate: '0.2500',
          });
        } else {
          expect(stored[1]).toMatchObject({
            monthly_sales_amount: '9007199254740993',
            monthly_sales_count: null,
            weekday_sales_amount: '0',
          });
        }
        const batchId = stored[1]!.source_batch_id;
        const {
          rows: [batch],
        } = await pool.query('SELECT * FROM etl_batch WHERE batch_id=$1', [
          batchId,
        ]);
        expect(batch).toMatchObject({
          source_type: 'API',
          scope_type: 'SEOUL',
          status: 'PUBLISHED',
          source_checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
          published_at: expect.any(Date),
        });
        expect(JSON.parse(batch.source_reference)).toMatchObject({
          totalRows: 2,
          selectedRows: 1,
          excludedRows: 1,
          collectionMode: 'CSV_QUARTERS',
        });
        fetchMock.mockResolvedValueOnce(fixturePage(f, [current, prior]));
        await expect(dataset.publish(pool, opts)).resolves.toMatchObject({
          status: 'SKIPPED',
        });
        expect(await snapshot()).toEqual(stored);

        const wrong = { ...current, [f.measurements[0]]: '42' };
        fetchMock.mockResolvedValueOnce(fixturePage(f, [prior, wrong]));
        await expect(dataset.publish(pool, opts)).rejects.toThrow(
          '수치 불일치',
        );
        expect(await snapshot()).toEqual(stored);

        const missingFk = fixtureRow(
          f,
          '20262',
          f.region === 'ADSTRD_CD' ? '99999999' : '99999',
        );
        vi.mocked(readFile).mockResolvedValue(
          Buffer.from(fixtureCsv([missingFk])),
        );
        fetchMock.mockResolvedValueOnce(fixturePage(f, [prior, missingFk]));
        await expect(dataset.publish(pool, opts)).rejects.toThrow('FK 불일치');
        expect(await snapshot()).toEqual(stored);

        if (f.measurements.length > 3) {
          vi.mocked(readFile).mockResolvedValue(
            Buffer.from(fixtureCsv([current])),
          );
          fetchMock.mockResolvedValueOnce(
            fixturePage(f, [
              { ...prior, SVC_INDUTY_CD_NM: '기준과 다른 업종' },
              { ...current, SVC_INDUTY_CD_NM: '기준과 다른 업종' },
            ]),
          );
          await expect(dataset.publish(pool, opts)).rejects.toThrow(
            '게시 기준 데이터와 다릅니다',
          );
          expect(await snapshot()).toEqual(stored);
        }

        const firstPage = Array.from({ length: 1000 }, (_, index) =>
          fixtureRow(f, '20262', String(Number(f.code) + index)),
        );
        vi.mocked(readFile).mockResolvedValue(
          Buffer.from(fixtureCsv(firstPage)),
        );
        fetchMock
          .mockResolvedValueOnce(fixturePage(f, firstPage, 1001))
          .mockResolvedValueOnce(new Response(null, { status: 403 }));
        await expect(
          dataset.publish(pool, { ...opts, expectedRows: 1001 }),
        ).rejects.toThrow('HTTP 오류(403)');
        expect(await snapshot()).toEqual(stored);

        // Upsert 뒤 게시 상태 확정만 실패시켜 통계와 출처의 롤백을 확인합니다.
        const updated = { ...current, [f.measurements[0]]: '99' };
        vi.mocked(readFile).mockResolvedValue(
          Buffer.from(fixtureCsv([updated])),
        );
        await pool.query(`
      CREATE OR REPLACE FUNCTION fail_stat_api_publication() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status='PUBLISHED' AND NEW.source_type='API' THEN RAISE EXCEPTION 'synthetic finalize failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fail_stat_api_publication BEFORE UPDATE ON etl_batch
        FOR EACH ROW EXECUTE FUNCTION fail_stat_api_publication();
    `);
        try {
          fetchMock.mockResolvedValueOnce(fixturePage(f, [prior, updated]));
          await expect(dataset.publish(pool, opts)).rejects.toThrow(
            'synthetic finalize failure',
          );
          expect(await snapshot()).toEqual(stored);
        } finally {
          await pool.query(
            'DROP TRIGGER fail_stat_api_publication ON etl_batch',
          );
        }
        const {
          rows: [failure],
        } = await pool.query(
          "SELECT * FROM etl_batch WHERE dataset_code=$1 AND status='FAILED' ORDER BY started_at DESC LIMIT 1",
          [batch.dataset_code],
        );
        expect(failure).toMatchObject({
          source_type: 'API',
          published_at: null,
          error_message: expect.stringContaining('synthetic finalize failure'),
        });
      },
    );
  },
);
