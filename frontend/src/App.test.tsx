import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const dongs = [
  { code: '11110515', name: '청운효자동' },
  { code: '11260550', name: '면목5동' },
  { code: '11470670', name: '신정6동' },
]
const industries = [{ code: 'CAFE', name: '카페' }, { code: 'PUB', name: '주점' }]
const quarters = [{ code: '20251', label: '2025년 1분기' }]
const normal = {
  dong: dongs[0], industry: industries[0], quarter: quarters[0],
  storeStats: { storeCount: 114, similarStoreCount: 115, openingStoreCount: 2, closingStoreCount: 4, franchiseStoreCount: 1 },
  salesStats: { estimatedSalesAmount: '4535266422', transactionCount: '302642', weekdayEstimatedSalesAmount: '2853077729', weekendEstimatedSalesAmount: '1682188693' },
  missingReasons: { storeStats: null, salesStats: null },
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const fetchMock = vi.fn<typeof fetch>()
let statsResponse: () => Promise<Response>

beforeEach(() => {
  statsResponse = async () => json(normal)
  fetchMock.mockReset().mockImplementation(async (input) => {
    const path = String(input)
    if (path === '/api/admin-dongs') return json(dongs)
    if (path === '/api/industries') return json(industries)
    if (path === '/api/quarters') return json(quarters)
    if (path.startsWith('/api/admin-dong-stats?')) return statsResponse()
    throw new Error('Unexpected request')
  })
  vi.stubGlobal('fetch', fetchMock)
})

async function ready() {
  await waitFor(() => expect(screen.getByLabelText('행정동')).toBeEnabled())
}
function choose(dong = '11110515', industry = 'CAFE') {
  fireEvent.change(screen.getByLabelText('행정동'), { target: { value: dong } })
  fireEvent.change(screen.getByLabelText('업종'), { target: { value: industry } })
  fireEvent.change(screen.getByLabelText('분기'), { target: { value: '20251' } })
}
async function search() {
  await ready()
  choose()
  fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('행정동 통계 화면', () => {
  it('lookup 세 개를 병렬 요청하고 로딩 중 선택을 막으며 자동 선택하지 않는다', async () => {
    const pending = deferred<Response>()
    fetchMock.mockImplementation(() => pending.promise)
    render(<App />)
    expect(screen.getByText('조회 조건을 불러오는 중입니다.')).toBeInTheDocument()
    expect(screen.getByLabelText('행정동')).toBeDisabled()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/admin-dongs', '/api/industries', '/api/quarters'])
  })

  it('목록 표시 후 세 조건을 명시적으로 선택해야 조회할 수 있다', async () => {
    render(<App />)
    await ready()
    expect(screen.getByRole('option', { name: '청운효자동' })).toHaveValue('11110515')
    expect(screen.getByRole('option', { name: '카페' })).toHaveValue('CAFE')
    expect(screen.getByRole('option', { name: '2025년 1분기' })).toHaveValue('20251')
    expect(screen.getByLabelText('행정동')).toHaveValue('')
    expect(screen.getByRole('button', { name: '조회하기' })).toBeDisabled()
    choose()
    expect(screen.getByRole('button', { name: '조회하기' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('code query로 조회하고 정상 값과 기준 조건을 표시한다', async () => {
    render(<App />)
    await search()
    expect(await screen.findByText('4,535,266,422원')).toBeInTheDocument()
    expect(screen.getByText('114개')).toBeInTheDocument()
    expect(screen.getByText('302,642건')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '청운효자동 · 카페' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[3][0]).toBe('/api/admin-dong-stats?dongCode=11110515&industryCode=CAFE&quarterCode=20251')
  })

  it('BIGINT는 Number 안전 범위 위에서도 정확한 문자열로 표시한다', async () => {
    statsResponse = async () => json({ ...normal, salesStats: { ...normal.salesStats, estimatedSalesAmount: '9007199254740993' } })
    render(<App />)
    await search()
    expect(await screen.findByText('9,007,199,254,740,993원')).toBeInTheDocument()
  })

  it('metric NULL과 실제 0을 구분하고 행을 NO_ROW로 바꾸지 않는다', async () => {
    statsResponse = async () => json({ ...normal,
      storeStats: { ...normal.storeStats, storeCount: null, similarStoreCount: 0 },
      salesStats: { ...normal.salesStats, estimatedSalesAmount: null, transactionCount: '0', weekdayEstimatedSalesAmount: '0' },
    })
    render(<App />)
    await search()
    expect(await screen.findByText('0건')).toBeInTheDocument()
    const store = within(screen.getByRole('region', { name: '점포 현황' }))
    const sales = within(screen.getByRole('region', { name: '추정매출 현황' }))
    expect(store.getByText('자료 없음')).toBeInTheDocument()
    expect(store.getByText('0개')).toBeInTheDocument()
    expect(sales.getByText('자료 없음')).toBeInTheDocument()
    expect(sales.getByText('0원')).toBeInTheDocument()
    expect(screen.queryByText('해당 조건의 추정매출 자료가 없습니다.')).not.toBeInTheDocument()
  })

  it('부분 NO_ROW에서는 남은 통계 영역을 유지한다', async () => {
    statsResponse = async () => json({ ...normal, salesStats: null, missingReasons: { storeStats: null, salesStats: 'NO_ROW' } })
    render(<App />)
    await search()
    expect(await screen.findByText('해당 조건의 추정매출 자료가 없습니다.')).toBeInTheDocument()
    expect(screen.getByText('114개')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('전체 NO_ROW는 기준 조건을 유지한 정상 empty 결과다', async () => {
    statsResponse = async () => json({ ...normal, storeStats: null, salesStats: null, missingReasons: { storeStats: 'NO_ROW', salesStats: 'NO_ROW' } })
    render(<App />)
    await search()
    expect(await screen.findByText('해당 조건의 점포 및 추정매출 자료가 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '청운효자동 · 카페' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([400, 500])('HTTP %s 오류는 NO_ROW와 분리하고 backend 메시지를 표시한다', async (status) => {
    const message = status === 400 ? '지원하지 않는 분기입니다.' : '데이터 무결성 오류입니다.'
    statsResponse = async () => json({ code: status === 400 ? 'UNSUPPORTED_QUARTER' : 'DATA_INTEGRITY_ERROR', message, field: status === 400 ? 'quarterCode' : null }, status)
    render(<App />)
    await search()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('해당 조건의 점포 및 추정매출 자료가 없습니다.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '조회하기' })).toBeEnabled()
  })

  it('통계 network 실패는 안전한 fallback을 표시한다', async () => {
    statsResponse = async () => { throw new TypeError('secret connection details') }
    render(<App />)
    await search()
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다. 연결 상태를 확인하고 다시 시도해 주세요.')
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })

  it.each([9007199254740992, 'invalid', '1e3', '9223372036854775808', '-9223372036854775809'])('계약을 위반한 BIGINT %s를 0이나 number로 우회하지 않는다', async (value) => {
    statsResponse = async () => json({ ...normal, salesStats: { ...normal.salesStats, estimatedSalesAmount: value } })
    render(<App />)
    await search()
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답을 확인할 수 없습니다.')
    expect(screen.queryByText('0원')).not.toBeInTheDocument()
  })

  it.each([2147483648, -2147483649, 9007199254740992])('INTEGER 범위 밖의 점포 값 %s를 표시하지 않는다', async (value) => {
    statsResponse = async () => json({ ...normal, storeStats: { ...normal.storeStats, storeCount: value } })
    render(<App />)
    await search()
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답을 확인할 수 없습니다.')
  })

  it.each([
    ['9223372036854775807', '9,223,372,036,854,775,807원'],
    ['-9223372036854775808', '-9,223,372,036,854,775,808원'],
  ])('signed BIGINT 경계 %s는 정확하게 표시한다', async (value, display) => {
    statsResponse = async () => json({ ...normal, salesStats: { ...normal.salesStats, estimatedSalesAmount: value } })
    render(<App />)
    await search()
    expect(await screen.findByText(display)).toBeInTheDocument()
  })

  it('행 없음과 missingReasons가 일치하지 않는 응답은 거부한다', async () => {
    statsResponse = async () => json({ ...normal, salesStats: null })
    render(<App />)
    await search()
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답을 확인할 수 없습니다.')
  })

  it('빈 lookup은 실패가 아니라 선택 가능한 조건이 없는 상태다', async () => {
    fetchMock.mockImplementation(async () => json([]))
    render(<App />)
    expect(await screen.findByText('현재 조회 가능한 조건이 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '조회하기' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lookup 오류는 조건 선택을 막고 다시 시도할 수 있다', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('조회 조건을 불러오지 못했습니다.')
    expect(screen.getByLabelText('행정동')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await ready()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('조회 중 중복 제출을 막고 이전 결과를 제거한다', async () => {
    render(<App />)
    await search()
    await screen.findByText('114개')
    const pending = deferred<Response>()
    statsResponse = () => pending.promise
    fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
    expect(screen.getByRole('button', { name: '조회 중...' })).toBeDisabled()
    expect(screen.queryByText('114개')).not.toBeInTheDocument()
    expect(screen.getByText('통계를 조회하는 중입니다.')).toBeInTheDocument()
  })

  it('조건 변경 시 요청을 취소하고 늦은 이전 응답은 새 결과를 덮지 않는다', async () => {
    const old = deferred<Response>()
    statsResponse = () => old.promise
    render(<App />)
    await search()
    const oldSignal = fetchMock.mock.calls[3][1]?.signal
    fireEvent.change(screen.getByLabelText('행정동'), { target: { value: '11260550' } })
    expect(oldSignal?.aborted).toBe(true)
    statsResponse = async () => json({ ...normal, dong: dongs[1], storeStats: { ...normal.storeStats, storeCount: 17 } })
    fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
    await screen.findByText('17개')
    await act(async () => { old.resolve(json(normal)); await old.promise })
    expect(screen.getByText('17개')).toBeInTheDocument()
    expect(screen.queryByText('114개')).not.toBeInTheDocument()
  })

  it('unmount 시 진행 중 요청을 취소한다', async () => {
    const pending = deferred<Response>()
    statsResponse = () => pending.promise
    const view = render(<App />)
    await search()
    const signal = fetchMock.mock.calls[3][1]?.signal
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
})
