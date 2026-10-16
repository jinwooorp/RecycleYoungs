import type { Candidate, StatsBlockReason } from '../types/comparison'
import { formatCount, formatDecimal } from '../lib/formatStats'
import { Button } from './ui/button'
import { Alert, AlertDescription } from './ui/alert'
import { candidateTitle } from '../lib/candidatePresentation'
import { boundaryRelation as relation } from '../lib/dataLanguage'
import { BoundarySource, DataIdentifiers } from './DataProvenance'

const blocked: Record<StatsBlockReason, string> = {
  LOOKUP_LOADING: '통계 조회 조건을 확인하는 중입니다.', LOOKUP_ERROR: '조회 조건을 확인하지 못해 통계를 연결할 수 없습니다.',
  NO_CAFE: '이 지역은 카페 통계를 제공하지 않습니다.', NO_QUARTER: '공통 비교 분기를 선택해 주세요.',
  LOCATION_LOADING: '지역 판정 완료 후 비교 통계를 조회해 주세요.', LOCATION_ERROR: '지역 판정에 실패해 행정동 통계를 조회할 수 없습니다.',
  AMBIGUOUS: '행정동이 모호해 통계를 연결하지 않습니다.', OUTSIDE: '확정 행정동이 없어 통계를 연결하지 않습니다.',
  NO_DONG_LOOKUP: '이 행정동의 통계 연결 자료가 조회 조건 목록에 없습니다. 다른 동으로 대체하지 않습니다.',
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-2 items-baseline gap-3 border-b py-2 text-sm">
    <dt>{label}</dt><dd className="min-w-0 text-right wrap-anywhere tabular-nums">{value}</dd>
  </div>
}
const nullableCount = (v: number | null) => v === null ? '값이 제공되지 않음' : formatCount(v)
const nullableDecimal = (v: string | null, unit: '원' | '건') => v === null ? '값이 제공되지 않음' : formatDecimal(v, unit)

