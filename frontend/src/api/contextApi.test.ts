import { expect, it, vi } from 'vitest'
import { getAdminDongContext } from './contextApi'
import { contextFixture, contextVersion } from '../test/contextFixture'

it('keeps exact decimals and refuses policy/version/withheld data corruption', async () => {
  const valid = contextFixture('11110515', '20251')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(valid))))
  expect((await getAdminDongContext('11110515','20251',contextVersion)).sections.population.metrics?.TOT_FLPOP_CO.value)
    .toBe('9007199254740993.25')
  for (const change of [
    (v: typeof valid) => { v.contextPolicyVersion = 'a'.repeat(64) },
    (v: typeof valid) => { v.sections.residents.metrics!.APT_HSHLD_CO = v.sections.residents.metrics!.TOT_HSHLD_CO },
    (v: typeof valid) => { v.sections.consumption.metrics = v.sections.residents.metrics },
    (v: typeof valid) => { v.sections.population.provenance.observedAt = '2026-10-22T00:00:00Z' },
    (v: typeof valid) => { v.sections.workers.scoreReady = true },
    (v: typeof valid) => { v.sections.change.attributes!.TRDAR_CHNGE_IX = 'UNKNOWN' },
    (v: typeof valid) => { v.sections.change.attributes!.TRDAR_CHNGE_IX_NM = '상권확장' },
  ]) {
    const value = structuredClone(valid); change(value)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value))))
    await expect(getAdminDongContext('11110515','20251',contextVersion)).rejects.toMatchObject({code:'INVALID_RESPONSE'})
  }
})

it('preserves a context 503 as its own recoverable failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({code:'CONTEXT_UNAVAILABLE',message:'참고 자료 미제공',field:null}),{status:503})))
  await expect(getAdminDongContext('11110515','20251','legacy-unversioned')).rejects.toMatchObject({status:503,code:'CONTEXT_UNAVAILABLE'})
})
