import { beforeEach, expect, it, vi } from 'vitest'
import { getLocationResolution } from './locationApi'
import { resolvedLocation } from '../test/locationFixture'

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })

it('sends lat/lng without rounding and forwards cancellation', async () => {
  const coordinate = { lat: 37.57123456789, lng: 126.98123456789 }
  fetchMock.mockResolvedValue(json({ ...resolvedLocation, coordinate }))
  const controller = new AbortController()
  await expect(getLocationResolution(coordinate, controller.signal)).resolves.toMatchObject({ coordinate })
  expect(fetchMock).toHaveBeenCalledWith('/api/locations/resolve?lat=37.57123456789&lng=126.98123456789', {
    signal: controller.signal, headers: { Accept: 'application/json' },
  })
})

it.each([
  (body: typeof resolvedLocation) => { body.coordinate.lat = 38 },
  (body: typeof resolvedLocation) => { body.adminDong.resolvedDong = null },
  (body: typeof resolvedLocation) => { body.adminDong.dataset.version = '9007199254740992' },
  (body: typeof resolvedLocation) => { body.adminDong.dataset.sourceCrs = 4326 as 5181 },
  (body: typeof resolvedLocation) => { body.adminDong.dataset.referenceDateVerified = true },
  (body: typeof resolvedLocation) => { body.adminDong.resolvedDong!.datasetVersion = '2' },
  (body: typeof resolvedLocation) => { body.commercialArea.memberships.push(body.commercialArea.memberships[0]) },
  (body: typeof resolvedLocation) => { body.commercialArea.status = 'NO_MEMBERSHIP' },
])('rejects inconsistent responses', async (mutate) => {
  const body = structuredClone(resolvedLocation); mutate(body)
  fetchMock.mockResolvedValue(json(body))
  await expect(getLocationResolution(resolvedLocation.coordinate)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('preserves unavailable data as HTTP 503', async () => {
  fetchMock.mockResolvedValue(json({ code: 'BOUNDARY_DATA_UNAVAILABLE', message: '경계 데이터가 준비되지 않았습니다.', field: null }, 503))
  await expect(getLocationResolution(resolvedLocation.coordinate)).rejects.toMatchObject({ code: 'BOUNDARY_DATA_UNAVAILABLE', status: 503 })
})

it.each(['historicalCompatibilityStatus', 'validationStatus', 'pointRelation'])('rejects array-shaped enum %s', async field => {
  const body = structuredClone(resolvedLocation)
  const target = (field === 'pointRelation' ? body.adminDong.resolvedDong : body.adminDong.dataset) as unknown as Record<string, unknown>
  target[field] = [target[field]]
  fetchMock.mockResolvedValue(json(body))
  await expect(getLocationResolution(resolvedLocation.coordinate)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
