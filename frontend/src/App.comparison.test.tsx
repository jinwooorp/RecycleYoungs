import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { createKakaoMapsMock } from './test/kakaoMapsMock'
import { comparisonLocation, comparisonLookups, comparisonStats } from './test/comparisonFixture'
import { nearbyFixture } from './test/nearbyFixture'
import { normalTrend } from './test/trendFixture'
import type { MapCoordinate } from './components/KakaoMap'
import type { Lookups, StatsQuery } from './types/api'

const p1 = { lat: 37.5665, lng: 126.978 }, p2 = { lat: 37.58, lng: 126.99 }, p3 = { lat: 37.59, lng: 127.01 }
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
const fetchMock = vi.fn<typeof fetch>()
let map: ReturnType<typeof createKakaoMapsMock>
let location: (c: MapCoordinate) => Promise<Response>
let nearby: (c: MapCoordinate) => Promise<Response>
let stats: (q: StatsQuery) => Promise<Response>
let lookups: Lookups
beforeEach(() => {
  map = createKakaoMapsMock(); lookups = structuredClone(comparisonLookups)
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-key')
  vi.stubGlobal('kakao', { maps: map.sdk })
  location = async c => json(comparisonLocation(c, c.lat >= 37.58 ? '11260550' : '11110515'))
  nearby = async c => json(nearbyFixture(c))
  stats = async q => json(comparisonStats(q.dongCode, q.quarterCode))
  fetchMock.mockReset().mockImplementation(async input => {
    const u = new URL(String(input), 'http://localhost')
    const c = { lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) }
    if (u.pathname === '/api/admin-dongs') return json(lookups.adminDongs)
    if (u.pathname === '/api/industries') return json(lookups.industries)
    if (u.pathname === '/api/quarters') return json(lookups.quarters)
    if (u.pathname === '/api/locations/resolve') return location(c)
    if (u.pathname === '/api/nearby-stores') return nearby(c)
    if (u.pathname === '/api/admin-dong-stats') return stats({ dongCode: u.searchParams.get('dongCode')!,
      industryCode: u.searchParams.get('industryCode')!, quarterCode: u.searchParams.get('quarterCode')! })
    if (u.pathname === '/api/admin-dong-trends') return json(normalTrend)
    throw new Error('Unexpected API')
  })
  vi.stubGlobal('fetch', fetchMock)
})
async function ready(strict = false) {
  const view = render(strict ? <StrictMode><App /></StrictMode> : <App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  await waitFor(() => expect(screen.getByLabelText('행정동')).toBeEnabled())
  return view
}
const comparison = () => screen.getByRole('region', { name: '창업 후보지 비교' })
const candidate = (n: number) => within(comparison()).getByRole('article', { name: `후보 ${n}` })
const click = (c: MapCoordinate) => act(() => map.click(c.lat, c.lng))
const add = (c: MapCoordinate) => { click(c); fireEvent.click(screen.getByRole('button', { name: '후보지에 추가' })) }
const calls = (path: string) => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(path))
const selectQuarter = (q = '20251') => fireEvent.change(screen.getByLabelText('비교 통계 분기'), { target: { value: q } })
async function compare() {
  selectQuarter()
  await waitFor(() => expect(screen.getByRole('button', { name: '비교 통계 조회' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '비교 통계 조회' }))
  await waitFor(() => expect(within(candidate(1)).getByText(/2025년 1분기 ·/)).toBeInTheDocument())
}
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad })
  return { promise, resolve, reject }
}

