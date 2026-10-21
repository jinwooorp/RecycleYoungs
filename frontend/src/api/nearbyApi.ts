import { get } from './adminDongApi'
import { validPublication } from '../lib/publication'
import type { MapCoordinate } from '../components/KakaoMap'
import type { NearbyResult, NearbyStore } from '../types/nearby'

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const count = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v)
  && BigInt(v) <= 9223372036854775807n
function coordinate(v: unknown): v is MapCoordinate {
  return record(v) && typeof v.lat === 'number' && Number.isFinite(v.lat) && Math.abs(v.lat) <= 90
    && typeof v.lng === 'number' && Number.isFinite(v.lng) && Math.abs(v.lng) <= 180
}
function store(v: unknown): v is NearbyStore {
  return record(v) && text(v.sourceStoreId) && (v.name === null || text(v.name)) && coordinate(v.coordinate)
    && typeof v.distanceMeters === 'number' && Number.isFinite(v.distanceMeters) && v.distanceMeters >= 0 && v.distanceMeters <= 500
}
const ordered = (stores: NearbyStore[]) => stores.every((s, i) => i === 0 || s.distanceMeters >= stores[i - 1].distanceMeters)
function valid(v: unknown, requested: MapCoordinate): v is NearbyResult {
  if (!record(v) || !coordinate(v.coordinate) || v.coordinate.lat !== requested.lat || v.coordinate.lng !== requested.lng
    || v.industryCode !== 'CAFE' || v.radiusMeters !== 500 || !count(v.totalCount)
    || v.listLimit !== 100 || !Number.isInteger(v.listedCount) || typeof v.listComplete !== 'boolean'
    || !Array.isArray(v.stores) || !v.stores.every(store) || v.listedCount !== v.stores.length
    || v.stores.length !== Number(BigInt(v.totalCount) < 100n ? BigInt(v.totalCount) : 100n)
    || v.listComplete !== (BigInt(v.totalCount) === BigInt(v.stores.length))
    || new Set(v.stores.map(s => s.sourceStoreId)).size !== v.stores.length
    || !ordered(v.stores)
    || !record(v.data) || !validPublication(v.data.metadata) || v.data.source !== 'SEMAS' || v.data.sourceCategoryCode !== 'I21201'
    || v.data.availability !== 'AVAILABLE_RECORDS' || v.data.snapshotStatus !== 'UNVERIFIED'
    || v.data.referenceDate !== null || v.data.loadedAt !== null || !record(v.data.quality)) return false
  const q = v.data.quality
  const fields = ['totalStoreCount', 'cafeSourceCount', 'usableCafeCount', 'unclassifiedCafeCount',
    'missingLocationCafeCount', 'invalidLocationCafeCount', 'incompleteSourceCoordinateCafeCount'] as const
  if (!fields.every(f => count(q[f]))) return false
  const total = BigInt(q.totalStoreCount as string), sources = BigInt(q.cafeSourceCount as string), usable = BigInt(q.usableCafeCount as string)
  return total > 0n && sources <= total && usable > 0n && usable <= sources && BigInt(v.totalCount) <= usable
    && fields.slice(3).every(f => BigInt(q[f] as string) <= sources)
}

export function getNearbyStores(c: MapCoordinate, signal?: AbortSignal): Promise<NearbyResult> {
  const query = new URLSearchParams({ lat: String(c.lat), lng: String(c.lng), radius: '500', industryCode: 'CAFE' })
  return get(`/api/nearby-stores?${query}`, (body): body is NearbyResult => valid(body, c), signal)
}
