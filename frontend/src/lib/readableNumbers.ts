import type { ChangeItem } from '../types/regions'

export function formatChangeRate(rate: string | null, direction: ChangeItem['direction']) {
  if (rate === null || direction === null) return '변화율 확인 불가'
  const match = /^(-?)([0-9]+)\.([0-9]{4})$/.exec(rate)
  if (!match) return '변화율 확인 불가'
  const absolute = BigInt(match[2]) * 10000n + BigInt(match[3])
  const tenths = (absolute + 500n) / 1000n
  if (tenths === 0n && direction !== 'UNCHANGED') return `0.1% 미만 ${direction === 'INCREASE' ? '증가' : '감소'}`
  const sign = direction === 'INCREASE' ? '+' : direction === 'DECREASE' ? '-' : ''
  return `${sign}${(tenths / 10n).toLocaleString('ko-KR')}.${tenths % 10n}% · ${direction === 'INCREASE' ? '증가' : direction === 'DECREASE' ? '감소' : '변동 없음'}`
}
