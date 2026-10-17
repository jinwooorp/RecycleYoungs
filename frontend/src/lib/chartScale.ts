export function chartScale(values: (string | null)[]) {
  const valid = values.map(v => v !== null && /^(0|[1-9][0-9]*)$/.test(v) ? BigInt(v) : null)
  const max = valid.reduce<bigint>((m, v) => v !== null && v > m ? v : m, 0n)
  const roughStep = max === 0n ? 1n : (max + 3n) / 4n
  const magnitude = 10n ** BigInt(roughStep.toString().length - 1)
  const step = [1n, 2n, 5n, 10n].map(n => n * magnitude).find(n => n >= roughStep)!
  const upper = max === 0n ? 1n : ((max + step - 1n) / step) * step
  const ticks: string[] = []
  for (let n = 0n; n <= upper; n += step) ticks.push(n.toString())
  return { maximum: upper.toString(), ticks,
    heights: valid.map(v => v === null ? null : Number(v * 10000n / upper) / 100) }
}

export function formatAxisTick(raw: string) {
  const value = BigInt(raw)
  const unit = [[10000000000000000n, '경'], [1000000000000n, '조'], [100000000n, '억'], [10000n, '만']] as const
  const chosen = unit.find(([size]) => value >= size)
  if (!chosen) return value.toLocaleString('ko-KR')
  const [size, suffix] = chosen, tenths = value * 10n / size
  return `${(tenths / 10n).toLocaleString('ko-KR')}${tenths % 10n === 0n ? '' : '.' + tenths % 10n}${suffix}`
}
