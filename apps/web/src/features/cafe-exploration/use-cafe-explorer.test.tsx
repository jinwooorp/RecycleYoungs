import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useCafeExplorer } from './use-cafe-explorer';
import type { KakaoMaps, KakaoSearchCallback } from '@/shared/kakao/kakao-maps';

afterEach(() => vi.unstubAllGlobals());
const bounds = { west: 126.97, south: 37.55, east: 126.99, north: 37.57 };
const cafe = {
  bizesId: '001',
  storeName: '시청 카페',
  branchName: null,
  semasIndustryCode: 'I21201',
  semasIndustryName: '카페',
  roadAddress: null,
  lotAddress: null,
  longitude: 126.978,
  latitude: 37.5665,
};
function response(id = '001', empty = false, distanceM?: number) {
  return new Response(
    JSON.stringify({
      items: empty
        ? []
        : [
            {
              ...cafe,
              bizesId: id,
              ...(distanceM === undefined ? {} : { distanceM }),
            },
          ],
      totalCount: empty ? 0 : 1,
      limit: 200,
      offset: 0,
      hasMore: false,
      sourceBatch: {
        batchId: '00000000-0000-0000-0000-000000000004',
        publishedAt: '2026-10-02T00:00:00Z',
      },
    }),
  );
}

test('지도 준비를 기다리고 구 필터·해제와 동 이동에서 지원하는 조건만 조회한다', async () => {
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  const view = renderHook(
    ({ district, key, loading }) =>
      useCafeExplorer(district, key.split(':')[1] ?? '', loading),
    { initialProps: { district: '', key: ':', loading: false } },
  );
  expect(fetch).not.toHaveBeenCalled();
  act(() => view.result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(fetch.mock.calls[0][0]).not.toContain('districtCodes');
  act(() => view.result.current.selectCafe('001'));
  expect(view.result.current.selected?.bizesId).toBe('001');
  view.rerender({ district: '00110', key: '00110:', loading: true });
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.selected).toBeNull();
  view.rerender({ district: '00110', key: '00110:', loading: false });
  expect(fetch).toHaveBeenCalledOnce();
  act(() => view.result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(fetch.mock.calls[1][0]).toContain('districtCodes=00110');
  view.rerender({ district: '00110', key: '00110:00110001', loading: false });
  act(() =>
    view.result.current.onViewportChange({ ...bounds, west: 126.98 }, 4),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(fetch.mock.calls[2][0]).toContain('districtCodes=00110');
  expect(fetch.mock.calls[2][0]).toContain('dongCodes=00110001');
  view.rerender({ district: '', key: ':', loading: false });
  act(() => view.result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  expect(fetch.mock.calls[3][0]).not.toContain('districtCodes');
});

test('같은 영역은 재조회하지 않고 취소를 무시하는 오래된 응답도 차단한다', async () => {
  const finishes: ((response: Response) => void)[] = [];
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    () => new Promise<Response>((resolve) => finishes.push(resolve)),
  );
  vi.stubGlobal('fetch', fetch);
  const { result, unmount } = renderHook(() => useCafeExplorer('', '', false));
  act(() => result.current.onViewportChange(bounds, 4));
  act(() => result.current.onViewportChange({ ...bounds, west: 126.98 }, 4));
  expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  await act(async () => finishes[1](response('new')));
  await act(async () => finishes[0](response('old')));
  expect(result.current.items[0].bizesId).toBe('new');
  act(() => result.current.onViewportChange({ ...bounds, west: 126.98 }, 4));
  expect(fetch).toHaveBeenCalledTimes(2);
  act(() => result.current.onViewportChange(bounds, 4));
  unmount();
  expect(fetch.mock.calls[2][1].signal?.aborted).toBe(true);
});

test('StrictMode에서 API 오류 후 재시도하고 빈 목록을 구분한다', async () => {
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      fail
        ? new Response(JSON.stringify({ code: 'DATA_NOT_READY' }), {
            status: 503,
          })
        : response('001', true),
    ),
  );
  const { result } = renderHook(() => useCafeExplorer('', '', false), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    ),
  });
  act(() => result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.error).toContain('준비');
  fail = false;
  act(() => result.current.retry());
  expect(result.current.status).toBe('loading');
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.items).toEqual([]);
  expect(result.current.data?.totalCount).toBe(0);
});

test('구 미선택의 넓은 초기 화면은 조회하지 않고 확대·축소에 따라 조회와 마커 자료를 제어한다', async () => {
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useCafeExplorer('', '', false));
  act(() => result.current.onViewportChange(bounds, 5));
  expect(result.current.status).toBe('idle');
  expect(result.current.needsZoom).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  act(() => result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.items).toHaveLength(1);
  act(() => result.current.onViewportChange(bounds, 5));
  expect(result.current.status).toBe('idle');
  expect(result.current.items).toEqual([]);
  expect(result.current.data).toBeNull();
});

