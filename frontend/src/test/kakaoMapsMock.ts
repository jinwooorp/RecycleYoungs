import { vi } from 'vitest'
import type { KakaoLatLng, KakaoMapInstance, KakaoMapMouseEvent, KakaoMapsSDK } from '../types/kakao-maps'

export function createKakaoMapsMock() {
  const listeners = new Map<KakaoMapInstance, (event: KakaoMapMouseEvent) => void>()
  const centerListeners = new Map<KakaoMapInstance, (event: KakaoMapMouseEvent) => void>()
  const maps: KakaoMapInstance[] = []
  const markers: { position: KakaoLatLng; map: KakaoMapInstance | null; setMap: ReturnType<typeof vi.fn>; setPosition: ReturnType<typeof vi.fn> }[] = []
  const sdk: KakaoMapsSDK = {
    load: vi.fn((callback) => callback()),
    LatLng: class {
      private lat: number
      private lng: number
      constructor(lat: number, lng: number) { this.lat = lat; this.lng = lng }
      getLat() { return this.lat }
      getLng() { return this.lng }
    },
    Map: vi.fn(function () {
      const map = { relayout: vi.fn() }
      maps.push(map)
      return map
    }),
    Marker: vi.fn(function (options) {
      const marker = {
        ...options,
        map: options.map as KakaoMapInstance | null,
        setMap: vi.fn((map: KakaoMapInstance | null) => { marker.map = map }),
        setPosition: vi.fn((position: KakaoLatLng) => { marker.position = position }),
      }
      markers.push(marker)
      return marker
    }),
    event: {
      addListener: vi.fn((map, type, handler) => { (type === 'click' ? listeners : centerListeners).set(map, handler) }),
      removeListener: vi.fn((map, type, handler) => {
        const registry = type === 'click' ? listeners : centerListeners
        if (registry.get(map) === handler) registry.delete(map)
      }),
    },
  }
  return {
    sdk, maps, markers, listeners, centerListeners,
    click(lat: number, lng: number) {
      for (const handler of listeners.values()) handler({ latLng: new sdk.LatLng(lat, lng) })
    },
  }
}
