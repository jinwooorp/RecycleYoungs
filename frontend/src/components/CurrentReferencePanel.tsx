import { useCallback,useId,useState } from 'react'
import { getReferenceCatalog,getReferenceRecords,type ReferenceCatalog,type ReferenceSourceId } from '../api/referenceApi'
import { useReferenceRequest } from '../hooks/useReferenceRequest'
import { exactContextNumber } from '../lib/contextLabels'
import { Button } from './ui/button'
import { NativeSelect } from './ui/native-select'
import { Field,FieldGroup,FieldLabel } from './ui/field'
import { Alert,AlertDescription } from './ui/alert'
import { Empty,EmptyDescription } from './ui/empty'

const names:Record<ReferenceSourceId,string>={'seoul-bus-stops':'버스 정류장','seoul-public-parking':'공영주차장 관리번호','seoul-metro-leases':'지하철 상가 계약'}
const labels:Record<string,string>={STOPS_NO:'정류소 번호',STOPS_NM:'정류소 이름',STOPS_TYPE:'정류소 유형',PKLT_NM:'주차장 이름',ADDR:'원천 주소',
  PKLT_KND_NM:'주차장 유형',LAST_DATA_SYNC_TM:'원천 동기화 표기',STN_NM:'역 이름',STN_CD:'역 코드',TPBIZ:'업종',CTRT_STRT_DD:'계약 시작일',CTRT_END_DD:'계약 종료일',TPKCT:'원천 보고 주차면수',AREA:'원천 보고 면적'}
