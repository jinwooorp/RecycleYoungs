import type { AdminDongContext, ContextKey, ContextSection } from '../types/context'
import { contextKeys } from '../types/context'
import { contextMetricName, contextNames, contextReasons, exactContextNumber } from '../lib/contextLabels'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

const unitNames = {PERSON:'명',HOUSEHOLD:'가구',FACILITY:'개',MONTH:'개월'}
function Metric({section,field}: {section:ContextSection;field:string}) {
  const metric = section.metrics?.[field]
  return <>{metric ? `${exactContextNumber(metric.value)}${metric.value === null?'':` ${unitNames[metric.unit]}`}`
    : section.state === 'NO_PERIOD'?'이 분기의 원천 자료가 없습니다.':section.state === 'NO_ROW'?'이 지역의 집계 행이 없습니다.':'보류'}</>
}
function Section({name,section}: {name:ContextKey;section:ContextSection}) {
  return <section className="flex flex-col gap-3" aria-label={contextNames[name]}>
    <h3 className="font-semibold">{contextNames[name]} <Badge variant="secondary">{section.state === 'WITHHELD'?'보류':'참고용'}</Badge></h3>
    {section.state === 'REFERENCE' && <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">{Object.entries(section.metrics!).map(([field,metric]) =>
      <div key={field}><dt className="text-sm text-muted-foreground">{contextMetricName(field)}</dt><dd className="break-words">{exactContextNumber(metric.value)}{metric.value === null?'':` ${unitNames[metric.unit]}`}</dd></div>)}</dl>}
    {section.state === 'NO_ROW' && <p>이 지역의 집계 행이 없습니다. 0명이나 0개라는 뜻은 아닙니다.</p>}
    {section.state === 'NO_PERIOD' && <p>이 분기의 원천 자료가 없습니다. 다른 분기의 값을 대신 사용하지 않습니다.</p>}
    {section.attributes?.TRDAR_CHNGE_IX_NM && <p>원천 상권 유형: {section.attributes.TRDAR_CHNGE_IX_NM} ({section.attributes.TRDAR_CHNGE_IX}) · 카페만의 등급이 아닙니다.</p>}
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">{section.reasonCodes.map(code => <li key={code}>{contextReasons[code]}</li>)}</ul>
    <details className="source-details"><summary>출처·기간·한계</summary><div className="mt-2 flex flex-col gap-2 text-sm break-words">
      <a href={section.provenance.sourceUrl} target="_blank" rel="noreferrer">서울 열린데이터광장 {section.provenance.datasetId}</a>
      <p>원천 분기: {section.provenance.sourceQuarter ?? '해당 값 미제공'} · 실제 관측일: 미확인</p>
      <p>수집 시각: {section.provenance.collectedAt ?? '보류 자료로 연결하지 않음'}</p>
      <p>행정동 집계 · 과거 경계 일치 미검증 · 점수 산정에 사용하지 않습니다.</p>
      <p>수집 묶음: {section.provenance.runId ?? '없음'}</p>
    </div></details>
  </section>
}
export function AdminDongContextPanel({result,loading=false,error,onRetry,detailed=false}: {
  result?:AdminDongContext | null;loading?:boolean;error?:string | null;onRetry?:()=>void;detailed?:boolean
}) {
  return <Card asChild><section aria-label={detailed?'행정동 참고 자료 상세':'행정동 참고 자료 요약'}>
    <CardHeader><CardTitle>지역의 수요·환경 참고 자료</CardTitle><CardDescription>인구는 서로 더하지 않습니다. 창업 성공률·고유 고객 수를 뜻하지 않으며 점수에는 반영하지 않습니다.</CardDescription></CardHeader>
    <CardContent><div className="flex flex-col gap-4">
      {loading && <p role="status">참고 자료를 불러오는 중입니다.</p>}
      {error && <Alert role="status"><AlertDescription><p>참고 자료 조회 불가: {error}</p><p>카페 통계와 점수는 별도로 확인할 수 있습니다.</p>
        {onRetry && <Button variant="outline" onClick={onRetry}>참고 자료 다시 조회</Button>}</AlertDescription></Alert>}
      {!loading && !error && !result && <p>지역과 분기를 선택하면 참고 자료를 확인할 수 있습니다.</p>}
      {result && <>
        <p className="text-sm">{result.dong.name} · {result.quarter.label} · 행정동 전체</p>
        {detailed ? <div className="flex flex-col gap-6">{contextKeys.map(key => <details key={key} open={key === 'residents'} className="source-details">
          <summary>{contextNames[key]}</summary><div className="mt-3"><Section name={key} section={result.sections[key]} /></div>
        </details>)}</div> : <dl className="flex flex-col gap-3">{([
          ['residents','TOT_REPOP_CO'],['workers','TOT_WRC_POPLTN_CO'],['population','TOT_FLPOP_CO'],
        ] as const).map(([key,field]) => <div key={key}><dt className="text-sm text-muted-foreground">{contextNames[key]}</dt><dd className="break-words"><Metric section={result.sections[key]} field={field} /></dd></div>)}</dl>}
        {!detailed && <p className="text-xs text-muted-foreground">활동인구 집계 방식·실제 관측일·과거 경계 일치는 미확인입니다. 지역 소비 자료는 품질 문제로 보류 중입니다.</p>}
        {detailed && <details className="source-details"><summary>공개 자료·정책 버전</summary><p className="mt-2 break-all text-xs">공개 자료: {result.metadata.dataVersion}<br />정책: {result.contextPolicyVersion}</p><p className="text-sm">같은 공개 버전이어도 모든 원천의 관측 시각이 같다는 뜻은 아닙니다.</p></details>}
      </>}
    </div></CardContent>
  </section></Card>
}
