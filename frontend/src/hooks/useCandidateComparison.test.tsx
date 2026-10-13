import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useCandidateComparison } from './useCandidateComparison'
import { comparisonLocation, comparisonLookups, comparisonStats } from '../test/comparisonFixture'
import { nearbyFixture } from '../test/nearbyFixture'
import type { MapCoordinate } from '../components/KakaoMap'
import type { Lookups, StatsQuery } from '../types/api'

const p1 = { lat: 37.5665, lng: 126.978 }, p2 = { lat: 37.58, lng: 126.99 }, p3 = { lat: 37.59, lng: 127.01 }
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
const fetchMock = vi.fn<typeof fetch>()
let location: (c: MapCoordinate) => Promise<Response>
let nearby: (c: MapCoordinate) => Promise<Response>
let stats: (q: StatsQuery) => Promise<Response>
beforeEach(() => {
  location = async c => json(comparisonLocation(c))
  nearby = async c => json(nearbyFixture(c))
  stats = async q => json(comparisonStats(q.dongCode, q.quarterCode))
  fetchMock.mockReset().mockImplementation(async input => {
    const u = new URL(String(input), 'http://localhost')
    const c = { lat: Number(u.searchParams.get('lat')), lng: Number(u.searchParams.get('lng')) }
    if (u.pathname === '/api/locations/resolve') return location(c)
    if (u.pathname === '/api/nearby-stores') return nearby(c)
    if (u.pathname === '/api/admin-dong-stats') return stats({ dongCode: u.searchParams.get('dongCode')!,
      industryCode: u.searchParams.get('industryCode')!, quarterCode: u.searchParams.get('quarterCode')! })
    throw new Error('Comparison must reuse the shared lookup without additional requests')
  })
  vi.stubGlobal('fetch', fetchMock)
})
const calls = (path: string) => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(path))
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (r: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
function setup(strict = false) {
  return renderHook(({ lookups, loading, error }: { lookups: Lookups | null; loading: boolean; error: boolean }) =>
    useCandidateComparison(lookups, loading, error), {
    initialProps: { lookups: comparisonLookups as Lookups | null, loading: false, error: false },
    wrapper: strict ? StrictMode : undefined,
  })
}
async function registered(count = 1) {
  const view = setup()
  act(() => { [p1, p2, p3].slice(0, count).forEach(c => view.result.current.add(c)) })
  await waitFor(() => expect(view.result.current.candidates.every(c => !c.location.loading && !c.nearby.loading)).toBe(true))
  return view
}

it('registers 1/2/3 independently and rejects a fourth within the same event', async () => {
  const view = setup(); let accepted: boolean[] = []
  act(() => { accepted = [p1, p2, p3, { lat: 37.6, lng: 127.1 }].map(c => view.result.current.add(c)) })
  expect(accepted).toEqual([true, true, true, false])
  expect(view.result.current.candidates.map(c => c.number)).toEqual([1, 2, 3])
  expect(calls('/api/locations/resolve')).toHaveLength(3); expect(calls('/api/nearby-stores')).toHaveLength(3)
  await waitFor(() => expect(view.result.current.candidates.every(c => c.location.result)).toBe(true))
})
it('rejects an exact duplicate without rounding nearby distinct coordinates', async () => {
  const view = setup(); let duplicate = true
  act(() => { view.result.current.add(p1); duplicate = view.result.current.add({ ...p1 });
    view.result.current.add({ ...p1, lat: p1.lat + 1e-12 }) })
  expect(duplicate).toBe(false); expect(view.result.current.candidates).toHaveLength(2)
  expect(calls('/api/nearby-stores')).toHaveLength(2)
  await waitFor(() => expect(view.result.current.candidates.every(c => c.nearby.result)).toBe(true))
})
it('copies input coordinates and preserves full precision in queries', async () => {
  const c = { lat: 37.123456789012, lng: 127.987654321012 }, original = { ...c }, view = setup()
  act(() => { view.result.current.add(c); c.lat = 40; c.lng = 130 })
  expect(view.result.current.candidates[0].coordinate).toEqual(original)
  expect(calls('/api/locations/resolve')[0][0]).toBe('/api/locations/resolve?lat=37.123456789012&lng=127.987654321012')
  expect(calls('/api/nearby-stores')[0][0]).toBe('/api/nearby-stores?lat=37.123456789012&lng=127.987654321012&radius=500&industryCode=CAFE')
  await waitFor(() => expect(view.result.current.candidates[0].location.result).not.toBeNull())
})
it('reuses a vacant display number with a new immutable ID and registration order', async () => {
  const view = await registered(3), old = view.result.current.candidates[1]
  act(() => { view.result.current.remove(old.id); view.result.current.add({ lat: 37.61, lng: 127.1 }) })
  const replacement = view.result.current.candidates.find(c => c.number === 2)!
  expect(replacement.id).not.toBe(old.id); expect(replacement.order).toBe(4)
  expect(view.result.current.candidates.map(c => c.number)).toEqual([1, 2, 3])
  await waitFor(() => expect(view.result.current.candidates.every(c => c.location.result)).toBe(true))
})
it('uses identical CAFE and quarter, without comparison trends or new lookup requests', async () => {
  const view = await registered(3)
  act(() => view.result.current.changeQuarter('20252'))
  act(() => view.result.current.queryStats())
  await waitFor(() => expect(view.result.current.candidates.every(c => c.stats.result)).toBe(true))
  expect(calls('/api/admin-dong-stats')).toHaveLength(3)
  calls('/api/admin-dong-stats').forEach(([url]) => expect(String(url)).toContain('industryCode=CAFE&quarterCode=20252'))
  expect(fetchMock).toHaveBeenCalledTimes(9)
  const count = fetchMock.mock.calls.length; view.rerender({ lookups: comparisonLookups, loading: false, error: false })
  expect(fetchMock).toHaveBeenCalledTimes(count)
})
it('applies a newly changed quarter to a query in the same event', async () => {
  const view = await registered()
  act(() => { view.result.current.changeQuarter('20252'); view.result.current.queryStats() })
  await waitFor(() => expect(calls('/api/admin-dong-stats')).toHaveLength(1))
  expect(String(calls('/api/admin-dong-stats')[0][0])).toContain('quarterCode=20252')
})
it.each(['success', 'error'])('ignores late old statistics %s after quarter invalidation', async outcome => {
  const old = deferred<Response>(), view = await registered()
  stats = q => q.quarterCode === '20251' ? old.promise : Promise.resolve(json(comparisonStats(q.dongCode, q.quarterCode)))
  act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  act(() => view.result.current.changeQuarter('20252'))
  expect(calls('/api/admin-dong-stats')[0][1]?.signal?.aborted).toBe(true)
  expect(view.result.current.candidates[0].stats.result).toBeNull(); expect(view.result.current.candidates[0].stats.loading).toBe(false)
  act(() => view.result.current.queryStats())
  await waitFor(() => expect(view.result.current.candidates[0].stats.result?.quarter.code).toBe('20252'))
  await act(async () => { if (outcome === 'success') old.resolve(json(comparisonStats())); else old.reject(new TypeError('late')) })
  expect(view.result.current.candidates[0].stats.result?.quarter.code).toBe('20252')
  expect(view.result.current.candidates[0].stats.error).toBeNull()
})
it.each(['success', 'error'])('deleted candidate ignores late region/cafe %s even after number reuse', async outcome => {
  const region = deferred<Response>(), cafes = deferred<Response>()
  location = c => c.lat === p1.lat ? region.promise : Promise.resolve(json(comparisonLocation(c)))
  nearby = c => c.lat === p1.lat ? cafes.promise : Promise.resolve(json(nearbyFixture(c)))
  const view = setup(); act(() => view.result.current.add(p1)); const oldId = view.result.current.candidates[0].id
  act(() => { view.result.current.remove(oldId); view.result.current.add(p2) })
  expect(calls('/api/locations/resolve')[0][1]?.signal?.aborted).toBe(true)
  expect(calls('/api/nearby-stores')[0][1]?.signal?.aborted).toBe(true)
  await waitFor(() => expect(view.result.current.candidates[0].nearby.result).not.toBeNull())
  await act(async () => {
    if (outcome === 'success') { region.resolve(json(comparisonLocation(p1))); cafes.resolve(json(nearbyFixture(p1))) }
    else { region.reject(new TypeError('late')); cafes.reject(new TypeError('late')) }
  })
  expect(view.result.current.candidates).toHaveLength(1)
  expect(view.result.current.candidates[0].id).not.toBe(oldId)
  expect(view.result.current.candidates[0].coordinate).toEqual(p2)
  expect(view.result.current.candidates[0].nearby.error).toBeNull()
})
it('keeps successful cafe results when region fails and retries only that region', async () => {
  location = async () => json({ code: 'BOUNDARY_DATA_UNAVAILABLE', message: '경계 미준비', field: null }, 503)
  const view = await registered(); expect(view.result.current.candidates[0].nearby.result).not.toBeNull()
  expect(view.result.current.candidates[0].location.error?.status).toBe(503)
  location = async c => json(comparisonLocation(c))
  act(() => view.result.current.retryLocation(view.result.current.candidates[0].id))
  await waitFor(() => expect(view.result.current.candidates[0].location.result).not.toBeNull())
  expect(calls('/api/nearby-stores')).toHaveLength(1)
})
it('keeps partial success across three candidates and retries only failed cafes', async () => {
  nearby = async c => c.lat === p2.lat ? json({ code: 'STORES_DATA_UNAVAILABLE', message: '미준비', field: null }, 503) : json(nearbyFixture(c))
  const view = await registered(3)
  expect(view.result.current.candidates.map(c => c.nearby.error?.status ?? null)).toEqual([null, 503, null])
  const regionCount = calls('/api/locations/resolve').length
  nearby = async c => json(nearbyFixture(c))
  act(() => view.result.current.retryNearby(view.result.current.candidates[1].id))
  await waitFor(() => expect(view.result.current.candidates[1].nearby.result).not.toBeNull())
  expect(calls('/api/nearby-stores')).toHaveLength(4); expect(calls('/api/locations/resolve')).toHaveLength(regionCount)
})
it.each(['ambiguous', 'outside', 'missing lookup'])('blocks only statistics for %s', async kind => {
  location = async c => {
    const body = comparisonLocation(c, kind === 'missing lookup' ? '99999999' : '11110515')
    if (kind === 'ambiguous') body.adminDong = { ...body.adminDong, status: 'AMBIGUOUS_BOUNDARY', resolvedDong: null,
      candidates: [body.adminDong.resolvedDong!, { ...body.adminDong.resolvedDong!, code: '11260550', name: '면목5동' }] }
    if (kind === 'outside') body.adminDong = { ...body.adminDong, status: 'OUTSIDE_OR_UNSUPPORTED', reason: 'NO_COVERING_OPERATIONAL_BOUNDARY', resolvedDong: null, candidates: [] }
    return json(body)
  }
  const view = await registered()
  act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  expect(calls('/api/admin-dong-stats')).toHaveLength(0)
  expect(view.result.current.candidates[0].nearby.result).not.toBeNull()
})
it('waits for shared lookup readiness and supports lookup retry without repeating spatial calls', async () => {
  const view = setup(); view.rerender({ lookups: null, loading: true, error: false })
  act(() => view.result.current.add(p1))
  await waitFor(() => expect(view.result.current.candidates[0].location.result).not.toBeNull())
  view.rerender({ lookups: null, loading: false, error: true })
  expect(view.result.current.statsBlockReason(view.result.current.candidates[0])).toBe('LOOKUP_ERROR')
  view.rerender({ lookups: comparisonLookups, loading: false, error: false })
  act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  await waitFor(() => expect(view.result.current.candidates[0].stats.result).not.toBeNull())
  expect(calls('/api/locations/resolve')).toHaveLength(1)
})
it('requires lookup-supported CAFE and quarter', async () => {
  const view = await registered()
  view.rerender({ lookups: { ...comparisonLookups, industries: [{ code: 'PUB', name: '주점' }] }, loading: false, error: false })
  act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  expect(calls('/api/admin-dong-stats')).toHaveLength(0)
  view.rerender({ lookups: comparisonLookups, loading: false, error: false })
  act(() => view.result.current.changeQuarter('20991')); act(() => view.result.current.queryStats())
  expect(view.result.current.quarter).toBe(''); expect(calls('/api/admin-dong-stats')).toHaveLength(0)
})
it.each(['dong', 'industry', 'quarter'])('rejects statistics with mismatched %s', async kind => {
  stats = async () => {
    const body = comparisonStats()
    if (kind === 'dong') body.dong = comparisonLookups.adminDongs[1]
    if (kind === 'industry') body.industry = comparisonLookups.industries[1]
    if (kind === 'quarter') body.quarter = comparisonLookups.quarters[1]
    return json(body)
  }
  const view = await registered(); act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  await waitFor(() => expect(view.result.current.candidates[0].stats.error?.code).toBe('INVALID_RESPONSE'))
  expect(view.result.current.candidates[0].nearby.result).not.toBeNull()
})
it('rejects a region response for another coordinate', async () => {
  location = async () => json(comparisonLocation(p2))
  const view = await registered()
  expect(view.result.current.candidates[0].location.error?.code).toBe('INVALID_RESPONSE')
  expect(view.result.current.candidates[0].nearby.result).not.toBeNull()
})
it('does not duplicate pending requests through query/retry buttons', async () => {
  const pending = deferred<Response>(), view = await registered()
  stats = () => pending.promise
  act(() => view.result.current.changeQuarter('20251'))
  act(() => { view.result.current.queryStats(); view.result.current.queryStats(); view.result.current.retryStats(view.result.current.candidates[0].id) })
  expect(calls('/api/admin-dong-stats')).toHaveLength(1)
  await act(async () => pending.resolve(json(comparisonStats())))
})
it('region requery invalidates old stats and cannot attach a late reply to the new dong', async () => {
  const old = deferred<Response>(), view = await registered()
  stats = q => q.dongCode === '11110515' ? old.promise : Promise.resolve(json(comparisonStats(q.dongCode, q.quarterCode)))
  act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  location = async c => json(comparisonLocation(c, '11260550'))
  act(() => view.result.current.retryLocation(view.result.current.candidates[0].id))
  await waitFor(() => expect(view.result.current.candidates[0].location.result?.adminDong.resolvedDong?.code).toBe('11260550'))
  expect(calls('/api/admin-dong-stats')[0][1]?.signal?.aborted).toBe(true)
  act(() => view.result.current.queryStats())
  await waitFor(() => expect(view.result.current.candidates[0].stats.result?.dong.code).toBe('11260550'))
  await act(async () => old.resolve(json(comparisonStats())))
  expect(view.result.current.candidates[0].stats.result?.dong.code).toBe('11260550')
})
it('StrictMode has one request per data kind and unmount cancels ignored abort responses', async () => {
  const region = deferred<Response>(), cafes = deferred<Response>(), view = setup(true)
  location = () => region.promise; nearby = () => cafes.promise
  act(() => view.result.current.add(p1))
  expect(fetchMock).toHaveBeenCalledTimes(2)
  view.unmount()
  expect(fetchMock.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true)
  await act(async () => { region.resolve(json(comparisonLocation(p1))); cafes.reject(new TypeError('late')) })
})
it('maintains independent completion order between candidates and data kinds', async () => {
  const firstRegion = deferred<Response>(), secondCafes = deferred<Response>(), view = setup()
  location = c => c.lat === p1.lat ? firstRegion.promise : Promise.resolve(json(comparisonLocation(c, '11260550')))
  nearby = c => c.lat === p2.lat ? secondCafes.promise : Promise.resolve(json(nearbyFixture(c, 0)))
  act(() => { view.result.current.add(p1); view.result.current.add(p2) })
  await waitFor(() => expect(view.result.current.candidates[0].nearby.result?.totalCount).toBe('0'))
  await waitFor(() => expect(view.result.current.candidates[1].location.result?.adminDong.resolvedDong?.code).toBe('11260550'))
  expect(view.result.current.candidates[0].location.loading).toBe(true)
  expect(view.result.current.candidates[1].nearby.loading).toBe(true)
  await act(async () => { secondCafes.resolve(json(nearbyFixture(p2, 150))); firstRegion.resolve(json(comparisonLocation(p1))) })
  expect(view.result.current.candidates.map(c => c.nearby.result?.totalCount)).toEqual(['0', '150'])
  expect(view.result.current.candidates.map(c => c.coordinate)).toEqual([p1, p2])
})
it('deleting a candidate during statistics retry blocks both late success and another candidate replacement', async () => {
  const pending = deferred<Response>(), view = await registered(2)
  stats = () => pending.promise
  act(() => view.result.current.changeQuarter('20251'))
  const id = view.result.current.candidates[0].id
  act(() => view.result.current.retryStats(id))
  act(() => { view.result.current.remove(id); view.result.current.add(p3) })
  expect(calls('/api/admin-dong-stats')[0][1]?.signal?.aborted).toBe(true)
  await act(async () => pending.resolve(json(comparisonStats())))
  expect(view.result.current.candidates.every(c => c.id !== id)).toBe(true)
  expect(view.result.current.candidates.find(c => c.number === 1)?.coordinate).toEqual(p3)
  expect(view.result.current.candidates.every(c => c.stats.result === null)).toBe(true)
})
it('A-to-B-to-A quarter changes do not accept an earlier A response', async () => {
  const first = deferred<Response>(), latest = deferred<Response>(), view = await registered()
  let n = 0; stats = () => ++n === 1 ? first.promise : latest.promise
  act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  act(() => view.result.current.changeQuarter('20252'))
  act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  const fresh = comparisonStats(); fresh.storeStats!.storeCount = 17
  await act(async () => latest.resolve(json(fresh)))
  await act(async () => first.resolve(json(comparisonStats())))
  expect(view.result.current.candidates[0].stats.result?.storeStats?.storeCount).toBe(17)
})
it('preserves other statistics on partial failure and retries only the failed dong', async () => {
  location = async c => json(comparisonLocation(c, c.lat === p1.lat ? '11110515' : '11260550'))
  stats = async q => q.dongCode === '11260550' ? json({ code: 'INTERNAL_ERROR', message: '통계 오류', field: null }, 500)
    : json(comparisonStats(q.dongCode, q.quarterCode))
  const view = await registered(2); act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  await waitFor(() => expect(view.result.current.candidates[1].stats.error?.status).toBe(500))
  expect(view.result.current.candidates[0].stats.result).not.toBeNull()
  stats = async q => json(comparisonStats(q.dongCode, q.quarterCode))
  act(() => view.result.current.retryStats(view.result.current.candidates[1].id))
  await waitFor(() => expect(view.result.current.candidates[1].stats.result).not.toBeNull())
  expect(calls('/api/admin-dong-stats')).toHaveLength(3)
  expect(view.result.current.candidates[0].stats.result).not.toBeNull()
})
it('unmount cancels pending statistics without state updates after ignored abort', async () => {
  const pending = deferred<Response>(), view = await registered()
  stats = () => pending.promise
  act(() => view.result.current.changeQuarter('20251')); act(() => view.result.current.queryStats())
  view.unmount()
  expect(calls('/api/admin-dong-stats')[0][1]?.signal?.aborted).toBe(true)
  await act(async () => pending.resolve(json(comparisonStats())))
})
it.each([{ lat: Number.NaN, lng: 127 }, { lat: 91, lng: 127 }, { lat: 37, lng: Number.POSITIVE_INFINITY }, { lat: 37, lng: 181 }])('rejects invalid candidate coordinates %# before any request', c => {
    const view = setup(); let accepted = true
    act(() => { accepted = view.result.current.add(c) })
    expect(accepted).toBe(false); expect(view.result.current.candidates).toHaveLength(0); expect(fetchMock).not.toHaveBeenCalled()
  })
