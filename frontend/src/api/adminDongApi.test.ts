import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAdminDongs, getAdminDongStats } from './adminDongApi'

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