test('동 선택 변경은 이전 요청을 취소하고 늦은 다른 동 결과가 섞이지 않는다', async () => {
  const finishes: ((response: Response) => void)[] = [];
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    () => new Promise<Response>((resolve) => finishes.push(resolve)),
  );
  vi.stubGlobal('fetch', fetch);
  const view = renderHook(({ dong }) => useCafeExplorer('11110', dong, false), {
    initialProps: { dong: '11110515' },
  });
  act(() => view.result.current.onViewportChange(bounds, 7));
  view.rerender({ dong: '11110530' });
  expect(view.result.current.items).toEqual([]);
  expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  act(() => view.result.current.onViewportChange(bounds, 7));
  await act(async () => finishes[1](response('new-dong')));
  await act(async () => finishes[0](response('old-dong')));
  expect(view.result.current.items.map((cafe) => cafe.bizesId)).toEqual([
    'new-dong',
  ]);
  expect(fetch.mock.calls[1][0]).toContain('dongCodes=11110530');
});

test('반경 방식은 중심점 전 조회하지 않고 구·동 조건 없이 500m·1km만 요청한다', async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () => response('nearby', false, 12.5));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() =>
    useCafeExplorer('11110', '11110515', false),
  );
  act(() => result.current.setMode('nearby'));
  expect(result.current.status).toBe('idle');
  expect(fetch).not.toHaveBeenCalled();
  expect(result.current.radiusM).toBe(500);
  act(() =>
    result.current.selectCenter({ longitude: 126.978, latitude: 37.5665 }),
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(fetch.mock.calls[0][0]).toContain(
    '/nearby?longitude=126.978&latitude=37.5665&radiusM=500&limit=200&offset=0',
  );
  expect(fetch.mock.calls[0][0]).not.toContain('Codes');
  act(() => result.current.onViewportChange(bounds, 7));
  expect(fetch).toHaveBeenCalledOnce();
  act(() => result.current.setRadiusM(1000));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(fetch.mock.calls[1][0]).toContain('radiusM=1000');
  expect(result.current.items[0].distanceM).toBe(12.5);
  act(() => result.current.clearCenter());
  expect(result.current.status).toBe('idle');
  expect(result.current.items).toEqual([]);
  expect(result.current.center).toBeNull();
});

test('방식·중심점·반경 변경은 이전 요청과 선택을 분리하고 늦은 응답을 버린다', async () => {
  const finishes: ((response: Response) => void)[] = [];
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    () => new Promise((resolve) => finishes.push(resolve)),
  );
  vi.stubGlobal('fetch', fetch);
  const { result, unmount } = renderHook(() =>
    useCafeExplorer('11110', '11110515', false),
  );
  act(() => result.current.onViewportChange(bounds, 7));
  act(() => result.current.setMode('nearby'));
  expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  act(() =>
    result.current.selectCenter({ longitude: 126.978, latitude: 37.5665 }),
  );
  act(() =>
    result.current.selectCenter({ longitude: 126.98, latitude: 37.57 }),
  );
  expect(fetch.mock.calls[1][1].signal?.aborted).toBe(true);
  act(() => result.current.setRadiusM(1000));
  expect(fetch.mock.calls[2][1].signal?.aborted).toBe(true);
  await act(async () => finishes[3](response('current', false, 1000)));
  act(() => result.current.selectCafe('current'));
  expect(result.current.selected?.bizesId).toBe('current');
  await act(async () => {
    finishes[0](response('viewport'));
    finishes[1](response('old-center', false, 100));
    finishes[2](response('old-radius', false, 100));
  });
  expect(result.current.items.map((cafe) => cafe.bizesId)).toEqual(['current']);
  act(() => result.current.setMode('viewport'));
  expect(result.current.selected).toBeNull();
  expect(
    result.current.items.every((cafe) => cafe.distanceM === undefined),
  ).toBe(true);
  expect(fetch.mock.calls.at(-1)![0]).toContain(
    'districtCodes=11110&dongCodes=11110515',
  );
  unmount();
  expect(fetch.mock.calls.at(-1)![1].signal?.aborted).toBe(true);
});

