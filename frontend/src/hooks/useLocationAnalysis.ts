import { useState } from 'react'
import { useAdminDongStats } from './useAdminDongStats'
import { useLocationResolution } from './useLocationResolution'
import { useNearbyStores } from './useNearbyStores'
import type { MapCoordinate } from '../components/KakaoMap'
import type { StatsQuery } from '../types/api'

export function useLocationAnalysis() {
  const location = useLocationResolution()
  const nearby = useNearbyStores()
  const [mode, setMode] = useState<'manual' | 'location'>('manual')
  const resolvedCode = location.result?.adminDong.resolvedDong?.code ?? ''
  const stats = useAdminDongStats(mode === 'location' ? resolvedCode : undefined, true)

  function selectCoordinate(coordinate: MapCoordinate) {
    setMode('location')
    // Clear both old results and the previous dong in the same click event.
    stats.changeSelection('dongCode', '')
    location.resolve(coordinate)
    nearby.resolve(coordinate)
  }
  function changeSelection(field: keyof StatsQuery, value: string) {
    if (field === 'dongCode') setMode('manual')
    stats.changeSelection(field, value)
  }
  function retryLocation() {
    if (location.coordinate) {
      setMode('location')
      stats.changeSelection('dongCode', '')
      location.resolve(location.coordinate)
    }
  }
  function retryNearby() {
    if (location.coordinate) nearby.resolve(location.coordinate)
  }
  function selectRegion(code: string) {
    location.clear(); nearby.clear(); setMode('manual')
    if (!stats.selection.quarterCode) stats.changeSelection('quarterCode', stats.lookups?.quarters.at(-1)?.code ?? '')
    stats.changeSelection('dongCode', code)
  }
  return { ...stats, location, nearby, mode, selectCoordinate, selectRegion, changeSelection, retryLocation, retryNearby }
}
