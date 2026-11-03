import { StrictMode } from 'react';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  loadKakaoMaps,
  type KakaoMaps,
  type KakaoLatLng,
  type KakaoBounds,
  type KakaoPolygonOptions,
} from '@/lib/kakao-maps';
import { KakaoMapView } from './kakao-map';
import App from '@/App';
import { useCafeMap } from '@/hooks/use-cafe-map';
import type { CafeExplorer } from '@/hooks/use-cafe-explorer';
import type { RegionMapTarget } from '@/lib/regions';

const polygonTarget = {
  kind: 'boundary',
  extent: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [126.9, 37.5],
        [127.1, 37.5],
        [127.1, 37.6],
        [126.9, 37.5],
      ],
    ],
  },
} as const;

vi.mock('@/lib/kakao-maps', () => ({ loadKakaoMaps: vi.fn() }));
const load = vi.mocked(loadKakaoMaps);
const disconnect = vi.fn();
let resize: ResizeObserverCallback;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-key');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ items: [] }))),
      ),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) =>
    window.clearTimeout(id),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** 지도 API 경계만 대체하고 컴포넌트의 실제 비동기 흐름과 사용자 조작을 검증합니다. */
function createSdk() {
  let level = 5;
  const handlers = new Map<string, () => void>();
  let center = { getLat: () => 37.5665, getLng: () => 126.978 };
  const map = {
    getBounds: vi.fn((): KakaoBounds => ({
      getSouthWest: () => ({ getLat: () => 37.55, getLng: () => 126.97 }),
      getNorthEast: () => ({ getLat: () => 37.57, getLng: () => 126.99 }),
    })),
    setBounds: vi.fn((bounds: KakaoBounds) => {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      center = {
        getLat: () => (sw.getLat() + ne.getLat()) / 2,
        getLng: () => (sw.getLng() + ne.getLng()) / 2,
      };
      level = 7;
      handlers.get('center_changed')?.();
      handlers.get('zoom_changed')?.();
    }),
    panBy: vi.fn(),
    getLevel: () => level,
    setLevel: vi.fn((next: number) => {
      level = next;
      handlers.get('zoom_changed')?.();
    }),
    getCenter: () => center,
    setCenter: vi.fn((next: typeof center) => {
      center = next;
      handlers.get('center_changed')?.();
    }),
    relayout: vi.fn(),
  };
  const maps = {
    load: vi.fn(),
    LatLng: vi.fn(function (latitude: number, longitude: number) {
      return { getLat: () => latitude, getLng: () => longitude };
    }),
    LatLngBounds: vi.fn(function (sw: KakaoLatLng, ne: KakaoLatLng) {
      return { getSouthWest: () => sw, getNorthEast: () => ne };
    }),
    Polygon: vi.fn(function (options: KakaoPolygonOptions) {
      return { path: options.path, setMap: vi.fn() };
    }),
    Marker: vi.fn(function (options: { position: KakaoLatLng; title: string }) {
      return { ...options, setMap: vi.fn() };
    }),
    InfoWindow: vi.fn(function () {
      return { open: vi.fn(), close: vi.fn(), setContent: vi.fn() };
    }),
    Map: vi.fn(function () {
      return map;
    }),
    event: {
      addListener: vi.fn((_target, type, handler) =>
        handlers.set(type, handler),
      ),
      removeListener: vi.fn((_target, type) => handlers.delete(type)),
    },
  } satisfies KakaoMaps;
  return { maps, map };
}

