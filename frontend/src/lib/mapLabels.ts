export interface LabelPoint { id: string; x: number; y: number; active?: boolean }
export interface LabelRect { x: number; y: number; width: number; height: number }
export interface MapLabel { ids: string[]; anchor: { x: number; y: number }; rect: LabelRect }
const overlaps = (a: LabelRect, b: LabelRect) => a.x < b.x + b.width + 6 && a.x + a.width + 6 > b.x && a.y < b.y + b.height + 6 && a.y + a.height + 6 > b.y
export function layoutMapLabels(points: LabelPoint[], size: { width: number; height: number }, obstacles: LabelRect[]): MapLabel[] {
  if (size.width < 180 || size.height < 70) return []
  const groups: { points: LabelPoint[] }[] = []
  for (const point of [...points].sort((a, b) => Number(!!b.active) - Number(!!a.active))) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > size.width || point.y > size.height) continue
    const group = groups.find(g => !point.active && !g.points[0].active && Math.hypot(g.points[0].x - point.x, g.points[0].y - point.y) < 38)
    if (group) group.points.push(point)
    else groups.push({ points: [point] })
  }
  const result: MapLabel[] = []
  const width = Math.min(180, size.width - 12), height = 44
  for (const { points: members } of groups) {
    const point = members[0], anchor = { x: point.x, y: point.y }
    const candidates: LabelRect[] = []
    for (const [dx, dy] of [[-width / 2, -58], [10, -22], [-width - 10, -22], [-width / 2, 14]]) candidates.push({ x: point.x + dx, y: point.y + dy, width, height })
    // Find a free on-screen slot even when a control covers the preferred side.
    for (let y = 6; y + height <= size.height - 6; y += 50) for (let x = 6; x + width <= size.width - 6; x += 50) candidates.push({ x, y, width, height })
    const rect = candidates.filter(r => r.x >= 0 && r.y >= 0 && r.x + r.width <= size.width && r.y + r.height <= size.height
      && ![...obstacles, ...result.map(g => g.rect)].some(other => overlaps(r, other)))
      .sort((a, b) => Math.hypot(a.x + width / 2 - point.x, a.y + height / 2 - point.y) - Math.hypot(b.x + width / 2 - point.x, b.y + height / 2 - point.y))[0]
    if (rect) result.push({ ids: members.map(p => p.id), anchor, rect })
    else if (result.length) {
      const nearest = [...result].sort((a, b) => Math.hypot(a.anchor.x - point.x, a.anchor.y - point.y) - Math.hypot(b.anchor.x - point.x, b.anchor.y - point.y))[0]
      nearest.ids.push(...members.map(p => p.id))
    }
  }
  return result
}
