/** Draft arithmetic and evidence gate, not a calibrated business-outcome model.
 * No production endpoint supplies this evidence yet. UI calls this with null.
 */
export const cafeScoreFactors = [
  { key: 'demand', name: '수요', weight: 35, detail: '영업시간대 인구 · 고객층', reason: '인구 자료 미연동' },
  { key: 'competition', name: '경쟁', weight: 25, detail: '수요 대비 점포 · 같은 콘셉트', reason: '수요·점포 유형 미확인' },
  { key: 'consumption', name: '소비', weight: 25, detail: '거래 수준 · 전년 동기 흐름', reason: '비교집단·전년 자료 미연동' },
  { key: 'volatility', name: '변동성', weight: 15, detail: '분모가 검증된 과거 폐업률', reason: '분모·기준 분포 검증 필요' },
] as const

const indicators = ['exposure', 'customerFit', 'demandPerStore', 'conceptDensity', 'transactionsDensity', 'transactionsYoY', 'closureRate'] as const
type Indicator = typeof indicators[number]
type SpatialUnit = 'ADMIN_DONG' | 'RADIUS_500M'
export interface CafeScoreEvidence {
  benchmark: { id: string; quarter: string; industryCode: string; spatialUnit: SpatialUnit; scenario: string; size: number; verified: boolean }
  indicators: Record<Indicator, { percentile: number | null; benchmarkId: string; quarter: string; spatialUnit: SpatialUnit; verified: boolean; comparisonQuarter: string | null }>
}
type Factor = typeof cafeScoreFactors[number]['key']
type ScoreResult = { status: 'UNAVAILABLE'; total: null; reasons: string[] }
  | { status: 'DRAFT'; total: number; factors: Record<Factor, number>; sensitivity: { min: number; max: number }; modelVersion: 'CAFE_ENV_V0_1_DRAFT' }

// Experimental minimum, not a statistical guarantee. Must be calibrated before publication.
const minimumBenchmarkSize = 30
export function percentileRank(value: number, reference: number[]): number | null {
  if (!Number.isFinite(value) || reference.length < minimumBenchmarkSize || reference.some(n => !Number.isFinite(n))) return null
  const equal = reference.filter(n => n === value).length
  if (!equal) return null
  const lower = reference.filter(n => n < value).length
  return 100 * (lower + (equal - 1) / 2) / (reference.length - 1)
}

export function calculateDraftCafeScore(input: CafeScoreEvidence | null): ScoreResult {
  if (!input) return { status: 'UNAVAILABLE', total: null, reasons: ['필수 인구·점포 유형·서울 전체 기준 집단 미연동'] }
  const b = input.benchmark
  const reasons: string[] = []
  if (!b || !b.id.trim() || !b.scenario.trim() || !b.verified || !/^\d{4}[1-4]$/.test(b.quarter)
    || b.industryCode !== 'CAFE' || b.spatialUnit !== 'ADMIN_DONG' || !Number.isInteger(b.size) || b.size < minimumBenchmarkSize) {
    return { status: 'UNAVAILABLE', total: null, reasons: ['기준 집단·기간·공간 단위·카페 분류 검증 필요'] }
  }
  for (const key of indicators) {
    const item = input.indicators[key]
    if (!item || item.percentile === null || !Number.isFinite(item.percentile) || item.percentile < 0 || item.percentile > 100
      || !item.verified || item.benchmarkId !== b.id || item.quarter !== b.quarter || item.spatialUnit !== b.spatialUnit) reasons.push(key + ': 검증된 동일 기준 자료 필요')
  }
  const priorYear = String(Number(b.quarter.slice(0, 4)) - 1) + b.quarter.slice(4)
  if (input.indicators.transactionsYoY?.comparisonQuarter !== priorYear) reasons.push('거래 건수 전년 동기 자료 필요')
  if (reasons.length) return { status: 'UNAVAILABLE', total: null, reasons }
  const p = (key: Indicator) => input.indicators[key].percentile!
  const factors = {
    demand: (25 * p('exposure') + 10 * p('customerFit')) / 35,
    competition: (15 * p('demandPerStore') + 10 * (100 - p('conceptDensity'))) / 25,
    consumption: (15 * p('transactionsDensity') + 10 * p('transactionsYoY')) / 25,
    volatility: 100 - p('closureRate'),
  }
  const weighted = (multipliers: number[]) => {
    const weights = cafeScoreFactors.map((factor, index) => factor.weight * multipliers[index])
    return cafeScoreFactors.reduce((sum, factor, index) => sum + factors[factor.key] * weights[index], 0) / weights.reduce((sum, n) => sum + n, 0)
  }
  const variants = Array.from({ length: 16 }, (_, mask) => weighted(cafeScoreFactors.map((_, i) => mask & (1 << i) ? 1.2 : 0.8)))
  return { status: 'DRAFT', total: Math.round(weighted([1, 1, 1, 1])), factors,
    sensitivity: { min: Math.min(...variants), max: Math.max(...variants) }, modelVersion: 'CAFE_ENV_V0_1_DRAFT' }
}
