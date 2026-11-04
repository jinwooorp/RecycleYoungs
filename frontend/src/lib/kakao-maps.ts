/** 이번 탐색 화면에서 사용하는 Kakao Maps API 계약만 정의합니다. */
export interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}

export interface KakaoMouseEvent {
  latLng: KakaoLatLng;
}

export interface KakaoCircle {
  setMap(map: KakaoMap | null): void;
}

export interface KakaoCircleOptions {
  center: KakaoLatLng;
  radius: number;
  strokeWeight: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeStyle: 'dashed';
  fillColor: string;
  fillOpacity: number;
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
  setLevel(level: number, options?: { anchor: KakaoLatLng }): void;
  relayout(): void;
  getProjection(): {
    containerPointFromCoords(position: KakaoLatLng): { x: number; y: number };
    coordsFromContainerPoint(point: object): KakaoLatLng;
  };
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
  setZIndex(zIndex: number): void;
}
/** Cluster는 SDK 이벤트에서만 제공되며 직접 생성하지 않습니다. */
export interface KakaoCluster {
  getCenter(): KakaoLatLng;
  getClusterMarker(): { setZIndex(zIndex: number): void };
}
export interface KakaoMarkerClusterer {
  addMarkers(markers: KakaoMarker[], nodraw?: boolean): void;
  removeMarkers(markers: KakaoMarker[], nodraw?: boolean): void;
  clear(): void;
  redraw(): void;
}
export interface KakaoClustererOptions {
  map: KakaoMap;
  minLevel: number;
  gridSize: number;
  minClusterSize: number;
  averageCenter: boolean;
  disableClickZoom: boolean;
  calculator: number[];
  styles: Record<string, string>[];
  texts: (size: number) => string;
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

/** Services 검색 콜백은 취소 핸들을 반환하지 않으므로 호출자가 요청 세대를 구분합니다. */
export type KakaoSearchCallback = (
  result: unknown,
  status: string,
  pagination?: { hasNextPage?: boolean },
) => void;

export interface KakaoServices {
  Status: { OK: string; ZERO_RESULT: string; ERROR: string };
  SortBy: { ACCURACY: string };
  Places: new () => {
    keywordSearch(
      keyword: string,
      callback: KakaoSearchCallback,
      options: {
        size: number;
        page: number;
        sort: string;
      },
    ): void;
  };
  Geocoder: new () => {
    coord2Address(
      longitude: number,
      latitude: number,
      callback: KakaoSearchCallback,
    ): void;
    coord2RegionCode(
      longitude: number,
      latitude: number,
      callback: KakaoSearchCallback,
    ): void;
    addressSearch(
      address: string,
      callback: KakaoSearchCallback,
      options: { size: number; page: number },
    ): void;
  };
}

export interface KakaoMaps {
  CustomOverlay: new (options: {
    position: KakaoLatLng;
    content: HTMLElement;
    xAnchor: number;
    yAnchor: number;
    zIndex: number;
  }) => { setMap(map: KakaoMap | null): void };
  services: KakaoServices;
  MarkerClusterer: new (options: KakaoClustererOptions) => KakaoMarkerClusterer;
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  Circle: new (options: KakaoCircleOptions) => KakaoCircle;
  Size: new (width: number, height: number) => object;
  Point: new (x: number, y: number) => object;
  MarkerImage: new (
    src: string,
    size: object,
    options: { offset: object },
  ) => object;
  Polygon: new (options: KakaoPolygonOptions) => KakaoPolygon;
  Marker: new (options: {
    position: KakaoLatLng;
    title: string;
    image?: object;
    zIndex?: number;
    clickable?: boolean;
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
    preventMap(): void;
    addListener(
      target: KakaoMarkerClusterer,
      type: 'clusterclick',
      handler: (cluster: KakaoCluster) => void,
    ): void;
    addListener(
      target: KakaoMarkerClusterer,
      type: 'clustered',
      handler: (clusters: KakaoCluster[]) => void,
    ): void;
    addListener(
      target: KakaoMap | KakaoMarker,
      type: string,
      handler: (event?: KakaoMouseEvent) => void,
    ): void;
    removeListener(
      target: KakaoMarkerClusterer,
      type: 'clusterclick',
      handler: (cluster: KakaoCluster) => void,
    ): void;
    removeListener(
      target: KakaoMarkerClusterer,
      type: 'clustered',
      handler: (clusters: KakaoCluster[]) => void,
    ): void;
    removeListener(
      target: KakaoMap | KakaoMarker,
      type: string,
      handler: (event?: KakaoMouseEvent) => void,
    ): void;
  };
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}

let pending: Promise<KakaoMaps> | undefined;

function librariesReady(maps: KakaoMaps | undefined): maps is KakaoMaps {
  return !!(
    maps?.Map &&
    maps.LatLng &&
    typeof maps.MarkerClusterer === 'function' &&
    maps.services?.Places &&
    maps.services.Geocoder &&
    maps.services.Status &&
    maps.services.SortBy
  );
}

/** StrictMode와 여러 호출자가 동일한 SDK 준비 작업을 공유합니다. */
export function loadKakaoMaps(appKey: string): Promise<KakaoMaps> {
  if (!appKey.trim())
    return Promise.reject(new Error('Kakao JavaScript 키가 필요합니다.'));
  if (pending) return pending;
  if (librariesReady(window.kakao?.maps))
    return Promise.resolve(window.kakao.maps);

  const request = new Promise<KakaoMaps>((resolve, reject) => {
    const script = document.createElement('script');
    const url = new URL('https://dapi.kakao.com/v2/maps/sdk.js');
    url.searchParams.set('appkey', appKey.trim());
    url.searchParams.set('autoload', 'false');
    // SDK는 라이브러리 목록을 쉼표로 직접 분리하므로 구분자를 인코딩하지 않습니다.
    script.src = `${url.toString()}&libraries=services,clusterer`;
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
          if (!librariesReady(maps)) return onError();
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
