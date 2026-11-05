import { StrictMode } from 'react';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  loadKakaoMaps,
  type KakaoMaps,
  type KakaoLatLng,
  type KakaoBounds,
  type KakaoPolygonOptions,
  type KakaoCircleOptions,
  type KakaoMouseEvent,
  type KakaoSearchCallback,
  type KakaoMarker,
  type KakaoClustererOptions,
  type KakaoCluster,
} from '@/lib/kakao-maps';
import { KakaoMapView } from './kakao-map';
import ExploreApp from '@/App';
import { MemoryRouter } from 'react-router';
import { useCafeMap } from '@/hooks/use-cafe-map';
import { useCandidateMap } from '@/hooks/use-candidate-map';
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
  const handlers = new Map<string, Set<(event?: KakaoMouseEvent) => void>>();
  const emit = (type: string) =>
    handlers.get(type)?.forEach((handler) => handler());
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
      emit('center_changed');
      emit('zoom_changed');
    }),
    panBy: vi.fn(),
    getLevel: () => level,
    setLevel: vi.fn((next: number) => {
      level = next;
      emit('zoom_changed');
    }),
    getCenter: () => center,
    setCenter: vi.fn((next: typeof center) => {
      center = next;
      emit('center_changed');
    }),
    relayout: vi.fn(),
    getProjection: vi.fn(() => ({
      containerPointFromCoords: vi.fn(() => ({ x: 0, y: 0 })),
      coordsFromContainerPoint: vi.fn(() => center),
    })),
  };
  const maps = {
    CustomOverlay: vi.fn(function (options) {
      return { ...options, setMap: vi.fn() };
    }),
    services: {
      Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
      SortBy: { ACCURACY: 'accuracy' },
      Places: vi.fn(function () {
        return {
          keywordSearch: vi.fn(
            (_query: string, callback: KakaoSearchCallback) =>
              callback([], 'ZERO_RESULT'),
          ),
        };
      }),
      Geocoder: vi.fn(function () {
        return {
          coord2Address: vi.fn((_x, _y, callback) =>
            callback([], 'ZERO_RESULT'),
          ),
          coord2RegionCode: vi.fn(
            (_x: number, _y: number, callback: KakaoSearchCallback) =>
              callback(
                [{ region_type: 'H', region_1depth_name: '서울특별시' }],
                'OK',
              ),
          ),
          addressSearch: vi.fn(
            (_query: string, callback: KakaoSearchCallback) =>
              callback([], 'ZERO_RESULT'),
          ),
        };
      }),
    },
    load: vi.fn(),
    LatLng: vi.fn(function (latitude: number, longitude: number) {
      return { getLat: () => latitude, getLng: () => longitude };
    }),
    LatLngBounds: vi.fn(function (sw: KakaoLatLng, ne: KakaoLatLng) {
      return { getSouthWest: () => sw, getNorthEast: () => ne };
    }),
    Circle: vi.fn(function (options: KakaoCircleOptions) {
      return { ...options, setMap: vi.fn() };
    }),
    Size: vi.fn(function (width: number, height: number) {
      return { width, height };
    }),
    Point: vi.fn(function (x: number, y: number) {
      return { x, y };
    }),
    MarkerImage: vi.fn(function (
      src: string,
      size: object,
      options: { offset: object },
    ) {
      return { src, size, ...options };
    }),
    Polygon: vi.fn(function (options: KakaoPolygonOptions) {
      return { path: options.path, setMap: vi.fn() };
    }),
    Marker: vi.fn(function (options: {
      position: KakaoLatLng;
      title: string;
      zIndex?: number;
      image?: object;
    }) {
      return { ...options, setMap: vi.fn(), setZIndex: vi.fn() };
    }),
    MarkerClusterer: vi.fn(function (options: KakaoClustererOptions) {
      const managed = new Set<KakaoMarker>();
      const redraw = vi.fn(() => {
        for (const marker of managed) marker.setMap(options.map);
      });
      return {
        managed,
        addMarkers: vi.fn((markers: KakaoMarker[], nodraw = false) => {
          for (const marker of markers) managed.add(marker);
          if (!nodraw) redraw();
        }),
        removeMarkers: vi.fn((markers: KakaoMarker[], nodraw = false) => {
          for (const marker of markers) {
            managed.delete(marker);
            marker.setMap(null);
          }
          if (!nodraw) redraw();
        }),
        clear: vi.fn(() => {
          for (const marker of managed) marker.setMap(null);
          managed.clear();
        }),
        redraw,
      };
    }),
    InfoWindow: vi.fn(function (options: {
      disableAutoPan: boolean;
      removable: boolean;
    }) {
      return { options, open: vi.fn(), close: vi.fn(), setContent: vi.fn() };
    }),
    Map: vi.fn(function () {
      return map;
    }),
    event: {
      preventMap: vi.fn(),
      addListener: vi.fn((target, type, handler) => {
        if (target === map) {
          if (!handlers.has(type)) handlers.set(type, new Set());
          handlers.get(type)!.add(handler);
        }
      }),
      removeListener: vi.fn((target, type, handler) => {
        if (target === map) handlers.get(type)?.delete(handler);
      }),
    },
  } satisfies KakaoMaps;
  return { maps, map };
}

test('서울로 확인한 현재 위치로 한 번 시작하고 별도 표식을 표시한다', async () => {
  const { maps, map } = createSdk();
  const locate = vi.fn((success: PositionCallback) =>
    success({
      coords: { latitude: 37.55687, longitude: 126.92378 },
    } as GeolocationPosition),
  );
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: locate } });
  load.mockResolvedValue(maps);
  const view = render(
    <StrictMode>
      <KakaoMapView />
    </StrictMode>,
  );
  await waitFor(() => expect(locate).toHaveBeenCalledOnce());
  await waitFor(() => expect(map.getCenter().getLng()).toBe(126.92378));
  expect(map.getLevel()).toBe(3);
  expect(maps.Marker).toHaveBeenCalledWith(
    expect.objectContaining({ title: '현재 위치', zIndex: 5 }),
  );
  const count = map.setCenter.mock.calls.length;
  view.rerender(
    <StrictMode>
      <KakaoMapView />
    </StrictMode>,
  );
  expect(map.setCenter).toHaveBeenCalledTimes(count);
  expect(maps.Map).toHaveBeenCalledOnce();
});

/** 취소 API가 없는 브라우저 콜백을 원하는 순서로 완료합니다. */
function pendingPositions() {
  const pending: { success: PositionCallback; fail: PositionErrorCallback }[] =
    [];
  const locate = vi.fn(
    (success: PositionCallback, fail: PositionErrorCallback) =>
      pending.push({ success, fail }),
  );
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: locate } });
  const complete = (index = 0, longitude = 126.92378) =>
    act(() =>
      pending[index].success({
        coords: { longitude, latitude: 37.55687 },
      } as GeolocationPosition),
    );
  return { pending, locate, complete };
}
const locationSearch = {
  place: {
    id: 'user-place',
    name: '선택 장소',
    address: '서울',
    kind: '장소',
    isSeoul: true,
    longitude: 127.03,
    latitude: 37.56,
  },
  scope: 0,
  revision: 1,
};

test.each(['region', 'search', 'drag', 'candidate'] as const)(
  '늦은 자동 위치 응답은 먼저 수행한 %s 이동을 덮어쓰지 않는다',
  async (kind) => {
    const { maps, map } = createSdk();
    const geo = pendingPositions();
    load.mockResolvedValue(maps);
    const connection = vi.fn();
    const view = render(<KakaoMapView connectionChanged={connection} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled(),
    );
    let expected: number;
    if (kind === 'region') {
      view.rerender(
        <KakaoMapView
          target={polygonTarget}
          regionRevision={1}
          connectionChanged={connection}
        />,
      );
      await waitFor(() => expect(map.setBounds).toHaveBeenCalled());
      expected = 127;
    } else if (kind === 'search') {
      view.rerender(
        <KakaoMapView
          searchSelection={locationSearch}
          connectionChanged={connection}
        />,
      );
      await waitFor(() => expect(map.getCenter().getLng()).toBe(127.03));
      expected = 127.03;
    } else if (kind === 'candidate') {
      act(() =>
        connection.mock.calls
          .at(-1)![0]
          .focusLocation({ longitude: 127.06, latitude: 37.54 }, null),
      );
      await waitFor(() => expect(map.getCenter().getLng()).toBe(127.06));
      expected = 127.06;
    } else {
      fireEvent.pointerDown(screen.getByLabelText('Kakao Maps 지도'));
      act(() => map.setCenter({ getLng: () => 127.02, getLat: () => 37.57 }));
      expected = 127.02;
    }
    geo.complete();
    await screen.findByText(
      '현재 위치를 확인했습니다. 지도는 사용자 선택을 우선하며 지역 필터는 변경하지 않습니다.',
    );
    expect(map.getCenter().getLng()).toBe(expected);
    expect(maps.Map).toHaveBeenCalledOnce();
  },
);

test('SDK보다 먼저 도착한 위치는 SDK 준비 후 검증하며 언마운트 이후 콜백은 무시한다', async () => {
  const { maps, map } = createSdk();
  const geo = pendingPositions();
  let ready!: (maps: KakaoMaps) => void;
  load.mockReturnValue(
    new Promise((resolve) => {
      ready = resolve;
    }),
  );
  const view = render(
    <StrictMode>
      <KakaoMapView />
    </StrictMode>,
  );
  geo.complete();
  expect(maps.services.Geocoder).not.toHaveBeenCalled();
  await act(async () => ready(maps));
  await waitFor(() => expect(map.getCenter().getLng()).toBe(126.92378));
  expect(geo.locate).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '내 위치로 이동' }));
  expect(geo.locate).toHaveBeenCalledTimes(2);
  view.unmount();
  const moves = map.setCenter.mock.calls.length;
  geo.complete(1, 127.01);
  await act(async () => {});
  expect(map.setCenter).toHaveBeenCalledTimes(moves);
});

