export function parseAnalysisRoute(path: string, search: string) {
  const detail = path === '/analysis', params = new URLSearchParams(search)
  const code = params.get('dongCode') ?? '', quarter = params.get('quarterCode') ?? ''
  const invalid = [...params.keys()].some(k => !['dongCode', 'quarterCode'].includes(k) || params.getAll(k).length !== 1)
    || !!code && !/^11[0-9]{6}$/.test(code) || !!quarter && !/^[1-9][0-9]{3}[1-4]$/.test(quarter)
  return { detail, code, quarter, quarterSpecified: params.has('quarterCode'), error: detail && invalid ? '상세 분석 주소의 지역·분기 형식을 확인해 주세요.' : null }
}
