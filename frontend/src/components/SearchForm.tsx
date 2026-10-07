import type { Lookups, StatsQuery } from '../types/api'
import { Button } from '@/components/ui/button'

interface Props {
  lookups: Lookups | null
  selection: StatsQuery
  disabled: boolean
  loading: boolean
  onChange: (field: keyof StatsQuery, value: string) => void
  onSearch: () => void
}

export function SearchForm({ lookups, selection, disabled, loading, onChange, onSearch }: Props) {
  const complete = selection.dongCode && selection.industryCode && selection.quarterCode
  return (
    <form className="grid items-end gap-4 min-[761px]:grid-cols-[1.2fr_1fr_1fr_auto]" onSubmit={event => { event.preventDefault(); onSearch() }}>
      <div className="form-field">
        <label htmlFor="dong">행정동</label>
        <div className="select-wrapper">
          <select id="dong" value={selection.dongCode} disabled={disabled} onChange={event => onChange('dongCode', event.target.value)}>
            <option value="">행정동을 선택하세요</option>
            {lookups?.adminDongs.map(dong => <option key={dong.code} value={dong.code}>{dong.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="industry">업종</label>
        <div className="select-wrapper">
          <select id="industry" value={selection.industryCode} disabled={disabled} onChange={event => onChange('industryCode', event.target.value)}>
            <option value="">업종을 선택하세요</option>
            {lookups?.industries.map(industry => <option key={industry.code} value={industry.code}>{industry.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="quarter">분기</label>
        <div className="select-wrapper">
          <select id="quarter" value={selection.quarterCode} disabled={disabled} onChange={event => onChange('quarterCode', event.target.value)}>
            <option value="">분기를 선택하세요</option>
            {lookups?.quarters.map(quarter => <option key={quarter.code} value={quarter.code}>{quarter.label}</option>)}
          </select>
        </div>
      </div>
      <Button type="submit" disabled={disabled || loading || !complete}>{loading ? '조회 중...' : '조회하기'}</Button>
    </form>
  )
}
