import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
import { importCafes } from './cafes.js';
import type { CafeOptions, CafeRow, CafeSource } from './cafe-source.js';
import { createDatabasePool } from './database.js';

// 합성 응답과 새 PostGIS 컨테이너만 사용하며 실제 API·개발 DB에는 연결하지 않습니다.
describe.runIf(process.env.RUN_CAFE_DB_TESTS === '1')('cafe import', () => {
  let container: string | undefined;
  let admin: Pool;
  let pool: Pool;
  let databaseUrl: string;
  let seedBatchId: string;
  const pools: Pool[] = [];
  const options: CafeOptions = {
    industryCode: 'I21201',
    industryName: '커피전문점',
    expectedRows: 2,
  };
  const rows = (): CafeRow[] => [
    {
      bizesId: 'opaque-001',
      storeName: '첫 번째 카페',
      branchName: '테스트점',
      semasIndustryCode: 'I21201',
      semasIndustryName: '커피전문점',
      ksicCode: 'I56221',
      ksicName: '커피 전문점',
      sourceDongCode: '11110515',
      sourceDistrictCode: '11110',
      roadAddress: '서울특별시 테스트 도로',
      lotAddress: null,
      longitude: 127,
      latitude: 37.6,
    },
    {
      bizesId: 'opaque-002',
      storeName: '두 번째 카페',
      branchName: null,
      semasIndustryCode: 'I21201',
      semasIndustryName: '커피전문점',
      ksicCode: null,
      ksicName: null,
      sourceDongCode: '11110530',
      sourceDistrictCode: '11110',
      roadAddress: null,
      lotAddress: '서울특별시 테스트 지번',
      longitude: null,
      latitude: null,
    },
  ];
  const reference = () => ({
    endpoint: 'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong',
    collection_mode: 'FULL_SEOUL',
    complete: true,
    classification_verified: true,
    stdrYm: '202610',
    query: { divId: 'ctprvnCd', key: '11', indsSclsCd: 'I21201' },
    industry_code: 'I21201',
    industry_name: '커피전문점',
    pages: 1,
    total_count: 2,
  });
  // 네트워크 판독만 대체하며 staging·공간 연산·Upsert·감사 이력은 실제 DB로 검증합니다.
  const loader =
    (
      input = rows(),
      checksum = 'a'.repeat(64),
      metadata: Record<string, unknown> = {},
    ) =>
    async (
      _options: CafeOptions,
      consume: (batch: CafeRow[]) => Promise<void>,
    ): Promise<CafeSource> => {
      for (let offset = 0; offset < input.length; offset += 1000)
        await consume(input.slice(offset, offset + 1000));
      return {
        checksum,
        fetchedRows: input.length,
        validRows: input.length,
        rejectedRows: 0,
        reference: { ...reference(), total_count: input.length, ...metadata },
      };
    };
  const snapshot = async () =>
    (
      await pool.query(`SELECT bizes_id,store_name,branch_name,semas_industry_code,semas_industry_name,ksic_code,ksic_name,
    source_dong_code,dong_code,road_address,lot_address,ST_AsEWKT(geom) AS geom,source_batch_id FROM cafe_store ORDER BY bizes_id`)
    ).rows;
  const batch = async (id: string) =>
    (await pool.query('SELECT * FROM etl_batch WHERE batch_id=$1', [id]))
      .rows[0];
  const latestFailure = async () =>
    (
      await pool.query(
        "SELECT * FROM etl_batch WHERE dataset_code='SEMAS_CAFE_STORE' AND status='FAILED' ORDER BY started_at DESC LIMIT 1",
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
        'POSTGRES_PASSWORD=cafe_test',
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
    databaseUrl = `postgresql://postgres:cafe_test@127.0.0.1:${port}/postgres`;
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
    const schema = `cafe_test_${randomUUID().replaceAll('-', '')}`;
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
    ])
      await pool.query(
        await readFile(
          new URL(
            '../../backend/src/main/resources/db/migration/' + file,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    seedBatchId = randomUUID();
    await pool.query(
      `INSERT INTO etl_batch (batch_id,dataset_code,source_type,scope_type,source_reference,etl_version,status,started_at,published_at)
      VALUES ($1,'TEST_REFERENCE','CSV','SEOUL','synthetic reference','test-v1','PUBLISHED',now(),now())`,
      [seedBatchId],
    );
    await pool.query(
      `INSERT INTO district VALUES ('11110','테스트구',
      ST_GeomFromText('MULTIPOLYGON(((126.9 37.5,127.1 37.5,127.1 37.7,126.9 37.7,126.9 37.5)))',4326),$1)`,
      [seedBatchId],
    );
    await pool.query(
      `INSERT INTO administrative_dong (dong_code,district_code,dong_name,geom,label_point,area_m2,boundary_batch_id)
      SELECT code,'11110','테스트동',geom,ST_PointOnSurface(geom),10000,$1 FROM district CROSS JOIN (VALUES ('11110515'),('11110530')) AS codes(code)`,
      [seedBatchId],
    );
  });
  afterAll(async () => {
    await Promise.all(pools.map((item) => item.end()));
    if (admin) await admin.end();
    if (container)
      execFileSync('docker', ['stop', container], { stdio: 'pipe' });
  }, 30000);

  it('publishes verified cafes with original identifiers, optional NULLs and Point 4326', async () => {
    const result = await importCafes(pool, options, loader());
    expect(result).toMatchObject({
      status: 'PUBLISHED',
      fetchedRows: 2,
      validRows: 2,
      rejectedRows: 0,
    });
    expect(await snapshot()).toEqual([
      {
        bizes_id: 'opaque-001',
        store_name: '첫 번째 카페',
        branch_name: '테스트점',
        semas_industry_code: 'I21201',
        semas_industry_name: '커피전문점',
        ksic_code: 'I56221',
        ksic_name: '커피 전문점',
        source_dong_code: '11110515',
        dong_code: '11110515',
        road_address: '서울특별시 테스트 도로',
        lot_address: null,
        geom: 'SRID=4326;POINT(127 37.6)',
        source_batch_id: result.batchId,
      },
      {
        bizes_id: 'opaque-002',
        store_name: '두 번째 카페',
        branch_name: null,
        semas_industry_code: 'I21201',
        semas_industry_name: '커피전문점',
        ksic_code: null,
        ksic_name: null,
        source_dong_code: '11110530',
        dong_code: '11110530',
        road_address: null,
        lot_address: '서울특별시 테스트 지번',
        geom: null,
        source_batch_id: result.batchId,
      },
    ]);
    const audit = await batch(result.batchId);
    expect(audit).toMatchObject({
      source_type: 'API',
      scope_type: 'SEOUL',
      scope_code: null,
      expected_rows: '2',
      fetched_rows: '2',
      valid_rows: '2',
      rejected_rows: '0',
      period_from: null,
      period_to: null,
      source_checksum: 'a'.repeat(64),
    });
    expect(audit.published_at).not.toBeNull();
    expect(JSON.parse(audit.source_reference)).toMatchObject({
      collection_mode: 'FULL_SEOUL',
      complete: true,
      classification_verified: true,
    });
    expect(
      (await pool.query('SELECT count(*) FROM service_industry')).rows[0].count,
    ).toBe('0');
  });
  it.each(['1111051500', '11999999', null])(
    'preserves unmatched raw dong %s without inventing a FK',
    async (raw) => {
      const input = rows();
      input[0]!.sourceDongCode = raw;
      await importCafes(pool, options, loader(input));
      expect((await snapshot())[0]).toMatchObject({
        source_dong_code: raw,
        dong_code: null,
      });
    },
  );
  it('reports point and known dong boundary disagreement without changing source point or FK', async () => {
    await pool.query(`UPDATE administrative_dong SET geom=ST_GeomFromText('MULTIPOLYGON(((126.91 37.51,126.92 37.51,126.92 37.52,126.91 37.52,126.91 37.51)))',4326),
      label_point=ST_SetSRID(ST_MakePoint(126.915,37.515),4326) WHERE dong_code='11110515'`);
    const result = await importCafes(pool, options, loader());
    expect((await snapshot())[0]).toMatchObject({
      dong_code: '11110515',
      geom: 'SRID=4326;POINT(127 37.6)',
    });
    expect(
      JSON.parse((await batch(result.batchId)).source_reference),
    ).toMatchObject({ spatial_mismatch_rows: 1 });
  });
  it('rejects points outside verified Seoul boundaries and preserves previous publication', async () => {
    await importCafes(pool, options, loader());
    const before = await snapshot();
    const changed = rows();
    changed[0]!.longitude = 129;
    changed[0]!.latitude = 35;
    await expect(
      importCafes(pool, options, loader(changed, 'b'.repeat(64))),
    ).rejects.toThrow('서울');
    expect(await snapshot()).toEqual(before);
    expect(await latestFailure()).toMatchObject({
      status: 'FAILED',
      published_at: null,
    });
  });

  it.each(['11999', '26110'])(
    '미등록 또는 서울 외 시군구 %s는 동일 체크섬이어도 게시·SKIP 전에 거부한다',
    async (code) => {
      await importCafes(pool, options, loader());
      const before = await snapshot();
      // DB에 실재하더라도 서울 밖 시군구는 통과하면 안 됩니다.
      if (code === '26110')
        await pool.query(
          "INSERT INTO district SELECT '26110','서울 외 테스트구',geom,boundary_batch_id FROM district WHERE district_code='11110'",
        );
      const input = rows();
      input[0] = {
        ...input[0]!,
        sourceDistrictCode: code,
        sourceDongCode: null,
        longitude: null,
        latitude: null,
      };
      await expect(importCafes(pool, options, loader(input))).rejects.toThrow(
        code,
      );
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        status: 'FAILED',
        fetched_rows: '2',
        valid_rows: '1',
        rejected_rows: '1',
        published_at: null,
      });
    },
  );
  it('fails safely when Seoul boundary reference data is absent', async () => {
    // 격리 스키마의 합성 기준 행만 제거해 선행 경계 적재 누락을 재현합니다.
    await pool.query('DELETE FROM administrative_dong');
    await pool.query('DELETE FROM district');
    await expect(importCafes(pool, options, loader())).rejects.toThrow();
    expect(await snapshot()).toEqual([]);
    expect(await latestFailure()).toMatchObject({ status: 'FAILED' });
  });
  it.each([
    { complete: false },
    { collection_mode: 'PARTIAL_DONG' },
    { classification_verified: false },
  ])('refuses incomplete or unverified collection %j', async (metadata) => {
    await expect(
      importCafes(pool, options, loader(rows(), 'a'.repeat(64), metadata)),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual([]);
    expect(await latestFailure()).toMatchObject({
      status: 'FAILED',
      published_at: null,
    });
  });
  it('rejects expected row mismatch while retaining source counts in FAILED', async () => {
    await expect(
      importCafes(pool, { ...options, expectedRows: 3 }, loader()),
    ).rejects.toThrow('행 수');
    expect(await snapshot()).toEqual([]);
    expect(await latestFailure()).toMatchObject({
      expected_rows: '3',
      fetched_rows: '2',
      valid_rows: '2',
      rejected_rows: '0',
      source_checksum: 'a'.repeat(64),
    });
  });
  it.each(['missing', 'extra'])(
    'rolls back actual staging %s rows before PUBLISHED or SKIPPED',
    async (kind) => {
      await importCafes(pool, options, loader());
      const before = await snapshot();
      await expect(
        importCafes(pool, options, async (settings, consume) =>
          loader()(settings, async (input) =>
            consume(
              kind === 'missing'
                ? input.slice(0, 1)
                : [...input, { ...input[0]!, bizesId: 'extra' }],
            ),
          ),
        ),
      ).rejects.toThrow('스테이징 행 수');
      expect(await snapshot()).toEqual(before);
      expect(await latestFailure()).toMatchObject({
        fetched_rows: '2',
        valid_rows: '2',
        rejected_rows: '0',
      });
    },
  );
  it('rejects duplicate identifiers rather than silently overwriting staging', async () => {
    const input = rows();
    input[1]!.bizesId = input[0]!.bizesId;
    await expect(importCafes(pool, options, loader(input))).rejects.toThrow();
    expect(await snapshot()).toEqual([]);
    expect(await latestFailure()).toMatchObject({ status: 'FAILED' });
  });
  it('skips complete unchanged source while retaining original provenance', async () => {
    const published = await importCafes(pool, options, loader());
    const before = await snapshot();
    const skipped = await importCafes(pool, options, loader());
    expect(skipped.status).toBe('SKIPPED');
    expect(await snapshot()).toEqual(before);
    expect(await batch(skipped.batchId)).toMatchObject({
      status: 'SKIPPED',
      published_at: null,
    });
    expect(
      before.every((row) => row.source_batch_id === published.batchId),
    ).toBe(true);
  });
  it.each(['name', 'coordinate', 'NULL', 'provenance', 'missing'])(
    'republishes identical source if actual DB %s differs',
    async (change) => {
      await importCafes(pool, options, loader());
      if (change === 'name')
        await pool.query("UPDATE cafe_store SET store_name='변경된 상호'");
      else if (change === 'coordinate')
        await pool.query(
          "UPDATE cafe_store SET geom=ST_SetSRID(ST_MakePoint(127.01,37.6),4326) WHERE bizes_id='opaque-001'",
        );
      else if (change === 'NULL')
        await pool.query(
          "UPDATE cafe_store SET road_address='추가 주소' WHERE bizes_id='opaque-002'",
        );
      else if (change === 'provenance')
        await pool.query('UPDATE cafe_store SET source_batch_id=$1', [
          seedBatchId,
        ]);
      else
        await pool.query("DELETE FROM cafe_store WHERE bizes_id='opaque-001'");
      const repaired = await importCafes(pool, options, loader());
      expect(repaired.status).toBe('PUBLISHED');
      const actual = await snapshot();
      expect(actual[0]).toMatchObject({
        store_name: '첫 번째 카페',
        geom: 'SRID=4326;POINT(127 37.6)',
        source_batch_id: repaired.batchId,
      });
      expect(actual[1]).toMatchObject({
        road_address: null,
        geom: null,
        source_batch_id: repaired.batchId,
      });
    },
  );
  it('retains absent shops as history and refreshes all incoming provenance', async () => {
    const first = await importCafes(pool, options, loader());
    const second = await importCafes(
      pool,
      { ...options, expectedRows: 1 },
      loader([{ ...rows()[0]!, branchName: null }], 'b'.repeat(64)),
    );
    expect(second.status).toBe('PUBLISHED');
    expect(await snapshot()).toEqual([
      expect.objectContaining({
        bizes_id: 'opaque-001',
        branch_name: null,
        source_batch_id: second.batchId,
      }),
      expect.objectContaining({
        bizes_id: 'opaque-002',
        source_batch_id: first.batchId,
      }),
    ]);
    expect(
      (
        await pool.query(
          'SELECT bizes_id FROM cafe_store WHERE source_batch_id=$1',
          [second.batchId],
        )
      ).rows,
    ).toEqual([{ bizes_id: 'opaque-001' }]);
  });
  it('does not skip old checksum after a newer full publication changed membership', async () => {
    const first = await importCafes(pool, options, loader());
    await importCafes(
      pool,
      { ...options, expectedRows: 1 },
      loader([rows()[0]!], 'b'.repeat(64)),
    );
    const restored = await importCafes(pool, options, loader());
    expect(restored.status).toBe('PUBLISHED');
    expect(restored.batchId).not.toBe(first.batchId);
    expect(
      (await snapshot()).every(
        (row) => row.source_batch_id === restored.batchId,
      ),
    ).toBe(true);
  });
  it('rolls back earlier Upserts when a later row fails and records FAILED outside transaction', async () => {
    await importCafes(pool, options, loader());
    const before = await snapshot();
    await pool.query(`CREATE FUNCTION reject_cafe_publish() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN IF NEW.bizes_id='opaque-002' THEN RAISE EXCEPTION 'test cafe publication failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_cafe_publish BEFORE UPDATE ON cafe_store FOR EACH ROW EXECUTE FUNCTION reject_cafe_publish()`);
    const changed = rows();
    changed[0]!.storeName = '실패 전 일부 수정';
    await expect(
      importCafes(pool, options, loader(changed, 'b'.repeat(64))),
    ).rejects.toThrow('test cafe publication failure');
    expect(await snapshot()).toEqual(before);
    expect(await latestFailure()).toMatchObject({
      status: 'FAILED',
      fetched_rows: '2',
      valid_rows: '2',
      rejected_rows: '0',
      published_at: null,
    });
  });
  it('rolls back an API failure after staging a valid page', async () => {
    await importCafes(pool, options, loader());
    const before = await snapshot();
    await expect(
      importCafes(pool, options, async (_settings, consume) => {
        await consume([{ ...rows()[0]!, storeName: '미완료 페이지' }]);
        throw new Error('모의 API 페이지 실패');
      }),
    ).rejects.toThrow('모의 API 페이지 실패');
    expect(await snapshot()).toEqual(before);
    expect(await latestFailure()).toMatchObject({
      status: 'FAILED',
      published_at: null,
    });
  });
  it('publishes multiple staging chunks without dropping rows', async () => {
    const input = Array.from({ length: 2501 }, (_, index) => ({
      ...rows()[0]!,
      bizesId: `bulk-${index}`,
    }));
    const result = await importCafes(
      pool,
      { ...options, expectedRows: 2501 },
      loader(input),
    );
    expect(result).toMatchObject({ status: 'PUBLISHED', validRows: 2501 });
    expect(
      (await pool.query('SELECT count(*) FROM cafe_store')).rows[0].count,
    ).toBe('2501');
  });
  it('serializes concurrent full reruns so only one batch publishes', async () => {
    const results = await Promise.all([
      importCafes(pool, options, loader()),
      importCafes(pool, options, loader()),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      'PUBLISHED',
      'SKIPPED',
    ]);
    expect(await snapshot()).toHaveLength(2);
  });

  it('connects authenticated mock classification and pages to the real PostGIS publication', async () => {
    // fetch 경계만 대체해 Zod 검증부터 공간 연산·배치 이력까지 실제 처리 흐름을 검증합니다.
    vi.stubEnv('SEMAS_API_KEY', 'synthetic-auth-key/+==');
    vi.stubGlobal('fetch', async (url: URL) => {
      expect(url.hostname).toBe('apis.data.go.kr');
      const catalog = url.pathname.endsWith('/smallUpjongList');
      expect(url.searchParams.get(catalog ? 'servicekey' : 'ServiceKey')).toBe(
        'synthetic-auth-key/+==',
      );
      return Response.json({
        header: { resultCode: '00', stdrYm: '202610' },
        body: catalog
          ? {
              items: [
                {
                  indsSclsCd: 'I21201',
                  indsSclsNm: '커피전문점',
                  stdrDt: '20261001',
                },
              ],
            }
          : {
              items: rows().map((row) => ({
                bizesId: row.bizesId,
                bizesNm: row.storeName,
                brchNm: row.branchName,
                indsSclsCd: row.semasIndustryCode,
                indsSclsNm: row.semasIndustryName,
                ksicCd: row.ksicCode,
                ksicNm: row.ksicName,
                ctprvnCd: '11',
                signguCd: '11110',
                adongCd: row.sourceDongCode,
                rdnmAdr: row.roadAddress,
                lnoAdr: row.lotAddress,
                lon: row.longitude,
                lat: row.latitude,
              })),
              numOfRows: 1000,
              pageNo: 1,
              totalCount: 2,
            },
      });
    });
    try {
      const published = await importCafes(pool, options);
      expect(published.status).toBe('PUBLISHED');
      expect((await importCafes(pool, options)).status).toBe('SKIPPED');
      const audit = await batch(published.batchId);
      expect(JSON.parse(audit.source_reference)).toMatchObject({
        complete: true,
        totalCount: 2,
        stdrYm: '202610',
      });
      expect(JSON.stringify(audit)).not.toContain('synthetic-auth-key');
      expect((await snapshot())[0]).toMatchObject({
        source_batch_id: published.batchId,
        geom: 'SRID=4326;POINT(127 37.6)',
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('redacts API credentials from failure audit, metadata and nested causes', async () => {
    vi.stubEnv('SEMAS_API_KEY', 'synthetic-auth-key/+==');
    try {
      const error = await importCafes(pool, options, async () => {
        throw new Error('request serviceKey=synthetic-auth-key/+==');
      }).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain('synthetic-auth-key');
      expect(String((error as Error).cause)).not.toContain(
        'synthetic-auth-key',
      );
      const failure = await latestFailure();
      expect(failure.error_message).toContain('[API_KEY]');
      expect(JSON.stringify(failure)).not.toContain('synthetic-auth-key');
      expect(await snapshot()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
