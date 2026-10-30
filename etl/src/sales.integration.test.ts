import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importSalesStats } from './sales.js';
import {
  SalesSourceError,
  type SalesSource,
  type SalesStatRow,
} from './sales-source.js';
import { createDatabasePool } from './database.js';

// 합성 통계는 새 일회용 PostGIS 컨테이너에만 적재합니다. 로컬 개발 DB와 원본은 변경하지 않습니다.
describe.runIf(process.env.RUN_SALES_DB_TESTS === '1')(
  'sales statistics import',
  () => {
    let container: string | undefined;
    let admin: Pool;
    let pool: Pool;
    let databaseUrl: string;
    let seedBatchId: string;
    const pools: Pool[] = [];
    const options = { source: 'synthetic-sales.csv', expectedRows: 2 };
    const rows = (): SalesStatRow[] => [
      {
        dongCode: '11110515',
        industryCode: 'CS100010',
        quarterCode: '20261',
        monthlySalesAmount: '9007199254740993',
        monthlySalesCount: '2',
        weekdaySalesAmount: '9223372036854775807',
        weekendSalesAmount: '0',
      },
      {
        dongCode: '11110530',
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
        consume: (batch: SalesStatRow[]) => Promise<void>,
      ): Promise<SalesSource> => {
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
          'SELECT * FROM dong_sales_stat ORDER BY dong_code,industry_code,quarter_code',
        )
      ).rows;
    const latestFailure = async () =>
      (
        await pool.query(
          "SELECT * FROM etl_batch WHERE dataset_code='SEOUL_DONG_SALES_STAT' AND status='FAILED' ORDER BY started_at DESC LIMIT 1",
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
          'POSTGRES_PASSWORD=sales_test',
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
      databaseUrl = `postgresql://postgres:sales_test@127.0.0.1:${port}/postgres`;
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
      const schema = `sales_test_${randomUUID().replaceAll('-', '')}`;
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
        `INSERT INTO administrative_dong
      (dong_code,district_code,dong_name,geom,label_point,area_m2,boundary_batch_id)
      SELECT code,'11110','테스트동',geom,ST_PointOnSurface(geom),10000,$1
      FROM district CROSS JOIN (VALUES ('11110515'),('11110530')) AS codes(code)`,
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
      const result = await importSalesStats(pool, options, loader());
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
          dong_code: '11110515',
          industry_code: 'CS100010',
          quarter_code: '20261',
          monthly_sales_amount: '9007199254740993',
          monthly_sales_count: '2',
          weekday_sales_amount: '9223372036854775807',
          weekend_sales_amount: '0',
          source_batch_id: result.batchId,
        },
        {
          dong_code: '11110530',
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
      await importSalesStats(pool, options, loader());
      const before = await snapshot();
      const skipped = await importSalesStats(pool, options, loader());
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
    });

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
        await importSalesStats(pool, options, loader());
        if (change === 'provenance')
          await pool.query('UPDATE dong_sales_stat SET source_batch_id=$1', [
            seedBatchId,
          ]);
        else if (change === 'missing row')
          await pool.query(
            "DELETE FROM dong_sales_stat WHERE dong_code='11110515'",
          );
        else if (change === 'nullable zero')
          await pool.query(
            "UPDATE dong_sales_stat SET monthly_sales_count=0 WHERE dong_code='11110530'",
          );
        else
          await pool.query(
            `UPDATE dong_sales_stat SET ${change}=NULL WHERE dong_code='11110515'`,
          );
        const repaired = await importSalesStats(pool, options, loader());
        expect(repaired.status).toBe('PUBLISHED');
        expect(await snapshot()).toEqual([
          {
            dong_code: '11110515',
            industry_code: 'CS100010',
            quarter_code: '20261',
            monthly_sales_amount: '9007199254740993',
            monthly_sales_count: '2',
            weekday_sales_amount: '9223372036854775807',
            weekend_sales_amount: '0',
            source_batch_id: repaired.batchId,
          },
          {
            dong_code: '11110530',
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
      await importSalesStats(pool, options, loader());
      const before = await snapshot();
      const changed = [
        { ...rows()[0]!, monthlySalesAmount: '27', weekendSalesAmount: null },
      ];
      const published = await importSalesStats(
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
          await importSalesStats(
            pool,
            { ...options, expectedRows: 1 },
            loader(changed, 'b'.repeat(64)),
          )
        ).status,
      ).toBe('SKIPPED');
    });

    it('rejects an expected row count mismatch and preserves validated counts in FAILED', async () => {
      await expect(
        importSalesStats(pool, { ...options, expectedRows: 100431 }, loader()),
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
        await importSalesStats(pool, options, loader());
        const before = await snapshot();
        // 원본 요약은 2행인데 실제 staging이 1행 또는 3행이면 SKIPPED나 PUBLISHED가 되어서는 안 됩니다.
        await expect(
          importSalesStats(pool, options, async (path, consume) =>
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

    it.each(['dong', 'industry', 'both'])(
      'reports missing %s FKs with source location and counts affected rows once',
      async (kind) => {
        const invalid = rows();
        if (kind !== 'industry') invalid[0]!.dongCode = '99999999';
        if (kind !== 'dong') invalid[0]!.industryCode = 'CS999999';
        let failure: unknown;
        try {
          await importSalesStats(pool, options, loader(invalid));
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        const message = (failure as Error).message;
        expect(message).toContain('FK');
        if (kind !== 'industry') expect(message).toContain('99999999');
        if (kind !== 'dong') expect(message).toContain('CS999999');
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
      await importSalesStats(pool, options, loader());
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION reject_sales_publish() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN IF NEW.dong_code='11110530' THEN RAISE EXCEPTION 'test sales publication failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_sales_publish BEFORE UPDATE ON dong_sales_stat FOR EACH ROW EXECUTE FUNCTION reject_sales_publish()`);
      const changed = rows();
      changed[0]!.monthlySalesAmount = '19';
      await expect(
        importSalesStats(pool, options, loader(changed, 'b'.repeat(64))),
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
      await importSalesStats(pool, options, loader());
      const before = await snapshot();
      await expect(
        importSalesStats(pool, options, async (_path, consume) => {
          await consume([{ ...rows()[0]!, monthlySalesAmount: '20' }]);
          throw new SalesSourceError('invalid sales row 3', {
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

    it('publishes multiple staging chunks without losing exact amounts', async () => {
      const bulk = Array.from({ length: 2501 }, (_, index) => ({
        ...rows()[0]!,
        quarterCode: `${1000 + index}1`,
      }));
      const result = await importSalesStats(
        pool,
        { ...options, expectedRows: 2501 },
        loader(bulk),
      );
      expect(result).toMatchObject({
        status: 'PUBLISHED',
        fetchedRows: 2501,
        validRows: 2501,
        periodFrom: '10001',
        periodTo: '35001',
      });
      expect(
        (
          await pool.query(`SELECT count(*) AS count,
        bool_and(monthly_sales_amount=9007199254740993 AND weekday_sales_amount=9223372036854775807) AS exact
        FROM dong_sales_stat`)
        ).rows[0],
      ).toEqual({ count: '2501', exact: true });
    });

    it('serializes concurrent reruns so only one batch publishes', async () => {
      const results = await Promise.all([
        importSalesStats(pool, options, loader()),
        importSalesStats(pool, options, loader()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        'PUBLISHED',
        'SKIPPED',
      ]);
      expect(await snapshot()).toHaveLength(2);
    });

    it('records a missing source as FAILED without modifying reference data', async () => {
      await expect(
        importSalesStats(pool, {
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
        (await pool.query('SELECT count(*) FROM administrative_dong')).rows[0]
          .count,
      ).toBe('2');
      expect(
        (await pool.query('SELECT count(*) FROM service_industry')).rows[0]
          .count,
      ).toBe('2');
    });
  },
);
