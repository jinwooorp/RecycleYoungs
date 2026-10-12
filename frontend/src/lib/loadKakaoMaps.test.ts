import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadKakaoMaps } from './loadKakaoMaps'
import { createKakaoMapsMock } from '../test/kakaoMapsMock'

const scripts = () => Array.from(document.scripts).filter((script) => script.src.startsWith('https://dapi.kakao.com/v2/maps/sdk.js'))

beforeEach(() => {
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-map-key')
  delete window.kakao
  delete window.__recycleYoungsKakaoMapsPromise
})
afterEach(() => {
  scripts().forEach((script) => script.remove())
  delete window.kakao
  delete window.__recycleYoungsKakaoMapsPromise
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('Kakao Maps SDK 로더', () => {
  it.each([undefined, '', '   '])('키 누락/빈 값(%s)은 script 요청 없이 거부한다', async (key) => {
    vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', key)
    await expect(loadKakaoMaps()).rejects.toThrow('지도 JavaScript 키가 설정되지 않았습니다.')
    expect(scripts()).toHaveLength(0)
  })

  it('동시 호출은 Promise와 script를 공유하고 maps.load 완료를 기다린다', async () => {
    let finish = () => {}
    const sdk = createKakaoMapsMock().sdk
    sdk.load = vi.fn((callback) => { finish = callback })
    const first = loadKakaoMaps()
    expect(loadKakaoMaps()).toBe(first)
    expect(scripts()).toHaveLength(1)
    expect(new URL(scripts()[0].src).searchParams.get('autoload')).toBe('false')
    window.kakao = { maps: { load: sdk.load } }
    scripts()[0].dispatchEvent(new Event('load'))
    const ready = vi.fn()
    void first.then(ready)
    await Promise.resolve()
    expect(ready).not.toHaveBeenCalled()
    window.kakao.maps = sdk
    finish()
    await expect(first).resolves.toBe(sdk)
    await expect(loadKakaoMaps()).resolves.toBe(sdk)
    expect(scripts()).toHaveLength(1)
  })

  it('HMR로 모듈이 재평가돼도 진행 중 Promise를 재사용한다', async () => {
    const first = loadKakaoMaps()
    vi.resetModules()
    const reloaded = await import('./loadKakaoMaps')
    expect(reloaded.loadKakaoMaps()).toBe(first)
    expect(scripts()).toHaveLength(1)
    window.kakao = { maps: createKakaoMapsMock().sdk }
    scripts()[0].dispatchEvent(new Event('load'))
    await first
  })

  it('이미 로드된 SDK는 script 없이 재사용한다', async () => {
    const sdk = createKakaoMapsMock().sdk
    window.kakao = { maps: sdk }
    await expect(loadKakaoMaps()).resolves.toBe(sdk)
    expect(scripts()).toHaveLength(0)
  })

  it('기존 진행 중 SDK script에 연결하고 새 script를 만들지 않는다', async () => {
    const script = document.createElement('script')
    script.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=test-map-key&autoload=false'
    document.head.append(script)
    const promise = loadKakaoMaps()
    expect(scripts()).toHaveLength(1)
    window.kakao = { maps: createKakaoMapsMock().sdk }
    script.dispatchEvent(new Event('load'))
    await promise
  })

  it('네트워크 실패 후 실패한 script를 제거하고 재시도할 수 있다', async () => {
    const first = loadKakaoMaps()
    const failed = scripts()[0]
    const rejection = expect(first).rejects.toThrow('지도를 불러오지 못했습니다.')
    failed.dispatchEvent(new Event('error'))
    await rejection
    expect(failed.isConnected).toBe(false)
    const retry = loadKakaoMaps()
    expect(scripts()).toHaveLength(1)
    expect(scripts()[0]).not.toBe(failed)
    window.kakao = { maps: createKakaoMapsMock().sdk }
    scripts()[0].dispatchEvent(new Event('load'))
    await retry
  })

  it('SDK 전역 객체가 없거나 load가 예외를 던지면 안전한 오류로 거부한다', async () => {
    const first = loadKakaoMaps()
    const rejection = expect(first).rejects.toThrow('지도를 불러오지 못했습니다.')
    scripts()[0].dispatchEvent(new Event('load'))
    await rejection
    window.kakao = { maps: { load: () => { throw new Error('internal config') } } }
    const next = loadKakaoMaps()
    const nextRejection = expect(next).rejects.toThrow('지도를 불러오지 못했습니다.')
    scripts()[0].dispatchEvent(new Event('load'))
    await nextRejection
  })

  it('SDK 초기화가 끝나지 않으면 timeout으로 거부하고 늦은 완료를 무시한다', async () => {
    vi.useFakeTimers()
    let finish = () => {}
    window.kakao = { maps: { load: (callback) => { finish = callback } } }
    const first = loadKakaoMaps()
    scripts()[0].dispatchEvent(new Event('load'))
    const rejection = expect(first).rejects.toThrow('지도 로딩 시간이 초과되었습니다.')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    finish()
    expect(window.__recycleYoungsKakaoMapsPromise).toBeUndefined()
  })

  it('bootstrap 내부 초기화 timeout 후에는 다른 kakao 기능을 보존하고 새 script로 재시도한다', async () => {
    vi.useFakeTimers()
    let finish = () => {}
    const first = loadKakaoMaps()
    const login = vi.fn()
    const namespace = { maps: { load: (callback: () => void) => { finish = callback } }, login }
    window.kakao = namespace
    scripts()[0].dispatchEvent(new Event('load'))
    const rejection = expect(first).rejects.toThrow('지도 로딩 시간이 초과되었습니다.')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    const retry = loadKakaoMaps()
    expect(scripts()).toHaveLength(1)
    expect(window.kakao).toBe(namespace)
    finish()
    const sdk = createKakaoMapsMock().sdk
    window.kakao.maps = sdk
    scripts()[0].dispatchEvent(new Event('load'))
    await expect(retry).resolves.toBe(sdk)
    expect(namespace.login).toBe(login)
  })

  it('외부에서 미리 만든 partial maps namespace는 실패해도 삭제하지 않는다', async () => {
    const external = { load: () => { throw new Error('external SDK') } }
    window.kakao = { maps: external }
    const promise = loadKakaoMaps()
    const rejection = expect(promise).rejects.toThrow('지도를 불러오지 못했습니다.')
    scripts()[0].dispatchEvent(new Event('load'))
    await rejection
    expect(window.kakao.maps).toBe(external)
    expect(scripts()).toHaveLength(0)
  })

  it('외부 script의 네트워크 실패는 script를 보존하고 재시도는 즉시 안내하며 SDK 복구를 재사용한다', async () => {
    const external = document.createElement('script')
    external.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=test-map-key&autoload=false'
    document.head.append(external)
    const original = external.outerHTML
    const first = loadKakaoMaps()
    const rejection = expect(first).rejects.toThrow('지도를 불러오지 못했습니다.')
    external.dispatchEvent(new Event('error'))
    await rejection
    expect(external.isConnected).toBe(true)
    expect(external.outerHTML).toBe(original)
    expect(window.__recycleYoungsKakaoMapsPromise).toBeUndefined()
    const retry = loadKakaoMaps()
    expect(loadKakaoMaps()).toBe(retry)
    await expect(retry).rejects.toThrow('페이지를 새로고침')
    expect(window.__recycleYoungsKakaoMapsPromise).toBeUndefined()
    expect(scripts()).toEqual([external])
    const sdk = createKakaoMapsMock().sdk
    window.kakao = { maps: sdk }
    await expect(loadKakaoMaps()).resolves.toBe(sdk)
    expect(scripts()).toEqual([external])
  })

  it('외부 script의 timeout은 전역 객체를 보존하고 늦은 완료와 반복 대기를 막는다', async () => {
    vi.useFakeTimers()
    const external = document.createElement('script')
    external.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=test-map-key&autoload=false'
    document.head.append(external)
    let finish = () => {}
    const login = vi.fn()
    const namespace = { maps: { load: (callback: () => void) => { finish = callback } }, login }
    window.kakao = namespace
    const first = loadKakaoMaps()
    const rejection = expect(first).rejects.toThrow('지도 로딩 시간이 초과되었습니다.')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    expect(external.isConnected).toBe(true)
    expect(window.kakao).toBe(namespace)
    expect(window.kakao.maps).toBe(namespace.maps)
    expect(namespace.login).toBe(login)
    finish()
    external.dispatchEvent(new Event('load'))
    expect(window.__recycleYoungsKakaoMapsPromise).toBeUndefined()
    await expect(loadKakaoMaps()).rejects.toThrow('페이지를 새로고침')
    expect(scripts()).toEqual([external])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('외부 소유자가 실패한 script를 교체하면 새 script를 추가하지 않고 재시도한다', async () => {
    const external = document.createElement('script')
    external.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=test-map-key&autoload=false'
    document.head.append(external)
    const first = loadKakaoMaps()
    const rejection = expect(first).rejects.toThrow('지도를 불러오지 못했습니다.')
    external.dispatchEvent(new Event('error'))
    await rejection
    expect(external.isConnected).toBe(true)
    // Replacement is performed by the external owner, not by the SDK loader.
    const replacement = external.cloneNode() as HTMLScriptElement
    external.replaceWith(replacement)
    const retry = loadKakaoMaps()
    expect(scripts()).toEqual([replacement])
    const sdk = createKakaoMapsMock().sdk
    window.kakao = { maps: sdk }
    replacement.dispatchEvent(new Event('load'))
    await expect(retry).resolves.toBe(sdk)
  })
})
