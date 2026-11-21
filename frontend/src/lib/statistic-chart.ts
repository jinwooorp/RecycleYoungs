export const BAR_AXIS_WIDTH = 10_000;

/** 같은 단위의 원본 값에서 막대 좌표만 계산합니다. */
export function scaleStatisticBars(values: readonly (string | null)[]) {
  const decimals = values.map((value) => value?.split('.') ?? null);
  const scale = Math.max(
    0,
    ...decimals.map((parts) => parts?.[1]?.length ?? 0),
  );
  const magnitudes = decimals.map((parts) => {
    if (!parts) return null;
    const [integer, fraction = ''] = parts;
    const magnitude = BigInt(integer + fraction.padEnd(scale, '0'));
    return magnitude < 0n ? null : magnitude;
  });

  let maxIndex = -1;
  let maxMagnitude = -1n;
  for (const [index, magnitude] of magnitudes.entries()) {
    if (magnitude !== null && magnitude > maxMagnitude) {
      maxIndex = index;
      maxMagnitude = magnitude;
    }
  }

  return {
    maximum: values[maxIndex] ?? null,
    bars: magnitudes.map((magnitude) => {
      if (magnitude === null) return null;
      if (magnitude === 0n) return { width: 0, zero: true, tiny: false };
      // 양수는 상한도 양수입니다. SVG 좌표 범위로 줄인 뒤에만 number로 바꿉니다.
      const width = Number((magnitude * BigInt(BAR_AXIS_WIDTH)) / maxMagnitude);
      return { width, zero: false, tiny: width < BAR_AXIS_WIDTH / 100 };
    }),
  };
}
