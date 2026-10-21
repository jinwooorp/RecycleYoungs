export interface AdminDong { code: string; name: string }
export interface Industry { code: string; name: string }
export interface PublicationMetadata {
  dataVersion: string
  collectedAt: string
  storeReferenceMonth: string
  storeScope: 'I21201' | 'ALL_SOURCE_INDUSTRIES'
  sourceSnapshotStatus: 'UNVERIFIED'
}
export interface Quarter { code: string; label: string; metadata?: PublicationMetadata }
export interface StoreStats {
  storeCount: number | null
  similarStoreCount: number | null
  openingStoreCount: number | null
  closingStoreCount: number | null
  franchiseStoreCount: number | null
}
export interface SalesStats {
  estimatedSalesAmount: string | null
  transactionCount: string | null
  weekdayEstimatedSalesAmount: string | null
  weekendEstimatedSalesAmount: string | null
}
export interface MissingReasons {
  storeStats: 'NO_ROW' | null
  salesStats: 'NO_ROW' | null
}
export interface AdminDongStats {
  metadata?: PublicationMetadata
  dong: AdminDong
  industry: Industry
  quarter: Quarter
  storeStats: StoreStats | null
  salesStats: SalesStats | null
  missingReasons: MissingReasons
}
export interface ApiError { code: string; message: string; field: string | null }
export interface StatsQuery { dongCode: string; industryCode: string; quarterCode: string; dataVersion?: string }
export interface TrendQuery { dongCode: string; industryCode: string; dataVersion?: string }
export interface TrendQuarter {
  quarter: Quarter
  storeStats: StoreStats | null
  salesStats: SalesStats | null
  missingReasons: MissingReasons
}
export interface AdminDongTrend {
  metadata?: PublicationMetadata
  dong: AdminDong
  industry: Industry
  quarters: TrendQuarter[]
}
export interface Lookups { adminDongs: AdminDong[]; industries: Industry[]; quarters: Quarter[] }
