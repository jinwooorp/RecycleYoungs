import { expect, it } from 'vitest'
import { mapConnectors } from './mapConnectors'
import type { MapLabel } from './mapLabels'

it('stops at the label edge and cuts every line around other labels and controls', () => {
  const labels: MapLabel[] = [{ ids: ['a'], anchor: { x: 10, y: 40 }, rect: { x: 210, y: 20, width: 180, height: 44 } },
    { ids: ['b'], anchor: { x: 100, y: 160 }, rect: { x: 80, y: 20, width: 80, height: 44 } }]
  const lines = mapConnectors(labels, [{ x: 175, y: 0, width: 20, height: 100 }])
  const first = lines.filter(l => l.id === 'a')
  expect(first.length).toBe(3)
  expect(first[0].from).toEqual(labels[0].anchor)
  expect(first.at(-1)!.to.x).toBeLessThan(210)
  for (const line of first) {
    expect(line.from.y).toBe(40); expect(line.to.y).toBe(40)
    expect(line.to.x < 80 || line.from.x > 160).toBe(true)
    expect(line.to.x < 175 || line.from.x > 195).toBe(true)
  }
})
it('omits connectors when a label already covers the anchor', () => {
  expect(mapConnectors([{ ids: ['a'], anchor: { x: 40, y: 40 }, rect: { x: 0, y: 0, width: 180, height: 44 } }], [])).toEqual([])
})
