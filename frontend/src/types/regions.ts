import type { PublicationMetadata } from './api'
export interface RegionDong { code: string; name: string; statisticsSupported: boolean; boundaryAvailable: boolean }
export interface RegionDistrict { code: string; name: string; dongs: RegionDong[] }
export interface Regions { city: string; catalogVersion: string; sourceUrl: string; boundaryVersion: string | null; districts: RegionDistrict[] }
export type Ring = [number, number][]
export type PolygonGeometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
export interface RegionBoundary {
  code: string; name: string; datasetVersion: string; sourceUrl: string; displayCrs: 4326
  qualityStatus: string; qualityDetail: string | null; historicalCompatibilityStatus: string
  validationStatus: string; referenceDate: string | null; referenceDateVerified: boolean; geometry: PolygonGeometry
}
export interface ConsumptionItem { dong: { code: string; name: string }; status: 'AVAILABLE' | 'UNAVAILABLE'; score: number | null; transactionCount: string | null; reason: string | null }
export interface ConsumptionScores {
  metadata?: PublicationMetadata
  quarter: { code: string; label: string }; modelVersion: string; baselineId: string; cohortSize: number; minimumCohortSize: number
  sourceUrl: string; sourceSnapshotStatus: 'UNVERIFIED'; items: ConsumptionItem[]
}
export interface ChangeItem {
  dong: { code: string; name: string }; status: 'AVAILABLE' | 'UNAVAILABLE'; score: number | null
  currentCount: string | null; previousCount: string | null; changeRate: string | null
  direction: 'INCREASE' | 'DECREASE' | 'UNCHANGED' | null; reason: string | null
}
export interface ChangeScores extends Omit<ConsumptionScores, 'items'> { previousQuarterCode: string; items: ChangeItem[] }
