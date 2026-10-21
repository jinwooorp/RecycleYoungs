import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KakaoMap, type MapCoordinate } from './components/KakaoMap'
import { LocationResult } from './components/LocationResult'
import { NearbyResult } from './components/NearbyResult'
import { CandidateComparison } from './components/CandidateComparison'
import { AppNavigation, type AppView } from './components/AppNavigation'
import { ManualStatistics } from './components/ManualStatistics'
import { ExploreWorkspace } from './components/ExploreWorkspace'
import { ComparisonDialog } from './components/ComparisonDialog'
import { CafeAssessment } from './components/CafeAssessment'
import { Dialog } from './components/ui/dialog'
import { useLocationAnalysis } from './hooks/useLocationAnalysis'
import { useCandidateComparison } from './hooks/useCandidateComparison'
import { Button } from './components/ui/button'
import { NativeSelect } from './components/ui/native-select'
import { RegionSelector } from './components/RegionSelector'
import { useRegions, useRegionBoundary } from './hooks/useRegions'
import { useConsumptionScores } from './hooks/useConsumptionScores'
import { useChangeScores } from './hooks/useChangeScores'
import { ConsumptionScoreCard } from './components/ConsumptionScoreCard'
import { ChangeScoreCard } from './components/ChangeScoreCard'
import { useAnalysisRoute } from './hooks/useAnalysisRoute'
import { useAnalysisStatistics } from './hooks/useAnalysisStatistics'
import seoulBoundary from './data/seoul-boundary.json'
import { RegionBoundaryInfo } from './components/DataProvenance'
import { allCafes, filterCafes, type CafeFilter } from './lib/cafeBrands'
import { buildCafeReview } from './lib/cafeReview'
import { CafeReviewSummary } from './components/CafeReviewSummary'
import { CafeReviewDetails } from './components/CafeReviewDetails'
import './App.css'

