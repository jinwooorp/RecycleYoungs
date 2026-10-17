import { useEffect, useId, useRef, useState } from 'react'
import type { ApiFailure } from '../api/adminDongApi'
import type { NearbyResult as Result } from '../types/nearby'
import { Button } from './ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card'
import { Alert, AlertDescription } from './ui/alert'
import type { NearbyStore } from '../types/nearby'
import { DataIdentifiers } from './DataProvenance'
import { NativeSelect } from './ui/native-select'
import { allCafes, cafeBrands, cafeDistance, classifyCafe, filterCafes, type CafeFilter } from '../lib/cafeBrands'

const number = (value: string) => BigInt(value).toLocaleString('ko-KR')
function focusRevealed(target: HTMLElement | null) {
  if (!target) return
  const workspace = target.closest('.explore-workspace')
  const focus = () => {
    if (workspace?.classList.contains('panel-collapsed')) return
    target.scrollIntoView?.({ block: 'nearest' }); target.focus({ preventScroll: true })
  }
  // A collapsed panel can still be hidden when the selection effect first runs.
  const revealed = (event: Event) => {
    if (event.target !== workspace) return
    workspace?.removeEventListener('transitionend', revealed)
    focus()
  }
  workspace?.addEventListener('transitionend', revealed)
  const frame = requestAnimationFrame(focus)
  return () => { cancelAnimationFrame(frame); workspace?.removeEventListener('transitionend', revealed) }
}
export function NearbyResult({ result, loading, error, unsupported, selected, onRetry, visibleCount, onVisibleCountChange, activeStoreId, onSelectStore, compact = false, filter, onFilterChange, groupIds, onGroupClose }: {
  result: Result | null; loading: boolean; error: ApiFailure | null
  unsupported: boolean; selected: boolean; onRetry: () => void
  visibleCount?: number; onVisibleCountChange?: (count: number) => void
  activeStoreId?: string | null; onSelectStore?: (store: NearbyStore) => void
  compact?: boolean
  filter?: CafeFilter; onFilterChange?: (filter: CafeFilter) => void
  groupIds?: string[]; onGroupClose?: () => void
}) {
  const [expandedResult, setExpandedResult] = useState<Result | null>(null)
  const expanded = result !== null && (visibleCount !== undefined ? visibleCount > 5 : expandedResult === result)
  const listId = useId()
  const titleId = useId()
  const filtered = filterCafes(result?.stores ?? [], filter ?? allCafes)
  const filtering = !!filter && filter.kind !== 'all'
  const group = filtered.filter(s => groupIds?.includes(s.sourceStoreId))
  const groupPanel = useRef<HTMLElement>(null)
  const previousGroup = useRef(groupIds)
  const previousActive = useRef(activeStoreId)
  useEffect(() => {
    if (previousGroup.current === groupIds) return
    previousGroup.current = groupIds
    if (!groupIds?.length) return
    return focusRevealed(groupPanel.current)
  }, [groupIds])
  useEffect(() => {
    if (previousActive.current === activeStoreId) return
    previousActive.current = activeStoreId
    if (!activeStoreId) return
    return focusRevealed(document.getElementById(`${listId}-${activeStoreId}`)?.querySelector('button') ?? null)
  }, [activeStoreId, listId])
  return <Card asChild density="compact">
    <section aria-labelledby={titleId} className="min-w-0 flex flex-col gap-3" aria-live="polite">
      <CardHeader><CardTitle id={titleId}>반경 500m 경쟁 카페</CardTitle>
        <CardDescription>{compact ? '선택 지점 주변 · 거리순 점포' : '자료에서 카페로 분류한 점포입니다. 분류에 따라 일부 다른 음료 가게도 포함될 수 있습니다.'}</CardDescription></CardHeader>
      <CardContent><div className="flex flex-col gap-3">
      {unsupported ? <p className="notice" role="status">현재 선택한 통계 업종의 경쟁 점포 분석은 지원하지 않습니다. 카페를 선택하면 경쟁 카페를 확인할 수 있습니다.</p>
        : !selected ? <p>지도에서 후보 위치를 선택해 주세요.</p>
          : loading ? <p className="notice" role="status">반경 500m 경쟁 카페를 조회하는 중입니다.</p>
            : error ? <Alert variant="destructive"><AlertDescription>
              <p>{error.status === 503 ? '경쟁 카페 점포 자료 또는 업종 매핑이 준비되지 않았습니다. 카페가 0개라는 뜻이 아닙니다.' : `경쟁 카페를 조회하지 못했습니다. ${error.message}`}</p>
              <Button type="button" onClick={onRetry}>경쟁 카페 다시 시도</Button>
            </AlertDescription></Alert> : result && <>
              <p>조회 가능한 자료에서 반경 500m 이내 경쟁 카페 <strong>{number(result.totalCount)}개</strong></p>
              <p className="text-sm">선택 위치 반경 500m · 직선 거리 기준 · 경계 포함</p>
              {filter && onFilterChange && <div className="flex flex-col gap-2">
                <label className="text-sm" htmlFor={`${listId}-kind`}>카페 종류</label>
                <NativeSelect id={`${listId}-kind`} value={filter.kind} onChange={e => onFilterChange({ kind: e.target.value as CafeFilter['kind'], brand: '' })}>
                  <option value="all">전체</option><option value="brand">브랜드 카페(추정)</option><option value="unidentified">브랜드 미식별</option>
                </NativeSelect>
                {filter.kind === 'brand' && <><label className="text-sm" htmlFor={`${listId}-brand`}>브랜드 선택</label><NativeSelect id={`${listId}-brand`} value={filter.brand} onChange={e => onFilterChange({ ...filter, brand: e.target.value })}>
                  <option value="">모든 추정 브랜드</option>{cafeBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </NativeSelect></>}
                <details className="text-xs text-muted-foreground"><summary>상호명으로 추정 · 운영 형태 미확인</summary><p className="mt-2">가맹·직영·독립 운영 여부는 미확인입니다. 브랜드 미식별은 개인 카페를 확정한 분류가 아닙니다.</p></details>
                <p className="text-sm" role="status">받은 {result.listedCount}개 중 필터 일치 {filtered.length}개 · {result.listComplete ? '수신 목록 기준' : '가까운 최대 100개 목록 안에서만 필터링'}</p>
              </div>}
              {!!group.length && <section ref={groupPanel} tabIndex={-1} className="flex flex-col gap-2 rounded-md border p-3" aria-label="겹친 카페 목록">
                <p className="font-semibold">가까이 겹친 카페 {group.length}곳</p>
                {group.map(s => <Button type="button" key={s.sourceStoreId} variant="outline" className="h-auto min-w-0 whitespace-normal break-words text-left" onClick={() => { onSelectStore?.(s); onGroupClose?.() }}>{s.name ?? '상호명 미확인'} · {cafeDistance(s.distanceMeters)}</Button>)}
                <Button type="button" variant="ghost" onClick={onGroupClose}>겹친 목록 닫기</Button>
              </section>}
              {filtering && filtered.length === 0 && <p role="status">받은 목록에 조건과 일치하는 카페가 없습니다. 반경 전체에 없다는 뜻은 아닙니다.</p>}
              {result.totalCount === '0' ? <p>현재 조회 가능한 카페 자료에서 이 위치 반경 내 점포가 없습니다. 실제 카페가 없음을 보장하지 않습니다.</p>
                : <ol id={listId} className="flex flex-col gap-2 break-words">{filtered.slice(0, expanded ? filtered.length : 5).map(store => <li key={store.sourceStoreId} id={`${listId}-${store.sourceStoreId}`} data-selected={activeStoreId === store.sourceStoreId} className="nearby-store rounded-md border p-3 min-w-0">
                  <p className="flex flex-wrap justify-between gap-2"><strong>{store.name ?? '상호명 미확인'}</strong><span>{store.distanceMeters.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}m</span></p>
                  {filter && <p className="mt-1 text-xs text-muted-foreground">{classifyCafe(store.name) ? `${classifyCafe(store.name)!.name} · 브랜드 추정` : '브랜드 미식별'} · 운영 형태 미확인</p>}
                  {onSelectStore && <Button type="button" size="sm" variant={activeStoreId === store.sourceStoreId ? 'secondary' : 'ghost'}
                    aria-pressed={activeStoreId === store.sourceStoreId} aria-label={`${store.name ?? '상호명 미확인'} 지도에서 보기`}
                    onClick={() => onSelectStore(store)}>지도에서 보기</Button>}
                </li>)}</ol>}
              {filtered.length > 5 && <Button type="button" variant="outline" aria-controls={listId} aria-expanded={expanded}
                onClick={() => { setExpandedResult(expanded ? null : result); onVisibleCountChange?.(expanded ? 5 : result.listedCount) }}>{expanded ? '가까운 5개만 보기' : filtering ? `필터 결과 ${filtered.length}개 모두 보기` : `현재 받은 목록 ${result.listedCount}개 모두 보기`}</Button>}
              <p className="text-sm">현재 {expanded ? filtered.length : Math.min(5, filtered.length)}개 표시 · {result.listComplete
                ? `전체 ${result.listedCount}개 수신` : `가까운 ${result.listedCount}개 수신 (전체 ${number(result.totalCount)}개, 목록 제한 ${result.listLimit}개)`}</p>
              <p className="text-sm text-muted-foreground">수집해 둔 자료에서 확인한 카페 수입니다. 자료가 언제 기준이며 모든 카페가 포함됐는지는 아직 확인하지 못했습니다.</p>
              <details className="source-details"><summary>주변 카페 자료는 어디에서 왔나요?</summary><div className="explanation">
              <p>소상공인시장진흥공단의 점포 목록을 사용합니다. 현재 영업 중인 모든 카페가 빠짐없이 들어 있다고 보장하지 않습니다. 가게가 있어도 분류나 위치 정보가 부족하면 이 목록에서 빠질 수 있습니다.</p>
              <p>2025년 행정동 통계와 점포 목록은 작성 시기와 지역 범위가 다릅니다. 행정동 전체 매출을 이 반경의 예상 매출로 나누어 계산하지 않습니다.</p>
              <DataIdentifiers><p>자료: 소상공인시장진흥공단(SEMAS) · 분류 I21201 · 원본 기준일·적재 시점 미확인 · snapshot 완전성 미검증(UNVERIFIED)</p>
              <p className="text-sm text-muted-foreground">전역 카페 자료 {number(result.data.quality.cafeSourceCount)}개 중 조회 가능한 분류·좌표 {number(result.data.quality.usableCafeCount)}개.
                {' '}미분류 {number(result.data.quality.unclassifiedCafeCount)}개, 위치 누락 {number(result.data.quality.missingLocationCafeCount)}개,
                {' '}비정상 위치 {number(result.data.quality.invalidLocationCafeCount)}개, 원본 좌표 불완전 {number(result.data.quality.incompleteSourceCoordinateCafeCount)}개 (사유 중복 가능).</p>
              </DataIdentifiers><p>주변에 카페가 많거나 적다는 정보만으로 창업 성공이나 수익을 판단할 수 없습니다.</p>
              </div></details>
            </>}
      </div></CardContent>
    </section>
  </Card>
}
