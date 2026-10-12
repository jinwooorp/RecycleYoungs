import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from './ui/button'
import { loadKakaoMaps, mapLoadMessages } from '../lib/loadKakaoMaps'
import type { KakaoMapInstance, KakaoMapMouseEvent, KakaoMapsSDK, KakaoMarker } from '../types/kakao-maps'

export interface MapCoordinate { lat: number; lng: number }

function isValidCoordinate({ lat, lng }: MapCoordinate) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

const initializationError = '지도를 초기화하지 못했습니다. 다시 시도해 주세요.'

export function KakaoMap({ selectedCoordinate, onCoordinateChange }: {
  selectedCoordinate: MapCoordinate | null
  onCoordinateChange: (coordinate: MapCoordinate) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<KakaoMapInstance | null>(null)
  const marker = useRef<KakaoMarker | null>(null)
  const sdk = useRef<KakaoMapsSDK | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const onClick = useEffectEvent((event: KakaoMapMouseEvent) => {
    const coordinate = { lat: event.latLng.getLat(), lng: event.latLng.getLng() }
    if (isValidCoordinate(coordinate)) onCoordinateChange(coordinate)
  })

  useEffect(() => {
    const element = container.current
    if (!element) return
    let canceled = false
    let release: (() => void) | undefined
    function clearMap() {
      const releaseResources = release
      release = undefined
      releaseResources?.()
      marker.current?.setMap(null)
      marker.current = null
      map.current = null
      sdk.current = null
      element?.replaceChildren()
    }
    void loadKakaoMaps().then((maps) => {
      if (canceled) return
      try {
        const instance = new maps.Map(element, { center: new maps.LatLng(37.5665, 126.978), level: 4 })
        map.current = instance
        sdk.current = maps
        const handler = (event: KakaoMapMouseEvent) => { if (!canceled && map.current === instance) onClick(event) }
        const relayout = () => { if (!canceled && map.current === instance) instance.relayout() }
        const resources: { observer?: ResizeObserver } = {}
        // Prepare cleanup before any registration can partially succeed and throw.
        release = () => {
          maps.event.removeListener(instance, 'click', handler)
          resources.observer?.disconnect()
          window.removeEventListener('resize', relayout)
        }
        maps.event.addListener(instance, 'click', handler)
        resources.observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(relayout)
        if (resources.observer) resources.observer.observe(element)
        else window.addEventListener('resize', relayout)
        setStatus('ready')
      } catch {
        clearMap()
        setError(initializationError)
        setStatus('error')
      }
    }, (reason: unknown) => {
      if (canceled) return
      // Only known, key-free messages are allowed into the UI.
      setError(reason instanceof Error && Object.values(mapLoadMessages).includes(reason.message)
        ? reason.message : mapLoadMessages.failed)
      setStatus('error')
    })
    return () => {
      canceled = true
      clearMap()
    }
  }, [attempt])

  useEffect(() => {
    if (status !== 'ready' || !map.current || !sdk.current) return
    if (!selectedCoordinate || !isValidCoordinate(selectedCoordinate)) {
      marker.current?.setMap(null)
      return
    }
    const position = new sdk.current.LatLng(selectedCoordinate.lat, selectedCoordinate.lng)
    if (marker.current) {
      marker.current.setPosition(position)
      marker.current.setMap(map.current)
    } else {
      marker.current = new sdk.current.Marker({ map: map.current, position })
    }
  }, [selectedCoordinate, status])

  return (
    <div>
      <div ref={container} aria-label="창업 후보 위치 지도" aria-busy={status === 'loading'}
        className="h-[340px] w-full overflow-hidden rounded-md border border-border bg-secondary min-[761px]:h-[440px]" />
      <div role="status" aria-live="polite" aria-atomic="true" className="mt-3">
        {status === 'loading' && <p>지도를 불러오는 중입니다.</p>}
        {status === 'error' && <p className="text-destructive">{error}</p>}
        {status === 'ready' && <span className="visually-hidden">지도가 준비되었습니다. 지도에서 위치를 클릭해 주세요.</span>}
      </div>
      {status === 'error' && <Button type="button" className="mt-2" onClick={() => {
        setStatus('loading')
        setAttempt((value) => value + 1)
      }}>지도 다시 시도</Button>}
    </div>
  )
}
