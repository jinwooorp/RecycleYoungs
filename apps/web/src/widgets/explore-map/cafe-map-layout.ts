export type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

export function boxesOverlap(a: Box, b: Box, gap = 0) {
  return (
    a.left < b.right + gap &&
    a.right > b.left - gap &&
    a.top < b.bottom + gap &&
    a.bottom > b.top - gap
  );
}

export function cafeWindowBounds(
  content: HTMLElement,
  area: HTMLElement | null,
): Box {
  const inner = content.getBoundingClientRect();
  // Kakao는 콘텐츠의 바깥 프레임에 별도 꼬리를 배치합니다.
  const frame = content.parentElement?.parentElement;
  if (!frame || !area?.contains(frame) || frame === area) return inner;
  const outer = frame.getBoundingClientRect();
  if (
    !outer.width ||
    !outer.height ||
    Math.abs(outer.width - inner.width) > 12 ||
    Math.abs(outer.height - inner.height) > 12
  )
    return inner;
  return [
    outer,
    ...Array.from(frame.children, (node) => node.getBoundingClientRect()),
  ]
    .filter(({ width, height }) => width > 0 && height > 0)
    .reduce<Box>(
      (bounds, part) => ({
        left: Math.min(bounds.left, part.left),
        right: Math.max(bounds.right, part.right),
        top: Math.min(bounds.top, part.top),
        bottom: Math.max(bounds.bottom, part.bottom),
      }),
      inner,
    );
}

export function fitCafeWindow(
  card: Box,
  area: Box,
  obstacles: readonly Box[],
  preferTop = false,
): Box | null {
  const gap = 12;
  const width = card.right - card.left;
  const height = card.bottom - card.top;
  const minX = area.left + gap;
  const maxX = area.right - gap - width;
  const minY = area.top + gap;
  const maxY = area.bottom - 24 - height;
  if (width <= 0 || height <= 0 || maxX < minX || maxY < minY) return null;
  const xValues = [card.left, minX, maxX];
  const yValues = [card.top, minY, maxY];
  for (const obstacle of obstacles) {
    xValues.push(obstacle.left - gap - width, obstacle.right + gap);
    yValues.push(obstacle.top - gap - height, obstacle.bottom + gap);
  }
  let destination: Box | null = null;
  let distance = Infinity;
  for (const x of xValues) {
    const left = Math.max(minX, Math.min(maxX, x));
    for (const y of yValues) {
      const top = Math.max(minY, Math.min(maxY, y));
      const candidate = {
        left,
        top,
        right: left + width,
        bottom: top + height,
      };
      if (obstacles.some((box) => boxesOverlap(candidate, box, gap))) continue;
      const movement = (left - card.left) ** 2 + (top - card.top) ** 2;
      const isHigher =
        preferTop && destination !== null && top < destination.top;
      if (
        !destination ||
        isHigher ||
        ((!preferTop || top === destination.top) && movement < distance)
      ) {
        destination = candidate;
        distance = movement;
      }
    }
  }
  return destination;
}
