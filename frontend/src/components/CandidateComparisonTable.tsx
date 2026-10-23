import type { Candidate, StatsBlockReason } from '../types/comparison'
import type { AdminDongStats, StoreStats, SalesStats, Quarter } from '../types/api'
import { formatCount, formatDecimal } from '../lib/formatStats'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption } from './ui/table'
import { candidateTitle } from '../lib/candidatePresentation'
import type { ChangeScores, ConsumptionScores } from '../types/regions'
import { formatChangeRate } from '../lib/readableNumbers'
import { buildCafeReview } from '../lib/cafeReview'
import { isFirstProvidedQuarter } from '../lib/changeScoreAvailability'

const storeMetrics: { key: keyof StoreStats; label: string }[] = [
  { key: 'storeCount', label: '행정동 점포 수' }, { key: 'similarStoreCount', label: '유사 업종 점포 수' },
  { key: 'openingStoreCount', label: '개업 점포 수' }, { key: 'closingStoreCount', label: '폐업 점포 수' },
  { key: 'franchiseStoreCount', label: '프랜차이즈 점포 수' },
]
const salesMetrics: { key: keyof SalesStats; label: string; unit: '원' | '건' }[] = [
  { key: 'estimatedSalesAmount', label: '행정동 추정매출', unit: '원' }, { key: 'transactionCount', label: '매출 건수', unit: '건' },
  { key: 'weekdayEstimatedSalesAmount', label: '평일 추정매출', unit: '원' }, { key: 'weekendEstimatedSalesAmount', label: '주말 추정매출', unit: '원' },
]

