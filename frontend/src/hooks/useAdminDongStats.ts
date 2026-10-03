import { useEffect, useRef, useState } from 'react'
import { ApiFailure, getAdminDongs, getAdminDongStats, getIndustries, getQuarters } from '../api/adminDongApi'
import type { AdminDongStats, Lookups, StatsQuery } from '../types/api'

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
  const statsRequest = useRef<AbortController | null>(null)

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

  useEffect(() => () => statsRequest.current?.abort(), [])

  function retryLookups() {
    setLookupError(null)
    setLookupLoading(true)
    setLookupAttempt(attempt => attempt + 1)
  }

  function changeSelection(field: keyof StatsQuery, value: string) {
    statsRequest.current?.abort()
    statsRequest.current = null
    setSelection(current => ({ ...current, [field]: value }))
    setStats(null)
    setStatsError(null)
    setStatsLoading(false)
  }

  async function search() {
    if (!lookups || !selection.dongCode || !selection.industryCode || !selection.quarterCode
      || (statsRequest.current && !statsRequest.current.signal.aborted)) return
    statsRequest.current?.abort()
    const controller = new AbortController()
    statsRequest.current = controller
    setStats(null)
    setStatsError(null)
    setStatsLoading(true)
    try {
      const result = await getAdminDongStats(selection, controller.signal)
      if (!controller.signal.aborted && statsRequest.current === controller) setStats(result)
    } catch (error) {
      if (!controller.signal.aborted && statsRequest.current === controller) setStatsError(failure(error))
    } finally {
      if (!controller.signal.aborted && statsRequest.current === controller) {
        statsRequest.current = null
        setStatsLoading(false)
      }
    }
  }

  return { lookups, lookupLoading, lookupError, retryLookups, selection, changeSelection, search, stats, statsLoading, statsError }
}
