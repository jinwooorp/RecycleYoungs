import { useEffect, useRef, useState } from 'react'
import { ApiFailure } from '../api/adminDongApi'
import { getNearbyStores } from '../api/nearbyApi'
import type { MapCoordinate } from '../components/KakaoMap'
import type { NearbyResult } from '../types/nearby'

export function useNearbyStores() {
  const [result, setResult] = useState<NearbyResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiFailure | null>(null)
  const request = useRef<AbortController | null>(null)
  const requestId = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current?.abort(); request.current = null }
  }, [])
  function clear() {
    request.current?.abort(); request.current = null; requestId.current++
    setResult(null); setError(null); setLoading(false)
  }
  function resolve(coordinate: MapCoordinate) {
    clear()
    const id = ++requestId.current
    const controller = new AbortController()
    request.current = controller
    const current = () => mounted.current && id === requestId.current && !controller.signal.aborted
    setLoading(true)
    void getNearbyStores(coordinate, controller.signal)
      .then(value => { if (current()) setResult(value) })
      .catch((reason: unknown) => {
        if (current()) setError(reason instanceof ApiFailure ? reason : new ApiFailure('response', {
          code: 'INVALID_RESPONSE', message: '경쟁 카페 응답을 확인할 수 없습니다. 다시 시도해 주세요.', field: null,
        }))
      })
      .finally(() => { if (current()) { setLoading(false); request.current = null } })
  }
  return { result, loading, error, resolve, clear }
}
