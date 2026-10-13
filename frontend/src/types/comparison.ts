import type { ApiFailure } from '../api/adminDongApi'
import type { MapCoordinate } from '../components/KakaoMap'
import type { AdminDongStats } from './api'
import type { LocationResolution } from './location'
import type { NearbyResult } from './nearby'

export interface CandidateValues {
  location: LocationResolution
  nearby: NearbyResult
  stats: AdminDongStats
}
export interface CandidateRequest<T> { result: T | null; loading: boolean; error: ApiFailure | null }
export type Candidate = {
  id: string
  order: number
  number: number
  coordinate: MapCoordinate
  statsQuarter: string | null
} & { [K in keyof CandidateValues]: CandidateRequest<CandidateValues[K]> }
export type StatsBlockReason = 'LOOKUP_LOADING' | 'LOOKUP_ERROR' | 'NO_CAFE' | 'NO_QUARTER'
  | 'LOCATION_LOADING' | 'LOCATION_ERROR' | 'AMBIGUOUS' | 'OUTSIDE' | 'NO_DONG_LOOKUP'
