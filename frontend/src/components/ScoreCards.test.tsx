import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ConsumptionScoreCard } from './ConsumptionScoreCard'
import { ChangeScoreCard } from './ChangeScoreCard'
import { scoreFixture } from '../test/regionFixture'
import type { ChangeScores } from '../types/regions'

it('keeps both compact cards concise while exposing what the change means', () => {
  const result = scoreFixture(['11110515'])
  const change: ChangeScores = { ...result, previousQuarterCode: '20253', items: [{ dong: result.items[0].dong, status: 'AVAILABLE', score: 80, currentCount: '90', previousCount: '100', changeRate: '-10.0000', direction: 'DECREASE', reason: null }] }
  const props = { dongCode: '11110515', loading: false, error: null, onRetry: vi.fn(), compact: true }
  render(<><ConsumptionScoreCard {...props} result={result} /><ChangeScoreCard {...props} result={change} /></>)
  expect(screen.getByText('서울 동별 거래 순위')).toBeInTheDocument()
  const growth = screen.getByRole('region', { name: '카페 소비증감 점수' })
  expect(within(growth).getByLabelText('지난 분기 대비 -10.0% · 감소')).toHaveTextContent('-10.0% · 감소')
  expect(within(growth).queryByText(/^지난 분기 대비/)).not.toBeInTheDocument()
})

it('explains the first offered quarter, preserves current zero, and selects the next whole quarter', () => {
  const base = scoreFixture(['11110515'])
  const result: ChangeScores = { ...base, quarter: { code: '20211', label: '2021년 1분기' }, previousQuarterCode: '20204',
    items: [{ dong: base.items[0].dong, status: 'UNAVAILABLE', score: null, currentCount: '0', previousCount: null, changeRate: null, direction: null, reason: 'PREVIOUS_QUARTER_UNAVAILABLE' }] }
  const onQuarterChange = vi.fn()
  render(<ChangeScoreCard result={result} dongCode="11110515" loading={false} error={null} onRetry={vi.fn()}
    quarters={[{ code: '20211', label: '2021년 1분기' }, { code: '20212', label: '2021년 2분기' }]} onQuarterChange={onQuarterChange} />)
  expect(screen.getByText('첫 제공 분기')).toBeInTheDocument()
  expect(screen.getByText(/직전 분기 자료가 없어/)).toBeInTheDocument()
  expect(screen.getByText(/이번 분기 거래 0건/)).toBeInTheDocument()
  expect(screen.queryByText('산정 불가')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '2021년 2분기 변화 보기' }))
  expect(onQuarterChange).toHaveBeenCalledWith('20212')
})

it('does not call missing current values or an internal gap the first quarter', () => {
  const base = scoreFixture(['11110515'])
  const result: ChangeScores = { ...base, quarter: { code: '20212', label: '2021년 2분기' }, previousQuarterCode: '20211',
    items: [{ dong: base.items[0].dong, status: 'UNAVAILABLE', score: null, currentCount: null, previousCount: null, changeRate: null, direction: null, reason: 'NO_ROW_CURRENT' }] }
  render(<ChangeScoreCard result={result} dongCode="11110515" loading={false} error={null} onRetry={vi.fn()}
    quarters={[{ code: '20211', label: '2021년 1분기' }, { code: '20212', label: '2021년 2분기' }]} onQuarterChange={vi.fn()} />)
  expect(screen.queryByText('첫 제공 분기')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /변화 보기/ })).not.toBeInTheDocument()
  expect(screen.getByText('선택 분기의 거래 집계 자료가 없습니다.')).toBeInTheDocument()
})

it('does not offer a later nonadjacent quarter or label an internal gap as the first quarter', () => {
  const base = scoreFixture(['11110515'])
  const result: ChangeScores = { ...base, quarter: { code: '20211', label: '2021년 1분기' }, previousQuarterCode: '20204',
    items: [{ dong: base.items[0].dong, status: 'UNAVAILABLE', score: null, currentCount: '10', previousCount: null, changeRate: null, direction: null, reason: 'PREVIOUS_QUARTER_UNAVAILABLE' }] }
  const props = { result, dongCode: '11110515', loading: false, error: null, onRetry: vi.fn(), onQuarterChange: vi.fn() }
  const view = render(<ChangeScoreCard {...props} quarters={[result.quarter, { code: '20213', label: '2021년 3분기' }]} />)
  expect(screen.getByText('첫 제공 분기')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /변화 보기/ })).not.toBeInTheDocument()
  view.rerender(<ChangeScoreCard {...props} quarters={[{ code: '20204', label: '2020년 4분기' }, result.quarter]} />)
  expect(screen.queryByText('첫 제공 분기')).not.toBeInTheDocument()
  expect(screen.getByText('비교할 지난 분기 자료를 아직 제공하지 않습니다.')).toBeInTheDocument()
})
