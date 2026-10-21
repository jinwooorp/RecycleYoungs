import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ApiFailure, getAdminDongs, getAdminDongStats, getAdminDongTrend, getIndustries, getQuarters } from '../api/adminDongApi'
import type { AdminDongStats, AdminDongTrend, Lookups, StatsQuery } from '../types/api'
import { samePublication } from '../lib/publication'

function failure(error: unknown): ApiFailure {
  return error instanceof ApiFailure ? error : new ApiFailure('response', {
    code: 'INVALID_RESPONSE', message: '서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.', field: null,
  })
}

export function useAdminDongStats(locationDongCode?: string, automatic = false) {
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [lookupLoading, setLookupLoading] = useState(true)
  const [lookupError, setLookupError] = useState<ApiFailure | null>(null)
  const [lookupAttempt, setLookupAttempt] = useState(0)
  const [manualSelection, setSelection] = useState<StatsQuery>({ dongCode: '', industryCode: 'CAFE', quarterCode: '' })
  const [quarterTouched, setQuarterTouched] = useState(false)
  const [selectionRevision, setSelectionRevision] = useState(0)
  // Derived selection also handles a location resolving before lookup loading/retry finishes.
  const quarterCode = automatic && !quarterTouched ? lookups?.quarters.at(-1)?.code ?? '' : manualSelection.quarterCode
  const version = lookups?.quarters.find(q => q.code === quarterCode)?.metadata?.dataVersion
  const selection = { ...manualSelection, quarterCode, ...(version ? { dataVersion: version } : {}), dongCode: locationDongCode === undefined ? manualSelection.dongCode
    : lookups?.adminDongs.some(dong => dong.code === locationDongCode) ? locationDongCode : '' }
  const [stats, setStats] = useState<AdminDongStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<ApiFailure | null>(null)
  const [trend, setTrend] = useState<AdminDongTrend | null>(null)
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendError, setTrendError] = useState<ApiFailure | null>(null)
  const searchRequest = useRef<AbortController | null>(null)
  const searchScope = useRef('')

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    Promise.all([getAdminDongs(signal), getIndustries(signal), getQuarters(signal)])
      .then(([adminDongs, industries, quarters]) => {
        if (!signal.aborted) setLookups({ adminDongs, industries, quarters })
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          setLookupError(failure(error))
          setLookupLoading(false)
          controller.abort()
        }
      })
      .finally(() => { if (!signal.aborted) setLookupLoading(false) })
    return () => controller.abort()
  }, [lookupAttempt])

  useEffect(() => () => searchRequest.current?.abort(), [])

  function retryLookups() {
    setLookupError(null)
    setLookupLoading(true)
    setLookupAttempt(attempt => attempt + 1)
  }

  function changeSelection(field: keyof StatsQuery, value: string) {
    if (field === 'industryCode') return
    if (field === 'quarterCode') setQuarterTouched(true)
    setSelectionRevision(n => n + 1)
    searchRequest.current?.abort()
    searchRequest.current = null
    setSelection(current => ({ ...current, [field]: value, industryCode: 'CAFE' }))
    setStats(null)
    setStatsError(null)
    setStatsLoading(false)
    setTrend(null)
    setTrendError(null)
    setTrendLoading(false)
  }

  async function search() {
    const scope = `${selection.dongCode}:${selection.industryCode}:${selection.quarterCode}:${selection.dataVersion ?? ''}`
    if (!lookups || !selection.dongCode || !selection.industryCode || !selection.quarterCode
      || !lookups.adminDongs.some(dong => dong.code === selection.dongCode)
      || !lookups.industries.some(industry => industry.code === selection.industryCode)
      || !lookups.quarters.some(quarter => quarter.code === selection.quarterCode)
      || (searchRequest.current && !searchRequest.current.signal.aborted && searchScope.current === scope)) return
    searchRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
    searchScope.current = scope
    const current = () => !controller.signal.aborted && searchRequest.current === controller
    setStats(null)
    setStatsError(null)
    setStatsLoading(true)
    setTrend(null)
    setTrendError(null)
    setTrendLoading(true)
    const statsTask = getAdminDongStats(selection, controller.signal)
      .then(result => { if (current()) setStats(result) })
      .catch((error: unknown) => { if (current()) setStatsError(failure(error)) })
      .finally(() => { if (current()) setStatsLoading(false) })
    const trendTask = getAdminDongTrend(selection, controller.signal)
      .then(result => { if (current()) setTrend(result) })
      .catch((error: unknown) => { if (current()) setTrendError(failure(error)) })
      .finally(() => { if (current()) setTrendLoading(false) })
    await Promise.allSettled([statsTask, trendTask])
    if (current()) searchRequest.current = null
  }

  const automaticSearch = useEffectEvent(() => { void search() })
  useEffect(() => {
    let cancelled = false
    // Coalesce a region/quarter change into one request after React commits it.
    if (automatic) queueMicrotask(() => { if (!cancelled) automaticSearch() })
    return () => { cancelled = true }
  }, [automatic, selection.dongCode, selection.quarterCode, selection.dataVersion, selectionRevision, lookups])

  const metadata = lookups?.quarters.find(q => q.code === selection.quarterCode)?.metadata
  return { lookups, lookupLoading, lookupError, retryLookups, selection, changeSelection, search,
    stats: stats && samePublication(stats.metadata, metadata) ? stats : null, statsLoading, statsError,
    trend: trend && samePublication(trend.metadata, metadata) ? trend : null, trendLoading, trendError,
    searchLoading: statsLoading || trendLoading }
}
