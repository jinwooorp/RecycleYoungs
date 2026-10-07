import type { AdminDong, AdminDongStats, AdminDongTrend, ApiError, Industry, Quarter, StatsQuery, TrendQuery } from '../types/api'

export class ApiFailure extends Error {
  readonly kind: 'http' | 'network' | 'response'
  readonly code: string
  readonly field: string | null
  readonly status: number | null

  constructor(kind: ApiFailure['kind'], error: ApiError, status: number | null = null) {
    super(error.message)
    this.name = 'ApiFailure'
    this.kind = kind
    this.code = error.code
    this.field = error.field
    this.status = status
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const namedCode = (value: unknown): value is AdminDong =>
  record(value) && typeof value.code === 'string' && typeof value.name === 'string'
const quarter = (value: unknown): value is Quarter =>
  record(value) && typeof value.code === 'string' && typeof value.label === 'string'
const namedCodes = (value: unknown): value is AdminDong[] => Array.isArray(value) && value.every(namedCode)
const quarters = (value: unknown): value is Quarter[] => Array.isArray(value) && value.every(quarter)
const integer = (value: unknown) => value === null || (typeof value === 'number'
  && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)
function decimal(value: unknown) {
  if (value === null) return true
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value)) return false
  const exact = BigInt(value)
  return exact >= -9223372036854775808n && exact <= 9223372036854775807n
}

function statSections(value: Record<string, unknown>) {
  if (!record(value.missingReasons)) return false
  const store = value.storeStats
  const sales = value.salesStats
  const validStore = store === null || (record(store) &&
    ['storeCount', 'similarStoreCount', 'openingStoreCount', 'closingStoreCount', 'franchiseStoreCount'].every(key => integer(store[key])))
  const validSales = sales === null || (record(sales) &&
    ['estimatedSalesAmount', 'transactionCount', 'weekdayEstimatedSalesAmount', 'weekendEstimatedSalesAmount'].every(key => decimal(sales[key])))
  return validStore && validSales
    && value.missingReasons.storeStats === (store === null ? 'NO_ROW' : null)
    && value.missingReasons.salesStats === (sales === null ? 'NO_ROW' : null)
}

function stats(value: unknown): value is AdminDongStats {
  return record(value) && namedCode(value.dong) && namedCode(value.industry) && quarter(value.quarter) && statSections(value)
}

const trendCodes = ['20251', '20252', '20253', '20254']
function trend(value: unknown): value is AdminDongTrend {
  return record(value) && namedCode(value.dong) && namedCode(value.industry)
    && Array.isArray(value.quarters) && value.quarters.length === 4
    && value.quarters.every((item, index) => record(item) && quarter(item.quarter)
      && item.quarter.code === trendCodes[index] && item.quarter.label === `2025년 ${index + 1}분기`
      && statSections(item))
}

const errorCodes = new Set([
  'INVALID_PARAMETER', 'INVALID_DONG_CODE', 'UNKNOWN_DONG', 'INVALID_INDUSTRY_CODE',
  'UNKNOWN_INDUSTRY', 'UNSUPPORTED_INDUSTRY', 'INVALID_QUARTER', 'UNSUPPORTED_QUARTER',
  'DATA_INTEGRITY_ERROR', 'INTERNAL_ERROR',
])

function apiError(value: unknown): value is ApiError {
  return record(value) && typeof value.code === 'string' && errorCodes.has(value.code) && typeof value.message === 'string'
    && (value.field === null || typeof value.field === 'string')
}

async function get<T>(path: string, valid: (body: unknown) => body is T, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { signal, headers: { Accept: 'application/json' } })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiFailure('network', {
      code: 'NETWORK_ERROR', message: '서버에 연결할 수 없습니다. 연결 상태를 확인하고 다시 시도해 주세요.', field: null,
    })
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    // A proxy or unavailable server can return an HTML error body.
    body = undefined
  }
  if (!response.ok) {
    throw new ApiFailure('http', apiError(body) ? body : {
      code: 'HTTP_ERROR', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', field: null,
    }, response.status)
  }
  if (!valid(body)) {
    throw new ApiFailure('response', {
      code: 'INVALID_RESPONSE', message: '서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.', field: null,
    }, response.status)
  }
  return body
}

export const getAdminDongs = (signal?: AbortSignal) => get<AdminDong[]>('/api/admin-dongs', namedCodes, signal)
export const getIndustries = (signal?: AbortSignal) => get<Industry[]>('/api/industries', namedCodes, signal)
export const getQuarters = (signal?: AbortSignal) => get<Quarter[]>('/api/quarters', quarters, signal)
export const getAdminDongStats = (query: StatsQuery, signal?: AbortSignal) => {
  const parameters = new URLSearchParams({ dongCode: query.dongCode, industryCode: query.industryCode, quarterCode: query.quarterCode })
  return get<AdminDongStats>(`/api/admin-dong-stats?${parameters}`, stats, signal)
}
export const getAdminDongTrend = (query: TrendQuery, signal?: AbortSignal) => {
  const parameters = new URLSearchParams({ dongCode: query.dongCode, industryCode: query.industryCode })
  return get<AdminDongTrend>(`/api/admin-dong-trends?${parameters}`, trend, signal)
}