test('최초 영역·idle 재조회와 목록 선택은 마커·안전한 정보창을 표시하고 전체 자원을 정리한다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  const cafe = {
    bizesId: '0001',
    storeName: '<img src=x onerror=alert(1)>',
    branchName: '시청점',
    semasIndustryCode: 'I21201',
    semasIndustryName: '카페',
    roadAddress: '<script>alert(1)</script>',
    lotAddress: null,
    longitude: 126.978,
    latitude: 37.5665,
  };
  let empty = false;
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.startsWith('/api/v1/cafes/viewport')
            ? {
                items: empty
                  ? []
                  : [
                      cafe,
                      {
                        ...cafe,
                        bizesId: '0002',
                        storeName: '주소 없는 카페',
                        branchName: null,
                        roadAddress: null,
                      },
                    ],
                totalCount: empty ? 0 : 301,
                limit: 200,
                offset: 0,
                hasMore: !empty,
                sourceBatch: {
                  batchId: '00000000-0000-0000-0000-000000000004',
                  publishedAt: '2026-10-02T00:00:00Z',
                },
              }
            : { items: [] },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled(),
  );
  expect(screen.getByText(/자치구를 선택하거나 지도를 확대하면/)).toBeVisible();
  expect(maps.Marker).not.toHaveBeenCalled();
  await waitFor(() => expect(map.setCenter).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
  const idleAfterZoom = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === map && type === 'idle',
  )![2];
  act(() => idleAfterZoom());
  await screen.findByRole('button', { name: /<img src=x/ });
  expect(screen.getByText('전체 301곳 중 2곳 표시')).toBeVisible();
  expect(screen.getByText(/최대 200곳/)).toBeVisible();
  expect(maps.Marker).toHaveBeenCalledTimes(2);
  const marker = maps.Marker.mock.results[0].value;
  expect(marker.setMap).toHaveBeenCalledWith(map);
  fireEvent.click(screen.getByRole('button', { name: /<img src=x/ }));
  const info = maps.InfoWindow.mock.results.at(-1)!.value;
  expect(maps.InfoWindow).toHaveBeenCalledWith({
    disableAutoPan: false,
    removable: true,
  });
  expect(info.open).toHaveBeenCalledWith(map, marker);
  const content = info.setContent.mock.calls.at(-1)![0] as HTMLElement;
  expect(content.textContent).toContain(cafe.storeName);
  expect(content.textContent).toContain(cafe.roadAddress);
  expect(content.querySelector('strong')?.textContent).toBe(
    `${cafe.storeName} · 시청점`,
  );
  expect(content.textContent).toContain('기존 경쟁 카페');
  expect(content.textContent).toContain('브랜드 구분 정보 없음');
  expect(content.textContent).toContain('카페');
  expect(content.className).toContain('overflow-wrap:anywhere');
  expect(content.className).toContain('100vw-4rem');
  expect(content.querySelector('img,script')).toBeNull();
  const otherMarker = maps.Marker.mock.results[1].value;
  const click = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === otherMarker && type === 'click',
  )![2];
  act(() => click());
  expect(info.open).toHaveBeenLastCalledWith(map, otherMarker);
  expect(info.close).toHaveBeenCalledTimes(2);
  expect(
    (info.setContent.mock.calls.at(-1)![0] as HTMLElement).textContent,
  ).toContain('주소 정보가 없습니다.');
  expect(map.setCenter).toHaveBeenCalledTimes(1);
  const cafeCalls = () =>
    fetch.mock.calls.filter(([url]) =>
      url.startsWith('/api/v1/cafes/viewport'),
    );
  expect(
    new URL(cafeCalls()[0][0], 'http://localhost').searchParams.get('west'),
  ).toBe('126.97');
  const idle = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === map && type === 'idle',
  )![2];
  act(() => idle());
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(cafeCalls()).toHaveLength(1);
  map.getBounds.mockReturnValue({
    getSouthWest: () => ({ getLat: () => 37.5, getLng: () => 126.9 }),
    getNorthEast: () => ({ getLat: () => 37.6, getLng: () => 127 }),
  });
  act(() => idle());
  await waitFor(() => expect(cafeCalls()).toHaveLength(2));
  expect(marker.setMap).toHaveBeenLastCalledWith(map);
  expect(maps.Marker).toHaveBeenCalledTimes(2);
  expect(info.open).toHaveBeenCalledTimes(2);
  empty = true;
  map.getBounds.mockReturnValue({
    getSouthWest: () => ({ getLat: () => 37.4, getLng: () => 126.8 }),
    getNorthEast: () => ({ getLat: () => 37.6, getLng: () => 127 }),
  });
  act(() => idle());
  await screen.findByText('현재 지도 영역에 조회된 카페가 없습니다.');
  expect(marker.setMap).toHaveBeenLastCalledWith(null);
  expect(info.close).toHaveBeenCalled();
  empty = false;
  act(() => {
    map.setLevel(5);
    idle();
  });
  await screen.findByText(/자치구를 선택하거나 지도를 확대하면/);
  expect(cafeCalls()).toHaveLength(3);
  expect(
    screen.queryByText('현재 지도 영역에 조회된 카페가 없습니다.'),
  ).not.toBeInTheDocument();
  view.unmount();
  expect(
    maps.Marker.mock.results.at(-1)!.value.setMap,
  ).toHaveBeenLastCalledWith(null);
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    marker,
    'click',
    expect.any(Function),
  );
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    map,
    'idle',
    expect.any(Function),
  );
  expect(maps.Map).toHaveBeenCalledOnce();
});

