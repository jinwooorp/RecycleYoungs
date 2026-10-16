import type { ReactNode } from 'react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

export function ExploreWorkspace({ panel, map, summary, collapsed, onCollapsedChange }: {
  panel: ReactNode; map: ReactNode; summary: string; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void
}) {
  return <div className={cn('explore-workspace', collapsed && 'panel-collapsed')}>
    <aside className="analysis-dock" aria-label="위치 분석 패널">
      <div className="dock-toolbar"><div className="min-w-0"><p className="text-xs font-medium text-primary">카페 창업 환경</p>
        <p className="truncate text-sm" title={summary}>{summary}</p></div>
        <Button type="button" size="sm" variant="ghost" aria-expanded={!collapsed} aria-controls="analysis-content"
          onClick={() => onCollapsedChange(!collapsed)}>{collapsed ? '분석 열기' : '접기'}</Button></div>
      <div id="analysis-content" className="analysis-content" hidden={collapsed}>{panel}</div>
    </aside>
    <section className="map-workspace" aria-label="창업 후보 위치 선택">{map}</section>
  </div>
}
