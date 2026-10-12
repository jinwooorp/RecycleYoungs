import type { KakaoMapsSDK } from '../types/kakao-maps'

export const mapLoadMessages = {
  missingKey: '지도 JavaScript 키가 설정되지 않았습니다.',
  failed: '지도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  timeout: '지도 로딩 시간이 초과되었습니다. 다시 시도해 주세요.',
  externalFailed: '외부 지도 SDK 스크립트를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
}

// A failed external script cannot be restarted safely by this loader.
const failedExternalScripts = new WeakSet<HTMLScriptElement>()

function isReady(maps: Partial<KakaoMapsSDK> | undefined): maps is KakaoMapsSDK {
  return !!maps && typeof maps.Map === 'function' && typeof maps.LatLng === 'function'
    && typeof maps.Marker === 'function' && typeof maps.load === 'function'
    && typeof maps.event?.addListener === 'function' && typeof maps.event?.removeListener === 'function'
}

export function loadKakaoMaps(): Promise<KakaoMapsSDK> {
  const key = import.meta.env.VITE_KAKAO_MAP_APP_KEY?.trim()
  if (!key) return Promise.reject(new Error(mapLoadMessages.missingKey))
  // Window survives HMR; an in-flight SDK request belongs to the page, not a component.
  if (window.__recycleYoungsKakaoMapsPromise) return window.__recycleYoungsKakaoMapsPromise
  if (isReady(window.kakao?.maps)) return Promise.resolve(window.kakao.maps)
  const preexistingMaps = window.kakao?.maps

  let script: HTMLScriptElement | undefined
  let settled = false
  let loading = false
  let ownsScript = false
  let initializedMaps: Partial<KakaoMapsSDK> | undefined
  const promise = new Promise<KakaoMapsSDK>((resolve, reject) => {
    const timer = window.setTimeout(() => fail(mapLoadMessages.timeout), 15_000)
    function cleanup() {
      window.clearTimeout(timer)
      script?.removeEventListener('load', initialize)
      script?.removeEventListener('error', onError)
    }
    function fail(message: string) {
      if (settled) return
      settled = true
      cleanup()
      if (ownsScript) script?.remove()
      else if (script) failedExternalScripts.add(script)
      // Discard only our own failed bootstrap namespace, preserving other Kakao SDKs.
      if (ownsScript && initializedMaps && initializedMaps !== preexistingMaps
        && window.kakao?.maps === initializedMaps && !isReady(initializedMaps)) {
        delete window.kakao.maps
      }
      reject(new Error(message))
    }
    function onError() { fail(mapLoadMessages.failed) }
    function initialize() {
      if (settled || loading) return
      const maps = window.kakao?.maps
      if (typeof maps?.load !== 'function') { fail(mapLoadMessages.failed); return }
      loading = true
      initializedMaps = maps
      try {
        maps.load(() => {
          if (settled) return
          const readyMaps = window.kakao?.maps
          if (!isReady(readyMaps)) { fail(mapLoadMessages.failed); return }
          settled = true
          cleanup()
          resolve(readyMaps)
        })
      } catch { fail(mapLoadMessages.failed) }
    }

    const sdkScripts = Array.from(document.scripts).filter((candidate) => {
      const url = new URL(candidate.src, document.baseURI)
      return url.hostname === 'dapi.kakao.com' && url.pathname === '/v2/maps/sdk.js'
    })
    script = sdkScripts.find((candidate) => !failedExternalScripts.has(candidate))
    if (!script && sdkScripts.length) {
      fail(mapLoadMessages.externalFailed)
      return
    }
    const isNew = !script
    if (!script) {
      script = document.createElement('script')
      ownsScript = true
      const url = new URL('https://dapi.kakao.com/v2/maps/sdk.js')
      url.searchParams.set('appkey', key)
      url.searchParams.set('autoload', 'false')
      script.src = url.toString()
      script.async = true
    }
    script.addEventListener('load', initialize)
    script.addEventListener('error', onError)
    if (isNew) document.head.append(script)
    else if (typeof window.kakao?.maps?.load === 'function') initialize()
  })
  const shared = promise.catch((error: unknown) => {
    if (window.__recycleYoungsKakaoMapsPromise === shared) delete window.__recycleYoungsKakaoMapsPromise
    throw error
  })
  window.__recycleYoungsKakaoMapsPromise = shared
  return shared
}
