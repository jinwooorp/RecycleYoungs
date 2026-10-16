import { useId } from 'react'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { cafeScoreFactors } from '../lib/cafeScore'

export function CafeAssessment() {
  const titleId = useId()
  return <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-primary">향후 평가 계획</p>
      <h2 id={titleId} className="text-lg font-semibold">종합 평가는 아직 제공하지 않습니다</h2></div><Badge variant="outline">검토 중 · 현재 점수 아님</Badge></div>
    <p className="text-sm text-muted-foreground">현재는 소비규모와 소비증감 점수를 제공합니다. 인구·경쟁·가게 유형을 함께 평가하려면 같은 시기와 범위의 자료를 더 확보해야 합니다.</p>
    <details className="source-details"><summary>앞으로 어떤 자료가 더 필요한가요?</summary><div className="mt-2 flex flex-col gap-3 text-sm text-muted-foreground">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cafeScoreFactors.map(factor => <div key={factor.name} className="rounded-lg border border-border bg-card p-3">
        <p className="font-semibold">{factor.name} {factor.weight}점 기준</p><p className="text-sm">{factor.detail}</p><p className="mt-2 text-xs text-muted-foreground">{factor.reason}</p>
      </div>)}</div>
      <Alert><AlertDescription>배점은 검증 전 설계안입니다. 점수는 행정동의 상대적 환경을 비교하는 기준이며 창업 성공률·수익·창업 가능 여부를 뜻하지 않습니다. 같은 행정동의 후보는 같은 지역 점수를 받습니다.</AlertDescription></Alert>
      <p>서울의 동네들을 같은 조건으로 비교하는 방안을 검토합니다. 고른 후보 2~3곳끼리만 점수를 매기는 방식은 아닙니다.</p>
      <p>인구와 고객 수요 35%, 경쟁 25%, 소비 25%, 변화의 크기 15%는 아직 검증하지 않은 배점 초안입니다. 자료가 부족하면 남은 항목만으로 총점을 만들지 않습니다. 배점을 바꿨을 때 결과가 크게 달라지는지도 확인해야 합니다.</p>
      <p>프랜차이즈 수는 행정동 시장 구성의 참고 정보입니다. 브랜드별 가맹/직영 여부·가격대·콘셉트는 현재 확인되지 않아 임의로 점수에 반영하지 않습니다.</p>
      <p>임대료·권리금·인건비·운영 역량은 별도로 확인해야 합니다. 행정동 매출을 선택 위치의 예상 매출로 환산하지 않습니다.</p>
      <a className="underline" href="https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html" target="_blank" rel="noreferrer">복합지표 작성 방법 · OECD/JRC</a>
    </div></details>
  </section>
}
