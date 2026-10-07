import { SearchForm } from './components/SearchForm'
import { StatsResult } from './components/StatsResult'
import { TrendResult } from './components/TrendResult'
import { useAdminDongStats } from './hooks/useAdminDongStats'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import './App.css'

function App() {
  const state = useAdminDongStats()
  const { lookups, lookupLoading, lookupError, stats, statsLoading, statsError, trend, trendLoading, trendError } = state
  const noLookups = lookups && (!lookups.adminDongs.length || !lookups.industries.length || !lookups.quarters.length)
  return (
    <main className="mx-auto max-w-[1120px] px-4 py-7 min-[761px]:px-6 min-[761px]:py-12">
      <header className="page-header">
        <p className="eyebrow">RecycleYoungs · 서울 행정동 통계</p>
        <h1>행정동의 점포와 추정매출 살펴보기</h1>
        <p>행정동·업종·분기를 선택해 같은 조건의 통계를 확인하세요.</p>
      </header>
      <Card asChild className="gap-0 rounded-lg p-5 min-[761px]:p-6">
        <section aria-labelledby="search-title">
          <h2 id="search-title">조회 조건</h2>
          <SearchForm lookups={lookups} selection={state.selection} disabled={lookupLoading || !!lookupError || !!noLookups}
            loading={state.searchLoading} onChange={state.changeSelection} onSearch={() => { void state.search() }} />
          {lookupLoading && <p className="notice" role="status">조회 조건을 불러오는 중입니다.</p>}
          {lookupError && <div className="error-message" role="alert">
            <p>조회 조건을 불러오지 못했습니다. {lookupError.message}</p>
            <Button type="button" onClick={state.retryLookups}>다시 시도</Button>
          </div>}
          {noLookups && <p className="notice" role="status">현재 조회 가능한 조건이 없습니다.</p>}
        </section>
      </Card>
      <div className="result-status" aria-live="polite" aria-atomic="true">
        {statsLoading && <p className="notice" role="status">통계를 조회하는 중입니다.</p>}
        {!statsLoading && stats && <span className="visually-hidden">선택 분기 통계 조회가 완료되었습니다.</span>}
      </div>
      {statsError && <div className="error-message" role="alert"><p>선택한 분기 통계를 조회하지 못했습니다. {statsError.message}</p></div>}
      {stats && <StatsResult stats={stats} />}
      <div className="result-status" aria-live="polite" aria-atomic="true">
        {trendLoading && <p className="notice" role="status">4개 분기 추세를 조회하는 중입니다.</p>}
        {!trendLoading && trend && <span className="visually-hidden">추세 조회가 완료되었습니다.</span>}
      </div>
      {trendError && <div className="error-message" role="alert"><p>4개 분기 추세를 조회하지 못했습니다. {trendError.message}</p></div>}
      {trend && <TrendResult trend={trend} />}
      {!stats && !trend && !state.searchLoading && !statsError && !trendError && !lookupError && !noLookups && <p className="initial-message">세 조건을 선택한 후 조회하기를 눌러 주세요.</p>}
    </main>
  )
}

export default App
