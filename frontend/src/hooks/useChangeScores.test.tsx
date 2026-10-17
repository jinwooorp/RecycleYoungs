import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useChangeScores } from './useChangeScores'
import { regionFixtureResponse } from '../test/regionFixture'

it('does not reactivate a cached result while a quarter round trip is requesting fresh data', async () => {
  let blocked = false
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => blocked ? new Promise<Response>(() => {}) : Promise.resolve(regionFixtureResponse(input)!)))
  const { result, rerender } = renderHook(({ quarter }) => useChangeScores(['11110515'], quarter), { initialProps: { quarter: '20254' } })
  await waitFor(() => expect(result.current.result).not.toBeNull())
  blocked = true; rerender({ quarter: '20253' }); rerender({ quarter: '20254' })
  expect(result.current.loading).toBe(true); expect(result.current.result).toBeNull()
})

it('rejects mismatched previous quarter and retries without keeping a stale score', async () => {
  const value = await regionFixtureResponse('/api/cafe-change-scores?dongCodes=11110515&quarterCode=20254')!.json()
  value.previousQuarterCode = '20252'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value))))
  const { result } = renderHook(() => useChangeScores(['11110515'], '20254'))
  await waitFor(() => expect(result.current.error).toMatch(/일치/))
  value.previousQuarterCode = '20253'
  act(() => result.current.retry())
  expect(result.current.result).toBeNull()
  await waitFor(() => expect(result.current.result?.items[0].score).toBe(60))
})
it('ignores late responses after region changes even if fetch ignores abort', async () => {
  let finish!: (r: Response) => void
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).includes('11110515') ? new Promise<Response>(done => { finish = done }) : Promise.resolve(regionFixtureResponse(input)!)))
  const { result, rerender } = renderHook(({ code }) => useChangeScores([code], '20254'), { initialProps: { code: '11110515' } })
  rerender({ code: '11260550' })
  await waitFor(() => expect(result.current.result?.items[0].dong.code).toBe('11260550'))
  await act(async () => finish(regionFixtureResponse('/api/cafe-change-scores?dongCodes=11110515&quarterCode=20254')!))
  expect(result.current.result?.items[0].dong.code).toBe('11260550')
})
it('rejects unavailable responses disguised as numeric scores', async () => {
  const value = await regionFixtureResponse('/api/cafe-change-scores?dongCodes=11110515&quarterCode=20254')!.json()
  value.items[0].status = 'UNAVAILABLE'; value.items[0].reason = 'ZERO_PREVIOUS'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value))))
  const { result } = renderHook(() => useChangeScores(['11110515'], '20254'))
  await waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.result).toBeNull()
})
