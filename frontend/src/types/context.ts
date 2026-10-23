import type { AdminDong, PublicationMetadata, Quarter } from './api'

export const contextKeys = ['population', 'residents', 'workers', 'facilities', 'change', 'consumption'] as const
export type ContextKey = typeof contextKeys[number]
export interface ContextMetric {
  value: string | null
  valueState: 'REPORTED' | 'SOURCE_NULL'
  unit: 'PERSON' | 'HOUSEHOLD' | 'FACILITY' | 'MONTH'
  temporalAggregation: 'SOURCE_REPORTED' | 'UNKNOWN'
}
export interface ContextSection {
  state: 'REFERENCE' | 'NO_ROW' | 'NO_PERIOD' | 'WITHHELD'
  reasonCodes: string[]
  metrics: Record<string, ContextMetric> | null
  attributes: Record<string, string | null> | null
  provenance: {
    sourceId: string; datasetId: string; sourceUrl: string; runId: string | null
    sourceQuarter: string | null; observedAt: string | null; collectedAt: string | null; refreshModel: string
  }
  spatialCompatibility: 'HISTORICAL_UNVERIFIED'
  scoreReady: boolean
}
export interface AdminDongContext {
  dong: AdminDong; quarter: Quarter; metadata: PublicationMetadata
  spatialUnit: 'ADMINISTRATIVE_DONG'; contextPolicyVersion: string
  sections: Record<ContextKey, ContextSection>
}
export interface SalesTotals { estimatedSalesAmount: string | null; transactionCount: string | null }
export interface SalesItem extends SalesTotals { code: string }
export interface SalesBreakdown {
  dong: AdminDong; industry: { code: 'CAFE'; name: string }; quarter: Quarter; metadata?: PublicationMetadata
  sales: ({ totals: SalesTotals } & Record<'dayTypes' | 'weekdays' | 'timeSlots' | 'sexes' | 'ages', SalesItem[]>) | null
  missingReason: 'NO_ROW' | null
}
