import { get } from './adminDongApi'
import type { MapCoordinate } from '../components/KakaoMap'
import type { LocationResolution } from '../types/location'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const nullableText = (value: unknown) => value === null || nonempty(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n
function validDataset(value: unknown, kind: string): value is Record<string, unknown> {
  return record(value) && version(value.version) && value.datasetId === kind && nonempty(value.datasetName)
    && nonempty(value.sourceUrl) && /^https?:\/\//.test(value.sourceUrl) && value.sourceCrs === 5181
    && (value.referenceDate === null || (typeof value.referenceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.referenceDate)
      && Number.isFinite(Date.parse(value.referenceDate)) && new Date(value.referenceDate).toISOString().slice(0, 10) === value.referenceDate))
    && value.referenceDateVerified === (value.referenceDate !== null)
    && (value.historicalCompatibilityStatus === 'UNRESOLVED' || value.historicalCompatibilityStatus === 'VERIFIED')
    && (value.validationStatus === 'PASSED' || value.validationStatus === 'PASSED_WITH_LIMITATIONS')
    && typeof value.loadedAt === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.loadedAt)
    && Number.isFinite(Date.parse(value.loadedAt))
}
function validMatch(value: unknown, datasetVersion: unknown, code: RegExp): value is Record<string, unknown> {
  return record(value) && typeof value.code === 'string' && code.test(value.code) && nonempty(value.name)
    && value.datasetVersion === datasetVersion && (value.pointRelation === 'INTERIOR' || value.pointRelation === 'BOUNDARY')
    && (value.qualityStatus === 'VALID_SOURCE' ? value.qualityDetail === null
      : value.qualityStatus === 'REPAIRED_OPERATIONAL' && nonempty(value.qualityDetail))
}
function uniqueCodes(items: Record<string, unknown>[]) {
  return new Set(items.map(item => item.code)).size === items.length
}

function validResolution(body: unknown, coordinate: MapCoordinate): body is LocationResolution {
  if (!record(body) || !record(body.coordinate) || body.coordinate.lat !== coordinate.lat || body.coordinate.lng !== coordinate.lng
    || !record(body.adminDong) || !record(body.commercialArea)) return false
  const admin = body.adminDong, commercial = body.commercialArea
  if (!validDataset(admin.dataset, 'OA-22160') || !validDataset(commercial.dataset, 'OA-15560')) return false
  const adminVersion = admin.dataset.version, commercialVersion = commercial.dataset.version
  if (!Array.isArray(admin.candidates) || !admin.candidates.every(item => validMatch(item, adminVersion, /^[0-9]{8}$/))
    || !uniqueCodes(admin.candidates)) return false
  if (admin.status === 'RESOLVED') {
    if (admin.reason !== null || admin.candidates.length !== 0 || !validMatch(admin.resolvedDong, adminVersion, /^[0-9]{8}$/)) return false
  } else if (admin.status === 'AMBIGUOUS_BOUNDARY') {
    if (admin.reason !== null || admin.resolvedDong !== null || admin.candidates.length < 2) return false
  } else if (admin.status === 'OUTSIDE_OR_UNSUPPORTED') {
    if (admin.reason !== 'NO_COVERING_OPERATIONAL_BOUNDARY' || admin.resolvedDong !== null || admin.candidates.length !== 0) return false
  } else return false
  const memberships = commercial.memberships
  return Array.isArray(memberships) && memberships.every(item => validMatch(item, commercialVersion, /^[0-9]{1,20}$/)
    && nullableText(item.sourceAttributeDetail)
    && (item.sourceAttributeStatus === 'UNVERIFIED' ? item.sourceAttributeDetail === null
      : item.sourceAttributeStatus === 'CONFLICT_OBSERVED' && nonempty(item.sourceAttributeDetail)))
    && uniqueCodes(memberships) && commercial.status === (memberships.length === 0 ? 'NO_MEMBERSHIP' : 'MEMBERSHIP')
}

export function getLocationResolution(coordinate: MapCoordinate, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ lat: String(coordinate.lat), lng: String(coordinate.lng) })
  return get<LocationResolution>(`/api/locations/resolve?${parameters}`, (body): body is LocationResolution => validResolution(body, coordinate), signal)
}
