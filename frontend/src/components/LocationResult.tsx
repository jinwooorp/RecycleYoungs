import type { ApiFailure } from '../api/adminDongApi'
import type { LocationResolution } from '../types/location'
import { Button } from './ui/button'
import { BoundarySource, DataIdentifiers } from './DataProvenance'
import { boundaryRelation } from '../lib/dataLanguage'

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
      <p>행정동: <strong>{adminDong.resolvedDong.name}</strong></p>
      <p className="text-sm">{boundaryRelation(adminDong.resolvedDong)}</p>
      <p>{manual ? '통계 조회 조건은 직접 선택한 행정동을 사용합니다.' : lookupLoading ? '통계 조회 조건 목록을 확인하는 중입니다.'
        : lookupError ? '조회 조건 목록을 불러오지 못해 통계 연결을 확인할 수 없습니다.'
          : linked ? '조회 조건에 해당 행정동이 반영됐습니다. 지원 분기의 통계를 자동으로 조회합니다.'
            : '판정된 행정동의 통계 연결 자료가 현재 조회 조건 목록에 없습니다. 다른 행정동으로 대체하지 않습니다.'}</p>
    </>}
    {adminDong.status === 'AMBIGUOUS_BOUNDARY' && <>
      <p>여러 행정동 경계에 포함돼 하나의 행정동으로 확정할 수 없습니다. 통계 조건을 자동 연결하지 않습니다.</p>
      <ul className="list-disc pl-5">{adminDong.candidates.map(dong => <li key={dong.code}>
        {dong.name} · {boundaryRelation(dong)}
      </li>)}</ul>
    </>}
    {adminDong.status === 'OUTSIDE_OR_UNSUPPORTED' && <p>
      이 위치를 포함하는 판정용 행정동 경계가 없습니다. 지원 범위 밖·자료 누락·경계의 빈 영역 등을 구분할 수 없습니다.
    </p>}
    <div>
      <h4>상권 소속</h4>
      {commercialArea.status === 'NO_MEMBERSHIP' ? <p>이 위치에 해당하는 상권이 없습니다.</p>
        : <ul className="list-disc pl-5 break-words">{commercialArea.memberships.map(area => <li key={area.code}>
          {area.name} · {boundaryRelation(area)}
          {area.sourceAttributeStatus === 'CONFLICT_OBSERVED' && <p>이 상권은 원자료의 지역 정보가 서로 맞지 않는 부분이 있습니다. 이 정보만으로 행정동을 연결하지 않습니다.</p>}
        </li>)}</ul>}
      <p className="text-sm text-muted-foreground">한 지점이 여러 상권에 포함될 수 있습니다. 여러 상권에 속한다고 매출을 더해서 계산하지 않습니다. 상권 자료에 적힌 지역 정보만으로 행정동을 정하지 않습니다.</p>
    </div>
    <p className="text-sm text-muted-foreground">지도와 통계의 지역 구분이 같은 시기의 것인지는 확인 전입니다.</p>
    <details className="source-details"><summary>이 지역은 어떤 지도 자료로 구분했나요?</summary><div className="explanation">
      <p>지도에 그린 선으로 선택 지점의 행정동과 상권을 확인합니다. 선이 겹치거나 좌표에 오차가 있으면 지역이 확정되지 않을 수 있습니다.</p>
      <BoundarySource dataset={adminDong.dataset} label="행정동 지도 자료" />
      <BoundarySource dataset={commercialArea.dataset} label="상권 지도 자료" />
      <DataIdentifiers>{[...(adminDong.resolvedDong ? [adminDong.resolvedDong] : adminDong.candidates), ...commercialArea.memberships].map(d => <p key={d.code}>지역 코드: {d.code} · {d.qualityStatus} · {d.qualityDetail ?? '추가 안내 없음'}</p>)}
        {commercialArea.memberships.filter(a => a.sourceAttributeStatus === 'CONFLICT_OBSERVED').map(a => <p key={a.code}>원본 지역 속성 충돌: {a.sourceAttributeDetail}</p>)}</DataIdentifiers>
    </div></details>
    <p className="text-sm text-muted-foreground">좌표·경계 자료의 오차로 경계 부근 소속을 보장하지 않습니다. 창업 성공이나 수익을 예측하는 결과가 아닙니다.</p>
  </section>
}
