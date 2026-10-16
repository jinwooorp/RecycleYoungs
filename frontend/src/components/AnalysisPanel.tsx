import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Button } from './ui/button'

export type PanelTab = 'overview' | 'nearby' | 'statistics'
const tabs: { id: PanelTab; label: string }[] = [
  { id: 'overview', label: '위치 요약' }, { id: 'nearby', label: '주변 카페' }, { id: 'statistics', label: '행정동 통계' },
]
export function AnalysisPanel({ tab, onTabChange, header, overview, nearby, statistics, candidates, selectionKey }: {
  tab: PanelTab; onTabChange: (tab: PanelTab) => void
  header: ReactNode; overview: ReactNode; nearby: ReactNode; statistics: ReactNode; candidates: ReactNode
  selectionKey: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = 0 }, [tab, selectionKey])
  return <>
    <div className="selection-header">{header}</div>
    <div ref={list} role="tablist" aria-label="위치 분석 항목" className="panel-tabs" onKeyDown={event => {
      const index = tabs.findIndex(item => item.id === tab)
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
      if (next < 0) return
      event.preventDefault()
      onTabChange(tabs[next].id)
      list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    }}>
      {tabs.map(item => <Button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`}
        aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} variant={tab === item.id ? 'secondary' : 'ghost'}
        onClick={() => onTabChange(item.id)}>{item.label}</Button>)}
    </div>
    <div ref={scroll} className="panel-scroll">
      <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" hidden={tab !== 'overview'} tabIndex={0}>{overview}</div>
      <div id="panel-nearby" role="tabpanel" aria-labelledby="tab-nearby" hidden={tab !== 'nearby'} tabIndex={0}>{tab === 'nearby' && nearby}</div>
      <div id="panel-statistics" role="tabpanel" aria-labelledby="tab-statistics" hidden={tab !== 'statistics'} tabIndex={0}>{statistics}</div>
    </div>
    {candidates}
  </>
}
