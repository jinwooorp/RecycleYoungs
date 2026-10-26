import { get } from './adminDongApi'
import { validConsumptionScores,validChangeScores } from './regionApi'
import { validAdminDongContext } from './contextApi'
import { matchesPublication } from '../lib/publication'
import type { ConsumptionScores,ChangeScores } from '../types/regions'
import type { AdminDongContext } from '../types/context'
import type { PublicationMetadata } from '../types/api'
export const decisionReasons=['SHARED_TRANSACTION_SOURCE','REFERENCE_ONLY_CONTEXT','ACCESSIBILITY_SPATIAL_UNVERIFIED',
  'COST_REPRESENTATIVENESS_UNVERIFIED','CONSUMPTION_WITHHELD','CROSS_DOMAIN_CALIBRATION_UNAVAILABLE'] as const
export interface DecisionEvidence {
  modelVersion:'decision-evidence-v1';quarter:{code:string;label:string};spatialUnit:'ADMINISTRATIVE_DONG';industryCode:'CAFE'
  consumption:ConsumptionScores;change:ChangeScores;metadata:PublicationMetadata
  references:{dongCode:string;status:'AVAILABLE'|'UNAVAILABLE';context:AdminDongContext|null;reason:string|null}[]
  overall:{status:'UNAVAILABLE';value:null;weights:Record<string,never>;reasonCodes:typeof decisionReasons}
}
const object=(v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v)
export function getDecisionEvidence(codes:string[],quarter:string,dataVersion:string,signal?:AbortSignal) {
  const wanted=[...new Set(codes)].sort()
  const items=(v:ConsumptionScores|ChangeScores)=>v.quarter.code===quarter && matchesPublication(v.metadata,dataVersion)
    && v.items.length===wanted.length && new Set(v.items.map(i=>i.dong.code)).size===wanted.length && v.items.every(i=>wanted.includes(i.dong.code))
  return get<DecisionEvidence>(`/api/admin-dong-indicators/batch?${new URLSearchParams({dongCodes:wanted.join(','),quarterCode:quarter,dataVersion})}`,
    (v):v is DecisionEvidence=>object(v) && v.modelVersion==='decision-evidence-v1' && v.spatialUnit==='ADMINISTRATIVE_DONG' && v.industryCode==='CAFE'
      && object(v.quarter) && v.quarter.code===quarter && matchesPublication(v.metadata,dataVersion)
      && validConsumptionScores(v.consumption) && items(v.consumption) && validChangeScores(v.change) && items(v.change)
      && object(v.overall) && v.overall.status==='UNAVAILABLE' && v.overall.value===null && object(v.overall.weights) && Object.keys(v.overall.weights).length===0
      && JSON.stringify(v.overall.reasonCodes)===JSON.stringify(decisionReasons)
      && Array.isArray(v.references) && v.references.length===wanted.length && new Set(v.references.map(r=>object(r)?r.dongCode:null)).size===wanted.length
      && v.references.every(r=>object(r) && typeof r.dongCode==='string' && wanted.includes(r.dongCode)
        && (r.status==='UNAVAILABLE'?r.context===null && ['NO_ROW','CONTEXT_UNAVAILABLE'].includes(String(r.reason))
          :r.status==='AVAILABLE' && r.reason===null && validAdminDongContext(r.context,r.dongCode,quarter,dataVersion))),signal)
}
