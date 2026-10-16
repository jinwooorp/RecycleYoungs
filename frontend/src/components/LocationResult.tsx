import type { ApiFailure } from '../api/adminDongApi'
import type { LocationResolution, SpatialDataset, BoundaryMatch } from '../types/location'
import { Button } from './ui/button'

function quality(match: BoundaryMatch) {
  return `${match.pointRelation === 'BOUNDARY' ? '경계 위' : '경계 내부'} · ${match.qualityStatus === 'REPAIRED_OPERATIONAL' ? '보정된 판정용 경계' : '유효 원본 경계'}`
}
function DatasetInfo({ dataset, label }: { dataset: SpatialDataset; label: string }) {
  return <p className="text-sm text-muted-foreground break-words">
    {label}: <a href={dataset.sourceUrl} className="underline">{dataset.datasetName}</a> ({dataset.datasetId}), 버전 {dataset.version} · 기준일 {dataset.referenceDate ?? '미확인'}
    {' · '}적재 {dataset.loadedAt}
    {dataset.validationStatus === 'PASSED_WITH_LIMITATIONS' && ' · 한계가 있는 검증 결과'}
    {dataset.historicalCompatibilityStatus === 'UNRESOLVED' && ' · 과거 통계 경계와의 호환성 미검증'}
  </p>
}

export function LocationResult({ result, loading, error, lookupLoading, lookupError, linked, manual, onRetry }: {
  result: LocationResolution | null
  loading: boolean
  error: ApiFailure | null
  lookupLoading: boolean
  lookupError: boolean
  linked: boolean
  manual: boolean
  onRetry: () => void
}) {
  if (loading) return <p className="notice" role="status">선택 위치의 행정동·상권을 판정하는 중입니다.</p>
  if (error) return <div className="error-message" role="alert">
    <p>위치 판정을 완료하지 못했습니다. {error.code === 'BOUNDARY_DATA_UNAVAILABLE'
      ? '행정동·상권 경계 데이터가 준비되지 않았습니다.' : error.message}</p>
    <Button type="button" onClick={onRetry}>위치 판정 다시 시도</Button>
    <p>행정동을 직접 선택해 통계를 조회할 수 있습니다.</p>
  </div>
  if (!result) return null
  const { adminDong, commercialArea } = result
  return <section className="mt-4 flex flex-col gap-3" aria-labelledby="location-result-title" aria-live="polite">
    <h3 id="location-result-title">선택 위치의 지역 판정</h3>
    {adminDong.status === 'RESOLVED' && adminDong.resolvedDong && <>
      <p>행정동: <strong>{adminDong.resolvedDong.name}</strong> ({adminDong.resolvedDong.code})</p>
      <p className="text-sm">{quality(adminDong.resolvedDong)}{adminDong.resolvedDong.qualityDetail && ` · ${adminDong.resolvedDong.qualityDetail}`}</p>
      <p>{manual ? '통계 조회 조건은 직접 선택한 행정동을 사용합니다.' : lookupLoading ? '통계 조회 조건 목록을 확인하는 중입니다.'
        : lookupError ? '조회 조건 목록을 불러오지 못해 통계 연결을 확인할 수 없습니다.'
          : linked ? '조회 조건에 해당 행정동이 반영됐습니다. 분기를 확인한 뒤 조회하기를 눌러 주세요.'
            : '판정된 행정동의 통계 연결 자료가 현재 조회 조건 목록에 없습니다. 다른 행정동으로 대체하지 않습니다.'}</p>
    </>}
    {adminDong.status === 'AMBIGUOUS_BOUNDARY' && <>
      <p>여러 행정동 경계에 포함돼 하나의 행정동으로 확정할 수 없습니다. 통계 조건을 자동 연결하지 않습니다.</p>
      <ul className="list-disc pl-5">{adminDong.candidates.map(dong => <li key={dong.code}>
        {dong.name} ({dong.code}) · {quality(dong)}{dong.qualityDetail && ` · ${dong.qualityDetail}`}
      </li>)}</ul>
    </>}
    {adminDong.status === 'OUTSIDE_OR_UNSUPPORTED' && <p>
      이 위치를 포함하는 판정용 행정동 경계가 없습니다. 지원 범위 밖·자료 누락·경계의 빈 영역 등을 구분할 수 없습니다.
    </p>}
    <div>
      <h4>상권 소속</h4>
      {commercialArea.status === 'NO_MEMBERSHIP' ? <p>이 위치에 해당하는 상권이 없습니다.</p>
        : <ul className="list-disc pl-5 break-words">{commercialArea.memberships.map(area => <li key={area.code}>
          {area.name} ({area.code}) · {quality(area)}{area.qualityDetail && ` · ${area.qualityDetail}`}
          {area.sourceAttributeStatus === 'CONFLICT_OBSERVED' && <p>원본 지역 속성 충돌: {area.sourceAttributeDetail}</p>}
        </li>)}</ul>}
      <p className="text-sm text-muted-foreground">상권은 여러 곳에 포함될 수 있으며 매출을 자동 합산하지 않습니다. 원본 지역 속성은 행정동 연결 근거로 사용하지 않습니다.</p>
    </div>
    <p className="text-sm text-muted-foreground">과거 통계 경계와의 호환성은 미검증입니다.</p>
    <details className="source-details"><summary>경계 자료의 출처와 품질</summary><div className="mt-3 flex flex-col gap-3">
      <DatasetInfo dataset={adminDong.dataset} label="행정동 경계 자료" />
      <DatasetInfo dataset={commercialArea.dataset} label="상권 경계 자료" />
    </div></details>
    <p className="text-sm text-muted-foreground">좌표·경계 자료의 오차로 경계 부근 소속을 보장하지 않습니다. 창업 성공이나 수익을 예측하는 결과가 아닙니다.</p>
  </section>
}