test('내 위치 재조회는 중복 실행을 막고 최신 사용자 선택과 지역 경계를 유지한다', async () => {
  const { maps, map } = createSdk();
  const geo = pendingPositions();
  load.mockResolvedValue(maps);
  const view = render(
    <KakaoMapView target={polygonTarget} regionRevision={1} />,
  );
  act(() => geo.pending[0].fail({ code: 1 } as GeolocationPositionError));
  await waitFor(() => expect(map.setBounds).toHaveBeenCalled());
  const button = screen.getByRole('button', { name: '내 위치로 이동' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(geo.locate).toHaveBeenCalledTimes(2);
  expect(button).toBeDisabled();
  geo.complete(1);
  await waitFor(() => expect(map.getCenter().getLng()).toBe(126.92378));
  expect(map.getCenter().getLat()).toBe(37.55687);
  expect(map.getLevel()).toBe(3);
  expect(maps.Polygon).toHaveBeenCalledOnce();
  expect(maps.Polygon.mock.results[0].value.setMap).toHaveBeenLastCalledWith(
    map,
  );
  fireEvent.click(button);
  view.rerender(
    <KakaoMapView
      target={polygonTarget}
      regionRevision={1}
      searchSelection={locationSearch}
    />,
  );
  await waitFor(() => expect(map.getCenter().getLng()).toBe(127.03));
  geo.complete(2);
  await waitFor(() => expect(button).toBeEnabled());
  expect(map.getCenter().getLng()).toBe(127.03);
  expect(maps.Map).toHaveBeenCalledOnce();
});

test.each([
  ['서교동', 'denied'],
  ['검색 장소', 'timeout'],
  ['후보지', 'outside'],
  ['서교동', 'verification'],
  ['검색 장소', 'invalid'],
  ['서교동', 'unsupported'],
  ['후보지', 'unavailable'],
] as const)(
  '%s에서 수동 위치 조회 %s 시 중심·확대·경계·검색·카페 상태를 유지한다',
  async (selection, reason) => {
    const { maps, map } = createSdk();
    const geo = pendingPositions();
    const connection = vi.fn();
    const cafes = clusterCafes(2);
    const target: RegionMapTarget = {
      kind: 'boundary',
      extent: { west: 126.91, south: 37.55, east: 126.93, north: 37.56 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [126.91, 37.55],
            [126.93, 37.55],
            [126.93, 37.56],
            [126.91, 37.55],
          ],
        ],
      },
    };
    load.mockResolvedValue(maps);
    render(
      <KakaoMapView
        target={target}
        regionRevision={1}
        searchSelection={selection === '검색 장소' ? locationSearch : null}
        connectionChanged={connection}
        cafes={cafes}
      />,
    );
    act(() => geo.pending[0].fail({ code: 1 } as GeolocationPositionError));
    await waitFor(() =>
      expect(map.getLevel()).toBe(selection === '검색 장소' ? 3 : 7),
    );
    if (selection === '후보지') {
      act(() =>
        connection.mock.calls
          .at(-1)![0]
          .focusLocation({ longitude: 127.06, latitude: 37.54 }, target),
      );
      await waitFor(() => expect(map.getCenter().getLng()).toBe(127.06));
    }
    // 기본 확대 수준과 다른 사용자 확대도 실패 후 그대로 유지해야 합니다.
    fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
    const center = map.getCenter();
    const level = map.getLevel();
    const moves = map.setCenter.mock.calls.length;
    const zooms = map.setLevel.mock.calls.length;
    const bounds = map.setBounds.mock.calls.length;
    const overlays = [
      ...maps.Polygon.mock.results,
      ...maps.Marker.mock.results,
    ].map(({ value }) => value);
    const overlayCalls = overlays.map(
      (overlay) => overlay.setMap.mock.calls.length,
    );
    const clusterer = maps.MarkerClusterer.mock.results[0].value;
    const cafeMarkers = [...clusterer.managed];
    const viewportCalls = vi.mocked(cafes.onViewportChange).mock.calls.length;
    if (reason === 'unsupported') vi.stubGlobal('navigator', {});
    fireEvent.click(screen.getByRole('button', { name: '내 위치로 이동' }));
    if (reason === 'outside' || reason === 'verification') {
      maps.services.Geocoder.mockImplementation(function () {
        return {
          addressSearch: vi.fn(),
          coord2Address: vi.fn((_x, _y, callback) =>
            callback([], 'ZERO_RESULT'),
          ),
          coord2RegionCode: vi.fn((_x, _y, callback) =>
            callback(
              [{ region_type: 'H', region_1depth_name: '경기도' }],
              reason === 'verification' ? 'ERROR' : 'OK',
            ),
          ),
        };
      });
      geo.complete(1, 127.2);
    } else if (reason === 'invalid') geo.complete(1, NaN);
    else if (reason !== 'unsupported')
      act(() =>
        geo.pending[1].fail({
          code: reason === 'denied' ? 1 : reason === 'timeout' ? 3 : 2,
        } as GeolocationPositionError),
      );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '내 위치로 이동' }),
      ).toBeEnabled(),
    );
    // 예약된 지도 이동 프레임까지 처리해 늦은 서울시청 복귀도 검출합니다.
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(screen.getByText(/현재 지도를 유지합니다/)).toBeVisible();
    expect(screen.queryByText(/서울시청/)).not.toBeInTheDocument();
    expect(map.getCenter()).toBe(center);
    expect(map.getLevel()).toBe(level);
    expect(map.setCenter).toHaveBeenCalledTimes(moves);
    expect(map.setLevel).toHaveBeenCalledTimes(zooms);
    expect(map.setBounds).toHaveBeenCalledTimes(bounds);
    expect(maps.Polygon).toHaveBeenCalledOnce();
    expect(maps.Marker).toHaveBeenCalledTimes(overlays.length - 1);
    overlays.forEach((overlay, index) => {
      expect(overlay.setMap).toHaveBeenCalledTimes(overlayCalls[index]);
      expect(overlay.setMap).toHaveBeenLastCalledWith(map);
    });
    expect([...clusterer.managed]).toEqual(cafeMarkers);
    expect(cafes.onViewportChange).toHaveBeenCalledTimes(viewportCalls);
    expect(cafes.selectCafe).not.toHaveBeenCalled();
    expect(cafes.selectCenter).not.toHaveBeenCalled();
    expect(maps.Map).toHaveBeenCalledOnce();
  },
);

test.each(['region', 'search', 'drag', 'candidate'] as const)(
  '수동 위치의 서울 확인 중 수행한 %s 선택을 늦은 성공 응답보다 우선한다',
  async (kind) => {
    const { maps, map } = createSdk();
    const geo = pendingPositions();
    const connection = vi.fn();
    load.mockResolvedValue(maps);
    const view = render(<KakaoMapView connectionChanged={connection} />);
    act(() => geo.pending[0].fail({ code: 1 } as GeolocationPositionError));
    const button = screen.getByRole('button', { name: '내 위치로 이동' });
    await waitFor(() => expect(button).toBeEnabled());
    let verify!: KakaoSearchCallback;
    maps.services.Geocoder.mockImplementation(function () {
      return {
        addressSearch: vi.fn(),
        coord2Address: vi.fn((_x, _y, callback) => callback([], 'ZERO_RESULT')),
        coord2RegionCode: vi.fn((_x, _y, callback) => {
          verify = callback;
        }),
      };
    });
    fireEvent.click(button);
    geo.complete(1);
    await waitFor(() => expect(verify).toBeDefined());
    if (kind === 'region') {
      view.rerender(
        <KakaoMapView
          target={polygonTarget}
          regionRevision={1}
          connectionChanged={connection}
        />,
      );
      await waitFor(() => expect(map.getLevel()).toBe(7));
    } else if (kind === 'search') {
      view.rerender(
        <KakaoMapView
          searchSelection={locationSearch}
          connectionChanged={connection}
        />,
      );
      await waitFor(() => expect(map.getCenter().getLng()).toBe(127.03));
    } else if (kind === 'candidate') {
      act(() =>
        connection.mock.calls
          .at(-1)![0]
          .focusLocation({ longitude: 127.06, latitude: 37.54 }, null),
      );
      await waitFor(() => expect(map.getCenter().getLng()).toBe(127.06));
    } else {
      fireEvent.pointerDown(screen.getByLabelText('Kakao Maps 지도'));
      act(() => map.setCenter({ getLng: () => 127.02, getLat: () => 37.57 }));
      fireEvent.click(screen.getByRole('button', { name: '지도 확대' }));
    }
    const center = map.getCenter();
    const level = map.getLevel();
    const moves = map.setCenter.mock.calls.length;
    act(() =>
      verify([{ region_type: 'H', region_1depth_name: '서울특별시' }], 'OK'),
    );
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(map.getCenter()).toBe(center);
    expect(map.getLevel()).toBe(level);
    expect(map.setCenter).toHaveBeenCalledTimes(moves);
    expect(
      screen.getByText(/현재 위치를 확인했습니다.*사용자 선택을 우선/),
    ).toBeVisible();
  },
);

