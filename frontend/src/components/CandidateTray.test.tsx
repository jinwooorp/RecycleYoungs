import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CandidateTray } from './CandidateTray'
import { comparisonLocation } from '../test/comparisonFixture'
import { ApiFailure } from '../api/adminDongApi'
import type { Candidate } from '../types/comparison'

it.each(['ambiguous', 'outside', 'failure'] as const)('does not present a completed %s location as still loading', kind => {
  const result = comparisonLocation({ lat: 37.56, lng: 126.97 })
  result.adminDong = { ...result.adminDong, resolvedDong: null, candidates: [], status: kind === 'ambiguous' ? 'AMBIGUOUS_BOUNDARY' : 'OUTSIDE_OR_UNSUPPORTED' }
  const candidate: Candidate = {
    id: 'one', order: 1, number: 1, coordinate: result.coordinate, statsQuarter: null,
    location: { loading: false, result: kind === 'failure' ? null : result,
      error: kind === 'failure' ? new ApiFailure('network', { code: 'NETWORK_ERROR', message: '연결 실패', field: null }) : null },
    nearby: { loading: false, result: null, error: null }, stats: { loading: false, result: null, error: null },
  }
  render(<CandidateTray candidates={[candidate]} onCompare={vi.fn()} />)
  expect(screen.queryByText(/지역 확인 중/)).not.toBeInTheDocument()
  expect(screen.getByText(kind === 'failure' ? /지역 판정 실패/ : kind === 'ambiguous' ? /경계 모호성/ : /행정동 미확정/)).toBeInTheDocument()
})
