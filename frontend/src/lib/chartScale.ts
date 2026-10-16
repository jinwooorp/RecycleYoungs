export function chartHeights(values: (string | null)[]): (number | null)[] {
  const parsed = values.map(v => v !== null && /^(0|[1-9][0-9]*)$/.test(v) ? BigInt(v) : null)
  const max = parsed.reduce<bigint>((m, v) => v !== null && v > m ? v : m, 0n)
  // Convert only bounded, normalized pixels to Number; never convert the raw BIGINT.
  return parsed.map(v => v === null ? null : max === 0n ? 0 : Number(v * 10000n / max) / 100)
}
