import type { Candidate, StatsBlockReason } from '../types/comparison'
import type { AdminDongStats, StoreStats, SalesStats } from '../types/api'
import { formatCount, formatDecimal } from '../lib/formatStats'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption } from './ui/table'
import { candidateTitle } from '../lib/candidatePresentation'

const storeMetrics: { key: keyof StoreStats; label: string }[] = [
  { key: 'storeCount', label: '행정동 점포 수' }, { key: 'similarStoreCount', label: '유사 업종 점포 수' },
  { key: 'openingStoreCount', label: '개업 점포 수' }, { key: 'closingStoreCount', label: '폐업 점포 수' },
  { key: 'franchiseStoreCount', label: '프랜차이즈 점포 수' },
]
const salesMetrics: { key: keyof SalesStats; label: string; unit: '원' | '건' }[] = [
  { key: 'estimatedSalesAmount', label: '행정동 추정매출', unit: '원' }, { key: 'transactionCount', label: '매출 건수', unit: '건' },
  { key: 'weekdayEstimatedSalesAmount', label: '평일 추정매출', unit: '원' }, { key: 'weekendEstimatedSalesAmount', label: '주말 추정매출', unit: '원' },
]

export function CandidateComparisonTable({ candidates, quarter, blockReason }: {
  candidates: Candidate[]; quarter: string; blockReason: (candidate: Candidate) => StatsBlockReason | null
}) {
  const stats = (c: Candidate) => !blockReason(c) && c.statsQuarter === quarter ? c.stats.result : null
  const metric = (c: Candidate, value: (s: AdminDongStats) => string) => {
    const result = stats(c)
    if (result) return value(result)
    return c.stats.loading ? '조회 중' : c.stats.error ? '조회 실패' : blockReason(c) ? '조회 조건 확인 필요' : '미조회'
  }
  return <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-card" role="region" aria-label="후보 비교 표 가로 스크롤" tabIndex={0}>
    <Table aria-label="후보별 동일 지표 비교">
      <TableCaption>카페 수는 좌표 반경 500m, 점포·매출은 행정동 전체의 집계입니다. 서로 다른 단위를 합산하거나 환산하지 않습니다.</TableCaption>
      <TableHeader><TableRow><TableHead scope="col">비교 지표</TableHead>{candidates.map(c => <TableHead scope="col" key={c.id}>
        <span className="font-semibold text-foreground">{candidateTitle(c)}</span>
      </TableHead>)}</TableRow></TableHeader>
      <TableBody>
        <TableRow><TableHead scope="row">지역 판정</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {c.location.loading ? '판정 중' : c.location.error ? '지역 판정 실패' : c.location.result?.adminDong.status === 'AMBIGUOUS_BOUNDARY' ? '경계 모호성 — 통계 연결 불가'
            : c.location.result?.adminDong.resolvedDong?.name ?? '확정 행정동 없음'}
        </TableCell>)}</TableRow>
        <TableRow><TableHead scope="row">반경 500m 조회 카페 수</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {c.nearby.loading ? '조회 중' : c.nearby.error ? <p role="alert">{c.nearby.error.status === 503 ? '점포 자료 미준비 · 0개가 아닙니다' : '카페 조회 실패'}</p>
            : c.nearby.result ? `${BigInt(c.nearby.result.totalCount).toLocaleString('ko-KR')}개` : '미조회'}
        </TableCell>)}</TableRow>
        {storeMetrics.map(m => <TableRow key={m.key}><TableHead scope="row">{m.label}</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {metric(c, s => s.storeStats === null ? '조회 행 없음(NO_ROW)' : s.storeStats[m.key] === null ? '값 없음(NULL)' : formatCount(s.storeStats[m.key]))}
        </TableCell>)}</TableRow>)}
        {salesMetrics.map(m => <TableRow key={m.key}><TableHead scope="row">{m.label}</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {metric(c, s => s.salesStats === null ? '조회 행 없음(NO_ROW)' : s.salesStats[m.key] === null ? '값 없음(NULL)' : formatDecimal(s.salesStats[m.key], m.unit))}
        </TableCell>)}</TableRow>)}
        <TableRow><TableHead scope="row">통계 조회 상태</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {c.stats.error ? <p role="alert">통계 조회 실패: {c.stats.error.message}</p> : stats(c)?.quarter.label ?? (blockReason(c) ? '후보 상세에서 조회 조건을 확인하세요.' : '같은 분기로 후보 분석을 눌러 주세요.')}
        </TableCell>)}</TableRow>
      </TableBody>
    </Table>
  </div>
}
