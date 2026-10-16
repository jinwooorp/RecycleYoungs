import { useId, useState } from 'react'
import type { ApiFailure } from '../api/adminDongApi'
import type { NearbyResult as Result } from '../types/nearby'
import { Button } from './ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card'
import { Alert, AlertDescription } from './ui/alert'
import type { NearbyStore } from '../types/nearby'

const number = (value: string) => BigInt(value).toLocaleString('ko-KR')
export function NearbyResult({ result, loading, error, unsupported, selected, onRetry, visibleCount, onVisibleCountChange, activeStoreId, onSelectStore, compact = false }: {
  result: Result | null; loading: boolean; error: ApiFailure | null
  unsupported: boolean; selected: boolean; onRetry: () => void
  visibleCount?: number; onVisibleCountChange?: (count: number) => void
  activeStoreId?: string | null; onSelectStore?: (store: NearbyStore) => void
  compact?: boolean
}) {
  const [expandedResult, setExpandedResult] = useState<Result | null>(null)
  const expanded = result !== null && (visibleCount !== undefined ? visibleCount > 5 : expandedResult === result)
  const listId = useId()
  return <Card asChild density="compact">
    <section aria-labelledby="nearby-title" className="min-w-0 flex flex-col gap-3" aria-live="polite">
      <CardHeader><CardTitle id="nearby-title">반경 500m 경쟁 카페</CardTitle>
        <CardDescription>{compact ? '선택 지점 주변 · 거리순 점포' : '카페(CAFE)만 지원하며, 분류에 따라 일부 다른 음료 업태도 포함될 수 있습니다.'}</CardDescription></CardHeader>
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
              {result.totalCount === '0' ? <p>현재 조회 가능한 카페 자료에서 이 위치 반경 내 점포가 없습니다. 실제 카페가 없음을 보장하지 않습니다.</p>
                : <ol id={listId} className="flex flex-col gap-2 break-words">{result.stores.slice(0, expanded ? result.stores.length : 5).map(store => <li key={store.sourceStoreId} className="rounded-md border p-3 min-w-0">
                  <p className="flex flex-wrap justify-between gap-2"><strong>{store.name ?? '상호명 미확인'}</strong><span>{store.distanceMeters.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}m</span></p>
                  {onSelectStore && <Button type="button" size="sm" variant={activeStoreId === store.sourceStoreId ? 'secondary' : 'ghost'}
                    aria-pressed={activeStoreId === store.sourceStoreId} aria-label={`${store.name ?? '상호명 미확인'} 지도에서 보기`}
                    onClick={() => onSelectStore(store)}>지도에서 보기</Button>}
                </li>)}</ol>}
              {result.stores.length > 5 && <Button type="button" variant="outline" aria-controls={listId} aria-expanded={expanded}
                onClick={() => { setExpandedResult(expanded ? null : result); onVisibleCountChange?.(expanded ? 5 : result.listedCount) }}>{expanded ? '가까운 5개만 보기' : `현재 받은 목록 ${result.listedCount}개 모두 보기`}</Button>}
              <p className="text-sm">현재 {expanded ? result.listedCount : Math.min(5, result.listedCount)}개 표시 · {result.listComplete
                ? `전체 ${result.listedCount}개 수신` : `가까운 ${result.listedCount}개 수신 (전체 ${number(result.totalCount)}개, 목록 제한 ${result.listLimit}개)`}</p>
              <p className="text-sm text-muted-foreground">점포 원본 기준일·완전성은 미검증입니다. 현재 수집된 자료의 카페 수입니다.</p>
              <details className="source-details"><summary>점포 자료의 출처와 한계</summary><div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">자료: 소상공인시장진흥공단(SEMAS), I21201 · 원본 기준일·적재 시점 미확인 · snapshot 완전성 미검증(UNVERIFIED)</p>
              <p className="text-sm text-muted-foreground">전역 카페 자료 {number(result.data.quality.cafeSourceCount)}개 중 조회 가능한 분류·좌표 {number(result.data.quality.usableCafeCount)}개.
                {' '}미분류 {number(result.data.quality.unclassifiedCafeCount)}개, 위치 누락 {number(result.data.quality.missingLocationCafeCount)}개,
                {' '}비정상 위치 {number(result.data.quality.invalidLocationCafeCount)}개, 원본 좌표 불완전 {number(result.data.quality.incompleteSourceCoordinateCafeCount)}개 (사유 중복 가능).</p>
              <p className="text-sm text-muted-foreground">점포 snapshot은 2025년 행정동 통계와 시점·집계 단위가 다릅니다. 행정동 매출을 반경 매출로 환산하지 않습니다. 창업 성공·수익을 보장하지 않습니다.</p>
              </div></details>
            </>}
      </div></CardContent>
    </section>
  </Card>
}