test('카페 조회 실패는 지도·경계 탐색을 막지 않고 재시도로 빈 결과를 안내한다', async () => {
  const { maps, map } = createSdk();
  load.mockRejectedValue(new Error('sdk'));
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.startsWith('/api/v1/cafes/viewport')
              ? fail
                ? { code: 'DATA_NOT_READY' }
                : {
                    items: [],
                    totalCount: 0,
                    limit: 200,
                    offset: 0,
                    hasMore: false,
                    sourceBatch: {
                      batchId: '00000000-0000-0000-0000-000000000004',
                      publishedAt: '2026-10-02T00:00:00Z',
                    },
                  }
              : { items: [] },
          ),
          {
            status:
              url.startsWith('/api/v1/cafes/viewport') && fail ? 503 : 200,
          },
        ),
    ),
  );
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByText('지도를 불러오지 못했습니다');
  load.mockResolvedValue(maps);
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled(),
  );
  await waitFor(() => expect(map.setCenter).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
  act(() =>
    maps.event.addListener.mock.calls.find(
      ([target, type]) => target === map && type === 'idle',
    )![2](),
  );
  await screen.findByText(/카페 데이터가 아직 준비되지/);
  expect(map.getLevel()).toBe(4);
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '카페 목록 다시 시도' }));
  expect(
    await screen.findByText('현재 지도 영역에 조회된 카페가 없습니다.'),
  ).toBeVisible();
  expect(maps.Marker).not.toHaveBeenCalled();
  view.unmount();
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    map,
    'idle',
    expect.any(Function),
  );
});

test('지도 재초기화 시 카페 마커·정보창·클릭 리스너를 정리한다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.startsWith('/api/v1/cafes/viewport')
              ? {
                  items: [
                    {
                      bizesId: '001',
                      storeName: '시청 카페',
                      branchName: null,
                      semasIndustryCode: 'I21201',
                      semasIndustryName: '카페',
                      roadAddress: null,
                      lotAddress: null,
                      longitude: 126.981,
                      latitude: 37.568,
                    },
                  ],
                  totalCount: 1,
                  limit: 200,
                  offset: 0,
                  hasMore: false,
                  sourceBatch: {
                    batchId: '00000000-0000-0000-0000-000000000004',
                    publishedAt: '2026-10-02T00:00:00Z',
                  },
                }
              : { items: [] },
          ),
        ),
    ),
  );
  const view = render(<App />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled(),
  );
  await waitFor(() => expect(map.setCenter).toHaveBeenCalled());
  act(() => {
    map.setLevel(4);
    maps.event.addListener.mock.calls.find(
      ([target, type]) => target === map && type === 'idle',
    )![2]();
  });
  await waitFor(() => expect(maps.Marker).toHaveBeenCalledOnce());
  expect(maps.LatLng).toHaveBeenCalledWith(37.568, 126.981);
  const marker = maps.Marker.mock.results[0].value;
  const info = maps.InfoWindow.mock.results.at(-1)!.value;
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'another-test-key');
  view.rerender(<App />);
  expect(marker.setMap).toHaveBeenLastCalledWith(null);
  expect(info.close).toHaveBeenCalled();
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    marker,
    'click',
    expect.any(Function),
  );
  await waitFor(() => expect(map.setCenter).toHaveBeenCalledTimes(2));
  act(() => {
    map.setLevel(4);
    maps.event.addListener.mock.calls.findLast(
      ([target, type]) => target === map && type === 'idle',
    )![2]();
  });
  await waitFor(() => expect(maps.Marker).toHaveBeenCalledTimes(2));
  expect(maps.Map).toHaveBeenCalledTimes(2);
});

