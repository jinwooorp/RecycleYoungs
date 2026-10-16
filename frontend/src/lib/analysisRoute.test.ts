import { describe, expect, it } from 'vitest'
import { parseAnalysisRoute } from './analysisRoute'
describe('상세 URL', () => {
  it('accepts a region and optional quarter but rejects duplicated or malformed parameters', () => {
    expect(parseAnalysisRoute('/analysis', '?dongCode=11110515&quarterCode=20254').error).toBeNull()
    expect(parseAnalysisRoute('/analysis', '?dongCode=11110515').code).toBe('11110515')
    for (const query of ['?dongCode=11110515&dongCode=11110515', '?dongCode=foo', '?dongCode=11110515&quarterCode=20255', '?lat=37'])
      expect(parseAnalysisRoute('/analysis', query).error).toBeTruthy()
  })
  it('does not invent a point for region-only URLs', () => {
    expect(parseAnalysisRoute('/analysis', '?dongCode=11110515')).toEqual({ detail: true, code: '11110515', quarter: '', quarterSpecified: false, error: null })
    expect(parseAnalysisRoute('/', '').detail).toBe(false)
  })
})
