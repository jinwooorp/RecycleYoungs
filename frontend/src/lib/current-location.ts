import type { KakaoMaps } from './kakao-maps';

export interface CurrentLocationPoint {
  longitude: number;
  latitude: number;
}
export type LocationFailure =
  | 'unsupported'
  | 'denied'
  | 'timeout'
  | 'unavailable'
  | 'invalid'
  | 'outside'
  | 'verification';
export type PositionResult =
  | { point: CurrentLocationPoint; reason: null }
  | { point: null; reason: LocationFailure };

export const locationMessages: Record<LocationFailure, string> = {
  unsupported: '현재 위치 기능을 사용할 수 없습니다. 현재 지도를 유지합니다.',
  denied: '위치 권한이 거부되었습니다. 현재 지도를 유지합니다.',
  timeout: '위치 확인 시간이 초과되었습니다. 현재 지도를 유지합니다.',
  unavailable: '현재 위치를 확인하지 못했습니다. 현재 지도를 유지합니다.',
  invalid: '유효한 위치를 확인하지 못했습니다. 현재 지도를 유지합니다.',
  outside: '서울 서비스 범위 밖입니다. 현재 지도를 유지합니다.',
  verification: '서울 소재 여부를 확인하지 못했습니다. 현재 지도를 유지합니다.',
};

/** 위치는 메모리에만 보관하며 브라우저 오류 메시지·원본 좌표를 로그로 전달하지 않습니다. */
export function requestCurrentPosition(): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ point: null, reason: 'unsupported' });
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { longitude, latitude } = position.coords;
          if (
            !Number.isFinite(longitude) ||
            !Number.isFinite(latitude) ||
            longitude < -180 ||
            longitude > 180 ||
            latitude < -90 ||
            latitude > 90
          ) {
            resolve({ point: null, reason: 'invalid' });
          } else resolve({ point: { longitude, latitude }, reason: null });
        },
        (error) =>
          resolve({
            point: null,
            reason:
              error.code === 1
                ? 'denied'
                : error.code === 3
                  ? 'timeout'
                  : 'unavailable',
          }),
        {
          timeout: 8_000,
          maximumAge: 60_000,
          enableHighAccuracy: false,
        },
      );
    } catch {
      resolve({ point: null, reason: 'unavailable' });
    }
  });
}

/** 사각형 추정 대신 실제 좌표→행정구역 응답을 확인합니다. 취소 불가능한 SDK 콜백은 무시합니다. */
export function verifySeoulLocation(
  maps: KakaoMaps,
  point: CurrentLocationPoint,
  signal: AbortSignal,
): Promise<'seoul' | 'outside' | 'unknown'> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('취소됨', 'AbortError'));
      return;
    }
    let active = true;
    const finish = (result: 'seoul' | 'outside' | 'unknown') => {
      if (!active) return;
      cleanup();
      resolve(result);
    };
    const abort = () => {
      if (active) {
        cleanup();
        reject(new DOMException('취소됨', 'AbortError'));
      }
    };
    const timeout = window.setTimeout(() => finish('unknown'), 8_000);
    function cleanup() {
      active = false;
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      new maps.services.Geocoder().coord2RegionCode(
        point.longitude,
        point.latitude,
        (rows, status) => {
          if (
            status !== maps.services.Status.OK ||
            !Array.isArray(rows) ||
            !rows.length
          ) {
            finish('unknown');
            return;
          }
          // 법정동(B)·행정동(H)이 모두 반환될 수 있습니다. 시·도 판정이 불일치하면 적용하지 않습니다.
          if (
            !rows.every(
              (row) =>
                row &&
                typeof row === 'object' &&
                (row.region_type === 'H' || row.region_type === 'B') &&
                typeof row.region_1depth_name === 'string' &&
                row.region_1depth_name.trim(),
            )
          ) {
            finish('unknown');
            return;
          }
          const regions = new Set(rows.map((row) => row.region_1depth_name));
          finish(
            regions.size !== 1
              ? 'unknown'
              : regions.has('서울특별시')
                ? 'seoul'
                : 'outside',
          );
        },
      );
    } catch {
      finish('unknown');
    }
  });
}
