import { useEffect, useRef, useState } from 'react'
import { ApiFailure } from '../api/adminDongApi'
import { getLocationResolution } from '../api/locationApi'
import type { MapCoordinate } from '../components/KakaoMap'
import type { LocationResolution } from '../types/location'

export function useLocationResolution() {
  const [coordinate, setCoordinate] = useState<MapCoordinate | null>(null)
  const [result, setResult] = useState<LocationResolution | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiFailure | null>(null)
  const request = useRef<AbortController | null>(null)
  const requestId = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current?.abort(); request.current = null }
  }, [])

  function resolve(next: MapCoordinate) {
    request.current?.abort()
    const id = ++requestId.current
    const controller = new AbortController()
    request.current = controller
    const current = () => mounted.current && id === requestId.current && !controller.signal.aborted
    setCoordinate(next)
    setResult(null)
    setError(null)
    setLoading(true)
    void getLocationResolution(next, controller.signal)
      .then(value => { if (current()) setResult(value) })
      .catch((reason: unknown) => {
        if (current()) setError(reason instanceof ApiFailure ? reason : new ApiFailure('response', {
          code: 'INVALID_RESPONSE', message: '서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.', field: null,
        }))
      })
      .finally(() => { if (current()) { setLoading(false); request.current = null } })
  }

  function clear() {
    request.current?.abort(); request.current = null; requestId.current++
    setCoordinate(null); setResult(null); setLoading(false); setError(null)
  }
  return { coordinate, result, loading, error, resolve, clear }
}
