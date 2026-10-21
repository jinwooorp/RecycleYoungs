import { afterEach, expect, it, vi } from 'vitest'
import { getAdminDongStats, getAdminDongTrend, getQuarters } from './adminDongApi'
import { normalTrend } from '../test/trendFixture'
import { comparisonStats } from '../test/comparisonFixture'

afterEach(()=>vi.unstubAllGlobals())
const metadata={ dataVersion:'a'.repeat(64),collectedAt:'2026-10-21T08:00:00+00:00',
  storeReferenceMonth:'202606',storeScope:'I21201',sourceSnapshotStatus:'UNVERIFIED' }
const json=(body:unknown)=>new Response(JSON.stringify(body))

it('연도 경계를 포함한 공개 분기 추세를 허용한다',async()=>{
  const codes=['20254','20261','20262']
  const body={...normalTrend,metadata,quarters:codes.map((code,i)=>({...normalTrend.quarters[i],
    quarter:{code,label:`${code.slice(0,4)}년 ${code[4]}분기`}}))}
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json(body)))
  await expect(getAdminDongTrend({dongCode:'11110515',industryCode:'CAFE'})).resolves.toEqual(body)
})
it('조회한 공개 버전으로 요청하고 다른 버전 응답을 거부한다',async()=>{
  const fetchMock=vi.fn().mockResolvedValue(json({...comparisonStats(),metadata:{...metadata,dataVersion:'b'.repeat(64)}}))
  vi.stubGlobal('fetch',fetchMock)
  await expect(getAdminDongStats({dongCode:'11110515',industryCode:'CAFE',quarterCode:'20251',dataVersion:metadata.dataVersion}))
    .rejects.toMatchObject({code:'INVALID_RESPONSE'})
  expect(fetchMock.mock.calls[0][0]).toContain(`dataVersion=${metadata.dataVersion}`)
})
it('서로 다른 공개 버전이 섞인 분기 목록을 거부한다',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json([
    {code:'20254',label:'2025년 4분기',metadata},
    {code:'20261',label:'2026년 1분기',metadata:{...metadata,dataVersion:'b'.repeat(64)}},
  ])))
  await expect(getQuarters()).rejects.toMatchObject({code:'INVALID_RESPONSE'})
})