test('구 선택이 경계 응답을 기다리는 동안 위치가 완료되어도 기본 중심을 덮어쓰지 않는다', async () => {
  const { maps, map } = createSdk();
  const geo = pendingPositions();
  load.mockResolvedValue(maps);
  const view = render(<KakaoMapView regionRevision={0} />);
  await waitFor(() => expect(maps.Map).toHaveBeenCalledOnce());
  view.rerender(<KakaoMapView target={null} regionRevision={1} />);
  geo.complete();
  await screen.findByText(
    '현재 위치를 확인했습니다. 지도는 사용자 선택을 우선하며 지역 필터는 변경하지 않습니다.',
  );
  expect(map.getCenter().getLng()).toBe(126.978);
  view.rerender(<KakaoMapView target={polygonTarget} regionRevision={1} />);
  await waitFor(() => expect(map.getCenter().getLng()).toBe(127));
});

test('늦게 완료된 지역 경계는 그 사이 명시적으로 선택한 후보지 이동을 덮어쓰지 않는다', async () => {
  const { maps, map } = createSdk();
  const geo = pendingPositions();
  const connection = vi.fn();
  load.mockResolvedValue(maps);
  const view = render(
    <KakaoMapView
      target={null}
      regionRevision={1}
      connectionChanged={connection}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled(),
  );
  act(() =>
    connection.mock.calls
      .at(-1)![0]
      .focusLocation({ longitude: 127.06, latitude: 37.54 }, null),
  );
  await waitFor(() => expect(map.getCenter().getLng()).toBe(127.06));
  view.rerender(
    <KakaoMapView
      target={polygonTarget}
      regionRevision={1}
      connectionChanged={connection}
    />,
  );
  geo.complete();
  await screen.findByText(
    '현재 위치를 확인했습니다. 지도는 사용자 선택을 우선하며 지역 필터는 변경하지 않습니다.',
  );
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledOnce());
  expect(map.getCenter().getLng()).toBe(127.06);
  expect(map.setBounds).not.toHaveBeenCalled();
});

test('SDK 재초기화는 확인한 위치만 복원하고 위치·표식·리스너가 누적되지 않는다', async () => {
  const { maps, map } = createSdk();
  const geo = pendingPositions();
  const store = vi.spyOn(Storage.prototype, 'setItem');
  const log = vi.spyOn(console, 'log');
  load.mockResolvedValue(maps);
  const view = render(<KakaoMapView />);
  geo.complete();
  await waitFor(() => expect(map.getCenter().getLng()).toBe(126.92378));
  const marker = maps.Marker.mock.results[0].value;
  const click = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === marker && type === 'click',
  )![2];
  act(() => click());
  expect(maps.event.preventMap).toHaveBeenCalledOnce();
  const lookups = maps.services.Geocoder.mock.calls.length;
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'retry-key');
  view.rerender(<KakaoMapView />);
  await waitFor(() => expect(maps.Map).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(maps.Marker).toHaveBeenCalledTimes(2));
  expect(marker.setMap).toHaveBeenLastCalledWith(null);
  expect(geo.locate).toHaveBeenCalledOnce();
  expect(maps.services.Geocoder).toHaveBeenCalledTimes(lookups);
  expect(fetch).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
  view.unmount();
  expect(maps.Marker.mock.results[1].value.setMap).toHaveBeenLastCalledWith(
    null,
  );
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    map,
    'dragstart',
    expect.any(Function),
  );
  store.mockRestore();
  log.mockRestore();
});

