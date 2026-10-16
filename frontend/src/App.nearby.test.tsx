import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { createKakaoMapsMock } from './test/kakaoMapsMock'
import { resolvedLocation } from './test/locationFixture'
import { nearbyFixture } from './test/nearbyFixture'
import { normalTrend } from './test/trendFixture'
import type { MapCoordinate } from './components/KakaoMap'
import { regionFixtureResponse, openStatisticsPanel, showMap } from './test/regionFixture'

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
const fetchMock = vi.fn<typeof fetch>()
let map: ReturnType<typeof createKakaoMapsMock>
let nearby: (c: MapCoordinate) => Promise<Response>
let location: (c: MapCoordinate) => Promise<Response>
beforeEach(() => {
  map = createKakaoMapsMock()
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-key')
  vi.stubGlobal('kakao', { maps: map.sdk })
  nearby = async c => json(nearbyFixture(c))
  location = async c => json({ ...resolvedLocation, coordinate: c })
  fetchMock.mockReset().mockImplementation(async input => {
    const region = regionFixtureResponse(input); if (region) return region
    const u = new URL(String(input), 'http://localhost')
    const c = { lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) }
    if (u.pathname === '/api/nearby-stores') return nearby(c)
    if (u.pathname === '/api/locations/resolve') return location(c)
    if (u.pathname === '/api/admin-dongs') return json([normalTrend.dong, { code: '11260550', name: '면목5동' }])
    if (u.pathname === '/api/industries') return json([{ code: 'CAFE', name: '카페' }, { code: 'PUB', name: '주점' }])
    if (u.pathname === '/api/quarters') return json([{ code: '20251', label: '2025년 1분기' }])
    if (u.pathname === '/api/admin-dong-stats') return json({ dong: normalTrend.dong, industry: normalTrend.industry, ...normalTrend.quarters[0] })
    if (u.pathname === '/api/admin-dong-trends') return json(normalTrend)
    throw new Error('Unexpected request')
  })
  vi.stubGlobal('fetch', fetchMock)
})
async function ready(strict = false) {
  const view = render(strict ? <StrictMode><App /></StrictMode> : <App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  return view
}
const click = (lat = 37.5665, lng = 126.978) => { showMap(); act(() => map.click(lat, lng)); openStatisticsPanel() }
const calls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/nearby-stores?'))
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (r: unknown) => void
  const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad })
  return { promise, resolve, reject }
}
it('requests exact coordinates and 500m on click, displays count and independent region', async () => {
  await ready(); click()
  expect(calls()[0][0]).toBe('/api/nearby-stores?lat=37.5665&lng=126.978&radius=500&industryCode=CAFE')
  expect(await screen.findByText('합성 카페 1')).toBeInTheDocument()
  expect(screen.getByText('2개', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByText('2m')).toBeInTheDocument()
  expect(await screen.findByText(/조회 조건에 해당 행정동이 반영/)).toBeInTheDocument()
  expect(screen.getByText(/snapshot 완전성 미검증/)).toBeInTheDocument()
})
it('shows loading and a real zero separately from unavailable data', async () => {
  const d = deferred<Response>(); nearby = () => d.promise
  await ready(); click()
  expect(screen.getByText('반경 500m 경쟁 카페를 조회하는 중입니다.')).toBeInTheDocument()
  await act(async () => d.resolve(json(nearbyFixture(undefined, 0))))
  expect(await screen.findByText(/현재 조회 가능한 카페 자료에서 이 위치 반경 내/)).toBeInTheDocument()
})
it('shows total count and truncated list separately', async () => {
  nearby = async c => json(nearbyFixture(c, 150))
  await ready(); click()
  expect(await screen.findByText('150개', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByText(/가까운 100개 수신/)).toBeInTheDocument()
  expect(screen.queryByText('합성 카페 101')).not.toBeInTheDocument()
})
it('shows 503 and retries the latest point without redoing region or statistics', async () => {
  nearby = async () => json({ code: 'STORES_DATA_UNAVAILABLE', message: '미준비', field: null }, 503)
  await ready(); click()
  expect(await screen.findByText(/카페가 0개라는 뜻이 아닙니다/)).toBeInTheDocument()
  const regionCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/locations/')).length
  nearby = async c => json(nearbyFixture(c))
  fireEvent.click(screen.getByRole('button', { name: '경쟁 카페 다시 시도' }))
  expect(await screen.findByText('합성 카페 1')).toBeInTheDocument()
  expect(calls()).toHaveLength(2)
  expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/locations/'))).toHaveLength(regionCalls)
})
it('handles network error and retry', async () => {
  nearby = async () => { throw new TypeError('offline') }
  await ready(); click()
  expect(await screen.findByText(/서버에 연결할 수 없습니다/)).toBeInTheDocument()
  nearby = async c => json(nearbyFixture(c))
  fireEvent.click(screen.getByRole('button', { name: '경쟁 카페 다시 시도' }))
  expect(await screen.findByText('합성 카페 1')).toBeInTheDocument()
})
it.each(['success', 'error'])('ignores old late %s even when AbortController is ignored', async outcome => {
  const first = deferred<Response>(); let n = 0
  nearby = async c => ++n === 1 ? first.promise : json({ ...nearbyFixture(c, 1), stores: [{ ...nearbyFixture(c, 1).stores[0], name: '최신 카페' }] })
  await ready(); click(); click(37.58, 126.99)
  expect(calls()[0][1]?.signal?.aborted).toBe(true)
  expect(await screen.findByText('최신 카페')).toBeInTheDocument()
  await act(async () => { if (outcome === 'success') first.resolve(json(nearbyFixture())); else first.reject(new TypeError('late')) })
  expect(screen.queryByText('합성 카페 1')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '경쟁 카페 다시 시도' })).not.toBeInTheDocument()
})
it('clears old list immediately on re-click', async () => {
  await ready(); click(); await screen.findByText('합성 카페 1')
  nearby = () => deferred<Response>().promise
  click(37.58, 126.99)
  expect(screen.queryByText('합성 카페 1')).not.toBeInTheDocument()
  expect(screen.getByText('반경 500m 경쟁 카페를 조회하는 중입니다.')).toBeInTheDocument()
})
it('aborts pending request on unmount under StrictMode', async () => {
  const d = deferred<Response>(); nearby = () => d.promise
  const view = await ready(true); click()
  expect(calls()).toHaveLength(1)
  view.unmount(); expect(calls()[0][1]?.signal?.aborted).toBe(true)
  await act(async () => d.resolve(json(nearbyFixture())))
})
it('offers no unsupported industry filter and preserves nearby results during manual condition changes', async () => {
  await ready(); click()
  await screen.findByText('합성 카페 1')
  expect(screen.queryByRole('combobox', { name: '업종' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('행정동'), { target: { value: '11260550' } })
  expect(screen.getByText('합성 카페 1')).toBeInTheDocument()
  expect(calls()).toHaveLength(1)
})
it.each(['ambiguous', 'failure'])('keeps competition independent from region %s', async kind => {
  location = async c => kind === 'failure' ? json({ code: 'BOUNDARY_DATA_UNAVAILABLE', message: '미준비', field: null }, 503)
    : json({ ...resolvedLocation, coordinate: c, adminDong: { ...resolvedLocation.adminDong, status: 'AMBIGUOUS_BOUNDARY',
      resolvedDong: null, candidates: [resolvedLocation.adminDong.resolvedDong, { ...resolvedLocation.adminDong.resolvedDong, code: '22222222', name: '합성 동 B' }] } })
  await ready(); click()
  expect(await screen.findByText('합성 카페 1')).toBeInTheDocument()
  expect(screen.getByLabelText('행정동')).toHaveValue('')
})
it('preserves manual statistics after cafe data failure', async () => {
  nearby = async () => json({ code: 'CAFE_DATA_UNAVAILABLE', message: '미준비', field: null }, 503)
  await ready(); click(); await screen.findByText(/카페가 0개라는 뜻이 아닙니다/)
  fireEvent.change(screen.getByLabelText('행정동'), { target: { value: normalTrend.dong.code } })
  fireEvent.change(screen.getByLabelText('분기'), { target: { value: '20251' } })
  openStatisticsPanel()
  fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/admin-dong-stats?'))).toBe(true))
  expect(await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })).toBeInTheDocument()
})