test('반경 조회는 StrictMode에서도 오류·재시도·빈 결과를 구분한다', async () => {
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      fail
        ? new Response(JSON.stringify({ code: 'DATA_NOT_READY' }), {
            status: 503,
          })
        : response('none', true),
    ),
  );
  const { result } = renderHook(() => useCafeExplorer('', '', false), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    ),
  });
  act(() => {
    result.current.setMode('nearby');
    result.current.selectCenter({ longitude: 126.978, latitude: 37.5665 });
  });
  await waitFor(() => expect(result.current.status).toBe('error'));
  fail = false;
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.data?.totalCount).toBe(0);
  expect(result.current.items).toEqual([]);
});

test('중심점 표시 정보는 좌표 조회 키와 분리하고 주소 완료·이름 변경이 카페 재조회와 선택 해제를 만들지 않는다', async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () => response('001', false, 12.5));
  vi.stubGlobal('fetch', fetch);
  let address!: KakaoSearchCallback;
  const lookup = vi.fn(
    (_x: number, _y: number, callback: KakaoSearchCallback) => {
      address = callback;
    },
  );
  const maps = {
    services: {
      Status: { OK: 'OK' },
      Geocoder: function () {
        return { coord2Address: lookup };
      },
    },
  } as unknown as KakaoMaps;
  const { result } = renderHook(() => useCafeExplorer('', '', false, maps));
  const point = { longitude: 126.978, latitude: 37.5665 };
  act(() => {
    result.current.setMode('nearby');
    result.current.selectCenter(point);
  });
  expect(result.current.centerDetails.pending).toBe(true);
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => result.current.selectCafe('001'));
  const selected = result.current.selected;
  act(() =>
    address([{ road_address: { address_name: '서울 도로명주소' } }], 'OK'),
  );
  await waitFor(() =>
    expect(result.current.centerDetails.address).toBe('서울 도로명주소'),
  );
  expect(result.current.selected).toBe(selected);
  expect(fetch).toHaveBeenCalledOnce();
  act(() =>
    result.current.selectCenter(point, {
      name: '염창역',
      address: '검색 주소',
    }),
  );
  expect(result.current.centerDetails.name).toBe('염창역');
  expect(result.current.selected).toBe(selected);
  expect(fetch).toHaveBeenCalledOnce();
  expect(lookup).toHaveBeenCalledOnce();
  act(() => result.current.setRadiusM(1000));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(result.current.centerDetails.name).toBe('염창역');
  expect(result.current.centerDetails.address).toBe('검색 주소');
  expect(lookup).toHaveBeenCalledOnce();
  act(() => result.current.selectCenter({ longitude: 127, latitude: 37.55 }));
  expect(result.current.centerDetails.name).toBeNull();
  expect(result.current.centerDetails.address).toBeNull();
  expect(lookup).toHaveBeenCalledTimes(2);
  act(() => result.current.clearCenter());
  expect(result.current.centerDetails).toEqual({
    name: null,
    address: null,
    pending: false,
  });
});

test('검색 장소명을 보관한 중심점은 반경 전환·패널 재렌더에서도 역지오코딩하지 않는다', async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () => response('001', false, 12.5));
  vi.stubGlobal('fetch', fetch);
  const lookup = vi.fn();
  const maps = {
    services: {
      Geocoder: function () {
        return { coord2Address: lookup };
      },
    },
  } as unknown as KakaoMaps;
  const view = renderHook(() => useCafeExplorer('', '', false, maps));
  act(() => {
    view.result.current.setMode('nearby');
    view.result.current.selectCenter(
      { longitude: 126.87, latitude: 37.55 },
      { name: '염창역', address: '서울 강서구 공항대로' },
    );
  });
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(view.result.current.center).toEqual({
    longitude: 126.87,
    latitude: 37.55,
  });
  expect(fetch.mock.calls[0][0]).not.toContain('염창역');
  act(() => view.result.current.setRadiusM(1000));
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  act(() => view.result.current.setRadiusM(500));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  view.rerender();
  expect(view.result.current.centerDetails).toEqual({
    name: '염창역',
    address: '서울 강서구 공항대로',
    pending: false,
  });
  expect(lookup).not.toHaveBeenCalled();
});

test('경계 준비 후 다중 구 카페를 한 번 조회하고 선택 순서만 바뀌면 재요청하지 않는다', async () => {
  const fetch = vi.fn<(url: string) => Promise<Response>>(async () =>
    response(),
  );
  vi.stubGlobal('fetch', fetch);
  const view = renderHook(
    ({ districts, loading }) => useCafeExplorer(districts, '00110001', loading),
    { initialProps: { districts: ['00140', '00110', '00140'], loading: true } },
  );
  act(() => view.result.current.onViewportChange(bounds, 7));
  expect(fetch).not.toHaveBeenCalled();
  view.rerender({ districts: ['00140', '00110'], loading: false });
  act(() => view.result.current.onViewportChange(bounds, 7));
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(fetch).toHaveBeenCalledOnce();
  const params = new URL(fetch.mock.calls[0][0], 'http://localhost')
    .searchParams;
  expect(params.getAll('districtCodes')).toEqual(['00110', '00140']);
  expect(params.has('dongCodes')).toBe(false);
  expect(params.get('limit')).toBe('200');
  view.rerender({ districts: ['00110', '00140'], loading: false });
  act(() => view.result.current.onViewportChange(bounds, 7));
  expect(fetch).toHaveBeenCalledOnce();
});

