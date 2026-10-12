import type { MapCoordinate } from '../components/KakaoMap'

export interface SpatialDataset {
  version: string
  datasetId: 'OA-22160' | 'OA-15560'
  datasetName: string
  sourceUrl: string
  sourceCrs: 5181
  referenceDate: string | null
  referenceDateVerified: boolean
  historicalCompatibilityStatus: 'UNRESOLVED' | 'VERIFIED'
  validationStatus: 'PASSED' | 'PASSED_WITH_LIMITATIONS'
  loadedAt: string
}
export interface BoundaryMatch {
  code: string
  name: string
  datasetVersion: string
  qualityStatus: 'VALID_SOURCE' | 'REPAIRED_OPERATIONAL'
  qualityDetail: string | null
  pointRelation: 'INTERIOR' | 'BOUNDARY'
}
export interface CommercialMembership extends BoundaryMatch {
  sourceAttributeStatus: 'UNVERIFIED' | 'CONFLICT_OBSERVED'
  sourceAttributeDetail: string | null
}
export interface LocationResolution {
  coordinate: MapCoordinate
  adminDong: {
    status: 'RESOLVED' | 'OUTSIDE_OR_UNSUPPORTED' | 'AMBIGUOUS_BOUNDARY'
    reason: 'NO_COVERING_OPERATIONAL_BOUNDARY' | null
    resolvedDong: BoundaryMatch | null
    candidates: BoundaryMatch[]
    dataset: SpatialDataset
  }
  commercialArea: {
    status: 'NO_MEMBERSHIP' | 'MEMBERSHIP'
    memberships: CommercialMembership[]
    dataset: SpatialDataset
  }
}
