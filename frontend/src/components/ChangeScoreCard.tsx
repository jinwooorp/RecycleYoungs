import type { ChangeScores } from '../types/regions'
import { Button } from './ui/button'
import { formatDecimal } from '../lib/formatStats'

const changeReasons: Record<string, string> = {
  NO_ROW_CURRENT: '선택 분기 거래 집계 행이 없습니다.', NO_ROW_PREVIOUS: '직전 분기 거래 집계 행이 없습니다.',
  NULL_CURRENT: '선택 분기 거래 건수가 없습니다.', NULL_PREVIOUS: '직전 분기 거래 건수가 없습니다.',
  INVALID_CURRENT: '선택 분기 거래 건수 확인이 필요합니다.', INVALID_PREVIOUS: '직전 분기 거래 건수 확인이 필요합니다.',
  ZERO_PREVIOUS: '직전 분기 거래 건수가 0건이어서 증감률을 계산할 수 없습니다.',
  PREVIOUS_QUARTER_UNAVAILABLE: '직전 분기를 지원하지 않습니다.', INSUFFICIENT_COHORT: '비교할 유효 행정동이 부족합니다.',
}
export function ChangeScoreCard({ result, dongCode, loading, error, onRetry, compact = false }: {
  result: ChangeScores | null; dongCode: string; loading: boolean; error: string | null; onRetry: () => void; compact?: boolean
}) {
  const item = result?.items.find(i => i.dong.code === dongCode)
  return <section className="score-card" aria-label="카페 소비증감 점수">
    <h3 className="text-sm font-semibold text-primary">카페 소비증감 점수</h3>
    {loading ? <p role="status">점수를 계산하는 중입니다.</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={onRetry}>소비증감 점수 다시 조회</Button></div>
      : item ? <><p className="score-value">{item.score === null ? '산정 불가' : <>{item.score}<span>/100점</span></>}</p>
        {item.changeRate !== null && <p className="text-sm">전분기 대비 {item.direction === 'INCREASE' ? '+' : ''}{item.changeRate}% · {item.direction === 'INCREASE' ? '증가' : item.direction === 'DECREASE' ? '감소' : '변동 없음'}</p>}
        {item.reason && <p className="text-sm">{changeReasons[item.reason] ?? '자료 확인이 필요합니다.'}</p>}</>
        : <p className="text-sm">행정동과 분기를 선택해 주세요.</p>}
    {!compact && result && <><p className="mt-3 text-sm">{result.previousQuarterCode.slice(0, 4)}년 {result.previousQuarterCode[4]}분기 → {result.quarter.label} · 비교 행정동 {result.cohortSize}개</p>
      {item && <p className="break-all text-sm">거래 {formatDecimal(item.previousCount, '건')} → {formatDecimal(item.currentCount, '건')}</p>}
      <details className="source-details mt-3"><summary>소비증감 점수 계산 기준</summary><div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>직전 분기 대비 거래 건수 증감률의 서울 행정동 내 중간 순위를 0~100점으로 환산합니다. 높은 상대 점수도 소비 감소를 뜻할 수 있습니다. 계절성을 보정하지 않습니다.</p>
        <p>두 분기 모두 유효하고 직전 거래가 0보다 큰 동만 비교합니다. 선택 분기 0건은 -100%입니다. 동점은 중간 순위, 모두 같으면 50점입니다. 최소 {result.minimumCohortSize}개는 실험적 운영 기준입니다. 증감률은 표시할 때만 소수 넷째 자리로 반올림합니다.</p>
        <p>모델 {result.modelVersion} · 원본 snapshot UNVERIFIED · 창업 성공률이 아닙니다.</p><p className="break-all">조회 자료 비교 기준: {result.baselineId}</p>
        <a className="underline" href={result.sourceUrl} target="_blank" rel="noreferrer">서울시 추정매출·행정동 자료</a>
      </div></details></>}
  </section>
}
