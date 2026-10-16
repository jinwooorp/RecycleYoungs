import { get } from './adminDongApi'
import type { ChangeScores, ConsumptionScores, PolygonGeometry, RegionBoundary, Regions, Ring } from '../types/regions'
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string'
const nullableText = (v: unknown) => v === null || text(v)
const code = (v: unknown): v is string => text(v) && /^11[0-9]{6}$/.test(v)
const ring = (v: unknown): v is Ring => Array.isArray(v) && v.length >= 4 && v.every(p => Array.isArray(p) && p.length === 2
  && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90)
  && v[0][0] === v[v.length - 1][0] && v[0][1] === v[v.length - 1][1]
const polygon = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(ring)
export function validGeometry(v: unknown): v is PolygonGeometry {
  return object(v) && (v.type === 'Polygon' ? polygon(v.coordinates) : v.type === 'MultiPolygon'
    && Array.isArray(v.coordinates) && v.coordinates.length > 0 && v.coordinates.every(polygon))
}
function regions(v: unknown): v is Regions {
  return object(v) && v.city === '서울특별시' && text(v.catalogVersion) && text(v.sourceUrl) && nullableText(v.boundaryVersion)
    && Array.isArray(v.districts) && v.districts.every(d => object(d) && text(d.code) && /^11[0-9]{3}$/.test(d.code)
      && text(d.name) && Array.isArray(d.dongs) && d.dongs.every(a => object(a) && code(a.code) && a.code.startsWith(d.code as string)
      && text(a.name) && typeof a.statisticsSupported === 'boolean' && typeof a.boundaryAvailable === 'boolean'))
}
function boundary(v: unknown): v is RegionBoundary {
  return object(v) && code(v.code) && text(v.name) && text(v.datasetVersion) && text(v.sourceUrl) && v.displayCrs === 4326
    && text(v.qualityStatus) && nullableText(v.qualityDetail) && text(v.historicalCompatibilityStatus) && text(v.validationStatus)
    && nullableText(v.referenceDate) && typeof v.referenceDateVerified === 'boolean' && validGeometry(v.geometry)
}
const decimal = (v: unknown) => v === null || text(v) && /^-?(0|[1-9][0-9]*)$/.test(v)
function scores(v: unknown): v is ConsumptionScores {
  return object(v) && object(v.quarter) && text(v.quarter.code) && text(v.quarter.label) && text(v.modelVersion)
    && text(v.baselineId) && Number.isInteger(v.cohortSize) && (v.cohortSize as number) >= 0
    && Number.isInteger(v.minimumCohortSize) && text(v.sourceUrl) && v.sourceSnapshotStatus === 'UNVERIFIED'
    && Array.isArray(v.items) && v.items.every(i => object(i) && object(i.dong) && code(i.dong.code) && text(i.dong.name)
      && decimal(i.transactionCount) && (i.status === 'AVAILABLE' ? Number.isInteger(i.score) && (i.score as number) >= 0
      && (i.score as number) <= 100 && i.reason === null && i.transactionCount !== null
      && BigInt(i.transactionCount as string) >= 0n && (v.cohortSize as number) >= (v.minimumCohortSize as number)
      : i.status === 'UNAVAILABLE' && i.score === null && text(i.reason)))
}
export const getRegions = (signal?: AbortSignal) => get('/api/regions', regions, signal)
export const getRegionBoundary = (code: string, version: string | null, signal?: AbortSignal) =>
  get(`/api/regions/admin-dongs/${code}/boundary${version ? '?datasetVersion=' + encodeURIComponent(version) : ''}`, boundary, signal)
export const getConsumptionScores = (codes: string[], quarter: string, signal?: AbortSignal) =>
  get('/api/cafe-consumption-scores?' + new URLSearchParams({ dongCodes: codes.join(','), quarterCode: quarter }), scores, signal)

function changeScores(v: unknown): v is ChangeScores {
  if (!object(v) || !object(v.quarter) || !text(v.quarter.code) || !text(v.quarter.label) || !text(v.previousQuarterCode)
    || !text(v.modelVersion) || !text(v.baselineId) || !Number.isInteger(v.cohortSize) || (v.cohortSize as number) < 0
    || !Number.isInteger(v.minimumCohortSize) || (v.minimumCohortSize as number) < 2 || !text(v.sourceUrl)
    || v.sourceSnapshotStatus !== 'UNVERIFIED' || !Array.isArray(v.items)) return false
  return v.items.every(i => object(i) && object(i.dong) && code(i.dong.code) && text(i.dong.name)
    && decimal(i.currentCount) && decimal(i.previousCount) && (i.changeRate === null || text(i.changeRate) && /^-?[0-9]+\.[0-9]{4}$/.test(i.changeRate))
    && (i.direction === null || ['INCREASE', 'DECREASE', 'UNCHANGED'].includes(i.direction as string))
    && (i.status === 'AVAILABLE' ? Number.isInteger(i.score) && (i.score as number) >= 0 && (i.score as number) <= 100
      && i.reason === null && i.changeRate !== null && i.currentCount !== null && i.previousCount !== null
      && BigInt(i.currentCount as string) >= 0n && BigInt(i.previousCount as string) > 0n && i.direction !== null
      && (v.cohortSize as number) >= (v.minimumCohortSize as number)
      : i.status === 'UNAVAILABLE' && i.score === null && text(i.reason)))
}
export const getChangeScores = (codes: string[], quarter: string, signal?: AbortSignal) =>
  get('/api/cafe-change-scores?' + new URLSearchParams({ dongCodes: codes.join(','), quarterCode: quarter }), changeScores, signal)
