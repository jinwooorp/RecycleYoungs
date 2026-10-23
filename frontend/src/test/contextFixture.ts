import policy from '../data/context-policy-v1.json'
import { contextKeys, type AdminDongContext, type ContextSection } from '../types/context'

export const contextVersion = 'c'.repeat(64)
export function contextFixture(dong = '11110515', period = '20251'): AdminDongContext {
  return {
    dong: {code:dong,name:'청운효자동'}, quarter:{code:period,label:`${period.slice(0,4)}년 ${period[4]}분기`},
    metadata:{dataVersion:contextVersion,collectedAt:'2026-10-23T00:00:00Z',storeReferenceMonth:'202606',storeScope:'I21201',sourceSnapshotStatus:'UNVERIFIED'},
    spatialUnit:'ADMINISTRATIVE_DONG',contextPolicyVersion:policy.version,
    sections: Object.fromEntries(contextKeys.map(key => {
      const spec = policy.policy.sections[key], withheld = key === 'consumption'
      return [key, {
        state:withheld?'WITHHELD':'REFERENCE',reasonCodes:spec.reason_codes,
        metrics:withheld?null:Object.fromEntries(spec.fields.map(field => [field, {
          value:field === 'TOT_FLPOP_CO'?'9007199254740993.25':field === 'ML_FLPOP_CO'?null:'0',
          valueState:field === 'ML_FLPOP_CO'?'SOURCE_NULL':'REPORTED',
          unit:field === 'TOT_HSHLD_CO'?'HOUSEHOLD':key === 'facilities'?'FACILITY':key === 'change'?'MONTH':'PERSON',
          temporalAggregation:key === 'population'?'UNKNOWN':'SOURCE_REPORTED',
        }])),
        attributes:withheld?null:Object.fromEntries(spec.attributes.map(f => [f,f === 'TRDAR_CHNGE_IX'?'LL':'다이나믹'])),
        provenance:{sourceId:spec.source_id,datasetId:spec.dataset_id,sourceUrl:spec.source_url,
          runId:withheld?null:'b'.repeat(64),sourceQuarter:withheld?null:period,observedAt:null,
          collectedAt:withheld?null:'2026-10-22T10:00:00Z',refreshModel:spec.refresh_model},
        scoreReady:false,spatialCompatibility:'HISTORICAL_UNVERIFIED',
      } satisfies ContextSection]
    })) as Record<typeof contextKeys[number],ContextSection>,
  }
}
