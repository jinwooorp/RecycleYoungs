import { useEffect, useRef, useState } from 'react';
import type { CafeCenter } from '@/lib/cafes';
import type { KakaoMaps } from '@/lib/kakao-maps';

/** 좌표와 별도로 보관하는 표시 정보입니다. 검색 결과는 역지오코딩 없이 재사용합니다. */
export interface CenterPlace {
  name: string;
  address: string;
}

function addressFrom(rows: unknown): string | null {
  if (!Array.isArray(rows)) return null;
  // SDK 응답의 문자열만 사용하며 빈 도로명주소는 정상 지번주소로 대체합니다.
  for (const key of ['road_address', 'address']) {
    for (const row of rows) {
      const address = row?.[key]?.address_name;
      if (typeof address === 'string' && address.trim()) return address.trim();
    }
  }
  return null;
}

/** 카페 조회와 독립적으로 주소를 확인하고, 현재 중심점·SDK의 응답만 표시합니다. */
export function useCenterAddress(
  maps: KakaoMaps | null,
  center: CafeCenter | null,
  place: CenterPlace | null,
) {
  const job = useRef<{
    center: CafeCenter;
    maps: KakaoMaps;
    promise: Promise<string | null>;
  } | null>(null);
  const [result, setResult] = useState<{
    center: CafeCenter;
    maps: KakaoMaps;
    address: string | null;
  } | null>(null);
  useEffect(() => {
    if (!center || place || !maps) return;
    // StrictMode 재구독과 같은 SDK의 재연결은 진행 중인 콜백을 공유합니다.
    if (job.current?.center !== center || job.current.maps !== maps) {
      const promise = new Promise<string | null>((resolve) => {
        try {
          new maps.services.Geocoder().coord2Address(
            center.longitude,
            center.latitude,
            (rows, status) =>
              resolve(
                status === maps.services.Status.OK ? addressFrom(rows) : null,
              ),
          );
        } catch {
          resolve(null);
        }
      });
      job.current = { center, maps, promise };
    }
    let active = true;
    const finish = (address: string | null) => {
      if (!active) return;
      active = false;
      window.clearTimeout(timer);
      setResult({ center, maps, address });
    };
    const timer = window.setTimeout(() => finish(null), 8_000);
    void job.current.promise.then(finish);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [center, place, maps]);
  const current =
    result?.center === center && result?.maps === maps ? result : null;
  return {
    name: place?.name || null,
    address: place?.address || current?.address || null,
    pending: !!center && !place && !!maps && !current,
  };
}
