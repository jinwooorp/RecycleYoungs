import { useState } from 'react'
import { useAdminDongStats } from './useAdminDongStats'
import { useLocationResolution } from './useLocationResolution'
import type { MapCoordinate } from '../components/KakaoMap'
import type { StatsQuery } from '../types/api'

export function useLocationAnalysis() {
  const location = useLocationResolution()
  const [mode, setMode] = useState<'manual' | 'location'>('manual')
  const resolvedCode = location.result?.adminDong.resolvedDong?.code ?? ''
  const stats = useAdminDongStats(mode === 'location' ? resolvedCode : undefined)

  function selectCoordinate(coordinate: MapCoordinate) {
    setMode('location')
    // Clear both old results and the previous dong in the same click event.
    stats.changeSelection('dongCode', '')
    location.resolve(coordinate)
  }
  function changeSelection(field: keyof StatsQuery, value: string) {
    if (field === 'dongCode') setMode('manual')
    stats.changeSelection(field, value)
  }
  function retryLocation() {
    if (location.coordinate) selectCoordinate(location.coordinate)
  }
  return { ...stats, location, mode, selectCoordinate, changeSelection, retryLocation }
}