export function CandidateCard({ candidate: c, quarter, block, onRemove, onLocation, onNearby, onStats, onMap }: {
  candidate: Candidate; quarter: string; block: StatsBlockReason | null
  onRemove: () => void; onLocation: () => void; onNearby: () => void; onStats: () => void
  onMap?: () => void
}) {
  const title = `후보 ${c.number}`, location = c.location.result, nearby = c.nearby.result
  const stats = !block && c.statsQuarter === quarter ? c.stats.result : null
  const noRow = '집계 자료 없음'
  return <article aria-labelledby={`${c.id}-title`} className="min-w-0 rounded-lg border bg-background p-4 flex flex-col gap-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={`${c.id}-title`} className="font-semibold">{candidateTitle(c)}</h3><Button type="button" variant="outline" onClick={onRemove} aria-label={`${title} 삭제`}>삭제</Button>
    </header>
    {onMap && <Button type="button" variant="outline" onClick={onMap} aria-label={`${title} 지도에서 보기`}>지도에서 보기</Button>}
    <p className="text-sm text-muted-foreground">{location?.commercialArea.memberships.map(a => a.name).join(' · ') || '소속 상권 미확인'}</p>
    {location?.commercialArea.memberships.some(area => area.sourceAttributeStatus === 'CONFLICT_OBSERVED') && <Alert variant="warning" role="status">
      <AlertDescription>상권 원본 지역 속성 충돌이 있습니다. 상세 근거를 확인해 주세요.</AlertDescription>
    </Alert>}
    <details className="source-details"><summary>상세 근거와 개별 재조회</summary><div className="mt-4 flex flex-col gap-4">
    <section className="flex flex-col gap-2" aria-label={`${title} 지역 판정`}>
      <h4>행정동·상권</h4>
      {c.location.loading ? <p role="status">지역 판정 중</p> : c.location.error ? <p role="alert">지역 판정 실패: {c.location.error.message}</p>
        : location && <>
          {location.adminDong.status === 'RESOLVED' && location.adminDong.resolvedDong && <>
            <p><strong>{location.adminDong.resolvedDong.name}</strong> ({location.adminDong.resolvedDong.code})</p>
            <p className="text-sm">{relation(location.adminDong.resolvedDong)}</p>
          </>}
          {location.adminDong.status === 'AMBIGUOUS_BOUNDARY' && <><p>여러 동네의 경계에 겹쳐 있어 하나로 정할 수 없습니다. 해당하는 동네를 모두 보여드립니다.</p>
            <ul className="list-disc pl-4 text-sm break-words">{location.adminDong.candidates.map(d => <li key={d.code}>{d.name} ({d.code}) · {relation(d)}{d.qualityDetail && ` · ${d.qualityDetail}`}</li>)}</ul></>}
          {location.adminDong.status === 'OUTSIDE_OR_UNSUPPORTED' && <p>이 위치의 동네를 찾지 못했습니다. 서비스 범위 밖인지, 지도 자료가 빠져 있는지는 확인할 수 없습니다.</p>}
          <p className="text-sm font-medium">상권 소속</p>
          {location.commercialArea.status === 'NO_MEMBERSHIP' ? <p className="text-sm">해당 상권 없음</p>
            : <ul className="list-disc pl-4 text-sm break-words">{location.commercialArea.memberships.map(area => <li key={area.code}>{area.name} ({area.code}) · {relation(area)}
              {area.qualityDetail && ` · ${area.qualityDetail}`}
              {area.sourceAttributeStatus === 'CONFLICT_OBSERVED' && ` · 원본 지역 속성 충돌: ${area.sourceAttributeDetail}`}
              {area.sourceAttributeStatus === 'UNVERIFIED' && ' · 원본 지역 속성 미검증'}</li>)}</ul>}
          <BoundarySource dataset={location.adminDong.dataset} label="행정동 지도 자료" />
          <BoundarySource dataset={location.commercialArea.dataset} label="상권 지도 자료" />
          <DataIdentifiers>{[...(location.adminDong.resolvedDong ? [location.adminDong.resolvedDong] : location.adminDong.candidates), ...location.commercialArea.memberships].map(d => <p key={d.code}>{d.code} · {d.qualityStatus} · {d.qualityDetail ?? '추가 안내 없음'}</p>)}</DataIdentifiers>
        </>}
      <Button type="button" variant="outline" disabled={c.location.loading} onClick={onLocation} aria-label={`${title} 지역 다시 조회`}>지역 다시 조회</Button>
    </section>
    <section className="flex flex-col gap-2" aria-label={`${title} 경쟁 카페`}>
      <h4>반경 500m 경쟁 카페</h4>
      {c.nearby.loading ? <p role="status">경쟁 카페 조회 중</p> : c.nearby.error ? <p role="alert">{c.nearby.error.status === 503
        ? '카페 자료를 아직 조회할 수 없습니다. 카페가 0개라는 뜻은 아닙니다.' : `경쟁 카페 조회 실패: ${c.nearby.error.message}`}</p>
        : nearby && <>
          <p>조회 자료의 경쟁 카페 <strong>{BigInt(nearby.totalCount).toLocaleString('ko-KR')}개</strong></p>
          <p className="text-sm">점포 목록 {nearby.listedCount}개 / 제한 {nearby.listLimit}개 · {nearby.listComplete ? '전체 목록' : '일부 목록'}</p>
          {nearby.totalCount === '0' && <p className="text-sm">현재 조회 가능한 자료의 반경 내 0개입니다. 실제 점포 부재를 보장하지 않습니다.</p>}
          <p className="text-sm">소상공인시장진흥공단 점포 자료에서 찾은 카페입니다. 자료가 언제 기준인지, 모든 카페가 포함됐는지는 아직 확인하지 못했습니다.</p>
          <DataIdentifiers>
            <p>SEMAS {nearby.data.sourceCategoryCode} · snapshot {nearby.data.snapshotStatus} · 원본 기준일·적재 시점 미확인</p>
            <p>전역 조회 가능 {nearby.data.quality.usableCafeCount}개 · 미분류 {nearby.data.quality.unclassifiedCafeCount}개 · 위치 누락 {nearby.data.quality.missingLocationCafeCount}개 · 비정상 위치 {nearby.data.quality.invalidLocationCafeCount}개 · 원본 좌표 불완전 {nearby.data.quality.incompleteSourceCoordinateCafeCount}개 (사유 중복 가능)</p>
          </DataIdentifiers>
        </>}
      <Button type="button" variant="outline" disabled={c.nearby.loading} onClick={onNearby} aria-label={`${title} 카페 다시 조회`}>카페 다시 조회</Button>
    </section>
    <section className="flex flex-col gap-2" aria-label={`${title} 행정동 통계`}>
      <h4>행정동 카페 통계</h4>
      {block ? <p className="text-sm">{blocked[block]}</p>
        : c.stats.loading ? <p role="status">선택 분기 통계 조회 중</p>
          : c.stats.error ? <p role="alert">통계 조회 실패: {c.stats.error.message}</p>
            : !stats ? <p className="text-sm">같은 분기로 후보 분석을 눌러 선택 분기 통계를 확인하세요.</p> : <>
              <p className="text-sm">{stats.quarter.label} · {stats.dong.name} ({stats.dong.code})</p>
              <dl>
                <Metric label="점포 수" value={stats.storeStats === null ? noRow : nullableCount(stats.storeStats.storeCount)} />
                <Metric label="유사 업종 점포 수" value={stats.storeStats === null ? noRow : nullableCount(stats.storeStats.similarStoreCount)} />
                <Metric label="개업 점포 수" value={stats.storeStats === null ? noRow : nullableCount(stats.storeStats.openingStoreCount)} />
                <Metric label="폐업 점포 수" value={stats.storeStats === null ? noRow : nullableCount(stats.storeStats.closingStoreCount)} />
                <Metric label="프랜차이즈 점포 수" value={stats.storeStats === null ? noRow : nullableCount(stats.storeStats.franchiseStoreCount)} />
                <Metric label="추정매출" value={stats.salesStats === null ? noRow : nullableDecimal(stats.salesStats.estimatedSalesAmount, '원')} />
                <Metric label="매출 건수" value={stats.salesStats === null ? noRow : nullableDecimal(stats.salesStats.transactionCount, '건')} />
                <Metric label="평일 추정매출" value={stats.salesStats === null ? noRow : nullableDecimal(stats.salesStats.weekdayEstimatedSalesAmount, '원')} />
                <Metric label="주말 추정매출" value={stats.salesStats === null ? noRow : nullableDecimal(stats.salesStats.weekendEstimatedSalesAmount, '원')} />
              </dl>
            </>}
      <Button type="button" variant="outline" disabled={!!block || c.stats.loading} onClick={onStats} aria-label={`${title} 통계 다시 조회`}>통계 다시 조회</Button>
    </section>
    </div></details>
  </article>
}
