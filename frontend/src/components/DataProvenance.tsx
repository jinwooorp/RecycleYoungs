import type { ReactNode } from 'react'
import type { SpatialDataset } from '../types/location'
import type { RegionBoundary } from '../types/regions'

export function DataIdentifiers({ children }: { children: ReactNode }) {
  return <details className="source-details"><summary>자료 식별 정보</summary><div className="mt-2 flex flex-col gap-2 break-words text-sm text-muted-foreground">{children}</div></details>
}

export function BoundarySource({ dataset, label }: { dataset: SpatialDataset; label: string }) {
  return <section className="flex flex-col gap-2 text-sm"><h4 className="font-semibold">{label}</h4>
    <a href={dataset.sourceUrl} target="_blank" rel="noreferrer" className="underline">{dataset.datasetName}</a>
    <p>자료 기준일: {dataset.referenceDate ?? '아직 확인하지 못했습니다.'}{dataset.referenceDate && !dataset.referenceDateVerified && ' (원자료 기준일인지 확인 전)'}</p>
    {dataset.historicalCompatibilityStatus === 'UNRESOLVED' && <p>이 지도에서 사용한 지역 구분이 통계가 작성된 시기의 지역 구분과 같은지는 아직 확인하지 못했습니다.</p>}
    {dataset.validationStatus === 'PASSED_WITH_LIMITATIONS' && <p>지역 확인에 사용할 수 있도록 검사했지만, 경계가 겹치거나 원자료에 문제가 있는 부분은 남아 있을 수 있습니다.</p>}
    <DataIdentifiers><p>자료 번호: {dataset.datasetId} · 버전: {dataset.version}</p><p>서비스에 넣은 시각: {dataset.loadedAt}. 원자료 기준일과는 다릅니다.</p><p>검사 상태: {dataset.validationStatus} · 과거 경계 확인: {dataset.historicalCompatibilityStatus}</p></DataIdentifiers>
  </section>
}

export function RegionBoundaryInfo({ boundary }: { boundary: RegionBoundary }) {
  return <details className="source-details my-5"><summary>이 동네의 지도 경계는 어떻게 확인했나요?</summary><div className="explanation">
    <p>서울시가 제공한 행정동 경계로 선택한 동네를 지도에 표시합니다. {boundary.qualityStatus === 'REPAIRED_OPERATIONAL' ? '원자료의 도형 문제를 보완한 경계를 사용했습니다.' : '원자료의 경계를 사용했습니다.'}</p>
    <p>{boundary.historicalCompatibilityStatus === 'VERIFIED' ? '통계가 작성된 시기의 지역 구분과 일치하는지 확인한 자료입니다.' : '이 경계가 통계가 작성된 시기의 지역 구분과 같은지는 아직 확인하지 못했습니다.'}</p>
    <p>원자료 기준일: {boundary.referenceDate ?? '미확인'}{!boundary.referenceDateVerified && ' (확인 전)'}</p>
    <a className="underline" href={boundary.sourceUrl} target="_blank" rel="noreferrer">서울시 행정동 경계 자료 보기</a>
    <DataIdentifiers><p>OA-22160 · 버전 {boundary.datasetVersion} · {boundary.qualityStatus}</p><p>과거 경계 확인: {boundary.historicalCompatibilityStatus} · 검사 상태: {boundary.validationStatus}</p><p>{boundary.qualityDetail ?? '추가 품질 안내 없음'}</p></DataIdentifiers>
  </div></details>
}
