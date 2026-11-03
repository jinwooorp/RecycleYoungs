import { StrictMode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  loadKakaoMaps,
  type KakaoMaps,
  type KakaoLatLng,
  type KakaoBounds,
} from '@/lib/kakao-maps';
import { KakaoMapView } from './kakao-map';
import App from '@/App';

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
  const view = render(
    <KakaoMapView
      target={{
        kind: 'boundary',
        extent: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 },
      }}
    />,
  );
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