it('offers candidate registration and waits for a selected coordinate', async () => {
  await ready()
  expect(screen.getByRole('button', { name: '후보지에 추가' })).toBeDisabled()
  expect(within(comparison()).getByText('등록한 후보 0/3')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
it('adds 1/2/3, prevents a fourth, preserves saved candidates on exploration and replaces a deleted slot', async () => {
  await ready(); add(p1)
  expect(within(comparison()).getByText('등록한 후보 1/3')).toBeInTheDocument()
  add(p2); expect(within(comparison()).getByText('등록한 후보 2/3')).toBeInTheDocument()
  add(p3); expect(within(comparison()).getByText('등록한 후보 3/3')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '후보지에 추가' })).toBeDisabled()
  click({ lat: 37.6, lng: 127.1 })
  expect(within(candidate(1)).getByText('위도 37.5665 / 경도 126.978')).toBeInTheDocument()
  expect(within(comparison()).getAllByRole('article')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '후보 2 삭제' }))
  expect(screen.getByRole('button', { name: '후보지에 추가' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '후보지에 추가' }))
  expect(within(candidate(2)).getByText('위도 37.6 / 경도 127.1')).toBeInTheDocument()
  expect(within(candidate(3)).getByText('위도 37.59 / 경도 127.01')).toBeInTheDocument()
  await waitFor(() => expect(within(candidate(2)).getByText(/조회 자료의 경쟁 카페/)).toBeInTheDocument())
})
it('disables exact duplicates but allows nearby distinct full-precision coordinates', async () => {
  await ready(); add(p1)
  expect(screen.getByRole('button', { name: '후보지에 추가' })).toBeDisabled()
  expect(within(comparison()).getByText(/선택한 정확한 좌표가 이미/)).toBeInTheDocument()
  add({ ...p1, lat: p1.lat + 1e-12 })
  expect(within(comparison()).getAllByRole('article')).toHaveLength(2)
  expect(within(candidate(2)).getByText(`위도 ${p1.lat + 1e-12} / 경도 ${p1.lng}`)).toBeInTheDocument()
  await waitFor(() => expect(within(candidate(2)).getByText(/조회 자료의 경쟁 카페/)).toBeInTheDocument())
})
it('shows totalCount rather than list length, zero separately from 503 and preserves partial success', async () => {
  nearby = async c => c.lat === p1.lat ? json(nearbyFixture(c, 150)) : c.lat === p2.lat ? json(nearbyFixture(c, 0))
    : json({ code: 'STORES_DATA_UNAVAILABLE', message: '미준비', field: null }, 503)
  await ready(); add(p1); add(p2); add(p3)
  expect(await within(candidate(1)).findByText('150개', { selector: 'strong' })).toBeInTheDocument()
  expect(within(candidate(1)).getByText('점포 목록 100개 / 제한 100개 · 일부 목록')).toBeInTheDocument()
  expect(await within(candidate(2)).findByText(/현재 조회 가능한 자료의 반경 내 0개/)).toBeInTheDocument()
  expect(await within(candidate(3)).findByText(/점포 자료 또는 업종 매핑 미준비/)).toBeInTheDocument()
  expect(within(candidate(3)).queryByText('0개', { selector: 'strong' })).not.toBeInTheDocument()
  nearby = async c => json(nearbyFixture(c))
  fireEvent.click(screen.getByRole('button', { name: '후보 3 카페 다시 조회' }))
  expect(await within(candidate(3)).findByText('2개', { selector: 'strong' })).toBeInTheDocument()
  expect(within(candidate(1)).getByText('150개', { selector: 'strong' })).toBeInTheDocument()
})
it('compares all nine statistics, retaining BIGINT, NULL, NO_ROW and zero semantics', async () => {
  stats = async q => {
    const body = comparisonStats(q.dongCode, q.quarterCode)
    if (q.dongCode === '11260550') return json({ ...body, storeStats: null, salesStats: null, missingReasons: { storeStats: 'NO_ROW', salesStats: 'NO_ROW' } })
    return json({ ...body, storeStats: { ...body.storeStats!, storeCount: 0, similarStoreCount: null },
      salesStats: { estimatedSalesAmount: '9007199254740993', transactionCount: '0', weekdayEstimatedSalesAmount: null, weekendEstimatedSalesAmount: '0' } })
  }
  await ready(); add(p1); add(p2); await compare()
  const first = within(within(candidate(1)).getByRole('region', { name: '후보 1 행정동 통계' }))
  expect(first.getByText('9,007,199,254,740,993원')).toBeInTheDocument()
  expect(first.getByText('0개')).toBeInTheDocument(); expect(first.getByText('0건')).toBeInTheDocument(); expect(first.getByText('0원')).toBeInTheDocument()
  expect(first.getAllByText('값 없음(NULL)')).toHaveLength(2)
  await waitFor(() => expect(within(candidate(2)).getAllByText('조회 행 없음(NO_ROW)')).toHaveLength(9))
  expect(first.getAllByRole('definition')).toHaveLength(9)
})
it('invalidates all old-quarter metrics immediately and keeps region/cafe results', async () => {
  await ready(); add(p1); add(p2); await compare()
  selectQuarter('20252')
  expect(within(candidate(1)).queryByText(/2025년 1분기 ·/)).not.toBeInTheDocument()
  expect(within(candidate(2)).queryByText(/2025년 1분기 ·/)).not.toBeInTheDocument()
  expect(within(candidate(1)).getByText(/조회 자료의 경쟁 카페/)).toBeInTheDocument()
  const count = calls('/api/admin-dong-stats').length
  expect(calls('/api/admin-dong-stats')).toHaveLength(count)
  fireEvent.click(screen.getByRole('button', { name: '비교 통계 조회' }))
  expect(await within(candidate(1)).findByText(/2025년 2분기 ·/)).toBeInTheDocument()
  expect(await within(candidate(2)).findByText(/2025년 2분기 ·/)).toBeInTheDocument()
})
it('warns for shared dong statistics and retains two separate locations', async () => {
  location = async c => json(comparisonLocation(c))
  await ready(); add(p1); add(p2); await compare()
  expect(within(comparison()).getByText(/통계는 동일 행정동의 집계값/)).toBeInTheDocument()
  expect(within(comparison()).getAllByRole('article')).toHaveLength(2)
  expect(calls('/api/admin-dong-stats')).toHaveLength(2)
})
it('displays independent dataset versions, qualities and unverified snapshot limitations', async () => {
  location = async c => json(comparisonLocation(c, '11110515', c.lat === p1.lat ? '1' : '3', c.lat === p1.lat ? '2' : '4'))
  await ready(); add(p1); add(p2)
  expect(await within(comparison()).findByText(/후보별 공간 dataset version이 다릅니다/)).toBeInTheDocument()
  expect(within(candidate(1)).getByText(/행정동 버전 1/)).toBeInTheDocument()
  expect(within(candidate(2)).getByText(/상권 버전 4/)).toBeInTheDocument()
  expect(within(comparison()).getByText(/모든 후보 요청의 동일 원본 snapshot/)).toBeInTheDocument()
  expect(within(candidate(1)).getByText(/SEMAS I21201 · snapshot UNVERIFIED/)).toBeInTheDocument()
  expect(within(candidate(1)).getAllByText(/과거 통계와 경계 호환성 미검증/, { selector: 'p' })).toHaveLength(2)
})
it.each(['ambiguous', 'missing lookup'])('keeps cafe comparison but blocks statistics for %s', async kind => {
  location = async c => {
    const body = comparisonLocation(c, kind === 'missing lookup' ? '99999999' : '11110515')
    if (kind === 'ambiguous') body.adminDong = { ...body.adminDong, status: 'AMBIGUOUS_BOUNDARY', resolvedDong: null,
      candidates: [body.adminDong.resolvedDong!, { ...body.adminDong.resolvedDong!, code: '11260550', name: '면목5동' }] }
    return json(body)
  }
  await ready(); add(p1); selectQuarter()
  expect(await within(candidate(1)).findByText('2개', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '비교 통계 조회' })).toBeDisabled()
  expect(calls('/api/admin-dong-stats')).toHaveLength(0)
  expect(within(candidate(1)).getByText(kind === 'ambiguous' ? /행정동이 모호해 통계를 연결하지/ : /다른 동으로 대체하지/)).toBeInTheDocument()
})
it('recovers network failures with an individual retry and leaves other candidates intact', async () => {
  nearby = async c => { if (c.lat === p1.lat) throw new TypeError('offline'); return json(nearbyFixture(c)) }
  await ready(); add(p1); add(p2)
  expect(await within(candidate(1)).findByText(/서버에 연결할 수 없습니다/)).toBeInTheDocument()
  expect(await within(candidate(2)).findByText('2개', { selector: 'strong' })).toBeInTheDocument()
  nearby = async c => json(nearbyFixture(c))
  fireEvent.click(screen.getByRole('button', { name: '후보 1 카페 다시 조회' }))
  expect(await within(candidate(1)).findByText('2개', { selector: 'strong' })).toBeInTheDocument()
})
it('removes a pending candidate without resurrecting it from late responses', async () => {
  const region = deferred<Response>(), cafes = deferred<Response>()
  location = () => region.promise; nearby = () => cafes.promise
  await ready(); add(p1)
  fireEvent.click(screen.getByRole('button', { name: '후보 1 삭제' }))
  expect(within(comparison()).queryByRole('article')).not.toBeInTheDocument()
  await act(async () => { region.resolve(json(comparisonLocation(p1))); cafes.resolve(json(nearbyFixture(p1))) })
  expect(within(comparison()).queryByRole('article')).not.toBeInTheDocument()
  expect(within(comparison()).getByText('등록한 후보 0/3')).toBeInTheDocument()
})
it('preserves comparison data while manual statistics and trend use independent conditions', async () => {
  await ready(); add(p1); await compare()
  fireEvent.change(screen.getByLabelText('행정동'), { target: { value: '11260550' } })
  fireEvent.change(screen.getByLabelText('업종'), { target: { value: 'CAFE' } })
  fireEvent.change(screen.getByLabelText('분기'), { target: { value: '20252' } })
  fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
  expect(await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })).toBeInTheDocument()
  expect(screen.getByLabelText('비교 통계 분기')).toHaveValue('20251')
  expect(within(candidate(1)).getByText(/2025년 1분기 · 청운효자동/)).toBeInTheDocument()
  expect(String(calls('/api/admin-dong-stats').at(-1)?.[0])).toContain('dongCode=11260550&industryCode=CAFE&quarterCode=20252')
})
it('keeps comparison fixed to CAFE when single-location industry is PUB', async () => {
  await ready()
  fireEvent.change(screen.getByLabelText('업종'), { target: { value: 'PUB' } })
  add(p1)
  expect(await within(candidate(1)).findByText('2개', { selector: 'strong' })).toBeInTheDocument()
  expect(calls('/api/nearby-stores')).toHaveLength(1)
  await compare(); expect(String(calls('/api/admin-dong-stats')[0][0])).toContain('industryCode=CAFE')
  expect(screen.getByLabelText('업종')).toHaveValue('PUB')
})
it('renders StrictMode, supports named keyboard controls and leaves the single marker intact', async () => {
  await ready(true); add(p1); add(p2)
  expect(map.markers).toHaveLength(1)
  expect(screen.getByRole('button', { name: '후보 1 삭제' })).toHaveAttribute('type', 'button')
  expect(screen.getByLabelText('비교 통계 분기')).toHaveAttribute('id', 'comparison-quarter')
  expect(within(comparison()).getAllByRole('article')).toHaveLength(2)
  await waitFor(() => expect(within(candidate(2)).getByText('2개', { selector: 'strong' })).toBeInTheDocument())
})
