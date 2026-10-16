import type { ConsumptionScores, RegionBoundary, Regions } from '../types/regions'
import { act, fireEvent, screen } from '@testing-library/react'

export function showMap() {
  act(() => { window.history.pushState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) })
}

export function openStatisticsPanel() {
  const close = screen.queryByRole('button', { name: '비교 닫기' }); if (close) fireEvent.click(close)
  const open = screen.queryByRole('button', { name: '분석 패널 열기' }); if (open) fireEvent.click(open)
  if (window.location.pathname === '/analysis') return
  const detail = screen.getByRole('button', { name: '상세 분석 보기' })
  if (!detail.hasAttribute('disabled')) fireEvent.click(detail)
  else act(() => { window.history.pushState({ analysisPoint: false }, '', '/analysis'); window.dispatchEvent(new PopStateEvent('popstate')) })
}
export function chooseRegion(code = '11110515') {
  const detail = window.location.pathname === '/analysis'
  if (detail) showMap()
  fireEvent.change(screen.getByLabelText('자치구'), { target: { value: code.slice(0, 5) } })
  fireEvent.change(screen.getByLabelText('행정동'), { target: { value: code } })
  fireEvent.click(screen.getByRole('button', { name: '지역 보기' }))
  if (detail) openStatisticsPanel()
}

export const regionFixture: Regions = { city: '서울특별시', catalogVersion: 'fixture-v1', sourceUrl: 'https://data.seoul.go.kr', boundaryVersion: '1', districts: [
  { code: '11110', name: '종로구', dongs: [{ code: '11110515', name: '청운효자동', statisticsSupported: true, boundaryAvailable: true }] },
  { code: '11260', name: '중랑구', dongs: [{ code: '11260550', name: '면목5동', statisticsSupported: true, boundaryAvailable: true }] },
  { code: '11470', name: '양천구', dongs: [{ code: '11470670', name: '신정6동', statisticsSupported: true, boundaryAvailable: true }] },
] }
export const boundaryFixture: RegionBoundary = { code: '11110515', name: '청운효자동', datasetVersion: '1', sourceUrl: 'https://data.seoul.go.kr', displayCrs: 4326,
  qualityStatus: 'VALID_SOURCE', qualityDetail: null, historicalCompatibilityStatus: 'UNRESOLVED', validationStatus: 'PASSED_WITH_LIMITATIONS', referenceDate: null, referenceDateVerified: false,
  geometry: { type: 'MultiPolygon', coordinates: [[[[126.97, 37.57], [126.98, 37.57], [126.98, 37.58], [126.97, 37.57]]]] } }
export function scoreFixture(codes: string[], quarter = '20254'): ConsumptionScores {
  return { quarter: { code: quarter, label: `${quarter.slice(0, 4)}년 ${quarter[4]}분기` }, modelVersion: 'cafe-transactions-percentile-v1', baselineId: 'fixture-baseline',
    cohortSize: 400, minimumCohortSize: 30, sourceUrl: 'https://data.seoul.go.kr', sourceSnapshotStatus: 'UNVERIFIED',
    items: codes.map(code => ({ dong: { code, name: regionFixture.districts.flatMap(d => d.dongs).find(d => d.code === code)?.name ?? '테스트 동' },
      status: 'AVAILABLE', score: 75, transactionCount: '9007199254740993', reason: null })) }
}
export function regionFixtureResponse(input: RequestInfo | URL): Response | null {
  const u = new URL(String(input), 'http://localhost')
  if (u.pathname === '/api/regions') return new Response(JSON.stringify(regionFixture))
  if (u.pathname.includes('/boundary')) return new Response(JSON.stringify({ ...boundaryFixture, code: u.pathname.split('/')[4], datasetVersion: u.searchParams.get('datasetVersion') ?? '1' }))
  if (u.pathname === '/api/cafe-consumption-scores') return new Response(JSON.stringify(scoreFixture(u.searchParams.get('dongCodes')!.split(','), u.searchParams.get('quarterCode')!)))
  if (u.pathname === '/api/cafe-change-scores') {
    const base = scoreFixture(u.searchParams.get('dongCodes')!.split(','), u.searchParams.get('quarterCode')!)
    const y = Number(base.quarter.code.slice(0, 4)), q = Number(base.quarter.code[4])
    return new Response(JSON.stringify({ ...base, previousQuarterCode: q === 1 ? `${y - 1}4` : `${y}${q - 1}`, modelVersion: 'cafe-transactions-change-percentile-v1',
      items: base.items.map(i => ({ dong: i.dong, status: 'AVAILABLE', score: 60, currentCount: '110', previousCount: '100', changeRate: '10.0000', direction: 'INCREASE', reason: null })) }))
  }
  return null
}
