import { get } from './adminDongApi'
import { matchesPublication } from '../lib/publication'
import type { PublicationMetadata } from '../types/api'
import contract from '../contracts/current-reference-policy-v1.json'

export type ReferenceSourceId = keyof typeof contract.sources
export interface ReferenceSource {
  sourceId: ReferenceSourceId; snapshotId: string; collectedAt: string; recordCount: number; rawRowCount: number
  sourceUrl: string; policyVersion: string; policy: typeof contract.sources[ReferenceSourceId]['policy']
}
export interface ReferenceCatalog {
  referenceVersion: string; temporalUnit: 'CURRENT_SOURCE_SNAPSHOT'; observedAt: null; scoreReady: false
  sources: ReferenceSource[]; metadata: PublicationMetadata
}
export interface ReferenceRecord {
  recordId: string; attributes: Record<string,string | null>; attributeStates: Record<string,string>
  metrics: Record<string,{value:string | null; valueState:string; unit:string}>; sourceRowCount:number
}
export interface ReferenceRecords {
  referenceVersion: string; source: ReferenceSource; page: number; pageSize:20; total:number
  records:ReferenceRecord[]; metadata:PublicationMetadata
}
const object=(v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v)
const hash=(v:unknown):v is string => typeof v==='string' && /^[0-9a-f]{64}$/.test(v)
const keys=(v:unknown,names:string[]) => object(v) && Object.keys(v).length===names.length && names.every(n=>n in v)
function same(a:unknown,b:unknown):boolean {
  if (a===b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length===b.length && a.every((v,i)=>same(v,b[i]))
  return object(a) && object(b) && keys(a,Object.keys(b)) && Object.keys(b).every(k=>same(a[k],b[k]))
}
function source(v:unknown):v is ReferenceSource {
  if (!object(v) || typeof v.sourceId!=='string' || !Object.hasOwn(contract.sources,v.sourceId)) return false
  const spec=contract.sources[v.sourceId as ReferenceSourceId]
  return hash(v.snapshotId) && typeof v.collectedAt==='string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v.collectedAt)
    && Number.isFinite(Date.parse(v.collectedAt)) && Number.isInteger(v.recordCount) && Number(v.recordCount)>0 && Number(v.recordCount)<=50000
    && Number.isInteger(v.rawRowCount) && Number(v.rawRowCount)>=Number(v.recordCount) && Number(v.rawRowCount)<=50000
    && v.policyVersion===spec.version && same(v.policy,spec.policy)
    && v.sourceUrl===`https://data.seoul.go.kr/dataList/${spec.policy.datasetId}/A/1/datasetView.do`
}
function metric(v:unknown,unit:string):boolean {
  if (!object(v) || !keys(v,['value','valueState','unit']) || v.unit!==unit) return false
  if (v.valueState!=='REPORTED') return ['SOURCE_NULL','WITHHELD_INVALID'].includes(String(v.valueState)) && v.value===null
  if (typeof v.value!=='string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/.test(v.value)) return false
  const [whole,fraction='']=v.value.split('.')
  return (BigInt(whole)<9223372036854775807n || BigInt(whole)===9223372036854775807n && !/[1-9]/.test(fraction))
    && (unit!=='PARKING_SPACE' || !/[1-9]/.test(fraction))
}
function record(v:unknown,id:ReferenceSourceId):v is ReferenceRecord {
  if (!object(v) || typeof v.recordId!=='string' || !v.recordId.trim() || v.recordId.length>200
    || !Number.isInteger(v.sourceRowCount) || Number(v.sourceRowCount)<1 || id!=='seoul-public-parking' && v.sourceRowCount!==1) return false
  const spec=contract.sources[id].policy
  if (!keys(v.attributes,spec.publishedAttributes) || !object(v.attributes) || !keys(v.attributeStates,spec.publishedAttributes)
    || !object(v.attributeStates) || !keys(v.metrics,spec.publishedMetrics) || !object(v.metrics)) return false
  const attributes=v.attributes,states=v.attributeStates,metrics=v.metrics
  return spec.publishedAttributes.every(k=>states[k]==='REPORTED' ? typeof attributes[k]==='string' && attributes[k].length<=2000
    : attributes[k]===null && (states[k]==='SOURCE_NULL' || states[k]==='WITHHELD_FORMAT' && ['CTRT_STRT_DD','CTRT_END_DD'].includes(k)))
    && spec.publishedMetrics.every(k=>metric(metrics[k],id==='seoul-public-parking'?'PARKING_SPACE':'SQUARE_METRE_SOURCE_REPORTED'))
}
export function getReferenceCatalog(dataVersion:string,signal?:AbortSignal) {
  return get<ReferenceCatalog>(`/api/reference-catalog?${new URLSearchParams({dataVersion})}`,(v):v is ReferenceCatalog=>
    object(v) && hash(v.referenceVersion) && v.temporalUnit==='CURRENT_SOURCE_SNAPSHOT' && v.observedAt===null && v.scoreReady===false
    && matchesPublication(v.metadata,dataVersion) && Array.isArray(v.sources) && v.sources.length===3 && v.sources.every(source)
    && new Set(v.sources.map(s=>s.sourceId)).size===3,signal)
}
export function getReferenceRecords(dataVersion:string,referenceVersion:string,sourceId:ReferenceSourceId,query:string,page:number,signal?:AbortSignal) {
  const params=new URLSearchParams({dataVersion,referenceVersion,sourceId,page:String(page)})
  if (query) params.set('query',query)
  return get<ReferenceRecords>(`/api/reference-records?${params}`,(v):v is ReferenceRecords=>
    object(v) && v.referenceVersion===referenceVersion && source(v.source) && v.source.sourceId===sourceId
    && v.page===page && v.pageSize===20 && Number.isInteger(v.total) && Number(v.total)>=0 && Number(v.total)<=v.source.recordCount
    && matchesPublication(v.metadata,dataVersion) && Array.isArray(v.records) && v.records.length===Math.min(20,Math.max(0,Number(v.total)-(page-1)*20))
    && v.records.every(r=>record(r,sourceId)) && new Set(v.records.map(r=>r.recordId)).size===v.records.length,signal)
}
