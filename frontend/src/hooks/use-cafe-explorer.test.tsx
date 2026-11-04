import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useCafeExplorer } from './use-cafe-explorer';
import type { KakaoMaps, KakaoSearchCallback } from '@/lib/kakao-maps';

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
