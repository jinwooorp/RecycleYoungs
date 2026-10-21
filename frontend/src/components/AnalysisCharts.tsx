import { useState, type CSSProperties, type ReactNode } from 'react'
import type { AdminDongTrend, AdminDongStats, SalesStats, StoreStats } from '../types/api'
import { chartScale, formatAxisTick } from '../lib/chartScale'
import { NativeSelect } from './ui/native-select'

const sales = [['transactionCount', '거래 건수', '건'], ['estimatedSalesAmount', '추정매출', '원'], ['weekdayEstimatedSalesAmount', '평일 추정매출', '원'], ['weekendEstimatedSalesAmount', '주말 추정매출', '원']]
const stores = [['storeCount', '점포 수', '개'], ['openingStoreCount', '개업 점포 수', '개'], ['closingStoreCount', '폐업 점포 수', '개'], ['similarStoreCount', '유사 업종 점포 수', '개'], ['franchiseStoreCount', '프랜차이즈 점포 수', '개']]
function ValueDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <details open={open}><summary onClick={event => { event.preventDefault(); setOpen(value => !value) }}>{label}</summary>{open && children}</details>
}
function MetricChart({ trend, stats, quarter, kind }: { trend: AdminDongTrend | null; stats: AdminDongStats | null; quarter: string; kind: 'sales' | 'stores' }) {
  const options = kind === 'sales' ? sales : stores
  const [metric, setMetric] = useState(options[0][0])
  const selected = options.find(o => o[0] === metric)!
  const quarters = trend?.quarters.filter(q => q.quarter.code <= quarter).slice(-4) ?? []
  const currentTrend = quarters.find(q => q.quarter.code === quarter)
  const group = (row: Pick<AdminDongStats, 'salesStats' | 'storeStats'>) => kind === 'sales' ? row.salesStats : row.storeStats
  const value = (row: Pick<AdminDongStats, 'salesStats' | 'storeStats'> | undefined, key: string) => row ? (kind === 'sales' ? row.salesStats?.[key as keyof SalesStats] : row.storeStats?.[key as keyof StoreStats])?.toString() ?? null : null
  const mismatch = !!stats && !!currentTrend && ((group(stats) === null) !== (group(currentTrend) === null) || options.some(([key]) => value(stats, key) !== value(currentTrend, key)))
  const current = stats ?? currentTrend
  const currentValue = value(current, metric)
  const formatted = (v: string | null, unit: string) => v === null ? '값이 제공되지 않음' : `${BigInt(v).toLocaleString('ko-KR')}${unit}`
  const values = quarters.map(q => value(q, metric))
  const scale = chartScale(values), heights = scale.heights
  const oneYear = new Set(quarters.map(q => q.quarter.code.slice(0, 4))).size === 1
  const exact = (i: number) => values[i] === null ? '자료 없음' : `${BigInt(values[i]!).toLocaleString('ko-KR')}${selected[2]}`
  const x = (i: number) => (i + 0.5) * 100 / quarters.length
  return <section className="detail-chart" aria-labelledby={`${kind}-chart-title`}>
    <h2 id={`${kind}-chart-title`} className="text-lg font-semibold">{kind === 'sales' ? '카페 소비 흐름' : '카페 점포 흐름'}</h2>
    {mismatch ? <p role="status">조회 결과와 추세 값이 달라 함께 표시하지 않습니다. 통계를 다시 불러와 주세요.</p> : <>
    <p className="text-sm">선택 분기 {selected[1]} · <strong>{current && group(current) === null ? '집계 자료 없음' : !current ? '자료 확인 중' : formatted(currentValue, selected[2])}</strong></p>
    <label htmlFor={`${kind}-chart-metric`} className="text-sm">{kind === 'sales' ? '소비' : '점포'} 그래프 지표</label>
    <NativeSelect id={`${kind}-chart-metric`} value={metric} onChange={e => setMetric(e.target.value)}>{options.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</NativeSelect>
    <p className="text-sm text-muted-foreground">{oneYear && `${quarters[0].quarter.code.slice(0, 4)}년 · `}선택한 분기까지 최대 4분기를 비교합니다. 단위: {selected[2]}. 자료가 없는 구간은 비워 둡니다.{kind === 'stores' && ' 점포 수에는 기간 중 폐업한 곳이 포함될 수 있습니다.'}</p>
    {values.some(v => v?.startsWith('-')) && <p className="text-sm text-muted-foreground">0보다 작은 값은 확인이 필요해 그래프에서 제외했습니다. 원래 값은 아래 표에 표시합니다.</p>}
    {!quarters.length ? <p role="status">선택 분기까지의 그래프 자료가 없습니다.</p> : <>
      <div className="chart-frame" role="group" aria-label={`${selected[1]} ${kind === 'sales' ? '선' : '막대'} 그래프`}>
        <div className="chart-y-axis" aria-label={`세로축 눈금, 단위 ${selected[2]}`}>{scale.ticks.map(t => {
          const position = Number(BigInt(t) * 10000n / BigInt(scale.maximum)) / 100
          return <span key={t} className="chart-tick" style={{ '--tick-position': `${position}%` } as CSSProperties} title={`${BigInt(t).toLocaleString('ko-KR')}${selected[2]}`}>{formatAxisTick(t)}</span>
        })}</div>
        <div className="chart-plot-area">
          <svg className="chart-drawing" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {scale.ticks.map(t => { const y = 100 - Number(BigInt(t) * 10000n / BigInt(scale.maximum)) / 100; return <line key={t} x1="0" x2="100" y1={y} y2={y} className="chart-grid" vectorEffect="non-scaling-stroke" /> })}
            {kind === 'sales' && heights.map((h, i) => h !== null && i > 0 && heights[i - 1] !== null ? <line key={i} x1={x(i - 1)} y1={100 - heights[i - 1]!} x2={x(i)} y2={100 - h} className="chart-line" vectorEffect="non-scaling-stroke" /> : null)}
          </svg>
          {quarters.map((q, i) => heights[i] !== null && <span key={q.quarter.code} className="chart-observation"><span tabIndex={0} role="img" aria-label={`${q.quarter.label} ${exact(i)}`} title={`${q.quarter.label}: ${exact(i)}`}
            className={kind === 'sales' ? 'chart-dot' : 'chart-bar'} style={{ '--chart-x': `${x(i)}%`, '--chart-y': `${heights[i]}%`, '--bar-width': `${60 / quarters.length}%` } as CSSProperties} /><span className="chart-tooltip">{q.quarter.label}<br />{exact(i)}</span></span>)}
          {heights.every(h => h === null) && <p className="chart-empty">그래프로 표시할 수 있는 값이 없습니다.</p>}
        </div>
        <div className="chart-periods" style={{ '--chart-columns': quarters.length } as CSSProperties}>{quarters.map(q => <span key={q.quarter.code}>{!oneYear && <span>{q.quarter.code.slice(0, 4)}년</span>}<span>{q.quarter.code[4]}분기</span></span>)}</div>
      </div>
      <ValueDisclosure label="정확한 값 보기"><table className="chart-values"><caption>{selected[1]} 정확한 값</caption><thead><tr><th scope="col">분기</th><th scope="col">{selected[1]}</th></tr></thead><tbody>{quarters.map((q, i) => <tr key={q.quarter.code}><th scope="row">{q.quarter.label}</th><td>{exact(i)}</td></tr>)}</tbody></table></ValueDisclosure>
    </>}
    {current && <ValueDisclosure label="선택 분기 세부지표"><table className="chart-values"><caption>{kind === 'sales' ? '소비' : '점포'} 세부지표</caption><tbody>{options.filter(([key]) => key !== metric).map(([key, label, unit]) => <tr key={key}><th scope="row">{label}</th><td>{group(current) === null ? '집계 자료 없음' : formatted(value(current, key), unit)}</td></tr>)}</tbody></table></ValueDisclosure>}
    <p className="text-xs text-muted-foreground">{kind === 'sales' ? '거래 횟수는 고객 수가 아니며 추정매출은 이익이 아닙니다.' : '프랜차이즈 수는 행정동 집계이며 개별 점포의 운영 형태를 확정하지 않습니다. 개·폐업 수는 성공·실패율이 아닙니다.'} 실제 0과 자료가 없는 상태를 구분합니다.</p>
    </>}
  </section>
}
export function AnalysisCharts({ trend = null, stats = null, quarter, dongCode }: { trend?: AdminDongTrend | null; stats?: AdminDongStats | null; quarter: string; dongCode?: string }) {
  if (stats && trend && stats.metadata?.dataVersion !== trend.metadata?.dataVersion)
    return <p role="alert">자료 버전이 달라 통계와 추세를 함께 표시할 수 없습니다. 조회 조건을 다시 불러와 주세요.</p>
  const code = dongCode ?? stats?.dong.code ?? trend?.dong.code
  const validStats = stats && stats.dong.code === code && stats.industry.code === 'CAFE' && stats.quarter.code === quarter ? stats : null
  const validTrend = trend && trend.dong.code === code && trend.industry.code === 'CAFE' ? trend : null
  const name = validStats?.dong.name ?? validTrend?.dong.name
  return <section className="min-w-0" aria-label={name ? `${name} · 카페` : '행정동 소비·점포 근거'}>
    {name && <header><h2 className="text-lg font-semibold">{name} · 카페</h2><p className="text-sm text-muted-foreground">{quarter.slice(0, 4)}년 {quarter[4]}분기 · 행정동 전체 통계</p></header>}
    <div className="detail-charts"><MetricChart trend={validTrend} stats={validStats} quarter={quarter} kind="sales" /><MetricChart trend={validTrend} stats={validStats} quarter={quarter} kind="stores" /></div>
  </section>
}
