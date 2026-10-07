import type { AdminDongStats } from '../types/api'
import { Card } from '@/components/ui/card'
import { formatCount as count, formatDecimal as decimal } from '../lib/formatStats'

export function StatsResult({ stats }: { stats: AdminDongStats }) {
  const { dong, industry, quarter, storeStats, salesStats } = stats
  // The API boundary verifies that a null section has its matching NO_ROW reason.
  const empty = storeStats === null && salesStats === null
  return (
    <section className="result" aria-labelledby="result-title">
      <header className="result-header">
        <p className="eyebrow">조회 결과</p>
        <h2 id="result-title">{dong.name} · {industry.name}</h2>
        <p>{quarter.label} 기준 원본 보고값</p>
      </header>
      {empty ? <p className="notice" role="status">해당 조건의 점포 및 추정매출 자료가 없습니다.</p> : (
        <div className="grid gap-5 min-[761px]:grid-cols-2">
          <Card asChild className="min-w-0 gap-0 rounded-lg p-5 min-[761px]:p-6">
            <section className="stats-panel" aria-labelledby="store-title">
              <h3 id="store-title">점포 현황</h3>
              {storeStats === null ? <p className="empty-message">해당 조건의 점포 자료가 없습니다.</p> : (
                <table>
                  <caption className="visually-hidden">점포 통계, 단위 개</caption>
                  <tbody>
                    <tr><th scope="row">점포 수</th><td>{count(storeStats.storeCount)}</td></tr>
                    <tr><th scope="row">유사 업종 점포 수</th><td>{count(storeStats.similarStoreCount)}</td></tr>
                    <tr><th scope="row">개업 점포 수</th><td>{count(storeStats.openingStoreCount)}</td></tr>
                    <tr><th scope="row">폐업 점포 수</th><td>{count(storeStats.closingStoreCount)}</td></tr>
                    <tr><th scope="row">프랜차이즈 점포 수</th><td>{count(storeStats.franchiseStoreCount)}</td></tr>
                  </tbody>
                </table>
              )}
            </section>
          </Card>
          <Card asChild className="min-w-0 gap-0 rounded-lg p-5 min-[761px]:p-6">
            <section className="stats-panel" aria-labelledby="sales-title">
              <h3 id="sales-title">추정매출 현황</h3>
              {salesStats === null ? <p className="empty-message">해당 조건의 추정매출 자료가 없습니다.</p> : (
                <table>
                  <caption className="visually-hidden">추정매출 통계, 금액 단위 원, 건수 단위 건</caption>
                  <tbody>
                    <tr><th scope="row">추정매출</th><td>{decimal(salesStats.estimatedSalesAmount, '원')}</td></tr>
                    <tr><th scope="row">매출 건수</th><td>{decimal(salesStats.transactionCount, '건')}</td></tr>
                    <tr><th scope="row">평일 추정매출</th><td>{decimal(salesStats.weekdayEstimatedSalesAmount, '원')}</td></tr>
                    <tr><th scope="row">주말 추정매출</th><td>{decimal(salesStats.weekendEstimatedSalesAmount, '원')}</td></tr>
                  </tbody>
                </table>
              )}
            </section>
          </Card>
        </div>
      )}
      <p className="data-note">추정매출은 실제 매출이나 이익을 뜻하지 않습니다. 개업·폐업 점포 수는 성공률·실패율이 아닙니다. 결측값은 ‘자료 없음’으로 표시합니다.</p>
    </section>
  )
}
