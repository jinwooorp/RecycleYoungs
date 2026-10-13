import { beforeEach, expect, it, vi } from 'vitest'
import { getNearbyStores } from './nearbyApi'
import { nearbyFixture } from '../test/nearbyFixture'

const fetchMock = vi.fn<typeof fetch>()
const c = { lat: 37.5665, lng: 126.978 }
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
it('validates numeric distance, string counts and sends coordinates without swapping', async () => {
  fetchMock.mockResolvedValue(json(nearbyFixture()))
  const controller = new AbortController()
  expect(await getNearbyStores(c, controller.signal)).toEqual(nearbyFixture())
  expect(fetchMock).toHaveBeenCalledWith('/api/nearby-stores?lat=37.5665&lng=126.978&radius=500&industryCode=CAFE',
    expect.objectContaining({ signal: controller.signal }))
})
it.each([
  ['count number', (v: ReturnType<typeof nearbyFixture>) => Object.assign(v, { totalCount: 2 })],
  ['count overflow', (v: ReturnType<typeof nearbyFixture>) => { v.totalCount = '9223372036854775808' }],
  ['negative count', (v: ReturnType<typeof nearbyFixture>) => { v.totalCount = '-1' }],
  ['padded count', (v: ReturnType<typeof nearbyFixture>) => { v.totalCount = '02' }],
  ['count mismatch', (v: ReturnType<typeof nearbyFixture>) => { v.totalCount = '3' }],
  ['wrong limit', (v: ReturnType<typeof nearbyFixture>) => Object.assign(v, { listLimit: 99 })],
  ['wrong list length', (v: ReturnType<typeof nearbyFixture>) => { v.listedCount = 1 }],
  ['wrong complete', (v: ReturnType<typeof nearbyFixture>) => { v.listComplete = false }],
  ['wrong radius', (v: ReturnType<typeof nearbyFixture>) => Object.assign(v, { radiusMeters: 501 })],
  ['wrong industry', (v: ReturnType<typeof nearbyFixture>) => Object.assign(v, { industryCode: 'PUB' })],
  ['wrong snapshot', (v: ReturnType<typeof nearbyFixture>) => Object.assign(v.data, { snapshotStatus: 'VERIFIED' })],
  ['invented date', (v: ReturnType<typeof nearbyFixture>) => Object.assign(v.data, { referenceDate: '2026-06-01' })],
  ['wrong coordinate', (v: ReturnType<typeof nearbyFixture>) => { v.coordinate.lat = 38 }],
  ['distance outside', (v: ReturnType<typeof nearbyFixture>) => { v.stores[0].distanceMeters = 501 }],
  ['distance string', (v: ReturnType<typeof nearbyFixture>) => Object.assign(v.stores[0], { distanceMeters: '1' })],
  ['duplicate id', (v: ReturnType<typeof nearbyFixture>) => { v.stores[1].sourceStoreId = v.stores[0].sourceStoreId }],
  ['unordered distance', (v: ReturnType<typeof nearbyFixture>) => { v.stores[0].distanceMeters = 20 }],
  ['empty source', (v: ReturnType<typeof nearbyFixture>) => { v.stores[0].sourceStoreId = '' }],
  ['unavailable disguised', (v: ReturnType<typeof nearbyFixture>) => { v.data.quality.usableCafeCount = '0' }],
] as const)('rejects %s', async (_, mutate) => {
  const body = nearbyFixture(); mutate(body); fetchMock.mockResolvedValue(json(body))
  await expect(getNearbyStores(c)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it.each(['CAFE_MAPPING_UNAVAILABLE', 'STORES_DATA_UNAVAILABLE', 'CAFE_DATA_UNAVAILABLE'])('preserves %s at 503', async code => {
  fetchMock.mockResolvedValue(json({ code, message: '점포 자료 미준비', field: null }, 503))
  await expect(getNearbyStores(c)).rejects.toMatchObject({ code, status: 503 })
})
it('accepts zero with positive usable inventory and preserves missing name', async () => {
  fetchMock.mockResolvedValueOnce(json(nearbyFixture(c, 0)))
  expect((await getNearbyStores(c)).totalCount).toBe('0')
  const body = nearbyFixture(); body.stores[0].name = null
  fetchMock.mockResolvedValueOnce(json(body)); expect((await getNearbyStores(c)).stores[0].name).toBeNull()
})