test('로딩 중 상태를 표시한 뒤 StrictMode에서도 지도를 한 번 초기화한다', async () => {
  const { maps, map } = createSdk();
  let resolve!: (maps: KakaoMaps) => void;
  load.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(
    <StrictMode>
      <KakaoMapView />
    </StrictMode>,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    '서울 지도를 불러오고 있습니다',
  );
  expect(screen.getByRole('button', { name: '지도 확대' })).toBeDisabled();
  await act(async () => resolve(maps));
  expect(maps.Map).toHaveBeenCalledOnce();
  expect(maps.LatLng).toHaveBeenCalledWith(37.5665, 126.978);
  expect(maps.Map).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    expect.objectContaining({ level: 5 }),
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
  expect(map.setLevel).toHaveBeenLastCalledWith(4);
  fireEvent.click(screen.getByRole('button', { name: '지도 축소' }));
  expect(map.setLevel).toHaveBeenLastCalledWith(5);
  act(() => resize([], {} as ResizeObserver));
  expect(map.relayout).toHaveBeenCalledOnce();
  expect(map.setCenter).toHaveBeenCalledWith(map.getCenter());
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    map,
    'zoom_changed',
    expect.any(Function),
  );
});

test('경계 범위로 이동한 뒤 relayout에도 중심을 유지하고 전체 선택은 기본 위치로 돌아간다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  const view = render(<KakaoMapView target={polygonTarget} />);
  await waitFor(() => expect(map.setBounds).toHaveBeenCalledOnce());
  expect(maps.LatLng).toHaveBeenCalledWith(37.5, 126.9);
  expect(maps.LatLng).toHaveBeenCalledWith(37.6, 127.1);
  const fittedCenter = map.getCenter();
  act(() => resize([], {} as ResizeObserver));
  expect(map.setCenter).toHaveBeenLastCalledWith(fittedCenter);
  view.rerender(<KakaoMapView target={{ kind: 'default' }} />);
  await waitFor(() => expect(map.getCenter().getLat()).toBe(37.5665));
  expect(map.getCenter().getLng()).toBe(126.978);
  expect(map.getLevel()).toBe(5);
  expect(maps.Map).toHaveBeenCalledOnce();
});

