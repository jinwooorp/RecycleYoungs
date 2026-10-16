import { expect, it } from 'vitest'
import { chartHeights } from './chartScale'
it('keeps NULL gaps and zeros distinct while scaling huge exact integers', () => {
  expect(chartHeights(['9007199254740993000', null, '0', '4503599627370496500'])).toEqual([100, null, 0, 50])
  expect(chartHeights([null, '0'])).toEqual([null, 0])
})
