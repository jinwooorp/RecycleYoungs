import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { X } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import type { ExploreMenu } from './explore-menu';
import { usePanelSizeTransition } from './use-panel-size-transition';
import { useMobileSheet, type SheetLevel } from './use-mobile-sheet';

const titles: Record<ExploreMenu, string> = {
  cafes: '주변 탐색',
  analysis: '상권 분석',
  compare: '후보지 분석',
};

export function FloatingPanel({
  id,
  menu,
  open,
  compact,
  picking,
  panelRef,
  titleRef,
  onClose,
  children,
}: {
  id: string;
  menu: ExploreMenu;
  open: boolean;
  compact: boolean;
  picking: boolean;
  panelRef: Ref<HTMLElement>;
  titleRef: Ref<HTMLHeadingElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    menu: ExploreMenu;
    compact: boolean;
    level: SheetLevel;
  } | null>(null);
  const validSelection =
    open && selection?.menu === menu && selection.compact === compact
      ? selection
      : null;
  if (selection && !validSelection) setSelection(null);
  const snap = picking ? null : validSelection;
  const motion = usePanelSizeTransition(shellRef, open, compact, picking, snap);
  const sheet = useMobileSheet({
    shellRef,
    open,
    menu,
    compact,
    picking,
    selected: snap?.level,
    onSelect: (level) => setSelection({ menu, compact, level }),
    ...motion,
  });
  useLayoutEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open, menu]);
  const title = titles[menu];

  return (
    <div
      ref={shellRef}
      className="explore-panel-shell"
      data-menu={menu}
      data-open={open}
      data-compact={compact}
      data-sheet-level={snap?.level}
    >
      <aside
        ref={panelRef}
        id={id}
        aria-labelledby={`${id}-title`}
        aria-hidden={!open}
        inert={!open}
        className="explore-panel flex min-h-0 flex-col overflow-hidden"
      >
        <div className="explore-panel-heading relative flex shrink-0 items-center justify-between gap-3">
          <h2
            ref={titleRef}
            id={`${id}-title`}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={`${title} 패널 닫기`}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
          <div
            className="explore-sheet-handle"
            role="slider"
            aria-label="패널 높이"
            aria-orientation="vertical"
            aria-valuemin={1}
            aria-valuemax={Math.max(1, sheet.count)}
            aria-valuenow={sheet.current + 1}
            aria-valuetext={picking ? '지도에서 위치 선택 중' : sheet.valueText}
            aria-disabled={!sheet.enabled}
            tabIndex={sheet.enabled ? 0 : -1}
            onKeyDown={sheet.onKeyDown}
            onPointerDown={sheet.onPointerDown}
            onPointerMove={sheet.onPointerMove}
            onPointerUp={sheet.onPointerUp}
            onPointerCancel={sheet.onPointerCancel}
            onLostPointerCapture={sheet.onPointerCancel}
          >
            <span aria-hidden="true" />
          </div>
        </div>
        <div className="explore-sheet-probes" aria-hidden="true">
          <span data-sheet-size="minimum" />
          <span data-sheet-size="middle" />
          <span data-sheet-size="maximum" />
        </div>
        <div
          ref={scrollRef}
          className="explore-panel-content min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div key={menu} className="explore-panel-view">
            {children}
          </div>
        </div>
      </aside>
    </div>
  );
}
