import { render, screen, within } from '@testing-library/react'
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
