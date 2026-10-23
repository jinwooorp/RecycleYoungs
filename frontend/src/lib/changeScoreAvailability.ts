import type { Quarter } from '../types/api'
import type { ChangeScores } from '../types/regions'

export function isFirstProvidedQuarter(result: ChangeScores | null, dongCode: string, quarters: Quarter[]) {
  const item = result?.items.find(i => i.dong.code === dongCode)
  return !!result && !!item && item.reason === 'PREVIOUS_QUARTER_UNAVAILABLE'
    && item.currentCount !== null && /^\d+$/.test(item.currentCount)
    && item.status === 'UNAVAILABLE' && item.score === null
    && quarters.length > 0 && result.quarter.code === [...quarters].sort((a, b) => a.code.localeCompare(b.code))[0].code
}
