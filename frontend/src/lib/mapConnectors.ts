import type { MapLabel, LabelRect } from './mapLabels'
interface Point { x: number; y: number }
export interface MapConnector { id: string; from: Point; to: Point }

// Cut blocked intervals from each segment; no stroke enters a label or control.
export function mapConnectors(labels: MapLabel[], obstacles: LabelRect[]): MapConnector[] {
  const blocked = [...labels.map(l => l.rect), ...obstacles]
  return labels.flatMap(label => {
    const from = label.anchor, r = label.rect
    const to = { x: Math.max(r.x, Math.min(from.x, r.x + r.width)), y: Math.max(r.y, Math.min(from.y, r.y + r.height)) }
    const dx = to.x - from.x, dy = to.y - from.y
    if (!dx && !dy) return []
    let intervals = [[0, 1]]
    for (const box of blocked) {
      let enter = 0, leave = 1, hit = true
      for (const [start, delta, min, max] of [[from.x, dx, box.x - 4, box.x + box.width + 4], [from.y, dy, box.y - 4, box.y + box.height + 4]]) {
        if (!delta) { if (start < min || start > max) hit = false; continue }
        const a = (min - start) / delta, b = (max - start) / delta
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b))
      }
      if (!hit || enter > leave) continue
      intervals = intervals.flatMap(([a, b]) => leave <= a || enter >= b ? [[a, b]] : [a < enter ? [a, enter] : [], leave < b ? [leave, b] : []].filter(v => v.length))
    }
    return intervals.filter(([a, b]) => Math.hypot(dx, dy) * (b - a) > 1).map(([a, b]) => ({ id: label.ids.join(','),
      from: { x: from.x + dx * a, y: from.y + dy * a }, to: { x: from.x + dx * b, y: from.y + dy * b } }))
  })
}
