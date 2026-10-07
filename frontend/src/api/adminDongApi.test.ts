import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAdminDongs, getAdminDongStats, getAdminDongTrend } from './adminDongApi'
import { normalTrend } from '../test/trendFixture'

const query = { dongCode: '11110515', industryCode: 'CAFE', quarterCode: '20251' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => vi.unstubAllGlobals())

describe('API 응답 경계', () => {
  it('code/status/field를 유지해 메시지 문자열 없이 HTTP 오류를 구분한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'INVALID_PARAMETER', message: '잘못된 요청입니다.', field: 'dongCode' }, 400)))
    await expect(getAdminDongStats(query)).rejects.toMatchObject({ kind: 'http', code: 'INVALID_PARAMETER', status: 400, field: 'dongCode' })
  })
  it.each([
    new Response('<html>secret upstream detail</html>', { status: 500 }),
    json({ unexpected: 'secret upstream detail' }, 500),
    json({ code: 'INTERNAL_ERROR', message: 'secret upstream detail', field: 42 }, 500),
    json({ code: 'UNEXPECTED_UPSTREAM_ERROR', message: 'secret upstream detail', field: null }, 500),
  ])('계약 밖의 오류 body는 안전한 fallback으로 처리한다', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(getAdminDongs()).rejects.toMatchObject({ kind: 'http', code: 'HTTP_ERROR', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' })
  })
  it.each([new Response('invalid json'), json({ data: [] }), json([{ code: 11110515, name: '청운효자동' }])])('잘못된 성공 JSON도 자료 없음으로 바꾸지 않는다', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(getAdminDongs()).rejects.toMatchObject({ kind: 'response', code: 'INVALID_RESPONSE' })
  })
  it('빈 lookup 배열은 정상 응답이다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json([])))
    await expect(getAdminDongs()).resolves.toEqual([])
  })
  it('AbortController 취소를 network 실패로 재분류하지 않는다', async () => {
    const controller = new AbortController()
    controller.abort()
    const abort = new DOMException('Aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort))
    await expect(getAdminDongs(controller.signal)).rejects.toBe(abort)
  })
})

describe('고정 2025년 추세 API 경계', () => {
  it('네 분기를 보존하고 URL에는 행정동과 업종만 전달한다', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(json(normalTrend))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdminDongTrend(query, controller.signal)).resolves.toEqual(normalTrend)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin-dong-trends?dongCode=11110515&industryCode=CAFE',
      { signal: controller.signal, headers: { Accept: 'application/json' } })
  })

  it('부분/전체 NO_ROW와 metric NULL·0·signed BIGINT를 구분한다', async () => {
    const body = structuredClone(normalTrend)
    body.quarters[0].storeStats = { storeCount: null, similarStoreCount: 0, openingStoreCount: null, closingStoreCount: null, franchiseStoreCount: null }
    body.quarters[0].salesStats = { estimatedSalesAmount: '9223372036854775807', transactionCount: '-9223372036854775808', weekdayEstimatedSalesAmount: '0', weekendEstimatedSalesAmount: null }
    body.quarters[1].salesStats = null
    body.quarters[1].missingReasons.salesStats = 'NO_ROW'
    body.quarters[2].storeStats = null
    body.quarters[2].salesStats!.estimatedSalesAmount = '9007199254740993'
    body.quarters[2].missingReasons.storeStats = 'NO_ROW'
    body.quarters[3].storeStats = null
    body.quarters[3].salesStats = null
    body.quarters[3].missingReasons = { storeStats: 'NO_ROW', salesStats: 'NO_ROW' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)))
    await expect(getAdminDongTrend(query)).resolves.toEqual(body)
  })

  const q = normalTrend.quarters
  it.each([
    ['3개', q.slice(0, 3)],
    ['5개', [...q, q[0]]],
    ['중복', [q[0], q[0], q[2], q[3]]],
    ['20252 시작', [q[1], q[2], q[3], q[0]]],
    ['순서 오류', [q[0], q[2], q[1], q[3]]],
    ['20261', [q[0], q[1], q[2], { ...q[3], quarter: { code: '20261', label: '2026년 1분기' } }]],
    ['숫자 code', [{ ...q[0], quarter: { code: 20251, label: '2025년 1분기' } }, ...q.slice(1)]],
    ['잘못된 label', [{ ...q[0], quarter: { code: '20251', label: '2025년 2분기' } }, ...q.slice(1)]],
    ['배열 아님', {}],
    ['null item', [null, ...q.slice(1)]],
  ])('고정 축 위반 %s를 INVALID_RESPONSE로 거부한다', async (_, quarters) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...normalTrend, quarters })))
    await expect(getAdminDongTrend(query)).rejects.toMatchObject({ kind: 'response', code: 'INVALID_RESPONSE' })
  })

  it.each([
    { ...normalTrend, dong: null },
    { ...normalTrend, industry: { code: 'CAFE', name: 42 } },
    { ...normalTrend, quarters: q.map((row, i) => i ? row : { ...row, storeStats: null }) },
    { ...normalTrend, quarters: q.map((row, i) => i ? row : { ...row, missingReasons: { storeStats: null, salesStats: 'NO_ROW' } }) },
    { ...normalTrend, quarters: q.map((row, i) => i ? row : { ...row, missingReasons: {} }) },
  ])('식별자/section/missingReasons 계약 위반을 거부한다', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)))
    await expect(getAdminDongTrend(query)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it.each([2147483648, -2147483649, 1.5, '0'])('점포 INTEGER 위반 %s를 거부한다', async (value) => {
    const body = { ...normalTrend, quarters: q.map((row, i) => i ? row : { ...row, storeStats: { ...row.storeStats, storeCount: value } }) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)))
    await expect(getAdminDongTrend(query)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it.each([9007199254740992, 'invalid', '1e3', '1.5', '+1', '01', '9223372036854775808', '-9223372036854775809'])('매출 BIGINT 위반 %s를 거부한다', async (value) => {
    const body = { ...normalTrend, quarters: q.map((row, i) => i ? row : { ...row, salesStats: { ...row.salesStats, estimatedSalesAmount: value } }) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)))
    await expect(getAdminDongTrend(query)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('네 분기 전체 NO_ROW는 정상 응답이다', async () => {
    const body = { ...normalTrend, quarters: q.map(row => ({ ...row, storeStats: null, salesStats: null, missingReasons: { storeStats: 'NO_ROW', salesStats: 'NO_ROW' } })) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)))
    await expect(getAdminDongTrend(query)).resolves.toEqual(body)
  })

  it('잘못된 JSON과 network 실패도 empty 데이터로 바꾸지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid json')))
    await expect(getAdminDongTrend(query)).rejects.toMatchObject({ kind: 'response', code: 'INVALID_RESPONSE' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('secret')))
    await expect(getAdminDongTrend(query)).rejects.toMatchObject({ kind: 'network', code: 'NETWORK_ERROR' })
  })
})
