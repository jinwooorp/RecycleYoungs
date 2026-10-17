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
import { layoutMapLabels, type LabelRect } from '../lib/mapLabels'
import { cafeDistance } from '../lib/cafeBrands'
import { mapConnectors } from '../lib/mapConnectors'

export interface MapCoordinate { lat: number; lng: number }

function isValidCoordinate({ lat, lng }: MapCoordinate) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

const initializationError = '지도를 초기화하지 못했습니다. 다시 시도해 주세요.'

const noCandidates: Candidate[] = []
const noStores: NearbyStore[] = []
interface MapLayer { overlay: KakaoOverlay; button: HTMLButtonElement; root?: HTMLElement; click: () => void; coordinate: MapCoordinate }
function releaseLayer(layer: MapLayer) {
  layer.button.removeEventListener('click', layer.click)
  layer.overlay.setMap(null)
}

export function KakaoMap({ selectedCoordinate, onCoordinateChange, candidates = noCandidates, stores = noStores,
  focusRequest, activeStoreId, activeGroupIds, onStoreSelect, onStoreGroupSelect, onCandidateSelect, regionBoundary, regionFitRequest }: {
  selectedCoordinate: MapCoordinate | null
  onCoordinateChange: (coordinate: MapCoordinate) => void
  candidates?: Candidate[]; stores?: NearbyStore[]
  focusRequest?: { coordinate: MapCoordinate; request: number } | null
  activeStoreId?: string | null; onStoreSelect?: (id: string) => void; onCandidateSelect?: (candidate: Candidate) => void
  activeGroupIds?: string[]
  onStoreGroupSelect?: (ids: string[]) => void
  regionBoundary?: RegionBoundary | null; regionFitRequest?: { code: string; request: number } | null
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<KakaoMapInstance | null>(null)
  const marker = useRef<KakaoMarker | null>(null)
  const circle = useRef<KakaoCircle | null>(null)
  const layers = useRef(new Map<string, MapLayer>())
  const connectorLayer = useRef<KakaoOverlay | null>(null)
  const connectorSvg = useRef<SVGSVGElement | null>(null)
  const focusedStoreIds = useRef<string[]>([])
  const sdk = useRef<KakaoMapsSDK | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [layoutRevision, setLayoutRevision] = useState(0)
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
      connectorLayer.current?.setMap(null); connectorLayer.current = null; connectorSvg.current = null
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
        let layoutWidth = element.clientWidth, layoutHeight = element.clientHeight, layingOut = false
        const rememberCenter = () => {
          if (!canceled && map.current === instance && !layingOut && layoutWidth > 0 && layoutHeight > 0
            && element.clientWidth === layoutWidth && element.clientHeight === layoutHeight) stableCenter = instance.getCenter?.() ?? stableCenter
        }
        let initiallyFitted = false
        const relayout = () => {
          if (!canceled && map.current === instance && element.clientWidth > 0 && element.clientHeight > 0) {
            const center = stableCenter
            layingOut = true
            try {
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
              layoutWidth = element.clientWidth; layoutHeight = element.clientHeight
            } finally { layingOut = false }
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
  const selectGroup = useEffectEvent((ids: string[]) => onStoreGroupSelect?.(ids))
  const highlightConnectors = useEffectEvent(() => {
    connectorSvg.current?.querySelectorAll<SVGLineElement>('line[data-store-ids]').forEach(line => {
      const ids = line.dataset.storeIds?.split(',') ?? []
      line.classList.toggle('is-active', ids.some(id => id === activeStoreId || activeGroupIds?.includes(id) || focusedStoreIds.current.includes(id)))
    })
  })
  useEffect(() => {
    const element = container.current
    if (status !== 'ready' || !element) return
    const focus = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-store-ids]') : null
      focusedStoreIds.current = target?.dataset.storeIds?.split(',') ?? []; highlightConnectors()
    }
    const blur = () => { focusedStoreIds.current = []; highlightConnectors() }
    element.addEventListener('focusin', focus); element.addEventListener('focusout', blur)
    return () => { element.removeEventListener('focusin', focus); element.removeEventListener('focusout', blur); focusedStoreIds.current = [] }
  }, [status])
  useEffect(() => {
    const instance = map.current, maps = sdk.current, element = container.current
    if (status !== 'ready' || !instance?.getProjection || !maps || !element) return
    let frame = 0
    const refresh = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setLayoutRevision(n => n + 1)) }
    maps.event.addListener(instance, 'idle', refresh)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh)
    observer?.observe(element)
    return () => { maps.event.removeListener(instance, 'idle', refresh); observer?.disconnect(); cancelAnimationFrame(frame) }
  }, [status])
  const selectCandidate = useEffectEvent((id: string) => {
    const candidate = candidates.find(candidate => candidate.id === id)
    if (candidate) onCandidateSelect?.(candidate)
  })
  useEffect(() => {
    const maps = sdk.current, instance = map.current
    if (status !== 'ready' || !maps?.CustomOverlay || !instance) return
    connectorLayer.current?.setMap(null); connectorLayer.current = null; connectorSvg.current = null
    const desired = new Set<string>()
    function add(key: string, position: MapCoordinate, label: string, text: string, className: string, action: () => void, active?: boolean, offset?: { x: number; y: number; width: number; name: string; detail: string; ids: string[] }) {
      if (!isValidCoordinate(position) || !maps?.CustomOverlay) return
      function content(button: HTMLButtonElement) {
        if (!offset) { button.textContent = text; return }
        button.dataset.storeIds = offset.ids.join(',')
        const name = document.createElement('span'), detail = document.createElement('span')
        name.className = 'map-label-name'; name.textContent = offset.name
        detail.className = 'map-label-distance'; detail.textContent = offset.detail
        button.replaceChildren(name, detail)
      }
      desired.add(key)
      const existing = layers.current.get(key)
      if (existing && existing.coordinate.lat === position.lat && existing.coordinate.lng === position.lng) {
        content(existing.button)
        existing.button.className = className
        existing.button.title = label
        existing.button.setAttribute('aria-label', label)
        if (active !== undefined) existing.button.setAttribute('aria-pressed', String(active))
        if (offset) { existing.button.style.left = `${offset.x}px`; existing.button.style.top = `${offset.y}px`; existing.button.style.width = `${offset.width}px` }
        existing.overlay.setZIndex?.(className === 'map-candidate-pin' ? 4 : active ? 5 : 2)
        return
      }
      if (existing) { releaseLayer(existing); layers.current.delete(key) }
      const button = document.createElement('button')
      button.type = 'button'
      button.className = className
      content(button)
      button.title = label
      button.setAttribute('aria-label', label)
      if (active !== undefined) button.setAttribute('aria-pressed', String(active))
      button.addEventListener('click', action)
      let root: HTMLDivElement | undefined
      if (offset) {
        root = document.createElement('div'); root.className = 'map-label-root'
        root.append(button)
        button.style.left = `${offset.x}px`; button.style.top = `${offset.y}px`; button.style.width = `${offset.width}px`
      }
      const overlay = new maps.CustomOverlay({ map: instance!, position: new maps.LatLng(position.lat, position.lng),
        content: root ?? button, clickable: true, yAnchor: offset ? 0 : 1.2, xAnchor: offset ? 0 : 0.5, zIndex: className === 'map-candidate-pin' ? 4 : active ? 5 : 2 })
      layers.current.set(key, { overlay, button, root, click: action, coordinate: position })
    }
    try {
      candidates.forEach(candidate => add('candidate:' + candidate.id, candidate.coordinate, '지도 · ' + candidateTitle(candidate), `후보${candidate.number}`, 'map-candidate-pin', () => selectCandidate(candidate.id)))
      const projection = instance.getProjection?.(), bounds = container.current?.getBoundingClientRect()
      if (projection && bounds && bounds.width > 0 && bounds.height > 0) {
        const obstacles: LabelRect[] = []
        container.current?.closest('.map-workspace')?.querySelectorAll('.region-selector, .map-menu, .map-keyboard-help, .map-candidate-pin, [data-map-control="return"]').forEach(node => {
          const r = node.getBoundingClientRect()
          if (r.width && r.height) obstacles.push({ x: r.x - bounds.x, y: r.y - bounds.y, width: r.width, height: r.height })
        })
        obstacles.push({ x: bounds.width - 48, y: 0, width: 48, height: Math.min(300, bounds.height) })
        if (selectedCoordinate) { const p = projection.containerPointFromCoords(new maps.LatLng(selectedCoordinate.lat, selectedCoordinate.lng)); obstacles.push({ x: p.x - 20, y: p.y - 42, width: 40, height: 50 }) }
        const points = stores.map((s, i) => ({ id: s.sourceStoreId, ...projection.containerPointFromCoords(new maps.LatLng(s.coordinate.lat, s.coordinate.lng)), active: s.sourceStoreId === activeStoreId || !activeStoreId && i === 0 }))
        const labels = layoutMapLabels(points, bounds, obstacles)
        if (labels.length) {
          const anchor = labels[0], store = stores.find(s => s.sourceStoreId === anchor.ids[0])!
          const root = document.createElement('div'); root.className = 'map-label-root'
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          svg.classList.add('map-connectors'); svg.setAttribute('aria-hidden', 'true')
          svg.setAttribute('width', String(bounds.width)); svg.setAttribute('height', String(bounds.height))
          svg.style.left = `${-anchor.anchor.x}px`; svg.style.top = `${-anchor.anchor.y}px`
          for (const segment of mapConnectors(labels, obstacles)) {
            const line = document.createElementNS(svg.namespaceURI, 'line')
            line.setAttribute('x1', String(segment.from.x)); line.setAttribute('y1', String(segment.from.y)); line.setAttribute('x2', String(segment.to.x)); line.setAttribute('y2', String(segment.to.y))
            line.setAttribute('data-store-ids', segment.id)
            svg.append(line)
          }
          for (const label of labels) {
            const dot = document.createElementNS(svg.namespaceURI, 'circle')
            dot.setAttribute('cx', String(label.anchor.x)); dot.setAttribute('cy', String(label.anchor.y)); dot.setAttribute('r', '3'); svg.append(dot)
          }
          root.append(svg)
          connectorSvg.current = svg; highlightConnectors()
          connectorLayer.current = new maps.CustomOverlay({ map: instance, position: new maps.LatLng(store.coordinate.lat, store.coordinate.lng), content: root, xAnchor: 0, yAnchor: 0, zIndex: 1, clickable: false })
        }
        for (const label of labels) {
          const first = stores.find(s => s.sourceStoreId === label.ids[0])!
          const selected = stores.find(s => s.sourceStoreId === activeStoreId && label.ids.includes(s.sourceStoreId))
          const text = label.ids.length > 1 ? selected ? `${selected.name ?? '상호명 미확인'} · ${cafeDistance(selected.distanceMeters)} 외 ${label.ids.length - 1}곳` : `카페 ${label.ids.length}곳 · 눌러서 목록 보기`
            : `${first.name ?? '상호명 미확인'} · ${cafeDistance(first.distanceMeters)}`
          add('store-group:' + [...label.ids].sort().join(','), first.coordinate, '지도 · ' + text, text, 'map-store-label',
            () => label.ids.length > 1 ? selectGroup(label.ids) : selectStore(first.sourceStoreId), !!selected,
            { x: label.rect.x - label.anchor.x, y: label.rect.y - label.anchor.y, width: label.rect.width, ids: label.ids,
              name: selected?.name ?? (label.ids.length > 1 ? `카페 ${label.ids.length}곳` : first.name ?? '상호명 미확인'),
              detail: selected && label.ids.length > 1 ? `${cafeDistance(selected.distanceMeters)} · 외 ${label.ids.length - 1}곳` : label.ids.length > 1 ? '눌러서 목록 보기' : cafeDistance(first.distanceMeters) })
        }
      } else stores.forEach(store => add('store:' + store.sourceStoreId, store.coordinate, '지도 · ' + (store.name ?? '상호명 미확인'), `${store.name ?? '상호명 미확인'} · ${cafeDistance(store.distanceMeters)}`, 'map-store-pin', () => selectStore(store.sourceStoreId), activeStoreId === store.sourceStoreId))
    } catch {
      // A decorative layer must not disable point selection or hide the list alternative.
    }
    layers.current.forEach((layer, key) => {
      if (!desired.has(key)) { releaseLayer(layer); layers.current.delete(key) }
    })
  }, [candidates, stores, activeStoreId, activeGroupIds, status, layoutRevision, selectedCoordinate])

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
        {selectedCoordinate && <Button type="button" size="sm" data-map-control="return" className="absolute right-3 bottom-9 z-10" variant="outline" disabled={status !== 'ready'} onClick={() => {
          if (sdk.current && isValidCoordinate(selectedCoordinate)) map.current?.panTo?.(new sdk.current.LatLng(selectedCoordinate.lat, selectedCoordinate.lng))
        }}>선택 위치로 이동</Button>}
    </div>
  )
}
