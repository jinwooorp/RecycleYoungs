import { expect, it } from 'vitest'
import { buildCafeReview } from './cafeReview'
import { scoreFixture } from '../test/regionFixture'
import { nearbyFixture } from '../test/nearbyFixture'
import type { ChangeScores } from '../types/regions'

function input() {
  const result = scoreFixture(['11110515']); result.items[0].score = 99; result.items[0].transactionCount = '900'
  const change: ChangeScores = { ...result, previousQuarterCode: '20253', items: [{ dong: result.items[0].dong, status: 'AVAILABLE', score: 95, currentCount: '900', previousCount: '1000', changeRate: '-10.0000', direction: 'DECREASE', reason: null }] }
  return { dongCode: '11110515', quarterCode: '20254', consumption: { result, loading: false, error: null }, change: { result: change, loading: false, error: null } }
}
it('withholds combined scores and nearby evidence from different publication versions', () => {
  const value=input()
  const metadata={dataVersion:'a'.repeat(64),collectedAt:'2026-10-21T08:00:00Z',storeReferenceMonth:'202606',storeScope:'I21201' as const,sourceSnapshotStatus:'UNVERIFIED' as const}
  value.consumption.result.metadata=metadata
  value.change.result.metadata={...metadata,dataVersion:'b'.repeat(64)}
  expect(buildCafeReview(value).state).toBe('UNAVAILABLE')
  value.change.result.metadata=metadata
  const point={lat:37.57,lng:126.98}, nearby=nearbyFixture(point)
  nearby.data.metadata={...metadata,dataVersion:'b'.repeat(64)}
  expect(buildCafeReview({...value,point,nearby}).evidence.join(' ')).not.toContain('카페 ')
})
it('prioritizes actual decline over high relative scores without inventing a composite score or recommendation', () => {
  const review = buildCafeReview(input())
  expect(review.state).toBe('READY'); expect(review.headline).toBe('소비 감소 확인 필요')
  expect(review.summary).toContain('99점'); expect(review.summary).toContain('-10.0% · 감소')
  expect(review.checks.join(' ')).toContain('영업시간'); expect(review).not.toHaveProperty('total')
})
it('preserves tiny actual changes and zero scores', () => {
  const value = input(); value.consumption.result.items[0].score = 0
  Object.assign(value.change.result.items[0], { direction: 'INCREASE', changeRate: '0.0000', previousCount: '899' })
  const review = buildCafeReview(value)
  expect(review.summary).toContain('0점'); expect(review.summary).toContain('0.1% 미만 증가')
  expect(review.headline).toBe('소비 증가 확인·입지 추가 검토')
})
it('does not retain conclusions while loading or after errors', () => {
  const value = input(); value.change.loading = true
  expect(buildCafeReview(value).state).toBe('LOADING')
  value.change.loading = false
  expect(buildCafeReview({ ...value, change: { ...value.change, error: '실패' } }).state).toBe('ERROR')
})
it('withholds a combined conclusion for unavailable, mismatched quarter or inconsistent raw counts', () => {
  const value = input(); value.change.result.quarter = { code: '20253', label: '이전 조건' }
  expect(buildCafeReview(value).state).toBe('UNAVAILABLE')
  value.change.result.quarter = value.consumption.result.quarter
  value.change.result.items[0].currentCount = '901'
  expect(buildCafeReview(value).headline).toBe('자료를 다시 확인해 주세요')
  value.change.result.items[0].status = 'UNAVAILABLE'; value.change.result.items[0].reason = 'ZERO_PREVIOUS'
  expect(buildCafeReview(value).summary).toContain('지난 분기')
})
it('uses the full observed radius total only for the matching selected point and does not call it saturation', () => {
  const value = input(), point = { lat: 37.57, lng: 126.98 }, nearby = nearbyFixture(point)
  nearby.totalCount = '206'; nearby.listedCount = 100; nearby.listComplete = false
  const review = buildCafeReview({ ...value, point, nearby })
  expect(review.evidence.join(' ')).toContain('206곳'); expect(review.evidence.join(' ')).not.toContain('과밀')
  expect(buildCafeReview({ ...value, nearby }).evidence.join(' ')).not.toContain('206곳')
  expect(buildCafeReview({ ...value, point: { ...point, lat: 37.58 }, nearby }).evidence.join(' ')).not.toContain('206곳')
})

it('keeps current consumption evidence when only the previous quarter is unavailable', () => {
  const value = input()
  Object.assign(value.change.result.items[0], { status: 'UNAVAILABLE', score: null, currentCount: '900', previousCount: null,
    changeRate: null, direction: null, reason: 'PREVIOUS_QUARTER_UNAVAILABLE' })
  const review = buildCafeReview(value)
  expect(review.headline).toBe('현재 소비 확인·변화 비교 대기')
  expect(review.summary).toContain('직전 분기 자료')
  expect(review.evidence.join(' ')).toContain('99/100점')
  expect(review.checks.join(' ')).toContain('소비규모')
})