export function CandidateComparisonTable({ candidates, quarter, blockReason, consumption, scoreLoading, scoreError, change, changeLoading, changeError, detailed = false, quarters = [] }: {
  candidates: Candidate[]; quarter: string; blockReason: (candidate: Candidate) => StatsBlockReason | null
  consumption?: ConsumptionScores | null; scoreLoading?: boolean; scoreError?: string | null
  change?: ChangeScores | null; changeLoading?: boolean; changeError?: string | null
  detailed?: boolean
  quarters?: Quarter[]
}) {
  const code = (c: Candidate) => c.location.result?.adminDong.resolvedDong?.code ?? ''
  const shared = (c: Candidate) => {
    const first = code(c) && candidates.find(other => code(other) === code(c) && !blockReason(other))
    return first && first.id !== c.id ? `같은 지역 근거: ${candidateTitle(first)}` : null
  }
  const review = (c: Candidate) => buildCafeReview({ dongCode: code(c), quarterCode: quarter,
    consumption: { result: consumption ?? null, loading: !!scoreLoading, error: scoreError ?? null }, change: { result: change ?? null, loading: !!changeLoading, error: changeError ?? null },
    unavailableReason: blockReason(c) ? '후보의 지역·분기 조회 조건을 확인해 주세요.' : undefined, point: c.coordinate, nearby: !c.nearby.loading && !c.nearby.error ? c.nearby.result : null })
  const stats = (c: Candidate) => !blockReason(c) && c.statsQuarter === quarter ? c.stats.result : null
  const metric = (c: Candidate, value: (s: AdminDongStats) => string) => {
    const result = stats(c)
    if (result) return value(result)
    return c.stats.loading ? '조회 중' : c.stats.error ? '조회 실패' : blockReason(c) ? '조회 조건 확인 필요' : '미조회'
  }
  return <div className="comparison-scroll min-w-0 rounded-xl border border-border bg-card" role="region" aria-label="후보 비교 표 가로 스크롤" tabIndex={0}>
    <Table aria-label={detailed ? '후보별 전체 통계 비교' : '후보별 동일 지표 비교'}>
      <TableCaption>카페 수는 좌표 반경 500m, 점포·매출은 행정동 전체의 집계입니다. 서로 다른 단위를 합산하거나 환산하지 않습니다.</TableCaption>
      <TableHeader><TableRow><TableHead scope="col">비교 지표</TableHead>{candidates.map(c => <TableHead scope="col" key={c.id}>
        <span className="font-semibold text-foreground">{candidateTitle(c)}</span>
      </TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {detailed ? <>
        <TableRow><TableHead scope="row">카페 소비증감 점수 (100점)</TableHead>{candidates.map(c => <TableCell key={c.id}>{(() => {
          if (blockReason(c)) return '조회 조건 확인 필요'
          if (changeLoading) return '조회 중'
          if (changeError) return '점수 조회 실패'
          const value = change?.quarter.code === quarter ? change.items.find(i => i.dong.code === c.location.result?.adminDong.resolvedDong?.code) : null
          return value ? isFirstProvidedQuarter(change ?? null, code(c), quarters) ? '첫 제공 분기 · 비교 기준 없음'
            : value.score === null ? '산정 불가' : `${value.score}/100점 · ${formatChangeRate(value.changeRate, value.direction)}` : '미조회'
        })()}</TableCell>)}</TableRow>
        <TableRow><TableHead scope="row">카페 소비규모 점수 (100점)</TableHead>{candidates.map(c => <TableCell key={c.id}>{(() => {
          if (blockReason(c)) return '조회 조건 확인 필요'
          if (scoreLoading) return '조회 중'
          if (scoreError) return '점수 조회 실패'
          const value = consumption?.quarter.code === quarter ? consumption.items.find(i => i.dong.code === c.location.result?.adminDong.resolvedDong?.code) : null
          return value ? value.score === null ? '산정 불가' : `${value.score}/100점` : '미조회'
        })()}</TableCell>)}</TableRow>
        <TableRow><TableHead scope="row">지역 판정</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {c.location.loading ? '판정 중' : c.location.error ? '지역 판정 실패' : c.location.result?.adminDong.status === 'AMBIGUOUS_BOUNDARY' ? '경계 모호성 — 통계 연결 불가'
            : c.location.result?.adminDong.resolvedDong?.name ?? '확정 행정동 없음'}
        </TableCell>)}</TableRow>
        <TableRow><TableHead scope="row">반경 500m 조회 카페 수</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {c.nearby.loading ? '조회 중' : c.nearby.error ? <p role="alert">{c.nearby.error.status === 503 ? '점포 자료 미준비 · 0개가 아닙니다' : '카페 조회 실패'}</p>
            : c.nearby.result ? `${BigInt(c.nearby.result.totalCount).toLocaleString('ko-KR')}개` : '미조회'}
        </TableCell>)}</TableRow>
        {storeMetrics.map(m => <TableRow key={m.key}><TableHead scope="row">{m.label}</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {metric(c, s => s.storeStats === null ? '집계 자료 없음' : s.storeStats[m.key] === null ? '값이 제공되지 않음' : formatCount(s.storeStats[m.key]))}
        </TableCell>)}</TableRow>)}
        {salesMetrics.map(m => <TableRow key={m.key}><TableHead scope="row">{m.label}</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {metric(c, s => s.salesStats === null ? '집계 자료 없음' : s.salesStats[m.key] === null ? '값이 제공되지 않음' : formatDecimal(s.salesStats[m.key], m.unit))}
        </TableCell>)}</TableRow>)}
        <TableRow><TableHead scope="row">통계 조회 상태</TableHead>{candidates.map(c => <TableCell key={c.id}>
          {c.stats.error ? <p role="alert">통계 조회 실패: {c.stats.error.message}</p> : stats(c)?.quarter.label ?? (blockReason(c) ? '후보 상세에서 조회 조건을 확인하세요.' : '같은 분기로 후보 분석을 눌러 주세요.')}
        </TableCell>)}</TableRow>
        </> : <>
          <TableRow><TableHead scope="row">검토 요약</TableHead>{candidates.map(c => <TableCell key={c.id}>{shared(c) ?? review(c).headline}</TableCell>)}</TableRow>
          <TableRow><TableHead scope="row">카페 소비규모 점수 (100점)</TableHead>{candidates.map(c => <TableCell key={c.id}>{shared(c) ?? (() => {
            if (blockReason(c)) return '조회 조건 확인 필요'
            if (scoreLoading) return '조회 중'
            if (scoreError) return '점수 조회 실패'
            const value = consumption?.quarter.code === quarter ? consumption.items.find(i => i.dong.code === code(c)) : null
            return value?.score !== null && value?.score !== undefined ? `${value.score}/100점` : value ? '산정 불가' : '미조회'
          })()}</TableCell>)}</TableRow>
          <TableRow><TableHead scope="row">실제 소비 증감 (전분기 대비)</TableHead>{candidates.map(c => <TableCell key={c.id}>{shared(c) ?? (() => {
            if (blockReason(c)) return '조회 조건 확인 필요'
            if (changeLoading) return '조회 중'
            if (changeError) return '조회 실패'
            const value = change?.quarter.code === quarter ? change.items.find(i => i.dong.code === code(c)) : null
            return value ? isFirstProvidedQuarter(change ?? null, code(c), quarters) ? '첫 제공 분기 · 비교 기준 없음' : value.reason === 'PREVIOUS_QUARTER_UNAVAILABLE' ? '직전 분기 자료 없음' : formatChangeRate(value.changeRate, value.direction) : '미조회'
          })()}</TableCell>)}</TableRow>
          <TableRow><TableHead scope="row">반경 500m 조회 카페 수</TableHead>{candidates.map(c => <TableCell key={c.id}>{c.nearby.loading ? '조회 중' : c.nearby.error ? '조회 실패 · 0개가 아님' : c.nearby.result ? `${BigInt(c.nearby.result.totalCount).toLocaleString('ko-KR')}개` : '미조회'}</TableCell>)}</TableRow>
          <TableRow><TableHead scope="row">다음 확인사항</TableHead>{candidates.map(c => <TableCell key={c.id}>{review(c).checks.length ? review(c).checks.slice(0, 2).join(' · ') : '자료를 먼저 확인한 뒤 영업시간·임대·운영비를 검토하세요.'}</TableCell>)}</TableRow>
        </>}
      </TableBody>
    </Table>
  </div>
}
