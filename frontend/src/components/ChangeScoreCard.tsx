import type { ChangeScores } from '../types/regions'
import { Button } from './ui/button'
import { formatDecimal } from '../lib/formatStats'
import { formatChangeRate } from '../lib/readableNumbers'
import { DataIdentifiers } from './DataProvenance'
import { ScoreCardFrame } from './ScoreCardFrame'

const reasons: Record<string, string> = {
  NO_ROW_CURRENT: '선택 분기의 거래 집계 자료가 없습니다.', NO_ROW_PREVIOUS: '지난 분기의 거래 집계 자료가 없습니다.',
  NULL_CURRENT: '선택 분기의 거래 건수가 제공되지 않았습니다.', NULL_PREVIOUS: '지난 분기의 거래 건수가 제공되지 않았습니다.',
  INVALID_CURRENT: '선택 분기의 거래 건수가 올바른 값인지 확인이 필요합니다.', INVALID_PREVIOUS: '지난 분기의 거래 건수가 올바른 값인지 확인이 필요합니다.',
  ZERO_PREVIOUS: '지난 분기 거래가 0건이어서 변화율을 계산할 수 없습니다.', PREVIOUS_QUARTER_UNAVAILABLE: '비교할 지난 분기 자료를 아직 제공하지 않습니다.',
  INSUFFICIENT_COHORT: '비교할 수 있는 동네가 부족해 점수를 계산하지 않습니다.',
}
export function ChangeScoreCard({ result, dongCode, loading, error, onRetry, compact = false, emptyMessage }: {
  result: ChangeScores | null; dongCode: string; loading: boolean; error: string | null; onRetry: () => void; compact?: boolean; emptyMessage?: string
}) {
  const item = result?.items.find(i => i.dong.code === dongCode)
  return <ScoreCardFrame title="카페 소비증감 점수" compact={compact}>
    {loading ? <p role="status" className="mt-3">점수를 계산하는 중입니다.</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={onRetry}>소비증감 점수 다시 조회</Button></div>
      : item ? <><p className="score-value">{item.score === null ? '산정 불가' : <>{item.score}<span>/100점</span></>}</p>
        {item.changeRate !== null && <p className={compact ? 'score-subtitle' : 'text-sm'} aria-label={`지난 분기 대비 ${formatChangeRate(item.changeRate, item.direction)}`}>{!compact && '지난 분기 대비 '}{formatChangeRate(item.changeRate, item.direction)}</p>}
        {item.reason && <p className="mt-2 text-sm">{reasons[item.reason] ?? '자료 확인이 필요합니다.'}</p>}</> : <p className="mt-3 text-sm">{emptyMessage ?? '지역과 분기를 선택해 보세요.'}</p>}
    {!compact && result && <><p className="mt-3 text-sm">{result.previousQuarterCode.slice(0, 4)}년 {result.previousQuarterCode[4]}분기 → {result.quarter.label} · 비교한 동네 {result.cohortSize}개</p>
      {item && <p className="text-sm">거래 {formatDecimal(item.previousCount, '건')} → {formatDecimal(item.currentCount, '건')}</p>}
      <p className="mt-3 text-sm text-muted-foreground">지난 분기보다 카페 거래가 얼마나 달라졌는지, 서울의 다른 동네와 비교합니다.</p>
      <details className="source-details mt-3"><summary>소비증감 점수는 어떻게 계산하나요?</summary><div className="explanation">
        <ol className="list-decimal space-y-2 pl-5"><li>같은 동네의 이번 분기와 바로 전 분기 거래 건수를 비교합니다. 가상 예로 1,000건에서 1,100건이 되면 10% 증가입니다.</li>
          <li>이 증가·감소율을 다른 서울 동네와 비교해 순위에 따라 점수를 정합니다. 같은 변화율은 같은 점수, 모두 같으면 50점입니다.</li>
          <li><strong>거래가 줄어도 다른 동네가 더 크게 줄었다면 높은 점수를 받을 수 있습니다.</strong> 점수와 실제 증가·감소를 함께 확인하세요.</li></ol>
        <p>지난 분기 자료가 없거나 0건이면 변화율을 계산하지 않습니다. 지난 분기에는 거래가 있고 이번 분기가 0건이면 100% 감소입니다. 두 분기 모두 비교 가능한 동네가 {result.minimumCohortSize}개 이상이어야 합니다. 이 최소 개수는 실험적 운영 기준입니다.</p>
        <p>계절에 따른 차이는 보정하지 않습니다. 이 점수만으로 앞으로의 매출이나 창업 성공을 예측할 수 없습니다. 원자료 기준일과 빠진 자료가 없는지는 확인 전입니다.</p>
        <a className="underline" href={result.sourceUrl} target="_blank" rel="noreferrer">서울시 추정매출·행정동 자료 보기</a>
        <DataIdentifiers>{item?.changeRate !== null && item?.changeRate !== undefined && <p>정밀 표시 증감률: {item.changeRate}% (소수 넷째 자리까지 반올림)</p>}<p>변화율 = (이번 거래 − 지난 거래) ÷ 지난 거래 × 100. 점수는 변화율의 중간 순위를 0~100점으로 환산합니다.</p><p>계산 방식: {result.modelVersion} · 원자료 확인 상태: UNVERIFIED</p><p className="break-all">이번 조회 자료 구분 코드: {result.baselineId}</p></DataIdentifiers>
      </div></details></>}
  </ScoreCardFrame>
}
