import { afterEach, expect, test, vi } from 'vitest';
import { cafeAddress, fetchViewportCafes } from './cafes';

afterEach(() => vi.unstubAllGlobals());
const bounds = { west: 126.97, south: 37.55, east: 126.99, north: 37.57 };
const cafe = {
  bizesId: '001',
  storeName: '<img src=x onerror=alert(1)>',
  branchName: null,
  semasIndustryCode: 'I21201',
  semasIndustryName: '카페',
  roadAddress: null,
  lotAddress: '서울 1',
  longitude: 126.978,
  latitude: 37.5665,
};
const page = {
  items: [cafe],
  totalCount: 201,
  limit: 200,
  offset: 0,
  hasMore: true,
  sourceBatch: {
    batchId: '00000000-0000-0000-0000-000000000004',
    publishedAt: '2026-10-02T00:00:00Z',
  },
};

test('현재 영역·문자열 구 코드·200건 상한을 전달하고 실제 DTO를 보존한다', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(page)));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  expect(await fetchViewportCafes(bounds, '00110', signal)).toEqual(page);
  const url = new URL(fetch.mock.calls[0][0], 'http://localhost');
  expect(url.pathname).toBe('/api/v1/cafes/viewport');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    ...Object.fromEntries(
      Object.entries(bounds).map(([k, v]) => [k, String(v)]),
    ),
    districtCodes: '00110',
    limit: '200',
    offset: '0',
  });
  expect(fetch.mock.calls[0][1]).toEqual({ signal });
});

test('구 전체는 districtCodes를 생략하고 빈 결과를 정상 처리한다', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ ...page, items: [], totalCount: 0, hasMore: false }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  expect(
    (await fetchViewportCafes(bounds, '', new AbortController().signal)).items,
  ).toEqual([]);
  expect(fetch.mock.calls[0][0]).not.toContain('districtCodes');
  expect(fetch.mock.calls[0][0]).not.toContain('dong');
});

test.each([
  { ...page, items: [{ ...cafe, latitude: 91 }] },
  { ...page, items: [{ ...cafe, bizesId: 1 }] },
  { ...page, items: [{ ...cafe, storeName: '' }] },
  { ...page, items: [{ ...cafe, roadAddress: 1 }] },
  { ...page, items: [cafe, cafe] },
  { ...page, limit: 500 },
  { ...page, offset: 200 },
  { ...page, hasMore: false },
  { ...page, sourceBatch: null },
])(
  '잘못된 좌표·필수 필드·중복 ID·페이지 계약은 오류로 처리한다 %#',
  async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(
      fetchViewportCafes(bounds, '', new AbortController().signal),
    ).rejects.toThrow('응답');
  },
);

test.each([
  [400, 'INVALID_PARAMETER', '요청'],
  [404, 'REGION_NOT_FOUND', '찾을 수'],
  [503, 'DATA_NOT_READY', '준비'],
  [503, 'DATABASE_UNAVAILABLE', '일시적으로'],
])('HTTP %s 오류를 구분한다', async (status, code, text) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code }), { status })),
  );
  await expect(
    fetchViewportCafes(bounds, '', new AbortController().signal),
  ).rejects.toThrow(text);
});

test('네트워크 오류와 잘못된 지도 범위를 구분한다', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('network'));
  vi.stubGlobal('fetch', fetch);
  await expect(
    fetchViewportCafes(bounds, '', new AbortController().signal),
  ).rejects.toThrow('네트워크');
  await expect(
    fetchViewportCafes(
      { ...bounds, west: 180 },
      '',
      new AbortController().signal,
    ),
  ).rejects.toThrow('영역');
  expect(fetch).toHaveBeenCalledOnce();
});

test('선택한 구와 동은 서버 공간 필터에 함께 전달한다', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(page)));
  vi.stubGlobal('fetch', fetch);
  await fetchViewportCafes(
    bounds,
    '11110',
    new AbortController().signal,
    '11110515',
  );
  const params = new URL(fetch.mock.calls[0][0], 'http://localhost')
    .searchParams;
  expect(params.get('districtCodes')).toBe('11110');
  expect(params.get('dongCodes')).toBe('11110515');
});

test('주소는 도로명·지번·없음 순서이며 브랜드를 추정하지 않는다', () => {
  expect(
    cafeAddress({
      ...cafe,
      roadAddress: ' 도로명주소 ',
      lotAddress: '지번주소',
    }),
  ).toBe('도로명주소');
  expect(
    cafeAddress({ ...cafe, roadAddress: ' ', lotAddress: ' 지번주소 ' }),
  ).toBe('지번주소');
  expect(cafeAddress({ ...cafe, roadAddress: null, lotAddress: null })).toBe(
    '주소 정보가 없습니다.',
  );
});
