import { afterEach, expect, test, vi } from 'vitest';
import type { KakaoMaps, KakaoSearchCallback } from './kakao-maps';
import { searchPlaces } from './place-search';

const station = {
  id: '1',
  place_name: '홍대입구역',
  road_address_name: '서울 마포구 양화로 160',
  address_name: '서울 마포구 동교동 165',
  category_group_name: '지하철역',
  x: '126.924',
  y: '37.557',
};
const address = {
  address_name: '서울 마포구 동교동 165',
  x: '126.924',
  y: '37.557',
  road_address: { address_name: '서울 마포구 양화로 160', building_name: '' },
  address: { address_name: '서울 마포구 동교동 165' },
};
function sdk(
  places: unknown = [station],
  addresses: unknown = [],
  keywordStatus = 'OK',
  addressStatus = 'ZERO_RESULT',
  hasNextPage = false,
) {
  const keywordSearch = vi.fn((_query: string, callback: KakaoSearchCallback) =>
    callback(places, keywordStatus, { hasNextPage }),
  );
  const addressSearch = vi.fn((_query: string, callback: KakaoSearchCallback) =>
    callback(addresses, addressStatus, { hasNextPage: false }),
  );
  const maps = {
    services: {
      Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
      SortBy: { ACCURACY: 'accuracy' },
      Places: vi.fn(function () {
        return { keywordSearch };
      }),
      Geocoder: vi.fn(function () {
        return { addressSearch };
      }),
    },
  } as unknown as KakaoMaps;
  return { maps, keywordSearch, addressSearch };
}
afterEach(() => vi.useRealTimers());

test('역·장소 키워드와 주소를 첫 페이지로 병렬 검색하고 x·y를 올바르게 정규화한다', async () => {
  const { maps, keywordSearch, addressSearch } = sdk();
  const page = await searchPlaces(maps, ' 홍대입구역 ');
  expect(keywordSearch).toHaveBeenCalledWith(
    '홍대입구역',
    expect.any(Function),
    { sort: 'accuracy', size: 15, page: 1 },
  );
  expect(addressSearch).toHaveBeenCalledWith(
    '홍대입구역',
    expect.any(Function),
    { size: 15, page: 1 },
  );
  expect(page).toMatchObject({
    items: [
      {
        name: '홍대입구역',
        address: '서울 마포구 양화로 160',
        kind: '지하철역',
        longitude: 126.924,
        latitude: 37.557,
        isSeoul: true,
      },
    ],
    hasMore: false,
    partial: false,
  });
});

test('도로명·지번주소는 실제 주소 이름을 표시하며 같은 장소와의 중복을 제거한다', async () => {
  const { maps } = sdk([station, station], [address], 'OK', 'OK');
  expect(
    (await searchPlaces(maps, '서울특별시 마포구 양화로 160')).items,
  ).toHaveLength(1);
  const road = sdk([], [address], 'ZERO_RESULT', 'OK');
  expect((await searchPlaces(road.maps, '양화로 160')).items[0]).toMatchObject({
    name: '서울 마포구 양화로 160',
    kind: '도로명주소',
  });
  const lot = sdk(
    [],
    [{ ...address, road_address: null }],
    'ZERO_RESULT',
    'OK',
  );
  expect((await searchPlaces(lot.maps, '동교동 165')).items[0]).toMatchObject({
    address: '서울 마포구 동교동 165',
    kind: '지번주소',
  });
});

test('같은 건물의 다른 상호는 합치지 않고 서울 결과를 우선하되 서울 밖 좌표를 보존한다', async () => {
  const { maps } = sdk([
    {
      ...station,
      id: 'outside',
      place_name: '부산역',
      road_address_name: '부산 동구 중앙대로 206',
      x: '129.04',
      y: '35.12',
    },
    station,
    { ...station, id: '2', place_name: '홍대역 안내소' },
  ]);
  const page = await searchPlaces(maps, '역');
  expect(page.items.map((item) => item.name)).toEqual([
    '홍대입구역',
    '홍대역 안내소',
    '부산역',
  ]);
  expect(page.items[2]).toMatchObject({
    isSeoul: false,
    longitude: 129.04,
    latitude: 35.12,
  });
});

test('통합 결과는 최대 15개만 제공하고 다음 페이지·잘린 결과를 일부 표시로 안내한다', async () => {
  const rows = Array.from({ length: 17 }, (_, index) => ({
    ...station,
    id: String(index),
    place_name: `장소 ${index}`,
  }));
  expect(await searchPlaces(sdk(rows).maps, '장소')).toMatchObject({
    hasMore: true,
    items: expect.any(Array),
  });
  expect((await searchPlaces(sdk(rows).maps, '장소')).items).toHaveLength(15);
  expect(
    (
      await searchPlaces(
        sdk([station], [], 'OK', 'ZERO_RESULT', true).maps,
        '장소',
      )
    ).hasMore,
  ).toBe(true);
});

test.each([
  '서울특별시 마포구 양화로 160',
  '양화로160',
  '서울 마포구 동교동 165',
])(
  '키워드 15건 뒤의 정확한 도로명·지번주소를 누락하지 않는다: %s',
  async (query) => {
    const places = Array.from({ length: 15 }, (_, index) => ({
      ...station,
      id: `shop-${index}`,
      place_name: `관련 장소 ${index}`,
    }));
    const exact = { ...address, x: '126.925' };
    const page = await searchPlaces(
      sdk(places, [exact], 'OK', 'OK').maps,
      query,
    );
    expect(page.items[0]).toMatchObject({
      kind: '도로명주소',
      longitude: 126.925,
    });
    expect(page.items).toHaveLength(15);
    expect(page.hasMore).toBe(true);
  },
);

