import type { ConsumptionScores } from '../types/regions'
import { formatDecimal } from '../lib/formatStats'
import { Button } from './ui/button'
import { DataIdentifiers } from './DataProvenance'
import { ScoreCardFrame } from './ScoreCardFrame'

const reasons: Record<string, string> = { NO_ROW: '해당 분기의 거래 집계 자료가 없습니다.', NULL_VALUE: '집계 자료에 거래 건수 값이 제공되지 않았습니다.', INVALID_VALUE: '거래 건수가 올바른 값인지 확인이 필요합니다.', INSUFFICIENT_COHORT: '비교할 수 있는 동네가 부족해 점수를 계산하지 않습니다.' }
export function ConsumptionScoreCard({ result, dongCode, loading, error, onRetry, compact = false, emptyMessage }: {
  result: ConsumptionScores | null; dongCode: string; loading: boolean; error: string | null; onRetry: () => void; compact?: boolean; emptyMessage?: string
}) {
  const item = result?.items.find(i => i.dong.code === dongCode)
  return <ScoreCardFrame title="카페 소비규모 점수" compact={compact}>
    {loading ? <p role="status" className="mt-3">점수를 계산하는 중입니다.</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={onRetry}>점수 다시 조회</Button></div>
      : item ? <><p className="score-value">{item.score === null ? '산정 불가' : <>{item.score}<span>/100점</span></>}</p>
        {compact && <p className="score-subtitle">서울 동별 거래 순위</p>}
        {!compact && <><p className="text-sm">{item.dong.name} · {result!.quarter.label}</p>
          <p className="text-sm text-muted-foreground">거래 {formatDecimal(item.transactionCount, '건')} · 비교한 동네 {result!.cohortSize}개</p></>}
        {item.reason && <p className="mt-2 text-sm">{reasons[item.reason] ?? '자료 확인이 필요합니다.'}</p>}</>
        : <p className="mt-3 text-sm">{emptyMessage ?? '지역과 분기를 선택해 보세요.'}</p>}
    {!compact && <p className="mt-3 text-sm text-muted-foreground">이 동네의 카페 거래가 서울의 다른 동네보다 얼마나 많은 편인지 보여줍니다.</p>}
    {!compact && result && <details className="source-details mt-3"><summary>이 점수는 어떻게 계산하나요?</summary><div className="explanation">
      <ol className="list-decimal space-y-2 pl-5"><li>선택한 분기의 <strong>행정동 전체 카페 거래 건수</strong>를 다른 서울 동네와 비교합니다. 점수가 높을수록 거래가 많은 쪽에 가깝습니다.</li>
        <li>같은 거래 건수는 같은 점수를 받습니다. 모두 같으면 50점입니다. 50점이 평균 매출을 뜻하는 것은 아닙니다.</li>
        <li>예를 들어 80점은 거래 규모가 상대적으로 큰 편이라는 뜻입니다. <strong>창업 성공 확률 80%나 손님 80명을 뜻하지 않습니다.</strong></li></ol>
      <p>반경 500m만의 점수가 아니므로 같은 동네의 후보는 같은 점수를 받습니다. 넓은 동네에 유리할 수 있으며, 카페 한 곳당 거래·매출이나 이익을 보여주는 값은 아닙니다.</p>
      <p>자료가 없다고 0점으로 표시하지 않습니다. 비교할 수 있는 동네가 {result.minimumCohortSize}개 미만이면 계산하지 않습니다. 이 최소 개수는 실험적 운영 기준입니다.</p>
      <p>유동인구·경쟁·임대료는 반영하지 않습니다. 원자료의 기준일과 빠진 자료가 없는지는 아직 확인하지 못했습니다.</p>
      <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="underline">서울시 추정매출·행정동 자료 보기</a>
      <DataIdentifiers><p>계산 방식: {result.modelVersion} · 원자료 확인 상태: UNVERIFIED</p><p>정확한 산식: 거래 건수의 중간 순위를 0~100점으로 환산하고 정수로 반올림합니다. 동점은 해당 순위의 중간값을 사용합니다.</p><p className="break-all">이번 조회 자료 구분 코드: {result.baselineId}</p></DataIdentifiers>
    </div></details>}
  </ScoreCardFrame>
}
