/** 이번 탐색 화면에서 사용하는 Kakao Maps API 계약만 정의합니다. */
export interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}

export interface KakaoMap {
  setBounds(
    bounds: KakaoBounds,
    paddingTop?: number,
    paddingRight?: number,
    paddingBottom?: number,
    paddingLeft?: number,
  ): void;
  panBy(x: number, y: number): void;
  getCenter(): KakaoLatLng;
  getBounds(): KakaoBounds;
  setCenter(center: KakaoLatLng): void;
  getLevel(): number;
  setLevel(level: number): void;
  relayout(): void;
}

export interface KakaoBounds {
  getSouthWest(): KakaoLatLng;
  getNorthEast(): KakaoLatLng;
}

export interface KakaoPolygon {
  setMap(map: KakaoMap | null): void;
}

export interface KakaoMarker {
  setMap(map: KakaoMap | null): void;
}
export interface KakaoInfoWindow {
  setContent(content: HTMLElement): void;
  open(map: KakaoMap, marker: KakaoMarker): void;
  close(): void;
}
export interface KakaoMapContext {
  map: KakaoMap;
  maps: KakaoMaps;
}

export interface KakaoPolygonOptions {
  path: KakaoLatLng[][];
  strokeWeight: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeStyle: 'solid';
  fillColor: string;
  fillOpacity: number;
}

export interface KakaoMaps {
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  Polygon: new (options: KakaoPolygonOptions) => KakaoPolygon;
  Marker: new (options: {
    position: KakaoLatLng;
    title: string;
  }) => KakaoMarker;
  InfoWindow: new (options: {
    disableAutoPan: boolean;
    removable: boolean;
  }) => KakaoInfoWindow;
  LatLngBounds: new (
    southWest: KakaoLatLng,
    northEast: KakaoLatLng,
  ) => KakaoBounds;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => KakaoMap;
  event: {
    addListener(
      target: KakaoMap | KakaoMarker,
      type: string,
      handler: () => void,
    ): void;
    removeListener(
      target: KakaoMap | KakaoMarker,
      type: string,
      handler: () => void,
    ): void;
  };
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}

let pending: Promise<KakaoMaps> | undefined;

/** StrictMode와 여러 호출자가 동일한 SDK 준비 작업을 공유합니다. */
export function loadKakaoMaps(appKey: string): Promise<KakaoMaps> {
  if (!appKey.trim())
    return Promise.reject(new Error('Kakao JavaScript 키가 필요합니다.'));
  if (pending) return pending;
  if (window.kakao?.maps.Map && window.kakao.maps.LatLng)
    return Promise.resolve(window.kakao.maps);

  const request = new Promise<KakaoMaps>((resolve, reject) => {
    const script = document.createElement('script');
    const url = new URL('https://dapi.kakao.com/v2/maps/sdk.js');
    url.searchParams.set('appkey', appKey.trim());
    url.searchParams.set('autoload', 'false');
    script.src = url.toString();
    script.async = true;
    script.dataset.kakaoMapsSdk = '';
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      reject(new Error(message));
    };
    const onError = () => fail('지도를 불러오지 못했습니다.');
    const onLoad = () => {
      if (settled) return;
      const maps = window.kakao?.maps;
      if (!maps?.load) return onError();
      try {
        maps.load(() => {
          // 시간 초과한 요청의 늦은 콜백은 새 재시도에 영향을 주지 않습니다.
          if (settled) return;
          if (!maps.Map || !maps.LatLng) return onError();
          settled = true;
          cleanup();
          resolve(maps);
        });
      } catch {
        onError();
      }
    };
    const timeout = window.setTimeout(
      () => fail('지도 로딩 시간이 초과되었습니다.'),
      15_000,
    );
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    document.head.append(script);
  });
  pending = request;
  // 실패한 Promise를 재사용하지 않아 버튼으로 새 스크립트를 요청할 수 있습니다.
  void request.catch(() => {
    if (pending === request) pending = undefined;
  });
  return request;
}
