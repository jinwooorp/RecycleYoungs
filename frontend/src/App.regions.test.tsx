import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { createKakaoMapsMock } from './test/kakaoMapsMock'
import { comparisonLookups, comparisonStats } from './test/comparisonFixture'
import { chooseRegion, openStatisticsPanel, regionFixtureResponse, scoreFixture } from './test/regionFixture'
import { normalTrend } from './test/trendFixture'

beforeEach(() => {
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', '')
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const region = regionFixtureResponse(input); if (region) return region
    const u = new URL(String(input), 'http://localhost')
    const values: Record<string, unknown> = { '/api/admin-dongs': comparisonLookups.adminDongs, '/api/industries': comparisonLookups.industries,
      '/api/quarters': comparisonLookups.quarters, '/api/admin-dong-stats': comparisonStats(u.searchParams.get('dongCode') ?? '11110515', u.searchParams.get('quarterCode') ?? '20254'),
      '/api/admin-dong-trends': normalTrend }
    return new Response(JSON.stringify(values[u.pathname]))
  }))
})

it('searches a dong without a map SDK, opens the panel and shows actual score evidence without inventing a candidate point', async () => {
  render(<App />)
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '분석 패널 닫기' }))
  chooseRegion()
  const card = await screen.findByRole('region', { name: '카페 소비규모 점수' })
  await within(card).findByText('75')
  expect(within(card).queryByText(/9,007,199,254,740,993건/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '후보지에 추가' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '분석 패널 닫기' })).toHaveAttribute('aria-expanded', 'true')
  expect(vi.mocked(fetch).mock.calls.some(([u]) => /locations\/resolve|nearby-stores/.test(String(u)))).toBe(false)
  expect(screen.queryByRole('button', { name: '행정동 직접 조회' })).not.toBeInTheDocument()
  openStatisticsPanel()
  expect(within(screen.getByRole('region', { name: '카페 소비규모 점수' })).getByText(/9,007,199,254,740,993건/)).toBeInTheDocument()
})

it('reports NO_ROW for an official dong even if it is absent from the statistics catalog', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (input, options) => {
    if (String(input) === '/api/admin-dongs') return new Response('[]')
    if (String(input).startsWith('/api/cafe-consumption-scores')) {
      const value = scoreFixture(['11110515']); value.items[0] = { ...value.items[0], status: 'UNAVAILABLE', score: null, transactionCount: null, reason: 'NO_ROW' }
      return new Response(JSON.stringify(value))
    }
    return original(input, options)
  })
  render(<App />)
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  chooseRegion()
  const card = await screen.findByRole('region', { name: '카페 소비규모 점수' })
  await within(card).findByText('해당 분기의 거래 집계 행이 없습니다.')
  expect(within(card).getByText('산정 불가')).toBeInTheDocument()
  expect(within(card).queryByText('행정동과 분기를 선택하면 점수를 확인할 수 있습니다.')).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith('/api/admin-dong-stats'))).toBe(false)
})

it('draws separate multipolygon parts and hole rings in SDK coordinate order and releases replaced shapes', async () => {
  const mock = createKakaoMapsMock()
  const layers: { path: { getLat(): number; getLng(): number }[][]; setMap: ReturnType<typeof vi.fn> }[] = []
  mock.sdk.Polygon = vi.fn(function (options) { const layer = { ...options, setMap: vi.fn() }; layers.push(layer); return layer })
  mock.sdk.LatLngBounds = class { extend = vi.fn() }
  mock.sdk.Map = vi.fn(function () { const map = { relayout: vi.fn(), setBounds: vi.fn() }; mock.maps.push(map); return map })
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'fixture-key'); vi.stubGlobal('kakao', { maps: mock.sdk })
  const original = vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation(async (input, options) => {
    if (String(input).includes('/boundary')) {
      const base = regionFixtureResponse(input)!; const value = await base.json()
      const outer = value.geometry.coordinates[0][0]; value.geometry.coordinates = [[outer, outer], [outer]]
      return new Response(JSON.stringify(value))
    }
    return original(input, options)
  })
  const view = render(<App />)
  await waitFor(() => expect(screen.getByLabelText('자치구')).toBeEnabled())
  chooseRegion()
  await waitFor(() => expect(layers).toHaveLength(3)) // one city, two selected parts
  expect(layers[1].path).toHaveLength(2)
  expect(layers[1].path[0][0].getLat()).toBe(37.57)
  expect(layers[1].path[0][0].getLng()).toBe(126.97)
  expect(mock.maps[0].setBounds).toHaveBeenCalled()
  await act(async () => view.unmount())
  expect(layers.every(layer => layer.setMap.mock.calls.some(([map]) => map === null))).toBe(true)
})
