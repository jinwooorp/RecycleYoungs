import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { comparisonLocation, comparisonLookups, comparisonStats } from './test/comparisonFixture'
import { regionFixtureResponse, chooseRegion } from './test/regionFixture'
import { normalTrend } from './test/trendFixture'
import { nearbyFixture } from './test/nearbyFixture'
import { createKakaoMapsMock } from './test/kakaoMapsMock'

let map: ReturnType<typeof createKakaoMapsMock>
beforeEach(() => {
  map = createKakaoMapsMock()
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'fixture'); vi.stubGlobal('kakao', { maps: map.sdk })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const region = regionFixtureResponse(input); if (region) return region
    const u = new URL(String(input), 'http://localhost'), point = { lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) }
    const data: Record<string, unknown> = { '/api/admin-dongs': comparisonLookups.adminDongs, '/api/industries': comparisonLookups.industries,
      '/api/quarters': comparisonLookups.quarters, '/api/admin-dong-stats': comparisonStats(u.searchParams.get('dongCode')!, u.searchParams.get('quarterCode')!),
      '/api/admin-dong-trends': normalTrend, '/api/locations/resolve': comparisonLocation(point), '/api/nearby-stores': nearbyFixture(point) }
    return new Response(JSON.stringify(data[u.pathname]))
  }))
})
it('opens a region URL directly with scores and charts without inventing a nearby coordinate', async () => {
  window.history.replaceState(null, '', '/analysis?dongCode=11110515&quarterCode=20251')
  render(<App />)
  expect(await screen.findByRole('heading', { name: '청운효자동 · 카페' })).toBeInTheDocument()
  expect(await screen.findByRole('group', { name: '거래 건수 선 그래프' })).toBeInTheDocument()
  expect(screen.getByRole('table', { name: '거래 건수 정확한 값' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '후보지에 추가' })).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([u]) => /locations\/resolve|nearby-stores/.test(String(u)))).toBe(false)
})
it('loads a supported direct detail URL even if the region catalog fails', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((input, options) => String(input) === '/api/regions' ? Promise.reject(new TypeError('catalog unavailable')) : original(input, options))
  window.history.replaceState(null, '', '/analysis?dongCode=11110515&quarterCode=20251')
  render(<App />)
  expect(await screen.findByRole('heading', { name: '청운효자동 · 카페' })).toBeInTheDocument()
  expect(screen.queryByText('상세 분석 조건을 확인하는 중입니다.')).not.toBeInTheDocument()
})
it('keeps nearby point results usable even when statistics lookups fail', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((input, options) => String(input) === '/api/admin-dongs' ? Promise.reject(new TypeError('lookup unavailable')) : original(input, options))
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.57, 126.98))
  fireEvent.click(screen.getByRole('button', { name: '상세 분석 보기' }))
  await screen.findByText('분석 조건 목록을 불러오지 못했습니다.')
  expect(await screen.findByText('합성 카페 1')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '조회 조건 다시 시도' })).toBeEnabled()
})
it.each(['dongCode=bad', 'dongCode=11999999', 'dongCode=11110515&quarterCode=20244'])('rejects invalid or unsupported detail conditions: %s', async query => {
  window.history.replaceState(null, '', '/analysis?' + query)
  render(<App />)
  await screen.findByRole('alert')
  expect(vi.mocked(fetch).mock.calls.some(([u]) => /admin-dong-stats|cafe-change-scores/.test(String(u)))).toBe(false)
})
it('keeps the map instance and candidates across browser back and forward and refreshes as region-only', async () => {
  const view = render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  act(() => map.click(37.57, 126.98))
  await screen.findByRole('heading', { name: '청운효자동' })
  fireEvent.click(screen.getByRole('button', { name: '후보지에 추가' }))
  fireEvent.click(screen.getByRole('button', { name: '상세 분석 보기' }))
  await screen.findByText('합성 카페 1')
  expect(window.location.search).toContain('dongCode=11110515')
  act(() => window.history.back())
  await waitFor(() => expect(screen.getByRole('button', { name: '상세 분석 보기' })).toBeVisible())
  expect(screen.getByRole('button', { name: '후보 비교' })).toHaveTextContent('1/3')
  expect(map.maps).toHaveLength(1)
  act(() => window.history.forward())
  await screen.findByText('합성 카페 1')
  expect(map.maps).toHaveLength(1)
  view.unmount()
  vi.mocked(fetch).mockClear()
  render(<App />)
  await screen.findByRole('heading', { name: '청운효자동 · 카페' })
  expect(screen.queryByText('합성 카페 1')).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([u]) => /nearby-stores/.test(String(u)))).toBe(false)
})
it('shows only scores in the panel, one comparison entry, and keyboard guidance in the guide', async () => {
  render(<App />)
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled()); chooseRegion()
  expect(screen.getAllByRole('button', { name: '후보 비교' })).toHaveLength(1)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '지도 중심 선택' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '데이터 안내' }))
  expect(screen.getByRole('heading', { name: '지도 사용법·키보드 조작' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /서울 외곽선 출처/ })).toBeInTheDocument()
})
it.each(['11110515', '11260550'])('keeps a newer map point when forwarding to historical detail (new dong %s)', async dong => {
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((input, options) => {
    const u = new URL(String(input), 'http://localhost')
    if (u.pathname === '/api/locations/resolve') return Promise.resolve(new Response(JSON.stringify(comparisonLocation({ lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) }, Number(u.searchParams.get('lat')) > 37.6 ? dong : '11110515'))))
    return original(input, options)
  })
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  act(() => map.click(37.57, 126.98))
  await screen.findByRole('heading', { name: '청운효자동' })
  fireEvent.click(screen.getByRole('button', { name: '상세 분석 보기' }))
  await screen.findByText('합성 카페 1')
  act(() => window.history.back())
  await screen.findByRole('button', { name: '상세 분석 보기' })
  act(() => map.click(37.65, 127.01))
  await waitFor(() => expect(screen.getByLabelText('행정동')).toHaveValue(dong))
  act(() => window.history.forward())
  await screen.findByRole('heading', { name: '청운효자동 · 카페' })
  expect(screen.queryByText('합성 카페 1')).not.toBeInTheDocument()
  act(() => window.history.back())
  await screen.findByRole('button', { name: '상세 분석 보기' })
  expect(screen.getByLabelText('행정동')).toHaveValue(dong)
  expect(screen.getByRole('button', { name: '후보지에 추가' })).toBeEnabled()
  expect(map.markers[0].position.getLat()).toBe(37.65)
  expect(map.maps).toHaveLength(1)
})
it('does not attach a new resolved region to an old failed-point detail without a dong code', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((input, options) => {
    const u = new URL(String(input), 'http://localhost')
    if (u.pathname === '/api/locations/resolve' && Number(u.searchParams.get('lat')) < 37.6)
      return Promise.resolve(new Response(JSON.stringify({ code: 'INTERNAL_ERROR', message: '지역 확인 실패', field: null }), { status: 500 }))
    return original(input, options)
  })
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.57, 126.98))
  await screen.findByRole('heading', { name: '지역 확인 실패' })
  fireEvent.click(screen.getByRole('button', { name: '상세 분석 보기' }))
  expect(window.location.search).not.toContain('dongCode')
  act(() => window.history.back())
  await screen.findByRole('button', { name: '상세 분석 보기' })
  act(() => map.click(37.65, 127.01))
  await screen.findByRole('heading', { name: '청운효자동' })
  act(() => window.history.forward())
  await screen.findByRole('heading', { name: '행정동 미확정' })
  expect(window.location.search).not.toContain('dongCode')
  expect(screen.queryByRole('region', { name: '카페 소비규모 점수' })).not.toBeInTheDocument()
  expect(screen.queryByText('합성 카페 1')).not.toBeInTheDocument()
})