test('장소명 검색에서는 유사 주소보다 원래 장소 검색 순서를 유지한다', async () => {
  const places = Array.from({ length: 15 }, (_, index) => ({
    ...station,
    id: `shop-${index}`,
    place_name: `관련 장소 ${index}`,
  }));
  const page = await searchPlaces(
    sdk(places, [{ ...address, x: '126.925' }], 'OK', 'OK').maps,
    '홍대입구역',
  );
  expect(page.items.map((item) => item.id)).toEqual(
    places.map((place) => `place:${place.id}`),
  );
  expect(page.hasMore).toBe(true);
});

test.each(['양화로 16', '화로 160', '동교동 16', '부산 마포구 양화로 160'])(
  '주소 형태여도 다른 번지·도로·지역의 유사 결과를 우선하지 않는다: %s',
  async (query) => {
    const page = await searchPlaces(
      sdk([station], [{ ...address, x: '126.925' }], 'OK', 'OK').maps,
      query,
    );
    expect(page.items[0].id).toBe('place:1');
  },
);

test('정확한 주소와 중복되는 장소는 따로 세지 않고 주소 결과를 대표로 보존한다', async () => {
  const places = [
    ...Array.from({ length: 14 }, (_, index) => ({
      ...station,
      id: `shop-${index}`,
      place_name: `다른 건물 ${index}`,
      road_address_name: `서울 마포구 양화로 ${index + 1}`,
    })),
    station,
  ];
  const page = await searchPlaces(
    sdk(places, [address, address], 'OK', 'OK').maps,
    '서울특별시 마포구 양화로 160',
  );
  expect(page.items[0]).toMatchObject({
    kind: '도로명주소',
    longitude: 126.924,
    latitude: 37.557,
  });
  expect(page.items).toHaveLength(15);
  expect(new Set(page.items.map((item) => item.id)).size).toBe(15);
  expect(page.hasMore).toBe(false);
});

test.each([
  ['강남역', '127.0276', '37.4979'],
  ['잠실역', '127.1001', '37.5133'],
  ['노원역', '127.0610', '37.6551'],
])(
  '서울시청에서 떨어진 %s도 좌표·반경 제한 없이 정확도순으로 검색한다',
  async (name, x, y) => {
    const { maps, keywordSearch } = sdk([
      { ...station, place_name: name, x, y },
    ]);
    const page = await searchPlaces(maps, name);
    expect(keywordSearch).toHaveBeenCalledWith(name, expect.any(Function), {
      sort: 'accuracy',
      size: 15,
      page: 1,
    });
    expect(page.items[0]).toMatchObject({
      name,
      longitude: Number(x),
      latitude: Number(y),
    });
  },
);

test('API 문자열은 HTML로 해석하지 않고 텍스트 데이터로 보존한다', async () => {
  const malicious = {
    ...station,
    place_name: '<img src=x onerror=alert(1)>',
    road_address_name: '<script>주소</script>',
  };
  const page = await searchPlaces(sdk([malicious]).maps, '장소');
  expect(page.items[0]).toMatchObject({
    name: malicious.place_name,
    address: malicious.road_address_name,
  });
});

test.each(['', ' ', 'NaN', 'Infinity', '0x80', '181'])(
  '잘못된 경도 %s는 표시하거나 0으로 보정하지 않는다',
  async (x) => {
    await expect(
      searchPlaces(sdk([{ ...station, x }]).maps, '장소'),
    ).rejects.toThrow('검색');
  },
);

test('잘못된 위도는 제외하고 정상 결과가 있으면 일부 응답 상태로 제공한다', async () => {
  const page = await searchPlaces(
    sdk([station, { ...station, id: 'bad', y: '91' }]).maps,
    '장소',
  );
  expect(page.items).toHaveLength(1);
  expect(page.partial).toBe(true);
});

test('ZERO_RESULT·ERROR·부분 실패를 구분하고 빈 검색어는 SDK를 호출하지 않는다', async () => {
  const empty = sdk([], [], 'ZERO_RESULT', 'ZERO_RESULT');
  expect(await searchPlaces(empty.maps, '없는장소')).toEqual({
    items: [],
    hasMore: false,
    partial: false,
  });
  await expect(
    searchPlaces(sdk([], [], 'ERROR', 'ZERO_RESULT').maps, '장소'),
  ).rejects.toThrow('검색');
  expect(
    await searchPlaces(sdk([station], [], 'OK', 'ERROR').maps, '장소'),
  ).toMatchObject({ partial: true, items: [expect.any(Object)] });
  await expect(searchPlaces(empty.maps, '  ')).rejects.toThrow('검색어');
  expect(empty.keywordSearch).toHaveBeenCalledOnce();
});

test('콜백 미도착·서비스 예외는 시간 제한 후 실패하며 늦은 콜백은 결과를 바꾸지 않는다', async () => {
  vi.useFakeTimers();
  const { maps, keywordSearch, addressSearch } = sdk();
  let late!: KakaoSearchCallback;
  keywordSearch.mockImplementation((_query, callback) => {
    late = callback;
  });
  addressSearch.mockImplementation(() => {
    throw new Error('service');
  });
  const pending = searchPlaces(maps, '장소');
  const rejected = expect(pending).rejects.toThrow('검색');
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  late([station], 'OK', { hasNextPage: false });
});
