const numberFormat = new Intl.NumberFormat('ko-KR')

export function formatCount(value: number | null) {
  return value === null ? '자료 없음' : `${numberFormat.format(value)}개`
}

export function formatDecimal(value: string | null, unit: '원' | '건') {
  return value === null ? '자료 없음' : `${numberFormat.format(BigInt(value))}${unit}`
}
