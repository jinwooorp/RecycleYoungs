import { useEffect, useState } from 'react'
import { getAdminDongContext } from '../api/contextApi'
import type { AdminDongContext } from '../types/context'
import { useScoreRequestKey } from './useScoreRequestKey'

type Entry = { controller: AbortController; promise: Promise<AdminDongContext>; users: number }
const pending = new Map<string, Entry>()
function acquire(code: string, quarter: string, version: string, revision: number) {
  const key = `${code}:${quarter}:${version}:${revision}`
  let entry = pending.get(key)
  if (!entry) {
    const controller = new AbortController()
    entry = {controller,users:0,promise:getAdminDongContext(code,quarter,version,controller.signal)}
    pending.set(key,entry)
  }
  entry.users++
  return {promise:entry.promise, release:() => {
    entry!.users--
    if (entry!.users === 0) { entry!.controller.abort(); pending.delete(key) }
  }}
}
export function useAdminDongContext(codes: string[], quarter: string, dataVersion = 'legacy-unversioned') {
  const codeKey = [...new Set(codes)].sort().join(',')
  const {requestKey,retry} = useScoreRequestKey(`${codeKey}:${quarter}:${dataVersion}`)
  const [revision,setRevision] = useState(0)
  const [state,setState] = useState<{key:string; results:Record<string,AdminDongContext>; errors:Record<string,string>; done:string[]} | null>(null)
  useEffect(() => {
    if (!codeKey || !quarter) return
    let active = true
    const subscriptions = codeKey.split(',').map(code => {
      const subscription = acquire(code,quarter,dataVersion,revision)
      const save = (value: AdminDongContext | null, error: string | null) => {
        if (!active) return
        setState(previous => {
          const current = previous?.key === requestKey ? previous : {key:requestKey,results:{},errors:{},done:[]}
          return {key:requestKey, results:value?{...current.results,[code]:value}:current.results,
            errors:error?{...current.errors,[code]:error}:current.errors,done:[...current.done,code]}
        })
      }
      void subscription.promise.then(value => save(value,null)).catch((error: unknown) =>
        save(null,error instanceof Error ? error.message : '참고 지표 조회 실패'))
      return subscription
    })
    return () => { active = false; subscriptions.forEach(s => s.release()) }
  }, [codeKey,quarter,dataVersion,requestKey,revision])
  const current = state?.key === requestKey ? state : null
  return {results:current?.results ?? {},errors:current?.errors ?? {},
    loading:!!codeKey && !!quarter && current?.done.length !== codeKey.split(',').length,
    retry:() => { setRevision(v => v+1); retry() }}
}
