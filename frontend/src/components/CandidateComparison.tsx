import type { MapCoordinate } from './KakaoMap'
import type { Lookups } from '../types/api'
import { useCandidateComparison } from '../hooks/useCandidateComparison'
import { CandidateCard } from './CandidateCard'
import { Button } from './ui/button'
import { Card } from './ui/card'

export function CandidateComparison({ coordinate, lookups, lookupLoading, lookupError, onRetryLookups }: {
  coordinate: MapCoordinate | null; lookups: Lookups | null; lookupLoading: boolean; lookupError: boolean; onRetryLookups: () => void
}) {
  const state = useCandidateComparison(lookups, lookupLoading, lookupError)
  const duplicate = !!coordinate && state.candidates.some(c => c.coordinate.lat === coordinate.lat && c.coordinate.lng === coordinate.lng)
  const locations = state.candidates.flatMap(c => c.location.result ? [c.location.result] : [])
  const versionMismatch = new Set(locations.map(l => l.adminDong.dataset.version)).size > 1
    || new Set(locations.map(l => l.commercialArea.dataset.version)).size > 1
  const resolvedCodes = locations.flatMap(l => l.adminDong.resolvedDong ? [l.adminDong.resolvedDong.code] : [])
  const sameDong = new Set(resolvedCodes).size < resolvedCodes.length
  const eligible = state.candidates.some(c => !state.statsBlockReason(c))
  return <Card asChild className="gap-0 rounded-lg p-5 min-[761px]:p-6">
    <section aria-labelledby="comparison-title" className="min-w-0 flex flex-col gap-4">
      <h2 id="comparison-title">창업 후보지 비교</h2>
      <p>지도에서 선택한 위치를 최대 3곳까지 저장합니다. 새 위치를 탐색해도 저장 후보는 유지됩니다.</p>
      <p className="text-sm">비교 업종·분기는 아래 수동 조회 조건과 독립적으로 적용합니다.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!coordinate || duplicate || state.candidates.length >= 3} onClick={() => { if (coordinate) state.add(coordinate) }}>후보지에 추가</Button>
        <p aria-live="polite">등록한 후보 {state.candidates.length}/3</p>
      </div>
      {state.candidates.length >= 3 ? <p className="text-sm" role="status">최대 3곳까지 등록할 수 있습니다. 후보를 삭제하면 새 위치를 추가할 수 있습니다.</p>
        : duplicate ? <p className="text-sm" role="status">선택한 정확한 좌표가 이미 후보에 등록돼 있습니다.</p>
          : !coordinate && <p className="text-sm">먼저 지도에서 위치를 선택해 주세요.</p>}
      <div className="rounded-md border p-3 flex flex-col gap-2">
        <p className="font-medium">공통 조건: 카페(CAFE) · 반경 500m · SEMAS I21201 · 행정동 통계</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="comparison-quarter">비교 통계 분기</label>
            <select id="comparison-quarter" className="rounded-md border bg-background p-2" value={state.quarter}
              disabled={lookupLoading || lookupError || !lookups?.industries.some(i => i.code === 'CAFE')}
              onChange={event => state.changeQuarter(event.target.value)}>
              <option value="">분기를 선택하세요</option>
              {lookups?.quarters.filter(q => /^2025[1-4]$/.test(q.code)).map(q => <option key={q.code} value={q.code}>{q.label}</option>)}
            </select>
          </div>
          <Button type="button" disabled={!eligible || state.candidates.some(c => c.stats.loading)} onClick={state.queryStats}>비교 통계 조회</Button>
        </div>
        <p className="text-sm">분기 변경 시 모든 후보의 이전 통계와 진행 중 통계 요청을 지웁니다. 비교 통계 조회를 눌러 새 분기를 조회해 주세요. 지역 판정이 끝난 후보 중 조회 가능한 행정동만 요청합니다.</p>
        {lookupLoading && <p className="text-sm" role="status">비교용 조회 조건을 확인하는 중입니다.</p>}
        {lookupError && <div className="text-sm" role="status"><p>조회 조건 오류로 비교 통계를 연결할 수 없습니다. 지역·카페 결과는 유지합니다.</p>
          <Button type="button" variant="outline" onClick={onRetryLookups}>비교 조회 조건 다시 불러오기</Button></div>}
        {!lookupLoading && !lookupError && !lookups?.industries.some(i => i.code === 'CAFE') && <p className="text-sm">현재 조회 조건에서 CAFE 통계를 지원하지 않습니다.</p>}
      </div>
      {versionMismatch && <p className="notice" role="status">후보별 공간 dataset version이 다릅니다. 동일한 경계 자료 기준의 비교가 아닙니다. 필요한 후보의 지역 판정을 다시 조회해 주세요.</p>}
      {sameDong && <p className="notice" role="status">같은 행정동에 속한 후보가 있습니다. 통계는 동일 행정동의 집계값이며 좌표별 독립 통계가 아닙니다. 합산하지 않습니다.</p>}
      <div className="grid gap-4 min-[900px]:grid-cols-3">
        {state.candidates.map(c => <CandidateCard key={c.id} candidate={c} quarter={state.quarter} block={state.statsBlockReason(c)}
          onRemove={() => state.remove(c.id)} onLocation={() => state.retryLocation(c.id)}
          onNearby={() => state.retryNearby(c.id)} onStats={() => state.retryStats(c.id)} />)}
      </div>
      <p className="text-sm text-muted-foreground">경쟁 카페는 각 좌표의 반경 500m 자료이고 추정매출은 선택 분기의 행정동 집계입니다. 매출을 반경에 배분하지 않습니다. NULL·조회 행 없음(NO_ROW)·실제 0을 구분합니다.</p>
      <p className="text-sm text-muted-foreground">2025년 행정동 통계와 SEMAS 점포 자료는 시점·공간 단위가 다릅니다. 점포 snapshot은 UNVERIFIED이며 모든 후보 요청의 동일 원본 snapshot·기준일·완전성을 보장하지 않습니다. 같은 분기 코드가 원본 snapshot 동일성을 뜻하지 않으며 통계 snapshot/version metadata는 제공되지 않습니다.</p>
      <p className="text-sm text-muted-foreground">공간 판정은 각 요청의 current operational boundary 기준입니다. 버전·품질·과거 경계 호환성 한계를 후보별로 확인하세요. 비교 결과는 창업 성공·수익·추천 순위를 예측하지 않습니다.</p>
    </section>
  </Card>
}
