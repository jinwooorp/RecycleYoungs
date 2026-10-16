import { expect, it } from 'vitest'
import { formatChangeRate } from './readableNumbers'
it('rounds display percentages without changing direction or using unsafe numeric conversions', () => {
  expect(formatChangeRate('16.3041', 'INCREASE')).toBe('+16.3% · 증가')
  expect(formatChangeRate('-24.8254', 'DECREASE')).toBe('-24.8% · 감소')
  expect(formatChangeRate('0.0000', 'INCREASE')).toBe('0.1% 미만 증가')
  expect(formatChangeRate('0.0000', 'DECREASE')).toBe('0.1% 미만 감소')
  expect(formatChangeRate('0.0000', 'UNCHANGED')).toBe('0.0% · 변동 없음')
  expect(formatChangeRate('9007199254740993.9500', 'INCREASE')).toBe('+9,007,199,254,740,994.0% · 증가')
})
