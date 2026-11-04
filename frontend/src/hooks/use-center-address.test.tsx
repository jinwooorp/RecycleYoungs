import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useCenterAddress, type CenterPlace } from './use-center-address';
import type { CafeCenter } from '@/lib/cafes';
import type { KakaoMaps, KakaoSearchCallback } from '@/lib/kakao-maps';

const a = { longitude: 126.92, latitude: 37.55 };
const b = { longitude: 127.06, latitude: 37.54 };
const place = { name: '염창역', address: '서울특별시 강서구 공항대로 631' };
function sdk() {
  const callbacks: KakaoSearchCallback[] = [];
  const lookup = vi.fn(
    (_x: number, _y: number, callback: KakaoSearchCallback) =>
      callbacks.push(callback),
  );
  const maps = {
    services: {
      Status: { OK: 'OK' },
      Geocoder: function () {
        return { coord2Address: lookup };
      },
    },
  } as unknown as KakaoMaps;
  return { maps, lookup, callbacks };
}
afterEach(() => vi.useRealTimers());

test.each([
  [
    {
      road_address: { address_name: '서울 도로 1' },
      address: { address_name: '서울 지번 2' },
    },
    'OK',
    '서울 도로 1',
  ],
  [
    { road_address: null, address: { address_name: '서울 지번 2' } },
    'OK',
    '서울 지번 2',
  ],
  [
    {
      road_address: { address_name: '  ' },
      address: { address_name: '서울 지번 2' },
    },
    'OK',
    '서울 지번 2',
  ],
  [{ road_address: { address_name: 123 } }, 'OK', null],
  [null, 'ZERO_RESULT', null],
  [{ road_address: { address_name: '사용하면 안 되는 주소' } }, 'ERROR', null],
])(
  '도로명·지번 우선순위와 실패 기본 표시를 처리한다: %j',
  async (row, status, address) => {
    const { maps, lookup, callbacks } = sdk();
    const { result } = renderHook(() => useCenterAddress(maps, a, null));
    expect(result.current.pending).toBe(true);
    expect(lookup).toHaveBeenCalledWith(
      a.longitude,
      a.latitude,
      expect.any(Function),
    );
    act(() => callbacks[0](row ? [row] : [], status));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.address).toBe(address);
    expect(result.current.name).toBeNull();
  },
);

test('A→B 및 검색 선택·해제 후 오래된 주소 응답을 차단한다', async () => {
  const { maps, callbacks, lookup } = sdk();
  const view = renderHook(
    ({ center, selected }) => useCenterAddress(maps, center, selected),
    {
      initialProps: {
        center: a as CafeCenter | null,
        selected: null as CenterPlace | null,
      },
    },
  );
  view.rerender({ center: b, selected: null });
  act(() => callbacks[1]([{ address: { address_name: 'B 주소' } }], 'OK'));
  await waitFor(() => expect(view.result.current.address).toBe('B 주소'));
  act(() => callbacks[0]([{ address: { address_name: 'A 주소' } }], 'OK'));
  await act(async () => {});
  expect(view.result.current.address).toBe('B 주소');
  view.rerender({ center: a, selected: null });
  view.rerender({ center: b, selected: place });
  act(() => callbacks[2]([{ address: { address_name: '이전 A 주소' } }], 'OK'));
  await act(async () => {});
  expect(view.result.current).toEqual({ ...place, pending: false });
  expect(lookup).toHaveBeenCalledTimes(3);
  view.rerender({ center: b, selected: null });
  view.rerender({ center: null, selected: null });
  act(() => callbacks[3]([{ address: { address_name: '해제한 주소' } }], 'OK'));
  await act(async () => {});
  expect(view.result.current).toEqual({
    name: null,
    address: null,
    pending: false,
  });
});

test('검색 장소는 SDK 없이도 표시하고 같은 SDK 재연결·StrictMode에서는 요청을 공유한다', async () => {
  const { maps, lookup, callbacks } = sdk();
  const view = renderHook(
    ({ sdkMaps, selected }) => useCenterAddress(sdkMaps, a, selected),
    {
      initialProps: {
        sdkMaps: null as KakaoMaps | null,
        selected: place as CenterPlace | null,
      },
      wrapper: StrictMode,
    },
  );
  expect(view.result.current).toEqual({ ...place, pending: false });
  expect(lookup).not.toHaveBeenCalled();
  view.rerender({ sdkMaps: maps, selected: null });
  expect(lookup).toHaveBeenCalledOnce();
  view.rerender({ sdkMaps: null, selected: null });
  view.rerender({ sdkMaps: maps, selected: null });
  expect(lookup).toHaveBeenCalledOnce();
  act(() => callbacks[0]([{ address: { address_name: '현재 주소' } }], 'OK'));
  await waitFor(() => expect(view.result.current.address).toBe('현재 주소'));
  const replacement = sdk();
  view.rerender({ sdkMaps: replacement.maps, selected: null });
  expect(view.result.current.address).toBeNull();
  expect(replacement.lookup).toHaveBeenCalledOnce();
  act(() => replacement.callbacks[0]([], 'ERROR'));
  await waitFor(() => expect(view.result.current.pending).toBe(false));
});

test('StrictMode 최초 구독·시간 초과·언마운트에서 타이머와 늦은 응답을 정리한다', async () => {
  vi.useFakeTimers();
  const { maps, lookup, callbacks } = sdk();
  const view = renderHook(
    ({ center }) => useCenterAddress(maps, center, null),
    { initialProps: { center: a }, wrapper: StrictMode },
  );
  expect(lookup).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(8_000));
  expect(view.result.current).toEqual({
    name: null,
    address: null,
    pending: false,
  });
  act(() => callbacks[0]([{ address: { address_name: '늦은 주소' } }], 'OK'));
  await act(async () => {});
  expect(view.result.current.address).toBeNull();
  view.rerender({ center: b });
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() =>
    callbacks[1]([{ address: { address_name: '언마운트 주소' } }], 'OK'),
  );
});

test('SDK 동기 오류도 주소 실패로만 처리한다', async () => {
  const { maps, lookup } = sdk();
  lookup.mockImplementation(() => {
    throw new Error('SDK 오류');
  });
  const { result } = renderHook(() => useCenterAddress(maps, a, null));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.address).toBeNull();
});
