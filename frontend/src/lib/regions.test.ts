import { afterEach, expect, test, vi } from 'vitest';
import {
  fetchBoundary,
  fetchDistricts,
  fetchDongs,
  geometryExtent,
} from './regions';

afterEach(() => vi.unstubAllGlobals());
const signal = new AbortController().signal;
const ring = [
  [126.9, 37.5],
  [127, 37.5],
  [127, 37.6],
  [126.9, 37.5],
];

test('Polygon과 MultiPolygon의 모든 경도·위도에서 범위를 구한다', () => {
  expect(geometryExtent({ type: 'Polygon', coordinates: [ring] })).toEqual({
    west: 126.9,
    south: 37.5,
    east: 127,
    north: 37.6,
  });
  expect(
    geometryExtent({
      type: 'MultiPolygon',
      coordinates: [
        [ring],
        [
          [
            [126.8, 37.4],
            [127.1, 37.4],
            [127.1, 37.7],
            [126.8, 37.4],
          ],
        ],
      ],
    }),
  ).toEqual({ west: 126.8, south: 37.4, east: 127.1, north: 37.7 });
});

test.each([
  { type: 'Polygon', coordinates: [] },
  { type: 'Point', coordinates: [127, 37] },
  {
    type: 'Polygon',
    coordinates: [
      [
        [NaN, 37],
        [127, 37],
        [127, 38],
        [NaN, 37],
      ],
    ],
  },
])('잘못된 경계는 지도로 전달하지 않는다: %j', (geometry) => {
  expect(() => geometryExtent(geometry)).toThrow('응답');
});

test('API 목록 계약과 선행 0이 있는 코드를 문자열로 유지한다', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [{ districtCode: '00110', districtName: '예시구' }],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              dongCode: '00110001',
              districtCode: '00110',
              dongName: '예시동',
              labelPoint: { type: 'Point', coordinates: [127, 37] },
            },
          ],
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  expect((await fetchDistricts(signal))[0].districtCode).toBe('00110');
  expect((await fetchDongs('00110', signal))[0].dongCode).toBe('00110001');
  expect(fetch).toHaveBeenLastCalledWith('/api/v1/districts/00110/dongs', {
    signal,
  });
});

test('경계 Feature 응답을 검증하고 조회 지역의 범위를 반환한다', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        type: 'Feature',
        id: '00110001',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { regionType: 'DONG', regionCode: '00110001' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await fetchBoundary('dong', '00110001', signal)).toEqual({
    west: 126.9,
    south: 37.5,
    east: 127,
    north: 37.6,
  });
  expect(fetch).toHaveBeenCalledWith('/api/v1/dongs/00110001/boundary', {
    signal,
  });
});

test.each([
  [400, 'INVALID_PARAMETER', '요청'],
  [404, 'REGION_NOT_FOUND', '찾을 수'],
  [503, 'DATA_NOT_READY', '준비'],
  [503, 'DATABASE_UNAVAILABLE', '일시적으로'],
])('API %s / %s 오류를 구분한다', async (status, code, message) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status, code }), { status }),
      ),
  );
  await expect(fetchDistricts(signal)).rejects.toThrow(message);
});

test('네트워크 오류와 빈 목록을 구분한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }))),
  );
  await expect(fetchDistricts(signal)).rejects.toThrow('네트워크');
  await expect(fetchDistricts(signal)).resolves.toEqual([]);
});
