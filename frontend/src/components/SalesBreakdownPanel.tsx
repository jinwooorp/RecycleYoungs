import type { useSalesBreakdown } from '../hooks/useSalesBreakdown'
import { exactContextNumber, salesCodeNames } from '../lib/contextLabels'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

export function SalesBreakdownPanel({result,loading,error,retry}:ReturnType<typeof useSalesBreakdown>) {
  const groups = {dayTypes:'주중·주말',weekdays:'요일',timeSlots:'시간대',sexes:'성별',ages:'연령대'} as const
  return <Card asChild><section aria-label="카페 세부 매출 구성">
    <CardHeader><CardTitle>카페 세부 매출 구성</CardTitle><CardDescription>기존 카페 추정매출의 구성입니다. 금액은 원, 거래건수는 건입니다. 수익이나 고객 수가 아니며 구성별 합계를 맞추어 보정하지 않습니다.</CardDescription></CardHeader>
    <CardContent><div className="flex flex-col gap-4">
      {loading && <p role="status">카페 세부 매출을 불러오는 중입니다.</p>}
      {error && <div role="status"><p>세부 매출 조회 불가: {error}</p><Button variant="outline" onClick={retry}>세부 매출 다시 조회</Button></div>}
      {result?.missingReason === 'NO_ROW' && <p>이 지역·분기의 카페 매출 집계 행이 없습니다. 매출 0원이 아닙니다.</p>}
      {result?.sales && <>
        <p>{result.dong.name} · {result.quarter.label} · 행정동 전체</p>
        <p>추정매출 {exactContextNumber(result.sales.totals.estimatedSalesAmount)} 원 · 거래 {exactContextNumber(result.sales.totals.transactionCount)} 건</p>
        {Object.entries(groups).map(([key,label]) => <details key={key} className="source-details"><summary>{label}별 구성</summary>
          <Table><TableHeader><TableRow><TableHead>구분</TableHead><TableHead>추정매출(원)</TableHead><TableHead>거래건수(건)</TableHead></TableRow></TableHeader><TableBody>
            {result.sales![key as keyof typeof groups].map(item => <TableRow key={item.code}><TableCell>{salesCodeNames[item.code] ?? `${item.code.replace('_','~')}시`}</TableCell><TableCell>{exactContextNumber(item.estimatedSalesAmount)}</TableCell><TableCell>{exactContextNumber(item.transactionCount)}</TableCell></TableRow>)}
          </TableBody></Table>
        </details>)}
        <p className="text-sm text-muted-foreground">출처: 서울시 상권분석서비스 행정동 추정매출 · 선택 분기 원천 값 · 과거 경계 일치와 원천 완전성은 미검증입니다.</p>
      </>}
    </div></CardContent>
  </section></Card>
}
