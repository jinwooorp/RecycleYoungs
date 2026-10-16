export interface KakaoLatLng {
  getLat(): number
  getLng(): number
}

export interface KakaoMapInstance {
  relayout(): void
  getCenter?(): KakaoLatLng
  panBy?(x: number, y: number): void
  panTo?(position: KakaoLatLng): void
  setCenter?(position: KakaoLatLng): void
  addControl?(control: object, position: number): void
  removeControl?(control: object): void
}

export interface KakaoCircle {
  setMap(map: KakaoMapInstance | null): void
  setPosition(position: KakaoLatLng): void
}
export interface KakaoOverlay {
  setMap(map: KakaoMapInstance | null): void
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
  Circle?: new (options: { map: KakaoMapInstance; center: KakaoLatLng; radius: number; strokeWeight: number; strokeColor: string; strokeOpacity: number; fillColor: string; fillOpacity: number }) => KakaoCircle
  CustomOverlay?: new (options: { map: KakaoMapInstance; position: KakaoLatLng; content: HTMLElement; clickable: boolean; yAnchor: number; zIndex: number }) => KakaoOverlay
  ZoomControl?: new () => object
  ControlPosition?: { RIGHT: number }
  event: {
    addListener(map: KakaoMapInstance, type: 'click' | 'center_changed', handler: (event: KakaoMapMouseEvent) => void): void
    removeListener(map: KakaoMapInstance, type: 'click' | 'center_changed', handler: (event: KakaoMapMouseEvent) => void): void
  }
}

declare global {
  interface Window {
    // Constructors become available only after maps.load's callback.
    kakao?: { maps?: Partial<KakaoMapsSDK> & Pick<KakaoMapsSDK, 'load'> }
    __recycleYoungsKakaoMapsPromise?: Promise<KakaoMapsSDK>
  }
}
