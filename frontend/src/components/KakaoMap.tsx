import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from './ui/button'
import { loadKakaoMaps, mapLoadMessages } from '../lib/loadKakaoMaps'
import type { KakaoCircle, KakaoMapInstance, KakaoMapMouseEvent, KakaoMapsSDK, KakaoMarker, KakaoOverlay } from '../types/kakao-maps'
import type { Candidate } from '../types/comparison'
import type { NearbyStore } from '../types/nearby'
import { candidateTitle } from '../lib/candidatePresentation'
import type { PolygonGeometry, RegionBoundary } from '../types/regions'
import seoulBoundary from '../data/seoul-boundary.json'
import { validGeometry } from '../api/regionApi'

export interface MapCoordinate { lat: number; lng: number }

function isValidCoordinate({ lat, lng }: MapCoordinate) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

const initializationError = '지도를 초기화하지 못했습니다. 다시 시도해 주세요.'

const noCandidates: Candidate[] = []
const noStores: NearbyStore[] = []
interface MapLayer { overlay: KakaoOverlay; button: HTMLButtonElement; click: () => void; coordinate: MapCoordinate }
function releaseLayer(layer: MapLayer) {
  layer.button.removeEventListener('click', layer.click)
  layer.overlay.setMap(null)
}

export function KakaoMap({ selectedCoordinate, onCoordinateChange, candidates = noCandidates, stores = noStores,
  focusRequest, activeStoreId, onStoreSelect, onCandidateSelect, regionBoundary, regionFitRequest }: {
  selectedCoordinate: MapCoordinate | null
  onCoordinateChange: (coordinate: MapCoordinate) => void
  candidates?: Candidate[]; stores?: NearbyStore[]
  focusRequest?: { coordinate: MapCoordinate; request: number } | null
  activeStoreId?: string | null; onStoreSelect?: (id: string) => void; onCandidateSelect?: (candidate: Candidate) => void
  regionBoundary?: RegionBoundary | null; regionFitRequest?: { code: string; request: number } | null
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<KakaoMapInstance | null>(null)
  const marker = useRef<KakaoMarker | null>(null)
  const circle = useRef<KakaoCircle | null>(null)
  const layers = useRef(new Map<string, MapLayer>())
  const sdk = useRef<KakaoMapsSDK | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const boundaryStatus = useRef<HTMLParagraphElement>(null)
  const initialIntent = useRef({ selectedCoordinate, regionFitRequest, focusRequest })
  useEffect(() => { initialIntent.current = { selectedCoordinate, regionFitRequest, focusRequest } }, [selectedCoordinate, regionFitRequest, focusRequest])
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
      circle.current?.setMap(null)
      circle.current = null
      layers.current.forEach(releaseLayer)
      layers.current.clear()
      map.current = null
      sdk.current = null
      element?.replaceChildren()
    }
    void loadKakaoMaps().then((maps) => {
      if (canceled) return
      try {
        let stableCenter = new maps.LatLng(37.5665, 126.978)
        const instance = new maps.Map(element, { center: stableCenter, level: 4 })
        stableCenter = instance.getCenter?.() ?? stableCenter
        map.current = instance
        sdk.current = maps
        const handler = (event: KakaoMapMouseEvent) => { if (!canceled && map.current === instance) onClick(event) }
        const rememberCenter = () => { if (!canceled && map.current === instance) stableCenter = instance.getCenter?.() ?? stableCenter }
        let initiallyFitted = false
        const relayout = () => {
          if (!canceled && map.current === instance && element.clientWidth > 0 && element.clientHeight > 0) {
            const center = stableCenter
            instance.relayout()
            const intent = initialIntent.current
            if (!initiallyFitted && !intent.selectedCoordinate && !intent.regionFitRequest && !intent.focusRequest && maps.LatLngBounds && instance.setBounds && validGeometry(seoulBoundary.geometry)) {
              const bounds = new maps.LatLngBounds()
              const geometry: PolygonGeometry = seoulBoundary.geometry as PolygonGeometry
              const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
              for (const rings of parts) for (const ring of rings) for (const [lng, lat] of ring) bounds.extend(new maps.LatLng(lat, lng))
              const height = element.closest('.map-workspace')?.querySelector('.region-selector')?.getBoundingClientRect().height ?? 56
              instance.setBounds(bounds, height + 36, 36, 36, 36)
              stableCenter = instance.getCenter?.() ?? stableCenter
            } else if (instance.setCenter) instance.setCenter(center)
            else instance.panTo?.(center)
            initiallyFitted = true
          }
        }
        const resources: { observer?: ResizeObserver } = {}
        const zoomControl = maps.ZoomControl && maps.ControlPosition && instance.addControl && instance.removeControl
          ? new maps.ZoomControl() : null
        // Prepare cleanup before any registration can partially succeed and throw.
        release = () => {
          maps.event.removeListener(instance, 'click', handler)
          maps.event.removeListener(instance, 'center_changed', rememberCenter)
          resources.observer?.disconnect()
          window.removeEventListener('resize', relayout)
          if (zoomControl) instance.removeControl?.(zoomControl)
        }
        if (zoomControl && maps.ControlPosition) instance.addControl?.(zoomControl, maps.ControlPosition.RIGHT)
        maps.event.addListener(instance, 'click', handler)
        maps.event.addListener(instance, 'center_changed', rememberCenter)
        resources.observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(relayout)
        if (resources.observer) resources.observer.observe(element)
        else window.addEventListener('resize', relayout)
        relayout()
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

  const drawBoundary = useEffectEvent((geometry: PolygonGeometry, fill: boolean) => {
    const maps = sdk.current, instance = map.current
    if (!maps?.Polygon || !instance) return []
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    const created: KakaoOverlay[] = []
    try {
      for (const rings of parts) created.push(new maps.Polygon({ map: instance,
        path: rings.map(ring => ring.map(([lng, lat]) => new maps.LatLng(lat, lng))),
        strokeWeight: fill ? 3 : 2, strokeColor: '#245B4B', strokeOpacity: fill ? 0.95 : 0.65,
        fillColor: '#245B4B', fillOpacity: fill ? 0.13 : 0, zIndex: fill ? 1 : 0 }))
    } catch {
      created.forEach(p => p.setMap(null))
      if (boundaryStatus.current) boundaryStatus.current.textContent = '경계 표시를 준비하지 못했습니다. 통계는 계속 조회할 수 있습니다.'
      return []
    }
    return created
  })
  useEffect(() => {
    if (status !== 'ready' || !validGeometry(seoulBoundary.geometry)) return
    const shapes = drawBoundary(seoulBoundary.geometry, false)
    return () => shapes.forEach(p => p.setMap(null))
  }, [status])
  useEffect(() => {
    if (status !== 'ready' || !regionBoundary) return
    const shapes = drawBoundary(regionBoundary.geometry, true)
    return () => shapes.forEach(p => p.setMap(null))
  }, [status, regionBoundary])
  useEffect(() => {
    const maps = sdk.current, instance = map.current
    if (status !== 'ready' || !regionBoundary || regionFitRequest?.code !== regionBoundary.code || !maps?.LatLngBounds || !instance?.setBounds) return
    const bounds = new maps.LatLngBounds()
    const parts = regionBoundary.geometry.type === 'Polygon' ? [regionBoundary.geometry.coordinates] : regionBoundary.geometry.coordinates
    for (const rings of parts) for (const ring of rings) for (const [lng, lat] of ring) bounds.extend(new maps.LatLng(lat, lng))
    const barHeight = container.current?.closest('.map-workspace')?.querySelector('.region-selector')?.getBoundingClientRect().height ?? 56
    instance.setBounds(bounds, barHeight + 36, 36, 36, 36)
  }, [status, regionBoundary, regionFitRequest])

  useEffect(() => {
    if (status !== 'ready' || !map.current || !sdk.current) return
    if (!selectedCoordinate || !isValidCoordinate(selectedCoordinate)) {
      marker.current?.setMap(null)
      circle.current?.setMap(null)
      return
    }
    const position = new sdk.current.LatLng(selectedCoordinate.lat, selectedCoordinate.lng)
    if (marker.current) {
      marker.current.setPosition(position)
      marker.current.setMap(map.current)
    } else {
      marker.current = new sdk.current.Marker({ map: map.current, position })
    }
    if (circle.current) {
      circle.current.setPosition(position)
      circle.current.setMap(map.current)
    } else if (sdk.current.Circle) {
      const color = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
      circle.current = new sdk.current.Circle({ map: map.current, center: position, radius: 500,
        strokeWeight: 2, strokeColor: color, strokeOpacity: 0.8, fillColor: color, fillOpacity: 0.08 })
    }
  }, [selectedCoordinate, status])

  useEffect(() => {
    if (status !== 'ready' || !focusRequest || !sdk.current) return
    if (isValidCoordinate(focusRequest.coordinate)) map.current?.panTo?.(new sdk.current.LatLng(focusRequest.coordinate.lat, focusRequest.coordinate.lng))
  }, [focusRequest, status])

  const selectStore = useEffectEvent((id: string) => onStoreSelect?.(id))
  const selectCandidate = useEffectEvent((id: string) => {
    const candidate = candidates.find(candidate => candidate.id === id)
    if (candidate) onCandidateSelect?.(candidate)
  })
  useEffect(() => {
    const maps = sdk.current, instance = map.current
    if (status !== 'ready' || !maps?.CustomOverlay || !instance) return
    const desired = new Set<string>()
    function add(key: string, position: MapCoordinate, label: string, text: string, className: string, action: () => void, active?: boolean) {
      if (!isValidCoordinate(position) || !maps?.CustomOverlay) return
      desired.add(key)
      const existing = layers.current.get(key)
      if (existing && existing.coordinate.lat === position.lat && existing.coordinate.lng === position.lng) {
        existing.button.textContent = text
        existing.button.title = label
        existing.button.setAttribute('aria-label', label)
        if (active !== undefined) existing.button.setAttribute('aria-pressed', String(active))
        return
      }
      if (existing) { releaseLayer(existing); layers.current.delete(key) }
      const button = document.createElement('button')
      button.type = 'button'
      button.className = className
      button.textContent = text
      button.title = label
      button.setAttribute('aria-label', label)
      if (active !== undefined) button.setAttribute('aria-pressed', String(active))
      button.addEventListener('click', action)
      const overlay = new maps.CustomOverlay({ map: instance!, position: new maps.LatLng(position.lat, position.lng),
        content: button, clickable: true, yAnchor: 1.2, zIndex: className === 'map-candidate-pin' ? 4 : active ? 3 : 2 })
      layers.current.set(key, { overlay, button, click: action, coordinate: position })
    }
    try {
      candidates.forEach(candidate => add('candidate:' + candidate.id, candidate.coordinate, '지도 · ' + candidateTitle(candidate), String(candidate.number), 'map-candidate-pin', () => selectCandidate(candidate.id)))
      stores.forEach((store, index) => add('store:' + store.sourceStoreId, store.coordinate, '지도 · ' + (store.name ?? '상호명 미확인'), String(index + 1), 'map-store-pin', () => selectStore(store.sourceStoreId), activeStoreId === store.sourceStoreId))
    } catch {
      // A decorative layer must not disable point selection or hide the list alternative.
    }
    layers.current.forEach((layer, key) => {
      if (!desired.has(key)) { releaseLayer(layer); layers.current.delete(key) }
    })
  }, [candidates, stores, activeStoreId, status])

  return (
    <div className="map-shell">
      <div ref={container} aria-label="창업 후보 위치 지도" aria-busy={status === 'loading'} tabIndex={0}
        aria-describedby="map-keyboard-help" className="map-canvas" onKeyDown={event => {
          if (event.target !== event.currentTarget || status !== 'ready' || event.altKey || event.ctrlKey || event.metaKey) return
          const offsets: Record<string, [number, number]> = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] }
          const offset = offsets[event.key]
          if (offset) { event.preventDefault(); map.current?.panBy?.(...offset) }
          if (event.key === 'Enter') {
            event.preventDefault()
            const center = map.current?.getCenter?.()
            if (center) { const point = { lat: center.getLat(), lng: center.getLng() }; if (isValidCoordinate(point)) onCoordinateChange(point) }
          }
        }} />
      <p id="map-keyboard-help" className="map-keyboard-help">방향키로 이동 · Enter로 중심 선택 · 자세한 사용법은 데이터 안내</p>
      <div className="map-message">
      <div role="status" aria-live="polite" aria-atomic="true" className={status === 'ready' ? 'visually-hidden' : 'map-status'}>
        {status === 'loading' && <p>지도를 불러오는 중입니다.</p>}
        {status === 'error' && <p className="text-destructive">{error}</p>}
        {status === 'ready' && <span className="visually-hidden">지도가 준비되었습니다. 지도에서 위치를 클릭해 주세요.</span>}
      </div>
      {status === 'error' && <Button type="button" className="m-2" onClick={() => {
        setStatus('loading')
        setAttempt((value) => value + 1)
      }}>지도 다시 시도</Button>}
        <p ref={boundaryStatus} role="status" className="text-xs empty:hidden" />
      </div>
        {selectedCoordinate && <Button type="button" size="sm" className="absolute right-3 bottom-9 z-10" variant="outline" disabled={status !== 'ready'} onClick={() => {
          if (sdk.current && isValidCoordinate(selectedCoordinate)) map.current?.panTo?.(new sdk.current.LatLng(selectedCoordinate.lat, selectedCoordinate.lng))
        }}>선택 위치로 이동</Button>}
    </div>
  )
}
