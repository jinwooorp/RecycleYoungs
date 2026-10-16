import { Button } from './ui/button'

export type AppView = 'explore' | 'compare' | 'statistics' | 'guide'
const views: { value: AppView; label: string; short: string }[] = [
  { value: 'explore', label: '지도 탐색', short: '지도 탐색' },
  { value: 'compare', label: '후보 비교', short: '후보 비교' },
  { value: 'statistics', label: '행정동 직접 조회', short: '직접 조회' },
  { value: 'guide', label: '데이터 안내', short: '데이터 안내' },
]

export function AppNavigation({ view, count, onChange }: { view: AppView; count: number; onChange: (view: AppView) => void }) {
  return <header className="app-navigation">
      <a href="#explore" className="brand" onClick={event => { event.preventDefault(); onChange('explore') }}>여기 창업해도 돼?<span>서울 · 카페 입지 탐색</span></a>
      <nav aria-label="주요 화면" className="navigation-items">
        {views.map(item => <Button key={item.value} type="button" size="nav" aria-label={item.label} variant={view === item.value ? 'secondary' : 'ghost'}
          aria-current={view === item.value ? 'page' : undefined} onClick={() => onChange(item.value)}>
          {item.short}{item.value === 'compare' && <span aria-hidden="true" className="hidden tabular-nums min-[420px]:inline">{count}/3</span>}
        </Button>)}
      </nav>
  </header>
}
