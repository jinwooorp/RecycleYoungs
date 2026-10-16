import type { useLocationAnalysis } from '../hooks/useLocationAnalysis'
import { SearchForm } from './SearchForm'
import { StatsResult } from './StatsResult'
import { TrendResult } from './TrendResult'
import { Button } from './ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card'
import { Alert, AlertDescription } from './ui/alert'

export function ManualStatistics({ state }: { state: ReturnType<typeof useLocationAnalysis> }) {
  const { lookups, lookupLoading, lookupError, stats, statsLoading, statsError, trend, trendLoading, trendError } = state
  const noLookups = lookups && (!lookups.adminDongs.length || !lookups.industries.some(i => i.code === 'CAFE') || !lookups.quarters.length)
  const resolvedDong = state.location.result?.adminDong.resolvedDong
  const linked = !lookupLoading && !lookupError && resolvedDong && state.selection.dongCode === resolvedDong.code
  const sourceDescription = state.mode === 'manual'
    ? '직접 선택한 행정동을 사용합니다. 후보 비교의 공통 조건과는 별개입니다.'
    : state.location.loading || lookupLoading ? '지도 위치와 통계 지원 목록을 확인하는 중입니다.'
      : lookupError ? '조회 조건 목록을 불러오지 못해 지도 위치의 통계 연결을 확인할 수 없습니다.'
        : linked ? `지도에서 판정한 ${resolvedDong.name}이 반영됐습니다. 분기를 선택해 주세요.`
          : '지도 위치의 행정동 통계를 연결할 수 없습니다. 지원 목록에서 직접 선택해 주세요.'
  return <div className="flex min-w-0 flex-col gap-4">
    <header className="flex flex-col gap-2"><h2 className="text-lg font-semibold">행정동 통계 직접 조회</h2>
      <p className="text-sm text-muted-foreground">카페 업종의 행정동 전체 점포와 소비 흐름을 확인하세요. 선택 지점 반경 500m와 범위가 다릅니다.</p></header>
    <Card asChild><section aria-labelledby="search-title">
      <CardHeader><CardTitle id="search-title">조회 조건</CardTitle><CardDescription>{sourceDescription}</CardDescription></CardHeader>
      <CardContent>
        <SearchForm lookups={lookups} selection={state.selection} disabled={lookupLoading || !!lookupError || !!noLookups}
          loading={state.searchLoading} onChange={state.changeSelection} onSearch={() => { void state.search() }} />
        {lookupLoading && <p className="notice" role="status">조회 조건을 불러오는 중입니다.</p>}
        {lookupError && <Alert variant="destructive" className="mt-4"><AlertDescription><p>조회 조건을 불러오지 못했습니다. {lookupError.message}</p>
          <Button type="button" onClick={state.retryLookups}>다시 시도</Button></AlertDescription></Alert>}
        {noLookups && <p className="notice" role="status">현재 조회 가능한 조건이 없습니다.</p>}
      </CardContent>
    </section></Card>
    <div aria-live="polite" aria-atomic="true">
      {statsLoading && <p className="notice" role="status">통계를 조회하는 중입니다.</p>}
      {!statsLoading && stats && <span className="visually-hidden">선택 분기 통계 조회가 완료되었습니다.</span>}
    </div>
    {statsError && <Alert variant="destructive"><AlertDescription>선택한 분기 통계를 조회하지 못했습니다. {statsError.message}</AlertDescription></Alert>}
    {stats && <StatsResult stats={stats} />}
    <div aria-live="polite" aria-atomic="true">
      {trendLoading && <p className="notice" role="status">4개 분기 추세를 조회하는 중입니다.</p>}
      {!trendLoading && trend && <span className="visually-hidden">추세 조회가 완료되었습니다.</span>}
    </div>
    {trendError && <Alert variant="destructive"><AlertDescription>4개 분기 추세를 조회하지 못했습니다. {trendError.message}</AlertDescription></Alert>}
    {trend && <TrendResult trend={trend} />}
    {!stats && !trend && !state.searchLoading && !statsError && !trendError && !lookupError && !noLookups && <p className="initial-message">
      {state.selection.dongCode && state.selection.quarterCode ? '조회하기를 눌러 통계를 확인하세요.' : '행정동과 분기를 선택한 후 조회하기를 눌러 주세요.'}
    </p>}
  </div>
}
