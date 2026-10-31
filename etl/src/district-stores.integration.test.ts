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
import { importDistrictStoreStats } from './district-stores.js';
import {
  DistrictStoreSourceError,
  type DistrictStoreSource,
  type DistrictStoreStatRow,
} from './district-store-source.js';
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
describe.runIf(process.env.RUN_DISTRICT_STORE_DB_TESTS === '1')(
  '자치구 점포 통계 격리 DB 적재',
  () => {
    let container: string | undefined;
    let admin: Pool;
    let pool: Pool;
    let databaseUrl: string;
    let seedBatchId: string;
    const pools: Pool[] = [];
    const options = {
      source: 'synthetic-district-stores.csv',
      expectedRows: 2,
    };
    const rows = (): DistrictStoreStatRow[] => [
      {
        districtCode: '11110',
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
        districtCode: '11140',
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
        consume: (batch: DistrictStoreStatRow[]) => Promise<void>,
      ): Promise<DistrictStoreSource> => {
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
          'SELECT * FROM district_store_stat ORDER BY district_code,industry_code,quarter_code',
        )
      ).rows;
    const latestFailure = async () =>
      (
        await pool.query(
          "SELECT * FROM etl_batch WHERE dataset_code='SEOUL_DISTRICT_STORE_STAT' AND status='FAILED' ORDER BY started_at DESC LIMIT 1",
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
          'POSTGRES_PASSWORD=district_store_test',
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
      databaseUrl = `postgresql://postgres:district_store_test@127.0.0.1:${port}/postgres`;
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
      const schema = `district_store_test_${randomUUID().replaceAll('-', '')}`;
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

    it('BIGINT·NUMERIC 정밀도와 NULL·0·100% 초과 비율을 그대로 게시한다', async () => {
      const result = await importDistrictStoreStats(pool, options, loader());
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
          district_code: '11140',
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

    it('동일 원본 재실행은 값과 정상 게시 출처를 보존하고 SKIPPED로 기록한다', async () => {
      await importDistrictStoreStats(pool, options, loader());
      const before = await snapshot();
      const skipped = await importDistrictStoreStats(pool, options, loader());
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

    it.each(['value', 'provenance', 'missing row', 'rate scale'])(
      '동일 체크섬이어도 실제 DB의 %s가 다르면 다시 게시한다',
      async (change) => {
        await importDistrictStoreStats(pool, options, loader());
        if (change === 'value')
          await pool.query(
            "UPDATE district_store_stat SET opened_store_count=NULL WHERE district_code='11110'",
          );
        else if (change === 'rate scale')
          await pool.query(
            "UPDATE district_store_stat SET opening_rate=(opening_rate::text || '0')::numeric WHERE district_code='11110'",
          );
        else if (change === 'provenance')
          await pool.query(
            'UPDATE district_store_stat SET source_batch_id=$1',
            [seedBatchId],
          );
        else
          await pool.query(
            "DELETE FROM district_store_stat WHERE district_code='11110'",
          );
        const repaired = await importDistrictStoreStats(
          pool,
          options,
          loader(),
        );
        expect(repaired.status).toBe('PUBLISHED');
        expect((await snapshot())[0]).toMatchObject({
          opened_store_count: '0',
          opening_rate: '12345678901234567890.12345678901234567890',
          source_batch_id: repaired.batchId,
        });
        expect(await snapshot()).toHaveLength(2);
      },
    );

    it('변경 원본은 게시하고 새 파일에 없는 과거 분기·업종 행은 보존한다', async () => {
      await importDistrictStoreStats(pool, options, loader());
      const before = await snapshot();
      const changed = [{ ...rows()[0]!, storeCount: '27', openingRate: null }];
      const published = await importDistrictStoreStats(
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
          await importDistrictStoreStats(
            pool,
            { ...options, expectedRows: 1 },
            loader(changed, 'b'.repeat(64)),
          )
        ).status,
      ).toBe('SKIPPED');
    });

    it('원본 행 수가 다르면 스테이징을 게시하지 않고 실패한다', async () => {
      await expect(
        importDistrictStoreStats(
          pool,
          { ...options, expectedRows: 211832 },
          loader(),
        ),
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
      '검증 행 수와 스테이징의 %s 행이 다르면 롤백한다',
      async (kind) => {
        await importDistrictStoreStats(pool, options, loader());
        const before = await snapshot();
        // 검증 요약은 2행인데 실제 스테이징에는 1행 또는 3행을 전달해 누락·초과를 재현합니다.
        // 같은 체크섬의 일부 행만 비교해 SKIPPED로 끝나거나 불완전한 원본을 공개하면 안 됩니다.
        await expect(
          importDistrictStoreStats(pool, options, async (path, consume) =>
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

    it.each(['district', 'industry', 'both'])(
      '없는 %s 기준 코드와 영향 행·분기를 보고하며 두 FK가 없는 행도 한 번만 센다',
      async (kind) => {
        const invalid = rows();
        if (kind !== 'industry') invalid[0]!.districtCode = '99999';
        if (kind !== 'district') invalid[0]!.industryCode = 'CS999999';
        let failure: unknown;
        try {
          await importDistrictStoreStats(pool, options, loader(invalid));
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        const message = (failure as Error).message;
        expect(message).toContain('FK');
        if (kind !== 'industry') expect(message).toContain('99999');
        if (kind !== 'district') expect(message).toContain('CS999999');
        expect(message).toContain('20261');
        expect(await snapshot()).toEqual([]);
        expect(await latestFailure()).toMatchObject({
          fetched_rows: '2',
          valid_rows: '1',
          rejected_rows: '1',
        });
      },
    );

    it('후속 Upsert 실패는 앞서 반영한 값과 출처까지 롤백한다', async () => {
      // 첫 행을 갱신한 뒤 두 번째 행에서 실패시켜 값과 출처가 함께 되돌아가는지 확인합니다.
      await importDistrictStoreStats(pool, options, loader());
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION reject_store_publish() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN IF NEW.district_code='11140' THEN RAISE EXCEPTION 'test store publication failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_store_publish BEFORE UPDATE ON district_store_stat FOR EACH ROW EXECUTE FUNCTION reject_store_publish()`);
      const changed = rows();
      changed[0]!.storeCount = '19';
      await expect(
        importDistrictStoreStats(
          pool,
          options,
          loader(changed, 'b'.repeat(64)),
        ),
      ).rejects.toThrow('test store publication failure');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        valid_rows: '2',
        rejected_rows: '0',
        published_at: null,
      });
    });

    it('정상 청크 뒤 판독 실패도 스테이징을 롤백하고 검증 진행 건수를 기록한다', async () => {
      await importDistrictStoreStats(pool, options, loader());
      const before = await snapshot();
      await expect(
        importDistrictStoreStats(pool, options, async (_path, consume) => {
          await consume([{ ...rows()[0]!, storeCount: '20' }]);
          throw new DistrictStoreSourceError('invalid source row 3', {
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

    it('54,765행을 작은 청크로 게시하며 정밀도와 누락 조합을 보존한다', async () => {
      // 실제 파일의 검증 결과와 별개인 합성 규모 테스트입니다. 55,000개 조합을 강제하지 않습니다.
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
      const bulk = Array.from({ length: 54765 }, (_, index) => {
        const quarter = index % 22;
        return {
          ...rows()[0]!,
          districtCode: String(11110 + Math.floor(index / 2200)),
          industryCode: 'CS' + String(100000 + (Math.floor(index / 22) % 100)),
          quarterCode:
            String(2021 + Math.floor(quarter / 4)) + String((quarter % 4) + 1),
        };
      });
      const result = await importDistrictStoreStats(
        pool,
        { ...options, expectedRows: 54765 },
        loader(bulk),
      );
      expect(result).toMatchObject({
        status: 'PUBLISHED',
        fetchedRows: 54765,
        validRows: 54765,
        periodFrom: '20211',
        periodTo: '20262',
      });
      expect(
        (
          await pool.query(`SELECT count(*) AS count,
        bool_and(store_count=9007199254740993 AND opening_rate=12345678901234567890.12345678901234567890) AS exact
        FROM district_store_stat`)
        ).rows[0],
      ).toEqual({ count: '54765', exact: true });
    }, 30000);

    it.each(['CSV', 'ZIP'])(
      '실제 %s 판독·검증·스테이징 경로로 소수 표기의 큰 정수를 적재한다',
      async (format) => {
        const contents = Buffer.from(
          'STDR_YYQU_CD,SIGNGU_CD,SVC_INDUTY_CD,SIMILR_INDUTY_STOR_CO,STOR_CO,FRC_STOR_CO,OPBIZ_STOR_CO,CLSBIZ_STOR_CO,OPBIZ_RT,CLSBIZ_RT\n' +
            '20262,11110,CS100010,9223372036854775807.0,0.0,,2.0,1.0,0.0000,200.1234567890123456789000',
        );
        const path = '/virtual/district-stores.' + format.toLowerCase();
        virtualFiles.set(
          path,
          format === 'ZIP' ? zipSync({ 'district.csv': contents }) : contents,
        );
        const result = await importDistrictStoreStats(pool, {
          source: path,
          expectedRows: 1,
        });
        expect(result.status).toBe('PUBLISHED');
        expect(await snapshot()).toEqual([
          expect.objectContaining({
            store_count: '9223372036854775807',
            general_store_count: '0',
            franchise_store_count: null,
            opening_rate: '0.0000',
            closure_rate: '200.1234567890123456789000',
            source_batch_id: result.batchId,
          }),
        ]);
        const reference = JSON.parse(
          (
            await pool.query(
              'SELECT source_reference FROM etl_batch WHERE batch_id=$1',
              [result.batchId],
            )
          ).rows[0].source_reference,
        );
        expect(reference).toMatchObject({ encoding: 'UTF-8' });
        if (format === 'ZIP') expect(reference.entry).toBe('district.csv');
      },
    );

    it('측정값이 전부 NULL인 원본 행도 삭제하거나 0으로 보정하지 않는다', async () => {
      const input = {
        ...rows()[0]!,
        storeCount: null,
        generalStoreCount: null,
        franchiseStoreCount: null,
        openedStoreCount: null,
        closedStoreCount: null,
        openingRate: null,
        closureRate: null,
      };
      const result = await importDistrictStoreStats(
        pool,
        { ...options, expectedRows: 1 },
        loader([input]),
      );
      expect(await snapshot()).toEqual([
        {
          district_code: input.districtCode,
          industry_code: input.industryCode,
          quarter_code: input.quarterCode,
          store_count: null,
          general_store_count: null,
          franchise_store_count: null,
          opened_store_count: null,
          closed_store_count: null,
          opening_rate: null,
          closure_rate: null,
          source_batch_id: result.batchId,
        },
      ]);
    });

    it('누락된 분기·구·업종 조합을 생성하지 않는다', async () => {
      await importDistrictStoreStats(pool, options, loader());
      expect(await snapshot()).toHaveLength(2);
      expect(
        (
          await pool.query(
            "SELECT count(*) FROM district_store_stat WHERE district_code='11110' AND industry_code='CS100001'",
          )
        ).rows[0].count,
      ).toBe('0');
      expect(
        (
          await pool.query(
            "SELECT count(*) FROM district_store_stat WHERE quarter_code='20254'",
          )
        ).rows[0].count,
      ).toBe('0');
      expect(
        (await pool.query('SELECT count(*) FROM dong_store_stat')).rows[0]
          .count,
      ).toBe('0');
    });

    it('중복 복합키는 전체 반영을 롤백하고 기존 게시본을 보존한다', async () => {
      await importDistrictStoreStats(pool, options, loader());
      const before = await snapshot();
      await expect(
        importDistrictStoreStats(
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

    it.each(['source_type', 'scope', 'published_at'])(
      '기존 게시 배치의 %s가 잘못되면 동일 체크섬도 SKIPPED로 신뢰하지 않는다',
      async (field) => {
        const first = await importDistrictStoreStats(pool, options, loader());
        if (field === 'source_type')
          await pool.query(
            "UPDATE etl_batch SET source_type='API' WHERE batch_id=$1",
            [first.batchId],
          );
        else if (field === 'scope')
          await pool.query(
            "UPDATE etl_batch SET scope_type='DISTRICT',scope_code='11110' WHERE batch_id=$1",
            [first.batchId],
          );
        else
          await pool.query(
            'UPDATE etl_batch SET published_at=NULL WHERE batch_id=$1',
            [first.batchId],
          );
        const repaired = await importDistrictStoreStats(
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

    it('게시 중 REPEATABLE READ 조회는 값과 출처의 동일 스냅샷을 유지한다', async () => {
      const first = await importDistrictStoreStats(pool, options, loader());
      const reader = await pool.connect();
      const query = `SELECT s.store_count,s.source_batch_id,b.status,b.published_at
        FROM district_store_stat s JOIN etl_batch b ON b.batch_id=s.source_batch_id
        ORDER BY s.district_code,s.industry_code,s.quarter_code`;
      try {
        await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const before = (await reader.query(query)).rows;
        const changed = rows().map((row) => ({ ...row, storeCount: '777' }));
        const next = await importDistrictStoreStats(
          pool,
          options,
          loader(changed, 'b'.repeat(64)),
        );
        expect((await reader.query(query)).rows).toEqual(before);
        expect(
          before.every(
            (row) =>
              row.source_batch_id === first.batchId &&
              row.status === 'PUBLISHED' &&
              row.published_at !== null,
          ),
        ).toBe(true);
        expect(
          (await pool.query(query)).rows.every(
            (row) =>
              row.store_count === '777' &&
              row.source_batch_id === next.batchId &&
              row.status === 'PUBLISHED' &&
              row.published_at !== null,
          ),
        ).toBe(true);
        await reader.query('COMMIT');
      } finally {
        await reader.query('ROLLBACK');
        reader.release();
      }
    });

    it('V5 미적용은 원본 판독 전에 FAILED로 기록한다', async () => {
      await pool.query('DROP TABLE district_store_stat');
      const read = vi.fn(loader());
      await expect(
        importDistrictStoreStats(pool, options, read),
      ).rejects.toThrow('Flyway V5');
      expect(read).not.toHaveBeenCalled();
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '0',
        published_at: null,
      });
    });

    it.each([
      ['store_count', '-1'],
      ['general_store_count', '-1'],
      ['franchise_store_count', '-1'],
      ['opened_store_count', '-1'],
      ['closed_store_count', '-1'],
      ['opening_rate', '-1'],
      ['closure_rate', '-1'],
      ['opening_rate', 'NaN'],
      ['closure_rate', 'NaN'],
      ['opening_rate', 'Infinity'],
      ['closure_rate', 'Infinity'],
      ['opening_rate', '-Infinity'],
      ['closure_rate', '-Infinity'],
    ])('V5는 %s=%s를 DB에서도 거부한다', async (column, value) => {
      await expect(
        pool.query(
          `INSERT INTO district_store_stat
        (district_code,industry_code,quarter_code,source_batch_id,${column}) VALUES ('11110','CS100010','20262',$1,$2)`,
          [seedBatchId, value],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it.each([
      ['district_code', '１１１１０'],
      ['industry_code', 'cs100010'],
      ['quarter_code', '20260'],
      ['quarter_code', '２０２６１'],
    ])(
      'V5는 %s의 잘못된 코드 %s를 DB에서도 거부한다',
      async (column, value) => {
        const key = {
          district_code: '11110',
          industry_code: 'CS100010',
          quarter_code: '20262',
          [column]: value,
        };
        await expect(
          pool.query(
            `INSERT INTO district_store_stat
        (district_code,industry_code,quarter_code,source_batch_id) VALUES ($1,$2,$3,$4)`,
            [
              key.district_code,
              key.industry_code,
              key.quarter_code,
              seedBatchId,
            ],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      },
    );

    it.each(['district', 'industry', 'batch'])(
      'V5는 없는 %s 외래키를 DB에서도 거부한다',
      async (kind) => {
        await expect(
          pool.query(
            `INSERT INTO district_store_stat
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

    it('동시 동일 원본 실행은 한 번만 게시하고 나머지는 SKIPPED로 기록한다', async () => {
      const result = await Promise.all([
        importDistrictStoreStats(pool, options, loader()),
        importDistrictStoreStats(pool, options, loader()),
      ]);
      expect(result.map((item) => item.status).sort()).toEqual([
        'PUBLISHED',
        'SKIPPED',
      ]);
      expect(await snapshot()).toHaveLength(2);
    });

    it('없는 원본은 FAILED로 기록하며 기준 데이터를 변경하지 않는다', async () => {
      await expect(
        importDistrictStoreStats(pool, {
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
        (await pool.query('SELECT count(*) FROM district')).rows[0].count,
      ).toBe('2');
      expect(
        (await pool.query('SELECT count(*) FROM service_industry')).rows[0]
          .count,
      ).toBe('2');
    });
  },
);
