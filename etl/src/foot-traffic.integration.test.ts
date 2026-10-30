import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importFootTrafficStats } from './foot-traffic.js';
import {
  FootTrafficSourceError,
  type FootTrafficSource,
  type FootTrafficStatRow,
} from './foot-traffic-source.js';
import { createDatabasePool } from './database.js';

// 합성 통계는 새 일회용 PostGIS 컨테이너에만 적재합니다. 로컬 개발 DB와 원본은 변경하지 않습니다.
describe.runIf(process.env.RUN_FOOT_TRAFFIC_DB_TESTS === '1')(
  'foot traffic statistics import',
  () => {
    let container: string | undefined;
    let admin: Pool;
    let pool: Pool;
    let databaseUrl: string;
    let seedBatchId: string;
    const pools: Pool[] = [];
    const options = { source: 'synthetic-foot-traffic.csv', expectedRows: 2 };
    const rows = (): FootTrafficStatRow[] => [
      {
        dongCode: '11110515',
        quarterCode: '20261',
        totalFootTraffic: '9007199254740993.12345678901234567890123456789',
        maleFootTraffic: '2.0000000000000000000000000000100',
        femaleFootTraffic: '9223372036854775807.98765432109876543210987654321',
      },
      {
        dongCode: '11110530',
        quarterCode: '20262',
        totalFootTraffic: '0',
        maleFootTraffic: null,
        femaleFootTraffic: '0',
      },
    ];

    // 파일 판독기만 메모리 원본으로 대체하고 스테이징·FK 검사·Upsert·배치 기록은 실제 DB로 검증합니다.
    const loader =
      (input = rows(), checksum = 'a'.repeat(64)) =>
      async (
        path: string,
        consume: (batch: FootTrafficStatRow[]) => Promise<void>,
      ): Promise<FootTrafficSource> => {
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
          entry: 'synthetic-foot-traffic.csv',
          encoding: 'UTF-8',
        };
      };
    const snapshot = async () =>
      (
        await pool.query(
          'SELECT * FROM dong_foot_traffic_stat ORDER BY dong_code,quarter_code',
        )
      ).rows;
    const latestFailure = async () =>
      (
        await pool.query(
          "SELECT * FROM etl_batch WHERE dataset_code='SEOUL_DONG_FOOT_TRAFFIC_STAT' AND status='FAILED' ORDER BY started_at DESC LIMIT 1",
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
          'POSTGRES_PASSWORD=foot_traffic_test',
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
      databaseUrl = `postgresql://postgres:foot_traffic_test@127.0.0.1:${port}/postgres`;
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
      const schema = `foot_traffic_test_${randomUUID().replaceAll('-', '')}`;
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
    });

    afterAll(async () => {
      await Promise.all(pools.map((item) => item.end()));
      if (admin) await admin.end();
      if (container)
        execFileSync('docker', ['stop', container], { stdio: 'pipe' });
    }, 30000);

    it('publishes exact NUMERIC values, NULL, zero and source metadata without forcing sums', async () => {
      // 큰 정수부와 긴 소수부를 보존하고 남성·여성 합계가 전체와 달라도 원본 의미를 유지합니다.
      const result = await importFootTrafficStats(pool, options, loader());
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
          quarter_code: '20261',
          total_foot_traffic: '9007199254740993.12345678901234567890123456789',
          male_foot_traffic: '2.0000000000000000000000000000100',
          female_foot_traffic:
            '9223372036854775807.98765432109876543210987654321',
          source_batch_id: result.batchId,
        },
        {
          dong_code: '11110530',
          quarter_code: '20262',
          total_foot_traffic: '0',
          male_foot_traffic: null,
          female_foot_traffic: '0',
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
        dataset_code: 'SEOUL_DONG_FOOT_TRAFFIC_STAT',
        etl_version: 'foot-traffic-stat-v1',
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
        path: options.source,
        entry: 'synthetic-foot-traffic.csv',
        encoding: 'UTF-8',
      });
    });

    it('skips unchanged source while preserving every value and published reference', async () => {
      await importFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      const skipped = await importFootTrafficStats(pool, options, loader());
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
      'total_foot_traffic',
      'male_foot_traffic',
      'female_foot_traffic',
      'nullable zero',
      'zero to null',
      'provenance',
      'missing row',
    ])(
      'republishes identical source if actual DB %s differs',
      async (change) => {
        await importFootTrafficStats(pool, options, loader());
        if (change === 'provenance')
          await pool.query(
            'UPDATE dong_foot_traffic_stat SET source_batch_id=$1',
            [seedBatchId],
          );
        else if (change === 'missing row')
          await pool.query(
            "DELETE FROM dong_foot_traffic_stat WHERE dong_code='11110515'",
          );
        else if (change === 'nullable zero')
          await pool.query(
            "UPDATE dong_foot_traffic_stat SET male_foot_traffic=0 WHERE dong_code='11110530'",
          );
        else if (change === 'zero to null')
          await pool.query(
            "UPDATE dong_foot_traffic_stat SET total_foot_traffic=NULL WHERE dong_code='11110530'",
          );
        else
          await pool.query(
            `UPDATE dong_foot_traffic_stat SET ${change}=NULL WHERE dong_code='11110515'`,
          );
        const repaired = await importFootTrafficStats(pool, options, loader());
        expect(repaired.status).toBe('PUBLISHED');
        expect(await snapshot()).toEqual([
          {
            dong_code: '11110515',
            quarter_code: '20261',
            total_foot_traffic:
              '9007199254740993.12345678901234567890123456789',
            male_foot_traffic: '2.0000000000000000000000000000100',
            female_foot_traffic:
              '9223372036854775807.98765432109876543210987654321',
            source_batch_id: repaired.batchId,
          },
          {
            dong_code: '11110530',
            quarter_code: '20262',
            total_foot_traffic: '0',
            male_foot_traffic: null,
            female_foot_traffic: '0',
            source_batch_id: repaired.batchId,
          },
        ]);
      },
    );

    it('upserts changed sources without deleting records absent from new input', async () => {
      await importFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      const changed = [
        { ...rows()[0]!, totalFootTraffic: '27', maleFootTraffic: null },
      ];
      const published = await importFootTrafficStats(
        pool,
        { ...options, expectedRows: 1 },
        loader(changed, 'b'.repeat(64)),
      );
      expect(published.status).toBe('PUBLISHED');
      expect(await snapshot()).toEqual([
        {
          ...before[0],
          total_foot_traffic: '27',
          male_foot_traffic: null,
          source_batch_id: published.batchId,
        },
        before[1],
      ]);
      expect(
        (
          await importFootTrafficStats(
            pool,
            { ...options, expectedRows: 1 },
            loader(changed, 'b'.repeat(64)),
          )
        ).status,
      ).toBe('SKIPPED');
    });

    it('rejects an expected row count mismatch and preserves validated counts in FAILED', async () => {
      await expect(
        importFootTrafficStats(
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
        await importFootTrafficStats(pool, options, loader());
        const before = await snapshot();
        // 원본 요약은 2행인데 실제 staging이 1행 또는 3행이면 SKIPPED나 PUBLISHED가 되어서는 안 됩니다.
        await expect(
          importFootTrafficStats(pool, options, async (path, consume) =>
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

    it('reports missing dong FKs with source location and affected row counts', async () => {
      const invalid = [
        rows()[0]!,
        { ...rows()[1]!, dongCode: '99999999' },
        { ...rows()[1]!, dongCode: '99999999', quarterCode: '20263' },
      ];
      let failure: unknown;
      try {
        await importFootTrafficStats(
          pool,
          { ...options, expectedRows: 3 },
          loader(invalid),
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain('FK');
      expect(message).toContain('99999999');
      expect(message).toContain('20262');
      expect(message).toContain('20263');
      expect(message).toContain('"rows":"2"');
      expect(message).toContain('"first_record":"2"');
      expect(await snapshot()).toEqual([]);
      expect(await latestFailure()).toMatchObject({
        fetched_rows: '3',
        valid_rows: '1',
        rejected_rows: '2',
      });
    });

    it('rolls back earlier updates if a later Upsert row fails', async () => {
      // 첫 유동인구 갱신 후 다른 행에서 실패해도 값과 출처를 모두 이전 상태로 보존해야 합니다.
      await importFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION reject_foot_traffic_publish() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN IF NEW.dong_code='11110530' THEN RAISE EXCEPTION 'test foot_traffic publication failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_foot_traffic_publish BEFORE UPDATE ON dong_foot_traffic_stat FOR EACH ROW EXECUTE FUNCTION reject_foot_traffic_publish()`);
      const changed = rows();
      changed[0]!.totalFootTraffic = '19';
      await expect(
        importFootTrafficStats(pool, options, loader(changed, 'b'.repeat(64))),
      ).rejects.toThrow('test foot_traffic publication failure');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        valid_rows: '2',
        rejected_rows: '0',
        published_at: null,
      });
    });

    it('rolls back staging and retains reader failure counters after a valid chunk', async () => {
      await importFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      await expect(
        importFootTrafficStats(pool, options, async (_path, consume) => {
          await consume([{ ...rows()[0]!, totalFootTraffic: '20' }]);
          throw new FootTrafficSourceError('invalid foot_traffic row 3', {
            fetchedRows: 2,
            validRows: 1,
            rejectedRows: 1,
            checksum: 'c'.repeat(64),
            periodFrom: '20261',
            periodTo: '20261',
          });
        }),
      ).rejects.toThrow('invalid foot_traffic row 3');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        fetched_rows: '2',
        valid_rows: '1',
        rejected_rows: '1',
        source_checksum: 'c'.repeat(64),
        status: 'FAILED',
        period_from: '20261',
        period_to: '20261',
        published_at: null,
      });
    });

    it('publishes multiple staging chunks without losing exact amounts', async () => {
      const bulk = Array.from({ length: 2501 }, (_, index) => ({
        ...rows()[0]!,
        quarterCode: `${1000 + index}1`,
      }));
      const result = await importFootTrafficStats(
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
        bool_and(total_foot_traffic=9007199254740993.12345678901234567890123456789
          AND male_foot_traffic=2.0000000000000000000000000000100
          AND female_foot_traffic=9223372036854775807.98765432109876543210987654321) AS exact
        FROM dong_foot_traffic_stat`)
        ).rows[0],
      ).toEqual({ count: '2501', exact: true });
    });

    it('serializes concurrent reruns so only one batch publishes', async () => {
      const results = await Promise.all([
        importFootTrafficStats(pool, options, loader()),
        importFootTrafficStats(pool, options, loader()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        'PUBLISHED',
        'SKIPPED',
      ]);
      expect(await snapshot()).toHaveLength(2);
    });

    it('records missing V3 as FAILED before reading the source', async () => {
      // 이 테스트 전용 스키마에서만 V3 대상 테이블을 제거해 사전 점검의 실패를 재현합니다.
      await pool.query('DROP TABLE dong_foot_traffic_stat');
      await expect(
        importFootTrafficStats(pool, options, async () => {
          throw new Error('source reader must not run before V3 preflight');
        }),
      ).rejects.toThrow('Flyway V3');
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '0',
        valid_rows: '0',
        rejected_rows: '0',
        published_at: null,
      });
      expect(
        (await pool.query('SELECT count(*) FROM administrative_dong')).rows[0]
          .count,
      ).toBe('2');
    });

    it('records a missing source as FAILED without modifying reference data', async () => {
      await expect(
        importFootTrafficStats(pool, {
          ...options,
          source: '/missing-foot_traffic-input.csv',
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
    });
  },
);
