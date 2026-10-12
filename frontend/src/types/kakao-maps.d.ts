export interface KakaoLatLng {
  getLat(): number
  getLng(): number
}

export interface KakaoMapInstance {
  relayout(): void
}

export interface KakaoMarker {
  setMap(map: KakaoMapInstance | null): void
  setPosition(position: KakaoLatLng): void
}

export interface KakaoMapMouseEvent {
  latLng: KakaoLatLng
}

export interface KakaoMapsSDK {
  load(callback: () => void): void
  Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMapInstance
  LatLng: new (lat: number, lng: number) => KakaoLatLng
  Marker: new (options: { position: KakaoLatLng; map: KakaoMapInstance }) => KakaoMarker
  event: {
    addListener(map: KakaoMapInstance, type: 'click', handler: (event: KakaoMapMouseEvent) => void): void
    removeListener(map: KakaoMapInstance, type: 'click', handler: (event: KakaoMapMouseEvent) => void): void
  }
}

declare global {
  interface Window {
    // Constructors become available only after maps.load's callback.
    kakao?: { maps?: Partial<KakaoMapsSDK> & Pick<KakaoMapsSDK, 'load'> }
    __recycleYoungsKakaoMapsPromise?: Promise<KakaoMapsSDK>
  }
}
