import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AnalysisCharts } from './AnalysisCharts'
import { normalTrend } from '../test/trendFixture'
import { comparisonStats } from '../test/comparisonFixture'

it('does not combine responses from different public releases even when numeric values agree', () => {
  const metadata = { dataVersion: 'a'.repeat(64), collectedAt: '2026-10-21T08:00:00Z', storeReferenceMonth: '202606', storeScope: 'I21201' as const, sourceSnapshotStatus: 'UNVERIFIED' as const }
  render(<AnalysisCharts trend={{ ...normalTrend, metadata }} stats={{ ...comparisonStats('11110515','20254'), metadata: { ...metadata, dataVersion: 'b'.repeat(64) } }} quarter="20254" />)
  expect(screen.getByRole('alert')).toHaveTextContent('자료 버전이 달라')
  expect(screen.queryByRole('group', { name: '거래 건수 선 그래프' })).not.toBeInTheDocument()
})

it('integrates the current value with the chart and reveals exact values only on request', () => {
  render(<AnalysisCharts trend={normalTrend} stats={comparisonStats('11110515', '20254')} quarter="20254" />)
  const sales = screen.getByRole('region', { name: '카페 소비 흐름' })
  expect(within(sales).getByText(/선택 분기 거래 건수/)).toBeVisible()
  expect(within(sales).queryByRole('table')).not.toBeInTheDocument()
  fireEvent.click(within(sales).getByText('정확한 값 보기'))
  expect(within(sales).getByRole('table', { name: '거래 건수 정확한 값' })).toBeVisible()
})
it('shows usable current statistics without a trend and distinguishes absent sections, null and zero', () => {
  const stats = comparisonStats('11110515', '20254'); stats.storeStats = null; stats.missingReasons.storeStats = 'NO_ROW'
  stats.salesStats!.transactionCount = '0'; stats.salesStats!.estimatedSalesAmount = null
  render(<AnalysisCharts stats={stats} quarter="20254" />)
  const sales = screen.getByRole('region', { name: '카페 소비 흐름' })
  expect(within(sales).getByText(/선택 분기 거래 건수/)).toHaveTextContent('0건')
  fireEvent.click(within(sales).getByText('선택 분기 세부지표'))
  expect(within(sales).getByRole('table')).toHaveTextContent('값이 제공되지 않음')
  expect(within(screen.getByRole('region', { name: '카페 점포 흐름' })).getByText(/선택 분기 점포 수/)).toHaveTextContent('집계 자료 없음')
})
it('does not silently choose between inconsistent current statistics and trend values', () => {
  const stats = comparisonStats('11110515', '20254'); stats.salesStats!.transactionCount = '0'
  render(<AnalysisCharts trend={normalTrend} stats={stats} quarter="20254" />)
  const sales = screen.getByRole('region', { name: '카페 소비 흐름' })
  expect(within(sales).getByRole('status')).toHaveTextContent('조회 결과와 추세 값이 달라')
  expect(within(sales).queryByRole('group', { name: '거래 건수 선 그래프' })).not.toBeInTheDocument()
})
it('shows real value axes and changes units while preserving exact table values', () => {
  render(<AnalysisCharts trend={normalTrend} quarter="20254" />)
  const sales = screen.getByRole('region', { name: '카페 소비 흐름' })
  expect(within(sales).getByLabelText('세로축 눈금, 단위 건')).toBeInTheDocument()
  fireEvent.change(within(sales).getByLabelText('소비 그래프 지표'), { target: { value: 'estimatedSalesAmount' } })
  expect(within(sales).getByLabelText('세로축 눈금, 단위 원')).toBeInTheDocument()
  fireEvent.click(within(sales).getByText('정확한 값 보기'))
  expect(within(sales).getByRole('table', { name: '추정매출 정확한 값' })).toHaveTextContent('4,535,266,422원')
})
it('does not draw through missing data or include later quarters, and keeps a real zero', () => {
  const trend = structuredClone(normalTrend)
  trend.quarters[0].salesStats!.transactionCount = '0'
  trend.quarters[1].salesStats = null; trend.quarters[1].missingReasons.salesStats = 'NO_ROW'
  const { container } = render(<AnalysisCharts trend={trend} quarter="20253" />)
  fireEvent.click(within(screen.getByRole('region', { name: '카페 소비 흐름' })).getByText('정확한 값 보기'))
  const table = screen.getByRole('table', { name: '거래 건수 정확한 값' })
  expect(table).toHaveTextContent('0건'); expect(table).toHaveTextContent('자료 없음')
  expect(table).not.toHaveTextContent('2025년 4분기')
  expect(container.querySelectorAll('.chart-line')).toHaveLength(0)
})
