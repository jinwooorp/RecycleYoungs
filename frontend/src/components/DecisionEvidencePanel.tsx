import { useCallback,useState } from 'react'
import { getDecisionEvidence } from '../api/decisionApi'
import { useReferenceRequest } from '../hooks/useReferenceRequest'
import { Button } from './ui/button'
import { Alert,AlertDescription } from './ui/alert'

const reasons:Record<string,string>={SHARED_TRANSACTION_SOURCE:'거래 규모와 증감은 같은 카페 거래 자료를 공유하므로 독립된 근거로 합산하지 않습니다.',
  REFERENCE_ONLY_CONTEXT:'인구·시설·상권변화는 원값을 제공하는 참고자료이며 점수 사용 검증 전입니다.',
  ACCESSIBILITY_SPATIAL_UNVERIFIED:'교통·주차 목록의 위치·과거 분기 호환성이 확인되지 않았습니다.',
  COST_REPRESENTATIVENESS_UNVERIFIED:'지하철 상가 계약은 일반 카페 임대료를 대표하지 않으며 비용 단위도 확인 전입니다.',
  CONSUMPTION_WITHHELD:'지역소비 자료는 음수·집계 주기 문제로 전체 보류합니다.',
  CROSS_DOMAIN_CALIBRATION_UNAVAILABLE:'영역 간 산식·가중치와 사업 성과의 관계가 검증되지 않았습니다.'}
function Evidence({codes,quarter,dataVersion}:{codes:string[];quarter:string;dataVersion:string}) {
  const [retry,setRetry]=useState(0)
  const codeKey=[...new Set(codes)].sort().join(',')
  const load=useCallback((signal:AbortSignal)=>getDecisionEvidence(codeKey.split(','),quarter,dataVersion,signal),[codeKey,quarter,dataVersion])
  const state=useReferenceRequest(`${codeKey}:${quarter}:${dataVersion}:${retry}`,load)
  return <div className="mt-3 flex flex-col gap-3 text-sm">
    {state.loading && <p role="status">같은 조건의 판단 근거를 확인하는 중입니다.</p>}
    {state.error && <Alert><AlertDescription><p>{state.error}</p><Button variant="outline" onClick={()=>setRetry(v=>v+1)}>판단 근거 다시 조회</Button></AlertDescription></Alert>}
    {state.value && <>
      <p>서울 카페 · 행정동 전체 · {state.value.quarter.label}. 선택한 후보끼리 순위를 다시 계산하지 않습니다.</p>
      <p>소비규모 비교 집단 {state.value.consumption.cohortSize}개 / 소비증감 비교 집단 {state.value.change.cohortSize}개 행정동. 각각 최소 {state.value.consumption.minimumCohortSize}개 / {state.value.change.minimumCohortSize}개입니다.</p>
      <p className="font-medium">종합 총점 미제공 · 임의 가중치와 결측 대체 없음</p>
      <ul className="flex list-disc flex-col gap-2 pl-5">{state.value.overall.reasonCodes.map(code=><li key={code}>{reasons[code]}</li>)}</ul>
      {state.value.references.some(r=>r.status==='UNAVAILABLE') && <p>일부 후보의 분기 참고자료는 현재 공개 버전에 제공되지 않습니다.</p>}
      <details className="source-details"><summary>모델·비교 집단 버전</summary><p className="break-all text-xs">소비규모 {state.value.consumption.modelVersion} · {state.value.consumption.baselineId}<br />소비증감 {state.value.change.modelVersion} · {state.value.change.baselineId}<br />판단 근거 {state.value.modelVersion} · 공개 {dataVersion}</p></details>
    </>}
  </div>
}
export function DecisionEvidencePanel({codes,quarter,dataVersion}:{codes:string[];quarter:string;dataVersion?:string}) {
  const [open,setOpen]=useState(false)
  return <details className="source-details" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>판단 지표의 비교 기준과 총점 미제공 이유</summary>
    {open && (codes.length && quarter && dataVersion?<Evidence key={`${codes.join(',')}:${quarter}:${dataVersion}`} codes={codes} quarter={quarter} dataVersion={dataVersion} />
      :<p className="mt-3 text-sm">같은 분기와 공개 버전으로 조회 가능한 지역을 먼저 선택해 주세요.</p>)}
  </details>
}
