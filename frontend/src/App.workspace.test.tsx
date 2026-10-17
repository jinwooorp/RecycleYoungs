import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { createKakaoMapsMock } from './test/kakaoMapsMock'
import { comparisonLocation, comparisonLookups, comparisonStats } from './test/comparisonFixture'
import { nearbyFixture } from './test/nearbyFixture'
import { normalTrend } from './test/trendFixture'
import { regionFixtureResponse, openStatisticsPanel, chooseRegion, showMap } from './test/regionFixture'

let map: ReturnType<typeof createKakaoMapsMock>
beforeEach(() => {
  map = createKakaoMapsMock()
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-key')
  vi.stubGlobal('kakao', { maps: map.sdk })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const region = regionFixtureResponse(input); if (region) return region
    const u = new URL(String(input), 'http://localhost')
    const point = { lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) }
    const data: Record<string, unknown> = {
      '/api/admin-dongs': comparisonLookups.adminDongs,
      '/api/industries': [...comparisonLookups.industries, { code: 'PUB', name: '주점' }],
      '/api/quarters': comparisonLookups.quarters,
      '/api/locations/resolve': comparisonLocation(point),
      '/api/nearby-stores': nearbyFixture(point),
      '/api/admin-dong-stats': comparisonStats(u.searchParams.get('dongCode')!, u.searchParams.get('quarterCode')!),
      '/api/admin-dong-trends': normalTrend,
    }
    return new Response(JSON.stringify(data[u.pathname]))
  }))
})

it('shows nearby stores directly on the map workspace without changing the analysis route', async () => {
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.5665, 126.978))
  expect(await screen.findByText('합성 카페 1')).toBeVisible()
  expect(screen.getByLabelText('카페 종류')).toBeEnabled()
  expect(screen.getByRole('region', { name: '창업 검토 요약' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '합성 카페 1 지도에서 보기' }))
  expect(window.location.pathname).toBe('/')
  expect(screen.getByRole('button', { name: '합성 카페 1 지도에서 보기' })).toHaveAttribute('aria-pressed', 'true')
})

it('keeps navigation focus at the detail heading and map trigger after selecting a cafe', async () => {
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.5665, 126.978))
  fireEvent.click(await screen.findByRole('button', { name: '합성 카페 1 지도에서 보기' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '합성 카페 1 지도에서 보기' })).toHaveFocus())
  openStatisticsPanel()
  await waitFor(() => expect(document.getElementById('detail-title')).toHaveFocus())
  showMap()
  await waitFor(() => expect(screen.getByRole('button', { name: '상세 분석 보기' })).toHaveFocus())
})

it('provides cafe-only manual requests even when the catalog contains other industries', async () => {
  render(<App />)
  openStatisticsPanel()
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  expect(screen.queryByRole('combobox', { name: '업종' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: '주점' })).not.toBeInTheDocument()
  chooseRegion()
  fireEvent.change(screen.getByLabelText('분기'), { target: { value: '20251' } })
  await screen.findByRole('heading', { name: '청운효자동 · 카페' })
  expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('industryCode=CAFE'))).toBe(true)
  expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('industryCode=PUB'))).toBe(false)
})

it('names saved candidates by their resolved region and shows unavailable scoring without a fake number', async () => {
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.5665, 126.978))
  fireEvent.click(screen.getByRole('button', { name: '후보지에 추가' }))
  fireEvent.click(screen.getByRole('button', { name: '후보 비교' }))
  const dialog = screen.getByRole('dialog', { name: '창업 후보지 비교' })
  const card = await within(dialog).findByRole('article', { name: '후보 1 · 청운효자동' })
  expect(within(card).queryByText(/위도|경도/)).not.toBeInTheDocument()
  expect(within(dialog).getByRole('row', { name: /^검토 요약/ })).toBeInTheDocument()
  expect(within(dialog).queryByText('수요 35점 기준')).not.toBeInTheDocument()
  expect(within(dialog).queryByText(/\d+\s*\/\s*100점/)).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: '같은 분기로 후보 분석' })).toBeInTheDocument()
})

it('keeps the map and selected point alive across detail navigation and dialog close', async () => {
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.5665, 126.978))
  openStatisticsPanel()
  await screen.findByText('합성 카페 1')
  showMap()
  const trigger = screen.getByRole('button', { name: '후보 비교' })
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '비교 닫기' }))
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(map.maps).toHaveLength(1)
  expect(map.markers[0].position.getLat()).toBe(37.5665)
  await waitFor(() => expect(screen.getByRole('region', { name: '창업 후보 위치 선택' })).toBeVisible())
})

it('updates a candidate title when delayed region evidence arrives after saving', async () => {
  let resolve!: (response: Response) => void
  const pending = new Promise<Response>(done => { resolve = done })
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((input, options) => String(input).startsWith('/api/locations/resolve') ? pending.then(response => response.clone()) : original(input, options))
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.5665, 126.978))
  fireEvent.click(screen.getByRole('button', { name: '후보지에 추가' }))
  fireEvent.click(screen.getByRole('button', { name: '후보 비교' }))
  expect(screen.getByRole('article', { name: '후보 1 · 지역 확인 중' })).toBeInTheDocument()
  await act(async () => resolve(new Response(JSON.stringify(comparisonLocation({ lat: 37.5665, lng: 126.978 })))))
  expect(await screen.findByRole('article', { name: '후보 1 · 청운효자동' })).toBeInTheDocument()
})

it('never substitutes another industry when CAFE is absent from the catalog', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((input, options) => String(input) === '/api/industries'
    ? Promise.resolve(new Response(JSON.stringify([{ code: 'PUB', name: '주점' }]))) : original(input, options))
  render(<App />)
  openStatisticsPanel()
  await screen.findByText('현재 조회 가능한 조건이 없습니다.')
  expect(screen.getByRole('button', { name: '통계 다시 불러오기' })).toBeDisabled()
  expect(screen.queryByRole('option', { name: '주점' })).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith('/api/admin-dong-stats'))).toBe(false)
  showMap()
  expect(screen.getAllByText('카페 분석을 지원하는 조회 조건이 없습니다.')).toHaveLength(3)
})

it('places the opening menu on the map only while the panel is collapsed', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '분석 패널 닫기' }))
  expect(screen.queryByRole('button', { name: '분석 패널 닫기' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '분석 패널 열기' }))
  await waitFor(() => expect(screen.getByLabelText('행정동')).toBeVisible())
  expect(screen.getByRole('button', { name: '분석 패널 닫기' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.queryByRole('button', { name: '분석 패널 열기' })).not.toBeInTheDocument()
})