test.each([
  'denied',
  'timeout',
  'unsupported',
  'outside',
  'verification',
] as const)(
  '위치 %s 상태는 기본 지도를 오류로 바꾸지 않는다',
  async (reason) => {
    const { maps, map } = createSdk();
    const geo = pendingPositions();
    if (reason === 'unsupported') vi.stubGlobal('navigator', {});
    if (reason === 'outside' || reason === 'verification')
      maps.services.Geocoder.mockImplementation(function () {
        return {
          addressSearch: vi.fn(),
          coord2Address: vi.fn((_x, _y, callback) =>
            callback([], 'ZERO_RESULT'),
          ),
          coord2RegionCode: vi.fn((_x, _y, callback) =>
            callback(
              [{ region_type: 'H', region_1depth_name: '경기도' }],
              reason === 'verification' ? 'ERROR' : 'OK',
            ),
          ),
        };
      });
    load.mockResolvedValue(maps);
    render(<KakaoMapView />);
    if (reason === 'denied' || reason === 'timeout')
      act(() =>
        geo.pending[0].fail({
          code: reason === 'denied' ? 1 : 3,
        } as GeolocationPositionError),
      );
    else if (reason !== 'unsupported') geo.complete();
    await screen.findByText(/현재 지도를 유지합니다/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled();
    expect(map.getCenter().getLng()).toBe(126.978);
    expect(map.getLevel()).toBe(5);
    expect(maps.Marker).not.toHaveBeenCalled();
  },
);

test.each([false, true])(
  '가려진 검색 마커만 크기 안정 후 보정하고 모션 감소=%s와 직접 지도 이동을 존중한다',
  async (reduced) => {
    const { maps, map } = createSdk();
    load.mockResolvedValue(maps);
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
    const rect = (x: number, y: number, width: number, height: number) =>
      ({
        x,
        y,
        left: x,
        top: y,
        width,
        height,
        right: x + width,
        bottom: y + height,
      }) as DOMRect;
    const measure = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute('aria-label') === 'Kakao Maps 지도')
          return rect(0, 0, 390, 383);
        if (this.classList.contains('explore-search-results'))
          return rect(68, 120, 250, 230);
        if (this.classList.contains('explore-search-form'))
          return rect(68, 12, 310, 48);
        return rect(0, 0, 0, 0);
      });
    const project = vi.fn(() => ({ x: 195, y: 190 }));
    const unproject = vi.fn(() => ({
      getLat: () => 37.56,
      getLng: () => 127.031,
    }));
    map.getProjection.mockImplementation(() => ({
      containerPointFromCoords: project,
      coordsFromContainerPoint: unproject,
    }));
    const view = render(
      <div className="explore-app">
        <form className="explore-search-form" />
        <div className="explore-search-results" />
        <KakaoMapView searchSelection={locationSearch} searchOpen />
      </div>,
    );
    if (reduced) {
      await waitFor(() => expect(unproject).toHaveBeenCalled());
      expect(map.panBy).not.toHaveBeenCalled();
      expect(map.setCenter.mock.calls.at(-1)![0].getLng()).toBe(127.031);
    } else await waitFor(() => expect(map.panBy).toHaveBeenCalledWith(-155, 0));
    const count = project.mock.calls.length;
    fireEvent.pointerDown(screen.getByLabelText('Kakao Maps 지도'));
    act(() => {
      resize([], {} as ResizeObserver);
      resize([], {} as ResizeObserver);
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(project).toHaveBeenCalledTimes(count);
    expect(maps.Map).toHaveBeenCalledOnce();
    view.unmount();
    measure.mockRestore();
  },
);

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
  expect(screen.getByText(/최대 200곳만/)).toBeVisible();
  expect(maps.Marker).toHaveBeenCalledTimes(2);
  const marker = maps.Marker.mock.results[0].value;
  expect(marker.setMap).toHaveBeenCalledWith(map);
  fireEvent.click(screen.getByRole('button', { name: /<img src=x/ }));
  const info = maps.InfoWindow.mock.results.at(-1)!.value;
  expect(maps.InfoWindow).toHaveBeenCalledWith({
    disableAutoPan: false,
    removable: false,
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
  expect(map.setCenter).toHaveBeenCalledTimes(2);
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
  expect(cafeCalls()).toHaveLength(2);
  map.getBounds.mockReturnValue({
    getSouthWest: () => ({ getLat: () => 37.5, getLng: () => 126.9 }),
    getNorthEast: () => ({ getLat: () => 37.6, getLng: () => 127 }),
  });
  act(() => idle());
  await waitFor(() => expect(cafeCalls()).toHaveLength(3));
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
  expect(cafeCalls()).toHaveLength(4);
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
  expect(
    screen.queryByText('서울 지도를 불러오고 있습니다'),
  ).not.toBeInTheDocument();
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
  await screen.findByRole('option', { name: '종로구' });
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11110' },
  });
  await waitFor(() => expect(maps.Polygon).toHaveBeenCalledOnce());
  const first = maps.Polygon.mock.results[0].value;
  await screen.findByRole('option', { name: '선택동' });
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(maps.Polygon).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '11110001' },
  });
  expect(first.setMap).toHaveBeenLastCalledWith(null);
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11140' },
  });
  expect(
    await within(screen.getByRole('group', { name: '지역 필터' })).findByRole(
      'alert',
    ),
  ).toHaveTextContent('선택 지역 경계');
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
  for (const name of ['주변 카페', '상권 분석', '상권 분석']) {
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

test.each([
  { left: 80, x: 0, y: -66 },
  { left: -20, x: -32, y: -66 },
  { left: 900, x: 128, y: -2 },
])(
  '정보창의 검색창·화면 가장자리 겹침을 사용자 선택 시에만 보정한다 $left',
  async ({ left, x, y }) => {
    vi.stubGlobal('innerWidth', 1024);
    const { map, maps } = createSdk();
    const search = render(<div role="search" aria-label="장소 검색" />);
    vi.spyOn(
      search.getByRole('search'),
      'getBoundingClientRect',
    ).mockReturnValue(new DOMRect(16, 16, 256, 48));
    let content!: HTMLElement;
    maps.InfoWindow.mockImplementation(function (options) {
      return {
        options,
        setContent: vi.fn((node: HTMLElement) => {
          content = node;
        }),
        open: vi.fn(() => {
          document.body.append(content);
          vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(left, 10, 240, 250),
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
      clearCafeSelection: vi.fn(),
      centerDetails: { name: null, address: null, pending: false },
      onViewportChange: vi.fn(),
      scopeKey: ':',
      mode: 'viewport',
      setMode: vi.fn(),
      center: null,
      selectCenter: vi.fn(),
      clearCenter: vi.fn(),
      radiusM: 500,
      setRadiusM: vi.fn(),
    };
    const context = { map, maps };
    const moving = { current: false };
    const notify = { current: null };
    const view = renderHook(() =>
      useCafeMap(context, moving, notify, undefined, cafes),
    );
    await waitFor(() => expect(map.panBy).toHaveBeenCalledWith(x, y));
    expect(map.panBy).toHaveBeenCalledOnce();
    expect(content.textContent).toContain(cafe.roadAddress);
    view.rerender();
    expect(map.panBy).toHaveBeenCalledOnce();
    view.unmount();
    expect(content.isConnected).toBe(false);
  },
);

test('반경 탐색의 지도 클릭·거리 표시·방식 분리·패널 비활성화와 SDK 재시도 자원을 관리한다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  const cafe = {
    bizesId: 'nearby-cafe',
    storeName: '<img src=x onerror=alert(1)>',
    branchName: '시청점',
    semasIndustryCode: 'I21201',
    semasIndustryName: '카페',
    roadAddress: '<script>주소</script>',
    lotAddress: null,
    longitude: 126.979,
    latitude: 37.5665,
    distanceM: 499.9,
  };
  const page = (nearby: boolean) => ({
    items: [
      nearby
        ? cafe
        : {
            ...cafe,
            bizesId: 'viewport-cafe',
            storeName: '지도 카페',
            distanceM: undefined,
          },
    ],
    totalCount: nearby ? 201 : 1,
    limit: 200,
    offset: 0,
    hasMore: nearby,
    sourceBatch: {
      batchId: '00000000-0000-0000-0000-000000000004',
      publishedAt: '2026-10-02T00:00:00Z',
    },
  });
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.startsWith('/api/v1/cafes/')
            ? page(url.includes('/nearby'))
            : url === '/api/v1/districts'
              ? { items: [{ districtCode: '11110', districtName: '종로구' }] }
              : url.endsWith('/dongs')
                ? {
                    items: [
                      {
                        districtCode: '11110',
                        dongCode: '11110515',
                        dongName: '청운효자동',
                        labelPoint: { type: 'Point', coordinates: [127, 37] },
                      },
                    ],
                  }
                : {
                    type: 'Feature',
                    id: url.split('/')[4],
                    properties: {
                      regionCode: url.split('/')[4],
                      regionType: url.includes('/dongs/') ? 'DONG' : 'DISTRICT',
                    },
                    geometry: polygonTarget.geometry,
                  },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole('option', { name: '종로구' });
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11110' },
  });
  await screen.findByRole('option', { name: '청운효자동' });
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '11110515' },
  });
  await waitFor(() => expect(maps.Marker).toHaveBeenCalled());
  const oldMarker = maps.Marker.mock.results.at(-1)!.value;
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  fireEvent.click(screen.getByRole('button', { name: '선택 지점 주변' }));
  expect(oldMarker.setMap).toHaveBeenLastCalledWith(null);
  expect(maps.Circle).not.toHaveBeenCalled();
  expect(screen.getByText('중심점이 선택되지 않았습니다.')).toBeVisible();
  const nearbyCalls = () =>
    fetch.mock.calls.filter(([url]) => url.includes('/nearby'));
  expect(nearbyCalls()).toHaveLength(0);
  const mapClick = () =>
    maps.event.addListener.mock.calls.findLast(
      ([target, type]) => target === map && type === 'click',
    )![2];
  act(() =>
    mapClick()({ latLng: { getLat: () => 37.5665, getLng: () => 126.978 } }),
  );
  await screen.findByText('반경 내 전체 201곳 중 1곳 표시');
  expect(screen.getByText('지도에서 선택한 위치')).toBeVisible();
  expect(nearbyCalls()[0][0]).toContain(
    'longitude=126.978&latitude=37.5665&radiusM=500&limit=200&offset=0',
  );
  expect(nearbyCalls()[0][0]).not.toContain('Codes');
  expect(screen.getByText(/499.9m/)).toBeVisible();
  expect(screen.getByText(/최대 200곳만/)).toBeVisible();
  expect(maps.Circle.mock.calls[0][0]).toMatchObject({
    radius: 500,
    strokeStyle: 'dashed',
    fillOpacity: 0.08,
  });
  expect(maps.Circle.mock.calls[0][0].center.getLat()).toBe(37.5665);
  const firstCircle = maps.Circle.mock.results[0].value;
  expect(firstCircle.setMap).toHaveBeenLastCalledWith(map);
  expect(maps.Marker).toHaveBeenCalledWith(
    expect.objectContaining({
      title: '임시 관심 위치',
      image: expect.any(Object),
      clickable: true,
    }),
  );
  const markerIndex = maps.Marker.mock.calls.findLastIndex(
    ([options]) => options.title === cafe.storeName,
  );
  const cafeMarker = maps.Marker.mock.results[markerIndex].value;
  const markerClick = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === cafeMarker && type === 'click',
  )![2];
  act(() => markerClick());
  expect(maps.event.preventMap).toHaveBeenCalledOnce();
  expect(nearbyCalls()).toHaveLength(1);
  const info = maps.InfoWindow.mock.results.at(-1)!.value;
  const content = info.setContent.mock.calls.at(-1)![0] as HTMLElement;
  expect(content.textContent).toContain('중심점에서 499.9m');
  expect(content.querySelector('img,script')).toBeNull();
  const lastCircleCount = maps.Circle.mock.calls.length;
  act(() => {
    map.setLevel(3);
    maps.event.addListener.mock.calls.findLast(
      ([target, type]) => target === map && type === 'idle',
    )?.[2]();
  });
  expect(maps.Circle).toHaveBeenCalledTimes(lastCircleCount);
  expect(nearbyCalls()).toHaveLength(1);
  fireEvent.change(screen.getByRole('combobox', { name: '탐색 반경' }), {
    target: { value: '1000' },
  });
  await waitFor(() => expect(nearbyCalls()).toHaveLength(2));
  expect(nearbyCalls()[1][0]).toContain('radiusM=1000');
  expect(firstCircle.setMap).toHaveBeenLastCalledWith(null);
  expect(maps.Circle.mock.calls.at(-1)![0].radius).toBe(1000);
  expect(cafeMarker.setMap).toHaveBeenLastCalledWith(null);
  expect(info.close).toHaveBeenCalled();
  const radiusCircle = maps.Circle.mock.results.at(-1)!.value;
  act(() =>
    mapClick()({ latLng: { getLat: () => 37.57, getLng: () => 126.98 } }),
  );
  await waitFor(() => expect(nearbyCalls()).toHaveLength(3));
  expect(radiusCircle.setMap).toHaveBeenLastCalledWith(null);
  expect(maps.Circle.mock.calls.at(-1)![0].center.getLat()).toBe(37.57);
  expect(maps.Circle.mock.calls.at(-1)![0].center.getLng()).toBe(126.98);
  const beforeRetryCircle = maps.Circle.mock.results.at(-1)!.value;
  load.mockRejectedValueOnce(new Error('sdk'));
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'retry-key');
  view.rerender(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByText('지도를 불러오지 못했습니다');
  expect(beforeRetryCircle.setMap).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await waitFor(() => expect(maps.Map).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      maps.Circle.mock.results.at(-1)!.value.setMap,
    ).toHaveBeenLastCalledWith(map),
  );
  expect(maps.Circle.mock.calls.at(-1)![0].radius).toBe(1000);
  const currentClick = mapClick();
  fireEvent.click(screen.getByRole('button', { name: '주변 카페 패널 닫기' }));
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    map,
    'click',
    currentClick,
  );
  const clickRegistrations = maps.event.addListener.mock.calls.filter(
    ([target, type]) => target === map && type === 'click',
  ).length;
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(
    maps.event.addListener.mock.calls.filter(
      ([target, type]) => target === map && type === 'click',
    ),
  ).toHaveLength(clickRegistrations);
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  fireEvent.click(screen.getByRole('button', { name: '중심점 해제' }));
  expect(
    maps.Circle.mock.results.at(-1)!.value.setMap,
  ).toHaveBeenLastCalledWith(null);
  expect(screen.getByText('중심점이 선택되지 않았습니다.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '지도 영역' }));
  await screen.findByRole('button', { name: /지도 카페/ });
  expect(screen.queryByText(/499.9m/)).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '자치구' })).toHaveValue('11110');
  expect(screen.getByRole('combobox', { name: '행정동' })).toHaveValue(
    '11110515',
  );
  view.unmount();
  for (const result of maps.Circle.mock.results)
    expect(result.value.setMap).toHaveBeenLastCalledWith(null);
  for (const result of maps.Marker.mock.results)
    expect(result.value.setMap).toHaveBeenLastCalledWith(null);
});

