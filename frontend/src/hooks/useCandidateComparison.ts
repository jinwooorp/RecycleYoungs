import { useEffect, useRef, useState } from 'react'
import { ApiFailure, getAdminDongStats } from '../api/adminDongApi'
import { getLocationResolution } from '../api/locationApi'
import { getNearbyStores } from '../api/nearbyApi'
import type { MapCoordinate } from '../components/KakaoMap'
import type { Lookups } from '../types/api'
import type { Candidate, CandidateRequest, CandidateValues, StatsBlockReason } from '../types/comparison'
import { validQuarterCode } from '../lib/publication'

type Kind = keyof CandidateValues
interface Control { generation: number; controller: AbortController | null }
interface Entry { value: Candidate; jobs: Record<Kind, Control> }
const empty = <T,>(): CandidateRequest<T> => ({ result: null, error: null, loading: false })
const invalidResponse = () => new ApiFailure('response', {
  code: 'INVALID_RESPONSE', message: '요청한 후보·조건과 서버 응답이 일치하지 않습니다. 다시 조회해 주세요.', field: null,
})
const failure = (reason: unknown) => reason instanceof ApiFailure ? reason : invalidResponse()

export function useCandidateComparison(lookups: Lookups | null, lookupLoading: boolean, lookupError: boolean) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [quarter, setQuarter] = useState('')
  const [comparisonRevision, setComparisonRevision] = useState(0)
  const registry = useRef(new Map<string, Entry>())
  const nextOrder = useRef(1)
  const quarterRef = useRef('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const entries = registry.current
    return () => {
      mounted.current = false
      for (const entry of entries.values()) for (const job of Object.values(entry.jobs)) job.controller?.abort()
      entries.clear()
    }
  }, [])

  function emit() {
    if (mounted.current) setCandidates([...registry.current.values()].map(e => e.value).sort((a, b) => a.number - b.number))
  }
  function cancel(entry: Entry, kind: Kind) {
    const job = entry.jobs[kind]
    job.controller?.abort(); job.controller = null; job.generation++
  }
  function invalidateStats(entry: Entry) {
    cancel(entry, 'stats')
    entry.value = { ...entry.value, stats: empty(), statsQuarter: null }
  }
  function run<K extends Kind>(entry: Entry, kind: K, load: (signal: AbortSignal) => Promise<CandidateValues[K]>) {
    cancel(entry, kind)
    const job = entry.jobs[kind], id = job.generation, controller = new AbortController()
    job.controller = controller
    entry.value = { ...entry.value, [kind]: { result: null, error: null, loading: true } }
    emit()
    const current = () => mounted.current && registry.current.get(entry.value.id) === entry
      && job.generation === id && job.controller === controller && !controller.signal.aborted
    void load(controller.signal).then(result => {
      if (!current()) return
      entry.value = { ...entry.value, [kind]: { result, error: null, loading: false } }
      job.controller = null; emit()
    }).catch((reason: unknown) => {
      if (!current()) return
      entry.value = { ...entry.value, [kind]: { result: null, error: failure(reason), loading: false } }
      job.controller = null; emit()
    })
  }

  function retryLocation(id: string) {
    const entry = registry.current.get(id)
    if (!entry || entry.value.location.loading) return
    setComparisonRevision(n => n + 1)
    invalidateStats(entry)
    const c = entry.value.coordinate
    run(entry, 'location', async signal => {
      const result = await getLocationResolution(c, signal)
      if (result.coordinate.lat !== c.lat || result.coordinate.lng !== c.lng) throw invalidResponse()
      return result
    })
  }
  function retryNearby(id: string) {
    const entry = registry.current.get(id)
    if (entry && !entry.value.nearby.loading) run(entry, 'nearby', signal => getNearbyStores(entry.value.coordinate, signal))
  }
  function add(coordinate: MapCoordinate) {
    if (!mounted.current || !Number.isFinite(coordinate.lat) || Math.abs(coordinate.lat) > 90
      || !Number.isFinite(coordinate.lng) || Math.abs(coordinate.lng) > 180 || registry.current.size >= 3
      || [...registry.current.values()].some(e => e.value.coordinate.lat === coordinate.lat && e.value.coordinate.lng === coordinate.lng)) return false
    const order = nextOrder.current++
    const number = [1, 2, 3].find(n => ![...registry.current.values()].some(e => e.value.number === n))!
    const value: Candidate = { id: `candidate-${order}`, order, number, coordinate: { ...coordinate }, statsQuarter: null,
      location: empty(), nearby: empty(), stats: empty() }
    registry.current.set(value.id, { value, jobs: { location: { generation: 0, controller: null },
      nearby: { generation: 0, controller: null }, stats: { generation: 0, controller: null } } })
    retryLocation(value.id)
    retryNearby(value.id)
    return true
  }
  function remove(id: string) {
    const entry = registry.current.get(id)
    if (!entry) return
    setComparisonRevision(n => n + 1)
    for (const kind of ['location', 'nearby', 'stats'] as const) cancel(entry, kind)
    registry.current.delete(id); emit()
  }
  function changeQuarter(code: string) {
    const next = lookups?.quarters.some(q => q.code === code && validQuarterCode(code)) ? code : ''
    if (quarterRef.current === next) return
    quarterRef.current = next; setQuarter(next); setComparisonRevision(n => n + 1)
    for (const entry of registry.current.values()) invalidateStats(entry)
    emit()
  }
  function statsBlockReason(candidate: Candidate, selectedQuarter = quarter): StatsBlockReason | null {
    if (lookupLoading) return 'LOOKUP_LOADING'
    if (lookupError || !lookups) return 'LOOKUP_ERROR'
    if (!lookups.industries.some(i => i.code === 'CAFE')) return 'NO_CAFE'
    if (!lookups.quarters.some(q => q.code === selectedQuarter && validQuarterCode(selectedQuarter))) return 'NO_QUARTER'
    if (candidate.location.loading) return 'LOCATION_LOADING'
    const result = candidate.location.result
    if (!result) return 'LOCATION_ERROR'
    if (result.adminDong.status === 'AMBIGUOUS_BOUNDARY') return 'AMBIGUOUS'
    if (result.adminDong.status !== 'RESOLVED' || !result.adminDong.resolvedDong) return 'OUTSIDE'
    if (!lookups.adminDongs.some(d => d.code === result.adminDong.resolvedDong?.code)) return 'NO_DONG_LOOKUP'
    return null
  }
  function retryStats(id: string) {
    const entry = registry.current.get(id)
    if (!entry || statsBlockReason(entry.value, quarterRef.current) || entry.value.stats.loading) return
    const dongCode = entry.value.location.result!.adminDong.resolvedDong!.code, requestedQuarter = quarterRef.current
    entry.value = { ...entry.value, statsQuarter: requestedQuarter }
    run(entry, 'stats', async signal => {
      const dataVersion = lookups?.quarters.find(q => q.code === requestedQuarter)?.metadata?.dataVersion
      const result = await getAdminDongStats({ dongCode, industryCode: 'CAFE', quarterCode: requestedQuarter,
        ...(dataVersion ? { dataVersion } : {}) }, signal)
      if (result.dong.code !== dongCode || result.industry.code !== 'CAFE' || result.quarter.code !== requestedQuarter) throw invalidResponse()
      return result
    })
  }
  function queryStats() {
    if ([...registry.current.values()].some(e => e.value.stats.loading)) return
    for (const id of registry.current.keys()) retryStats(id)
  }
  return { candidates, quarter, comparisonRevision, add, remove, changeQuarter, retryLocation, retryNearby, retryStats, queryStats, statsBlockReason }
}
