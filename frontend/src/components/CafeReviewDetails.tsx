import { useId } from 'react'
import type { CafeReview } from '../lib/cafeReview'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card'

export function CafeReviewDetails({ review }: { review: CafeReview }) {
  const id = useId()
  return <Card asChild><section aria-labelledby={id}>
    <CardHeader><CardTitle id={id}>검토 근거와 다음 확인사항</CardTitle><CardDescription>{review.headline}</CardDescription></CardHeader>
    <CardContent><div className="flex flex-col gap-4 text-sm">
      <p>{review.summary}</p>
      {review.evidence.length > 0 && <div><h3 className="font-semibold">자료로 확인한 내용</h3><ul className="mt-2 flex list-disc flex-col gap-1 pl-5">{review.evidence.map(e => <li key={e}>{e}</li>)}</ul></div>}
      {review.checks.length > 0 && <div><h3 className="font-semibold">다음에 확인할 내용</h3><ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">{review.checks.map(e => <li key={e}>{e}</li>)}</ol></div>}
      <details><summary>아직 판단에 반영하지 못한 정보</summary><p className="mt-2">{review.missing.join(' · ')}</p></details>
      <p className="text-xs text-muted-foreground">점수는 행정동 전체, 주변 카페는 선택 지점 반경입니다. 원자료 기준일·완전성은 미검증이며, 경쟁 점포 수만으로 과밀·유리함을 판정하지 않습니다. 창업 성공·수익을 예측하지 않습니다.</p>
    </div></CardContent>
  </section></Card>
}
