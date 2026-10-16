import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from './ui/button'
import { loadKakaoMaps, mapLoadMessages } from '../lib/loadKakaoMaps'
import type { KakaoCircle, KakaoMapInstance, KakaoMapMouseEvent, KakaoMapsSDK, KakaoMarker, KakaoOverlay } from '../types/kakao-maps'
import type { Candidate } from '../types/comparison'
import type { NearbyStore } from '../types/nearby'
import { candidateTitle } from '../lib/candidatePresentation'

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
  focusRequest, activeStoreId, onStoreSelect, onCandidateSelect }: {
  selectedCoordinate: MapCoordinate | null
  onCoordinateChange: (coordinate: MapCoordinate) => void
  candidates?: Candidate[]; stores?: NearbyStore[]
  focusRequest?: { coordinate: MapCoordinate; request: number } | null
  activeStoreId?: string | null; onStoreSelect?: (id: string) => void; onCandidateSelect?: (candidate: Candidate) => void
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
        map.current = instance
        sdk.current = maps
        const handler = (event: KakaoMapMouseEvent) => { if (!canceled && map.current === instance) onClick(event) }
        const rememberCenter = () => { if (!canceled && map.current === instance) stableCenter = instance.getCenter?.() ?? stableCenter }
        const relayout = () => {
          if (!canceled && map.current === instance) {
            const center = stableCenter
            instance.relayout()
            if (instance.setCenter) instance.setCenter(center)
            else instance.panTo?.(center)
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
      <div ref={container} aria-label="창업 후보 위치 지도" aria-busy={status === 'loading'}
        className="map-canvas" />
      <div>
      <div role="status" aria-live="polite" aria-atomic="true" className={status === 'ready' ? 'visually-hidden' : 'map-status'}>
        {status === 'loading' && <p>지도를 불러오는 중입니다.</p>}
        {status === 'error' && <p className="text-destructive">{error}</p>}
        {status === 'ready' && <span className="visually-hidden">지도가 준비되었습니다. 지도에서 위치를 클릭해 주세요.</span>}
      </div>
      {status === 'error' && <Button type="button" className="m-2" onClick={() => {
        setStatus('loading')
        setAttempt((value) => value + 1)
      }}>지도 다시 시도</Button>}
      <div className="map-actionbar">
        <Button type="button" size="sm" variant="outline" disabled={status !== 'ready'} aria-label="방향키로 지도 이동"
          title="이 버튼에 초점을 둔 뒤 방향키로 지도를 이동하세요" onKeyDown={event => {
            const offsets: Record<string, [number, number]> = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] }
            const offset = offsets[event.key]
            if (offset) { event.preventDefault(); map.current?.panBy?.(...offset) }
          }}>지도 이동 ↔</Button>
        <Button type="button" size="sm" disabled={status !== 'ready'} onClick={() => {
          const center = map.current?.getCenter?.()
          if (center) {
            const point = { lat: center.getLat(), lng: center.getLng() }
            if (isValidCoordinate(point)) onCoordinateChange(point)
          }
        }}>지도 중심 선택</Button>
        {selectedCoordinate && <Button type="button" size="sm" variant="ghost" disabled={status !== 'ready'} onClick={() => {
          if (sdk.current && isValidCoordinate(selectedCoordinate)) map.current?.panTo?.(new sdk.current.LatLng(selectedCoordinate.lat, selectedCoordinate.lng))
        }}>선택 위치로 이동</Button>}
        <p className="text-xs text-muted-foreground">서울 · 카페 반경 500m</p>
      </div>
      </div>
    </div>
  )
}
