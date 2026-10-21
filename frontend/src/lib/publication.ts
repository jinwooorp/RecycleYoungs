import type { PublicationMetadata } from '../types/api'

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function validPublication(v: unknown): v is PublicationMetadata | undefined {
  return v === undefined || object(v) && typeof v.dataVersion === 'string' && /^[0-9a-f]{64}$/.test(v.dataVersion)
    && typeof v.collectedAt === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v.collectedAt)
    && Number.isFinite(Date.parse(v.collectedAt))
    && typeof v.storeReferenceMonth === 'string' && /^[12][0-9]{3}(0[1-9]|1[0-2])$/.test(v.storeReferenceMonth)
    && ['I21201', 'ALL_SOURCE_INDUSTRIES'].includes(v.storeScope as string) && v.sourceSnapshotStatus === 'UNVERIFIED'
}
export const publicationVersion = (metadata?: PublicationMetadata) => metadata?.dataVersion ?? 'legacy-unversioned'
export function matchesPublication(value: unknown, expected?: string) {
  return validPublication(value) && (expected === undefined || publicationVersion(value) === expected)
}
export function samePublication(a?: PublicationMetadata, b?: PublicationMetadata) {
  return publicationVersion(a) === publicationVersion(b)
}
export const validQuarterCode = (code: string) => /^[1-9][0-9]{3}[1-4]$/.test(code)
export const quarterIndex = (code: string) => Number(code.slice(0, 4)) * 4 + Number(code[4]) - 1