test('MultiPolygon의 각 영역과 내부 링을 위도·경도 순서로 그린다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  const target = {
    kind: 'boundary',
    extent: polygonTarget.extent,
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [126.9, 37.5],
            [127, 37.5],
            [127, 37.6],
            [126.9, 37.5],
          ],
          [
            [126.92, 37.52],
            [126.94, 37.52],
            [126.94, 37.54],
            [126.92, 37.52],
          ],
        ],
        [
          [
            [127.05, 37.55],
            [127.1, 37.55],
            [127.1, 37.6],
            [127.05, 37.55],
          ],
        ],
      ],
    },
  } satisfies RegionMapTarget;
  const view = render(
    <StrictMode>
      <KakaoMapView target={target} />
    </StrictMode>,
  );
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledTimes(2));
  const paths = maps.Polygon.mock.calls.map(([options]) =>
    options.path.map((ring) =>
      ring.map((point) => [point.getLat(), point.getLng()]),
    ),
  );
  expect(paths).toEqual([
    [
      [
        [37.5, 126.9],
        [37.5, 127],
        [37.6, 127],
        [37.5, 126.9],
      ],
      [
        [37.52, 126.92],
        [37.52, 126.94],
        [37.54, 126.94],
        [37.52, 126.92],
      ],
    ],
    [
      [
        [37.55, 127.05],
        [37.55, 127.1],
        [37.6, 127.1],
        [37.55, 127.05],
      ],
    ],
  ]);
  const overlays = maps.Polygon.mock.results.map((result) => result.value);
  overlays.forEach((overlay) =>
    expect(overlay.setMap).toHaveBeenCalledWith(map),
  );
  view.rerender(
    <StrictMode>
      <KakaoMapView target={target} />
    </StrictMode>,
  );
  act(() => resize([], {} as ResizeObserver));
  fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
  expect(maps.Polygon).toHaveBeenCalledTimes(2);
  view.unmount();
  overlays.forEach((overlay) =>
    expect(overlay.setMap).toHaveBeenLastCalledWith(null),
  );
  expect(maps.Map).toHaveBeenCalledOnce();
});

test('경계 교체·조회 중·전체 선택에서 이전 오버레이를 즉시 제거한다', async () => {
  const { maps } = createSdk();
  load.mockResolvedValue(maps);
  const view = render(<KakaoMapView target={polygonTarget} />);
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledOnce());
  const first = maps.Polygon.mock.results[0].value;
  const other = { ...polygonTarget, geometry: { ...polygonTarget.geometry } };
  view.rerender(<KakaoMapView target={other} />);
  expect(first.setMap).toHaveBeenLastCalledWith(null);
  expect(maps.Polygon).toHaveBeenCalledTimes(2);
  const second = maps.Polygon.mock.results[1].value;
  view.rerender(<KakaoMapView target={null} />);
  expect(second.setMap).toHaveBeenLastCalledWith(null);
  view.rerender(<KakaoMapView target={polygonTarget} />);
  const third = maps.Polygon.mock.results[2].value;
  view.rerender(<KakaoMapView target={{ kind: 'default' }} />);
  expect(third.setMap).toHaveBeenLastCalledWith(null);
  await waitFor(() =>
    expect(maps.Map.mock.results[0].value.getLevel()).toBe(5),
  );
});

test('API 선택 변경·실패·늦은 응답에서도 최신 경계만 표시하고 패널 전환은 재생성하지 않는다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  let finishOld!: (response: Response) => void;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  const feature = (id: string, regionType: string) => ({
    type: 'Feature',
    id,
    properties: { regionCode: id, regionType },
    geometry: polygonTarget.geometry,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/v1/districts')
        return json({
          items: [
            { districtCode: '11110', districtName: '종로구' },
            { districtCode: '11140', districtName: '중구' },
          ],
        });
      if (url.endsWith('/dongs'))
        return json({
          items: [
            {
              districtCode: url.split('/')[4],
              dongCode: `${url.split('/')[4]}001`,
              dongName: '선택동',
              labelPoint: { type: 'Point', coordinates: [127, 37] },
            },
          ],
        });
      if (url.includes('/dongs/'))
        return new Promise<Response>((resolve) => {
          finishOld = resolve;
        });
      if (url.includes('11140')) return json({ code: 'DATA_NOT_READY' }, 503);
      return json(feature('11110', 'DISTRICT'));
    }),
  );
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색' }));
  await screen.findByRole('option', { name: '종로구' });
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11110' },
  });
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledOnce());
  const first = maps.Polygon.mock.results[0].value;
  await screen.findByRole('option', { name: '선택동' });
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색 패널 닫기' }));
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색' }));
  expect(maps.Polygon).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '11110001' },
  });
  expect(first.setMap).toHaveBeenLastCalledWith(null);
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11140' },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('선택 지역 경계');
  await act(async () => finishOld(json(feature('11110001', 'DONG'))));
  expect(maps.Polygon).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11110' },
  });
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '11110001' },
  });
  await act(async () => finishOld(json(feature('11110001', 'DONG'))));
  expect(maps.Polygon).toHaveBeenCalledTimes(3);
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '' },
  });
  expect(maps.Polygon.mock.results[2].value.setMap).toHaveBeenLastCalledWith(
    null,
  );
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledTimes(4));
  expect(maps.Polygon.mock.results[3].value.setMap).toHaveBeenCalledWith(map);
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '' },
  });
  expect(maps.Polygon.mock.results[3].value.setMap).toHaveBeenLastCalledWith(
    null,
  );
  expect(maps.Map).toHaveBeenCalledOnce();
});

