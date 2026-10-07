import type { AdminDongTrend, SalesStats, StoreStats } from '../types/api'
import { formatCount, formatDecimal } from '../lib/formatStats'
import { Card } from '@/components/ui/card'

const storeMetrics: { key: keyof StoreStats; label: string }[] = [
  { key: 'storeCount', label: '점포 수' },
  { key: 'similarStoreCount', label: '유사 업종 점포 수' },
  { key: 'openingStoreCount', label: '개업 점포 수' },
  { key: 'closingStoreCount', label: '폐업 점포 수' },
  { key: 'franchiseStoreCount', label: '프랜차이즈 점포 수' },
]
const salesMetrics: { key: keyof SalesStats; label: string; unit: '원' | '건' }[] = [
  { key: 'estimatedSalesAmount', label: '추정매출', unit: '원' },
  { key: 'transactionCount', label: '매출 건수', unit: '건' },
  { key: 'weekdayEstimatedSalesAmount', label: '평일 추정매출', unit: '원' },
  { key: 'weekendEstimatedSalesAmount', label: '주말 추정매출', unit: '원' },
]

export function TrendResult({ trend }: { trend: AdminDongTrend }) {
  const { dong, industry, quarters } = trend
  const empty = quarters.every(item => item.storeStats === null && item.salesStats === null)
  return (
    <section className="result" aria-labelledby="trend-title">
      <header className="result-header">
        <p className="eyebrow">같은 조건의 추세</p>
        <h2 id="trend-title">2025년 4개 분기 추세</h2>
        <p>{dong.name} · {industry.name}</p>
        <p>선택한 상세 분기와 별개로 같은 행정동·업종의 2025년 1~4분기를 함께 보여줍니다.</p>
      </header>
      {empty && <p className="notice" role="status">2025년 네 분기 모두 점포 및 추정매출 자료가 없습니다.</p>}
      <div className="grid min-w-0 gap-5">
        <Card asChild className="min-w-0 gap-0 rounded-lg p-5 min-[761px]:p-6">
          <section className="stats-panel" aria-labelledby="trend-store-title">
            <h3 id="trend-store-title">점포 추세</h3>
            <div className="trend-table-scroll" tabIndex={0} role="region" aria-label="점포 추세 표 가로 스크롤">
              <table className="trend-table">
                <caption className="visually-hidden">{dong.name} {industry.name} 2025년 점포 추세</caption>
                <thead><tr><th scope="col">지표</th>{quarters.map(item => <th scope="col" key={item.quarter.code}>{item.quarter.label}</th>)}</tr></thead>
                <tbody>{storeMetrics.map(metric => (
                  <tr key={metric.key}>
                    <th scope="row">{metric.label}</th>
                    {quarters.map(item => <td key={item.quarter.code}>{item.storeStats === null ? '자료 없음' : formatCount(item.storeStats[metric.key])}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </Card>
        <Card asChild className="min-w-0 gap-0 rounded-lg p-5 min-[761px]:p-6">
          <section className="stats-panel" aria-labelledby="trend-sales-title">
            <h3 id="trend-sales-title">추정매출 추세</h3>
            <div className="trend-table-scroll" tabIndex={0} role="region" aria-label="추정매출 추세 표 가로 스크롤">
              <table className="trend-table">
                <caption className="visually-hidden">{dong.name} {industry.name} 2025년 추정매출 추세</caption>
                <thead><tr><th scope="col">지표</th>{quarters.map(item => <th scope="col" key={item.quarter.code}>{item.quarter.label}</th>)}</tr></thead>
                <tbody>{salesMetrics.map(metric => (
                  <tr key={metric.key}>
                    <th scope="row">{metric.label}</th>
                    {quarters.map(item => <td key={item.quarter.code}>{item.salesStats === null ? '자료 없음' : formatDecimal(item.salesStats[metric.key], metric.unit)}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </Card>
      </div>
      <p className="data-note">추정매출은 실제 매출이나 이익을 뜻하지 않습니다. 개업·폐업 점포 수는 성공률·실패율이 아닙니다. ‘자료 없음’은 행 부재 또는 원본 값의 결측이며 실제 0과 구분합니다.</p>
    </section>
  )
}
