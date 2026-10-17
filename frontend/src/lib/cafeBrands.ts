import type { NearbyStore } from '../types/nearby'

// Presentation heuristics only: neither affiliation nor franchise/ownership evidence.
export const cafeBrands = [
  { id: 'starbucks', name: '스타벅스', aliases: ['스타벅스', '스타벅스커피'] },
  { id: 'compose', name: '컴포즈커피', aliases: ['컴포즈커피'] },
  { id: 'mega', name: '메가커피', aliases: ['메가엠지씨커피', '메가MGC커피', '메가커피'] },
  { id: 'mammoth', name: '매머드커피', aliases: ['매머드커피', '매머드익스프레스'] },
  { id: 'twosome', name: '투썸플레이스', aliases: ['투썸플레이스'] },
  { id: 'ediya', name: '이디야커피', aliases: ['이디야커피', '이디야'] },
  { id: 'paik', name: '빽다방', aliases: ['빽다방'] },
  { id: 'venti', name: '더벤티', aliases: ['더벤티'] },
  { id: 'hollys', name: '할리스', aliases: ['할리스커피', '할리스'] },
  { id: 'pascucci', name: '파스쿠찌', aliases: ['파스쿠찌'] },
  { id: 'tomntoms', name: '탐앤탐스', aliases: ['탐앤탐스'] },
] as const
export interface CafeFilter { kind: 'all' | 'brand' | 'unidentified'; brand: string }
export const allCafes: CafeFilter = { kind: 'all', brand: '' }
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s()\-_.·]/g, '')
export function classifyCafe(name: string | null) {
  if (!name) return null
  const value = normalized(name)
  return cafeBrands.find(brand => brand.aliases.some(alias => {
    const prefix = normalized(alias)
    if (value === prefix) return true
    if (!value.startsWith(prefix)) return false
    const tail = value.slice(prefix.length)
    return tail.endsWith('점') || /^[\s(-]/.test(name.slice(alias.length))
  })) ?? null
}
export function filterCafes(stores: NearbyStore[], filter: CafeFilter) {
  return stores.filter(store => {
    const brand = classifyCafe(store.name)
    return filter.kind === 'all' || (filter.kind === 'unidentified' ? !brand : !!brand && (!filter.brand || brand.id === filter.brand))
  })
}
export const cafeDistance = (meters: number) => `${meters.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}m`