test('일부 오버레이를 만든 뒤 SDK가 실패하면 정리하고 재시도에서 선택 경계를 복원한다', async () => {
  const { maps } = createSdk();
  const construct = maps.Polygon.getMockImplementation()!;
  maps.Polygon.mockImplementationOnce(construct).mockImplementationOnce(
    function () {
      throw new Error('polygon');
    },
  );
  load.mockResolvedValue(maps);
  const target = {
    ...polygonTarget,
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        polygonTarget.geometry.coordinates,
        polygonTarget.geometry.coordinates,
      ],
    },
  } as const;
  const view = render(<KakaoMapView target={target} />);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(maps.Polygon.mock.results[0].value.setMap).toHaveBeenLastCalledWith(
    null,
  );
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledTimes(4));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.unmount();
  for (const index of [2, 3])
    expect(
      maps.Polygon.mock.results[index].value.setMap,
    ).toHaveBeenLastCalledWith(null);
});

test('지도 재초기화 시 이전 오버레이를 제거하고 새 지도에 선택 경계를 표시한다', async () => {
  const { maps } = createSdk();
  load.mockResolvedValue(maps);
  const view = render(<KakaoMapView target={polygonTarget} />);
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledOnce());
  const first = maps.Polygon.mock.results[0].value;
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'another-test-key');
  view.rerender(<KakaoMapView target={polygonTarget} />);
  expect(first.setMap).toHaveBeenLastCalledWith(null);
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledTimes(2));
  expect(maps.Map).toHaveBeenCalledTimes(2);
});

test('SDK 실패 안내에서 재시도하면 로딩을 거쳐 지도가 준비된다', async () => {
  const { maps } = createSdk();
  load.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(maps);
  render(<KakaoMapView />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '지도를 불러오지 못했습니다',
  );
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(screen.getByRole('status')).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled(),
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(2);
});

test('SDK 준비 전에 언마운트되면 지도를 초기화하지 않는다', async () => {
  const { maps } = createSdk();
  let resolve!: (maps: KakaoMaps) => void;
  load.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<KakaoMapView />);
  view.unmount();
  await act(async () => resolve(maps));
  expect(maps.Map).not.toHaveBeenCalled();
});

test('최대 확대·축소 단계에서 해당 버튼을 비활성화한다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  render(<KakaoMapView />);
  await act(async () => {});
  act(() => map.setLevel(1));
  expect(screen.getByRole('button', { name: '지도 확대' })).toBeDisabled();
  act(() => map.setLevel(14));
  expect(screen.getByRole('button', { name: '지도 축소' })).toBeDisabled();
});

