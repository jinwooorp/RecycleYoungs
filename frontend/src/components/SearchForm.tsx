import type { Lookups, StatsQuery } from '../types/api'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'

interface Props {
  lookups: Lookups | null
  selection: StatsQuery
  disabled: boolean
  loading: boolean
  onChange: (field: keyof StatsQuery, value: string) => void
  onSearch: () => void
}

export function SearchForm({ lookups, selection, disabled, loading, onChange, onSearch }: Props) {
  const complete = selection.dongCode && selection.quarterCode && lookups?.industries.some(i => i.code === 'CAFE')
  return (
    <form onSubmit={event => { event.preventDefault(); onSearch() }}><FieldGroup>
      <Field>
        <FieldLabel htmlFor="dong">행정동</FieldLabel>

          <NativeSelect id="dong" value={selection.dongCode} disabled={disabled} onChange={event => onChange('dongCode', event.target.value)}>
            <option value="">행정동을 선택하세요</option>
            {lookups?.adminDongs.map(dong => <option key={dong.code} value={dong.code}>{dong.name}</option>)}
          </NativeSelect>
      </Field>
      <p className="text-sm text-muted-foreground">분석 업종: 카페 · 초기 MVP</p>
      <Field>
        <FieldLabel htmlFor="quarter">분기</FieldLabel>

          <NativeSelect id="quarter" value={selection.quarterCode} disabled={disabled} onChange={event => onChange('quarterCode', event.target.value)}>
            <option value="">분기를 선택하세요</option>
            {lookups?.quarters.map(quarter => <option key={quarter.code} value={quarter.code}>{quarter.label}</option>)}
          </NativeSelect>
      </Field>
      <Button type="submit" disabled={disabled || loading || !complete}>{loading ? '조회 중...' : '조회하기'}</Button>
    </FieldGroup></form>
  )
}
