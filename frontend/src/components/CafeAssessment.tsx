import { useId } from 'react'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { cafeScoreFactors } from '../lib/cafeScore'

export function CafeAssessment() {
  const titleId = useId()
  return <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-primary">카페 상권환경지수 · 100점 평가 기준</p>
      <h2 id={titleId} className="text-lg font-semibold">종합점수 산정 불가</h2></div><Badge variant="outline">기준 초안 v0.1</Badge></div>
    <p className="text-sm text-muted-foreground">시간대 인구와 점포 유형 등 필수 자료가 연결되지 않았습니다. 현재 확인 가능한 주변 점포와 행정동 통계를 비교해 주세요.</p>
    <details className="source-details"><summary>평가 방법과 아직 필요한 자료</summary><div className="mt-2 flex flex-col gap-3 text-sm text-muted-foreground">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cafeScoreFactors.map(factor => <div key={factor.name} className="rounded-lg border border-border bg-card p-3">
        <p className="font-semibold">{factor.name} {factor.weight}점 기준</p><p className="text-sm">{factor.detail}</p><p className="mt-2 text-xs text-muted-foreground">{factor.reason}</p>
      </div>)}</div>
      <Alert><AlertDescription>배점은 검증 전 설계안입니다. 점수는 행정동의 상대적 환경을 비교하는 기준이며 창업 성공률·수익·창업 가능 여부를 뜻하지 않습니다. 같은 행정동의 후보는 같은 지역 점수를 받습니다.</AlertDescription></Alert>
      <p>같은 분기·카페 정의의 서울 전체 유효 행정동을 기준으로 백분위 점수를 계산합니다. 고른 후보 2~3곳만으로 순위를 만들지 않습니다.</p>
      <p>수요 35% + 경쟁 25% + 소비 25% + 변동성 15%. 필수 자료가 없으면 나머지를 100점으로 확대하지 않습니다. 가중치 민감도와 단위·기간 일치를 검증한 뒤 산정합니다.</p>
      <p>프랜차이즈 수는 행정동 시장 구성의 참고 정보입니다. 브랜드별 가맹/직영 여부·가격대·콘셉트는 현재 확인되지 않아 임의로 점수에 반영하지 않습니다.</p>
      <p>임대료·권리금·인건비·운영 역량은 별도로 확인해야 합니다. 행정동 매출을 선택 위치의 예상 매출로 환산하지 않습니다.</p>
      <a className="underline" href="https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html" target="_blank" rel="noreferrer">복합지표 작성 방법 · OECD/JRC</a>
    </div></details>
  </section>
}
