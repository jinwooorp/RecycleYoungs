import { expect, it } from 'vitest'
import { classifyCafe, filterCafes } from './cafeBrands'
import type { NearbyStore } from '../types/nearby'

it.each([
  ['투썸플레이스 명동점', 'twosome'], ['이디야 커피 대학로점', 'ediya'], ['빽다방종로점', 'paik'],
  ['더벤티 신촌점', 'venti'], ['할리스커피 대학로점', 'hollys'], ['파스쿠찌 명동점', 'pascucci'], ['탐앤탐스 종로점', 'tomntoms'],
])('recognizes the added brand %s without inferring its ownership', (name, id) => {
  expect(classifyCafe(name)?.id).toBe(id)
  expect(classifyCafe(name.replace(/\s/g, '').replace(/점$/, '아님'))).toBeNull()
})

it('recognizes explicit brand aliases without claiming ownership or guessing generic names', () => {
  expect(classifyCafe('메가MGC커피 명동점')?.id).toBe('mega')
  expect(classifyCafe('컴포즈 커피 대학로점')?.id).toBe('compose')
  expect(classifyCafe('스타벅스대학로점')?.id).toBe('starbucks')
  expect(classifyCafe('메가 사랑 카페')).toBeNull()
  expect(classifyCafe('스타벅스아님')).toBeNull()
  expect(classifyCafe(null)).toBeNull()
})
it('filters the complete received list before limiting display and leaves original counts/data untouched', () => {
  const stores: NearbyStore[] = Array.from({ length: 7 }, (_, i) => ({ sourceStoreId: String(i), name: i === 6 ? '스타벅스 명동점' : '동네 카페', coordinate: { lat: 37.57, lng: 126.98 }, distanceMeters: i * 10 }))
  expect(filterCafes(stores, { kind: 'brand', brand: '' }).map(s => s.sourceStoreId)).toEqual(['6'])
  expect(filterCafes(stores, { kind: 'brand', brand: 'compose' })).toEqual([])
  expect(filterCafes(stores, { kind: 'unidentified', brand: '' })).toHaveLength(6)
  expect(stores).toHaveLength(7)
})
