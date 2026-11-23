import { afterEach, expect, test, vi } from 'vitest';
import {
  requestCurrentPosition,
  verifySeoulLocation,
} from './current-location';
import type { KakaoMaps, KakaoSearchCallback } from './kakao-maps';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const point = { longitude: 126.92378, latitude: 37.55687 };
const row = (region_1depth_name = '서울특별시', region_type = 'H') => ({
  region_type,
  region_1depth_name,
});
function sdk(result: unknown, status = 'OK') {
  const lookup = vi.fn(
    (_x: number, _y: number, callback: KakaoSearchCallback) =>
      callback(result, status),
  );
  return {
    lookup,
    maps: {
      services: {
        Status: { OK: 'OK' },
        Geocoder: function () {
          return { coord2RegionCode: lookup };
        },
      },
    } as unknown as KakaoMaps,
  };
}

test('현재 위치는 유한한 시간·캐시 조건으로 조회하고 WGS84 좌표를 보존한다', async () => {
  const getCurrentPosition = vi.fn((done: PositionCallback) =>
    done({ coords: point } as unknown as GeolocationPosition),
  );
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  expect(await requestCurrentPosition()).toEqual({ point, reason: null });
  expect(getCurrentPosition).toHaveBeenCalledWith(
    expect.any(Function),
    expect.any(Function),
    { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false },
  );
});
test.each([
  [1, 'denied'],
  [2, 'unavailable'],
  [3, 'timeout'],
])('위치 오류 코드 %s를 안전한 안내 사유로 구분한다', async (code, reason) => {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (_: PositionCallback, fail: PositionErrorCallback) =>
        fail({
          code,
          message: '민감한 원본 메시지',
        } as GeolocationPositionError),
    },
  });
  expect(await requestCurrentPosition()).toEqual({ point: null, reason });
});
test('Geolocation 미지원과 동기 예외도 실패 결과로 반환한다', async () => {
  vi.stubGlobal('navigator', {});
  expect(await requestCurrentPosition()).toEqual({
    point: null,
    reason: 'unsupported',
  });
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: () => {
        throw new Error('권한 정책');
      },
    },
  });
  expect(await requestCurrentPosition()).toEqual({
    point: null,
    reason: 'unavailable',
  });
});
test.each([
  { longitude: NaN, latitude: 37 },
  { longitude: 181, latitude: 37 },
  { longitude: 127, latitude: -91 },
])('잘못된 좌표는 행정구역 조회에 전달하지 않는다: %j', async (coords) => {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (done: PositionCallback) =>
        done({ coords } as GeolocationPosition),
    },
  });
  expect(await requestCurrentPosition()).toEqual({
    point: null,
    reason: 'invalid',
  });
});
test.each([
  [[row(), row('서울특별시', 'B')], 'OK', 'seoul'],
  [[row('경기도')], 'OK', 'outside'],
  [[row(), row('경기도', 'B')], 'OK', 'unknown'],
  [[{ region_1depth_name: '서울특별시' }], 'OK', 'unknown'],
  [[], 'ZERO_RESULT', 'unknown'],
  [[row()], 'ERROR', 'unknown'],
] as const)(
  '실제 행정구역 응답으로 서울 여부를 판정한다: %j / %s',
  async (rows, status, expected) => {
    const { maps, lookup } = sdk(rows, status);
    expect(
      await verifySeoulLocation(maps, point, new AbortController().signal),
    ).toBe(expected);
    expect(lookup).toHaveBeenCalledWith(
      point.longitude,
      point.latitude,
      expect.any(Function),
    );
  },
);
test('행정구역 조회 제한 시간·취소 이후 도착한 SDK 콜백은 무시하고 타이머를 정리한다', async () => {
  vi.useFakeTimers();
  let complete!: KakaoSearchCallback;
  const { maps, lookup } = sdk([]);
  lookup.mockImplementation((_x, _y, callback) => {
    complete = callback;
  });
  const timeout = verifySeoulLocation(
    maps,
    point,
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(8000);
  expect(await timeout).toBe('unknown');
  complete([row()], 'OK');
  const controller = new AbortController();
  const cancelled = verifySeoulLocation(maps, point, controller.signal);
  const rejected = expect(cancelled).rejects.toMatchObject({
    name: 'AbortError',
  });
  controller.abort();
  await rejected;
  complete([row()], 'OK');
  expect(vi.getTimerCount()).toBe(0);
});
