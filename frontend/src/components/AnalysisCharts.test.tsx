import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AnalysisCharts } from './AnalysisCharts'
import { normalTrend } from '../test/trendFixture'
it('shows real value axes and changes units while preserving exact table values', () => {
  render(<AnalysisCharts trend={normalTrend} quarter="20254" />)
  const sales = screen.getByRole('region', { name: '카페 소비 흐름' })
  expect(within(sales).getByLabelText('세로축 눈금, 단위 건')).toBeInTheDocument()
  fireEvent.change(within(sales).getByLabelText('소비 그래프 지표'), { target: { value: 'estimatedSalesAmount' } })
  expect(within(sales).getByLabelText('세로축 눈금, 단위 원')).toBeInTheDocument()
  expect(within(sales).getByRole('table', { name: '추정매출 정확한 값' })).toHaveTextContent('4,535,266,422원')
})
it('does not draw through missing data or include later quarters, and keeps a real zero', () => {
  const trend = structuredClone(normalTrend)
  trend.quarters[0].salesStats!.transactionCount = '0'
  trend.quarters[1].salesStats = null; trend.quarters[1].missingReasons.salesStats = 'NO_ROW'
  const { container } = render(<AnalysisCharts trend={trend} quarter="20253" />)
  const table = screen.getByRole('table', { name: '거래 건수 정확한 값' })
  expect(table).toHaveTextContent('0건'); expect(table).toHaveTextContent('자료 없음')
  expect(table).not.toHaveTextContent('2025년 4분기')
  expect(container.querySelectorAll('.chart-line')).toHaveLength(0)
})
