import type { NearbyResult } from '../types/nearby'
import type { MapCoordinate } from '../components/KakaoMap'

export function nearbyFixture(coordinate: MapCoordinate = { lat: 37.5665, lng: 126.978 }, count = 2): NearbyResult {
  return {
    coordinate, industryCode: 'CAFE', radiusMeters: 500, totalCount: String(count), listedCount: Math.min(count, 100),
    listLimit: 100, listComplete: count <= 100,
    stores: Array.from({ length: Math.min(count, 100) }, (_, n) => ({ sourceStoreId: `S${String(n).padStart(3, '0')}`,
      name: `합성 카페 ${n + 1}`, coordinate, distanceMeters: n * 2 })),
    data: { source: 'SEMAS', sourceCategoryCode: 'I21201', availability: 'AVAILABLE_RECORDS', snapshotStatus: 'UNVERIFIED',
      referenceDate: null, loadedAt: null, quality: { totalStoreCount: '300', cafeSourceCount: '220', usableCafeCount: '200',
        unclassifiedCafeCount: '10', missingLocationCafeCount: '5', invalidLocationCafeCount: '5', incompleteSourceCoordinateCafeCount: '8' } },
  }
}
