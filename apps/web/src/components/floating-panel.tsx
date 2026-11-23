import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ExploreMenu } from './explore-panel';

const titles: Record<ExploreMenu, string> = {
  cafes: '주변 탐색',
  analysis: '상권 분석',
  compare: '후보지 분석',
};

export function FloatingPanel({
  id,
  menu,
  open,
  panelRef,
  titleRef,
  onClose,
  children,
}: {
  id: string;
  menu: ExploreMenu;
  open: boolean;
  panelRef: Ref<HTMLElement>;
  titleRef: Ref<HTMLHeadingElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open, menu]);
  const title = titles[menu];

  return (
    <div className="explore-panel-shell" data-menu={menu} data-open={open}>
      <aside
        ref={panelRef}
        id={id}
        aria-labelledby={`${id}-title`}
        aria-hidden={!open}
        inert={!open}
        className="explore-panel flex min-h-0 flex-col overflow-hidden"
      >
        <div className="explore-panel-heading flex shrink-0 items-center justify-between gap-3">
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
