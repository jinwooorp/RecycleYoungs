import { useEffect, useRef, useState } from 'react'
import { ApiFailure, getAdminDongs, getAdminDongStats, getAdminDongTrend, getIndustries, getQuarters } from '../api/adminDongApi'
import type { AdminDongStats, AdminDongTrend, Lookups, StatsQuery } from '../types/api'

function failure(error: unknown): ApiFailure {
  return error instanceof ApiFailure ? error : new ApiFailure('response', {
    code: 'INVALID_RESPONSE', message: '서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.', field: null,
  })
}

export function useAdminDongStats() {
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [lookupLoading, setLookupLoading] = useState(true)
  const [lookupError, setLookupError] = useState<ApiFailure | null>(null)
  const [lookupAttempt, setLookupAttempt] = useState(0)
  const [selection, setSelection] = useState<StatsQuery>({ dongCode: '', industryCode: '', quarterCode: '' })
  const [stats, setStats] = useState<AdminDongStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<ApiFailure | null>(null)
  const [trend, setTrend] = useState<AdminDongTrend | null>(null)
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendError, setTrendError] = useState<ApiFailure | null>(null)
  const searchRequest = useRef<AbortController | null>(null)

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
    searchRequest.current?.abort()
    searchRequest.current = null
    setSelection(current => ({ ...current, [field]: value }))
    setStats(null)
    setStatsError(null)
    setStatsLoading(false)
    setTrend(null)
    setTrendError(null)
    setTrendLoading(false)
  }

  async function search() {
    if (!lookups || !selection.dongCode || !selection.industryCode || !selection.quarterCode
      || (searchRequest.current && !searchRequest.current.signal.aborted)) return
    searchRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
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

  return { lookups, lookupLoading, lookupError, retryLookups, selection, changeSelection, search,
    stats, statsLoading, statsError, trend, trendLoading, trendError, searchLoading: statsLoading || trendLoading }
}
