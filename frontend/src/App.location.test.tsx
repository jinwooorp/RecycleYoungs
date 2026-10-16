import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { createKakaoMapsMock } from './test/kakaoMapsMock'
import { resolvedLocation } from './test/locationFixture'
import { nearbyFixture } from './test/nearbyFixture'
import { normalTrend } from './test/trendFixture'
import { regionFixtureResponse, openStatisticsPanel, chooseRegion, showMap } from './test/regionFixture'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const fetchMock = vi.fn<typeof fetch>()
let map: ReturnType<typeof createKakaoMapsMock>
let locationResponse: (coordinate: { lat: number; lng: number }) => Promise<Response>
let dongs: { code: string; name: string }[]
let dongResponse: () => Promise<Response>
const normalStats = { dong: normalTrend.dong, industry: normalTrend.industry, ...normalTrend.quarters[0] }

beforeEach(() => {
  map = createKakaoMapsMock()
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-key')
  vi.stubGlobal('kakao', { maps: map.sdk })
  dongs = [{ code: '11110515', name: '청운효자동' }, { code: '11260550', name: '면목5동' }]
  dongResponse = async () => json(dongs)
  locationResponse = async coordinate => json({ ...resolvedLocation, coordinate })
  fetchMock.mockReset().mockImplementation(async input => {
    const region = regionFixtureResponse(input); if (region) return region
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/nearby-stores') return json(nearbyFixture({ lat: Number(url.searchParams.get('lat')), lng: Number(url.searchParams.get('lng')) }))
    if (url.pathname === '/api/admin-dongs') return dongResponse()
    if (url.pathname === '/api/industries') return json([{ code: 'CAFE', name: '카페' }])
    if (url.pathname === '/api/quarters') return json([{ code: '20251', label: '2025년 1분기' }])
    if (url.pathname === '/api/locations/resolve') return locationResponse({ lat: Number(url.searchParams.get('lat')), lng: Number(url.searchParams.get('lng')) })
    if (url.pathname === '/api/admin-dong-stats') return json(normalStats)
    if (url.pathname === '/api/admin-dong-trends') return json(normalTrend)
    throw new Error('Unexpected request')
  })
  vi.stubGlobal('fetch', fetchMock)
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
async function ready(strict = false) {
  const view = render(strict ? <StrictMode><App /></StrictMode> : <App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  return view
}
function click(lat = 37.5665, lng = 126.978) { showMap(); act(() => map.click(lat, lng)); openStatisticsPanel() }
const locationCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/locations/resolve'))
const statCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/admin-dong-'))
function manualSearchButton() {
  openStatisticsPanel()
  return screen.getByRole('button', { name: '조회하기' })
}
function chooseOtherConditions() {
  fireEvent.change(screen.getByLabelText('분석 분기'), { target: { value: '20251' } })
}

it('calls the API from an actual map click, displays loading and preserves full precision', async () => {
  const pending = deferred<Response>()
  locationResponse = () => pending.promise
  await ready(); click(37.57123456789, 126.98123456789)
  expect(screen.getByText('선택 위치의 행정동·상권을 판정하는 중입니다.')).toBeInTheDocument()
  expect(locationCalls()[0][0]).toBe('/api/locations/resolve?lat=37.57123456789&lng=126.98123456789')
  expect(screen.queryByText('37.571235')).not.toBeInTheDocument()
  expect(screen.getByLabelText('행정동')).toHaveValue('')
  expect(statCalls()).toHaveLength(0)
})

it('links one supported dong, keeps multiple memberships and automatically queries the supported quarter', async () => {
  const body = structuredClone(resolvedLocation)
  body.commercialArea.memberships.push({ ...body.commercialArea.memberships[0], code: '1002', name: '테스트 상권 B',
    sourceAttributeStatus: 'CONFLICT_OBSERVED', sourceAttributeDetail: 'H5 fixture conflict' })
  locationResponse = async () => json(body)
  await ready(); chooseOtherConditions(); click()
  await screen.findByRole('heading', { name: '선택 위치의 지역 판정' })
  expect(screen.getByLabelText('행정동')).toHaveValue('11110515')
  expect(screen.getByText(/조회 조건에 해당 행정동이 반영됐습니다/)).toBeInTheDocument()
  expect(screen.getByText(/테스트 상권 A/)).toBeInTheDocument()
  expect(screen.getByText(/테스트 상권 B/)).toBeInTheDocument()
  expect(screen.getByText(/H5 fixture conflict/)).toBeInTheDocument()
  await waitFor(() => expect(statCalls()).toHaveLength(2))
  openStatisticsPanel()
  expect(await screen.findByRole('heading', { name: '청운효자동 · 카페' })).toBeInTheDocument()
  expect(statCalls()).toHaveLength(2)
})

it('no commercial membership is a successful empty state', async () => {
  locationResponse = async () => json({ ...resolvedLocation, commercialArea: { ...resolvedLocation.commercialArea, status: 'NO_MEMBERSHIP', memberships: [] } })
  await ready(); click()
  expect(await screen.findByText('이 위치에 해당하는 상권이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('ambiguous dongs are all shown without automatic selection', async () => {
  const dong = resolvedLocation.adminDong.resolvedDong!
  locationResponse = async () => json({ ...resolvedLocation, adminDong: { ...resolvedLocation.adminDong, status: 'AMBIGUOUS_BOUNDARY', resolvedDong: null,
    candidates: [{ ...dong, pointRelation: 'BOUNDARY' }, { ...dong, code: '11260550', name: '면목5동', pointRelation: 'BOUNDARY' }] } })
  await ready(); click()
  const result = within(await screen.findByRole('region', { name: '선택 위치의 지역 판정' }))
  expect(result.getByText(/여러 행정동 경계/)).toBeInTheDocument()
  expect(result.getByText(/청운효자동/)).toBeInTheDocument()
  expect(result.getByText(/면목5동/)).toBeInTheDocument()
  expect(screen.getByLabelText('행정동')).toHaveValue('')
  expect(statCalls()).toHaveLength(0)
})

it('zero dongs does not claim to be outside Seoul or treat commercial results as failed', async () => {
  locationResponse = async () => json({ ...resolvedLocation, adminDong: { ...resolvedLocation.adminDong, status: 'OUTSIDE_OR_UNSUPPORTED',
    reason: 'NO_COVERING_OPERATIONAL_BOUNDARY', resolvedDong: null } })
  await ready(); click()
  expect(await screen.findByText(/지원 범위 밖·자료 누락·경계의 빈 영역/)).toBeInTheDocument()
  expect(screen.getByText(/테스트 상권 A/)).toBeInTheDocument()
  expect(screen.getByLabelText('행정동')).toHaveValue('')
})

it('a region known to the official catalog but absent from statistics cannot submit stats', async () => {
  dongs = [dongs[1]]
  await ready(); chooseOtherConditions(); click()
  expect(await screen.findByText(/통계 연결 자료가 현재 조회 조건 목록에 없습니다/)).toBeInTheDocument()
  expect(screen.getByLabelText('행정동')).toHaveValue('11110515')
  fireEvent.click(manualSearchButton())
  expect(statCalls()).toHaveLength(0)
})

it('clears old stats/trends on the next click even when resolving to the same dong', async () => {
  await ready(); click()
  await waitFor(() => expect(screen.getByLabelText('행정동')).toHaveValue('11110515'))
  chooseOtherConditions(); fireEvent.click(manualSearchButton())
  await screen.findByRole('heading', { name: '청운효자동 · 카페' })
  await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
  locationResponse = () => deferred<Response>().promise
  click(37.58, 126.99)
  expect(screen.queryByRole('heading', { name: '청운효자동 · 카페' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '2025년 4개 분기 추세' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '선택 위치의 지역 판정' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('행정동')).toHaveValue('')
})

it.each(['success', 'network', 'http'] as const)('ignores a late old %s after the second click even if fetch ignores abort', async mode => {
  const pending = deferred<Response>()
  locationResponse = () => pending.promise
  await ready(); click()
  const signal = locationCalls()[0][1]?.signal
  locationResponse = async coordinate => json({ ...resolvedLocation, coordinate, adminDong: { ...resolvedLocation.adminDong,
    resolvedDong: { ...resolvedLocation.adminDong.resolvedDong!, code: '11260550', name: '면목5동' } } })
  click(37.58, 126.99)
  expect(signal?.aborted).toBe(true)
  await waitFor(() => expect(screen.getByLabelText('행정동')).toHaveValue('11260550'))
  await act(async () => {
    if (mode === 'network') pending.reject(new TypeError('late error'))
    else pending.resolve(mode === 'success' ? json(resolvedLocation) : json({ code: 'INTERNAL_ERROR', message: 'late error', field: null }, 500))
  })
  expect(screen.getByLabelText('행정동')).toHaveValue('11260550')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: '선택 위치의 지역 판정' })).getByText(/면목5동/)).toBeInTheDocument()
})

it('unmount aborts the active location request under StrictMode', async () => {
  const pending = deferred<Response>(); locationResponse = () => pending.promise
  const view = await ready(true); click()
  const signal = locationCalls()[0][1]?.signal
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { pending.resolve(json(resolvedLocation)) })
})

it.each(['network', '503', 'invalid'] as const)('shows %s failure with useful retry and keeps manual search available', async mode => {
  locationResponse = async () => {
    if (mode === 'network') throw new TypeError('private error')
    return mode === '503' ? json({ code: 'BOUNDARY_DATA_UNAVAILABLE', message: 'not ready', field: null }, 503) : json({ ...resolvedLocation, adminDong: null })
  }
  await ready(); click()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(mode === '503' ? '경계 데이터가 준비되지 않았습니다' : mode === 'network' ? '서버에 연결할 수 없습니다' : '서버 응답을 확인할 수 없습니다')
  expect(alert).not.toHaveTextContent('private error')
  chooseRegion()
  await screen.findByRole('heading', { name: '청운효자동 · 카페' })
  locationResponse = async coordinate => json({ ...resolvedLocation, coordinate })
  fireEvent.click(screen.getByRole('button', { name: '지도 탐색' }))
  click()
  await screen.findByRole('heading', { name: '선택 위치의 지역 판정' })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '청운효자동 · 카페' })).not.toBeInTheDocument()
  expect(locationCalls()).toHaveLength(2)
})

