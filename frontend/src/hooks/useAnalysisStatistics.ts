import { useEffect, useState } from 'react'
import { ApiFailure, getAdminDongStats, getAdminDongTrend } from '../api/adminDongApi'
import type { AdminDongStats, AdminDongTrend, Lookups } from '../types/api'
const failure = (error: unknown) => error instanceof ApiFailure ? error : new ApiFailure('response', { code: 'INVALID_RESPONSE', message: '분석 응답을 확인하지 못했습니다.', field: null })
interface Result { key: string; stats: AdminDongStats | null; trend: AdminDongTrend | null; statsLoading: boolean; trendLoading: boolean; statsError: ApiFailure | null; trendError: ApiFailure | null }
export function useAnalysisStatistics(code: string, quarter: string, enabled: boolean, lookups: Lookups | null) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const dataVersion = lookups?.quarters.find(q => q.code === quarter)?.metadata?.dataVersion
  const key = `${code}:${quarter}:${dataVersion ?? ''}:${attempt}`
  const supported = enabled && !!lookups?.adminDongs.some(d => d.code === code) && !!lookups.industries.some(i => i.code === 'CAFE') && !!lookups.quarters.some(q => q.code === quarter)
  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    const initial: Result = { key, stats: null, trend: null, statsLoading: true, trendLoading: true, statsError: null, trendError: null }
    const update = (value: Partial<Result>) => { if (!controller.signal.aborted) setResult(current => ({ ...(current?.key === key ? current : initial), ...value })) }
    const query = { dongCode: code, industryCode: 'CAFE', quarterCode: quarter, ...(dataVersion ? { dataVersion } : {}) }
    void getAdminDongStats(query, controller.signal).then(stats => {
      if (stats.dong.code !== code || stats.quarter.code !== quarter || stats.industry.code !== 'CAFE') throw new Error('조건 불일치')
      update({ stats, statsLoading: false })
    }).catch(error => update({ statsError: failure(error), statsLoading: false }))
    void getAdminDongTrend(query, controller.signal).then(trend => {
      if (trend.dong.code !== code || trend.industry.code !== 'CAFE') throw new Error('조건 불일치')
      update({ trend, trendLoading: false })
    }).catch(error => update({ trendError: failure(error), trendLoading: false }))
    return () => controller.abort()
  }, [code, quarter, dataVersion, key, supported])
  const current = result?.key === key && enabled ? result : null
  return { stats: current?.stats ?? null, trend: current?.trend ?? null, statsLoading: supported && (current?.statsLoading ?? true), trendLoading: supported && (current?.trendLoading ?? true),
    statsError: current?.statsError ?? null, trendError: current?.trendError ?? null, searchLoading: supported && (!current || current.statsLoading || current.trendLoading), search: async () => { setAttempt(n => n + 1) } }
}