function pageResponse(
  url: string,
  totalCount: number,
  options: {
    batch?: string;
    duplicate?: boolean;
  } = {},
) {
  const request = new URL(url, 'http://localhost');
  const offset = Number(request.searchParams.get('offset'));
  const limit = Number(request.searchParams.get('limit'));
  const items = Array.from(
    { length: Math.min(limit, Math.max(0, totalCount - offset)) },
    (_, index) => ({
      ...cafe,
      bizesId:
        options.duplicate && index === 0 ? '1' : String(offset + index + 1),
      ...(request.pathname.endsWith('/nearby')
        ? { distanceM: offset + index }
        : {}),
    }),
  );
  return Response.json({
    items,
    totalCount,
    limit,
    offset,
    hasMore: offset + items.length < totalCount,
    sourceBatch: {
      batchId: options.batch ?? '00000000-0000-0000-0000-000000000004',
      publishedAt: '2026-10-02T00:00:00Z',
    },
  });
}

test.each([0, 1, 9, 10, 11, 21, 40, 50, 51, 200])(
  '서버 결과 %i건을 10개 단위로 교체한다',
  async (totalCount) => {
    const fetch = vi.fn(async (url: string) => pageResponse(url, totalCount));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useCafeExplorer('11110', '', false));
    act(() => result.current.onViewportChange(bounds, 7));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const last = Math.ceil(totalCount / 10);
    expect(result.current.pagination.totalPages).toBe(last);
    expect(result.current.pagination.items).toHaveLength(
      Math.min(totalCount, 10),
    );
    if (last > 1) {
      act(() => result.current.pagination.goTo(last));
      expect(
        result.current.pagination.items.map(({ bizesId }) => bizesId),
      ).toEqual(
        Array.from({ length: totalCount - (last - 1) * 10 }, (_, index) =>
          String((last - 1) * 10 + index + 1),
        ),
      );
    } else expect(result.current.pagination.goTo(2)).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  },
);

test('반경 거리순과 지도용 200건을 보존하고 추가 묶음을 재사용한다', async () => {
  const fetch = vi.fn(async (url: string) => pageResponse(url, 231));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() =>
    useCafeExplorer('11110', '11110515', false),
  );
  act(() => {
    result.current.setMode('nearby');
    result.current.selectCenter({ longitude: 126.978, latitude: 37.5665 });
  });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  const markers = result.current.items;
  act(() => result.current.pagination.goTo(20));
  expect(result.current.pagination.items[0].bizesId).toBe('191');
  expect(fetch).toHaveBeenCalledOnce();
  act(() => result.current.pagination.goTo(21));
  await waitFor(() => expect(result.current.pagination.items).toHaveLength(10));
  const first = result.current.pagination.items[0];
  expect(first.bizesId).toBe('201');
  expect(first.distanceM).toBe(200);
  expect(result.current.items).toBe(markers);
  expect(markers).toHaveLength(200);
  act(() => result.current.selectListCafe(first));
  expect(result.current.listOnlyCafe).toBe(first);
  expect(result.current.selected).toBeNull();

  act(() => result.current.pagination.goTo(24));
  expect(result.current.pagination.items.map(({ bizesId }) => bizesId)).toEqual(
    ['231'],
  );
  act(() => result.current.pagination.goTo(2));
  act(() => result.current.pagination.goTo(21));
  expect(result.current.pagination.items[0].bizesId).toBe('201');
  expect(
    fetch.mock.calls.map(([url]) =>
      new URL(url, 'http://localhost').searchParams.get('offset'),
    ),
  ).toEqual(['0', '200']);
  expect(fetch.mock.calls.every(([url]) => !url.includes('Codes'))).toBe(true);

  act(() => result.current.setRadiusM(1000));
  expect(result.current.pagination.page).toBe(1);
  await waitFor(() =>
    expect(result.current.pagination.items[0]?.bizesId).toBe('1'),
  );
  act(() => result.current.pagination.goTo(3));
  act(() => result.current.selectCenter({ longitude: 127, latitude: 37.55 }));
  expect(result.current.pagination.page).toBe(1);
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => result.current.pagination.goTo(3));
  act(() => result.current.setMode('viewport'));
  expect(result.current.pagination.page).toBe(1);
});