test('반경 API 실패에도 지도와 중심점을 유지하고 재시도로 빈 반경 결과를 안내한다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('/nearby')
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
          { status: url.includes('/nearby') && fail ? 503 : 200 },
        ),
    ),
  );
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  fireEvent.click(screen.getByRole('button', { name: '선택 지점 주변' }));
  await waitFor(() =>
    expect(maps.event.addListener).toHaveBeenCalledWith(
      map,
      'click',
      expect.any(Function),
    ),
  );
  const click = maps.event.addListener.mock.calls.findLast(
    ([target, type]) => target === map && type === 'click',
  )![2];
  act(() =>
    click({ latLng: { getLat: () => 37.5665, getLng: () => 126.978 } }),
  );
  await screen.findByText(/카페 데이터가 아직 준비되지/);
  expect(
    maps.Circle.mock.results.at(-1)!.value.setMap,
  ).toHaveBeenLastCalledWith(map);
  expect(screen.getByRole('button', { name: '지도 확대' })).toBeEnabled();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '카페 목록 다시 시도' }));
  expect(
    await screen.findByText('선택한 반경 내에 조회된 카페가 없습니다.'),
  ).toBeVisible();
  expect(screen.getByText('반경 내 전체 0곳 중 0곳 표시')).toBeVisible();
  expect(
    maps.Marker.mock.calls.every(
      ([options]) => options.title === '임시 관심 위치',
    ),
  ).toBe(true);
});

test('장소 검색 이동·지역 필터 독립성·명시적 반경 연계와 지역 재선택 우선순위를 유지한다', async () => {
  const { maps, map } = createSdk();
  map.getBounds.mockImplementation(() => ({
    getSouthWest: () => ({
      getLat: () => map.getCenter().getLat() - 0.01,
      getLng: () => map.getCenter().getLng() - 0.01,
    }),
    getNorthEast: () => ({
      getLat: () => map.getCenter().getLat() + 0.01,
      getLng: () => map.getCenter().getLng() + 0.01,
    }),
  }));
  load.mockResolvedValue(maps);
  maps.services.Places.mockImplementation(function () {
    return {
      keywordSearch: vi.fn((_query: string, callback: KakaoSearchCallback) =>
        callback(
          [
            {
              id: 'station',
              place_name: '홍대입구역',
              address_name: '서울 마포구 동교동',
              road_address_name: '서울 마포구 양화로 160',
              category_group_name: '지하철역',
              x: '126.923',
              y: '37.557',
            },
            {
              id: 'cityhall',
              place_name: '서울시청',
              address_name: '서울 중구 태평로',
              road_address_name: '서울 중구 세종대로 110',
              category_group_name: '공공기관',
              x: '126.978',
              y: '37.5665',
            },
          ],
          'OK',
          { hasNextPage: false },
        ),
      ),
    };
  });
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('/cafes/')
            ? {
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
            : url === '/api/v1/districts'
              ? {
                  items: [
                    { districtCode: '11110', districtName: '종로구' },
                    { districtCode: '11140', districtName: '중구' },
                  ],
                }
              : url.endsWith('/dongs')
                ? {
                    items: [
                      {
                        districtCode: url.split('/')[4],
                        dongCode: `${url.split('/')[4]}515`,
                        dongName: '선택동',
                        labelPoint: { type: 'Point', coordinates: [127, 37] },
                      },
                    ],
                  }
                : {
                    type: 'Feature',
                    id: url.split('/')[4],
                    properties: {
                      regionCode: url.split('/')[4],
                      regionType: url.includes('/dongs/') ? 'DONG' : 'DISTRICT',
                    },
                    geometry: polygonTarget.geometry,
                  },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole('option', { name: '종로구' });
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11110' },
  });
  await screen.findByRole('option', { name: '선택동' });
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '11110515' },
  });
  await waitFor(() => expect(map.setBounds).toHaveBeenCalled());
  const input = screen.getByRole('textbox', { name: '장소 검색' });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: '다중 검색' } });
  fireEvent.submit(input.closest('form')!);
  await screen.findByRole('button', { name: /서울시청.*세종대로/ });
  const results = screen.getByRole('region', { name: '장소 검색 결과' });
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  const regionPanel = screen.getByRole('complementary', { name: '상권 분석' });
  const keywordSearch =
    maps.services.Places.mock.results.at(-1)!.value.keywordSearch;
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(keywordSearch).toHaveBeenCalledOnce();
  expect(screen.getByRole('region', { name: '장소 검색 결과' })).toBe(results);
  expect(regionPanel).not.toContainElement(results);
  expect(screen.getByRole('search', { name: '장소 검색' })).toHaveAttribute(
    'data-panel-open',
    'true',
  );
  expect(
    screen
      .getByRole('button', { name: '검색 결과 닫기' })
      .closest('.explore-search-result-body'),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /서울시청.*세종대로/ }));
  await waitFor(() =>
    expect(map.setCenter.mock.calls.at(-1)![0].getLng()).toBe(126.978),
  );
  expect(map.getLevel()).toBe(3);
  expect(screen.getByRole('combobox', { name: '자치구' })).toHaveValue('11110');
  expect(screen.getByRole('combobox', { name: '행정동' })).toHaveValue(
    '11110515',
  );
  expect(screen.getByText(/기존 구·동 필터가 유지됩니다/)).toBeVisible();
  const searchMarker = maps.Marker.mock.results.find(
    (_, index) =>
      maps.Marker.mock.calls[index][0].title === '검색 위치: 서울시청',
  )!.value;
  expect(searchMarker.setMap).toHaveBeenLastCalledWith(map);
  expect(
    maps.MarkerClusterer.mock.results[0].value.managed.has(searchMarker),
  ).toBe(false);
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([url]) =>
          url.includes('/viewport') &&
          url.includes('districtCodes=11110') &&
          Math.abs(
            Number(new URL(url, 'http://localhost').searchParams.get('west')) -
              126.968,
          ) < 1e-7,
      ),
    ).toBe(true),
  );
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/nearby')),
  ).toHaveLength(0);
  fireEvent.keyDown(
    screen.getByRole('button', { name: '이 위치 주변 카페 보기' }),
    { key: 'Escape' },
  );
  expect(screen.getByRole('button', { name: '상권 분석' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(input).toHaveFocus();
  const count = map.setCenter.mock.calls.length;
  const markerClick = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === searchMarker && type === 'click',
  )![2];
  act(() => markerClick());
  expect(map.setCenter).toHaveBeenCalledTimes(count);
  fireEvent.click(
    screen.getByRole('button', { name: '이 위치 주변 카페 보기' }),
  );
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([url]) =>
        url.includes('/nearby?longitude=126.978&latitude=37.5665&radiusM=500'),
      ),
    ).toBe(true),
  );
  expect(searchMarker.setMap).toHaveBeenLastCalledWith(null);
  expect(maps.Circle.mock.calls.at(-1)![0].radius).toBe(500);
  const centerPanel = screen.getByRole('region', {
    name: '선택 지점 주변 카페',
  });
  expect(within(centerPanel).getByText('서울시청')).toBeVisible();
  expect(within(centerPanel).getByText('서울 중구 세종대로 110')).toBeVisible();
  expect(
    screen.queryByRole('region', { name: '장소 검색 결과' }),
  ).not.toBeInTheDocument();
  for (const { value } of maps.services.Geocoder.mock.results)
    expect(value.coord2Address).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: '탐색 반경' }), {
    target: { value: '1000' },
  });
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(([url]) => url.includes('/nearby')),
    ).toHaveLength(2),
  );
  fireEvent.change(input, { target: { value: '다른 위치' } });
  fireEvent.submit(input.closest('form')!);
  fireEvent.click(
    await screen.findByRole('button', { name: /홍대입구역.*양화로/ }),
  );
  await waitFor(() => expect(map.getCenter().getLng()).toBe(126.923));
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/nearby')),
  ).toHaveLength(2);
  fireEvent.click(
    screen.getByRole('button', { name: '이 위치 주변 카페 보기' }),
  );
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([url]) =>
        url.includes('/nearby?longitude=126.923&latitude=37.557&radiusM=1000'),
      ),
    ).toBe(true),
  );
  expect(
    fetch.mock.calls
      .filter(([url]) => url.includes('/nearby'))
      .every(([url]) => !url.includes('Codes')),
  ).toBe(true);
  fireEvent.change(input, { target: { value: '서울시청' } });
  fireEvent.submit(input.closest('form')!);
  fireEvent.click(
    await screen.findByRole('button', { name: /서울시청.*세종대로/ }),
  );
  await waitFor(() => expect(map.getCenter().getLng()).toBe(126.978));
  const lastMarker = maps.Marker.mock.results.at(-1)!.value;
  fireEvent.click(screen.getByRole('button', { name: '검색 결과 닫기' }));
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11140' },
  });
  expect(lastMarker.setMap).toHaveBeenLastCalledWith(null);
  await waitFor(() => expect(map.getLevel()).toBe(7));
  expect(map.getCenter().getLng()).toBe(127);
  const markers = maps.Marker.mock.calls.length;
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11110' },
  });
  await waitFor(() => expect(map.getLevel()).toBe(7));
  expect(maps.Marker).toHaveBeenCalledTimes(markers);
  expect(maps.Map).toHaveBeenCalledOnce();
});

