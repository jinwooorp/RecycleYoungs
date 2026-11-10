import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { parse as parseCsv } from 'csv-parse/sync';
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
import { importDistrictFootTrafficStats } from './district-foot-traffic.js';
import {
  DistrictFootTrafficSourceError,
  type DistrictFootTrafficSource,
  type DistrictFootTrafficStatRow,
} from './district-foot-traffic-source.js';
import { createDatabasePool } from '../../common/database.js';

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
describe.runIf(process.env.RUN_DISTRICT_FOOT_TRAFFIC_DB_TESTS === '1')(
  '자치구 길단위인구 통계 격리 DB 적재',
  () => {
    let container: string | undefined;
    let admin: Pool;
    let pool: Pool;
    let databaseUrl: string;
    let seedBatchId: string;
    const pools: Pool[] = [];
    const options = {
      source: 'synthetic-district-foot-traffic.csv',
      expectedRows: 2,
    };
    const rows = (): DistrictFootTrafficStatRow[] => [
      {
        districtCode: '11110',
        quarterCode: '20261',
        totalFootTraffic: '9007199254740993.12345678901234567890123456789',
        maleFootTraffic: '2.0000000000000000000000000000100',
        femaleFootTraffic: '9223372036854775807.98765432109876543210987654321',
      },
      {
        districtCode: '11140',
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
        consume: (batch: DistrictFootTrafficStatRow[]) => Promise<void>,
      ): Promise<DistrictFootTrafficSource> => {
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
          entry: 'synthetic-district-foot-traffic.csv',
          encoding: 'UTF-8',
        };
      };
    const snapshot = async () =>
      (
        await pool.query(
          'SELECT * FROM district_foot_traffic_stat ORDER BY district_code,quarter_code',
        )
      ).rows;
    const latestFailure = async () =>
      (
        await pool.query(
          "SELECT * FROM etl_batch WHERE dataset_code='SEOUL_DISTRICT_FOOT_TRAFFIC_STAT' AND status='FAILED' ORDER BY started_at DESC LIMIT 1",
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
          'POSTGRES_PASSWORD=district_foot_traffic_test',
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
      databaseUrl = `postgresql://postgres:district_foot_traffic_test@127.0.0.1:${port}/postgres`;
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
      const schema = `district_foot_traffic_test_${randomUUID().replaceAll('-', '')}`;
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
        'V7__create_district_foot_traffic_stat.sql',
      ]) {
        await pool.query(
          await readFile(
            new URL(
              '../../../../backend/src/main/resources/db/migration/' + file,
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
    });

    afterAll(async () => {
      await Promise.all(pools.map((item) => item.end()));
      if (admin) await admin.end();
      if (container)
        execFileSync('docker', ['stop', container], { stdio: 'pipe' });
    }, 30000);

    it('publishes exact NUMERIC values, NULL, zero and source metadata without forcing sums', async () => {
      // 큰 정수부와 긴 소수부를 보존하고 남성·여성 합계가 전체와 달라도 원본 의미를 유지합니다.
      const result = await importDistrictFootTrafficStats(
        pool,
        options,
        loader(),
      );
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
          quarter_code: '20261',
          total_foot_traffic: '9007199254740993.12345678901234567890123456789',
          male_foot_traffic: '2.0000000000000000000000000000100',
          female_foot_traffic:
            '9223372036854775807.98765432109876543210987654321',
          source_batch_id: result.batchId,
        },
        {
          district_code: '11140',
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
        dataset_code: 'SEOUL_DISTRICT_FOOT_TRAFFIC_STAT',
        etl_version: 'district-foot-traffic-stat-v1',
        source_type: 'CSV',
        scope_code: null,
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
        entry: 'synthetic-district-foot-traffic.csv',
        encoding: 'UTF-8',
      });
    });

    it('skips unchanged source while preserving every value and published reference', async () => {
      await importDistrictFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      const skipped = await importDistrictFootTrafficStats(
        pool,
        options,
        loader(),
      );
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
      'scale',
      'provenance',
      'missing row',
    ])(
      'republishes identical source if actual DB %s differs',
      async (change) => {
        await importDistrictFootTrafficStats(pool, options, loader());
        if (change === 'provenance')
          await pool.query(
            'UPDATE district_foot_traffic_stat SET source_batch_id=$1',
            [seedBatchId],
          );
        else if (change === 'missing row')
          await pool.query(
            "DELETE FROM district_foot_traffic_stat WHERE district_code='11110'",
          );
        else if (change === 'scale')
          await pool.query(
            "UPDATE district_foot_traffic_stat SET female_foot_traffic=0.000 WHERE district_code='11140'",
          );
        else if (change === 'nullable zero')
          await pool.query(
            "UPDATE district_foot_traffic_stat SET male_foot_traffic=0 WHERE district_code='11140'",
          );
        else if (change === 'zero to null')
          await pool.query(
            "UPDATE district_foot_traffic_stat SET total_foot_traffic=NULL WHERE district_code='11140'",
          );
        else
          await pool.query(
            `UPDATE district_foot_traffic_stat SET ${change}=NULL WHERE district_code='11110'`,
          );
        const repaired = await importDistrictFootTrafficStats(
          pool,
          options,
          loader(),
        );
        expect(repaired.status).toBe('PUBLISHED');
        expect(await snapshot()).toEqual([
          {
            district_code: '11110',
            quarter_code: '20261',
            total_foot_traffic:
              '9007199254740993.12345678901234567890123456789',
            male_foot_traffic: '2.0000000000000000000000000000100',
            female_foot_traffic:
              '9223372036854775807.98765432109876543210987654321',
            source_batch_id: repaired.batchId,
          },
          {
            district_code: '11140',
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
      await importDistrictFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      const changed = [
        { ...rows()[0]!, totalFootTraffic: '27', maleFootTraffic: null },
      ];
      const published = await importDistrictFootTrafficStats(
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
          await importDistrictFootTrafficStats(
            pool,
            { ...options, expectedRows: 1 },
            loader(changed, 'b'.repeat(64)),
          )
        ).status,
      ).toBe('SKIPPED');
    });

    it('rejects an expected row count mismatch and preserves validated counts in FAILED', async () => {
      await expect(
        importDistrictFootTrafficStats(
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
        await importDistrictFootTrafficStats(pool, options, loader());
        const before = await snapshot();
        // 원본 요약은 2행인데 실제 staging이 1행 또는 3행이면 SKIPPED나 PUBLISHED가 되어서는 안 됩니다.
        await expect(
          importDistrictFootTrafficStats(pool, options, async (path, consume) =>
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

    it('reports missing district FKs with source location and affected row counts', async () => {
      await importDistrictFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      const invalid = [
        rows()[0]!,
        { ...rows()[1]!, districtCode: '99999' },
        { ...rows()[1]!, districtCode: '99999', quarterCode: '20263' },
      ];
      let failure: unknown;
      try {
        await importDistrictFootTrafficStats(
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
      expect(message).toContain('99999');
      expect(message).toContain('20262');
      expect(message).toContain('20263');
      expect(message).toContain('"rows":"2"');
      expect(message).toContain('"first_record":"2"');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        fetched_rows: '3',
        valid_rows: '1',
        rejected_rows: '2',
      });
    });

    it('rolls back earlier updates if a later Upsert row fails', async () => {
      // 첫 유동인구 갱신 후 다른 행에서 실패해도 값과 출처를 모두 이전 상태로 보존해야 합니다.
      await importDistrictFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION reject_foot_traffic_publish() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN IF NEW.district_code='11140' THEN RAISE EXCEPTION 'test foot_traffic publication failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_foot_traffic_publish BEFORE UPDATE ON district_foot_traffic_stat FOR EACH ROW EXECUTE FUNCTION reject_foot_traffic_publish()`);
      const changed = rows();
      changed[0]!.totalFootTraffic = '19';
      await expect(
        importDistrictFootTrafficStats(
          pool,
          options,
          loader(changed, 'b'.repeat(64)),
        ),
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
      await importDistrictFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      await expect(
        importDistrictFootTrafficStats(
          pool,
          options,
          async (_path, consume) => {
            await consume([{ ...rows()[0]!, totalFootTraffic: '20' }]);
            throw new DistrictFootTrafficSourceError(
              'invalid foot_traffic row 3',
              {
                fetchedRows: 2,
                validRows: 1,
                rejectedRows: 1,
                checksum: 'c'.repeat(64),
                periodFrom: '20261',
                periodTo: '20261',
              },
            );
          },
        ),
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
      const result = await importDistrictFootTrafficStats(
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
        FROM district_foot_traffic_stat`)
        ).rows[0],
      ).toEqual({ count: '2501', exact: true });
    });

    it('serializes concurrent reruns so only one batch publishes', async () => {
      const results = await Promise.all([
        importDistrictFootTrafficStats(pool, options, loader()),
        importDistrictFootTrafficStats(pool, options, loader()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        'PUBLISHED',
        'SKIPPED',
      ]);
      expect(await snapshot()).toHaveLength(2);
    });

    it('records missing V7 as FAILED before reading the source', async () => {
      // 이 테스트 전용 스키마에서만 V7 대상 테이블을 제거해 사전 점검의 실패를 재현합니다.
      await pool.query('DROP TABLE district_foot_traffic_stat');
      await expect(
        importDistrictFootTrafficStats(pool, options, async () => {
          throw new Error('source reader must not run before V7 preflight');
        }),
      ).rejects.toThrow('Flyway V7');
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '0',
        valid_rows: '0',
        rejected_rows: '0',
        published_at: null,
      });
      expect(
        (await pool.query('SELECT count(*) FROM district')).rows[0].count,
      ).toBe('2');
    });

    it('records a missing source as FAILED without modifying reference data', async () => {
      await expect(
        importDistrictFootTrafficStats(pool, {
          ...options,
          source: '/missing-district-foot-traffic-input.csv',
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
    });

    it.each(['CSV', 'ZIP'])(
      '실제 %s 판독부터 NUMERIC 소수 자릿수·지수·NULL·0을 보존한다',
      async (format) => {
        const contents = Buffer.from(
          'STDR_YYQU_CD,SIGNGU_CD,TOT_FLPOP_CO,ML_FLPOP_CO,FML_FLPOP_CO\n' +
            '20262,11110,9.00719925474099312300e15,2.0000000000000000000000100,0.0000\n' +
            '20261,11140,,0,1e-30',
        );
        const source = '/virtual/district-foot-traffic.' + format.toLowerCase();
        virtualFiles.set(
          source,
          format === 'ZIP' ? zipSync({ 'district.csv': contents }) : contents,
        );
        const result = await importDistrictFootTrafficStats(pool, {
          source,
          expectedRows: 2,
        });
        expect(result.status).toBe('PUBLISHED');
        expect(await snapshot()).toEqual([
          {
            district_code: '11110',
            quarter_code: '20262',
            total_foot_traffic: '9007199254740993.12300',
            male_foot_traffic: '2.0000000000000000000000100',
            female_foot_traffic: '0.0000',
            source_batch_id: result.batchId,
          },
          {
            district_code: '11140',
            quarter_code: '20261',
            total_foot_traffic: null,
            male_foot_traffic: '0',
            female_foot_traffic: '0.' + '0'.repeat(29) + '1',
            source_batch_id: result.batchId,
          },
        ]);
        const batch = (
          await pool.query(
            'SELECT source_reference,source_checksum FROM etl_batch WHERE batch_id=$1',
            [result.batchId],
          )
        ).rows[0];
        expect(batch.source_checksum).toBe(
          createHash('sha256').update(contents).digest('hex'),
        );
        expect(JSON.parse(batch.source_reference)).toMatchObject({
          encoding: 'UTF-8',
        });
        if (format === 'ZIP')
          expect(JSON.parse(batch.source_reference).entry).toBe('district.csv');
      },
    );

    it('측정값이 모두 NULL인 행도 게시하고 없는 구·분기 조합을 생성하지 않는다', async () => {
      const result = await importDistrictFootTrafficStats(
        pool,
        { ...options, expectedRows: 1 },
        loader([
          {
            ...rows()[0]!,
            totalFootTraffic: null,
            maleFootTraffic: null,
            femaleFootTraffic: null,
          },
        ]),
      );
      expect(await snapshot()).toEqual([
        {
          district_code: '11110',
          quarter_code: '20261',
          total_foot_traffic: null,
          male_foot_traffic: null,
          female_foot_traffic: null,
          source_batch_id: result.batchId,
        },
      ]);
      expect(
        (await pool.query('SELECT count(*) FROM dong_foot_traffic_stat'))
          .rows[0].count,
      ).toBe('0');
    });

    it('복합키 중복은 앞선 staging을 롤백하고 기존 데이터·출처를 보존한다', async () => {
      await importDistrictFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      await expect(
        importDistrictFootTrafficStats(
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

    it.each([
      ['source_type', "source_type='API'"],
      ['scope_type', "scope_type='DISTRICT',scope_code='11110'"],
      ['published_at', 'published_at=NULL'],
      ['checksum', "source_checksum='" + 'b'.repeat(64) + "'"],
      ['version', "etl_version='district-foot-traffic-stat-other'"],
      ['dataset', "dataset_code='SEOUL_DONG_FOOT_TRAFFIC_STAT'"],
      ['SKIPPED', "status='SKIPPED',published_at=NULL"],
      ['FAILED', "status='FAILED',published_at=NULL"],
      ['RUNNING', "status='RUNNING',published_at=NULL"],
    ])(
      '기존 배치의 %s가 정상 출처와 다르면 동일 파일도 다시 게시한다',
      async (_field, update) => {
        const first = await importDistrictFootTrafficStats(
          pool,
          options,
          loader(),
        );
        await pool.query(`UPDATE etl_batch SET ${update} WHERE batch_id=$1`, [
          first.batchId,
        ]);
        const repaired = await importDistrictFootTrafficStats(
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

    it.each(['total_foot_traffic', 'male_foot_traffic', 'female_foot_traffic'])(
      'V7는 %s의 음수·NaN·양음 무한대를 거부한다',
      async (column) => {
        for (const value of ['-1', 'NaN', 'Infinity', '-Infinity']) {
          await expect(
            pool.query(
              `INSERT INTO district_foot_traffic_stat
            (district_code,quarter_code,source_batch_id,${column}) VALUES ('11110','20262',$1,$2::numeric)`,
              [seedBatchId, value],
            ),
          ).rejects.toMatchObject({ code: '23514' });
        }
      },
    );

    it.each([
      ['district_code', '１１１１０'],
      ['district_code', '1111'],
      ['quarter_code', '20260'],
      ['quarter_code', '２０２６１'],
    ])('V7는 잘못된 %s 코드 %s를 거부한다', async (column, value) => {
      const key = {
        district_code: '11110',
        quarter_code: '20262',
        [column]: value,
      };
      await expect(
        pool.query(
          `INSERT INTO district_foot_traffic_stat
        (district_code,quarter_code,source_batch_id) VALUES ($1,$2,$3)`,
          [key.district_code, key.quarter_code, seedBatchId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it.each(['district', 'batch'])(
      'V7는 없는 %s FK를 거부한다',
      async (kind) => {
        await expect(
          pool.query(
            `INSERT INTO district_foot_traffic_stat
        (district_code,quarter_code,source_batch_id) VALUES ($1,'20262',$2)`,
            [
              kind === 'district' ? '99999' : '11110',
              kind === 'batch' ? randomUUID() : seedBatchId,
            ],
          ),
        ).rejects.toMatchObject({ code: '23503' });
      },
    );

    it('V7는 소수 정밀도·기본값·불필요한 차원을 추가하지 않는다', async () => {
      const columns = (
        await pool.query(`SELECT column_name,data_type,column_default,numeric_precision,numeric_scale,is_nullable
        FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='district_foot_traffic_stat' ORDER BY ordinal_position`)
      ).rows;
      expect(columns.map((row) => row.column_name)).toEqual([
        'district_code',
        'quarter_code',
        'total_foot_traffic',
        'male_foot_traffic',
        'female_foot_traffic',
        'source_batch_id',
      ]);
      for (const column of columns.slice(2, 5))
        expect(column).toMatchObject({
          data_type: 'numeric',
          column_default: null,
          numeric_precision: null,
          numeric_scale: null,
          is_nullable: 'YES',
        });
      expect(columns.at(-1)).toMatchObject({ is_nullable: 'NO' });
    });

    it('배치 PUBLISHED 기록 실패도 Upsert와 함께 롤백한다', async () => {
      await importDistrictFootTrafficStats(pool, options, loader());
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION reject_batch_publish() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN IF NEW.dataset_code='SEOUL_DISTRICT_FOOT_TRAFFIC_STAT' AND NEW.status='PUBLISHED'
        THEN RAISE EXCEPTION 'test batch publication failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_batch_publish BEFORE UPDATE ON etl_batch FOR EACH ROW EXECUTE FUNCTION reject_batch_publish()`);
      const changed = rows();
      changed[0]!.totalFootTraffic = '19';
      await expect(
        importDistrictFootTrafficStats(
          pool,
          options,
          loader(changed, 'b'.repeat(64)),
        ),
      ).rejects.toThrow('test batch publication failure');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        published_at: null,
      });
    });

    it('서로 다른 동시 게시도 두 행의 값과 출처가 한 배치로 일치한다', async () => {
      const changed = rows().map((row) => ({ ...row, totalFootTraffic: '17' }));
      const results = await Promise.all([
        importDistrictFootTrafficStats(pool, options, loader()),
        importDistrictFootTrafficStats(
          pool,
          options,
          loader(changed, 'b'.repeat(64)),
        ),
      ]);
      expect(results.map((result) => result.status)).toEqual([
        'PUBLISHED',
        'PUBLISHED',
      ]);
      const actual = await snapshot();
      expect(new Set(actual.map((row) => row.source_batch_id)).size).toBe(1);
      const winner = results.find(
        (result) => result.batchId === actual[0].source_batch_id,
      )!;
      expect(winner).toBeDefined();
      const initialWon = winner.batchId === results[0]!.batchId;
      expect(actual.map((row) => row.total_foot_traffic)).toEqual(
        initialWon
          ? [rows()[0]!.totalFootTraffic, rows()[1]!.totalFootTraffic]
          : ['17', '17'],
      );
    });

    it('실제 CLI의 probe 생략은 자치구 인구를 적재하고 재실행은 SKIPPED로 기록한다', async () => {
      // 메모리 파일만 주입하고 CLI 인자 파싱·DB 분기·적재는 일회용 DB에서 그대로 실행합니다.
      const csv =
        'STDR_YYQU_CD,SIGNGU_CD,TOT_FLPOP_CO,ML_FLPOP_CO,FML_FLPOP_CO\n20262,11110,9007199254740993.1200,,0.000';
      const preload = `
        import fs from 'node:fs/promises';
        import { syncBuiltinESMExports } from 'node:module';
        const original = fs.readFile;
        fs.readFile = async (path, ...args) => String(path) === '/virtual/cli-foot.csv'
          ? Buffer.from(${JSON.stringify(csv)}) : original(path, ...args);
        syncBuiltinESMExports();
      `;
      const run = () =>
        JSON.parse(
          execFileSync(
            process.execPath,
            [
              '--import',
              'data:text/javascript,' + encodeURIComponent(preload),
              '--import',
              'tsx',
              'src/index.ts',
              'district-foot-traffic',
              '--source',
              '/virtual/cli-foot.csv',
              '--expected-rows',
              '1',
            ],
            {
              encoding: 'utf8',
              env: {
                ...process.env,
                DATABASE_URL: pool.options.connectionString,
              },
            },
          ),
        );
      const first = run();
      expect(first).toMatchObject({
        status: 'PUBLISHED',
        fetchedRows: 1,
        validRows: 1,
      });
      const stored = await snapshot();
      expect(stored).toEqual([
        {
          district_code: '11110',
          quarter_code: '20262',
          total_foot_traffic: '9007199254740993.1200',
          male_foot_traffic: null,
          female_foot_traffic: '0.000',
          source_batch_id: first.batchId,
        },
      ]);
      expect(run().status).toBe('SKIPPED');
      expect(await snapshot()).toEqual(stored);
    });

    it.runIf(Boolean(process.env.DISTRICT_FOOT_TRAFFIC_REAL_CSV))(
      '공식 CP949 CSV 550행·1650개 측정값을 전수 비교하고 재실행 출처를 보존한다',
      async () => {
        // 원본은 읽기 전용이며 기준 자치구는 이 일회용 테스트 스키마에서만 합성합니다.
        const source = process.env.DISTRICT_FOOT_TRAFFIC_REAL_CSV!;
        const bytes = await readFile(source);
        const expectedChecksum =
          'b29fbba82196f94eff890782e904d55b50fb1de6e0a5907fffa432a9e042a4fb';
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          expectedChecksum,
        );
        const original = parseCsv(
          new TextDecoder('euc-kr', { fatal: true }).decode(bytes),
          { columns: true },
        ) as Record<string, string>[];
        expect(original).toHaveLength(550);
        expect(Object.keys(original[0]!)).toHaveLength(25);
        const districts = [
          ...new Set(original.map((row) => row['자치구_코드']!)),
        ].sort();
        const quarters = [
          ...new Set(original.map((row) => row['기준_년분기_코드']!)),
        ].sort();
        expect(districts).toHaveLength(25);
        expect(quarters).toHaveLength(22);
        expect([quarters[0], quarters.at(-1)]).toEqual(['20211', '20262']);
        const expected = new Map(
          original.map((row) => [
            row['자치구_코드'] + ':' + row['기준_년분기_코드'],
            [
              row['총_유동인구_수']!,
              row['남성_유동인구_수']!,
              row['여성_유동인구_수']!,
            ],
          ]),
        );
        expect(expected.size).toBe(550);
        for (const code of districts)
          await pool.query(
            `INSERT INTO district (district_code,district_name,geom,boundary_batch_id)
          SELECT $1,'공식 원본 테스트구',geom,$2 FROM district WHERE district_code='11110' ON CONFLICT DO NOTHING`,
            [code, seedBatchId],
          );
        const result = await importDistrictFootTrafficStats(pool, {
          source,
          expectedRows: 550,
        });
        expect(result).toMatchObject({
          status: 'PUBLISHED',
          fetchedRows: 550,
          validRows: 550,
          rejectedRows: 0,
          periodFrom: '20211',
          periodTo: '20262',
        });
        const actual = await snapshot();
        expect(actual).toHaveLength(550);
        let compared = 0;
        let differingSums = 0;
        const differences: bigint[] = [];
        for (const row of actual) {
          const raw = expected.get(row.district_code + ':' + row.quarter_code)!;
          expect(raw).toBeDefined();
          for (const [index, field] of [
            'total_foot_traffic',
            'male_foot_traffic',
            'female_foot_traffic',
          ].entries()) {
            expect(row[field]).toBe(raw[index]);
            compared += 1;
          }
          expect(row.source_batch_id).toBe(result.batchId);
          const difference =
            BigInt(row.total_foot_traffic) -
            BigInt(row.male_foot_traffic) -
            BigInt(row.female_foot_traffic);
          if (difference !== 0n) differingSums += 1;
          differences.push(difference);
        }
        expect(compared).toBe(1650);
        expect(differingSums).toBe(269);
        expect(differences.reduce((a, b) => (a < b ? a : b))).toBe(-3n);
        expect(differences.reduce((a, b) => (a > b ? a : b))).toBe(3n);
        const skipped = await importDistrictFootTrafficStats(pool, {
          source,
          expectedRows: 550,
        });
        expect(skipped.status).toBe('SKIPPED');
        expect(await snapshot()).toEqual(actual);
        expect(
          (
            await pool.query(
              'SELECT source_checksum FROM etl_batch WHERE batch_id=$1',
              [result.batchId],
            )
          ).rows[0].source_checksum,
        ).toBe(expectedChecksum);
      },
      30000,
    );
  },
);
