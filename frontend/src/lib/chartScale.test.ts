import { expect, it } from 'vitest'
import { chartHeights, chartScale, formatAxisTick } from './chartScale'
it('keeps NULL gaps and zeros distinct while scaling huge exact integers', () => {
  expect(chartHeights(['9007199254740993000', null, '0', '4503599627370496500'])).toEqual([100, null, 0, 50])
  expect(chartHeights([null, '0'])).toEqual([null, 0])
})
it('uses the same nice upper bound for ticks and plotted values', () => {
  const scale = chartScale(['2331878', null, '0', '-1'])
  expect(scale.ticks).toEqual(['0', '1000000', '2000000', '3000000'])
  expect(scale.maximum).toBe('3000000')
  expect(scale.heights).toEqual([77.72, null, 0, null])
  expect(formatAxisTick('1000000')).toBe('100만')
})
it('handles all-zero, absent, one-count and huge exact data without invalid axes', () => {
  expect(chartScale([null, '0']).ticks).toEqual(['0', '1'])
  expect(chartScale(['1']).heights).toEqual([100])
  const huge = chartScale(['9007199254740993000'])
  expect(BigInt(huge.maximum)).toBeGreaterThanOrEqual(9007199254740993000n)
  expect(huge.heights[0]).toBeGreaterThan(0)
  expect(formatAxisTick('10000000000000000')).toBe('1경')
})