const limits:Record<ReferenceSourceId,string>={
  'seoul-bus-stops':'좌표계 설명이 충돌해 위치·거리·500m 접근성은 제공하지 않습니다.',
  'seoul-public-parking':'관리번호별 좌표 이외 원천 속성이 모두 같은 행만 묶었습니다. 주차면수는 합산하지 않습니다. 물리적 주차장 수·실시간 여유면수·요금·위치는 확인되지 않았습니다.',
  'seoul-metro-leases':'서울교통공사 상가 계약 자료입니다. 면적이 여러 인접 점포의 계약 묶음에 해당할 수 있으며 일반 카페 임대료를 대표하지 않습니다. 통화·계약 범위가 불명확한 임대료는 보류합니다.',
}
function Catalog({dataVersion}:{dataVersion:string}) {
  const [retry,setRetry]=useState(0)
  const load=useCallback((signal:AbortSignal)=>getReferenceCatalog(dataVersion,signal),[dataVersion])
  const result=useReferenceRequest(`${dataVersion}:${retry}`,load)
  return <div className="mt-4 flex flex-col gap-4">
    {result.loading && <p role="status">현재 원천 목록을 확인하는 중입니다.</p>}
    {result.error && <Alert><AlertDescription><p>{result.error}</p><Button variant="outline" onClick={()=>setRetry(v=>v+1)}>참고 목록 다시 조회</Button></AlertDescription></Alert>}
    {result.value && <Records key={result.value.referenceVersion} dataVersion={dataVersion} catalog={result.value} />}
  </div>
}
function Records({dataVersion,catalog}:{dataVersion:string;catalog:ReferenceCatalog}) {
  const [source,setSource]=useState<ReferenceSourceId>('seoul-bus-stops'),[draft,setDraft]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[retry,setRetry]=useState(0)
  const id=useId()
  const load=useCallback((signal:AbortSignal)=>getReferenceRecords(dataVersion,catalog.referenceVersion,source,search,page,signal),[dataVersion,catalog.referenceVersion,source,search,page])
  const result=useReferenceRequest(`${catalog.referenceVersion}:${source}:${search}:${page}:${retry}`,load)
  const selected=catalog.sources.find(s=>s.sourceId===source)!
  return <>
    <ul className="flex flex-col gap-1 text-sm">{catalog.sources.map(s=><li key={s.sourceId}>{names[s.sourceId]}: 검증 목록 {s.recordCount.toLocaleString('ko-KR')}건 / 원본 {s.rawRowCount.toLocaleString('ko-KR')}행</li>)}</ul>
    <form onSubmit={e=>{e.preventDefault();setSearch(draft.trim());setPage(1)}}>
      <FieldGroup><Field><FieldLabel htmlFor={`${id}-source`}>참고 원천</FieldLabel><NativeSelect id={`${id}-source`} value={source} onChange={e=>{
        setSource(e.target.value as ReferenceSourceId);setPage(1);setSearch('');setDraft('')
      }}>{catalog.sources.map(s=><option key={s.sourceId} value={s.sourceId}>{names[s.sourceId]}</option>)}</NativeSelect></Field>
      <Field><FieldLabel htmlFor={`${id}-search`}>이름·주소·원천 번호 검색</FieldLabel><input id={`${id}-search`} type="search" maxLength={80} value={draft} onChange={e=>setDraft(e.target.value)} className="min-h-11 rounded-md border border-input bg-background px-3 text-foreground" /></Field>
      <Button type="submit" variant="outline">목록 검색</Button></FieldGroup>
    </form>
    <p className="text-sm">{limits[source]}</p>
    <p className="text-xs text-muted-foreground">수집 시각 {new Date(selected.collectedAt).toLocaleString('ko-KR')} · 실제 관측일 미확인 · 현재 원천 목록 · 점수 미사용. <a className="underline" href={selected.sourceUrl} target="_blank" rel="noreferrer">공식 출처</a></p>
    {result.loading && <p role="status">목록을 조회하는 중입니다.</p>}
    {result.error && <Alert><AlertDescription><p>{result.error}</p><Button variant="outline" onClick={()=>setRetry(v=>v+1)}>목록 다시 조회</Button></AlertDescription></Alert>}
    {result.value && <><p role="status" className="text-sm">검색 결과 {result.value.total.toLocaleString('ko-KR')}건 · {page}페이지</p>
      {!result.value.total && <Empty><EmptyDescription>검색 조건에 맞는 원천 항목이 없습니다.</EmptyDescription></Empty>}
      <ul className="flex flex-col gap-3">{result.value.records.map(row=><li key={row.recordId} className="min-w-0 rounded-md border border-border p-3">
        <p className="mb-2 break-all text-xs text-muted-foreground">원천 번호 {row.recordId} · 원본 {row.sourceRowCount}행</p>
        <dl className="flex flex-col gap-2 text-sm">{Object.entries(row.attributes).map(([k,v])=><div key={k}><dt className="text-muted-foreground">{labels[k]}</dt><dd className="break-words">{v ?? (row.attributeStates[k]==='WITHHELD_FORMAT'?'형식 확인 필요 · 보류':'원천 값 미제공')}</dd></div>)}
          {Object.entries(row.metrics).map(([k,v])=><div key={k}><dt className="text-muted-foreground">{labels[k]}</dt><dd>{v.value===null?(v.valueState==='WITHHELD_INVALID'?'값 검증 실패 · 보류':'원천 값 미제공'):`${exactContextNumber(v.value)} ${k==='AREA'?'㎡':'면'}`}</dd></div>)}
        </dl>
      </li>)}</ul>
      <nav className="flex flex-wrap items-center gap-3" aria-label="참고 목록 페이지"><Button variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>이전 페이지</Button><Button variant="outline" disabled={page*20>=result.value.total} onClick={()=>setPage(p=>p+1)}>다음 페이지</Button></nav>
      <details className="source-details"><summary>공개·정책 버전</summary><p className="break-all text-xs">참고 버전 {catalog.referenceVersion}<br />원천 snapshot {selected.snapshotId}<br />정책 {selected.policyVersion}</p></details>
    </>}
  </>
}
export function CurrentReferencePanel({dataVersion}:{dataVersion?:string}) {
  const [open,setOpen]=useState(false)
  return <details className="source-details" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>현재 원천 목록 살펴보기</summary>
    <p className="mt-3 text-sm">현재 수집한 버스·공영주차장·지하철 상가 목록입니다. 선택 분기·행정동·반경 500m의 통계가 아닙니다. 원천이 제공하는 검증된 필드만 열람하며 종합 점수에 합산하지 않습니다.</p>
    {open && (dataVersion?<Catalog key={dataVersion} dataVersion={dataVersion} />:<p role="status">카페 자료의 공개 버전을 먼저 확인해 주세요.</p>)}
  </details>
}
