import { useState, type CSSProperties } from 'react'
import type { AdminDongTrend } from '../types/api'
import { chartHeights } from '../lib/chartScale'
import { NativeSelect } from './ui/native-select'

const sales = [['transactionCount', '거래 건수', '건'], ['estimatedSalesAmount', '추정매출', '원']]
const stores = [['storeCount', '점포 수', '개'], ['openingStoreCount', '개업 점포 수', '개'], ['closingStoreCount', '폐업 점포 수', '개']]
function MetricChart({ trend, quarter, kind }: { trend: AdminDongTrend; quarter: string; kind: 'sales' | 'stores' }) {
  const options = kind === 'sales' ? sales : stores
  const [metric, setMetric] = useState(options[0][0])
  const selected = options.find(o => o[0] === metric)!
  const quarters = trend.quarters.filter(q => q.quarter.code <= quarter).slice(-4)
  const values = quarters.map(q => metric === 'transactionCount' || metric === 'estimatedSalesAmount' ? q.salesStats?.[metric] ?? null
    : q.storeStats?.[metric as 'storeCount' | 'openingStoreCount' | 'closingStoreCount']?.toString() ?? null)
  const heights = chartHeights(values)
  const exact = (i: number) => values[i] === null ? '자료 없음' : `${BigInt(values[i]!).toLocaleString('ko-KR')}${selected[2]}`
  const x = (i: number) => quarters.length === 1 ? 200 : 24 + i * 352 / (quarters.length - 1)
  return <section className="detail-chart" aria-labelledby={`${kind}-chart-title`}>
    <h2 id={`${kind}-chart-title`} className="text-lg font-semibold">{kind === 'sales' ? '카페 소비 흐름' : '카페 점포 흐름'}</h2>
    <label htmlFor={`${kind}-chart-metric`} className="text-sm">{kind === 'sales' ? '소비' : '점포'} 그래프 지표</label>
    <NativeSelect id={`${kind}-chart-metric`} value={metric} onChange={e => setMetric(e.target.value)}>{options.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</NativeSelect>
    <p className="text-xs text-muted-foreground">선택 분기까지 최대 4분기 · 지표별 최대값을 기준으로 높이를 비교합니다. 단위: {selected[2]}. 누락·음수 자료는 그리지 않습니다.{kind === 'stores' && ' 점포 수는 기간 중 폐업을 포함할 수 있습니다.'}</p>
    {!quarters.length ? <p role="status">선택 분기까지의 그래프 자료가 없습니다.</p> : <>
      {kind === 'sales' ? <svg className="consumption-chart" viewBox="0 0 400 150" role="group" aria-label={`${selected[1]} 선 그래프`}>
        <line x1="24" x2="376" y1="126" y2="126" className="chart-axis" />
        {heights.map((h, i) => h !== null && i > 0 && heights[i - 1] !== null ? <line key={`line-${i}`} x1={x(i - 1)} y1={126 - heights[i - 1]!} x2={x(i)} y2={126 - h} className="chart-line" /> : null)}
        {quarters.map((q, i) => <g key={q.quarter.code}>{heights[i] !== null && <circle cx={x(i)} cy={126 - heights[i]!} r="4" tabIndex={0} role="img" aria-label={`${q.quarter.label} ${exact(i)}`} className="chart-point"><title>{q.quarter.label}: {exact(i)}</title></circle>}<text x={x(i)} y="146" textAnchor="middle">{q.quarter.code.slice(0, 4)} Q{q.quarter.code[4]}</text></g>)}
      </svg> : <div className="chart-bars">{quarters.map((q, i) => <div key={q.quarter.code} className="chart-column"><div className="chart-plot">{heights[i] === null ? <span>자료 없음</span> : <span tabIndex={0} role="img" aria-label={`${q.quarter.label} ${exact(i)}`} title={`${q.quarter.label}: ${exact(i)}`} className="chart-bar" style={{ '--bar-height': `${heights[i]}%` } as CSSProperties} />}</div><span>{q.quarter.label}</span></div>)}</div>}
      <table className="chart-values"><caption>{selected[1]} 정확한 값</caption><thead><tr><th scope="col">분기</th><th scope="col">{selected[1]}</th></tr></thead><tbody>{quarters.map((q, i) => <tr key={q.quarter.code}><th scope="row">{q.quarter.label}</th><td>{exact(i)}</td></tr>)}</tbody></table>
    </>}
  </section>
}
export function AnalysisCharts(props: { trend: AdminDongTrend; quarter: string }) {
  return <div className="detail-charts"><MetricChart {...props} kind="sales" /><MetricChart {...props} kind="stores" /></div>
}
