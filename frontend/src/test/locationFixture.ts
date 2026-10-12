import type { LocationResolution, SpatialDataset } from '../types/location'

export const adminDataset: SpatialDataset = {
  version: '1', datasetId: 'OA-22160', datasetName: '행정동 경계', sourceUrl: 'https://data.seoul.go.kr/',
  sourceCrs: 5181, referenceDate: null, referenceDateVerified: false,
  historicalCompatibilityStatus: 'UNRESOLVED', validationStatus: 'PASSED_WITH_LIMITATIONS', loadedAt: '2026-10-12T00:00:00Z',
}
export const resolvedLocation: LocationResolution = {
  coordinate: { lat: 37.5665, lng: 126.978 },
  adminDong: {
    status: 'RESOLVED', reason: null, candidates: [], dataset: adminDataset,
    resolvedDong: { code: '11110515', name: '청운효자동', datasetVersion: '1', qualityStatus: 'VALID_SOURCE', qualityDetail: null, pointRelation: 'INTERIOR' },
  },
  commercialArea: {
    status: 'MEMBERSHIP', dataset: { ...adminDataset, version: '2', datasetId: 'OA-15560', datasetName: '상권 경계' },
    memberships: [{ code: '1001', name: '테스트 상권 A', datasetVersion: '2', qualityStatus: 'VALID_SOURCE', qualityDetail: null,
      pointRelation: 'BOUNDARY', sourceAttributeStatus: 'UNVERIFIED', sourceAttributeDetail: null }],
  },
}
