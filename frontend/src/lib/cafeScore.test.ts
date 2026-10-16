import { describe, expect, it } from 'vitest'
import { calculateDraftCafeScore, percentileRank, type CafeScoreEvidence } from './cafeScore'

function evidence(value = 50): CafeScoreEvidence {
  return {
    benchmark: { id: 'fixture-20254', quarter: '20254', industryCode: 'CAFE', spatialUnit: 'ADMIN_DONG', scenario: 'fixture-takeout', size: 100, verified: true },
    indicators: Object.fromEntries(['exposure', 'customerFit', 'demandPerStore', 'conceptDensity', 'transactionsDensity', 'transactionsYoY', 'closureRate']
      .map(key => [key, { percentile: value, benchmarkId: 'fixture-20254', quarter: '20254', spatialUnit: 'ADMIN_DONG', verified: true,
        comparisonQuarter: key === 'transactionsYoY' ? '20244' : null }])),
  } as CafeScoreEvidence
}

describe('draft cafe score contract — synthetic fixtures only', () => {
  it('never fabricates a total or rescales partial evidence', () => {
    expect(calculateDraftCafeScore(null)).toMatchObject({ status: 'UNAVAILABLE', total: null })
    const input = evidence(80)
    input.indicators.exposure.percentile = null
    expect(calculateDraftCafeScore(input)).toMatchObject({ status: 'UNAVAILABLE', total: null })
  })
  it('uses the proposed weights and inverses only competition density and closure rate', () => {
    const input = evidence(100)
    input.indicators.conceptDensity.percentile = 0
    input.indicators.closureRate.percentile = 0
    expect(calculateDraftCafeScore(input)).toMatchObject({ status: 'DRAFT', total: 100 })
    input.indicators.exposure.percentile = 0
    expect(calculateDraftCafeScore(input)).toMatchObject({ status: 'DRAFT', total: 75 })
  })
  it('retains actual zero rather than treating it as missing', () => {
    const input = evidence(0)
    input.indicators.conceptDensity.percentile = 100
    input.indicators.closureRate.percentile = 100
    expect(calculateDraftCafeScore(input)).toMatchObject({ status: 'DRAFT', total: 0 })
  })
  it.each(['unverified', 'radius', 'stale', 'cohort', 'invalid', 'missing-year'] as const)('blocks %s indicator evidence', kind => {
    const input = evidence()
    if (kind === 'unverified') input.indicators.exposure.verified = false
    if (kind === 'radius') input.indicators.exposure.spatialUnit = 'RADIUS_500M'
    if (kind === 'stale') input.indicators.exposure.quarter = '20253'
    if (kind === 'cohort') input.indicators.exposure.benchmarkId = 'other'
    if (kind === 'invalid') input.indicators.exposure.percentile = NaN
    if (kind === 'missing-year') input.indicators.transactionsYoY.comparisonQuarter = '20253'
    expect(calculateDraftCafeScore(input)).toMatchObject({ status: 'UNAVAILABLE', total: null })
  })
  it.each(['small', 'unverified', 'industry', 'unit'] as const)('blocks an invalid %s benchmark', kind => {
    const input = evidence()
    if (kind === 'small') input.benchmark.size = 3
    if (kind === 'unverified') input.benchmark.verified = false
    if (kind === 'industry') input.benchmark.industryCode = 'PUB'
    if (kind === 'unit') input.benchmark.spatialUnit = 'RADIUS_500M'
    expect(calculateDraftCafeScore(input)).toMatchObject({ status: 'UNAVAILABLE', total: null })
  })
  it('keeps ties at their average rank and refuses absent/insufficient baselines', () => {
    expect(percentileRank(5, Array(30).fill(5))).toBe(50)
    expect(percentileRank(0, Array.from({ length: 30 }, (_, i) => i))).toBe(0)
    expect(percentileRank(29, Array.from({ length: 30 }, (_, i) => i))).toBe(100)
    expect(percentileRank(30, Array.from({ length: 30 }, (_, i) => i))).toBeNull()
    expect(percentileRank(5, [1, 5, 8])).toBeNull()
  })
})
