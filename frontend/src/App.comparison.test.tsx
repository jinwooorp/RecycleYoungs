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
import { regionFixtureResponse, openStatisticsPanel, chooseRegion } from './test/regionFixture'

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
    const region = regionFixtureResponse(input); if (region) return region
    const u = new URL(String(input), 'http://localhost')
    const c = { lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) }
    if (u.pathname === '/api/admin-dongs') return json(lookups.adminDongs)
    if (u.pathname === '/api/industries') return json(lookups.industries)
    if (u.pathname === '/api/quarters') return json(lookups.quarters)
    if (u.pathname === '/api/locations/resolve') return location(c)
    if (u.pathname === '/api/nearby-stores') return nearby(c)
    if (u.pathname === '/api/admin-dong-stats') return stats({ dongCode: u.searchParams.get('dongCode')!,
      industryCode: u.searchParams.get('industryCode')!, quarterCode: u.searchParams.get('quarterCode')! })
    if (u.pathname === '/api/admin-dong-trends') return json({ ...normalTrend, dong: comparisonLookups.adminDongs.find(d => d.code === u.searchParams.get('dongCode')) })
    throw new Error('Unexpected API')
  })
  vi.stubGlobal('fetch', fetchMock)
})
async function ready(strict = false) {
  const view = render(strict ? <StrictMode><App /></StrictMode> : <App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  return view
}
const comparison = () => {
  fireEvent.click(screen.getByRole('button', { name: '후보 비교' }))
  return screen.getByRole('region', { name: '창업 후보지 비교' })
}
const candidate = (n: number) => {
  const card = within(comparison()).getByRole('article', { name: new RegExp(`^후보 ${n} ·`) })
  const details = card.querySelector('details')!
  if (!details.open) fireEvent.click(within(card).getByText('상세 근거와 개별 재조회'))
  return card
}
const click = (c: MapCoordinate) => act(() => map.click(c.lat, c.lng))
const registration = () => {
  fireEvent.click(screen.getByRole('button', { name: '지도 탐색' }))
  return screen.getByRole('button', { name: '후보지에 추가' })
}
const add = (c: MapCoordinate) => { click(c); fireEvent.click(registration()) }
const calls = (path: string) => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(path))
const selectQuarter = (q = '20251') => {
  comparison()
  fireEvent.change(screen.getByLabelText('비교 통계 분기'), { target: { value: q } })
}
it('does not compare nearby count differences across publication versions', async () => {
  nearby=async c=>{
    const body=nearbyFixture(c)
    body.data.metadata={dataVersion:(c.lat<37.58?'a':'b').repeat(64),collectedAt:'2026-10-21T08:00:00Z',
      storeReferenceMonth:'202606',storeScope:'I21201',sourceSnapshotStatus:'UNVERIFIED'}
    return json(body)
  }
  await ready();add(p1)
  await waitFor(()=>expect(calls('/api/nearby-stores')).toHaveLength(2))
  add(p2)
  await waitFor(()=>expect(calls('/api/nearby-stores')).toHaveLength(4))
  comparison()
  await waitFor(()=>expect(screen.getAllByRole('article',{name:/^후보 /})).toHaveLength(2))
  expect(within(comparison()).queryByText(/조회 자료상 후보 간 반경 500m 카페 수 차이는/)).not.toBeInTheDocument()
})
it('waits for comparison submission before requesting both scores for a new quarter', async () => {
  await ready(); add(p1)
  await waitFor(() => expect(screen.getByRole('heading', { name: '청운효자동' })).toBeInTheDocument())
  selectQuarter('20252')
  const requested = () => fetchMock.mock.calls.filter(([u]) => /cafe-(consumption|change)-scores/.test(String(u)) && String(u).includes('quarterCode=20252'))
  expect(requested()).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '같은 분기로 후보 분석' }))
  await waitFor(() => expect(requested()).toHaveLength(2))
  fireEvent.change(screen.getByLabelText('비교 통계 분기'), { target: { value: '20251' } })
  fireEvent.change(screen.getByLabelText('비교 통계 분기'), { target: { value: '20252' } })
  expect(requested()).toHaveLength(2)
})
async function compare() {
  selectQuarter()
  await waitFor(() => expect(screen.getByRole('button', { name: '같은 분기로 후보 분석' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '같은 분기로 후보 분석' }))
  await waitFor(() => expect(within(candidate(1)).getByText(/2025년 1분기 ·/)).toBeInTheDocument())
}
it('shows loading rather than the old score when resubmitting after a quarter round trip', async () => {
  await ready(); add(p1); selectQuarter('20252')
  await waitFor(() => expect(screen.getByRole('button', { name: '같은 분기로 후보 분석' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '같은 분기로 후보 분석' }))
  const primary = () => within(screen.getByRole('table', { name: '후보별 동일 지표 비교' }))
  await waitFor(() => expect(primary().getByRole('row', { name: /^카페 소비규모/ })).toHaveTextContent('75/100점'))
  const consumption = deferred<Response>(), change = deferred<Response>(), original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((input, options) => String(input).startsWith('/api/cafe-consumption-scores') ? consumption.promise
    : String(input).startsWith('/api/cafe-change-scores') ? change.promise : original(input, options))
  selectQuarter('20251'); selectQuarter('20252')
  fireEvent.click(screen.getByRole('button', { name: '같은 분기로 후보 분석' }))
  expect(primary().getByRole('row', { name: /^카페 소비규모/ })).toHaveTextContent('조회 중')
  expect(primary().getByRole('row', { name: /^검토 요약/ })).toHaveTextContent('검토 자료를 확인하는 중입니다')
  await act(async () => {
    consumption.resolve(regionFixtureResponse('/api/cafe-consumption-scores?dongCodes=11110515&quarterCode=20252')!)
    change.resolve(regionFixtureResponse('/api/cafe-change-scores?dongCodes=11110515&quarterCode=20252')!)
    await Promise.all([consumption.promise, change.promise])
  })
  await waitFor(() => expect(primary().getByRole('row', { name: /^카페 소비규모/ })).toHaveTextContent('75/100점'))
})
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad })
  return { promise, resolve, reject }
}

