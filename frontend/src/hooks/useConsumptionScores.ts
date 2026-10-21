import { useEffect, useState } from 'react'
import { getConsumptionScores } from '../api/regionApi'
import type { ConsumptionScores } from '../types/regions'
import { useScoreRequestKey } from './useScoreRequestKey'

export function useConsumptionScores(codes: string[], quarter: string, dataVersion?: string) {
  const key = [...new Set(codes)].sort().join(',')
  const { requestKey, retry } = useScoreRequestKey(`${key}:${quarter}:${dataVersion ?? ''}`)
  const [state, setState] = useState<{ key: string; value: ConsumptionScores | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!key || !quarter) return
    const controller = new AbortController()
    const requested = key.split(',')
    const load = dataVersion ? getConsumptionScores(requested, quarter, controller.signal, dataVersion) : getConsumptionScores(requested, quarter, controller.signal)
    void load.then(value => {
      if (controller.signal.aborted) return
      if (value.quarter.code !== quarter || value.items.length !== requested.length
        || new Set(value.items.map(i => i.dong.code)).size !== requested.length || value.items.some(i => !requested.includes(i.dong.code)))
        throw new Error('점수의 지역·분기 응답이 요청과 일치하지 않습니다.')
      setState({ key: requestKey, value, error: null })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ key: requestKey, value: null, error: error instanceof Error ? error.message : '점수 조회 실패' })
    })
    return () => controller.abort()
  }, [key, quarter, dataVersion, requestKey])
  const current = state?.key === requestKey ? state : null
  return { result: current?.value ?? null, error: current?.error ?? null,
    loading: !!key && !!quarter && !current, retry }
}
