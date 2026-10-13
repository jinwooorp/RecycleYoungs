import type { AdminDongStats, Lookups } from '../types/api'
import type { LocationResolution } from '../types/location'
import type { MapCoordinate } from '../components/KakaoMap'
import { resolvedLocation } from './locationFixture'
import { normalTrend } from './trendFixture'

export const comparisonLookups: Lookups = {
  adminDongs: [normalTrend.dong, { code: '11260550', name: '면목5동' }],
  industries: [{ code: 'CAFE', name: '카페' }, { code: 'PUB', name: '주점' }],
  quarters: normalTrend.quarters.map(q => q.quarter),
}
export function comparisonLocation(coordinate: MapCoordinate, code = '11110515', version = '1', commercialVersion = '2'): LocationResolution {
  const value = structuredClone(resolvedLocation)
  value.coordinate = { ...coordinate }
  value.adminDong.dataset.version = version
  value.adminDong.resolvedDong = { ...value.adminDong.resolvedDong!, code,
    name: comparisonLookups.adminDongs.find(d => d.code === code)?.name ?? '통계 연결 없는 합성 동', datasetVersion: version }
  value.commercialArea.dataset.version = commercialVersion
  value.commercialArea.memberships.forEach(m => { m.datasetVersion = commercialVersion })
  return value
}
export function comparisonStats(dongCode = '11110515', quarterCode = '20251'): AdminDongStats {
  const row = structuredClone(normalTrend.quarters.find(q => q.quarter.code === quarterCode)!)
  return { ...row, dong: comparisonLookups.adminDongs.find(d => d.code === dongCode) ?? { code: dongCode, name: '합성 동' },
    industry: normalTrend.industry }
}