it('offers candidate registration and waits for a selected coordinate', async () => {
  await ready()
  expect(registration()).toBeDisabled()
  expect(within(comparison()).getByText('등록한 후보 0/3')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(4)
})
it('adds 1/2/3, prevents a fourth, preserves saved candidates on exploration and replaces a deleted slot', async () => {
  await ready(); add(p1)
  expect(within(comparison()).getByText('등록한 후보 1/3')).toBeInTheDocument()
  add(p2); expect(within(comparison()).getByText('등록한 후보 2/3')).toBeInTheDocument()
  add(p3); expect(within(comparison()).getByText('등록한 후보 3/3')).toBeInTheDocument()
  expect(registration()).toBeDisabled()
  click({ lat: 37.6, lng: 127.1 })
  expect(within(candidate(1)).queryByText(/위도|경도/)).not.toBeInTheDocument()
  expect(within(comparison()).getAllByRole('article')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '후보 2 삭제' }))
  expect(registration()).toBeEnabled()
  fireEvent.click(registration())
  expect(within(candidate(2)).queryByText(/위도|경도/)).not.toBeInTheDocument()
  expect(within(candidate(3)).queryByText(/위도|경도/)).not.toBeInTheDocument()
  await waitFor(() => expect(within(candidate(2)).getByText(/조회 자료의 경쟁 카페/)).toBeInTheDocument())
})
it('disables exact duplicates but allows nearby distinct full-precision coordinates', async () => {
  await ready(); add(p1)
  expect(registration()).toBeDisabled()
  expect(screen.getByText(/선택한 위치가 이미/)).toBeInTheDocument()
  add({ ...p1, lat: p1.lat + 1e-12 })
  expect(within(comparison()).getAllByRole('article')).toHaveLength(2)
  expect(within(candidate(2)).queryByText(/위도|경도/)).not.toBeInTheDocument()
  await waitFor(() => expect(within(candidate(2)).getByText(/조회 자료의 경쟁 카페/)).toBeInTheDocument())
})
it('shows totalCount rather than list length, zero separately from 503 and preserves partial success', async () => {
  nearby = async c => c.lat === p1.lat ? json(nearbyFixture(c, 150)) : c.lat === p2.lat ? json(nearbyFixture(c, 0))
    : json({ code: 'STORES_DATA_UNAVAILABLE', message: '미준비', field: null }, 503)
  await ready(); add(p1); add(p2); add(p3)
  expect(await within(candidate(1)).findByText('150개', { selector: 'strong' })).toBeInTheDocument()
  expect(within(candidate(1)).getByText('점포 목록 100개 / 제한 100개 · 일부 목록')).toBeInTheDocument()
  expect(await within(candidate(2)).findByText(/현재 조회 가능한 자료의 반경 내 0개/)).toBeInTheDocument()
  expect(await within(candidate(3)).findByText(/카페 자료를 아직 조회할 수 없습니다/)).toBeInTheDocument()
  expect(within(candidate(3)).queryByText('0개', { selector: 'strong' })).not.toBeInTheDocument()
  nearby = async c => json(nearbyFixture(c))
  fireEvent.click(screen.getByRole('button', { name: '후보 3 카페 다시 조회' }))
  expect(await within(candidate(3)).findByText('2개', { selector: 'strong' })).toBeInTheDocument()
  expect(within(candidate(1)).getByText('150개', { selector: 'strong' })).toBeInTheDocument()
})
it('leads with review signals and shared regional evidence while keeping full statistics available separately', async () => {
  location = async c => json(comparisonLocation(c))
  await ready(); add(p1); add(p2); await compare()
  const table = within(screen.getByRole('table', { name: '후보별 동일 지표 비교' }))
  expect(table.getByRole('row', { name: /^검토 요약/ })).toBeInTheDocument()
  expect(table.getByRole('row', { name: /^다음 확인사항/ })).toBeInTheDocument()
  expect(table.queryByText('행정동 추정매출')).not.toBeInTheDocument()
  expect(table.getAllByText(/같은 지역 근거: 후보 1 · 청운효자동/).length).toBeGreaterThan(0)
  expect(screen.getByText('전체 통계 비교')).toBeInTheDocument()
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
  expect(first.getAllByText('값이 제공되지 않음')).toHaveLength(2)
  await waitFor(() => expect(within(candidate(2)).getAllByText('집계 자료 없음')).toHaveLength(9))
  expect(first.getAllByRole('definition')).toHaveLength(9)
  fireEvent.click(screen.getByText('전체 통계 비교'))
  const table = within(screen.getByRole('table', { name: '후보별 전체 통계 비교' }))
  expect(table.getByText('9,007,199,254,740,993원')).toBeInTheDocument()
  expect(table.getAllByText('집계 자료 없음')).toHaveLength(9)
  expect(table.getAllByText('값이 제공되지 않음')).toHaveLength(2)
  expect(table.getByText('0개')).toBeInTheDocument()
  expect(table.getByText('0건')).toBeInTheDocument()
})
it('invalidates all old-quarter metrics immediately and keeps region/cafe results', async () => {
  await ready(); add(p1); add(p2); await compare()
  selectQuarter('20252')
  expect(within(candidate(1)).queryByText(/2025년 1분기 ·/)).not.toBeInTheDocument()
  expect(within(candidate(2)).queryByText(/2025년 1분기 ·/)).not.toBeInTheDocument()
  expect(within(candidate(1)).getByText(/조회 자료의 경쟁 카페/)).toBeInTheDocument()
  const count = calls('/api/admin-dong-stats').length
  expect(calls('/api/admin-dong-stats')).toHaveLength(count)
  fireEvent.click(screen.getByRole('button', { name: '같은 분기로 후보 분석' }))
  expect(await within(candidate(1)).findByText(/2025년 2분기 ·/)).toBeInTheDocument()
  expect(await within(candidate(2)).findByText(/2025년 2분기 ·/)).toBeInTheDocument()
})
it('warns for shared dong statistics and retains two separate locations', async () => {
  location = async c => json(comparisonLocation(c))
  await ready(); add(p1); add(p2); await compare()
  expect(within(comparison()).getByText(/통계는 동일 행정동의 집계값/)).toBeInTheDocument()
  expect(within(comparison()).getAllByRole('article')).toHaveLength(2)
  expect(calls('/api/admin-dong-stats').filter(([, options]) => !options?.signal?.aborted).length).toBeGreaterThanOrEqual(2)
})
it('explains the observed cafe-count difference without calling a candidate better', async () => {
  nearby = async c => json(nearbyFixture(c, c.lat === p1.lat ? 2 : 150))
  await ready(); add(p1); add(p2)
  expect(await within(comparison()).findByText(/조회 자료상 후보 간 반경 500m 카페 수 차이는 148개/)).toBeInTheDocument()
  expect(within(comparison()).queryByText(/추천 후보|창업 적합/)).not.toBeInTheDocument()
})
it('displays independent dataset versions, qualities and unverified snapshot limitations', async () => {
  location = async c => json(comparisonLocation(c, '11110515', c.lat === p1.lat ? '1' : '3', c.lat === p1.lat ? '2' : '4'))
  await ready(); add(p1); add(p2)
  expect(await within(comparison()).findByText(/후보마다 지역을 확인한 지도 자료의 버전이 다릅니다/)).toBeInTheDocument()
  const dongSource = within(candidate(1)).getByRole('heading', { name: '행정동 지도 자료' }).closest('section')!
  const areaSource = within(candidate(2)).getByRole('heading', { name: '상권 지도 자료' }).closest('section')!
  expect(within(dongSource).getByText(/버전: 1/)).toBeInTheDocument()
  expect(within(areaSource).getByText(/버전: 4/)).toBeInTheDocument()
  expect(within(comparison()).getByText(/같은 분기를 골라도 모든 후보가 정확히 같은 시점/)).toBeInTheDocument()
  expect(within(candidate(1)).getByText(/SEMAS I21201 · snapshot UNVERIFIED/)).toBeInTheDocument()
  expect(within(candidate(1)).getAllByText(/이 지도에서 사용한 지역 구분이 통계가 작성된 시기의/, { selector: 'p' })).toHaveLength(2)
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
  expect(screen.getByRole('button', { name: '같은 분기로 후보 분석' })).toBeDisabled()
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
  comparison()
  fireEvent.click(screen.getByRole('button', { name: '후보 1 삭제' }))
  expect(within(comparison()).queryByRole('article')).not.toBeInTheDocument()
  await act(async () => { region.resolve(json(comparisonLocation(p1))); cafes.resolve(json(nearbyFixture(p1))) })
  expect(within(comparison()).queryByRole('article')).not.toBeInTheDocument()
  expect(within(comparison()).getByText('등록한 후보 0/3')).toBeInTheDocument()
})
it('preserves comparison data while manual statistics and trend use independent conditions', async () => {
  await ready(); add(p1); await compare()
  openStatisticsPanel()
  chooseRegion('11260550')
  fireEvent.change(screen.getByLabelText('분기'), { target: { value: '20252' } })
  expect(await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })).toBeInTheDocument()
  comparison()
  expect(screen.getByLabelText('비교 통계 분기')).toHaveValue('20251')
  expect(within(candidate(1)).getByText(/2025년 1분기 · 청운효자동/)).toBeInTheDocument()
  expect(calls('/api/admin-dong-stats').some(([url]) => String(url).includes('dongCode=11260550&industryCode=CAFE&quarterCode=20252'))).toBe(true)
})
it('keeps all UI requests fixed to CAFE and omits unsupported industry controls', async () => {
  await ready()
  add(p1)
  expect(await within(candidate(1)).findByText('2개', { selector: 'strong' })).toBeInTheDocument()
  expect(calls('/api/nearby-stores')).toHaveLength(2)
  await compare(); expect(String(calls('/api/admin-dong-stats')[0][0])).toContain('industryCode=CAFE')
  expect(screen.queryByRole('combobox', { name: '업종' })).not.toBeInTheDocument()
})
it('renders StrictMode, supports named keyboard controls and leaves the single marker intact', async () => {
  await ready(true); add(p1); add(p2)
  expect(map.markers).toHaveLength(1)
  comparison()
  expect(screen.getByRole('button', { name: '후보 1 삭제' })).toHaveAttribute('type', 'button')
  expect(screen.getByLabelText('비교 통계 분기')).toHaveAttribute('id', 'comparison-quarter')
  expect(within(comparison()).getAllByRole('article')).toHaveLength(2)
  await waitFor(() => expect(within(candidate(2)).getByText('2개', { selector: 'strong' })).toBeInTheDocument())
})

it('keeps source-attribute conflicts visible while candidate details are collapsed', async () => {
  location = async c => {
    const body = comparisonLocation(c)
    body.commercialArea.memberships[0] = { ...body.commercialArea.memberships[0],
      sourceAttributeStatus: 'CONFLICT_OBSERVED', sourceAttributeDetail: 'H5 fixture conflict' }
    return json(body)
  }
  await ready(); add(p1); comparison()
  const warning = await screen.findByText('상권 원본 지역 속성 충돌이 있습니다. 상세 근거를 확인해 주세요.')
  expect(warning).toBeVisible()
  expect(within(comparison()).getByRole('article', { name: /^후보 1 ·/ }).querySelector('details')).not.toHaveAttribute('open')
})
