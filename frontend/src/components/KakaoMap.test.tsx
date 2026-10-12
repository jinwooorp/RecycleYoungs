import { StrictMode, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KakaoMap, type MapCoordinate } from './KakaoMap'
import { loadKakaoMaps } from '../lib/loadKakaoMaps'
import { createKakaoMapsMock } from '../test/kakaoMapsMock'
import type { KakaoMapsSDK } from '../types/kakao-maps'

vi.mock('../lib/loadKakaoMaps', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/loadKakaoMaps')>(), loadKakaoMaps: vi.fn(),
}))
let mock: ReturnType<typeof createKakaoMapsMock>
beforeEach(() => {
  mock = createKakaoMapsMock()
  vi.mocked(loadKakaoMaps).mockReset().mockResolvedValue(mock.sdk)
})
afterEach(() => { vi.restoreAllMocks() })

function Selection() {
  const [selected, setSelected] = useState<MapCoordinate | null>(null)
  return <><KakaoMap selectedCoordinate={selected} onCoordinateChange={setSelected} /><output>{JSON.stringify(selected)}</output></>
}
async function ready() { await waitFor(() => expect(mock.listeners.size).toBe(1)) }

describe('지도 위치 선택', () => {
  it('로딩 중 생성하지 않고 준비 후 서울 중심 지도만 생성한다', async () => {
    let resolve!: (sdk: KakaoMapsSDK) => void
    vi.mocked(loadKakaoMaps).mockReturnValue(new Promise((done) => { resolve = done }))
    render(<Selection />)
    expect(screen.getByText('지도를 불러오는 중입니다.')).toBeInTheDocument()
    expect(screen.getByText('지도를 불러오는 중입니다.').closest('[role="status"]')).toBeInTheDocument()
    expect(mock.maps).toHaveLength(0)
    expect(screen.getByText('null')).toBeInTheDocument()
    await act(async () => { resolve(mock.sdk) })
    await ready()
    expect(mock.maps).toHaveLength(1)
    const options = vi.mocked(mock.sdk.Map).mock.calls[0][1]
    expect(options.center.getLat()).toBe(37.5665)
    expect(options.center.getLng()).toBe(126.978)
    expect(mock.markers).toHaveLength(0)
  })

  it('클릭은 원래 정밀도의 상위 좌표를 저장하고 마커 하나를 이동시킨다', async () => {
    render(<Selection />)
    await ready()
    act(() => mock.click(37.57123456789, 126.98123456789))
    expect(screen.getByText('{"lat":37.57123456789,"lng":126.98123456789}')).toBeInTheDocument()
    expect(mock.markers).toHaveLength(1)
    expect(mock.markers[0].map).toBe(mock.maps[0])
    act(() => mock.click(37.58, 126.99))
    act(() => mock.click(37.59, 127.01))
    expect(mock.markers).toHaveLength(1)
    expect(mock.markers[0].position.getLat()).toBe(37.59)
    expect(mock.markers[0].position.getLng()).toBe(127.01)
    expect(screen.getByText('{"lat":37.59,"lng":127.01}')).toBeInTheDocument()
  })

  it.each([[NaN, 127], [Infinity, 127], [91, 127], [37, 181]])('잘못된 좌표(%s, %s)를 저장하지 않는다', async (lat, lng) => {
    const change = vi.fn()
    render(<KakaoMap selectedCoordinate={null} onCoordinateChange={change} />)
    await ready()
    act(() => mock.click(lat, lng))
    expect(change).not.toHaveBeenCalled()
    expect(mock.markers).toHaveLength(0)
  })

  it('상위 좌표 변경과 null 초기화도 마커에 반영하고 지도는 재생성하지 않는다', async () => {
    const view = render(<KakaoMap selectedCoordinate={null} onCoordinateChange={vi.fn()} />)
    await ready()
    view.rerender(<KakaoMap selectedCoordinate={{ lat: 37.6, lng: 127 }} onCoordinateChange={vi.fn()} />)
    expect(mock.markers).toHaveLength(1)
    view.rerender(<KakaoMap selectedCoordinate={{ lat: 37.7, lng: 127.1 }} onCoordinateChange={vi.fn()} />)
    expect(mock.markers[0].position.getLat()).toBe(37.7)
    view.rerender(<KakaoMap selectedCoordinate={null} onCoordinateChange={vi.fn()} />)
    expect(mock.markers[0].map).toBeNull()
    expect(mock.maps).toHaveLength(1)
  })

  it('언마운트는 같은 리스너와 마커를 제거한다', async () => {
    const view = render(<Selection />)
    await ready()
    act(() => mock.click(37.57, 127))
    const registered = vi.mocked(mock.sdk.event.addListener).mock.calls[0]
    view.unmount()
    expect(mock.sdk.event.removeListener).toHaveBeenCalledWith(...registered)
    expect(mock.listeners.size).toBe(0)
    expect(mock.markers[0].map).toBeNull()
  })

  it('로딩 중 언마운트 후 늦은 완료는 지도를 생성하지 않는다', async () => {
    let resolve!: (sdk: KakaoMapsSDK) => void
    vi.mocked(loadKakaoMaps).mockReturnValue(new Promise((done) => { resolve = done }))
    const view = render(<Selection />)
    view.unmount()
    await act(async () => { resolve(mock.sdk) })
    expect(mock.maps).toHaveLength(0)
    expect(mock.listeners.size).toBe(0)
  })

  it('StrictMode는 살아 있는 지도와 리스너를 하나씩 유지한다', async () => {
    render(<StrictMode><Selection /></StrictMode>)
    await ready()
    expect(mock.maps).toHaveLength(1)
    expect(mock.sdk.event.addListener).toHaveBeenCalledTimes(1)
    act(() => mock.click(37.57, 127))
    expect(mock.markers).toHaveLength(1)
  })

  it('키 누락과 SDK 실패는 지도 영역의 status로 안내하고 재시도한다', async () => {
    vi.mocked(loadKakaoMaps).mockRejectedValueOnce(new Error('지도 JavaScript 키가 설정되지 않았습니다.'))
    render(<Selection />)
    expect(await screen.findByText(/지도 JavaScript 키가 설정되지 않았습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '지도 다시 시도' }))
    await ready()
  })

  it('지도 생성 예외는 내부 설정 없이 안내한다', async () => {
    vi.mocked(mock.sdk.Map).mockImplementationOnce(() => { throw new Error('internal config') })
    render(<Selection />)
    expect(await screen.findByText('지도를 초기화하지 못했습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('internal config')).not.toBeInTheDocument()
  })

  it('SDK 로딩 실패는 status로 안내하고 재시도 후 복구한다', async () => {
    vi.mocked(loadKakaoMaps).mockRejectedValueOnce(new Error('network config must stay hidden'))
    render(<Selection />)
    expect(await screen.findByText('지도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('network config must stay hidden')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '지도 다시 시도' }))
    await ready()
    expect(mock.maps).toHaveLength(1)
  })

  it('로딩 중 바뀐 상위 좌표와 최신 콜백을 사용한다', async () => {
    let resolve!: (sdk: KakaoMapsSDK) => void
    vi.mocked(loadKakaoMaps).mockReturnValue(new Promise((done) => { resolve = done }))
    const original = vi.fn()
    const latest = vi.fn()
    const view = render(<KakaoMap selectedCoordinate={null} onCoordinateChange={original} />)
    view.rerender(<KakaoMap selectedCoordinate={{ lat: 37.6, lng: 127 }} onCoordinateChange={latest} />)
    await act(async () => { resolve(mock.sdk) })
    await ready()
    expect(mock.markers[0].position.getLat()).toBe(37.6)
    act(() => mock.click(37.7, 127.1))
    expect(latest).toHaveBeenCalledWith({ lat: 37.7, lng: 127.1 })
    expect(original).not.toHaveBeenCalled()
    expect(mock.markers[0].position.getLat()).toBe(37.6)
  })

  it('화면 크기 변경 시 relayout하고 observer를 정리한다', async () => {
    let resize = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe = observe
      disconnect = disconnect
    })
    const view = render(<Selection />)
    await ready()
    expect(observe).toHaveBeenCalledWith(screen.getByLabelText('창업 후보 위치 지도'))
    resize()
    expect(mock.maps[0].relayout).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it.each(['constructor', 'observe'])('ResizeObserver %s 예외 후 리스너와 DOM을 정리하고 재시도한다', async (stage) => {
    let failOnce = true
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor() {
        if (stage === 'constructor' && failOnce) {
          failOnce = false
          throw new Error('observer construction failed')
        }
      }
      observe() {
        if (stage === 'observe' && failOnce) {
          failOnce = false
          throw new Error('observer registration failed')
        }
      }
      disconnect = disconnect
    })
    vi.mocked(mock.sdk.Map).mockImplementation(function (element) {
      element.append(document.createElement('span'))
      const instance = { relayout: vi.fn() }
      mock.maps.push(instance)
      return instance
    })
    const change = vi.fn()
    const view = render(<KakaoMap selectedCoordinate={null} onCoordinateChange={change} />)
    expect(await screen.findByText('지도를 초기화하지 못했습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(mock.listeners.size).toBe(0)
    expect(screen.getByLabelText('창업 후보 위치 지도').childElementCount).toBe(0)
    expect(mock.sdk.event.removeListener).toHaveBeenCalledWith(...vi.mocked(mock.sdk.event.addListener).mock.calls[0])
    expect(disconnect).toHaveBeenCalledTimes(stage === 'observe' ? 1 : 0)
    act(() => mock.click(37.57, 127))
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '지도 다시 시도' }))
    await ready()
    expect(mock.maps).toHaveLength(2)
    expect(mock.listeners.has(mock.maps[0])).toBe(false)
    act(() => mock.click(37.58, 127.01))
    expect(change).toHaveBeenCalledExactlyOnceWith({ lat: 37.58, lng: 127.01 })
    view.rerender(<KakaoMap selectedCoordinate={{ lat: 37.58, lng: 127.01 }} onCoordinateChange={change} />)
    expect(mock.markers).toHaveLength(1)
    expect(mock.markers[0].map).toBe(mock.maps[1])
    view.unmount()
    expect(mock.listeners.size).toBe(0)
    expect(mock.markers[0].map).toBeNull()
    expect(disconnect).toHaveBeenCalledTimes(stage === 'observe' ? 2 : 1)
  })

  it('클릭 리스너 등록 중 예외도 이미 등록된 리스너를 제거하고 재시도한다', async () => {
    const register = mock.sdk.event.addListener
    vi.mocked(register).mockImplementationOnce((map, _type, handler) => {
      mock.listeners.set(map, handler)
      throw new Error('listener registration failed')
    })
    const change = vi.fn()
    render(<KakaoMap selectedCoordinate={null} onCoordinateChange={change} />)
    expect(await screen.findByText('지도를 초기화하지 못했습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(mock.listeners.size).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '지도 다시 시도' }))
    await ready()
    act(() => mock.click(37.58, 127.01))
    expect(change).toHaveBeenCalledExactlyOnceWith({ lat: 37.58, lng: 127.01 })
  })

  it('window resize 등록 중 예외는 두 리스너를 정리하고 재시도 후 언마운트도 정리한다', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    let failOnce = true
    const add = window.addEventListener.bind(window)
    const registration = vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, options) => {
      add(type, handler, options)
      if (type === 'resize' && failOnce) {
        failOnce = false
        throw new Error('resize registration failed')
      }
    })
    const removal = vi.spyOn(window, 'removeEventListener')
    const view = render(<Selection />)
    expect(await screen.findByText('지도를 초기화하지 못했습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(mock.listeners.size).toBe(0)
    const failedRegistration = registration.mock.calls.find(([type]) => type === 'resize')!
    expect(removal).toHaveBeenCalledWith(...failedRegistration.slice(0, 2))
    fireEvent(window, new Event('resize'))
    expect(mock.maps[0].relayout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '지도 다시 시도' }))
    await ready()
    fireEvent(window, new Event('resize'))
    expect(mock.maps[1].relayout).toHaveBeenCalledTimes(1)
    act(() => mock.click(37.58, 127.01))
    expect(mock.markers).toHaveLength(1)
    view.unmount()
    fireEvent(window, new Event('resize'))
    expect(mock.maps[1].relayout).toHaveBeenCalledTimes(1)
    expect(mock.listeners.size).toBe(0)
    expect(mock.markers[0].map).toBeNull()
  })

  it('실제 로더와 StrictMode에서도 script 하나이며 언마운트 후 SDK를 보존한다', async () => {
    const actual = await vi.importActual<typeof import('../lib/loadKakaoMaps')>('../lib/loadKakaoMaps')
    vi.mocked(loadKakaoMaps).mockImplementation(actual.loadKakaoMaps)
    vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-map-key')
    delete window.__recycleYoungsKakaoMapsPromise
    const view = render(<StrictMode><Selection /></StrictMode>)
    const scripts = Array.from(document.scripts).filter((script) => script.src.startsWith('https://dapi.kakao.com/v2/maps/sdk.js'))
    expect(scripts).toHaveLength(1)
    expect(mock.maps).toHaveLength(0)
    vi.stubGlobal('kakao', { maps: mock.sdk })
    await act(async () => { scripts[0].dispatchEvent(new Event('load')) })
    await ready()
    expect(mock.maps).toHaveLength(1)
    view.unmount()
    expect(scripts[0].isConnected).toBe(true)
    scripts[0].remove()
    delete window.__recycleYoungsKakaoMapsPromise
  })
})
