import assert from 'node:assert/strict';
import test from 'node:test';
import candidates from './candidates.json' with { type: 'json' };

const publishedAt = '2026-07-01T00:00:00Z';
const slot = process.env.DEMO_SLOT || '0';
assert(
  slot.length === 1 && /^[0-9]$/.test(slot),
  'DEMO_SLOT은 한 자리 숫자(0~9)여야 합니다.',
);
const origin = `http://127.0.0.1:${38081 + Number(slot)}`;

async function get(path, query = {}) {
  const url = new URL(`/api/v1${path}`, origin);
  url.search = new URLSearchParams(query);
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, url.pathname + url.search);
  return response.json();
}

function assertBatch(batch, slot) {
  assert.equal(
    batch.batchId,
    `f17e0000-0000-4000-8000-${String(slot).padStart(12, '0')}`,
  );
  assert.equal(
    new Date(batch.publishedAt).toISOString(),
    new Date(publishedAt).toISOString(),
  );
}

test('합성 구·동 목록과 PostGIS 경계', async () => {
  const [districts, dongs, district, dong] = await Promise.all([
    get('/districts'),
    get('/districts/99001/dongs'),
    get('/districts/99001/boundary'),
    get('/dongs/99001001/boundary'),
  ]);
  assert.deepEqual(districts.items, [
    { districtCode: '99001', districtName: '[Demo 합성] 예시구' },
  ]);
  assert.equal(dongs.items.length, 1);
  assert.equal(dongs.items[0].dongCode, '99001001');
  assert.equal(dongs.items[0].districtCode, '99001');
  assert.equal(dongs.items[0].labelPoint.type, 'Point');

  for (const [feature, code] of [
    [district, '99001'],
    [dong, '99001001'],
  ]) {
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.geometry.type, 'MultiPolygon');
    assert.equal(feature.properties.regionCode, code);
    assertBatch(feature.properties.boundaryBatch, 1);
  }
});

test('두 분기의 자치구·행정동 통계 6종과 게시 출처', async () => {
  const expected = [
    ['districts/99001', 'stores', 'storeCount', ['120', '132'], 4],
    [
      'districts/99001',
      'sales',
      'monthlySalesAmount',
      ['160000000', '176000000'],
      5,
    ],
    [
      'districts/99001',
      'foot-traffic',
      'totalFootTraffic',
      ['210000.25', '231000.50'],
      6,
    ],
    ['dongs/99001001', 'stores', 'storeCount', ['28', '33'], 7],
    [
      'dongs/99001001',
      'sales',
      'monthlySalesAmount',
      ['48000000', '54000000'],
      8,
    ],
    [
      'dongs/99001001',
      'foot-traffic',
      'totalFootTraffic',
      ['41000.25', '45000.50'],
      9,
    ],
  ];
  await Promise.all(
    expected.map(async ([region, metric, field, values, batch]) => {
      for (const [index, quarterCode] of ['20261', '20262'].entries()) {
        const query = { quarterCode };
        if (metric !== 'foot-traffic') query.industryCode = 'CS100010';
        const response = await get(`/${region}/stats/${metric}`, query);
        assert.equal(response.quarterCode, quarterCode);
        assert.equal(response.data?.[field], values[index]);
        assertBatch(response.data.sourceBatch, batch);
      }
    }),
  );
});

test('후보 A·B의 중심 포함 지역과 500m·1,000m 카페 비교', async () => {
  const cafeIds = {
    A: [
      ['DEMO-CAFE-1', 'DEMO-CAFE-2'],
      ['DEMO-CAFE-1', 'DEMO-CAFE-2', 'DEMO-CAFE-3'],
    ],
    B: [['DEMO-CAFE-4'], ['DEMO-CAFE-4', 'DEMO-CAFE-5']],
  };
  for (const { slot, longitude, latitude } of candidates) {
    const center = { longitude, latitude };
    const regions = await get('/regions/nearby', { ...center, radiusM: 1 });
    assertBatch(regions.boundaryBatch, 1);
    assert.deepEqual(
      regions.districts
        .filter((region) => region.containsCenter)
        .map((region) => region.districtCode),
      ['99001'],
    );
    assert.deepEqual(
      regions.dongs
        .filter((region) => region.containsCenter)
        .map((region) => region.dongCode),
      ['99001001'],
    );

    for (const [index, radiusM] of [500, 1000].entries()) {
      const cafes = await get('/cafes/nearby', { ...center, radiusM });
      const expected = cafeIds[slot][index];
      assert.equal(cafes.totalCount, expected.length);
      assert.deepEqual(
        cafes.items.map((cafe) => cafe.bizesId),
        expected,
      );
      assert(
        cafes.items.every(
          (cafe) =>
            cafe.storeName.startsWith('[Demo 합성] ') &&
            cafe.distanceM <= radiusM,
        ),
      );
      assertBatch(cafes.sourceBatch, 3);
    }
  }
});
