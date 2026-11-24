import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { ExploreMenu } from './explore-menu';

const levels = ['minimum', 'middle', 'maximum'] as const;
const levelLabels = { minimum: '최소', middle: '중간', maximum: '최대' };
export type SheetLevel = (typeof levels)[number];
type SnapPoint = { level: SheetLevel; height: number };
type Gesture = {
  handle: HTMLElement;
  id: number;
  y: number;
  startHeight: number;
  moved: boolean;
};

function nearestIndex(points: readonly SnapPoint[], height: number) {
  return points.reduce(
    (best, point, index) =>
      Math.abs(point.height - height) < Math.abs(points[best].height - height)
        ? index
        : best,
    0,
  );
}

export function useMobileSheet({
  shellRef,
  open,
  menu,
  compact,
  picking,
  selected,
  onSelect,
  dragHeight,
  cancelDrag,
}: {
  shellRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  menu: ExploreMenu;
  compact: boolean;
  picking: boolean;
  selected: SheetLevel | undefined;
  onSelect: (level: SheetLevel) => void;
  dragHeight: (height?: number) => number;
  cancelDrag: () => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const [sizes, setSizes] = useState<number[]>([]);
  const points: SnapPoint[] = [];
  levels.forEach((level, index) => {
    const height = sizes[index];
    const lastPoint = points.at(-1);
    if (height > 0 && (!lastPoint || height - lastPoint.height >= 2))
      points.push({ level, height });
  });
  const current = nearestIndex(
    points,
    sizes[levels.indexOf(selected ?? (compact ? 'minimum' : 'middle'))] ?? 0,
  );
  const enabled = open && !picking && points.length > 1;
  useLayoutEffect(() => {
    if (
      !open ||
      enabled ||
      !document.activeElement?.matches('.explore-sheet-handle')
    )
      return;
    shellRef.current
      ?.querySelector<HTMLElement>('.explore-panel-heading h2')
      ?.focus({ preventScroll: true });
  }, [enabled, open, shellRef]);

  const release = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.handle.hasPointerCapture?.(current.id))
      current.handle.releasePointerCapture(current.id);
    return current;
  }, []);
  const abort = useCallback(() => {
    if (release()) cancelDrag();
  }, [release, cancelDrag]);

  useLayoutEffect(() => {
    const probes = Array.from(
      shellRef.current?.querySelectorAll<HTMLElement>('[data-sheet-size]') ??
        [],
    );
    let last: number[] = [];
    const read = () => {
      const next = probes.map((probe) => probe.getBoundingClientRect().height);
      if (
        last.length === next.length &&
        last.every((height, index) => height === next[index])
      )
        return;
      last = next;
      abort();
      setSizes(next);
    };
    read();
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(read)
        : undefined;
    probes.forEach((probe) => observer?.observe(probe));
    window.addEventListener('resize', abort);
    window.addEventListener('resize', read);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', abort);
      window.removeEventListener('resize', read);
      abort();
    };
  }, [abort, shellRef]);
  useLayoutEffect(() => abort, [abort, open, menu, compact, picking]);

  function heightAt(drag: Gesture, y: number) {
    return Math.min(
      points.at(-1)!.height,
      Math.max(points[0].height, drag.startHeight + drag.y - y),
    );
  }

  return {
    enabled,
    current,
    count: points.length,
    valueText:
      points.length === 1
        ? '가용 높이'
        : selected
          ? levelLabels[points[current]?.level ?? selected]
          : '자동 높이',
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (!enabled) return;
      const displayed =
        shellRef.current?.firstElementChild?.getBoundingClientRect().height ??
        0;
      const index = selected ? current : nearestIndex(points, displayed);
      const next = (
        {
          Home: 0,
          End: points.length - 1,
          ArrowUp: index + 1,
          ArrowRight: index + 1,
          ArrowDown: index - 1,
          ArrowLeft: index - 1,
        } as Record<string, number>
      )[event.key];
      if (next === undefined) return;
      event.preventDefault();
      abort();
      onSelect(points[Math.min(points.length - 1, Math.max(0, next))].level);
    },
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!enabled || !event.isPrimary || event.button !== 0 || gesture.current)
        return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      gesture.current = {
        handle: event.currentTarget,
        id: event.pointerId,
        y: event.clientY,
        startHeight: 0,
        moved: false,
      };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const drag = gesture.current;
      if (!enabled || drag?.id !== event.pointerId) return;
      if (!drag.moved) {
        if (Math.abs(event.clientY - drag.y) < 6) return;
        drag.startHeight = dragHeight();
        drag.moved = true;
      }
      dragHeight(heightAt(drag, event.clientY));
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (gesture.current?.id !== event.pointerId) return;
      const drag = release();
      if (!drag?.moved) return;
      if (!enabled) return cancelDrag();
      onSelect(
        points[nearestIndex(points, heightAt(drag, event.clientY))].level,
      );
    },
    onPointerCancel(event: PointerEvent<HTMLDivElement>) {
      if (gesture.current?.id === event.pointerId) abort();
    },
  };
}
