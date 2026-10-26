import { afterEach, expect, it, vi } from 'vitest'
import contract from '../contracts/current-reference-policy-v1.json'
import { getReferenceCatalog, getReferenceRecords } from './referenceApi'
const version='a'.repeat(64), referenceVersion='b'.repeat(64)
const metadata={ dataVersion:version,collectedAt:'2026-10-24T10:00:00Z',storeReferenceMonth:'202606',storeScope:'I21201',sourceSnapshotStatus:'UNVERIFIED' }
const sourceId='seoul-metro-leases'
const spec=contract.sources[sourceId]
export const sourceFixture={ sourceId,snapshotId:'c'.repeat(64),collectedAt:'2026-10-24T10:00:00Z',recordCount:1,rawRowCount:1,
  sourceUrl:`https://data.seoul.go.kr/dataList/${spec.policy.datasetId}/A/1/datasetView.do`,policyVersion:spec.version,policy:spec.policy }
afterEach(()=>vi.unstubAllGlobals())
it('rejects a source list that claims score authority or a past quarter',async()=>{
  const sources=Object.entries(contract.sources).map(([id,s])=>({...sourceFixture,sourceId:id,policy:s.policy,policyVersion:s.version,
    sourceUrl:`https://data.seoul.go.kr/dataList/${s.policy.datasetId}/A/1/datasetView.do`}))
  const value={ referenceVersion,temporalUnit:'CURRENT_SOURCE_SNAPSHOT',observedAt:null,scoreReady:false,sources,metadata }
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(value))))
  expect((await getReferenceCatalog(version)).sources).toHaveLength(3)
  value.scoreReady=true
  await expect(getReferenceCatalog(version)).rejects.toThrow()
  value.scoreReady=false;value.temporalUnit='QUARTER'
  await expect(getReferenceCatalog(version)).rejects.toThrow()
})
it('preserves decimal strings and rejects withheld rent or mismatched reference versions',async()=>{
  const row={recordId:'1',attributes:{STN_NM:'시험역',STN_CD:'001',TPBIZ:null,CTRT_STRT_DD:null,CTRT_END_DD:null},
    attributeStates:{STN_NM:'REPORTED',STN_CD:'REPORTED',TPBIZ:'SOURCE_NULL',CTRT_STRT_DD:'WITHHELD_FORMAT',CTRT_END_DD:'SOURCE_NULL'},
    metrics:{AREA:{value:'9007199254740993.25',valueState:'REPORTED',unit:'SQUARE_METRE_SOURCE_REPORTED'}},sourceRowCount:1}
  const value={referenceVersion,source:sourceFixture,page:1,pageSize:20,total:1,records:[row],metadata}
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(value))))
  expect((await getReferenceRecords(version,referenceVersion,sourceId,'',1)).records[0].metrics.AREA.value).toBe('9007199254740993.25')
  Object.assign(row.metrics,{MM_RTFE:{value:'100',valueState:'REPORTED',unit:'UNKNOWN'}})
  await expect(getReferenceRecords(version,referenceVersion,sourceId,'',1)).rejects.toThrow()
  await expect(getReferenceRecords(version,'d'.repeat(64),sourceId,'',1)).rejects.toThrow()
})
