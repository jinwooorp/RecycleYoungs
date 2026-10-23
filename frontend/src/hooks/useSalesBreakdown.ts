import { useEffect, useState } from 'react'
import { getSalesBreakdown } from '../api/contextApi'
import type { SalesBreakdown } from '../types/context'
import { useScoreRequestKey } from './useScoreRequestKey'

export function useSalesBreakdown(code: string, quarter: string, dataVersion = 'legacy-unversioned') {
  const {requestKey,retry} = useScoreRequestKey(`${code}:${quarter}:${dataVersion}`)
  const [state,setState] = useState<{key:string;result:SalesBreakdown | null;error:string | null} | null>(null)
  useEffect(() => {
    if (!code || !quarter) return
    const controller = new AbortController()
    void getSalesBreakdown(code,quarter,dataVersion,controller.signal).then(result => {
      if (!controller.signal.aborted) setState({key:requestKey,result,error:null})
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({key:requestKey,result:null,error:error instanceof Error?error.message:'세부 매출 조회 실패'})
    })
    return () => controller.abort()
  }, [code,quarter,dataVersion,requestKey])
  const current = state?.key === requestKey ? state : null
  return {result:current?.result ?? null,error:current?.error ?? null,loading:!!code && !!quarter && !current,retry}
}
