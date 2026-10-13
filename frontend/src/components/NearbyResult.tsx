import type { ApiFailure } from '../api/adminDongApi'
import type { NearbyResult as Result } from '../types/nearby'
import { Button } from './ui/button'
import { Card } from './ui/card'

const number = (value: string) => BigInt(value).toLocaleString('ko-KR')
export function NearbyResult({ result, loading, error, unsupported, selected, onRetry }: {
  result: Result | null; loading: boolean; error: ApiFailure | null
  unsupported: boolean; selected: boolean; onRetry: () => void
}) {
  return <Card asChild className="gap-0 rounded-lg p-5 min-[761px]:p-6">
    <section aria-labelledby="nearby-title" className="min-w-0 flex flex-col gap-3" aria-live="polite">
      <h2 id="nearby-title">반경 500m 경쟁 카페</h2>
      <p className="text-sm text-muted-foreground">경쟁 점포 분석은 카페(CAFE)만 지원합니다. SEMAS 소분류 I21201 전체 범주를 사용해 일부 다른 음료 업태도 포함될 수 있습니다.</p>
      {unsupported ? <p className="notice" role="status">현재 선택한 통계 업종의 경쟁 점포 분석은 지원하지 않습니다. 카페를 선택하면 경쟁 카페를 확인할 수 있습니다.</p>
        : !selected ? <p>지도에서 후보 위치를 선택해 주세요.</p>
          : loading ? <p className="notice" role="status">반경 500m 경쟁 카페를 조회하는 중입니다.</p>
            : error ? <div className="error-message" role="alert">
              <p>{error.status === 503 ? '경쟁 카페 점포 자료 또는 업종 매핑이 준비되지 않았습니다. 카페가 0개라는 뜻이 아닙니다.' : `경쟁 카페를 조회하지 못했습니다. ${error.message}`}</p>
              <Button type="button" onClick={onRetry}>경쟁 카페 다시 시도</Button>
            </div> : result && <>
              <p>조회 가능한 자료에서 반경 500m 이내 경쟁 카페 <strong>{number(result.totalCount)}개</strong></p>
              <p className="text-sm">선택 위치: 위도 {result.coordinate.lat.toFixed(6)} / 경도 {result.coordinate.lng.toFixed(6)} · WGS84 미터 거리 기준, 500m 경계 포함</p>
              {result.totalCount === '0' ? <p>현재 조회 가능한 카페 자료에서 이 위치 반경 내 점포가 없습니다. 실제 카페가 없음을 보장하지 않습니다.</p>
                : <ol className="flex flex-col gap-2 break-words">{result.stores.map(store => <li key={store.sourceStoreId} className="rounded-md border p-3 min-w-0">
                  <p className="flex flex-wrap justify-between gap-2"><strong>{store.name ?? '상호명 미확인'}</strong><span>{store.distanceMeters.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}m</span></p>
                  <p className="text-xs text-muted-foreground break-all">점포 코드 {store.sourceStoreId} · 위도 {store.coordinate.lat.toFixed(6)} / 경도 {store.coordinate.lng.toFixed(6)}</p>
                </li>)}</ol>}
              <p>{result.listComplete ? `전체 ${result.listedCount}개 표시` : `가까운 ${result.listedCount}개 표시 (전체 ${number(result.totalCount)}개, 목록 제한 ${result.listLimit}개)`}</p>
              <p className="text-sm text-muted-foreground">자료: 소상공인시장진흥공단(SEMAS), I21201 · 원본 기준일·적재 시점 미확인 · snapshot 완전성 미검증(UNVERIFIED)</p>
              <p className="text-sm text-muted-foreground">전역 카페 자료 {number(result.data.quality.cafeSourceCount)}개 중 조회 가능한 분류·좌표 {number(result.data.quality.usableCafeCount)}개.
                {' '}미분류 {number(result.data.quality.unclassifiedCafeCount)}개, 위치 누락 {number(result.data.quality.missingLocationCafeCount)}개,
                {' '}비정상 위치 {number(result.data.quality.invalidLocationCafeCount)}개, 원본 좌표 불완전 {number(result.data.quality.incompleteSourceCoordinateCafeCount)}개 (사유 중복 가능).</p>
              <p className="text-sm text-muted-foreground">점포 snapshot은 2025년 행정동 통계와 시점·집계 단위가 다릅니다. 행정동 매출을 반경 매출로 환산하지 않습니다. 창업 성공·수익을 보장하지 않습니다.</p>
            </>}
    </section>
  </Card>
}
