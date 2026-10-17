import { useId } from 'react'
import type { CafeReview } from '../lib/cafeReview'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card'

export function CafeReviewSummary({ review }: { review: CafeReview }) {
  const id = useId()
  return <Card asChild density="compact"><section aria-labelledby={id} aria-live="polite">
    <CardHeader><CardTitle id={id}>창업 검토 요약</CardTitle><CardDescription>{review.headline}</CardDescription></CardHeader>
    <CardContent><div className="flex flex-col gap-2 text-sm">
      <p>{review.summary}</p>
      {review.state === 'READY' && <p className="text-xs text-muted-foreground">소비 동향 중심의 참고 해석 · 창업 가능 여부를 확정하는 결과는 아닙니다.</p>}
    </div></CardContent>
  </section></Card>
}
