import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useConsumptionScores } from './useConsumptionScores'
import { scoreFixture } from '../test/regionFixture'

it('does not reactivate a cached result while a quarter round trip is requesting fresh data', async () => {
  let blocked = false
  vi.stubGlobal('fetch', vi.fn(() => blocked ? new Promise<Response>(() => {}) : Promise.resolve(new Response(JSON.stringify(scoreFixture(['11110515']))))))
  const { result, rerender } = renderHook(({ quarter }) => useConsumptionScores(['11110515'], quarter), { initialProps: { quarter: '20254' } })
  await waitFor(() => expect(result.current.result).not.toBeNull())
  blocked = true; rerender({ quarter: '20253' }); rerender({ quarter: '20254' })
  expect(result.current.loading).toBe(true); expect(result.current.result).toBeNull()
})

it('clears the previous region score immediately and ignores late responses even without fetch abort support', async () => {
  let old!: (r: Response) => void
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).includes('11110515')
    ? new Promise<Response>(done => { old = done }) : Promise.resolve(new Response(JSON.stringify(scoreFixture(['11260550']))))))
  const { result, rerender } = renderHook(({ code }) => useConsumptionScores([code], '20254'), { initialProps: { code: '11110515' } })
  rerender({ code: '11260550' })
  expect(result.current.result).toBeNull()
  await waitFor(() => expect(result.current.result?.items[0].dong.code).toBe('11260550'))
  await act(async () => old(new Response(JSON.stringify(scoreFixture(['11110515'])))))
  expect(result.current.result?.items[0].dong.code).toBe('11260550')
})
it('rejects a score returned for a different quarter and preserves exact raw count strings', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(scoreFixture(['11110515'], '20251')))))
  const { result } = renderHook(() => useConsumptionScores(['11110515'], '20254'))
  await waitFor(() => expect(result.current.error).toMatch(/일치/))
  expect(result.current.result).toBeNull()
})
it('accepts real zero but rejects unavailable values disguised as a numeric score', async () => {
  const fixture = scoreFixture(['11110515'])
  fixture.items[0].transactionCount = '0'; fixture.items[0].score = 0
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fixture))))
  const { result } = renderHook(() => useConsumptionScores(['11110515'], '20254'))
  await waitFor(() => expect(result.current.result?.items[0].score).toBe(0))
  fixture.items[0].status = 'UNAVAILABLE'
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.result).toBeNull()
})
