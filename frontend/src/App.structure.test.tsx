import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { createKakaoMapsMock } from './test/kakaoMapsMock'
import { comparisonLocation, comparisonLookups, comparisonStats } from './test/comparisonFixture'
import { nearbyFixture } from './test/nearbyFixture'
import { normalTrend } from './test/trendFixture'
import { regionFixtureResponse, openStatisticsPanel, showMap } from './test/regionFixture'

let map: ReturnType<typeof createKakaoMapsMock>
beforeEach(() => {
  map = createKakaoMapsMock()
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-key')
  vi.stubGlobal('kakao', { maps: map.sdk })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const region = regionFixtureResponse(input); if (region) return region
    const u = new URL(String(input), 'http://localhost')
    const coordinate = { lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) }
    let body: unknown
    if (u.pathname === '/api/admin-dongs') body = comparisonLookups.adminDongs
    else if (u.pathname === '/api/industries') body = comparisonLookups.industries
    else if (u.pathname === '/api/quarters') body = comparisonLookups.quarters
    else if (u.pathname === '/api/locations/resolve') body = comparisonLocation(coordinate)
    else if (u.pathname === '/api/nearby-stores') body = nearbyFixture(coordinate, 150)
    else if (u.pathname === '/api/admin-dong-stats') body = comparisonStats(u.searchParams.get('dongCode')!, u.searchParams.get('quarterCode')!)
    else if (u.pathname === '/api/admin-dong-trends') body = normalTrend
    else throw new Error('Unexpected endpoint')
    return new Response(JSON.stringify(body), { status: 200 })
  }))
})

it('keeps registration next to the selected location, and preserves candidates and quarter across screens', async () => {
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  expect(screen.getByRole('button', { name: '지도 탐색' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('button', { name: '통계 다시 불러오기' })).not.toBeInTheDocument()
  act(() => map.click(37.5665, 126.978))
  await screen.findByRole('heading', { name: '청운효자동' })
  const panel = screen.getByRole('region', { name: '선택 지역 분석 요약' })
  fireEvent.click(within(panel).getByRole('button', { name: '후보지에 추가' }))
  fireEvent.click(screen.getByRole('button', { name: '후보 비교' }))
  await waitFor(() => expect(screen.getByLabelText('비교 통계 분기')).toBeEnabled())
  fireEvent.change(screen.getByLabelText('비교 통계 분기'), { target: { value: '20251' } })
  fireEvent.click(screen.getByRole('button', { name: '같은 분기로 후보 분석' }))
  const table = screen.getByRole('table', { name: '후보별 동일 지표 비교' })
  await waitFor(() => expect(within(table).getByText('114개')).toBeInTheDocument())
  openStatisticsPanel()
  expect(screen.getByText('합성 카페 1')).toBeInTheDocument()
  showMap()
  expect(screen.getByRole('button', { name: '후보지에 추가' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '후보 비교' }))
  expect(screen.getByLabelText('비교 통계 분기')).toHaveValue('20251')
  expect(within(screen.getByRole('table', { name: '후보별 동일 지표 비교' })).getByText('114개')).toBeInTheDocument()
})

it('offers manual statistics even when the map key is unavailable', async () => {
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', '')
  render(<App />)
  openStatisticsPanel()
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  expect(screen.getByRole('button', { name: '통계 다시 불러오기' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '행정동 직접 조회' })).not.toBeInTheDocument()
})

it('moves keyboard focus to the detail heading after opening analysis', async () => {
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.5665, 126.978))
  const openStatistics = screen.getByRole('button', { name: '상세 분석 보기' })
  openStatistics.focus()
  fireEvent.click(openStatistics)
  await waitFor(() => expect(document.getElementById('detail-title')).toHaveFocus())
  expect(screen.getByRole('heading', { name: '행정동 카페 통계' })).toBeVisible()
})

it('does not claim a map dong was applied when it is outside the supported lookup', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (input, options) => {
    const u = new URL(String(input), 'http://localhost')
    if (u.pathname === '/api/locations/resolve') return new Response(JSON.stringify(comparisonLocation(
      { lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) }, '99999999')))
    return original(input, options)
  })
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.5665, 126.978))
  openStatisticsPanel()
  await screen.findByText(/통계 연결 자료가 현재 조회 조건 목록에 없습니다/)
  expect(screen.getByLabelText('행정동')).toHaveValue('')
  expect(screen.queryByText(/이 반영됐습니다/)).not.toBeInTheDocument()
  expect(screen.getByText(/지도 상단에서 지역을 선택하거나/)).toBeInTheDocument()
})
