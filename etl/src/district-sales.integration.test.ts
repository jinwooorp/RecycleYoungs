import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { setTimeout } from 'node:timers/promises';
import type { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { importDistrictSalesStats } from './district-sales.js';
import {
  DistrictSalesSourceError,
  type DistrictSalesSource,
  type DistrictSalesStatRow,
} from './district-sales-source.js';
import { createDatabasePool } from './database.js';

const virtualFiles = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      const bytes = virtualFiles.get(String(args[0]));
      return bytes ? Buffer.from(bytes) : actual.readFile(...args);
    }),
  };
});

// 합성 통계는 새 일회용 PostGIS 컨테이너에만 적재합니다. 로컬 개발 DB와 원본은 변경하지 않습니다.
describe.runIf(process.env.RUN_DISTRICT_SALES_DB_TESTS === '1')(
  '자치구 매출 통계 격리 DB 적재',
  () => {
    let container: string | undefined;
    let admin: Pool;
    let pool: Pool;
    let databaseUrl: string;
    let seedBatchId: string;
    const pools: Pool[] = [];
    const options = { source: 'synthetic-district-sales.csv', expectedRows: 2 };
    const rows = (): DistrictSalesStatRow[] => [
      {
        districtCode: '11110',
        industryCode: 'CS100010',
        quarterCode: '20261',
        monthlySalesAmount: '9007199254740993',
        monthlySalesCount: '2',
        weekdaySalesAmount: '9223372036854775807',
        weekendSalesAmount: '0',
      },
      {
        districtCode: '11140',
        industryCode: 'CS100001',
        quarterCode: '20262',
        monthlySalesAmount: '0',
        monthlySalesCount: null,
        weekdaySalesAmount: null,
        weekendSalesAmount: '4',
      },
    ];

    // 파일 판독기만 메모리 원본으로 대체하고 스테이징·FK 검사·Upsert·배치 기록은 실제 DB로 검증합니다.
    const loader =
      (input = rows(), checksum = 'a'.repeat(64)) =>
      async (
        path: string,
        consume: (batch: DistrictSalesStatRow[]) => Promise<void>,
      ): Promise<DistrictSalesSource> => {
        for (let start = 0; start < input.length; start += 1000)
          await consume(input.slice(start, start + 1000));
        const quarters = input.map((row) => row.quarterCode).sort();
        return {
          checksum,
          fetchedRows: input.length,
          validRows: input.length,
          rejectedRows: 0,
          periodFrom: quarters[0]!,
          periodTo: quarters.at(-1)!,
          path,
          encoding: 'UTF-8',
        };
      };
    const snapshot = async () =>
      (
        await pool.query(
          'SELECT * FROM district_sales_stat ORDER BY district_code,industry_code,quarter_code',
        )
      ).rows;
    const latestFailure = async () =>
      (
        await pool.query(
          "SELECT * FROM etl_batch WHERE dataset_code='SEOUL_DISTRICT_SALES_STAT' AND status='FAILED' ORDER BY started_at DESC LIMIT 1",
        )
      ).rows[0];

    beforeAll(async () => {
      container = execFileSync(
        'docker',
        [
          'run',
          '--rm',
          '--detach',
          '--publish',
          '127.0.0.1::5432',
          '--env',
          'POSTGRES_PASSWORD=district_sales_test',
          'postgis/postgis:17-3.5',
        ],
        { encoding: 'utf8' },
      ).trim();
      const port = execFileSync('docker', ['port', container, '5432/tcp'], {
        encoding: 'utf8',
      })
        .trim()
        .split(':')
        .at(-1);
      databaseUrl = `postgresql://postgres:district_sales_test@127.0.0.1:${port}/postgres`;
      admin = createDatabasePool({ DATABASE_URL: databaseUrl });
      for (let attempt = 0; ; attempt++) {
        try {
          await admin.query('SELECT postgis_version()');
          break;
        } catch (error) {
          if (attempt >= 60) throw error;
          await setTimeout(200);
        }
      }
    }, 30000);

    beforeEach(async () => {
      virtualFiles.clear();
      const schema = `district_sales_test_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = createDatabasePool({
        DATABASE_URL:
          databaseUrl +
          `?options=${encodeURIComponent('-csearch_path=' + schema + ',public')}`,
      });
      pools.push(pool);
      for (const file of [
        'V1__enable_postgis.sql',
        'V2__create_core_tables.sql',
        'V3__create_dong_stat_tables.sql',
        'V4__create_cafe_store.sql',
        'V5__create_district_store_stat.sql',
        'V6__create_district_sales_stat.sql',
      ]) {
        await pool.query(
          await readFile(
            new URL(
              '../../backend/src/main/resources/db/migration/' + file,
              import.meta.url,
            ),
            'utf8',
          ),
        );
      }
      seedBatchId = randomUUID();
      await pool.query(
        `INSERT INTO etl_batch
      (batch_id,dataset_code,source_type,scope_type,source_reference,etl_version,status,started_at,published_at)
      VALUES ($1,'TEST_REFERENCE','CSV','SEOUL','synthetic reference','test-v1','PUBLISHED',now(),now())`,
        [seedBatchId],
      );
      await pool.query(
        `INSERT INTO district VALUES ('11110','테스트구',
      ST_GeomFromText('MULTIPOLYGON(((126.9 37.5,127.1 37.5,127.1 37.7,126.9 37.7,126.9 37.5)))',4326),$1)`,
        [seedBatchId],
      );
      await pool.query(
        `INSERT INTO district VALUES ('11140','두 번째 테스트구',
      ST_GeomFromText('MULTIPOLYGON(((127.1 37.5,127.2 37.5,127.2 37.7,127.1 37.7,127.1 37.5)))',4326),$1)`,
        [seedBatchId],
      );
      await pool.query(
        `INSERT INTO service_industry VALUES
      ('CS100001','한식음식점',$1),('CS100010','커피-음료',$1)`,
        [seedBatchId],
      );
    });

    afterAll(async () => {
      await Promise.all(pools.map((item) => item.end()));
      if (admin) await admin.end();
      if (container)
        execFileSync('docker', ['stop', container], { stdio: 'pipe' });
    }, 30000);

    it('publishes exact BIGINT values, NULL, zero and source metadata without forcing sums', async () => {
      // 정수 정밀도를 보존하고 주중·주말 합계가 전체와 달라도 원본 의미를 유지합니다.
      const result = await importDistrictSalesStats(pool, options, loader());
      expect(result).toMatchObject({
        status: 'PUBLISHED',
        fetchedRows: 2,
        validRows: 2,
        rejectedRows: 0,
        periodFrom: '20261',
        periodTo: '20262',
      });
      expect(await snapshot()).toEqual([
        {
          district_code: '11110',
          industry_code: 'CS100010',
          quarter_code: '20261',
          monthly_sales_amount: '9007199254740993',
          monthly_sales_count: '2',
          weekday_sales_amount: '9223372036854775807',
          weekend_sales_amount: '0',
          source_batch_id: result.batchId,
        },
        {
          district_code: '11140',
          industry_code: 'CS100001',
          quarter_code: '20262',
          monthly_sales_amount: '0',
          monthly_sales_count: null,
          weekday_sales_amount: null,
          weekend_sales_amount: '4',
          source_batch_id: result.batchId,
        },
      ]);
      const batch = (
        await pool.query('SELECT * FROM etl_batch WHERE batch_id=$1', [
          result.batchId,
        ])
      ).rows[0];
      expect(batch).toMatchObject({
        status: 'PUBLISHED',
        dataset_code: 'SEOUL_DISTRICT_SALES_STAT',
        etl_version: 'district-sales-stat-v1',
        source_type: 'CSV',
        scope_type: 'SEOUL',
        expected_rows: '2',
        fetched_rows: '2',
        valid_rows: '2',
        rejected_rows: '0',
        period_from: '20261',
        period_to: '20262',
        source_checksum: 'a'.repeat(64),
      });
      expect(batch.published_at).not.toBeNull();
      expect(JSON.parse(batch.source_reference)).toMatchObject({
        encoding: 'UTF-8',
      });
    });

    it('skips unchanged source while preserving every value and published reference', async () => {
      await importDistrictSalesStats(pool, options, loader());
      const before = await snapshot();
      const skipped = await importDistrictSalesStats(pool, options, loader());
      expect(skipped.status).toBe('SKIPPED');
      expect(await snapshot()).toEqual(before);
      expect(
        (
          await pool.query(
            'SELECT published_at FROM etl_batch WHERE batch_id=$1',
            [skipped.batchId],
          )
        ).rows[0].published_at,
      ).toBeNull();
      const provenance = (
        await pool.query(`SELECT s.source_batch_id,b.source_checksum,b.etl_version
          FROM district_sales_stat s JOIN etl_batch b ON b.batch_id=s.source_batch_id`)
      ).rows;
      expect(provenance).toHaveLength(2);
      expect(
        provenance.every(
          (row) =>
            row.source_checksum === 'a'.repeat(64) &&
            row.etl_version === 'district-sales-stat-v1' &&
            row.source_batch_id !== skipped.batchId,
        ),
      ).toBe(true);
    });

    it.each(['CSV', 'ZIP'])(
      '실제 %s 판독부터 게시까지 정수 소수·지수 표기를 정확히 보존한다',
      async (format) => {
        const contents = Buffer.from(
          'STDR_YYQU_CD,SIGNGU_CD,SVC_INDUTY_CD,THSMON_SELNG_AMT,THSMON_SELNG_CO,MDWK_SELNG_AMT,WKEND_SELNG_AMT\n' +
            '20262,11110,CS100010,9223372036854775807.0,9.007199254740993e15,,0.0',
        );
        const path = '/virtual/district-sales.' + format.toLowerCase();
        virtualFiles.set(
          path,
          format === 'ZIP' ? zipSync({ 'district.csv': contents }) : contents,
        );
        const result = await importDistrictSalesStats(pool, {
          source: path,
          expectedRows: 1,
        });
        expect(result.status).toBe('PUBLISHED');
        expect(await snapshot()).toEqual([
          {
            district_code: '11110',
            industry_code: 'CS100010',
            quarter_code: '20262',
            monthly_sales_amount: '9223372036854775807',
            monthly_sales_count: '9007199254740993',
            weekday_sales_amount: null,
            weekend_sales_amount: '0',
            source_batch_id: result.batchId,
          },
        ]);
        const batch = (
          await pool.query(
            'SELECT source_reference,source_checksum FROM etl_batch WHERE batch_id=$1',
            [result.batchId],
          )
        ).rows[0];
        const reference = JSON.parse(batch.source_reference);
        expect(reference).toMatchObject({ encoding: 'UTF-8' });
        expect(batch.source_checksum).toMatch(/^[a-f0-9]{64}$/);
        if (format === 'ZIP') expect(reference.entry).toBe('district.csv');
      },
    );

    it('측정값이 전부 NULL인 원본 행도 보존하고 누락 조합을 만들지 않는다', async () => {
      const input = {
        ...rows()[0]!,
        monthlySalesAmount: null,
        monthlySalesCount: null,
        weekdaySalesAmount: null,
        weekendSalesAmount: null,
      };
      const result = await importDistrictSalesStats(
        pool,
        { ...options, expectedRows: 1 },
        loader([input]),
      );
      expect(await snapshot()).toEqual([
        {
          district_code: input.districtCode,
          industry_code: input.industryCode,
          quarter_code: input.quarterCode,
          monthly_sales_amount: null,
          monthly_sales_count: null,
          weekday_sales_amount: null,
          weekend_sales_amount: null,
          source_batch_id: result.batchId,
        },
      ]);
      expect(
        (await pool.query('SELECT count(*) FROM dong_sales_stat')).rows[0]
          .count,
      ).toBe('0');
    });

    it('중복 복합키는 기존 값과 출처를 보존하고 전체 배치를 실패시킨다', async () => {
      await importDistrictSalesStats(pool, options, loader());
      const before = await snapshot();
      await expect(
        importDistrictSalesStats(
          pool,
          options,
          loader([rows()[0]!, rows()[0]!], 'b'.repeat(64)),
        ),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        published_at: null,
      });
    });

    it.each(['source_type', 'scope', 'published_at', 'checksum', 'version'])(
      '기존 게시 배치의 %s가 다르면 같은 원본도 다시 게시한다',
      async (field) => {
        const first = await importDistrictSalesStats(pool, options, loader());
        const update = {
          source_type: "source_type='API'",
          scope: "scope_type='DISTRICT',scope_code='11110'",
          published_at: 'published_at=NULL',
          checksum: "source_checksum='" + 'b'.repeat(64) + "'",
          version: "etl_version='district-sales-stat-other'",
        }[field]!;
        await pool.query(`UPDATE etl_batch SET ${update} WHERE batch_id=$1`, [
          first.batchId,
        ]);
        const repaired = await importDistrictSalesStats(
          pool,
          options,
          loader(),
        );
        expect(repaired.status).toBe('PUBLISHED');
        expect(
          (await snapshot()).every(
            (row) => row.source_batch_id === repaired.batchId,
          ),
        ).toBe(true);
      },
    );

    it('V6 미적용은 원본 판독 전에 FAILED로 기록한다', async () => {
      await pool.query('DROP TABLE district_sales_stat');
      const read = vi.fn(loader());
      await expect(
        importDistrictSalesStats(pool, options, read),
      ).rejects.toThrow('Flyway V6');
      expect(read).not.toHaveBeenCalled();
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '0',
        published_at: null,
      });
    });

    it.each([
      'monthly_sales_amount',
      'monthly_sales_count',
      'weekday_sales_amount',
      'weekend_sales_amount',
    ])('V6는 %s의 음수·범위 초과를 DB에서도 거부한다', async (column) => {
      await expect(
        pool.query(
          `INSERT INTO district_sales_stat
          (district_code,industry_code,quarter_code,source_batch_id,${column}) VALUES ('11110','CS100010','20262',$1,-1)`,
          [seedBatchId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pool.query(
          `INSERT INTO district_sales_stat
          (district_code,industry_code,quarter_code,source_batch_id,${column}) VALUES ('11110','CS100010','20262',$1,9223372036854775808)`,
          [seedBatchId],
        ),
      ).rejects.toMatchObject({ code: '22003' });
    });

    it.each([
      ['district_code', '１１１１０'],
      ['district_code', '1111'],
      ['industry_code', 'cs100010'],
      ['industry_code', 'CS10001'],
      ['quarter_code', '20260'],
      ['quarter_code', '２０２６１'],
    ])('V6는 %s의 잘못된 코드 %s를 거부한다', async (column, value) => {
      const key = {
        district_code: '11110',
        industry_code: 'CS100010',
        quarter_code: '20262',
        [column]: value,
      };
      await expect(
        pool.query(
          `INSERT INTO district_sales_stat
        (district_code,industry_code,quarter_code,source_batch_id) VALUES ($1,$2,$3,$4)`,
          [key.district_code, key.industry_code, key.quarter_code, seedBatchId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it.each(['district', 'industry', 'batch'])(
      'V6는 없는 %s 외래키를 거부한다',
      async (kind) => {
        await expect(
          pool.query(
            `INSERT INTO district_sales_stat
          (district_code,industry_code,quarter_code,source_batch_id) VALUES ($1,$2,'20262',$3)`,
            [
              kind === 'district' ? '99999' : '11110',
              kind === 'industry' ? 'CS999999' : 'CS100010',
              kind === 'batch' ? randomUUID() : seedBatchId,
            ],
          ),
        ).rejects.toMatchObject({ code: '23503' });
      },
    );

    it.each([
      'monthly_sales_amount',
      'monthly_sales_count',
      'weekday_sales_amount',
      'weekend_sales_amount',
      'nullable zero',
      'provenance',
      'missing row',
    ])(
      'republishes identical source if actual DB %s differs',
      async (change) => {
        await importDistrictSalesStats(pool, options, loader());
        if (change === 'provenance')
          await pool.query(
            'UPDATE district_sales_stat SET source_batch_id=$1',
            [seedBatchId],
          );
        else if (change === 'missing row')
          await pool.query(
            "DELETE FROM district_sales_stat WHERE district_code='11110'",
          );
        else if (change === 'nullable zero')
          await pool.query(
            "UPDATE district_sales_stat SET monthly_sales_count=0 WHERE district_code='11140'",
          );
        else
          await pool.query(
            `UPDATE district_sales_stat SET ${change}=NULL WHERE district_code='11110'`,
          );
        const repaired = await importDistrictSalesStats(
          pool,
          options,
          loader(),
        );
        expect(repaired.status).toBe('PUBLISHED');
        expect(await snapshot()).toEqual([
          {
            district_code: '11110',
            industry_code: 'CS100010',
            quarter_code: '20261',
            monthly_sales_amount: '9007199254740993',
            monthly_sales_count: '2',
            weekday_sales_amount: '9223372036854775807',
            weekend_sales_amount: '0',
            source_batch_id: repaired.batchId,
          },
          {
            district_code: '11140',
            industry_code: 'CS100001',
            quarter_code: '20262',
            monthly_sales_amount: '0',
            monthly_sales_count: null,
            weekday_sales_amount: null,
            weekend_sales_amount: '4',
            source_batch_id: repaired.batchId,
          },
        ]);
      },
    );

    it('upserts changed sources without deleting records absent from new input', async () => {
      await importDistrictSalesStats(pool, options, loader());
      const before = await snapshot();
      const changed = [
        { ...rows()[0]!, monthlySalesAmount: '27', weekendSalesAmount: null },
      ];
      const published = await importDistrictSalesStats(
        pool,
        { ...options, expectedRows: 1 },
        loader(changed, 'b'.repeat(64)),
      );
      expect(published.status).toBe('PUBLISHED');
      expect(await snapshot()).toEqual([
        {
          ...before[0],
          monthly_sales_amount: '27',
          weekend_sales_amount: null,
          source_batch_id: published.batchId,
        },
        before[1],
      ]);
      expect(
        (
          await importDistrictSalesStats(
            pool,
            { ...options, expectedRows: 1 },
            loader(changed, 'b'.repeat(64)),
          )
        ).status,
      ).toBe('SKIPPED');
    });

    it('rejects an expected row count mismatch and preserves validated counts in FAILED', async () => {
      await expect(
        importDistrictSalesStats(
          pool,
          { ...options, expectedRows: 100431 },
          loader(),
        ),
      ).rejects.toThrow('행 수');
      expect(await snapshot()).toEqual([]);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        expected_rows: '100431',
        fetched_rows: '2',
        valid_rows: '2',
        rejected_rows: '0',
        source_checksum: 'a'.repeat(64),
        published_at: null,
      });
    });

    it.each(['missing', 'extra'])(
      'rolls back if actual staging has %s records compared with validated input',
      async (kind) => {
        await importDistrictSalesStats(pool, options, loader());
        const before = await snapshot();
        // 원본 요약은 2행인데 실제 staging이 1행 또는 3행이면 SKIPPED나 PUBLISHED가 되어서는 안 됩니다.
        await expect(
          importDistrictSalesStats(pool, options, async (path, consume) =>
            loader()(path, async (batch) =>
              consume(
                kind === 'missing'
                  ? batch.slice(0, 1)
                  : [...batch, { ...batch[0]!, quarterCode: '20254' }],
              ),
            ),
          ),
        ).rejects.toThrow('스테이징 행 수');
        expect(await snapshot()).toEqual(before);
        expect(await latestFailure()).toMatchObject({
          status: 'FAILED',
          fetched_rows: '2',
          valid_rows: '2',
          rejected_rows: '0',
          published_at: null,
        });
      },
    );

    it.each(['district', 'industry', 'both'])(
      'reports missing %s FKs with source location and counts affected rows once',
      async (kind) => {
        const invalid = rows();
        if (kind !== 'industry') invalid[0]!.districtCode = '99999';
        if (kind !== 'district') invalid[0]!.industryCode = 'CS999999';
        let failure: unknown;
        try {
          await importDistrictSalesStats(pool, options, loader(invalid));
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        const message = (failure as Error).message;
        expect(message).toContain('FK');
        if (kind !== 'industry') expect(message).toContain('99999');
        if (kind !== 'district') expect(message).toContain('CS999999');
        expect(message).toContain('20261');
        expect(message).toContain('first_record');
        expect(await snapshot()).toEqual([]);
        expect(await latestFailure()).toMatchObject({
          fetched_rows: '2',
          valid_rows: '1',
          rejected_rows: '1',
        });
      },
    );

    it('rolls back earlier updates if a later Upsert row fails', async () => {
      // 첫 매출 갱신 후 다른 행에서 실패해도 값과 출처를 모두 이전 상태로 보존해야 합니다.
      await importDistrictSalesStats(pool, options, loader());
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION reject_sales_publish() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN IF NEW.district_code='11140' THEN RAISE EXCEPTION 'test sales publication failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_sales_publish BEFORE UPDATE ON district_sales_stat FOR EACH ROW EXECUTE FUNCTION reject_sales_publish()`);
      const changed = rows();
      changed[0]!.monthlySalesAmount = '19';
      await expect(
        importDistrictSalesStats(
          pool,
          options,
          loader(changed, 'b'.repeat(64)),
        ),
      ).rejects.toThrow('test sales publication failure');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        valid_rows: '2',
        rejected_rows: '0',
        published_at: null,
      });
    });

    it('rolls back staging and retains reader failure counters after a valid chunk', async () => {
      await importDistrictSalesStats(pool, options, loader());
      const before = await snapshot();
      await expect(
        importDistrictSalesStats(pool, options, async (_path, consume) => {
          await consume([{ ...rows()[0]!, monthlySalesAmount: '20' }]);
          throw new DistrictSalesSourceError('invalid sales row 3', {
            fetchedRows: 2,
            validRows: 1,
            rejectedRows: 1,
            checksum: 'c'.repeat(64),
            periodFrom: '20261',
            periodTo: '20261',
          });
        }),
      ).rejects.toThrow('invalid sales row 3');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        fetched_rows: '2',
        valid_rows: '1',
        rejected_rows: '1',
        source_checksum: 'c'.repeat(64),
      });
    });

    it('33,803행 합성 원본을 작은 청크로 게시하고 누락 조합을 생성하지 않는다', async () => {
      // 실제 원본과 별개의 규모 검증이며 25×100×22개 조합의 완성을 강제하지 않습니다.
      await pool.query(
        `INSERT INTO district (district_code,district_name,geom,boundary_batch_id)
        SELECT (11110+n)::text,'합성구 '||n,geom,$1 FROM district CROSS JOIN generate_series(0,24) AS n
        WHERE district_code='11110' ON CONFLICT DO NOTHING`,
        [seedBatchId],
      );
      await pool.query(
        `INSERT INTO service_industry
        SELECT 'CS'||(100000+n)::text,'합성업종 '||n,$1 FROM generate_series(0,99) AS n
        ON CONFLICT DO NOTHING`,
        [seedBatchId],
      );
      const bulk = Array.from({ length: 33803 }, (_, index) => {
        const quarter = index % 22;
        return {
          ...rows()[0]!,
          districtCode: String(11110 + Math.floor(index / 2200)),
          industryCode: 'CS' + String(100000 + (Math.floor(index / 22) % 100)),
          quarterCode:
            String(2021 + Math.floor(quarter / 4)) + String((quarter % 4) + 1),
        };
      });
      const result = await importDistrictSalesStats(
        pool,
        { ...options, expectedRows: 33803 },
        loader(bulk),
      );
      expect(result).toMatchObject({
        status: 'PUBLISHED',
        fetchedRows: 33803,
        validRows: 33803,
        periodFrom: '20211',
        periodTo: '20262',
      });
      expect(
        (
          await pool.query(`SELECT count(*) AS count,
        bool_and(monthly_sales_amount=9007199254740993 AND weekday_sales_amount=9223372036854775807) AS exact
        FROM district_sales_stat`)
        ).rows[0],
      ).toEqual({ count: '33803', exact: true });
      expect(
        (await pool.query('SELECT count(*) FROM dong_sales_stat')).rows[0]
          .count,
      ).toBe('0');
    }, 30000);

    it('serializes concurrent reruns so only one batch publishes', async () => {
      const results = await Promise.all([
        importDistrictSalesStats(pool, options, loader()),
        importDistrictSalesStats(pool, options, loader()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        'PUBLISHED',
        'SKIPPED',
      ]);
      expect(await snapshot()).toHaveLength(2);
    });

    it('records a missing source as FAILED without modifying reference data', async () => {
      await expect(
        importDistrictSalesStats(pool, {
          ...options,
          source: '/missing-sales-input.csv',
        }),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual([]);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '0',
        valid_rows: '0',
        rejected_rows: '0',
      });
      expect(
        (await pool.query('SELECT count(*) FROM district')).rows[0].count,
      ).toBe('2');
      expect(
        (await pool.query('SELECT count(*) FROM service_industry')).rows[0]
          .count,
      ).toBe('2');
    });
  },
);
