import { StrictMode, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KakaoMap, type MapCoordinate } from './KakaoMap'
import { loadKakaoMaps } from '../lib/loadKakaoMaps'
import { createKakaoMapsMock } from '../test/kakaoMapsMock'
import type { KakaoMapsSDK } from '../types/kakao-maps'
import { comparisonLocation } from '../test/comparisonFixture'
import type { Candidate } from '../types/comparison'
import { nearbyFixture } from '../test/nearbyFixture'

vi.mock('../lib/loadKakaoMaps', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/loadKakaoMaps')>(), loadKakaoMaps: vi.fn(),
}))
let mock: ReturnType<typeof createKakaoMapsMock>
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
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
  it('fits Seoul once after a positive viewport and preserves the camera across hidden and resized layouts', async () => {
    let width = 0, resize = () => {}
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback }; observe() {}; disconnect() {} })
    const setBounds = vi.fn(), relayout = vi.fn(), center = new mock.sdk.LatLng(37.57, 126.98), setCenter = vi.fn()
    mock.sdk.LatLngBounds = class { extend = vi.fn() }
    vi.mocked(mock.sdk.Map).mockImplementationOnce(function () { const instance = { relayout, setBounds, getCenter: () => center, setCenter }; mock.maps.push(instance); return instance })
    render(<KakaoMap selectedCoordinate={null} onCoordinateChange={vi.fn()} />)
    await ready()
    expect(setBounds).not.toHaveBeenCalled(); expect(relayout).not.toHaveBeenCalled()
    width = 800; act(() => resize())
    expect(setBounds).toHaveBeenCalledTimes(1)
    width = 0; act(() => resize())
    expect(relayout).toHaveBeenCalledTimes(1)
    width = 1000; act(() => resize())
    expect(setBounds).toHaveBeenCalledTimes(1)
    expect(setCenter).toHaveBeenLastCalledWith(center)
    expect(screen.queryByRole('button', { name: '지도 중심 선택' })).not.toBeInTheDocument()
  })
  it('preserves the last user center when relayout changes the SDK viewport geometry', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const userCenter = new mock.sdk.LatLng(37.58, 127.01)
    let center = userCenter
    const setCenter = vi.fn((value) => { center = value })
    const instance = { relayout: vi.fn(() => { center = new mock.sdk.LatLng(37.6, 127.2) }), getCenter: () => center, setCenter }
    vi.mocked(mock.sdk.Map).mockImplementationOnce(function () { return instance })
    render(<KakaoMap selectedCoordinate={null} onCoordinateChange={vi.fn()} />)
    await ready()
    const listener = vi.mocked(mock.sdk.event.addListener).mock.calls.find(call => String(call[1]) === 'center_changed')?.[2]
    expect(listener).toBeTypeOf('function')
    act(() => listener?.({ latLng: userCenter }))
    fireEvent(window, new Event('resize'))
    expect(setCenter).toHaveBeenCalledWith(userCenter)
  })
  it('ignores SDK center changes caused by an unprocessed viewport resize', async () => {
    let width = 800, resize = () => {}
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback }; observe() {}; disconnect() {} })
    const original = new mock.sdk.LatLng(37.58, 127.01)
    let center = original
    const setCenter = vi.fn(value => { center = value })
    vi.mocked(mock.sdk.Map).mockImplementationOnce(function () { return { relayout: vi.fn(), getCenter: () => center, setCenter } })
    render(<KakaoMap selectedCoordinate={null} onCoordinateChange={vi.fn()} />)
    await ready()
    const remember = vi.mocked(mock.sdk.event.addListener).mock.calls.find(call => String(call[1]) === 'center_changed')![2]
    width = 320
    center = new mock.sdk.LatLng(37.6, 126.9)
    act(() => remember({ latLng: center }))
    act(() => resize())
    expect(setCenter).toHaveBeenLastCalledWith(original)
  })
  it('links numbered candidate and nearby overlays, removes listeners on replacement and clears all layers on unmount', async () => {
    const overlays: { content: HTMLElement; setMap: ReturnType<typeof vi.fn> }[] = []
    const CustomOverlay = vi.fn(function (options: { content: HTMLElement }) {
      document.body.append(options.content)
      const overlay = { content: options.content, setMap: vi.fn((map) => { if (map === null) options.content.remove() }) }
      overlays.push(overlay)
      return overlay
    })
    vi.mocked(loadKakaoMaps).mockResolvedValue({ ...mock.sdk, CustomOverlay })
    const point = { lat: 37.56, lng: 126.97 }
    const candidate: Candidate = { id: 'one', number: 1, order: 1, coordinate: point, statsQuarter: null,
      location: { loading: false, error: null, result: comparisonLocation(point) },
      nearby: { loading: false, error: null, result: null }, stats: { loading: false, error: null, result: null } }
    const selectCandidate = vi.fn(), selectStore = vi.fn()
    const props = { selectedCoordinate: point, onCoordinateChange: vi.fn(), candidates: [candidate],
      stores: nearbyFixture(point).stores, onCandidateSelect: selectCandidate, onStoreSelect: selectStore }
    const view = render(<KakaoMap {...props} />)
    await ready()
    expect(overlays).toHaveLength(3)
    expect(overlays[0].content).toHaveAccessibleName('지도 · 후보 1 · 청운효자동')
    fireEvent.click(overlays[0].content)
    fireEvent.click(overlays[1].content)
    expect(selectCandidate).toHaveBeenCalledWith(candidate)
    expect(selectStore).toHaveBeenCalledWith(props.stores[0].sourceStoreId)
    overlays[1].content.focus()
    view.rerender(<KakaoMap {...props} activeStoreId={props.stores[0].sourceStoreId} />)
    expect(overlays[1].content).toHaveFocus()
    expect(overlays).toHaveLength(3)
    view.rerender(<KakaoMap {...props} candidates={[]} stores={[]} />)
    expect(overlays.every(overlay => overlay.setMap.mock.calls.some(([map]) => map === null))).toBe(true)
    fireEvent.click(overlays[0].content)
    expect(selectCandidate).toHaveBeenCalledTimes(1)
    expect(mock.maps).toHaveLength(1)
    view.unmount()
    expect(mock.markers[0].map).toBeNull()
  })
  it('shows a 500m circle, selects the keyboard-moved center only on confirmation and releases the circle', async () => {
    const change = vi.fn()
    const setMap = vi.fn(), setPosition = vi.fn()
    const Circle = vi.fn(function () { return { setMap, setPosition } })
    const center = new mock.sdk.LatLng(37.58, 127.01)
    const panBy = vi.fn(), getCenter = vi.fn(() => center)
    vi.mocked(mock.sdk.Map).mockImplementationOnce(function () {
      const instance = { relayout: vi.fn(), panBy, getCenter }
      mock.maps.push(instance)
      return instance
    })
    vi.mocked(loadKakaoMaps).mockResolvedValue({ ...mock.sdk, Circle })
    const view = render(<KakaoMap selectedCoordinate={null} onCoordinateChange={change} />)
    await ready()
    fireEvent.keyDown(screen.getByLabelText('창업 후보 위치 지도'), { key: 'ArrowRight' })
    expect(panBy).toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('창업 후보 위치 지도'), { key: 'Enter' })
    expect(change).toHaveBeenCalledWith({ lat: 37.58, lng: 127.01 })
    view.rerender(<KakaoMap selectedCoordinate={{ lat: 37.58, lng: 127.01 }} onCoordinateChange={change} />)
    expect(Circle).toHaveBeenCalledWith(expect.objectContaining({ radius: 500 }))
    view.unmount()
    expect(setMap).toHaveBeenCalledWith(null)
  })
  it('줌 컨트롤 등록 중 예외도 정리하고 재시도에서 중복 없이 복구한다', async () => {
    const controls: object[] = []
    const addControl = vi.fn().mockImplementationOnce(() => { throw new Error('partial registration') })
    const removeControl = vi.fn()
    const sdk = Object.assign({}, mock.sdk, {
      Map: vi.fn(function () { return { relayout: vi.fn(), addControl, removeControl } }),
      ZoomControl: vi.fn(function () { const control = {}; controls.push(control); return control }),
      ControlPosition: { RIGHT: 2 },
    })
    vi.mocked(loadKakaoMaps).mockResolvedValue(sdk)
    const view = render(<KakaoMap selectedCoordinate={null} onCoordinateChange={vi.fn()} />)
    await screen.findByText('지도를 초기화하지 못했습니다. 다시 시도해 주세요.')
    expect(removeControl).toHaveBeenCalledOnce()
    expect(removeControl).toHaveBeenCalledWith(controls[0])
    fireEvent.click(screen.getByRole('button', { name: '지도 다시 시도' }))
    await screen.findByText('지도가 준비되었습니다. 지도에서 위치를 클릭해 주세요.')
    expect(controls).toHaveLength(2)
    expect(controls[0]).not.toBe(controls[1])
    expect(addControl).toHaveBeenLastCalledWith(controls[1], sdk.ControlPosition.RIGHT)
    view.unmount()
    expect(removeControl).toHaveBeenCalledTimes(2)
    expect(removeControl).toHaveBeenLastCalledWith(controls[1])
  })

  it('SDK 표준 줌 컨트롤을 오른쪽에 등록하고 언마운트 시 제거한다', async () => {
    const control = {}
    const addControl = vi.fn()
    const removeControl = vi.fn()
    const sdk = Object.assign({}, mock.sdk, {
      Map: vi.fn(function () { return { relayout: vi.fn(), addControl, removeControl } }),
      ZoomControl: vi.fn(function () { return control }),
      ControlPosition: { RIGHT: 2 },
    })
    vi.mocked(loadKakaoMaps).mockResolvedValue(sdk)
    const view = render(<KakaoMap selectedCoordinate={null} onCoordinateChange={vi.fn()} />)
    await screen.findByText('지도가 준비되었습니다. 지도에서 위치를 클릭해 주세요.')
    expect(addControl).toHaveBeenCalledOnce()
    expect(addControl).toHaveBeenCalledWith(control, sdk.ControlPosition.RIGHT)
    view.unmount()
    expect(removeControl).toHaveBeenCalledOnce()
    expect(removeControl).toHaveBeenCalledWith(control)
  })

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
    expect(mock.sdk.event.addListener).toHaveBeenCalledTimes(2)
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
    expect(mock.maps[0].relayout).toHaveBeenCalledTimes(2)
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
    expect(mock.maps[1].relayout).toHaveBeenCalledTimes(2)
    act(() => mock.click(37.58, 127.01))
    expect(mock.markers).toHaveLength(1)
    view.unmount()
    fireEvent(window, new Event('resize'))
    expect(mock.maps[1].relayout).toHaveBeenCalledTimes(2)
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
