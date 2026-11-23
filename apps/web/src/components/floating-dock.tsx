import { BarChart3, Compass, GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ExploreMenu } from './explore-panel';

const menuItems = {
  cafes: { label: '주변 탐색', Icon: Compass },
  analysis: { label: '상권 분석', Icon: BarChart3 },
  compare: { label: '후보지 분석', Icon: GitCompareArrows },
} satisfies Record<ExploreMenu, { label: string; Icon: typeof Compass }>;

const menuOrder: readonly ExploreMenu[] = ['cafes', 'analysis', 'compare'];

export function FloatingDock({
  selected,
  panelId,
  onSelect,
  registerButton,
}: {
  selected: ExploreMenu | null;
  panelId: string;
  onSelect: (menu: ExploreMenu, keyboard: boolean) => void;
  registerButton: (menu: ExploreMenu, button: HTMLButtonElement | null) => void;
}) {
  return (
    <nav aria-label="탐색 메뉴" className="explore-dock">
      <ul className="grid grid-cols-3 gap-1">
        {menuOrder.map((menu) => {
          const { label, Icon } = menuItems[menu];
          return (
            <li key={menu} className="min-w-0">
              <Button
                ref={(node) => registerButton(menu, node)}
                variant="navigation"
                size="navigation"
                aria-label={label}
                aria-expanded={selected === menu}
                aria-controls={panelId}
                onClick={(event) => onSelect(menu, event.detail === 0)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
