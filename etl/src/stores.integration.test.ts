import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importStoreStats } from './stores.js';
import {
  StoreSourceError,
  type StoreSource,
  type StoreStatRow,
} from './store-source.js';
import { createDatabasePool } from './database.js';

// 합성 통계는 새 일회용 PostGIS 컨테이너에만 적재합니다. 로컬 개발 DB와 원본은 변경하지 않습니다.
describe.runIf(process.env.RUN_STORE_DB_TESTS === '1')(
  'store statistics import',
  () => {
    let container: string | undefined;
    let admin: Pool;
    let pool: Pool;
    let databaseUrl: string;
    let seedBatchId: string;
    const pools: Pool[] = [];
    const options = { source: 'synthetic-stores.csv', expectedRows: 2 };
    const rows = (): StoreStatRow[] => [
      {
        dongCode: '11110515',
        industryCode: 'CS100010',
        quarterCode: '20261',
        storeCount: '9007199254740993',
        generalStoreCount: '2',
        franchiseStoreCount: null,
        openedStoreCount: '0',
        closedStoreCount: null,
        openingRate: '12345678901234567890.12345678901234567890',
        closureRate: '200.000001',
      },
      {
        dongCode: '11110530',
        industryCode: 'CS100001',
        quarterCode: '20262',
        storeCount: '0',
        generalStoreCount: null,
        franchiseStoreCount: '9',
        openedStoreCount: null,
        closedStoreCount: '0',
        openingRate: null,
        closureRate: '0',
      },
    ];

    // 파일 판독기만 메모리 원본으로 대체하고 스테이징·FK 검사·Upsert·배치 기록은 실제 DB로 검증합니다.
    const loader =
      (input = rows(), checksum = 'a'.repeat(64)) =>
      async (
        path: string,
        consume: (batch: StoreStatRow[]) => Promise<void>,
      ): Promise<StoreSource> => {
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
          'SELECT * FROM dong_store_stat ORDER BY dong_code,industry_code,quarter_code',
        )
      ).rows;
    const latestFailure = async () =>
      (
        await pool.query(
          "SELECT * FROM etl_batch WHERE dataset_code='SEOUL_DONG_STORE_STAT' AND status='FAILED' ORDER BY started_at DESC LIMIT 1",
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
          'POSTGRES_PASSWORD=store_test',
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
      databaseUrl = `postgresql://postgres:store_test@127.0.0.1:${port}/postgres`;
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
      const schema = `store_test_${randomUUID().replaceAll('-', '')}`;
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

    it('publishes exact BIGINT and NUMERIC values while preserving NULL and zero', async () => {
      const result = await importStoreStats(pool, options, loader());
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
          store_count: '9007199254740993',
          general_store_count: '2',
          franchise_store_count: null,
          opened_store_count: '0',
          closed_store_count: null,
          opening_rate: '12345678901234567890.12345678901234567890',
          closure_rate: '200.000001',
          source_batch_id: result.batchId,
        },
        {
          dong_code: '11110530',
          industry_code: 'CS100001',
          quarter_code: '20262',
          store_count: '0',
          general_store_count: null,
          franchise_store_count: '9',
          opened_store_count: null,
          closed_store_count: '0',
          opening_rate: null,
          closure_rate: '0',
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

    it('skips unchanged input without changing values or source batch references', async () => {
      await importStoreStats(pool, options, loader());
      const before = await snapshot();
      const skipped = await importStoreStats(pool, options, loader());
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

    it.each(['value', 'provenance', 'missing row'])(
      'republishes identical input if actual DB %s differs',
      async (change) => {
        await importStoreStats(pool, options, loader());
        if (change === 'value')
          await pool.query(
            "UPDATE dong_store_stat SET opened_store_count=NULL WHERE dong_code='11110515'",
          );
        else if (change === 'provenance')
          await pool.query('UPDATE dong_store_stat SET source_batch_id=$1', [
            seedBatchId,
          ]);
        else
          await pool.query(
            "DELETE FROM dong_store_stat WHERE dong_code='11110515'",
          );
        const repaired = await importStoreStats(pool, options, loader());
        expect(repaired.status).toBe('PUBLISHED');
        expect((await snapshot())[0]).toMatchObject({
          opened_store_count: '0',
          source_batch_id: repaired.batchId,
        });
        expect(await snapshot()).toHaveLength(2);
      },
    );

    it('upserts changed input and retains records missing from the new snapshot', async () => {
      await importStoreStats(pool, options, loader());
      const before = await snapshot();
      const changed = [{ ...rows()[0]!, storeCount: '27', openingRate: null }];
      const published = await importStoreStats(
        pool,
        { ...options, expectedRows: 1 },
        loader(changed, 'b'.repeat(64)),
      );
      expect(published.status).toBe('PUBLISHED');
      expect(await snapshot()).toEqual([
        {
          ...before[0],
          store_count: '27',
          opening_rate: null,
          source_batch_id: published.batchId,
        },
        before[1],
      ]);
      expect(
        (
          await importStoreStats(
            pool,
            { ...options, expectedRows: 1 },
            loader(changed, 'b'.repeat(64)),
          )
        ).status,
      ).toBe('SKIPPED');
    });

    it('fails a row-count mismatch without publishing staged records', async () => {
      await expect(
        importStoreStats(pool, { ...options, expectedRows: 211832 }, loader()),
      ).rejects.toThrow('행 수');
      expect(await snapshot()).toEqual([]);
      expect(await latestFailure()).toMatchObject({
        expected_rows: '211832',
        fetched_rows: '2',
        valid_rows: '2',
        rejected_rows: '0',
        source_checksum: 'a'.repeat(64),
        published_at: null,
      });
    });

    it.each(['missing', 'extra'])(
      'rolls back when staging has %s rows compared with validated input',
      async (kind) => {
        await importStoreStats(pool, options, loader());
        const before = await snapshot();
        // 검증 요약은 2행인데 실제 스테이징에는 1행 또는 3행을 전달해 누락·초과를 재현합니다.
        // 같은 체크섬의 일부 행만 비교해 SKIPPED로 끝나거나 불완전한 원본을 공개하면 안 됩니다.
        await expect(
          importStoreStats(pool, options, async (path, consume) =>
            loader()(path, async (batch) => {
              await consume(
                kind === 'missing'
                  ? batch.slice(0, 1)
                  : [...batch, { ...batch[0]!, quarterCode: '20254' }],
              );
            }),
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
      'reports missing %s FKs and counts a doubly invalid row only once',
      async (kind) => {
        const invalid = rows();
        if (kind !== 'industry') invalid[0]!.dongCode = '99999999';
        if (kind !== 'dong') invalid[0]!.industryCode = 'CS999999';
        let failure: unknown;
        try {
          await importStoreStats(pool, options, loader(invalid));
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        const message = (failure as Error).message;
        expect(message).toContain('FK');
        if (kind !== 'industry') expect(message).toContain('99999999');
        if (kind !== 'dong') expect(message).toContain('CS999999');
        expect(message).toContain('20261');
        expect(await snapshot()).toEqual([]);
        expect(await latestFailure()).toMatchObject({
          fetched_rows: '2',
          valid_rows: '1',
          rejected_rows: '1',
        });
      },
    );

    it('rolls back earlier updates if a later Upsert row fails', async () => {
      // 첫 행을 갱신한 뒤 두 번째 행에서 실패시켜 값과 출처가 함께 되돌아가는지 확인합니다.
      await importStoreStats(pool, options, loader());
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION reject_store_publish() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN IF NEW.dong_code='11110530' THEN RAISE EXCEPTION 'test store publication failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_store_publish BEFORE UPDATE ON dong_store_stat FOR EACH ROW EXECUTE FUNCTION reject_store_publish()`);
      const changed = rows();
      changed[0]!.storeCount = '19';
      await expect(
        importStoreStats(pool, options, loader(changed, 'b'.repeat(64))),
      ).rejects.toThrow('test store publication failure');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        valid_rows: '2',
        rejected_rows: '0',
        published_at: null,
      });
    });

    it('rolls back staging and records a reader error after an earlier valid chunk', async () => {
      await importStoreStats(pool, options, loader());
      const before = await snapshot();
      await expect(
        importStoreStats(pool, options, async (_path, consume) => {
          await consume([{ ...rows()[0]!, storeCount: '20' }]);
          throw new StoreSourceError('invalid source row 3', {
            fetchedRows: 2,
            validRows: 1,
            rejectedRows: 1,
            checksum: 'c'.repeat(64),
            periodFrom: '20261',
            periodTo: '20261',
          });
        }),
      ).rejects.toThrow('invalid source row 3');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        fetched_rows: '2',
        valid_rows: '1',
        rejected_rows: '1',
        source_checksum: 'c'.repeat(64),
      });
    });

    it('publishes multiple staging chunks without losing rows or precision', async () => {
      const bulk = Array.from({ length: 2501 }, (_, index) => ({
        ...rows()[0]!,
        quarterCode: `${1000 + index}1`,
      }));
      const result = await importStoreStats(
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
      bool_and(store_count=9007199254740993 AND opening_rate=12345678901234567890.12345678901234567890) AS exact
      FROM dong_store_stat`)
        ).rows[0],
      ).toEqual({ count: '2501', exact: true });
    });

    it('serializes concurrent reruns so only one batch publishes', async () => {
      const result = await Promise.all([
        importStoreStats(pool, options, loader()),
        importStoreStats(pool, options, loader()),
      ]);
      expect(result.map((item) => item.status).sort()).toEqual([
        'PUBLISHED',
        'SKIPPED',
      ]);
      expect(await snapshot()).toHaveLength(2);
    });

    it('records a missing source as FAILED without touching reference data', async () => {
      await expect(
        importStoreStats(pool, {
          ...options,
          source: '/missing-store-input.csv',
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
