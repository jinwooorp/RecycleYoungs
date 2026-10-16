import { useEffect, useState } from 'react'
import { parseAnalysisRoute } from '../lib/analysisRoute'
const read = () => parseAnalysisRoute(window.location.pathname, window.location.search)
export function useAnalysisRoute() {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const update = () => setRoute(read())
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  function open(code: string, quarter: string, point: string | false, replace = false) {
    const params = new URLSearchParams()
    if (code) params.set('dongCode', code)
    params.set('quarterCode', quarter)
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method]({ ...window.history.state, analysisFromMap: replace ? !!window.history.state?.analysisFromMap : !route.detail, analysisPoint: point }, '', '/analysis?' + params)
    setRoute(read())
  }
  function close() {
    if (window.history.state?.analysisFromMap) window.history.back()
    else { window.history.replaceState(null, '', '/'); setRoute(read()) }
  }
  const pointKey = typeof window.history.state?.analysisPoint === 'string' ? window.history.state.analysisPoint as string : ''
  return { ...route, point: !!pointKey, pointKey, open, close }
}
