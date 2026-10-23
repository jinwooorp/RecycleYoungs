import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useAdminDongContext } from './useAdminDongContext'
import { contextFixture, contextVersion } from '../test/contextFixture'

it('shares the same dong request across candidates and summary/detail subscribers', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const p = new URL(String(input), 'http://localhost').searchParams
    return new Response(JSON.stringify(contextFixture(p.get('dongCode')!,p.get('quarterCode')!)))
  }))
  const first = renderHook(() => useAdminDongContext(['11110515','11110515'],'20251',contextVersion))
  await waitFor(() => expect(first.result.current.results['11110515']).toBeTruthy())
  const second = renderHook(() => useAdminDongContext(['11110515'],'20251',contextVersion))
  await waitFor(() => expect(second.result.current.results['11110515']).toBeTruthy())
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('drops late quarter responses and retries a context failure without affecting cafe hooks', async () => {
  let finish!: (r: Response) => void
  let fail = true
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).includes('20211')
    ? new Promise<Response>(resolve => { finish = resolve })
    : Promise.resolve(new Response(JSON.stringify(fail ? {code:'CONTEXT_UNAVAILABLE',message:'참고 자료 미제공',field:null}
      : contextFixture('11110515','20212')), {status:fail?503:200}))))
  const { result, rerender } = renderHook(({quarter}) => useAdminDongContext(['11110515'],quarter,contextVersion),
    {initialProps:{quarter:'20211'}})
  rerender({quarter:'20212'})
  await waitFor(() => expect(result.current.errors['11110515']).toContain('참고 자료'))
  fail = false; act(() => result.current.retry())
  await waitFor(() => expect(result.current.results['11110515']?.quarter.code).toBe('20212'))
  await act(async () => finish(new Response(JSON.stringify(contextFixture('11110515','20211')))))
  expect(result.current.results['11110515']?.quarter.code).toBe('20212')
})