test('선택 검색 마커와 카메라를 SDK 재시도에서 복원하고 언마운트 시 리스너를 정리한다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  const selection = {
    place: {
      id: 'place',
      name: '서울시청',
      address: '서울 중구 세종대로 110',
      kind: '공공기관',
      longitude: 126.978,
      latitude: 37.5665,
      isSeoul: true,
    },
    scope: 0,
    revision: 1,
  };
  const view = render(
    <StrictMode>
      <KakaoMapView target={polygonTarget} searchSelection={selection} />
    </StrictMode>,
  );
  await waitFor(() => expect(maps.Marker).toHaveBeenCalledOnce());
  await waitFor(() => expect(map.getLevel()).toBe(3));
  const first = maps.Marker.mock.results[0].value;
  load.mockRejectedValueOnce(new Error('sdk'));
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'new-key');
  view.rerender(
    <StrictMode>
      <KakaoMapView target={polygonTarget} searchSelection={selection} />
    </StrictMode>,
  );
  await screen.findByRole('alert');
  expect(first.setMap).toHaveBeenLastCalledWith(null);
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    first,
    'click',
    expect.any(Function),
  );
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await waitFor(() => expect(maps.Marker).toHaveBeenCalledTimes(2));
  expect(map.getCenter().getLng()).toBe(126.978);
  view.unmount();
  expect(maps.Marker.mock.results[1].value.setMap).toHaveBeenLastCalledWith(
    null,
  );
});

test('지도 추가 모드와 검색에서 후보지를 등록하고 명시적으로 선택할 때만 이동한다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  maps.services.Places.mockImplementation(function () {
    return {
      keywordSearch: vi.fn((_query: string, callback: KakaoSearchCallback) =>
        callback(
          [
            {
              id: 'station',
              place_name: '검색 장소',
              address_name: '서울 중구 예시',
              x: '127',
              y: '37.51',
            },
          ],
          'OK',
        ),
      ),
    };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      Response.json(
        path.includes('/regions/nearby')
          ? {
              districts: [
                {
                  districtCode: '11140',
                  districtName: '중구',
                  containsCenter: true,
                },
              ],
              dongs: [],
            }
          : { items: [] },
      ),
    ),
  );
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  const menu = screen.getByRole('button', { name: '후보지 분석' });
  fireEvent.click(menu);
  const mode = screen.getByRole('button', { name: '지도에서 후보지 추가' });
  await waitFor(() => expect(mode).toBeEnabled());
  const mapClick = () =>
    maps.event.addListener.mock.calls.findLast(
      ([target, type]) => target === map && type === 'click',
    )?.[2];
  expect(mapClick()).toBeUndefined();
  fireEvent.click(mode);
  const firstClick = mapClick()!;
  act(() =>
    firstClick({ latLng: { getLat: () => 37.5, getLng: () => 126.99 } }),
  );
  await screen.findByText('후보지 A를 등록했습니다.');
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    map,
    'click',
    firstClick,
  );
  const marker = maps.Marker.mock.results.at(-1)!.value;
  const markerClick = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === marker && type === 'click',
  )![2];
  act(() => markerClick());
  expect(maps.event.preventMap).toHaveBeenCalled();
  await waitFor(() => expect(map.getCenter().getLng()).toBe(126.99));
  const moves = map.setCenter.mock.calls.length;
  fireEvent.change(screen.getByRole('textbox', { name: '후보지 A 이름' }), {
    target: { value: '지도로 등록' },
  });
  fireEvent.click(screen.getByRole('button', { name: '후보지 A 이름 저장' }));
  expect(map.setCenter).toHaveBeenCalledTimes(moves);
  fireEvent.click(screen.getByRole('button', { name: '지도에서 후보지 추가' }));
  const pendingClick = mapClick();
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    map,
    'click',
    pendingClick,
  );
  const input = screen.getByRole('textbox', { name: '장소 검색' });
  fireEvent.change(input, { target: { value: '검색 장소' } });
  fireEvent.submit(input.closest('form')!);
  fireEvent.click(
    await screen.findByRole('button', { name: /검색 장소.*서울 중구/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: '후보지로 추가' }));
  await screen.findByText('후보지 B를 등록했습니다.');
  expect(
    screen.getByRole('button', { name: '후보지 A 지도에서 위치 확인' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: '후보지 A 지도에서 위치 확인' }),
  ).toHaveTextContent('지도로 등록');
  expect(screen.getByRole('region', { name: '후보지 요약' })).toBeVisible();
  const removed = maps.Marker.mock.results.at(-1)!.value;
  fireEvent.click(screen.getByRole('button', { name: '후보지 B 삭제' }));
  expect(removed.setMap).toHaveBeenLastCalledWith(null);
  const remaining = maps.Marker.mock.results.at(-1)!.value;
  expect(maps.Map).toHaveBeenCalledOnce();
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'replacement-key');
  view.rerender(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await waitFor(() => expect(maps.Map).toHaveBeenCalledTimes(2));
  expect(remaining.setMap).toHaveBeenLastCalledWith(null);
  const restored = maps.Marker.mock.results.at(-1)!.value;
  expect(restored).not.toBe(remaining);
  expect(restored.setMap).toHaveBeenLastCalledWith(map);
  view.unmount();
  expect(restored.setMap).toHaveBeenLastCalledWith(null);
  sessionStorage.removeItem('recycleyoungs.candidates');
});

test('선택한 후보지에서 서울 외부 위치가 반환되어도 후보지 선택·이름·마커를 유지한다', async () => {
  const { maps, map } = createSdk();
  const geo = pendingPositions();
  const storageKey = 'recycleyoungs.candidates';
  const saved = JSON.stringify({
    version: 1,
    items: [
      { slot: 'A', name: '서교동 후보지', longitude: 126.92, latitude: 37.55 },
    ],
  });
  sessionStorage.setItem(storageKey, saved);
  try {
    load.mockResolvedValue(maps);
    render(<App />);
    act(() => geo.pending[0].fail({ code: 1 } as GeolocationPositionError));
    fireEvent.click(screen.getByRole('button', { name: '후보지 분석' }));
    const candidate = screen.getByRole('button', {
      name: '후보지 A 지도에서 위치 확인',
    });
    await waitFor(() => expect(candidate).toBeEnabled());
    fireEvent.click(candidate);
    await waitFor(() => expect(map.getCenter().getLng()).toBe(126.92));
    const marker = maps.Marker.mock.results.findLast(
      ({ value }) => value.title === '후보지 A: 서교동 후보지',
    )!.value;
    const markerCalls = marker.setMap.mock.calls.length;
    const center = map.getCenter();
    const level = map.getLevel();
    maps.services.Geocoder.mockImplementation(function () {
      return {
        addressSearch: vi.fn(),
        coord2Address: vi.fn((_x, _y, callback) => callback([], 'ZERO_RESULT')),
        coord2RegionCode: vi.fn((_x, _y, callback) =>
          callback([{ region_type: 'H', region_1depth_name: '경기도' }], 'OK'),
        ),
      };
    });
    fireEvent.click(screen.getByRole('button', { name: '내 위치로 이동' }));
    geo.complete(1, 127.2);
    await screen.findByText(
      '서울 서비스 범위 밖입니다. 현재 지도를 유지합니다.',
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(map.getCenter()).toBe(center);
    expect(map.getLevel()).toBe(level);
    expect(candidate).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: '후보지 A 이름' })).toHaveValue(
      '서교동 후보지',
    );
    expect(marker.setMap).toHaveBeenCalledTimes(markerCalls);
    expect(marker.setMap).toHaveBeenLastCalledWith(map);
    expect(sessionStorage.getItem(storageKey)).toBe(saved);
  } finally {
    sessionStorage.removeItem(storageKey);
  }
});

function App() {
  return (
    <MemoryRouter>
      <ExploreApp />
    </MemoryRouter>
  );
}

test('카페 클러스터러는 지도당 한 번 초기화하고 패널·조회 범위 변경에는 다시 만들지 않는다', async () => {
  const { maps, map } = createSdk();
  load.mockResolvedValue(maps);
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await waitFor(() => expect(maps.MarkerClusterer).toHaveBeenCalledOnce());
  const clusterer = maps.MarkerClusterer.mock.results[0].value;
  expect(maps.MarkerClusterer).toHaveBeenCalledWith(
    expect.objectContaining({
      map,
      minLevel: 3,
      gridSize: 60,
      minClusterSize: 2,
      averageCenter: true,
      disableClickZoom: true,
    }),
  );
  for (const name of [
    '주변 카페',
    '선택 지점 주변',
    '상권 분석',
    '후보지 분석',
  ])
    fireEvent.click(screen.getByRole('button', { name }));
  expect(maps.MarkerClusterer).toHaveBeenCalledOnce();
  view.unmount();
  expect(clusterer.managed.size).toBe(0);
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    clusterer,
    'clusterclick',
    expect.any(Function),
  );
});

function clusterCafes(count: number): CafeExplorer {
  return {
    status: 'ready',
    data: null,
    error: null,
    retry: vi.fn(),
    needsZoom: false,
    items: Array.from({ length: count }, (_, index) => ({
      bizesId: `cafe-${index}`,
      storeName: `카페 ${index}`,
      branchName: null,
      semasIndustryCode: 'I21201',
      semasIndustryName: '카페',
      roadAddress: null,
      lotAddress: null,
      longitude: 126.978 + index * 0.00001,
      latitude: 37.5665,
    })),
    selected: null,
    selectCafe: vi.fn(),
    clearCafeSelection: vi.fn(),
    centerDetails: { name: null, address: null, pending: false },
    onViewportChange: vi.fn(),
    scopeKey: 'district:one',
    mode: 'viewport',
    setMode: vi.fn(),
    center: null,
    selectCenter: vi.fn(),
    clearCenter: vi.fn(),
    radiusM: 500,
    setRadiusM: vi.fn(),
  };
}