function App() {
  const [view, setView] = useState<AppView>('explore')
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [mapFocus, setMapFocus] = useState<{ coordinate: MapCoordinate; request: number } | null>(null)
  const [visibleStoreCount, setVisibleStoreCount] = useState(5)
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null)
  const [cafeFilter, setCafeFilter] = useState<CafeFilter>(allCafes)
  const [storeGroup, setStoreGroup] = useState<string[]>([])
  const state = useLocationAnalysis(), regions = useRegions(), route = useAnalysisRoute()
  const coordinate = state.location.coordinate
  const pointKey = coordinate ? `${coordinate.lat},${coordinate.lng}` : ''
  const orphanDetail = route.detail && !route.code && (!route.pointKey || route.pointKey !== pointKey)
  const activeCode = state.mode === 'location' ? state.location.result?.adminDong.resolvedDong?.code ?? '' : state.selection.dongCode
  const activeDong = regions.result?.districts.flatMap(d => d.dongs).find(d => d.code === activeCode)
  const boundaryVersion = state.mode === 'location' ? state.location.result?.adminDong.dataset.version ?? null : regions.result?.boundaryVersion ?? null
  const boundary = useRegionBoundary(activeCode, boundaryVersion)
  const [regionFit, setRegionFit] = useState<{ code: string; request: number } | null>(null)
  const scoreCode = route.detail ? route.code || (orphanDetail ? '' : activeCode) : activeCode
  const scoreQuarter = route.detail && route.quarterSpecified ? route.quarter : state.selection.quarterCode
  const scoreCodes = !route.error && state.lookups?.industries.some(i => i.code === 'CAFE') && state.lookups.quarters.some(q => q.code === scoreQuarter)
    && (regions.result?.districts.some(d => d.dongs.some(a => a.code === scoreCode)) || state.lookups.adminDongs.some(d => d.code === scoreCode)) ? [scoreCode] : []
  const scoreVersion = state.lookups?.quarters.find(q => q.code === scoreQuarter)?.metadata?.dataVersion
  const consumption = useConsumptionScores(scoreCodes, scoreQuarter, scoreVersion)
  const change = useChangeScores(scoreCodes, scoreQuarter, scoreVersion)
  const comparison = useCandidateComparison(state.lookups, state.lookupLoading, !!state.lookupError)
  const visibleStores = useMemo(() => filterCafes(state.nearby.result?.stores ?? [], cafeFilter), [state.nearby.result, cafeFilter])
  const region = state.location.loading ? '지역 확인 중' : state.location.error ? '지역 확인 실패'
    : state.location.result?.adminDong.resolvedDong?.name ?? activeDong?.name ?? (coordinate ? '행정동 미확정' : '지도에서 지역이나 위치를 선택하세요')
  const duplicate = !!coordinate && comparison.candidates.some(c => c.coordinate.lat === coordinate.lat && c.coordinate.lng === coordinate.lng)
  const limitReached = comparison.candidates.length >= 3
  const knownRoute = !route.code || !!regions.result?.districts.some(d => d.dongs.some(a => a.code === route.code)) || !!state.lookups?.adminDongs.some(d => d.code === route.code)
  const routeQuarterValid = !route.quarter || !!state.lookups?.quarters.some(q => q.code === route.quarter)
  const routeError = route.error ?? (state.lookupError ? '분석 조건 목록을 불러오지 못했습니다.'
    : regions.result && state.lookups && !knownRoute ? '조회 가능한 서울 행정동이 아닙니다.'
      : state.lookups && !routeQuarterValid ? '지원하지 않는 분기입니다.'
        : state.lookups && !knownRoute && regions.error ? '행정동 목록을 확인하지 못했습니다. 지역 목록을 다시 조회해 주세요.' : null)
  const separateDetail = route.detail && (orphanDetail || !!route.code && (route.code !== activeCode || scoreQuarter !== state.selection.quarterCode))
  const detailStatistics = useAnalysisStatistics(scoreCode, scoreQuarter, separateDetail && !routeError && knownRoute, state.lookups)
  const detailState = separateDetail ? { ...state, ...detailStatistics, mode: 'manual' as const, selection: { dongCode: scoreCode, quarterCode: scoreQuarter, industryCode: 'CAFE' } } : state
  const historicalBoundary = useRegionBoundary(route.detail && route.code !== activeCode ? scoreCode : '', regions.result?.boundaryVersion ?? null)
  const detailBoundary = separateDetail && route.code !== activeCode ? historicalBoundary : boundary
  const detailRegion = separateDetail ? state.lookups?.adminDongs.find(d => d.code === scoreCode)?.name ?? regions.result?.districts.flatMap(d => d.dongs).find(d => d.code === scoreCode)?.name ?? '행정동 미확정' : region
  const canonicalizeRoute = useEffectEvent(() => {
    if (route.detail && !routeError && !route.code && route.pointKey === pointKey && coordinate && /^11[0-9]{6}$/.test(activeCode))
      route.open(activeCode, state.selection.quarterCode, route.pointKey, true)
  })
  useEffect(() => { canonicalizeRoute() }, [route.detail, route.code, route.pointKey, routeError, activeCode, pointKey])
  const wasDetail = useRef(false)
  useLayoutEffect(() => {
    if (route.detail) document.getElementById('detail-title')?.focus()
    else if (wasDetail.current) document.getElementById('open-detail')?.focus()
    wasDetail.current = route.detail
  }, [route.detail])
  function navigate(next: AppView) {
    if (next === 'explore' && route.detail) route.close()
    setView(next)
  }
  function selectPoint(point: MapCoordinate) {
    setRegionFit(null); state.selectCoordinate(point); setPanelCollapsed(false); setVisibleStoreCount(5); setActiveStoreId(null); setStoreGroup([])
  }
  function focusPoint(point: MapCoordinate) {
    setMapFocus(current => ({ coordinate: point, request: (current?.request ?? 0) + 1 }))
  }
  const pointDetail = route.pointKey === pointKey && !!coordinate && (!route.code || activeCode === route.code)
  const nearby = <NearbyResult result={state.nearby.result} loading={state.nearby.loading} error={state.nearby.error}
    compact={!route.detail} unsupported={false} selected={!!coordinate} onRetry={state.retryNearby} visibleCount={visibleStoreCount}
    filter={cafeFilter} onFilterChange={filter => {
      setCafeFilter(filter); setVisibleStoreCount(5); setStoreGroup([])
      if (!filterCafes(state.nearby.result?.stores ?? [], filter).some(s => s.sourceStoreId === activeStoreId)) setActiveStoreId(null)
    }} groupIds={storeGroup} onGroupClose={() => setStoreGroup([])}
    onVisibleCountChange={setVisibleStoreCount} activeStoreId={activeStoreId} onSelectStore={store => {
      setActiveStoreId(store.sourceStoreId); setVisibleStoreCount(100); setStoreGroup([]); focusPoint(store.coordinate); if (route.detail) route.close()
    }} />
  const scoreEmpty = state.lookupLoading ? '분석 조건을 확인하는 중입니다.' : state.lookupError ? '조회 조건을 불러오지 못했습니다. 조건을 다시 조회해 주세요.'
    : !state.lookups?.industries.some(i => i.code === 'CAFE') ? '카페 분석을 지원하는 조회 조건이 없습니다.'
      : !scoreCode && coordinate ? '행정동이 확정되지 않아 점수를 연결할 수 없습니다.'
        : !scoreCode ? '지역과 분기를 선택해 보세요.' : !scoreQuarter ? '분석할 분기를 선택해 주세요.'
          : !scoreCodes.length ? '이 지역·분기의 점수 조회 조건을 확인해 주세요.' : undefined
  const scores = (compact: boolean) => <div className={compact ? 'panel-scores' : 'detail-scores'}>
    <ConsumptionScoreCard {...consumption} dongCode={scoreCode} onRetry={consumption.retry} compact={compact} emptyMessage={scoreEmpty} />
    <ChangeScoreCard {...change} dongCode={scoreCode} onRetry={change.retry} compact={compact} emptyMessage={scoreEmpty} />
  </div>
  const detailReady = !routeError && (!route.code || !!state.lookups && knownRoute)
  const review = buildCafeReview({ dongCode: scoreCode, quarterCode: scoreQuarter, consumption, change, unavailableReason: scoreEmpty,
    point: !route.detail || pointDetail ? coordinate : null, nearby: !state.nearby.loading && !state.nearby.error ? state.nearby.result : null })
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">본문으로 바로가기</a>
    <AppNavigation view={view === 'compare' || view === 'guide' ? view : 'explore'} count={comparison.candidates.length} onChange={navigate} />
    <main id="main-content" tabIndex={-1}>
      <div className="explore-surface" hidden={route.detail}>
      <h1 className="visually-hidden">서울 카페 창업 후보지 탐색</h1>
      <ExploreWorkspace summary={region} collapsed={panelCollapsed} onCollapsedChange={setPanelCollapsed}
        regionControl={<RegionSelector key={`${regions.result?.catalogVersion}:${activeCode}`} regions={regions.result} activeCode={activeCode}
          loading={regions.loading} error={regions.error} onRetry={regions.retry} onSelect={dong => {
            state.selectRegion(dong.code); setPanelCollapsed(false); setView('explore'); setActiveStoreId(null); setStoreGroup([])
            setRegionFit(current => ({ code: dong.code, request: (current?.request ?? 0) + 1 }))
          }} />}
        map={<KakaoMap selectedCoordinate={coordinate} onCoordinateChange={selectPoint} regionBoundary={boundary.result} regionFitRequest={regionFit}
          candidates={comparison.candidates} stores={visibleStores} focusRequest={mapFocus} activeStoreId={activeStoreId} activeGroupIds={storeGroup}
          onStoreSelect={id => { setActiveStoreId(id); setVisibleStoreCount(100); setStoreGroup([]); setPanelCollapsed(false) }}
          onStoreGroupSelect={ids => { setStoreGroup(ids); setPanelCollapsed(false); setVisibleStoreCount(100) }}
          onCandidateSelect={candidate => { selectPoint(candidate.coordinate); focusPoint(candidate.coordinate) }} />}
        panel={<section className="score-panel" aria-label="선택 지역 분석 요약">
          <div><p className="text-xs text-muted-foreground">{coordinate ? '선택 위치 · 반경 500m' : '선택 지역 · 행정동 전체'}</p><h2 className="mt-1 break-words text-xl font-semibold" aria-live="polite">{region}</h2></div>
          <div className="panel-quarter-row"><label className="text-sm" htmlFor="panel-quarter">분석 분기</label><NativeSelect id="panel-quarter" value={state.selection.quarterCode} disabled={state.lookupLoading || !!state.lookupError}
            onChange={e => state.changeSelection('quarterCode', e.target.value)}><option value="">분기를 선택하세요</option>{state.lookups?.quarters.map(q => <option key={q.code} value={q.code}>{q.label}</option>)}</NativeSelect></div>
          <CafeReviewSummary review={review} />
          {scores(true)}
          <p className="text-xs text-muted-foreground">행정동 전체의 상대 점수이며 창업 성공률이 아닙니다.</p>
          <div className="panel-actions"><Button id="open-detail" disabled={!activeCode && !coordinate} onClick={() => route.open(activeCode, state.selection.quarterCode, pointKey || false)}>상세 분석 보기</Button>
          <Button variant="outline" disabled={!coordinate || duplicate || limitReached} onClick={() => { if (coordinate) comparison.add(coordinate) }}>후보지에 추가</Button>
          </div>
          <p className="text-xs text-muted-foreground" role="status">{limitReached ? '최대 3곳까지 등록할 수 있습니다. 상단 후보 비교에서 삭제해 주세요.' : duplicate ? '선택한 위치가 이미 후보에 등록돼 있습니다.' : !coordinate ? '후보 추가는 지도에서 구체적인 위치를 선택해 주세요.' : '담은 후보는 상단 후보 비교에서 확인하세요.'}</p>
          {state.lookupError && <div role="alert"><p>조회 조건을 불러오지 못했습니다.</p><Button variant="outline" onClick={state.retryLookups}>조회 조건 다시 시도</Button></div>}
          {state.location.error && <p role="status">지역 확인 실패. 상세 분석에서 다시 시도할 수 있습니다.</p>}
          {state.location.result?.adminDong.status === 'AMBIGUOUS_BOUNDARY' && <p role="status" className="text-sm">행정동 경계가 겹쳐 점수를 연결하지 않습니다. 상세 분석에서 판정 근거를 확인하세요.</p>}
          {state.location.result?.adminDong.status === 'OUTSIDE_OR_UNSUPPORTED' && <p role="status" className="text-sm">행정동이 확정되지 않아 점수를 연결하지 않습니다. 주변 카페는 아래 목록에서 별도로 확인하세요.</p>}
          {boundary.error && <div role="status"><p className="text-sm">경계 표시 불가: {boundary.error}</p><Button variant="outline" onClick={() => { boundary.retry(); regions.retry() }}>경계 다시 조회</Button></div>}
          {!route.detail && nearby}
        </section>} />
      </div>
      {route.detail && <article className="analysis-detail">
        <div className="detail-inner"><Button variant="outline" onClick={route.close}>지도로 돌아가기</Button>
          <header className="my-5"><p className="text-sm text-muted-foreground">서울 · 카페 · 행정동 상세 분석</p><h1 id="detail-title" tabIndex={-1} className="mt-2 text-2xl font-semibold">{routeError ? '상세 분석을 확인해 주세요' : detailRegion}</h1><p className="mt-2 text-sm">점수는 창업 환경을 살펴보는 참고 지표입니다. 성공·수익을 예측하거나 보장하지 않습니다.</p></header>
          {routeError ? <div role="alert"><p>{routeError}</p>{state.lookupError && <Button variant="outline" onClick={state.retryLookups}>조회 조건 다시 시도</Button>}{regions.error && <Button variant="outline" onClick={regions.retry}>지역 목록 다시 조회</Button>}</div> : !detailReady ? <p role="status">상세 분석 조건을 확인하는 중입니다.</p> : <>
            <ManualStatistics review={<CafeReviewDetails review={review} />} scores={scoreCode && scores(false)} state={{ ...detailState, changeSelection: (key, value) => {
                if (key === 'quarterCode') route.open(scoreCode, value, pointDetail ? pointKey : false, true)
              } }} />
            {!scoreCode && <p role="status">행정동이 확정되지 않아 통계와 점수를 연결하지 않습니다.</p>}
            {!pointDetail && <p className="my-5 text-sm text-muted-foreground">행정동 전체 분석입니다. 주변 카페와 후보 추가는 지도에서 구체적인 위치를 선택해 주세요.</p>}
            {detailBoundary.result && <RegionBoundaryInfo boundary={detailBoundary.result} />}
          </>}
          {pointDetail && !route.error && <section className="mt-6 flex flex-col gap-4" aria-label="선택 위치 상세">
              <LocationResult result={state.location.result} loading={state.location.loading} error={state.location.error} lookupLoading={state.lookupLoading} lookupError={!!state.lookupError}
                linked={!!state.location.result?.adminDong.resolvedDong && state.selection.dongCode === state.location.result.adminDong.resolvedDong.code} manual={state.mode === 'manual'} onRetry={state.retryLocation} />
              {nearby}
            </section>}
        </div>
      </article>}
    </main>
    <ComparisonDialog open={view === 'compare'} onClose={() => setView('explore')}>
      <CandidateComparison state={comparison} lookups={state.lookups} lookupLoading={state.lookupLoading} lookupError={!!state.lookupError} onRetryLookups={state.retryLookups} onExplore={() => navigate('explore')}
        onSelectCandidate={candidate => { selectPoint(candidate.coordinate); focusPoint(candidate.coordinate); navigate('explore') }} />
    </ComparisonDialog>
    <Dialog open={view === 'guide'} onClose={() => setView('explore')} labelledBy="data-guide-title" closeLabel="안내 닫기">
      <div className="flex flex-col gap-5"><h2 id="data-guide-title" className="text-2xl font-semibold">데이터 안내</h2>
        <p>서울시 행정동 통계와 소상공인시장진흥공단 점포 자료로 카페 창업 환경을 비교합니다.</p>
        <p className="text-sm text-muted-foreground">주변 카페는 선택한 지점에서 500m 안의 수집된 점포 목록입니다. 점수와 매출은 선택한 분기의 행정동 전체 통계입니다. 두 자료는 작성 시기와 지역 범위가 다릅니다. 자료의 기준일과 빠진 점포가 없는지, 지도와 과거 통계의 지역 구분이 같은지는 확인 전입니다.</p>
        <section className="flex flex-col gap-2 text-sm"><h3 className="font-semibold">현재 제공하는 점수</h3><p>소비규모는 거래가 얼마나 많은 편인지, 소비증감은 지난 분기와 비교한 변화가 어느 정도인지 보여줍니다. 높은 점수가 창업 성공이나 수익을 보장하지 않습니다.</p></section>
        <section aria-labelledby="keyboard-guide"><h3 id="keyboard-guide" className="font-semibold">지도 사용법·키보드 조작</h3><p className="mt-2 text-sm">Tab으로 지도에 초점을 맞춘 뒤 방향키로 지도를 이동하고, Enter로 지도 중심을 후보 위치로 선택하세요. 지도 클릭으로도 선택할 수 있습니다. 선택 위치로 이동 버튼은 이미 선택한 지점으로 돌아갑니다. 지도 위 지역 선택기로 자치구와 행정동을 찾을 수 있습니다.</p></section>
        <details className="source-details"><summary>자료 출처</summary><div className="mt-2 flex flex-col gap-2 text-sm">
          <a className="underline" href="https://data.seoul.go.kr/dataList/OA-22172/S/1/datasetView.do" target="_blank" rel="noreferrer">서울시 점포 통계 · 행정동</a>
          <a className="underline" href="https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do" target="_blank" rel="noreferrer">서울시 추정매출 · 행정동</a>
          <p>주변 점포: SEMAS I21201. 분류에 따라 다른 음료 업태가 포함될 수 있습니다.</p>
          <a className="underline" href={regions.result?.sourceUrl ?? 'https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do'} target="_blank" rel="noreferrer">서울 행정동 목록·경계 출처 · OA-22160</a>
          <a className="underline" href={seoulBoundary.properties.sourceUrl} target="_blank" rel="noreferrer">서울 외곽선 출처 · OA-22162</a><p>서울특별시·서울신용보증재단, 공공누리 제1유형. 공식 2023-10-31 파일의 표시용 경계(50m 단순화)이며 기준일은 미검증입니다.</p>
        </div></details>
        <details className="source-details"><summary>앞으로 추가할 평가는 무엇인가요?</summary>{view === 'guide' && <CafeAssessment />}</details>
      </div>
    </Dialog>
  </div>
}
export default App
