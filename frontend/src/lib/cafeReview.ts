import type { ChangeScores, ConsumptionScores } from '../types/regions'
import type { NearbyResult } from '../types/nearby'
import { formatChangeRate } from './readableNumbers'
import { samePublication } from './publication'
interface Query<T> { result: T | null; loading: boolean; error: string | null }
export interface CafeReviewInput {
  dongCode: string; quarterCode: string; consumption: Query<ConsumptionScores>; change: Query<ChangeScores>
  unavailableReason?: string; point?: { lat: number; lng: number } | null; nearby?: NearbyResult | null
}
export interface CafeReview {
  state: 'READY' | 'LOADING' | 'ERROR' | 'UNAVAILABLE'; headline: string; summary: string
  evidence: string[]; checks: string[]; missing: string[]
}

export function buildCafeReview(input: CafeReviewInput): CafeReview {
  const missing = ['영업시간대 유동인구', '임대료·운영비', '반경 전체의 실제 경쟁 구성', '전년 같은 분기의 소비 흐름']
  const empty = (state: CafeReview['state'], headline: string, summary: string): CafeReview => ({ state, headline, summary, evidence: [], checks: [], missing })
  if (input.consumption.loading || input.change.loading) return empty('LOADING', '검토 자료를 확인하는 중입니다', '현재 지역·분기의 소비 자료를 기다리고 있습니다.')
  if (input.consumption.error || input.change.error) return empty('ERROR', '검토 자료를 불러오지 못했습니다', '아래 점수의 다시 조회 버튼으로 실패한 자료를 다시 확인해 주세요.')
  if (input.unavailableReason) return empty('UNAVAILABLE', '자료 부족으로 판단 보류', input.unavailableReason)
  const c = input.consumption.result, g = input.change.result
  const a = c?.items.find(i => i.dong.code === input.dongCode), b = g?.items.find(i => i.dong.code === input.dongCode)
  if (!c || !g || c.quarter.code !== input.quarterCode || g.quarter.code !== input.quarterCode)
    return empty('UNAVAILABLE', '자료 부족으로 판단 보류', '같은 지역·분기의 두 소비 지표가 준비되면 검토 요약을 보여드립니다.')
  if (!samePublication(c.metadata, g.metadata))
    return empty('UNAVAILABLE', '자료를 다시 확인해 주세요', '공개 자료 버전이 달라 두 소비 지표를 함께 해석하지 않습니다. 조회 조건을 다시 불러와 주세요.')
  if (!a || !b || a.status !== 'AVAILABLE' || b.status !== 'AVAILABLE' || a.score === null || b.score === null || !b.direction || b.changeRate === null)
    return empty('UNAVAILABLE', '자료 부족으로 판단 보류', b?.reason === 'ZERO_PREVIOUS' ? '지난 분기 거래가 0건이어서 변화율을 계산할 수 없습니다.' : '두 분기의 거래를 함께 비교할 자료가 부족합니다. 아래 점수의 산정 불가 사유를 확인해 주세요.')
  if (a.transactionCount !== b.currentCount) return empty('UNAVAILABLE', '자료를 다시 확인해 주세요', '두 지표의 현재 거래 건수가 달라 함께 해석하지 않습니다. 자료를 다시 조회해 주세요.')
  const rate = formatChangeRate(b.changeRate, b.direction)
  const headline = b.direction === 'DECREASE' ? '소비 감소 확인 필요' : b.direction === 'INCREASE' ? '소비 증가 확인·입지 추가 검토' : '소비 유지·추가 확인'
  const evidence = [`행정동 소비규모 ${a.score}/100점`, `전분기 거래 ${rate}`]
  if (input.point && input.nearby && samePublication(c.metadata, input.nearby.data.metadata)
    && input.nearby.coordinate.lat === input.point.lat && input.nearby.coordinate.lng === input.point.lng)
    evidence.push(`수집 자료의 반경 500m 카페 ${BigInt(input.nearby.totalCount).toLocaleString('ko-KR')}곳`)
  return { state: 'READY', headline, summary: `소비규모 ${a.score}점 · 전분기 거래 ${rate}. ${b.direction === 'DECREASE' ? '감소 원인을 먼저 확인해 보세요.' : '소비 흐름과 실제 입지 조건을 함께 확인해 보세요.'}`,
    evidence, checks: [b.direction === 'DECREASE' ? '계절 변화나 일시적인 감소인지 전년 같은 분기와 대조하기' : '소비 흐름이 지속되는지 다음 분기에도 확인하기', '예정 영업시간의 고객 흐름과 주변 카페 콘셉트 현장 확인', '임대료·관리비·인건비와 필요한 매출 기준 확인'], missing }
}
