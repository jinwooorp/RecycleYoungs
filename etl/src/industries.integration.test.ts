import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importIndustries } from './industries.js';
import { IndustrySourceError, type IndustrySource } from './industry-source.js';
import { createDatabasePool } from './database.js';

// 실제 개발 DB와 분리한 일회용 컨테이너에서만 합성 업종을 반영합니다.
describe.runIf(process.env.RUN_INDUSTRY_DB_TESTS === '1')(
  'service industry import',
  () => {
    let container: string | undefined;
    let admin: Pool;
    let pool: Pool;
    let databaseUrl: string;
    const pools: Pool[] = [];
    const options = { source: 'synthetic-stores.csv', expectedIndustries: 2 };
    const source = (): IndustrySource => ({
      checksum: 'a'.repeat(64),
      industries: [
        { industryCode: 'CS100001', industryName: '한식음식점' },
        { industryCode: 'CS100010', industryName: '커피-음료' },
      ],
      fetchedRows: 3,
      validRows: 3,
      rejectedRows: 0,
      sources: [
        {
          role: 'stores',
          path: 'synthetic-stores.csv',
          encoding: 'UTF-8',
          rows: 3,
          industries: 2,
        },
      ],
    });
    const snapshot = async () =>
      (
        await pool.query(
          'SELECT * FROM service_industry ORDER BY industry_code',
        )
      ).rows;
    const latestFailure = async () =>
      (
        await pool.query(
          "SELECT * FROM etl_batch WHERE status='FAILED' ORDER BY started_at DESC LIMIT 1",
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
          'POSTGRES_PASSWORD=industry_test',
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
      databaseUrl = `postgresql://postgres:industry_test@127.0.0.1:${port}/postgres`;
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
      // 테스트별 스키마를 사용하므로 다른 테스트나 기존 개발 데이터의 삭제가 필요 없습니다.
      const schema = `industry_test_${randomUUID().replaceAll('-', '')}`;
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
    });

    afterAll(async () => {
      await Promise.all(pools.map((item) => item.end()));
      if (admin) await admin.end();
      if (container)
        execFileSync('docker', ['stop', container], { stdio: 'pipe' });
    }, 30000);

    it('publishes unique industries with provenance while counting all source rows', async () => {
      const result = await importIndustries(pool, options, async () =>
        source(),
      );
      expect(result).toMatchObject({
        status: 'PUBLISHED',
        fetchedRows: 3,
        validRows: 3,
        rejectedRows: 0,
        industries: 2,
      });
      expect(await snapshot()).toEqual([
        {
          industry_code: 'CS100001',
          industry_name: '한식음식점',
          source_batch_id: result.batchId,
        },
        {
          industry_code: 'CS100010',
          industry_name: '커피-음료',
          source_batch_id: result.batchId,
        },
      ]);
      const batch = (
        await pool.query('SELECT * FROM etl_batch WHERE batch_id=$1', [
          result.batchId,
        ])
      ).rows[0];
      expect(batch).toMatchObject({
        source_type: 'CSV',
        scope_type: 'SEOUL',
        expected_rows: null,
        fetched_rows: '3',
        valid_rows: '3',
        rejected_rows: '0',
        status: 'PUBLISHED',
        source_checksum: 'a'.repeat(64),
      });
      expect(JSON.parse(batch.source_reference)).toMatchObject({
        expectedIndustries: 2,
        sources: [{ role: 'stores', rows: 3, industries: 2 }],
      });
      expect(batch.published_at).not.toBeNull();
    });

    it('skips an identical source and keeps the published batch references', async () => {
      await importIndustries(pool, options, async () => source());
      const before = await snapshot();
      const result = await importIndustries(pool, options, async () =>
        source(),
      );
      expect(result.status).toBe('SKIPPED');
      expect(await snapshot()).toEqual(before);
      expect(
        (
          await pool.query(
            'SELECT published_at FROM etl_batch WHERE batch_id=$1',
            [result.batchId],
          )
        ).rows[0].published_at,
      ).toBeNull();
    });

    it.each(['name', 'provenance', 'missing row'])(
      'repairs actual DB %s changes even for the same checksum',
      async (change) => {
        await importIndustries(pool, options, async () => source());
        if (change === 'name')
          await pool.query(
            "UPDATE service_industry SET industry_name='잘못된 수정' WHERE industry_code='CS100010'",
          );
        else if (change === 'missing row')
          // 일회용 테스트 DB에서 행 누락을 재현합니다. 같은 체크섬이라도 복구해야 합니다.
          await pool.query(
            "DELETE FROM service_industry WHERE industry_code='CS100010'",
          );
        else {
          const next = await importIndustries(pool, options, async () => ({
            ...source(),
            checksum: 'b'.repeat(64),
          }));
          expect(next.status).toBe('PUBLISHED');
        }
        const repaired = await importIndustries(pool, options, async () =>
          source(),
        );
        expect(repaired.status).toBe('PUBLISHED');
        expect(
          (await snapshot()).find((row) => row.industry_code === 'CS100010'),
        ).toMatchObject({
          industry_name: '커피-음료',
          source_batch_id: repaired.batchId,
        });
      },
    );

    it('publishes changed sources and retains existing industries absent from the input', async () => {
      await importIndustries(pool, options, async () => source());
      const before = await snapshot();
      const changed = source();
      changed.checksum = 'b'.repeat(64);
      changed.industries = [
        { industryCode: 'CS100010', industryName: '새 명칭' },
      ];
      const result = await importIndustries(
        pool,
        { ...options, expectedIndustries: 1 },
        async () => changed,
      );
      expect(result.status).toBe('PUBLISHED');
      expect(await snapshot()).toEqual([
        before[0],
        {
          industry_code: 'CS100010',
          industry_name: '새 명칭',
          source_batch_id: result.batchId,
        },
      ]);
      expect(
        (
          await importIndustries(
            pool,
            { ...options, expectedIndustries: 1 },
            async () => changed,
          )
        ).status,
      ).toBe('SKIPPED');
    });

    it('rejects a wrong unique count without substituting it for source row counts', async () => {
      await expect(
        importIndustries(
          pool,
          { ...options, expectedIndustries: 100 },
          async () => source(),
        ),
      ).rejects.toThrow('고유 업종 수');
      expect(await snapshot()).toEqual([]);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '3',
        valid_rows: '3',
        rejected_rows: '0',
        source_checksum: 'a'.repeat(64),
        published_at: null,
      });
    });

    it('rolls back even an earlier successful row when publication later fails', async () => {
      // 첫 행이 갱신된 다음 두 번째 행에서 실패해도 데이터와 출처를 모두 되돌려야 합니다.
      await importIndustries(pool, options, async () => source());
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION reject_industry_publish() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN IF NEW.industry_code='CS100010' THEN RAISE EXCEPTION 'test industry failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_industry_publish BEFORE UPDATE ON service_industry FOR EACH ROW EXECUTE FUNCTION reject_industry_publish()`);
      const changed = source();
      changed.checksum = 'b'.repeat(64);
      changed.industries[0]!.industryName = '변경한 명칭';
      await expect(
        importIndustries(pool, options, async () => changed),
      ).rejects.toThrow('test industry failure');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        valid_rows: '3',
        published_at: null,
      });
    });

    it('records reader failures outside the publication transaction', async () => {
      await expect(
        importIndustries(pool, options, async () => {
          throw new IndustrySourceError('업종 명칭 충돌', {
            fetchedRows: 3,
            validRows: 2,
            rejectedRows: 1,
            checksum: 'c'.repeat(64),
          });
        }),
      ).rejects.toThrow('업종 명칭 충돌');
      expect(await latestFailure()).toMatchObject({
        fetched_rows: '3',
        valid_rows: '2',
        rejected_rows: '1',
        source_checksum: 'c'.repeat(64),
      });
      expect(await snapshot()).toEqual([]);
    });

    it('records a missing local input without publishing any industry', async () => {
      await expect(
        importIndustries(pool, {
          ...options,
          source: '/missing-industry-input.csv',
        }),
      ).rejects.toThrow();
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '0',
      });
      expect(await snapshot()).toEqual([]);
    });

    it('serializes concurrent imports of the same source', async () => {
      const results = await Promise.all([
        importIndustries(pool, options, async () => source()),
        importIndustries(pool, options, async () => source()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        'PUBLISHED',
        'SKIPPED',
      ]);
      expect(await snapshot()).toHaveLength(2);
    });
  },
);
