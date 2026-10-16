import { useState } from 'react'
import type { RegionDong, Regions } from '../types/regions'
import { NativeSelect } from './ui/native-select'
import { Button } from './ui/button'

export function RegionSelector({ regions, activeCode, loading, error, onRetry, onSelect }: {
  regions: Regions | null; activeCode: string; loading: boolean; error: string | null
  onRetry: () => void; onSelect: (dong: RegionDong) => void
}) {
  const initial = regions?.districts.find(d => d.dongs.some(a => a.code === activeCode))?.code ?? ''
  const [district, setDistrict] = useState(initial)
  const [dong, setDong] = useState(activeCode)
  const options = regions?.districts.find(d => d.code === district)?.dongs ?? []
  return <div className="region-selector">
    <form aria-label="지도 지역 검색" onSubmit={e => { e.preventDefault(); const selected = options.find(d => d.code === dong); if (selected) onSelect(selected) }}>
      <span className="region-city">서울특별시</span>
      <NativeSelect aria-label="자치구" value={district} disabled={loading || !!error} onChange={e => { setDistrict(e.target.value); setDong('') }}>
        <option value="">구 선택</option>{regions?.districts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
      </NativeSelect>
      <NativeSelect aria-label="행정동" value={dong} disabled={!district || loading || !!error} onChange={e => setDong(e.target.value)}>
        <option value="">동 선택</option>{options.map(d => <option key={d.code} value={d.code}>{d.name}{!d.statisticsSupported ? ' (통계 미지원)' : ''}</option>)}
      </NativeSelect>
      <Button type="submit" disabled={!options.some(d => d.code === dong) || loading || !!error}>지역 보기</Button>
    </form>
    {loading && <p role="status">지역 목록을 불러오는 중입니다.</p>}
    {error && <div role="alert" className="region-error"><span>지역 목록을 불러오지 못했습니다.</span><Button type="button" variant="ghost" size="sm" onClick={onRetry}>지역 목록 다시 조회</Button></div>}
  </div>
}
