import { useEffect, useState } from 'react'
import { getRegionBoundary, getRegions } from '../api/regionApi'
import type { RegionBoundary, Regions } from '../types/regions'

export function useRegions() {
  const [attempt, retry] = useState(0)
  const [state, setState] = useState<{ attempt: number; value: Regions | null; error: string | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void getRegions(controller.signal).then(value => {
      if (!controller.signal.aborted) setState({ attempt, value, error: null })
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setState({ attempt, value: null, error: e instanceof Error ? e.message : '지역 목록 조회 실패' })
    })
    return () => controller.abort()
  }, [attempt])
  const current = state?.attempt === attempt ? state : null
  return { result: current?.value ?? null, error: current?.error ?? null, loading: !current, retry: () => retry(n => n + 1) }
}

export function useRegionBoundary(code: string, version: string | null) {
  const [attempt, retry] = useState(0)
  const key = `${code}:${version}:${attempt}`
  const [state, setState] = useState<{ key: string; value: RegionBoundary | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!code) return
    const controller = new AbortController()
    void getRegionBoundary(code, version, controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (value.code !== code || version && value.datasetVersion !== version) throw new Error('선택 지역과 경계 버전이 일치하지 않습니다.')
      setState({ key, value, error: null })
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setState({ key, value: null, error: e instanceof Error ? e.message : '경계 표시 불가' })
    })
    return () => controller.abort()
  }, [code, version, key])
  const current = state?.key === key ? state : null
  return { result: code ? current?.value ?? null : null, error: code ? current?.error ?? null : null,
    loading: !!code && !current, retry: () => retry(n => n + 1) }
}
