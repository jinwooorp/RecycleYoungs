import type { ConsumptionScores } from '../types/regions'
import { formatDecimal } from '../lib/formatStats'
import { Button } from './ui/button'

const reasons: Record<string, string> = { NO_ROW: '해당 분기의 거래 집계 행이 없습니다.', NULL_VALUE: '거래 건수 값이 없습니다.', INVALID_VALUE: '거래 건수 확인이 필요합니다.', INSUFFICIENT_COHORT: '비교할 유효 행정동이 부족합니다.' }
export function ConsumptionScoreCard({ result, dongCode, loading, error, onRetry, compact = false }: {
  result: ConsumptionScores | null; dongCode: string; loading: boolean; error: string | null; onRetry: () => void; compact?: boolean
}) {
  const item = result?.items.find(i => i.dong.code === dongCode)
  return <section className="rounded-xl border border-border bg-background p-4" aria-label="카페 소비규모 점수">
    <p className="text-sm font-semibold text-primary">카페 소비규모 점수</p>
    {loading ? <p role="status" className="mt-3">점수를 계산하는 중입니다.</p> : error ? <div role="alert"><p>{error}</p><Button type="button" variant="outline" onClick={onRetry}>점수 다시 조회</Button></div>
      : item ? <><p className="mt-3 text-3xl font-semibold tabular-nums">{item.score === null ? '산정 불가' : <>{item.score}<span className="ml-1 text-base text-muted-foreground">/100점</span></>}</p>
        {!compact && <><p className="mt-2 text-sm">{item.dong.name} · {result!.quarter.label}</p>
        <p className="text-sm text-muted-foreground break-all">거래 {formatDecimal(item.transactionCount, '건')} · 비교 행정동 {result!.cohortSize}개</p></>}
        {item.reason && <p className="mt-2 text-sm">{reasons[item.reason] ?? '자료 확인이 필요합니다.'}</p>}</>
        : <p className="mt-3 text-sm">행정동과 분기를 선택하면 점수를 확인할 수 있습니다.</p>}
    {!compact && <p className="mt-3 text-xs text-muted-foreground">같은 분기 서울 행정동의 카페 거래 규모를 비교한 상대 점수입니다. 유동인구·경쟁·임대료는 반영되지 않으며 창업 성공률이 아닙니다.</p>}
    {!compact && result && <details className="source-details mt-3"><summary>점수 계산 기준</summary><div className="flex flex-col gap-2 text-xs text-muted-foreground">
      <p>유효 행정동 전체에서 거래 건수의 중간 순위를 0~100으로 환산합니다. 최소 {result.minimumCohortSize}개 기준은 실험적 운영 기준입니다. 동점은 중간 순위이며 모두 같으면 50점입니다.</p>
      <p>서울시 추정매출 자료의 거래 건수를 사용합니다. 행정동 전체 집계이므로 같은 동의 후보는 같은 점수입니다. 면적이 큰 동에 유리할 수 있고 점포당 거래·매출은 아닙니다. NULL·행 부재는 0점으로 바꾸지 않습니다.</p>
      <p>모델: {result.modelVersion} · 원본 기준일·완전성 미검증(UNVERIFIED)</p>
      <p className="break-all">조회 자료 비교 기준: {result.baselineId}</p>
      <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="underline">서울시 추정매출·행정동 자료</a>
    </div></details>}
  </section>
}
