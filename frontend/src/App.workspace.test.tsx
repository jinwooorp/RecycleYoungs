import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { createKakaoMapsMock } from './test/kakaoMapsMock'
import { comparisonLocation, comparisonLookups, comparisonStats } from './test/comparisonFixture'
import { nearbyFixture } from './test/nearbyFixture'
import { normalTrend } from './test/trendFixture'

let map: ReturnType<typeof createKakaoMapsMock>
beforeEach(() => {
  map = createKakaoMapsMock()
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-key')
  vi.stubGlobal('kakao', { maps: map.sdk })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
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

it('provides cafe-only manual requests even when the catalog contains other industries', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '행정동 직접 조회' }))
  await waitFor(() => expect(screen.getByLabelText('행정동')).toBeEnabled())
  expect(screen.queryByRole('combobox', { name: '업종' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: '주점' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('행정동'), { target: { value: '11110515' } })
  fireEvent.change(screen.getByLabelText('분기'), { target: { value: '20251' } })
  fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
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
  expect(within(dialog).getByText('종합점수 산정 불가')).toBeInTheDocument()
  expect(within(dialog).getByText('수요 35점 기준')).toBeInTheDocument()
  expect(within(dialog).queryByText(/\d+\s*\/\s*100점/)).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: '같은 분기로 후보 분석' })).toBeInTheDocument()
})

it('keeps the map and selected point alive across panel tabs and dialog close', async () => {
  render(<App />)
  await waitFor(() => expect(map.listeners.size).toBe(1))
  act(() => map.click(37.5665, 126.978))
  await screen.findByText('합성 카페 1')
  fireEvent.click(screen.getByRole('tab', { name: '주변 카페' }))
  fireEvent.click(screen.getByRole('tab', { name: '행정동 통계' }))
  fireEvent.click(screen.getByRole('tab', { name: '위치 요약' }))
  const trigger = screen.getByRole('button', { name: '후보 비교' })
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '비교 닫기' }))
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(map.maps).toHaveLength(1)
  expect(map.markers[0].position.getLat()).toBe(37.5665)
  expect(screen.getByRole('region', { name: '창업 후보 위치 선택' })).toBeVisible()
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
  fireEvent.click(screen.getByRole('button', { name: '행정동 직접 조회' }))
  await screen.findByText('현재 조회 가능한 조건이 없습니다.')
  expect(screen.getByRole('button', { name: '조회하기' })).toBeDisabled()
  expect(screen.queryByRole('option', { name: '주점' })).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith('/api/admin-dong-stats'))).toBe(false)
})

it('opens a collapsed analysis panel when navigating to manual statistics', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '접기' }))
  fireEvent.click(screen.getByRole('button', { name: '행정동 직접 조회' }))
  await waitFor(() => expect(screen.getByLabelText('행정동')).toBeVisible())
  expect(screen.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true')
})
