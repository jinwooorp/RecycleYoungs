import { useMemo, useState } from 'react'
import { KakaoMap, type MapCoordinate } from './components/KakaoMap'
import { LocationResult } from './components/LocationResult'
import { NearbyResult } from './components/NearbyResult'
import { CandidateComparison } from './components/CandidateComparison'
import { AppNavigation, type AppView } from './components/AppNavigation'
import { CandidateTray } from './components/CandidateTray'
import { ManualStatistics } from './components/ManualStatistics'
import { ExploreWorkspace } from './components/ExploreWorkspace'
import { AnalysisPanel, type PanelTab } from './components/AnalysisPanel'
import { ComparisonDialog } from './components/ComparisonDialog'
import { CafeAssessment } from './components/CafeAssessment'
import { Dialog } from './components/ui/dialog'
import { useLocationAnalysis } from './hooks/useLocationAnalysis'
import { useCandidateComparison } from './hooks/useCandidateComparison'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import './App.css'

function App() {
  const [view, setView] = useState<AppView>('explore')
  const [tab, setTab] = useState<PanelTab>('overview')
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [mapFocus, setMapFocus] = useState<{ coordinate: MapCoordinate; request: number } | null>(null)
  const [visibleStoreCount, setVisibleStoreCount] = useState(5)
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null)
  const state = useLocationAnalysis()
  const comparison = useCandidateComparison(state.lookups, state.lookupLoading, !!state.lookupError)
  const coordinate = state.location.coordinate
  const visibleStores = useMemo(() => state.nearby.result?.stores.slice(0, visibleStoreCount) ?? [], [state.nearby.result, visibleStoreCount])
  const region = state.location.loading ? '지역 확인 중' : state.location.error ? '지역 확인 실패'
    : state.location.result?.adminDong.resolvedDong?.name ?? (coordinate ? '행정동 미확정' : '지도에서 위치를 선택하세요')
  const duplicate = !!coordinate && comparison.candidates.some(candidate => candidate.coordinate.lat === coordinate.lat && candidate.coordinate.lng === coordinate.lng)
  const limitReached = comparison.candidates.length >= 3
  function navigate(next: AppView) {
    setView(next)
    if (next === 'statistics') { setTab('statistics'); setPanelCollapsed(false) }
    if (next === 'explore') { setTab('overview'); setPanelCollapsed(false) }
  }
  function selectPoint(point: MapCoordinate) {
    state.selectCoordinate(point)
    setPanelCollapsed(false)
    setVisibleStoreCount(5)
    setActiveStoreId(null)
  }
  function focusPoint(point: MapCoordinate) {
    setMapFocus(current => ({ coordinate: point, request: (current?.request ?? 0) + 1 }))
  }
  const nearby = <NearbyResult result={state.nearby.result} loading={state.nearby.loading} error={state.nearby.error}
    compact={tab === 'overview'}
    unsupported={false} selected={!!coordinate} onRetry={state.retryNearby} visibleCount={visibleStoreCount}
    onVisibleCountChange={setVisibleStoreCount} activeStoreId={activeStoreId} onSelectStore={store => {
      setActiveStoreId(store.sourceStoreId)
      focusPoint(store.coordinate)
    }} />
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">본문으로 바로가기</a>
    <AppNavigation view={view === 'compare' || view === 'guide' ? view : tab === 'statistics' ? 'statistics' : 'explore'}
      count={comparison.candidates.length} onChange={navigate} />
    <main id="main-content" tabIndex={-1}>
      <h1 className="visually-hidden">서울 카페 창업 후보지 탐색</h1>
      <ExploreWorkspace summary={region} collapsed={panelCollapsed} onCollapsedChange={setPanelCollapsed} map={<KakaoMap selectedCoordinate={coordinate} onCoordinateChange={selectPoint}
        candidates={comparison.candidates} stores={visibleStores}
        focusRequest={mapFocus} activeStoreId={activeStoreId} onStoreSelect={id => { setActiveStoreId(id); setTab('nearby'); setPanelCollapsed(false) }}
        onCandidateSelect={candidate => { selectPoint(candidate.coordinate); focusPoint(candidate.coordinate); setTab('overview') }} />}
        panel={<AnalysisPanel tab={tab} onTabChange={setTab} selectionKey={coordinate ? `${coordinate.lat},${coordinate.lng}` : ''}
          header={<section aria-labelledby="selected-location-title" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:block">
            <div className="hidden items-center justify-between gap-2 lg:flex"><h2 id="selected-location-title" className="text-sm font-medium">선택 위치 요약</h2><Badge variant="secondary">카페 · 500m</Badge></div>
            <p className="min-w-0 text-base font-semibold lg:mt-2 lg:text-xl" aria-live="polite">{region}</p>
            <div className="flex flex-col gap-2 lg:mt-3"><Button type="button" disabled={!coordinate || duplicate || limitReached}
              onClick={() => { if (coordinate) comparison.add(coordinate) }}>후보지에 추가</Button></div>
            <p className="mt-2 hidden text-xs text-muted-foreground lg:block" role="status">{limitReached
              ? '최대 3곳까지 등록할 수 있습니다. 후보를 삭제하면 새 위치를 추가할 수 있습니다.'
              : duplicate ? '선택한 위치가 이미 후보에 등록돼 있습니다.' : coordinate ? '새 위치를 탐색해도 담은 후보는 유지됩니다.' : '먼저 지도에서 위치를 선택해 주세요.'}</p>
          </section>}
          overview={<>
            {!coordinate && <Empty><EmptyTitle>어느 동네에 카페를 열까요?</EmptyTitle><EmptyDescription>지도를 클릭하거나 지도 중심을 선택하면 주변 카페와 행정동을 확인할 수 있습니다.</EmptyDescription></Empty>}
            {coordinate && <div className="flex flex-col gap-4">
              {tab === 'overview' && nearby}
              <LocationResult result={state.location.result} loading={state.location.loading} error={state.location.error}
                lookupLoading={state.lookupLoading} lookupError={!!state.lookupError}
                linked={!!state.location.result?.adminDong.resolvedDong && state.selection.dongCode === state.location.result.adminDong.resolvedDong.code}
                manual={state.mode === 'manual'} onRetry={state.retryLocation} />
              <Button type="button" variant="outline" onClick={() => { setTab('statistics'); setView('statistics'); document.getElementById('tab-statistics')?.focus() }}>행정동 통계 확인</Button>
            </div>}
          </>}
          nearby={nearby}
          statistics={<ManualStatistics state={state} />}
          candidates={<CandidateTray candidates={comparison.candidates} onCompare={() => setView('compare')}
            onRemove={comparison.remove} onSelect={candidate => {
              selectPoint(candidate.coordinate); focusPoint(candidate.coordinate); setTab('overview')
            }} />} />} />
    </main>
    <ComparisonDialog open={view === 'compare'} onClose={() => setView(tab === 'statistics' ? 'statistics' : 'explore')}>
      <CandidateComparison state={comparison} lookups={state.lookups} lookupLoading={state.lookupLoading}
        lookupError={!!state.lookupError} onRetryLookups={state.retryLookups} onExplore={() => navigate('explore')} />
    </ComparisonDialog>
    <Dialog open={view === 'guide'} onClose={() => setView(tab === 'statistics' ? 'statistics' : 'explore')} labelledBy="data-guide-title" closeLabel="안내 닫기">
      <div className="flex flex-col gap-5"><h2 id="data-guide-title" className="text-2xl font-semibold">데이터 안내</h2>
        <p>서울시 행정동 통계와 소상공인시장진흥공단 점포 자료로 카페 창업 환경을 비교합니다.</p>
        <p className="text-sm text-muted-foreground">반경 500m 점포 snapshot과 2025년 행정동 통계는 시점·집계 단위가 다릅니다. 점포 원본 기준일·완전성과 과거 경계 호환성은 미검증입니다. 창업 성공이나 수익을 예측·보장하지 않습니다.</p>
        <details className="source-details"><summary>자료 출처</summary><div className="mt-2 flex flex-col gap-2 text-sm">
          <a className="underline" href="https://data.seoul.go.kr/dataList/OA-22172/S/1/datasetView.do" target="_blank" rel="noreferrer">서울시 점포 통계 · 행정동</a>
          <a className="underline" href="https://data.seoul.go.kr/dataList/OA-22175/S/1/datasetView.do" target="_blank" rel="noreferrer">서울시 추정매출 · 행정동</a>
          <p>주변 점포: SEMAS I21201. 분류에 따라 다른 음료 업태가 포함될 수 있습니다.</p>
        </div></details>
        {view === 'guide' && <CafeAssessment />}
      </div>
    </Dialog>
  </div>
}
export default App
