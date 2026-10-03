import { SearchForm } from './components/SearchForm'
import { StatsResult } from './components/StatsResult'
import { useAdminDongStats } from './hooks/useAdminDongStats'
import './App.css'

function App() {
  const state = useAdminDongStats()
  const { lookups, lookupLoading, lookupError, stats, statsLoading, statsError } = state
  const noLookups = lookups && (!lookups.adminDongs.length || !lookups.industries.length || !lookups.quarters.length)
  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">RecycleYoungs · 서울 행정동 통계</p>
        <h1>행정동의 점포와 추정매출 살펴보기</h1>
        <p>행정동·업종·분기를 선택해 같은 조건의 통계를 확인하세요.</p>
      </header>
      <section className="search-section" aria-labelledby="search-title">
        <h2 id="search-title">조회 조건</h2>
        <SearchForm lookups={lookups} selection={state.selection} disabled={lookupLoading || !!lookupError || !!noLookups}
          loading={statsLoading} onChange={state.changeSelection} onSearch={() => { void state.search() }} />
        {lookupLoading && <p className="notice" role="status">조회 조건을 불러오는 중입니다.</p>}
        {lookupError && <div className="error-message" role="alert">
          <p>조회 조건을 불러오지 못했습니다. {lookupError.message}</p>
          <button type="button" onClick={state.retryLookups}>다시 시도</button>
        </div>}
        {noLookups && <p className="notice" role="status">현재 조회 가능한 조건이 없습니다.</p>}
      </section>
      <div className="result-status" aria-live="polite" aria-atomic="true">
        {statsLoading && <p className="notice" role="status">통계를 조회하는 중입니다.</p>}
        {!statsLoading && stats && <span className="visually-hidden">조회가 완료되었습니다.</span>}
      </div>
      {statsError && <div className="error-message" role="alert"><p>통계를 조회하지 못했습니다. {statsError.message}</p></div>}
      {stats && <StatsResult stats={stats} />}
      {!stats && !statsLoading && !statsError && !lookupError && !noLookups && <p className="initial-message">세 조건을 선택한 후 조회하기를 눌러 주세요.</p>}
    </main>
  )
}

export default App