test('지도 생성 자체가 실패해도 오류 안내와 재시도를 제공한다', async () => {
  const { maps } = createSdk();
  maps.Map.mockImplementationOnce(function () {
    throw new Error('map');
  });
  load.mockResolvedValue(maps);
  render(<KakaoMapView />);
  expect(await screen.findByRole('alert')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await act(async () => {});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(maps.Map).toHaveBeenCalledTimes(2);
});

test('상세 패널을 열고 전환하고 닫아도 같은 지도에서 크기와 중심을 갱신한다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  render(<App />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled(),
  );
  const container = screen.getByLabelText('Kakao Maps 지도');
  for (const name of ['지역 탐색', '상권 분석', '상권 분석']) {
    fireEvent.click(screen.getByRole('button', { name }));
    // jsdom에는 레이아웃이 없어 브라우저의 크기 변경 알림을 직접 전달합니다.
    act(() => resize([], {} as ResizeObserver));
    expect(screen.getByLabelText('Kakao Maps 지도')).toBe(container);
  }
  expect(maps.Map).toHaveBeenCalledOnce();
  expect(map.relayout).toHaveBeenCalledTimes(3);
  expect(map.setCenter).toHaveBeenLastCalledWith(map.getCenter());
});

test('크기 변경으로 SDK 중심이 바뀌어도 마지막 사용자 탐색 위치를 유지한다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  const view = render(<KakaoMapView />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled(),
  );
  const container = screen.getByLabelText('Kakao Maps 지도');
  const initialCenter = map.getCenter();
  const shiftedCenter = { getLat: () => 37.58, getLng: () => 126.97 };
  // SDK가 DOM 크기 변경 직후 중심을 재계산하는 실제 브라우저 동작을 재현합니다.
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    value: 390,
  });
  act(() => map.setCenter(shiftedCenter));
  act(() => resize([], {} as ResizeObserver));
  expect(map.setCenter).toHaveBeenLastCalledWith(initialCenter);

  const exploredCenter = { getLat: () => 37.55, getLng: () => 126.99 };
  act(() => map.setCenter(exploredCenter));
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    value: 320,
  });
  act(() => map.setCenter(shiftedCenter));
  act(() => resize([], {} as ResizeObserver));
  expect(map.setCenter).toHaveBeenLastCalledWith(exploredCenter);
  view.unmount();
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    map,
    'center_changed',
    expect.any(Function),
  );
});

test('같은 크기의 반복 relayout에서도 SDK 반올림 좌표가 누적되지 않는다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  render(<KakaoMapView />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled(),
  );
  const original = map.getCenter();
  // SDK가 setCenter 이벤트에서 픽셀 반올림된 좌표를 반환하는 경우를 재현합니다.
  vi.spyOn(map, 'getCenter').mockReturnValue({
    getLat: () => 37.56649,
    getLng: () => 126.97799,
  });
  act(() => resize([], {} as ResizeObserver));
  act(() => resize([], {} as ResizeObserver));
  expect(map.setCenter).toHaveBeenLastCalledWith(original);
});

