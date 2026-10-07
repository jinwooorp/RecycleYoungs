import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { normalTrend } from './test/trendFixture'

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
let trendResponse: () => Promise<Response>

beforeEach(() => {
  statsResponse = async () => json(normal)
  trendResponse = async () => json(normalTrend)
  fetchMock.mockReset().mockImplementation(async (input) => {
    const path = String(input)
    if (path === '/api/admin-dongs') return json(dongs)
    if (path === '/api/industries') return json(industries)
    if (path === '/api/quarters') return json(quarters)
    if (path.startsWith('/api/admin-dong-stats?')) return statsResponse()
    if (path.startsWith('/api/admin-dong-trends?')) return trendResponse()
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
async function details(dong = '청운효자동') {
  return within(await screen.findByRole('region', { name: `${dong} · 카페` }))
}
function signalFor(endpoint: 'stats' | 'trends') {
  return fetchMock.mock.calls.find(([url]) => String(url).startsWith(`/api/admin-dong-${endpoint}?`))?.[1]?.signal
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
    const detail = await details()
    expect(detail.getByText('4,535,266,422원')).toBeInTheDocument()
    expect(detail.getByText('114개')).toBeInTheDocument()
    expect(detail.getByText('302,642건')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '청운효자동 · 카페' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/admin-dong-stats?dongCode=11110515&industryCode=CAFE&quarterCode=20251')).toBe(true)
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
    expect((await details()).getByText('114개')).toBeInTheDocument()
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
    await details()
    const pending = deferred<Response>()
    statsResponse = () => pending.promise
    fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
    expect(screen.getByRole('button', { name: '조회 중...' })).toBeDisabled()
    expect(screen.queryByRole('region', { name: '청운효자동 · 카페' })).not.toBeInTheDocument()
    expect(screen.getByText('통계를 조회하는 중입니다.')).toBeInTheDocument()
  })

  it('조건 변경 시 요청을 취소하고 늦은 이전 응답은 새 결과를 덮지 않는다', async () => {
    const old = deferred<Response>()
    const oldTrend = deferred<Response>()
    statsResponse = () => old.promise
    trendResponse = () => oldTrend.promise
    render(<App />)
    await search()
    const oldSignal = signalFor('stats')
    const oldTrendSignal = signalFor('trends')
    fireEvent.change(screen.getByLabelText('행정동'), { target: { value: '11260550' } })
    expect(oldSignal?.aborted).toBe(true)
    expect(oldTrendSignal?.aborted).toBe(true)
    expect(oldTrendSignal).toBe(oldSignal)
    statsResponse = async () => json({ ...normal, dong: dongs[1], storeStats: { ...normal.storeStats, storeCount: 17 } })
    const nextTrend = structuredClone(normalTrend)
    nextTrend.dong = dongs[1]
    nextTrend.quarters.forEach((row, i) => { row.storeStats!.storeCount = [17, 16, 16, 15][i] })
    trendResponse = async () => json(nextTrend)
    fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
    await details('면목5동')
    await act(async () => { old.resolve(json(normal)); oldTrend.resolve(json(normalTrend)); await Promise.all([old.promise, oldTrend.promise]) })
    expect((await details('면목5동')).getByText('17개')).toBeInTheDocument()
    expect(screen.queryByText('114개')).not.toBeInTheDocument()
  })

  it('unmount 시 진행 중 요청을 취소한다', async () => {
    const pending = deferred<Response>()
    statsResponse = () => pending.promise
    const view = render(<App />)
    await search()
    const signal = signalFor('stats')
    const trendSignal = signalFor('trends')
    view.unmount()
    expect(signal?.aborted).toBe(true)
    expect(trendSignal?.aborted).toBe(true)
    expect(trendSignal).toBe(signal)
  })
})

describe('선택 분기 상세와 고정 4분기 추세', () => {
  const storeTable = () => screen.getByRole('table', { name: '청운효자동 카페 2025년 점포 추세' })
  const salesTable = () => screen.getByRole('table', { name: '청운효자동 카페 2025년 추정매출 추세' })

  it('검색 한 번에서 두 요청을 병렬 시작하고 상세 분기와 고정 축을 구분한다', async () => {
    const pending = deferred<Response>()
    statsResponse = () => pending.promise
    render(<App />)
    await search()
    await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
    expect(signalFor('stats')).toBe(signalFor('trends'))
    const trendUrl = fetchMock.mock.calls.find(([url]) => String(url).startsWith('/api/admin-dong-trends?'))?.[0]
    expect(trendUrl).toBe('/api/admin-dong-trends?dongCode=11110515&industryCode=CAFE')
    expect(screen.getByRole('button', { name: '조회 중...' })).toBeDisabled()
    expect(screen.queryByRole('region', { name: '청운효자동 · 카페' })).not.toBeInTheDocument()
    await act(async () => { pending.resolve(json(normal)); await pending.promise })
    expect((await details()).getByText('114개')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '조회하기' })).toBeEnabled())
  })

  it('semantic table에 네 분기와 점포 5개/매출 4개 metric을 정확히 표시한다', async () => {
    render(<App />); await search()
    await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
    const stores = within(storeTable()), sales = within(salesTable())
    for (let i = 1; i <= 4; i++) {
      expect(stores.getByRole('columnheader', { name: `2025년 ${i}분기` })).toBeInTheDocument()
      expect(sales.getByRole('columnheader', { name: `2025년 ${i}분기` })).toBeInTheDocument()
    }
    expect(stores.getAllByRole('rowheader')).toHaveLength(5)
    expect(sales.getAllByRole('rowheader')).toHaveLength(4)
    const cells = within(stores.getByRole('row', { name: /^점포 수 / })).getAllByRole('cell')
    expect(cells.map(cell => cell.textContent)).toEqual(['114개', '114개', '115개', '118개'])
    for (const amount of ['4,535,266,422원', '4,603,714,789원', '4,195,134,430원', '4,724,282,512원']) {
      expect(sales.getByText(amount)).toBeInTheDocument()
    }
    expect((await details()).getByText('4,535,266,422원')).toBeInTheDocument()
  })

  it('추세에서도 2^53 초과 BIGINT를 정확하게 표시한다', async () => {
    const body = structuredClone(normalTrend)
    body.quarters[0].salesStats!.estimatedSalesAmount = '9007199254740993'
    trendResponse = async () => json(body)
    render(<App />); await search()
    await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
    expect(within(salesTable()).getByText('9,007,199,254,740,993원')).toBeInTheDocument()
  })

  it('metric NULL과 실제 0의 cell을 구분한다', async () => {
    const body = structuredClone(normalTrend)
    body.quarters[0].storeStats!.storeCount = null
    body.quarters[0].storeStats!.similarStoreCount = 0
    body.quarters[0].salesStats!.estimatedSalesAmount = null
    body.quarters[0].salesStats!.transactionCount = '0'
    body.quarters[0].salesStats!.weekdayEstimatedSalesAmount = '0'
    trendResponse = async () => json(body)
    render(<App />); await search()
    await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
    expect(within(storeTable()).getByText('자료 없음')).toBeInTheDocument()
    expect(within(storeTable()).getByText('0개')).toBeInTheDocument()
    expect(within(salesTable()).getByText('자료 없음')).toBeInTheDocument()
    expect(within(salesTable()).getByText('0건')).toBeInTheDocument()
    expect(within(salesTable()).getByText('0원')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['salesStats', 'storeStats'] as const)('부분 NO_ROW %s는 남은 section을 유지한다', async (section) => {
    const body = structuredClone(normalTrend)
    body.quarters.forEach(row => { row[section] = null; row.missingReasons[section] = 'NO_ROW' })
    trendResponse = async () => json(body)
    render(<App />); await search()
    await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
    const missing = within(section === 'salesStats' ? salesTable() : storeTable())
    expect(missing.getAllByRole('cell')).toHaveLength(section === 'salesStats' ? 16 : 20)
    expect(missing.getAllByRole('cell').every(cell => cell.textContent === '자료 없음')).toBe(true)
    if (section === 'salesStats') expect(within(storeTable()).getAllByText('114개')).toHaveLength(2)
    else expect(within(salesTable()).getByText('4,535,266,422원')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('전체 NO_ROW도 표의 네 분기를 유지한 정상 상태다', async () => {
    const body = structuredClone(normalTrend)
    body.quarters.forEach(row => { row.storeStats = null; row.salesStats = null; row.missingReasons = { storeStats: 'NO_ROW', salesStats: 'NO_ROW' } })
    trendResponse = async () => json(body)
    render(<App />); await search()
    expect(await screen.findByText('2025년 네 분기 모두 점포 및 추정매출 자료가 없습니다.')).toBeInTheDocument()
    expect(within(storeTable()).getAllByRole('columnheader')).toHaveLength(5)
    expect(within(salesTable()).getAllByRole('columnheader')).toHaveLength(5)
    expect(within(storeTable()).getAllByRole('cell').every(cell => cell.textContent === '자료 없음')).toBe(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stats 성공/trend 실패는 상세 결과를 보존한다', async () => {
    trendResponse = async () => json({ code: 'INTERNAL_ERROR', message: '추세 서버 오류입니다.', field: null }, 500)
    render(<App />); await search()
    expect((await details()).getByText('4,535,266,422원')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('4개 분기 추세를 조회하지 못했습니다. 추세 서버 오류입니다.')
    expect(screen.queryByRole('heading', { name: '2025년 4개 분기 추세' })).not.toBeInTheDocument()
  })

  it('stats 실패/trend 성공은 추세 결과를 보존한다', async () => {
    statsResponse = async () => json({ code: 'INTERNAL_ERROR', message: '상세 서버 오류입니다.', field: null }, 500)
    render(<App />); await search()
    await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
    expect(within(salesTable()).getByText('4,535,266,422원')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('선택한 분기 통계를 조회하지 못했습니다. 상세 서버 오류입니다.')
  })

  it('둘 다 실패해도 오류를 각 영역에 표시한다', async () => {
    statsResponse = async () => { throw new TypeError('offline stats') }
    trendResponse = async () => { throw new TypeError('offline trend') }
    render(<App />); await search()
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.getByText(/선택한 분기 통계를 조회하지 못했습니다/)).toBeInTheDocument()
    expect(screen.getByText(/4개 분기 추세를 조회하지 못했습니다/)).toBeInTheDocument()
  })

  it('stats가 먼저 끝나도 trend가 진행 중이면 중복 submit을 막는다', async () => {
    const pending = deferred<Response>()
    trendResponse = () => pending.promise
    render(<App />); await search()
    await details()
    expect(screen.getByRole('button', { name: '조회 중...' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: '조회 중...' }).closest('form')!)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/admin-dong-stats?'))).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/admin-dong-trends?'))).toHaveLength(1)
    await act(async () => { pending.resolve(json(normalTrend)); await pending.promise })
    await waitFor(() => expect(screen.getByRole('button', { name: '조회하기' })).toBeEnabled())
  })

  it('분기만 변경해도 두 결과를 정리하고 두 요청을 다시 시작한다', async () => {
    render(<App />); await search()
    await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
    await waitFor(() => expect(screen.getByRole('button', { name: '조회하기' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('분기'), { target: { value: '' } })
    expect(screen.queryByRole('heading', { name: '2025년 4개 분기 추세' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '청운효자동 · 카페' })).not.toBeInTheDocument()
    choose()
    fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
    await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/admin-dong-trends?'))).toHaveLength(2)
  })

  it('두 오류가 표시된 뒤 조건을 바꾸면 각각의 오류도 제거한다', async () => {
    statsResponse = async () => json({ code: 'INTERNAL_ERROR', message: '상세 오류', field: null }, 500)
    trendResponse = async () => json({ code: 'INTERNAL_ERROR', message: '추세 오류', field: null }, 500)
    render(<App />); await search()
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    fireEvent.change(screen.getByLabelText('분기'), { target: { value: '' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('세 조건을 선택한 후 조회하기를 눌러 주세요.')).toBeInTheDocument()
    statsResponse = async () => json(normal)
    trendResponse = async () => json(normalTrend)
    choose()
    fireEvent.click(screen.getByRole('button', { name: '조회하기' }))
    await screen.findByRole('heading', { name: '2025년 4개 분기 추세' })
    expect((await details()).getByText('114개')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