test('추가 자료 실패는 해당 묶음만 재시도하고 다른 게시본은 첫 페이지에서 다시 시작한다', async () => {
  const nextBatch = '00000000-0000-0000-0000-000000000005';
  let attempt = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('offset=200')) {
      attempt++;
      if (attempt === 1)
        return Response.json({ code: 'DATA_NOT_READY' }, { status: 503 });
      if (attempt === 2) return pageResponse(url, 201, { duplicate: true });
      return pageResponse(url, 201, { batch: nextBatch });
    }
    return pageResponse(url, 201, {
      batch: attempt === 3 ? nextBatch : undefined,
    });
  });
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useCafeExplorer('11110', '', false));
  act(() => result.current.onViewportChange(bounds, 7));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  const markers = result.current.items;
  act(() => result.current.pagination.goTo(21));
  await waitFor(() =>
    expect(result.current.pagination.error).toContain('준비'),
  );
  expect(result.current.status).toBe('ready');
  act(() => result.current.pagination.retry());
  await waitFor(() =>
    expect(result.current.pagination.error).toContain('중복'),
  );
  act(() => result.current.pagination.retry());
  await waitFor(() => expect(result.current.pagination.changed).toBe(true));
  expect(result.current.pagination.items).toEqual([]);
  expect(result.current.items).toBe(markers);
  expect(fetch).toHaveBeenCalledTimes(4);
  act(() => result.current.pagination.restart());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.pagination.page).toBe(1);
  expect(result.current.data?.sourceBatch.batchId).toBe(nextBatch);
  expect(fetch.mock.calls.at(-1)?.[0]).toContain('offset=0');
});

test('빠른 페이지 전환과 지역·지도 이동이 오래된 묶음을 취소한다', async () => {
  const pending: {
    url: string;
    signal: AbortSignal;
    finish: (response: Response) => void;
  }[] = [];
  const fetch = vi.fn((url: string, { signal }: RequestInit) =>
    url.includes('offset=0')
      ? Promise.resolve(pageResponse(url, 451))
      : new Promise<Response>((finish) =>
          pending.push({ url, signal: signal!, finish }),
        ),
  );
  vi.stubGlobal('fetch', fetch);
  const view = renderHook(
    ({ district }) => useCafeExplorer(district, '', false),
    { initialProps: { district: '11110' } },
  );
  const { result } = view;
  act(() => result.current.onViewportChange(bounds, 7));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => result.current.pagination.goTo(21));
  act(() => result.current.pagination.goTo(22));
  expect(pending).toHaveLength(1);
  act(() => result.current.pagination.goTo(41));
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => pending[1].finish(pageResponse(pending[1].url, 451)));
  await act(async () => pending[0].finish(pageResponse(pending[0].url, 451)));
  expect(result.current.pagination.items[0].bizesId).toBe('401');

  act(() => result.current.pagination.goTo(21));
  view.rerender({ district: '11140' });
  expect(pending[2].signal.aborted).toBe(true);
  expect(result.current.pagination.page).toBe(1);
  await act(async () => pending[2].finish(pageResponse(pending[2].url, 451)));
  act(() => result.current.onViewportChange(bounds, 7));
  await waitFor(() =>
    expect(result.current.pagination.items[0]?.bizesId).toBe('1'),
  );
  act(() => result.current.pagination.goTo(21));
  act(() => result.current.onViewportChange({ ...bounds, west: 126.98 }, 7));
  expect(pending[3].signal.aborted).toBe(true);
  await waitFor(() =>
    expect(result.current.pagination.items[0]?.bizesId).toBe('1'),
  );
  expect(result.current.pagination.page).toBe(1);
});

test('백엔드 offset 상한 뒤의 카페 수와 마지막 이동 가능 페이지를 구분한다', async () => {
  const fetch = vi.fn(async (url: string) => pageResponse(url, 101000));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useCafeExplorer('11110', '', false));
  act(() => result.current.onViewportChange(bounds, 7));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.pagination.totalPages).toBe(10100);
  expect(result.current.pagination.lastPage).toBe(10020);
  act(() => result.current.pagination.goTo(10020));
  await waitFor(() =>
    expect(result.current.pagination.items[0]?.bizesId).toBe('100191'),
  );
  expect(fetch.mock.calls.at(-1)?.[0]).toContain('offset=100000');
  expect(result.current.pagination.goTo(10021)).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
});
