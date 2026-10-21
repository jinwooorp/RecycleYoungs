import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAdminDongStats } from './useAdminDongStats'
import { comparisonLookups, comparisonStats } from '../test/comparisonFixture'
import { normalTrend } from '../test/trendFixture'

afterEach(()=>vi.unstubAllGlobals())
it('목록 버전이 바뀌면 진행 중인 이전 요청을 취소하고 새 버전으로 조회한다',async()=>{
  let version='a'.repeat(64)
  const calls:{url:string;signal:AbortSignal|null|undefined}[]=[]
  const metadata=()=>({dataVersion:version,collectedAt:'2026-10-21T08:00:00Z',storeReferenceMonth:'202606',
    storeScope:'I21201',sourceSnapshotStatus:'UNVERIFIED'})
  const json=(body:unknown)=>Promise.resolve(new Response(JSON.stringify(body)))
  vi.stubGlobal('fetch',vi.fn((url:string,init?:RequestInit)=>{
    calls.push({url,signal:init?.signal})
    if(url==='/api/admin-dongs')return json(comparisonLookups.adminDongs)
    if(url==='/api/industries')return json(comparisonLookups.industries)
    if(url==='/api/quarters')return json([{code:'20251',label:'2025년 1분기',metadata:metadata()}])
    if(url.startsWith('/api/admin-dong-trends'))return json({...normalTrend,metadata:metadata()})
    if(url.includes('dataVersion='+'a'.repeat(64)))return new Promise<Response>(()=>{})
    return json({...comparisonStats(),metadata:metadata()})
  }))
  const view=renderHook(()=>useAdminDongStats('11110515',true))
  await waitFor(()=>expect(calls.some(c=>c.url.includes('/api/admin-dong-stats?'))).toBe(true))
  const old=calls.find(c=>c.url.includes('/api/admin-dong-stats?'))!
  version='b'.repeat(64)
  act(()=>view.result.current.retryLookups())
  await waitFor(()=>expect(view.result.current.stats?.metadata?.dataVersion).toBe(version))
  expect(old.signal?.aborted).toBe(true)
})
