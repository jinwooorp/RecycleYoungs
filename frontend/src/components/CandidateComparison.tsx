import type { Lookups } from '../types/api'
import { useState } from 'react'
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
import { useConsumptionScores } from '../hooks/useConsumptionScores'
import { ConsumptionScoreCard } from './ConsumptionScoreCard'
import { useChangeScores } from '../hooks/useChangeScores'
import { ChangeScoreCard } from './ChangeScoreCard'
import { DataIdentifiers } from './DataProvenance'
import type { Candidate } from '../types/comparison'
import { PublicationInfo } from './PublicationInfo'
import { validQuarterCode, samePublication } from '../lib/publication'
import { ApiFailure } from '../api/adminDongApi'
import { useAdminDongContext } from '../hooks/useAdminDongContext'
import { AdminDongContextPanel } from './AdminDongContextPanel'

export function CandidateComparison({ state, lookups, lookupLoading, lookupError, onRetryLookups, onExplore, onSelectCandidate }: {
  state: ReturnType<typeof useCandidateComparison>; lookups: Lookups | null; lookupLoading: boolean
  lookupError: boolean; onRetryLookups: () => void; onExplore: () => void
  onSelectCandidate?: (candidate: Candidate) => void
}) {
  const locations = state.candidates.flatMap(c => c.location.result ? [c.location.result] : [])
  const scoreCodes = state.candidates.filter(c => !state.statsBlockReason(c)).map(c => c.location.result!.adminDong.resolvedDong!.code)
  const codeKey = [...new Set(scoreCodes)].sort().join(',')
  const [applied, setApplied] = useState('')
  const metadata = lookups?.quarters.find(q => q.code === state.quarter)?.metadata
  const queryKey = `${state.quarter}:${metadata?.dataVersion ?? ''}:${codeKey}:${state.comparisonRevision}`
  const submitted = applied === queryKey
  const consumption = useConsumptionScores(submitted ? scoreCodes : [], state.quarter, metadata?.dataVersion)
  const change = useChangeScores(submitted ? scoreCodes : [], state.quarter, metadata?.dataVersion)
  const context = useAdminDongContext(submitted ? scoreCodes : [], state.quarter, metadata?.dataVersion)
  const comparableCandidates = state.candidates.map(c => ({ ...c,
    stats: c.stats.result && !samePublication(c.stats.result.metadata, metadata)
      ? { result: null, error: null, loading: false } : c.stats,
    nearby: metadata && c.nearby.result && !samePublication(c.nearby.result.data.metadata, metadata)
      ? { result: null, error: new ApiFailure('response', { code: 'DATA_VERSION_CHANGED',
        message: '공개 자료 버전이 다릅니다. 조회 조건과 주변 카페 자료를 다시 불러와 주세요.', field: null }), loading: false } : c.nearby,
  }))
  const analyze = () => {
    state.queryStats(); setApplied(queryKey)
    consumption.retry(); change.retry(); context.retry()
  }
  const versionMismatch = new Set(locations.map(l => l.adminDong.dataset.version)).size > 1
    || new Set(locations.map(l => l.commercialArea.dataset.version)).size > 1
  const resolvedCodes = locations.flatMap(l => l.adminDong.resolvedDong ? [l.adminDong.resolvedDong.code] : [])
  const sameDong = new Set(resolvedCodes).size < resolvedCodes.length
  const eligible = state.candidates.some(c => !state.statsBlockReason(c))
  const nearbyVersions = state.candidates.flatMap(c => c.nearby.result ? [c.nearby.result.data.metadata?.dataVersion ?? 'legacy-unversioned'] : [])
  const nearbyVersionMismatch = new Set(nearbyVersions).size > 1
    || !!metadata && nearbyVersions.some(v => v !== metadata.dataVersion)
  const completeNearby = !nearbyVersionMismatch && state.candidates.length > 1 && state.candidates.every(c => c.nearby.result && !c.nearby.loading && !c.nearby.error)
  const counts = completeNearby ? state.candidates.map(c => BigInt(c.nearby.result!.totalCount)) : []
  const spread = counts.length ? counts.reduce((a, b) => a > b ? a : b) - counts.reduce((a, b) => a < b ? a : b) : null
  return <section aria-labelledby="comparison-title" className="flex min-w-0 flex-col gap-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2"><h1 id="comparison-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">창업 후보지 비교</h1>
        <p className="text-muted-foreground">후보별 소비 신호와 추가 확인사항을 비교해 다음에 살펴볼 위치를 골라보세요.</p>
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
              {lookups?.quarters.filter(q => validQuarterCode(q.code)).map(q => <option key={q.code} value={q.code}>{q.label}</option>)}
            </NativeSelect></Field>
            <Button type="button" disabled={!eligible || state.candidates.some(c => c.stats.loading)} onClick={analyze}>같은 분기로 후보 분석</Button>
            <Button type="button" variant="outline" disabled={lookupLoading} onClick={onRetryLookups}>비교 조회 조건 새로 불러오기</Button>
          </div>
          <p className="text-sm text-muted-foreground">주변 카페 수와 같은 분기의 행정동 전체 통계를 비교합니다. 분기를 바꾸면 이전 통계를 지웁니다. 개인 점포의 예상 매출은 아닙니다.</p>
          {lookupLoading && <p role="status">비교용 조회 조건을 확인하는 중입니다.</p>}
          {lookupError && <Alert variant="destructive"><AlertDescription><p>조회 조건 오류로 비교 통계를 연결할 수 없습니다. 지역·카페 결과는 유지합니다.</p>
            <Button type="button" variant="outline" onClick={onRetryLookups}>비교 조회 조건 다시 불러오기</Button></AlertDescription></Alert>}
          {!lookupLoading && !lookupError && !lookups?.industries.some(i => i.code === 'CAFE') && <p>현재 조회 조건에서 CAFE 통계를 지원하지 않습니다.</p>}
        </div></CardContent>
      </Card>
      {!submitted && <p role="status" className="text-sm">분기를 정한 뒤 ‘같은 분기로 후보 분석’을 누르면 점수와 통계를 함께 불러옵니다.</p>}
      <PublicationInfo metadata={metadata} />
      {submitted && <section aria-label="후보별 행정동 참고 자료" className="flex flex-col gap-3">
        <h3 className="font-semibold">같은 분기의 지역 참고 자료</h3><p className="text-sm text-muted-foreground">같은 행정동의 후보는 아래 한 자료를 공유합니다. 서로 다른 인구 자료를 합산하거나 점수로 순위를 매기지 않습니다.</p>
        <div className="grid items-start gap-4 lg:grid-cols-3">{[...new Set(scoreCodes)].map(code => <AdminDongContextPanel key={code} result={context.results[code]} loading={context.loading && !context.results[code] && !context.errors[code]} error={context.errors[code]} onRetry={context.retry} />)}</div>
      </section>}
      <CandidateComparisonTable candidates={comparableCandidates} quarter={state.quarter} blockReason={state.statsBlockReason} consumption={consumption.result} scoreLoading={consumption.loading} scoreError={consumption.error} change={change.result} changeLoading={change.loading} changeError={change.error} quarters={lookups?.quarters} />
      {state.candidates.length === 1 && <p className="text-sm">다른 후보를 추가하면 소비 흐름과 주변 카페 수의 차이를 함께 확인할 수 있습니다.</p>}
      <details className="source-details"><summary>전체 통계 비교</summary><CandidateComparisonTable detailed candidates={comparableCandidates} quarter={state.quarter} blockReason={state.statsBlockReason} consumption={consumption.result} scoreLoading={consumption.loading} scoreError={consumption.error} change={change.result} changeLoading={change.loading} changeError={change.error} quarters={lookups?.quarters} /></details>
      <details className="source-details"><summary>동별 점수 산정 근거</summary>
        {submitted && <div className="grid gap-4 lg:grid-cols-3">{[...new Set(scoreCodes)].map(code => <div key={code} className="flex flex-col gap-3"><ConsumptionScoreCard {...consumption} dongCode={code} onRetry={consumption.retry} /><ChangeScoreCard {...change} dongCode={code} onRetry={change.retry} quarters={lookups?.quarters} onQuarterChange={state.changeQuarter} /></div>)}</div>}
      </details>
      {versionMismatch && <Alert variant="warning" role="status"><AlertDescription>후보마다 지역을 확인한 지도 자료의 버전이 다릅니다. 같은 경계로 비교한 결과가 아닐 수 있으므로 후보의 지역 정보를 다시 불러와 주세요.</AlertDescription></Alert>}
      {sameDong && <Alert role="status"><AlertDescription>같은 행정동에 속한 후보가 있습니다. 통계는 동일 행정동의 집계값이며 좌표별 독립 통계가 아닙니다. 합산하지 않습니다.</AlertDescription></Alert>}
      {nearbyVersionMismatch && <Alert variant="warning" role="status"><AlertDescription>후보의 점포 자료 공개 버전이 달라 카페 수 차이를 비교하지 않습니다. 비교 조회 조건을 새로 불러오고 후보별 주변 카페 자료를 다시 조회해 주세요.</AlertDescription></Alert>}
      {spread !== null && <Alert role="note"><AlertDescription>
        <p>조회 자료상 후보 간 반경 500m 카페 수 차이는 {spread.toLocaleString('ko-KR')}개입니다.</p>
        <p>점포가 적다는 이유만으로 유리한 입지는 아닙니다. 수요·임대료와 함께 확인해야 하며, 후보 자료의 동일 기준일·완전성은 미검증입니다.</p>
      </AlertDescription></Alert>}
      <Alert role="note"><AlertDescription>반경 500m 카페 수와 행정동 통계는 시점·공간 단위가 다릅니다. 점포의 원본 기준일·완전성은 미검증이며, 추정매출은 수익이나 창업 성공률이 아닙니다.</AlertDescription></Alert>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {comparableCandidates.map(c => <CandidateCard key={c.id} candidate={c} quarter={state.quarter} block={state.statsBlockReason(c)}
          onMap={onSelectCandidate ? () => onSelectCandidate(c) : undefined}
          onRemove={() => state.remove(c.id)} onLocation={() => state.retryLocation(c.id)} onNearby={() => state.retryNearby(c.id)} onStats={() => state.retryStats(c.id)} />)}
      </div>
    </>}
    <details className="source-details"><summary>비교 자료의 출처와 한계</summary><div className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground">
      <p>주변 카페는 선택한 지점에서 직선거리 500m 안의 목록입니다. 추정매출과 점수는 행정동 전체의 값입니다. 행정동 매출을 반경 500m의 매출로 나누어 계산하지 않습니다.</p>
      <p>‘값이 제공되지 않음’, ‘해당 지역·분기의 집계 자료가 없음’, ‘실제 0으로 집계됨’은 서로 다릅니다. 자료가 없다고 카페나 거래가 없다고 단정하지 않습니다.</p>
      <p>선택 분기의 행정동 통계와 수집해 둔 점포 목록은 시기와 지역 범위가 다릅니다. 점포 자료의 실제 관측일과 빠진 가게가 없는지는 확인 전입니다. 같은 분기를 골라도 모든 후보가 정확히 같은 시점의 원자료로 계산됐다고 보장하지 않습니다. 공개 버전이 같아도 원천별 관측 시점까지 같다는 뜻은 아닙니다.</p>
      <p>각 후보의 지역은 조회할 때 사용 가능한 지도 경계로 확인합니다. 그 경계가 과거 통계의 지역 구분과 일치하는지도 확인 전입니다. 비교 결과가 창업 성공·수익·추천 순위를 예측하지는 않습니다.</p>
      <DataIdentifiers><p>점포 원천 snapshot 확인 상태: UNVERIFIED · 분류: SEMAS I21201. 공개 버전은 수집·검증 묶음이며 원천의 동일 시점 보증과 구분합니다.</p></DataIdentifiers>
    </div></details>
  </section>
}
