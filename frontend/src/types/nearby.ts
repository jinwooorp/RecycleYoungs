import type { MapCoordinate } from '../components/KakaoMap'

export interface NearbyStore {
  sourceStoreId: string
  name: string | null
  coordinate: MapCoordinate
  distanceMeters: number
}
export interface NearbyResult {
  coordinate: MapCoordinate
  industryCode: 'CAFE'
  radiusMeters: 500
  totalCount: string
  listedCount: number
  listLimit: 100
  listComplete: boolean
  stores: NearbyStore[]
  data: {
    source: 'SEMAS'
    sourceCategoryCode: 'I21201'
    availability: 'AVAILABLE_RECORDS'
    snapshotStatus: 'UNVERIFIED'
    referenceDate: null
    loadedAt: null
    quality: {
      totalStoreCount: string
      cafeSourceCount: string
      usableCafeCount: string
      unclassifiedCafeCount: string
      missingLocationCafeCount: string
      invalidLocationCafeCount: string
      incompleteSourceCoordinateCafeCount: string
    }
  }
}
