import type { Lookups } from '../types/api'
import type { useCandidateComparison } from '../hooks/useCandidateComparison'
import { CandidateCard } from './CandidateCard'
import { CandidateComparisonTable } from './CandidateComparisonTable'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card'
import { NativeSelect } from './ui/native-select'
import { Field, FieldLabel } from './ui/field'
import { Alert, AlertDescription } from './ui/alert'
import { Empty, EmptyTitle, EmptyDescription } from './ui/empty'
import { CafeAssessment } from './CafeAssessment'
import { useConsumptionScores } from '../hooks/useConsumptionScores'
import { ConsumptionScoreCard } from './ConsumptionScoreCard'
import { useChangeScores } from '../hooks/useChangeScores'
import { ChangeScoreCard } from './ChangeScoreCard'
import type { Candidate } from '../types/comparison'

export function CandidateComparison({ state, lookups, lookupLoading, lookupError, onRetryLookups, onExplore, onSelectCandidate }: {
  state: ReturnType<typeof useCandidateComparison>; lookups: Lookups | null; lookupLoading: boolean
  lookupError: boolean; onRetryLookups: () => void; onExplore: () => void
  onSelectCandidate?: (candidate: Candidate) => void
}) {
  const locations = state.candidates.flatMap(c => c.location.result ? [c.location.result] : [])
  const scoreCodes = state.candidates.filter(c => !state.statsBlockReason(c)).map(c => c.location.result!.adminDong.resolvedDong!.code)
  const consumption = useConsumptionScores(scoreCodes, state.quarter)
  const change = useChangeScores(scoreCodes, state.quarter)
  const versionMismatch = new Set(locations.map(l => l.adminDong.dataset.version)).size > 1
    || new Set(locations.map(l => l.commercialArea.dataset.version)).size > 1
  const resolvedCodes = locations.flatMap(l => l.adminDong.resolvedDong ? [l.adminDong.resolvedDong.code] : [])
  const sameDong = new Set(resolvedCodes).size < resolvedCodes.length
  const eligible = state.candidates.some(c => !state.statsBlockReason(c))
  const completeNearby = state.candidates.length > 1 && state.candidates.every(c => c.nearby.result && !c.nearby.loading && !c.nearby.error)
  const counts = completeNearby ? state.candidates.map(c => BigInt(c.nearby.result!.totalCount)) : []
  const spread = counts.length ? counts.reduce((a, b) => a > b ? a : b) - counts.reduce((a, b) => a < b ? a : b) : null
  return <section aria-labelledby="comparison-title" className="flex min-w-0 flex-col gap-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2"><h1 id="comparison-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">창업 후보지 비교</h1>
        <p className="text-muted-foreground">같은 분기, 같은 지표로 후보의 창업 환경을 살펴보세요.</p>
        <p className="text-sm" aria-live="polite">등록한 후보 {state.candidates.length}/3</p></div>
      <Button type="button" variant="outline" onClick={onExplore}>지도에서 후보 더 찾기</Button>
    </header>
    {!state.candidates.length ? <Empty><EmptyTitle>아직 담은 후보가 없습니다</EmptyTitle><EmptyDescription>지도에서 관심 위치를 선택하고 최대 3곳을 담아 보세요. 새로고침하면 후보는 사라집니다.</EmptyDescription>
      <Button type="button" onClick={onExplore}>지도 탐색 시작</Button></Empty> : <>
      <Card>
        <CardHeader><CardTitle>비교 조건</CardTitle><CardDescription>비교 분기는 지도에서 선택한 행정동의 분석 분기와 별도로 적용합니다.</CardDescription></CardHeader>
        <CardContent><div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2"><Badge variant="secondary">카페(CAFE)</Badge><Badge variant="outline">반경 500m</Badge><Badge variant="outline">행정동 통계</Badge></div>
          <div className="flex flex-wrap items-end gap-3"><Field className="w-full sm:w-64"><FieldLabel htmlFor="comparison-quarter">비교 통계 분기</FieldLabel>
            <NativeSelect id="comparison-quarter" value={state.quarter} disabled={lookupLoading || lookupError || !lookups?.industries.some(i => i.code === 'CAFE')}
              onChange={event => state.changeQuarter(event.target.value)}><option value="">분기를 선택하세요</option>
              {lookups?.quarters.filter(q => /^2025[1-4]$/.test(q.code)).map(q => <option key={q.code} value={q.code}>{q.label}</option>)}
            </NativeSelect></Field>
            <Button type="button" disabled={!eligible || state.candidates.some(c => c.stats.loading)} onClick={state.queryStats}>같은 분기로 후보 분석</Button>
          </div>
          <p className="text-sm text-muted-foreground">주변 카페 수와 같은 분기의 행정동 전체 통계를 비교합니다. 분기를 바꾸면 이전 통계를 지웁니다. 개인 점포의 예상 매출은 아닙니다.</p>
          {lookupLoading && <p role="status">비교용 조회 조건을 확인하는 중입니다.</p>}
          {lookupError && <Alert variant="destructive"><AlertDescription><p>조회 조건 오류로 비교 통계를 연결할 수 없습니다. 지역·카페 결과는 유지합니다.</p>
            <Button type="button" variant="outline" onClick={onRetryLookups}>비교 조회 조건 다시 불러오기</Button></AlertDescription></Alert>}
          {!lookupLoading && !lookupError && !lookups?.industries.some(i => i.code === 'CAFE') && <p>현재 조회 조건에서 CAFE 통계를 지원하지 않습니다.</p>}
        </div></CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">{[...new Set(scoreCodes)].map(code => <div key={code} className="flex flex-col gap-3"><ConsumptionScoreCard {...consumption} dongCode={code} onRetry={consumption.retry} /><ChangeScoreCard {...change} dongCode={code} onRetry={change.retry} /></div>)}</div>
      {versionMismatch && <Alert variant="warning" role="status"><AlertDescription>후보별 공간 dataset version이 다릅니다. 동일한 경계 자료 기준의 비교가 아닙니다. 필요한 후보의 지역 판정을 다시 조회해 주세요.</AlertDescription></Alert>}
      {sameDong && <Alert role="status"><AlertDescription>같은 행정동에 속한 후보가 있습니다. 통계는 동일 행정동의 집계값이며 좌표별 독립 통계가 아닙니다. 합산하지 않습니다.</AlertDescription></Alert>}
      {spread !== null && <Alert role="note"><AlertDescription>
        <p>조회 자료상 후보 간 반경 500m 카페 수 차이는 {spread.toLocaleString('ko-KR')}개입니다.</p>
        <p>점포가 적다는 이유만으로 유리한 입지는 아닙니다. 수요·임대료와 함께 확인해야 하며, 후보 자료의 동일 기준일·완전성은 미검증입니다.</p>
      </AlertDescription></Alert>}
      <CandidateComparisonTable candidates={state.candidates} quarter={state.quarter} blockReason={state.statsBlockReason} consumption={consumption.result} scoreLoading={consumption.loading} scoreError={consumption.error} change={change.result} changeLoading={change.loading} changeError={change.error} />
      <Alert role="note"><AlertDescription>반경 500m 카페 수와 행정동 통계는 시점·공간 단위가 다릅니다. 점포의 원본 기준일·완전성은 미검증이며, 추정매출은 수익이나 창업 성공률이 아닙니다.</AlertDescription></Alert>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {state.candidates.map(c => <CandidateCard key={c.id} candidate={c} quarter={state.quarter} block={state.statsBlockReason(c)}
          onMap={onSelectCandidate ? () => onSelectCandidate(c) : undefined}
          onRemove={() => state.remove(c.id)} onLocation={() => state.retryLocation(c.id)} onNearby={() => state.retryNearby(c.id)} onStats={() => state.retryStats(c.id)} />)}
      </div>
    </>}
    <details className="source-details"><summary>향후 종합지수 확장 계획</summary><CafeAssessment /></details>
    <details className="source-details"><summary>비교 자료의 출처와 한계</summary><div className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground">
      <p>경쟁 카페는 각 좌표의 반경 500m 자료이고 추정매출은 선택 분기의 행정동 집계입니다. 매출을 반경에 배분하지 않습니다. NULL·조회 행 없음(NO_ROW)·실제 0을 구분합니다.</p>
      <p>2025년 행정동 통계와 SEMAS 점포 자료는 시점·공간 단위가 다릅니다. 점포 snapshot은 UNVERIFIED이며 모든 후보 요청의 동일 원본 snapshot·기준일·완전성을 보장하지 않습니다. 같은 분기 코드가 원본 snapshot 동일성을 뜻하지 않으며 통계 snapshot/version metadata는 제공되지 않습니다.</p>
      <p>공간 판정은 각 요청의 current operational boundary 기준입니다. 버전·품질·과거 경계 호환성 한계를 후보별로 확인하세요. 비교 결과는 창업 성공·수익·추천 순위를 예측하지 않습니다. 점포 분류는 SEMAS I21201입니다.</p>
    </div></details>
  </section>
}