test.each([0, 1, 200])(
  '카페 %i개의 클러스터 일괄 등록·중복 방지와 StrictMode 자원 정리를 보장한다',
  (count) => {
    const { maps, map } = createSdk();
    const context = { maps, map };
    const moving = { current: false };
    const notify = { current: null };
    const cafes = clusterCafes(count);
    const view = renderHook(
      ({ value }) => useCafeMap(context, moving, notify, undefined, value),
      {
        initialProps: { value: cafes },
        wrapper: StrictMode,
      },
    );
    expect(maps.MarkerClusterer).toHaveBeenCalledOnce();
    const clusterer = maps.MarkerClusterer.mock.results[0].value;
    expect(clusterer.managed.size).toBe(count);
    const markerCount = maps.Marker.mock.calls.length;
    const redrawCount = clusterer.redraw.mock.calls.length;
    view.rerender({
      value: { ...cafes, items: count ? [...cafes.items, cafes.items[0]] : [] },
    });
    expect(maps.Marker.mock.calls.length).toBe(markerCount);
    expect(clusterer.managed.size).toBe(count);
    expect(clusterer.redraw.mock.calls.length).toBe(redrawCount);
    act(() => {
      map.setLevel(2);
      map.setLevel(5);
    });
    expect(maps.MarkerClusterer).toHaveBeenCalledOnce();
    expect(map.setCenter).not.toHaveBeenCalled();
    view.unmount();
    expect(clusterer.managed.size).toBe(0);
    for (const marker of maps.Marker.mock.results)
      expect(marker.value.setMap).toHaveBeenLastCalledWith(null);
  },
);

test('클러스터의 숫자·크기·접근성 문구는 현재 로드된 마커 개수만 표현한다', () => {
  const { maps, map } = createSdk();
  const context = { maps, map };
  const value = clusterCafes(1);
  const view = renderHook(() =>
    useCafeMap(
      context,
      { current: false },
      { current: null },
      undefined,
      value,
    ),
  );
  const options = maps.MarkerClusterer.mock.calls[0][0];
  expect(options.styles.map((style) => style.width)).toEqual([
    '48px',
    '56px',
    '64px',
  ]);
  expect(options.calculator).toEqual([10, 50]);
  const node = document.createElement('div');
  node.innerHTML = options.texts(200);
  const button = node.querySelector('button')!;
  expect(button).toHaveTextContent('200');
  expect(button).toHaveAttribute('aria-label', '조회된 카페 200곳, 확대');
  expect(node.textContent).not.toContain(value.items[0].storeName);
  view.unmount();
});

test('클러스터 클릭은 현재 중심으로 한 레벨만 확대하고 지도 클릭에 전파하지 않는다', () => {
  const { maps, map } = createSdk();
  const context = { maps, map };
  const value = {
    ...clusterCafes(2),
    mode: 'nearby' as const,
    center: { longitude: 126.978, latitude: 37.5665 },
  };
  const view = renderHook(() =>
    useCafeMap(
      context,
      { current: false },
      { current: null },
      undefined,
      value,
      true,
    ),
  );
  const clusterer = maps.MarkerClusterer.mock.results[0].value;
  const center = new maps.LatLng(37.57, 126.98);
  const overlay = { setZIndex: vi.fn() };
  const cluster: KakaoCluster = {
    getCenter: () => center,
    getClusterMarker: () => overlay,
  };
  const click = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === clusterer && type === 'clusterclick',
  )![2] as unknown as (cluster: KakaoCluster) => void;
  const clustered = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === clusterer && type === 'clustered',
  )![2] as unknown as (clusters: KakaoCluster[]) => void;
  act(() => {
    clustered([cluster]);
    click(cluster);
  });
  expect(overlay.setZIndex).toHaveBeenCalledWith(1);
  expect(maps.event.preventMap).toHaveBeenCalledOnce();
  expect(map.setLevel).toHaveBeenCalledOnce();
  expect(map.setLevel).toHaveBeenCalledWith(4, { anchor: center });
  expect(value.selectCenter).not.toHaveBeenCalled();
  expect(value.selectCafe).not.toHaveBeenCalled();
  // 반경 중심 표식은 클러스터에 등록하지 않습니다.
  expect(clusterer.managed.size).toBe(2);
  expect(
    [...clusterer.managed].every(
      (marker) =>
        !(marker as { title?: string }).title?.includes('임시 관심 위치'),
    ),
  ).toBe(true);
  view.unmount();
  act(() => click(cluster));
  expect(map.setLevel).toHaveBeenCalledOnce();
});

test('목록 선택 핀은 묶음에서 분리하고 재조회·축소에는 카메라를 반복 이동하지 않는다', () => {
  const { maps, map } = createSdk();
  const context = { maps, map };
  const value = clusterCafes(2);
  const moving = { current: false };
  const notify = { current: null };
  const view = renderHook(
    ({ cafes }) => useCafeMap(context, moving, notify, undefined, cafes),
    { initialProps: { cafes: value } },
  );
  const clusterer = maps.MarkerClusterer.mock.results[0].value;
  const marker = maps.Marker.mock.results[0].value;
  const selected = {
    ...value,
    selected: {
      bizesId: value.items[0].bizesId,
      scopeKey: value.scopeKey,
      revision: 1,
    },
  };
  view.rerender({ cafes: selected });
  expect(map.getLevel()).toBe(2);
  expect(clusterer.managed.has(marker)).toBe(false);
  expect(marker.setMap).toHaveBeenLastCalledWith(map);
  expect(marker.setZIndex).toHaveBeenLastCalledWith(2);
  const info = maps.InfoWindow.mock.results[0].value;
  expect(info.open).toHaveBeenLastCalledWith(map, marker);
  const moves = map.setCenter.mock.calls.length;
  const opens = info.open.mock.calls.length;
  view.rerender({
    cafes: {
      ...selected,
      items: selected.items.map((cafe) => ({
        ...cafe,
        branchName: '갱신 지점',
      })),
    },
  });
  act(() => map.setLevel(5));
  expect(clusterer.managed.has(marker)).toBe(false);
  expect(map.setCenter).toHaveBeenCalledTimes(moves);
  expect(info.open).toHaveBeenCalledTimes(opens);
  view.rerender({ cafes: value });
  expect(info.close).toHaveBeenCalled();
  expect(clusterer.managed.has(marker)).toBe(true);
  view.unmount();
});

test('Hover는 정보창 하나를 재사용하고 클릭·터치 선택의 고정 정보와 카메라를 침범하지 않는다', () => {
  const { maps, map } = createSdk();
  const context = { maps, map };
  const value = clusterCafes(2);
  value.items[0] = {
    ...value.items[0],
    storeName: '<img src=x onerror=alert(1)>',
    branchName: '홍대점',
    roadAddress: '서울 도로 1',
    distanceM: 12.5,
  };
  value.items[1] = { ...value.items[1], lotAddress: '서울 지번 2' };
  const view = renderHook(
    ({ cafes }) =>
      useCafeMap(
        context,
        { current: false },
        { current: null },
        undefined,
        cafes,
      ),
    { initialProps: { cafes: value } },
  );
  const markerA = maps.Marker.mock.results[0].value;
  const markerB = maps.Marker.mock.results[1].value;
  const handler = (marker: KakaoMarker, type: string) =>
    maps.event.addListener.mock.calls.findLast(
      ([target, event]) => target === marker && event === type,
    )![2];
  const overA = handler(markerA, 'mouseover');
  const outA = handler(markerA, 'mouseout');
  const overB = handler(markerB, 'mouseover');
  const outB = handler(markerB, 'mouseout');
  const pinned = maps.InfoWindow.mock.results[0].value;
  act(() => overA());
  expect(maps.InfoWindow).toHaveBeenCalledTimes(2);
  expect(maps.InfoWindow.mock.calls[1][0]).toEqual({
    disableAutoPan: true,
    removable: false,
  });
  const hover = maps.InfoWindow.mock.results[1].value;
  expect(hover.open).toHaveBeenLastCalledWith(map, markerA);
  const content = hover.setContent.mock.calls.at(-1)![0] as HTMLElement;
  expect(content.textContent).toContain(
    '<img src=x onerror=alert(1)> · 홍대점',
  );
  expect(content.textContent).toContain('서울 도로 1');
  expect(content.textContent).toContain('중심점에서 12.5m');
  expect(content.querySelector('img,script')).toBeNull();
  act(() => {
    overB();
    outA();
  });
  expect(hover.open).toHaveBeenLastCalledWith(map, markerB);
  expect(
    (hover.setContent.mock.calls.at(-1)![0] as HTMLElement).textContent,
  ).toContain('서울 지번 2');
  const closes = hover.close.mock.calls.length;
  act(() => outB());
  expect(hover.close).toHaveBeenCalledTimes(closes + 1);
  expect(value.selectCafe).not.toHaveBeenCalled();
  expect(map.setLevel).not.toHaveBeenCalled();
  expect(map.setCenter).not.toHaveBeenCalled();
  expect(map.panBy).not.toHaveBeenCalled();
  act(() => {
    overA();
    handler(markerB, 'click')();
  });
  expect(value.selectCafe).toHaveBeenCalledWith(value.items[1].bizesId);
  expect(maps.event.preventMap).toHaveBeenCalled();
  view.rerender({
    cafes: {
      ...value,
      selected: {
        bizesId: value.items[1].bizesId,
        scopeKey: value.scopeKey,
        revision: 1,
      },
    },
  });
  expect(pinned.open).toHaveBeenLastCalledWith(map, markerB);
  expect(maps.MarkerClusterer.mock.results[0].value.managed.has(markerB)).toBe(
    false,
  );
  const pinnedCloses = pinned.close.mock.calls.length;
  const hoverOpens = hover.open.mock.calls.length;
  act(() => {
    outB();
    overA();
    outA();
  });
  expect(pinned.close).toHaveBeenCalledTimes(pinnedCloses);
  expect(hover.open).toHaveBeenCalledTimes(hoverOpens);
  const fixedContent = pinned.setContent.mock.calls.at(-1)![0] as HTMLElement;
  fireEvent.click(
    within(fixedContent).getByRole('button', { name: '카페 상세 정보 닫기' }),
  );
  expect(value.clearCafeSelection).toHaveBeenCalledOnce();
  expect(maps.MarkerClusterer.mock.results[0].value.managed.has(markerB)).toBe(
    true,
  );
  expect(pinned.close).toHaveBeenCalledTimes(pinnedCloses + 1);
  view.unmount();
  const selectedCalls = vi.mocked(value.selectCafe).mock.calls.length;
  act(() => {
    overA();
    handler(markerA, 'click')();
  });
  expect(value.selectCafe).toHaveBeenCalledTimes(selectedCalls);
  for (const marker of [markerA, markerB]) {
    for (const event of ['click', 'mouseover', 'mouseout'])
      expect(maps.event.removeListener).toHaveBeenCalledWith(
        marker,
        event,
        expect.any(Function),
      );
  }
  expect(hover.close).toHaveBeenCalled();
});

