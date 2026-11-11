import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { startMockApi } from './mock-api.ts';

async function fixture(t: TestContext) {
  const server = await startMockApi(0);
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert(address && typeof address !== 'string');
  return (path: string, cookie = '') =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: { Cookie: cookie },
    });
}

test('합성 식별자, 구·동과 경계는 외부 연결 없이 제공', async (t) => {
  const get = await fixture(t);
  assert.deepEqual(await (await get('/__e2e/health')).json(), {
    fixture: 'synthetic-v1',
  });
  assert.equal((await (await get('/api/v1/districts')).json()).items.length, 2);
  const dongs = await (await get('/api/v1/districts/11440/dongs')).json();
  assert.equal(dongs.items[0].districtCode, '11440');
  const boundary = await (await get('/api/v1/dongs/11440660/boundary')).json();
  assert.equal(boundary.properties.regionType, 'DONG');
  assert.equal((await get('/api/v1/districts/99999/dongs')).status, 404);
  const affiliation = await (
    await get(
      '/api/v1/regions/nearby?longitude=126.923&latitude=37.556&radiusM=1',
    )
  ).json();
  assert.equal(affiliation.dongs[0].dongCode, '11440660');
  assert.equal((await get('/api/v1/regions/nearby?radiusM=1')).status, 400);
});

test('분기·지역·업종 계약과 원본 정밀도', async (t) => {
  const get = await fixture(t);
  for (const kind of ['districts', 'dongs'])
    for (const quarter of ['20261', '20262']) {
      const code = kind === 'districts' ? '11440' : '11440660';
      const data = await (
        await get(
          `/api/v1/${kind}/${code}/stats/sales?quarterCode=${quarter}&industryCode=CS100010`,
        )
      ).json();
      assert.equal(
        data[kind === 'districts' ? 'districtCode' : 'dongCode'],
        code,
      );
      assert.equal(data.quarterCode, quarter);
      assert.equal(data.data.monthlySalesAmount, '9007199254740993');
    }
  const foot = await (
    await get('/api/v1/districts/11440/stats/foot-traffic?quarterCode=20262')
  ).json();
  assert.equal(foot.data.totalFootTraffic, '123456.7800');
  assert(!('industryCode' in foot));
  assert.equal(
    (
      await get(
        '/api/v1/districts/11440/stats/foot-traffic?quarterCode=20262&industryCode=CS100010',
      )
    ).status,
    400,
  );
  assert.equal(
    (await get('/api/v1/districts/11440/stats/stores?quarterCode=20262'))
      .status,
    400,
  );
});

test('오류·빈 응답은 쿠키별로 격리되고 정상 재시도가 가능', async (t) => {
  const get = await fixture(t);
  const path =
    '/api/v1/districts/11440/stats/sales?quarterCode=20262&industryCode=CS100010';
  const [error, empty, normal] = await Promise.all([
    get(path, 'ry-e2e-scenario=sales-error'),
    get(path, 'ry-e2e-scenario=sales-empty'),
    get(path),
  ]);
  assert.equal(error.status, 503);
  assert.equal((await empty.json()).data, null);
  assert.equal(
    (await normal.json()).data.monthlySalesAmount,
    '9007199254740993',
  );
  assert.equal(
    (await get('/api/v1/districts', 'ry-e2e-scenario=districts-error')).status,
    503,
  );
  assert.equal((await get('/api/v1/districts')).status, 200);
});

test('반경과 반환 상한·전체 건수·서버 거리 유지', async (t) => {
  const get = await fixture(t);
  for (const [radius, total] of [
    [500, 3],
    [1000, 7],
  ]) {
    const page = await (
      await get(
        `/api/v1/cafes/nearby?longitude=126.923&latitude=37.556&radiusM=${radius}&limit=200&offset=0`,
      )
    ).json();
    assert.equal(page.totalCount, total);
    assert.equal(page.items.length, 1);
    assert.equal(page.hasMore, true);
    assert.equal(page.items[0].distanceM, 120);
    assert.equal(page.limit, 200);
  }
  assert.equal(
    (await get('/api/v1/cafes/nearby?radiusM=2000&limit=200&offset=0')).status,
    400,
  );
  assert.equal(
    (await get('/api/v1/cafes/nearby?radiusM=500&limit=200&offset=0')).status,
    400,
  );
});

test('정의하지 않은 API를 404로 응답한다', async (t) => {
  const get = await fixture(t);
  const response = await get('/api/v1/not-defined');
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'E2E_UNEXPECTED_ENDPOINT');
});
