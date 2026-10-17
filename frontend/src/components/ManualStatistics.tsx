import type { useLocationAnalysis } from '../hooks/useLocationAnalysis'
import type { ReactNode } from 'react'
import { AnalysisCharts } from './AnalysisCharts'
import { TrendResult } from './TrendResult'
import { Button } from './ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card'
import { Alert, AlertDescription } from './ui/alert'
import { NativeSelect } from './ui/native-select'
import { Field, FieldLabel } from './ui/field'

export function ManualStatistics({ state, scores, review }: { state: ReturnType<typeof useLocationAnalysis>; scores?: ReactNode; review?: ReactNode }) {
  const { lookups, lookupLoading, lookupError, stats, statsLoading, statsError, trend, trendLoading, trendError } = state
  const noLookups = lookups && (!lookups.adminDongs.length || !lookups.industries.some(i => i.code === 'CAFE') || !lookups.quarters.length)
  const resolvedDong = state.location.result?.adminDong.resolvedDong
  const linked = !lookupLoading && !lookupError && resolvedDong && state.selection.dongCode === resolvedDong.code
  const sourceDescription = state.mode === 'manual'
    ? '이 지역의 통계를 보고 있습니다. 분기를 바꾸면 자동으로 불러옵니다. 지도와 후보 비교의 분기는 바뀌지 않습니다.'
    : state.location.loading || lookupLoading ? '지도 위치와 통계 지원 목록을 확인하는 중입니다.'
      : lookupError ? '조회 조건 목록을 불러오지 못해 지도 위치의 통계 연결을 확인할 수 없습니다.'
        : linked ? `지도에서 확인한 ${resolvedDong.name}의 통계입니다. 분기를 바꾸면 자동으로 불러옵니다.`
          : '지도 상단에서 지역을 선택하거나 지도에서 구체적인 위치를 선택해 주세요.'
  return <div className="flex min-w-0 flex-col gap-4">
    <header className="flex flex-col gap-2"><h2 className="text-lg font-semibold">행정동 카페 통계</h2>
      <p className="text-sm text-muted-foreground">카페 업종의 행정동 전체 점포와 소비 흐름을 확인하세요. 선택 지점 반경 500m와 범위가 다릅니다.</p></header>
    <Card asChild><section aria-labelledby="search-title">
      <CardHeader><CardTitle id="search-title">조회 조건</CardTitle><CardDescription>{sourceDescription}</CardDescription></CardHeader>
      <CardContent>
        <Field><FieldLabel htmlFor="quarter">분기</FieldLabel><NativeSelect id="quarter" value={state.selection.quarterCode}
          disabled={lookupLoading || !!lookupError || !!noLookups} onChange={event => state.changeSelection('quarterCode', event.target.value)}>
          <option value="">분기를 선택하세요</option>{lookups?.quarters.map(q => <option key={q.code} value={q.code}>{q.label}</option>)}
        </NativeSelect></Field>
        <p className="mt-2 text-sm text-muted-foreground">분석 업종: 카페 · 지역을 바꾸려면 지도로 돌아가세요.</p>
        <Button type="button" variant="outline" className="mt-3" disabled={lookupLoading || !!lookupError || !!noLookups || !state.selection.dongCode || !state.selection.quarterCode || state.searchLoading}
          onClick={() => { void state.search() }}>{state.searchLoading ? '조회 중...' : '통계 다시 불러오기'}</Button>
        {lookupLoading && <p className="notice" role="status">조회 조건을 불러오는 중입니다.</p>}
        {lookupError && <Alert variant="destructive" className="mt-4"><AlertDescription><p>조회 조건을 불러오지 못했습니다. {lookupError.message}</p>
          <Button type="button" onClick={state.retryLookups}>다시 시도</Button></AlertDescription></Alert>}
        {noLookups && <p className="notice" role="status">현재 조회 가능한 조건이 없습니다.</p>}
      </CardContent>
    </section></Card>
    {review}
    {scores}
    <div aria-live="polite" aria-atomic="true">
      {statsLoading && <p className="notice" role="status">통계를 조회하는 중입니다.</p>}
      {!statsLoading && stats && <span className="visually-hidden">선택 분기 통계 조회가 완료되었습니다.</span>}
    </div>
    {statsError && <Alert variant="destructive"><AlertDescription>선택한 분기 통계를 조회하지 못했습니다. {statsError.message}</AlertDescription></Alert>}
    {(stats || trend) && <AnalysisCharts stats={stats} trend={trend} dongCode={state.selection.dongCode} quarter={state.selection.quarterCode} />}
    <div aria-live="polite" aria-atomic="true">
      {trendLoading && <p className="notice" role="status">4개 분기 추세를 조회하는 중입니다.</p>}
      {!trendLoading && trend && <span className="visually-hidden">추세 조회가 완료되었습니다.</span>}
    </div>
    {trendError && <Alert variant="destructive"><AlertDescription>4개 분기 추세를 조회하지 못했습니다. {trendError.message}</AlertDescription></Alert>}
    {trend && <TrendResult trend={trend} />}
    {!stats && !trend && !state.searchLoading && !statsError && !trendError && !lookupError && !noLookups && <p className="initial-message">
      {state.selection.dongCode && state.selection.quarterCode ? '통계를 아직 확인하지 못했습니다. 통계 다시 불러오기를 눌러 주세요.' : '지도에서 지역을 고르고 분석할 분기를 선택해 주세요.'}
    </p>}
  </div>
}