test('Hover 중 결과 변경·삭제는 최신 정보를 표시하고 제거한 마커의 임시 정보와 리스너를 정리한다', () => {
  const { maps, map } = createSdk();
  const context = { maps, map };
  const value = clusterCafes(2);
  const view = renderHook(
    ({ cafes }) =>
      useCafeMap(
        context,
        { current: false },
        { current: null },
        undefined,
        cafes,
      ),
    { initialProps: { cafes: value } },
  );
  const marker = maps.Marker.mock.results[0].value;
  const over = maps.event.addListener.mock.calls.find(
    ([target, event]) => target === marker && event === 'mouseover',
  )![2];
  act(() => over());
  const hover = maps.InfoWindow.mock.results[1].value;
  view.rerender({
    cafes: {
      ...value,
      items: value.items.map((cafe) => ({
        ...cafe,
        branchName: '최신 지점',
        roadAddress: '최신 주소',
      })),
    },
  });
  expect(
    (hover.setContent.mock.calls.at(-1)![0] as HTMLElement).textContent,
  ).toContain('최신 지점');
  expect(
    (hover.setContent.mock.calls.at(-1)![0] as HTMLElement).textContent,
  ).toContain('최신 주소');
  const opens = hover.open.mock.calls.length;
  view.rerender({ cafes: { ...value, items: [] } });
  expect(hover.close).toHaveBeenCalled();
  expect(marker.setMap).toHaveBeenLastCalledWith(null);
  act(() => over());
  expect(hover.open).toHaveBeenCalledTimes(opens);
  expect(map.setCenter).not.toHaveBeenCalled();
});

test('200개 이름 라벨은 레벨 1·2에서만 겹침·화면 범위·40개 상한을 적용하고 클러스터와 함께 표시하지 않는다', async () => {
  const { maps, map } = createSdk();
  const context = { maps, map };
  const value = clusterCafes(200);
  vi.stubGlobal('innerWidth', 2000);
  vi.stubGlobal('innerHeight', 2000);
  const project = vi.fn(() => ({ x: 200, y: 200 }));
  map.getProjection.mockReturnValue({
    containerPointFromCoords: project,
    coordsFromContainerPoint: vi.fn(() => map.getCenter()),
  });
  const view = renderHook(() =>
    useCafeMap(
      context,
      { current: false },
      { current: null },
      undefined,
      value,
    ),
  );
  expect(maps.CustomOverlay).not.toHaveBeenCalled();
  act(() => map.setLevel(2));
  await waitFor(() => expect(maps.CustomOverlay).toHaveBeenCalledOnce());
  expect(maps.CustomOverlay.mock.calls[0][0].content.textContent).toBe(
    '카페 0',
  );
  expect(maps.CustomOverlay.mock.calls[0][0].content.className).toBe(
    'cafe-marker-label',
  );
  project.mockImplementation((...args: unknown[]) => {
    const position = args[0] as KakaoLatLng;
    const index = Math.round((position.getLng() - 126.978) / 0.00001);
    return {
      x: 100 + (index % 10) * 160,
      y: 100 + Math.floor(index / 10) * 40,
    };
  });
  act(() => map.setLevel(1));
  await waitFor(() => expect(maps.CustomOverlay).toHaveBeenCalledTimes(41));
  const labels = maps.CustomOverlay.mock.results
    .slice(1)
    .map(({ value }) => value);
  labels.forEach((label) => expect(label.setMap).toHaveBeenLastCalledWith(map));
  act(() => map.setLevel(3));
  await waitFor(() =>
    labels.forEach((label) =>
      expect(label.setMap).toHaveBeenLastCalledWith(null),
    ),
  );
  expect(maps.MarkerClusterer.mock.results[0].value.managed.size).toBe(200);
  expect(maps.InfoWindow).toHaveBeenCalledOnce();
  expect(value.selectCafe).not.toHaveBeenCalled();
  view.unmount();
  expect(maps.event.removeListener).toHaveBeenCalledWith(
    map,
    'zoom_changed',
    expect.any(Function),
  );
});

test('지역·반경 변경과 오류·빈 결과·지도 교체에서 기존 마커·정보창·클러스터를 정리한다', () => {
  const first = createSdk();
  const second = createSdk();
  const moving = { current: false };
  const notify = { current: null };
  const value = clusterCafes(2);
  const context = { maps: first.maps, map: first.map };
  const view = renderHook(
    ({ ctx, cafes }) => useCafeMap(ctx, moving, notify, undefined, cafes),
    { initialProps: { ctx: context, cafes: value } },
  );
  const clusterer = first.maps.MarkerClusterer.mock.results[0].value;
  const markers = first.maps.Marker.mock.results.map((result) => result.value);
  view.rerender({
    ctx: context,
    cafes: {
      ...value,
      mode: 'nearby',
      scopeKey: 'nearby:500',
      center: { longitude: 126.978, latitude: 37.5665 },
    },
  });
  expect(first.maps.MarkerClusterer).toHaveBeenCalledOnce();
  for (const marker of markers)
    expect(marker.setMap).toHaveBeenLastCalledWith(null);
  view.rerender({
    ctx: context,
    cafes: { ...value, scopeKey: 'nearby:1000', radiusM: 1000, items: [] },
  });
  expect(clusterer.managed.size).toBe(0);
  view.rerender({
    ctx: context,
    cafes: { ...value, status: 'error', items: [], error: 'API 실패' },
  });
  expect(clusterer.managed.size).toBe(0);
  view.rerender({ ctx: { maps: second.maps, map: second.map }, cafes: value });
  expect(clusterer.managed.size).toBe(0);
  expect(second.maps.MarkerClusterer).toHaveBeenCalledOnce();
  view.unmount();
  expect(second.maps.MarkerClusterer.mock.results[0].value.managed.size).toBe(
    0,
  );
});

test('카페만 묶고 후보지 A·B·C와 반경 중심 표식은 별도 계층에 유지한다', () => {
  const { maps, map } = createSdk();
  const context = { maps, map };
  const cafes = {
    ...clusterCafes(2),
    mode: 'nearby' as const,
    center: { longitude: 126.978, latitude: 37.5665 },
  };
  const add = vi.fn();
  const view = renderHook(() => {
    useCafeMap(
      context,
      { current: false },
      { current: null },
      undefined,
      cafes,
    );
    useCandidateMap(
      context,
      [
        {
          slot: 'A',
          name: '후보지 하나',
          longitude: 126.978,
          latitude: 37.5665,
        },
        { slot: 'B', name: '후보지 둘', longitude: 126.979, latitude: 37.5665 },
        { slot: 'C', name: '후보지 셋', longitude: 126.98, latitude: 37.5665 },
      ],
      'A',
      true,
      vi.fn(),
      add,
    );
  });
  const clusterer = maps.MarkerClusterer.mock.results[0].value;
  expect(maps.Marker).toHaveBeenCalledTimes(6);
  expect(clusterer.managed.size).toBe(2);
  const titles = [...clusterer.managed].map(
    (marker) => (marker as { title?: string }).title,
  );
  expect(titles).toEqual(['카페 0', '카페 1']);
  expect(
    maps.Marker.mock.calls
      .filter(([options]) => options.title.startsWith('후보지'))
      .map(([options]) => options.zIndex),
  ).toEqual([7, 6, 6]);
  const click = maps.event.addListener.mock.calls.find(
    ([target, type]) => target === clusterer && type === 'clusterclick',
  )![2] as unknown as (cluster: KakaoCluster) => void;
  act(() =>
    click({
      getCenter: () => new maps.LatLng(37.5665, 126.978),
      getClusterMarker: () => ({ setZIndex: vi.fn() }),
    }),
  );
  expect(maps.event.preventMap).toHaveBeenCalledOnce();
  expect(add).not.toHaveBeenCalled();
  view.unmount();
  for (const marker of maps.Marker.mock.results)
    expect(marker.value.setMap).toHaveBeenLastCalledWith(null);
});
