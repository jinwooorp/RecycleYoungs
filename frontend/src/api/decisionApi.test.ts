import { afterEach,expect,it,vi } from 'vitest'
import { getDecisionEvidence } from './decisionApi'
const version='a'.repeat(64),code='11110515'
afterEach(()=>vi.unstubAllGlobals())
it('requires a common version and refuses a fabricated aggregate or candidate cohort',async()=>{
  const metadata={dataVersion:version,collectedAt:'2026-10-24T00:00:00Z',storeReferenceMonth:'202606',storeScope:'I21201',sourceSnapshotStatus:'UNVERIFIED'}
  const common={quarter:{code:'20251',label:'2025년 1분기'},modelVersion:'model',baselineId:'b'.repeat(64),cohortSize:425,minimumCohortSize:30,sourceUrl:'https://data.seoul.go.kr/',sourceSnapshotStatus:'UNVERIFIED',metadata}
  const value={modelVersion:'decision-evidence-v1',quarter:common.quarter,spatialUnit:'ADMINISTRATIVE_DONG',industryCode:'CAFE',metadata,
    consumption:{...common,items:[{dong:{code,name:'청운효자동'},status:'AVAILABLE',score:80,transactionCount:'12345',reason:null}]},
    change:{...common,previousQuarterCode:'20244',items:[{dong:{code,name:'청운효자동'},status:'AVAILABLE',score:60,currentCount:'12345',previousCount:'10000',changeRate:'23.4500',direction:'INCREASE',reason:null}]},
    references:[{dongCode:code,status:'UNAVAILABLE',context:null,reason:'NO_ROW'}],overall:{status:'UNAVAILABLE',value:null,weights:{},reasonCodes:[
      'SHARED_TRANSACTION_SOURCE','REFERENCE_ONLY_CONTEXT','ACCESSIBILITY_SPATIAL_UNVERIFIED','COST_REPRESENTATIVENESS_UNVERIFIED','CONSUMPTION_WITHHELD','CROSS_DOMAIN_CALIBRATION_UNAVAILABLE']}}
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(value))))
  expect((await getDecisionEvidence([code],'20251',version)).overall.value).toBeNull()
  Object.assign(value.overall,{status:'AVAILABLE',value:90})
  await expect(getDecisionEvidence([code],'20251',version)).rejects.toThrow()
})
