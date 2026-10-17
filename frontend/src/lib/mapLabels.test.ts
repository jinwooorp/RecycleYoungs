import { expect, it } from 'vitest'
import { layoutMapLabels } from './mapLabels'

it('groups identical coordinates and keeps every store reachable without moving source points', () => {
  const result = layoutMapLabels([{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 100, y: 100 }, { id: 'c', x: 400, y: 250 }], { width: 600, height: 400 }, [])
  expect(result.map(g => g.ids)).toEqual([['a', 'b'], ['c']])
  expect(result[0].anchor).toEqual({ x: 100, y: 100 })
})
it('does not chain a whole street into one group through intermediary stores', () => {
  const result = layoutMapLabels([{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 130, y: 100 }, { id: 'c', x: 160, y: 100 }, { id: 'd', x: 190, y: 100 }], { width: 800, height: 500 }, [])
  expect(result.map(g => g.ids)).toEqual([['a', 'b'], ['c', 'd']])
})
it('keeps labels in the viewport and outside controls and each other, retaining all nearby ids', () => {
  const obstacle = { x: 0, y: 0, width: 320, height: 80 }
  const result = layoutMapLabels([{ id: 'a', x: 8, y: 85 }, { id: 'b', x: 90, y: 85 }, { id: 'c', x: 230, y: 90 }], { width: 320, height: 250 }, [obstacle])
  expect(result.flatMap(g => g.ids).sort()).toEqual(['a', 'b', 'c'])
  for (const g of result) { expect(g.rect.x).toBeGreaterThanOrEqual(0); expect(g.rect.y).toBeGreaterThanOrEqual(80); expect(g.rect.x + g.rect.width).toBeLessThanOrEqual(320) }
  if (result.length > 1) expect(result[0].rect.y + result[0].rect.height <= result[1].rect.y || result[1].rect.y + result[1].rect.height <= result[0].rect.y || result[0].rect.x + result[0].rect.width <= result[1].rect.x || result[1].rect.x + result[1].rect.width <= result[0].rect.x).toBe(true)
})
