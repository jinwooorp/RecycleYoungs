import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBoundaries } from './boundaries.js';
import { BoundarySourceError, type BoundarySource } from './boundary-source.js';
import { createDatabasePool } from './database.js';

// 명시적으로 실행할 때만 새 일회용 PostGIS 컨테이너를 생성합니다.
// 합성 데이터는 이 컨테이너에만 사용하며 실제 로컬 개발 DB는 건드리지 않습니다.
describe.runIf(process.env.RUN_BOUNDARY_DB_TESTS === '1')(
  'PostGIS boundary import',
  () => {
    let container: string | undefined;
    let admin: Pool;
    let pool: Pool;
    let databaseUrl: string;
    const pools: Pool[] = [];
    const options = {
      source: 'synthetic-test.shp',
      expectedDongs: 3,
      expectedDistricts: 2,
    };
    const rectangle = (x: number, y: number) => [
      [x, y],
      [x + 100, y],
      [x + 100, y + 100],
      [x, y + 100],
      [x, y],
    ];
    function source(): BoundarySource {
      return {
        checksum: 'a'.repeat(64),
        features: [
          {
            dongCode: '11110515',
            dongName: '테스트동1',
            areaM2: '10000',
            geometry: {
              type: 'Polygon',
              coordinates: [
                rectangle(195000, 450000),
                rectangle(195040, 450040)
                  .map(([x, y]) => [
                    195040 + (x! - 195040) / 5,
                    450040 + (y! - 450040) / 5,
                  ])
                  .reverse(),
              ],
            },
          },
          {
            dongCode: '11110530',
            dongName: '테스트동2',
            areaM2: '10000',
            geometry: {
              type: 'Polygon',
              coordinates: [rectangle(195100, 450000)],
            },
          },
          {
            dongCode: '11500603',
            dongName: '테스트동3',
            areaM2: '10000',
            geometry: {
              type: 'Polygon',
              coordinates: [rectangle(190000, 445000)],
            },
          },
        ],
      };
    }
    const snapshot = async () =>
      (
        await pool.query(
          `SELECT 'district:'||to_jsonb(d)::text AS value FROM district d
     UNION ALL SELECT 'dong:'||to_jsonb(a)::text FROM administrative_dong a ORDER BY value`,
        )
      ).rows;
    const latestFailure = async () =>
      (
        await pool.query(
          `SELECT status,fetched_rows,valid_rows,rejected_rows,error_message,published_at
     FROM etl_batch WHERE status='FAILED' ORDER BY started_at DESC LIMIT 1`,
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
          'POSTGRES_PASSWORD=boundary_test',
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
      databaseUrl = `postgresql://postgres:boundary_test@127.0.0.1:${port}/postgres`;
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
      const schema = `boundary_test_${randomUUID().replaceAll('-', '')}`;
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

    it('publishes 4326 multipolygons, district unions, interior points and original areas', async () => {
      const result = await importBoundaries(pool, options, async () =>
        source(),
      );
      expect(result).toMatchObject({
        status: 'PUBLISHED',
        fetchedRows: 3,
        validRows: 3,
        rejectedRows: 0,
        districts: 2,
      });
      expect(
        (
          await pool.query(`SELECT district_code,district_name,ST_SRID(geom) AS srid,
      GeometryType(geom) AS type,ST_IsValid(geom) AS valid FROM district ORDER BY district_code`)
        ).rows,
      ).toEqual([
        {
          district_code: '11110',
          district_name: '종로구',
          srid: 4326,
          type: 'MULTIPOLYGON',
          valid: true,
        },
        {
          district_code: '11500',
          district_name: '강서구',
          srid: 4326,
          type: 'MULTIPOLYGON',
          valid: true,
        },
      ]);
      expect(
        (
          await pool.query(`SELECT bool_and(ST_SRID(geom)=4326 AND ST_SRID(label_point)=4326
      AND ST_IsValid(geom) AND GeometryType(geom)='MULTIPOLYGON'
      AND ST_Contains(geom,label_point) AND area_m2=10000) AS valid FROM administrative_dong`)
        ).rows[0].valid,
      ).toBe(true);
      expect(
        (
          await pool.query(`SELECT bool_and(ST_CoveredBy(a.geom,d.geom)) AS covered
      FROM administrative_dong a JOIN district d USING(district_code)`)
        ).rows[0].covered,
      ).toBe(true);
    });

    it('skips the same source without changing data or provenance', async () => {
      await importBoundaries(pool, options, async () => source());
      const before = await snapshot();
      expect(
        (await importBoundaries(pool, options, async () => source())).status,
      ).toBe('SKIPPED');
      expect(await snapshot()).toEqual(before);
      expect(
        (
          await pool.query(`SELECT status,source_type,scope_type,expected_rows,
      fetched_rows,valid_rows,rejected_rows FROM etl_batch ORDER BY started_at`)
        ).rows,
      ).toEqual(
        ['PUBLISHED', 'SKIPPED'].map((status) => ({
          status,
          source_type: 'SHAPEFILE',
          scope_type: 'SEOUL',
          expected_rows: '3',
          fetched_rows: '3',
          valid_rows: '3',
          rejected_rows: '0',
        })),
      );
    });

    it('dissolves the published dong geometries in their stored coordinate system', async () => {
      const data = source();
      data.features[1]!.geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [195030, 449977],
            [195147, 450043],
            [195070, 450152],
            [195030, 449977],
          ],
        ],
      };
      await importBoundaries(pool, options, async () => data);
      expect(
        (
          await pool.query(`WITH combined AS (
      SELECT district_code,ST_UnaryUnion(ST_Collect(geom)) AS geom
      FROM administrative_dong GROUP BY district_code)
      SELECT bool_and(ST_Equals(d.geom,c.geom)) AS equal
      FROM district d JOIN combined c USING(district_code)`)
        ).rows[0].equal,
      ).toBe(true);
    });

    it('rolls back invalid spatial data while keeping failure counts', async () => {
      await importBoundaries(pool, options, async () => source());
      const before = await snapshot();
      const invalid = source();
      invalid.features[0]!.geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [195000, 450000],
            [195100, 450100],
            [195100, 450000],
            [195000, 450100],
            [195000, 450000],
          ],
        ],
      };
      await expect(
        importBoundaries(pool, options, async () => invalid),
      ).rejects.toThrow('유효하지 않은 원본');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '3',
        valid_rows: '2',
        rejected_rows: '1',
        published_at: null,
      });
    });

    it('rolls back district and dong updates together when publication fails', async () => {
      await importBoundaries(pool, options, async () => source());
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION reject_test_publish() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'test publication failure'; END $$;
      CREATE TRIGGER reject_test_publish BEFORE UPDATE ON administrative_dong
      FOR EACH ROW EXECUTE FUNCTION reject_test_publish()`);
      const changed = source();
      changed.features[0]!.dongName = '변경된테스트동';
      await expect(
        importBoundaries(pool, options, async () => changed),
      ).rejects.toThrow('test publication failure');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        valid_rows: '3',
        published_at: null,
      });
    });

    it('does not delete existing regions missing from a new input', async () => {
      await importBoundaries(pool, options, async () => source());
      const before = await snapshot();
      const smaller = source();
      smaller.features.pop();
      await expect(
        importBoundaries(
          pool,
          { ...options, expectedDongs: 2, expectedDistricts: 1 },
          async () => smaller,
        ),
      ).rejects.toThrow('원본에 없는 기존');
      expect(await snapshot()).toEqual(before);
    });

    it('records source validation errors separately from the data transaction', async () => {
      await expect(
        importBoundaries(pool, options, async () => {
          throw new BoundarySourceError('duplicate dong code', {
            fetchedRows: 3,
            validRows: 1,
            rejectedRows: 1,
            checksum: 'b'.repeat(64),
          });
        }),
      ).rejects.toThrow('duplicate dong code');
      expect(await latestFailure()).toMatchObject({
        fetched_rows: '3',
        valid_rows: '1',
        rejected_rows: '1',
      });
      expect(await snapshot()).toEqual([]);
    });

    it('rejects wrong expected counts and unrecognized district codes', async () => {
      await expect(
        importBoundaries(pool, { ...options, expectedDongs: 425 }, async () =>
          source(),
        ),
      ).rejects.toThrow('CLI 검증 기준');
      const invalid = source();
      invalid.features[0]!.dongCode = '11999101';
      await expect(
        importBoundaries(pool, options, async () => invalid),
      ).rejects.toThrow('공식 서울 자치구');
      expect(await snapshot()).toEqual([]);
    });

    it('rejects geographic coordinates mislabeled as EPSG:5181', async () => {
      const invalid = source();
      invalid.features[0]!.geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [127, 37],
            [127.01, 37],
            [127.01, 37.01],
            [127, 37.01],
            [127, 37],
          ],
        ],
      };
      await expect(
        importBoundaries(pool, options, async () => invalid),
      ).rejects.toThrow('좌표 범위 검증 실패');
      expect(await snapshot()).toEqual([]);
    });

    it('serializes concurrent reruns of the same source', async () => {
      const results = await Promise.all([
        importBoundaries(pool, options, async () => source()),
        importBoundaries(pool, options, async () => source()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        'PUBLISHED',
        'SKIPPED',
      ]);
      expect(
        (await pool.query('SELECT count(*) FROM administrative_dong')).rows[0]
          .count,
      ).toBe('3');
    });

    it('records a missing input file as a failed batch', async () => {
      await expect(
        importBoundaries(pool, {
          ...options,
          source: '/missing-boundary-input.shp',
        }),
      ).rejects.toThrow();
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '0',
        published_at: null,
      });
    });
  },
);