it('manual dong selection during a pending location request is preserved', async () => {
  const pending = deferred<Response>(); locationResponse = () => pending.promise
  await ready(); click()
  chooseRegion('11260550')
  await act(async () => { pending.resolve(json(resolvedLocation)) })
  expect(screen.getByLabelText('행정동')).toHaveValue('11260550')
  expect(screen.queryByRole('heading', { name: '선택 위치의 지역 판정' })).not.toBeInTheDocument()
  showMap()
  expect(screen.getByRole('button', { name: '후보지에 추가' })).toBeDisabled()
})

it('connects after delayed lookup completion and automatically requests the resolved dong statistics', async () => {
  const pending = deferred<Response>(); dongResponse = () => pending.promise
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1)); click()
  await screen.findByText('통계 조회 조건 목록을 확인하는 중입니다.')
  expect(screen.getByLabelText('행정동')).toHaveValue('11110515')
  await act(async () => { pending.resolve(json(dongs)) })
  await waitFor(() => expect(screen.getByLabelText('행정동')).toHaveValue('11110515'))
  expect(locationCalls()).toHaveLength(1)
  await waitFor(() => expect(statCalls()).toHaveLength(2))
})

it('uses CAFE and the latest quarter actually provided by the server', async () => {
  await ready(); click()
  await waitFor(() => expect(screen.getByLabelText('행정동')).toHaveValue('11110515'))
  expect(screen.queryByRole('combobox', { name: '업종' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('분기')).toHaveValue('20251')
  openStatisticsPanel()
  await screen.findByRole('heading', { name: '청운효자동 · 카페' })
})

it('a location click aborts both pending stats requests and ignores their late success/error', async () => {
  const stats = deferred<Response>(), trend = deferred<Response>()
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((input, options) => {
    if (String(input).startsWith('/api/admin-dong-stats?')) return stats.promise
    if (String(input).startsWith('/api/admin-dong-trends?')) return trend.promise
    return original(input, options)
  })
  await ready()
  chooseRegion()
  await waitFor(() => expect(statCalls()).toHaveLength(2))
  const signals = statCalls().map(([, options]) => options?.signal)
  expect(signals).toHaveLength(2)
  locationResponse = () => new Promise(() => {})
  fireEvent.click(screen.getByRole('button', { name: '지도 탐색' }))
  click()
  expect(signals.every(signal => signal?.aborted)).toBe(true)
  await screen.findByText('선택 위치의 행정동·상권을 판정하는 중입니다.')
  await act(async () => { stats.resolve(json(normalStats)); trend.reject(new TypeError('late stats error')) })
  expect(screen.queryByRole('heading', { name: '청운효자동 · 카페' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '2025년 4개 분기 추세' })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('a lookup retry links the already resolved dong without rerunning location resolution', async () => {
  dongResponse = async () => { throw new TypeError('lookup unavailable') }
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1)); click()
  await screen.findByText('분석 조건 목록을 불러오지 못했습니다.')
  dongResponse = async () => json(dongs)
  openStatisticsPanel()
  fireEvent.click(screen.getByRole('button', { name: '조회 조건 다시 시도' }))
  await waitFor(() => expect(screen.getByLabelText('행정동')).toHaveValue('11110515'))
  expect(locationCalls()).toHaveLength(1)
  await waitFor(() => expect(statCalls()).toHaveLength(2))
})