test('구·동 변경은 즉시 이전 마커를 정리하고 늦은 동 응답을 버리며 전체는 초기 정책으로 돌아간다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  const json = (data: unknown) => new Response(JSON.stringify(data));
  let finishDong!: (response: Response) => void;
  const page = (id: string) => ({
    items: [
      {
        bizesId: id,
        storeName: id,
        branchName: null,
        semasIndustryCode: 'I21201',
        semasIndustryName: '커피 전문점',
        roadAddress: null,
        lotAddress: null,
        longitude: 127,
        latitude: 37,
      },
    ],
    totalCount: 1,
    limit: 200,
    offset: 0,
    hasMore: false,
    sourceBatch: {
      batchId: '00000000-0000-0000-0000-000000000004',
      publishedAt: '2026-10-02T00:00:00Z',
    },
  });
  const fetch = vi.fn(async (url: string): Promise<Response> => {
    if (url.startsWith('/api/v1/cafes/')) {
      if (url.includes('dongCodes='))
        return new Promise((resolve) => {
          finishDong = resolve;
        });
      return json(page(url.includes('11140') ? '중구 카페' : '종로 카페'));
    }
    if (url === '/api/v1/districts')
      return json({
        items: [
          { districtCode: '11110', districtName: '종로구' },
          { districtCode: '11140', districtName: '중구' },
        ],
      });
    if (url.endsWith('/dongs'))
      return json({
        items: [
          {
            districtCode: '11110',
            dongCode: '11110515',
            dongName: '청운효자동',
            labelPoint: { type: 'Point', coordinates: [127, 37] },
          },
        ],
      });
    const code = url.split('/')[4];
    return json({
      type: 'Feature',
      id: code,
      properties: {
        regionCode: code,
        regionType: url.includes('/dongs/') ? 'DONG' : 'DISTRICT',
      },
      geometry: polygonTarget.geometry,
    });
  });
  vi.stubGlobal('fetch', fetch);
  const view = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색' }));
  await screen.findByRole('option', { name: '종로구' });
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11110' },
  });
  await waitFor(() => expect(maps.Marker).toHaveBeenCalledOnce());
  const first = maps.Marker.mock.results[0].value;
  await screen.findByRole('option', { name: '청운효자동' });
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '11110515' },
  });
  expect(first.setMap).toHaveBeenLastCalledWith(null);
  await waitFor(() => expect(finishDong).toBeDefined());
  const pending = fetch.mock.calls.find(([url]) =>
    url.includes('dongCodes='),
  )![0];
  expect(pending).toContain('districtCodes=11110');
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11140' },
  });
  await waitFor(() => expect(maps.Marker).toHaveBeenCalledTimes(2));
  await act(async () => finishDong(json(page('오래된 동 카페'))));
  expect(maps.Marker).toHaveBeenCalledTimes(2);
  expect(maps.Marker.mock.calls[1][0].title).toBe('중구 카페');
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '' },
  });
  expect(maps.Marker.mock.results[1].value.setMap).toHaveBeenLastCalledWith(
    null,
  );
  await waitFor(() => expect(map.getLevel()).toBe(5));
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  await screen.findByText(/자치구를 선택하거나 지도를 확대하면/);
  expect(
    maps.Polygon.mock.results.at(-1)!.value.setMap,
  ).toHaveBeenLastCalledWith(null);
  expect(maps.Map).toHaveBeenCalledOnce();
  view.unmount();
});

test('긴 정보창이 고정 검색창과 겹치면 사용자 선택 시에만 아래쪽 여백을 확보한다', async () => {
  const { map, maps } = createSdk();
  const search = render(<div role="search" aria-label="장소 검색" />);
  vi.spyOn(search.getByRole('search'), 'getBoundingClientRect').mockReturnValue(
    new DOMRect(16, 16, 256, 48),
  );
  let content!: HTMLElement;
  maps.InfoWindow.mockImplementation(function () {
    return {
      setContent: vi.fn((node: HTMLElement) => {
        content = node;
      }),
      open: vi.fn(() => {
        document.body.append(content);
        vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(
          new DOMRect(80, 10, 240, 250),
        );
      }),
      close: vi.fn(() => content?.remove()),
    };
  });
  const cafe = {
    bizesId: '001',
    storeName: '안전한 이름',
    branchName: null,
    semasIndustryCode: 'I21201',
    semasIndustryName: '카페',
    roadAddress: '공백없는긴주소'.repeat(40),
    lotAddress: null,
    longitude: 126.978,
    latitude: 37.5665,
  };
  const cafes: CafeExplorer = {
    status: 'ready',
    data: null,
    error: null,
    retry: vi.fn(),
    needsZoom: false,
    items: [cafe],
    selected: { bizesId: '001', scopeKey: ':', revision: 1 },
    selectCafe: vi.fn(),
    onViewportChange: vi.fn(),
    scopeKey: ':',
  };
  const context = { map, maps };
  const moving = { current: false };
  const notify = { current: null };
  const view = renderHook(() =>
    useCafeMap(context, moving, notify, undefined, cafes),
  );
  await waitFor(() => expect(map.panBy).toHaveBeenCalledWith(0, -66));
  expect(map.panBy).toHaveBeenCalledOnce();
  expect(content.textContent).toContain(cafe.roadAddress);
  view.rerender();
  expect(map.panBy).toHaveBeenCalledOnce();
  view.unmount();
  expect(content.isConnected).toBe(false);
});
