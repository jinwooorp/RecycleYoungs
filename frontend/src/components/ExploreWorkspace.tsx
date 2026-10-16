import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

export function ExploreWorkspace({ panel, map, summary, collapsed, onCollapsedChange, regionControl }: {
  panel: ReactNode; map: ReactNode; summary: string; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void; regionControl?: ReactNode
}) {
  const menu = useRef<HTMLButtonElement>(null)
  const dockMenu = useRef<HTMLButtonElement>(null)
  const toggleFocus = useRef(false)
  useLayoutEffect(() => {
    if (!toggleFocus.current) return
    toggleFocus.current = false
    ;(collapsed ? menu : dockMenu).current?.focus({ preventScroll: true })
  }, [collapsed])
  const icon = <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
  return <div className={cn('explore-workspace', collapsed && 'panel-collapsed')}>
    <aside className="analysis-dock" aria-label="위치 분석 패널" inert={collapsed} aria-hidden={collapsed}>
      <div className="dock-inner">
      <div className="dock-toolbar"><div className="min-w-0"><p className="text-xs font-medium text-primary">카페 창업 환경</p>
        <p className="truncate text-sm" title={summary}>{summary}</p></div>
        <Button ref={dockMenu} hidden={collapsed} type="button" size="icon" variant="ghost" aria-label="분석 패널 닫기" aria-expanded={!collapsed} aria-controls="analysis-content"
          onClick={() => { toggleFocus.current = true; onCollapsedChange(true) }}>{icon}</Button></div>
      <div id="analysis-content" className="analysis-content">{panel}</div>
      </div>
    </aside>
    <section className="map-workspace" aria-label="창업 후보 위치 선택">
      {collapsed && <div className="map-menu"><Button ref={menu} type="button" variant="outline" size="icon" aria-label="분석 패널 열기"
        aria-expanded={false} aria-controls="analysis-content" onClick={() => { toggleFocus.current = true; onCollapsedChange(false) }}>{icon}</Button></div>}
      {regionControl}
      {map}
    </section>
  </div>
}
