import { useRef, useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  Coffee,
  GitCompareArrows,
  MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExplorePanel, type ExploreMenu } from '@/components/explore-panel';
import { PlaceSearch } from '@/components/place-search';
import { usePlaceSearch } from '@/hooks/use-place-search';
import type { MapConnection } from '@/components/kakao-map';
import { KakaoMapView } from '@/components/kakao-map';
import { useRegionExplorer } from '@/hooks/use-region-explorer';
import { useCafeExplorer } from '@/hooks/use-cafe-explorer';

const menus = [
  { id: 'region', label: '지역 탐색', Icon: MapPin },
  { id: 'cafes', label: '주변 카페', Icon: Coffee },
  { id: 'analysis', label: '상권 분석', Icon: BarChart3 },
  { id: 'compare', label: '후보지 비교', Icon: GitCompareArrows },
] as const;

export default function App() {
  const region = useRegionExplorer();
  const [connection, setConnection] = useState<MapConnection | null>(null);
  const search = usePlaceSearch(
    connection?.status === 'ready' ? (connection.context?.maps ?? null) : null,
    region.revision,
    connection?.context ?? null,
  );
  const cafes = useCafeExplorer(
    region.districtCode,
    region.dongCode,
    region.boundary.status === 'loading',
  );
  const [selectedMenu, setSelectedMenu] = useState<ExploreMenu | null>(null);
  // 닫는 전환이 끝날 때까지 마지막 내용을 유지해 깜빡임을 방지합니다.
  const [panelMenu, setPanelMenu] = useState<ExploreMenu>('region');
  const menuRefs = useRef<
    Partial<Record<ExploreMenu, HTMLButtonElement | null>>
  >({});
  const selectedLabel = menus.find(({ id }) => id === panelMenu)!.label;

  function closePanel() {
    // 패널 안에 있던 키보드 포커스가 숨겨지지 않도록 메뉴로 돌려보냅니다.
    if (selectedMenu) menuRefs.current[selectedMenu]?.focus();
    setSelectedMenu(null);
  }
  return (
    <div className="flex h-dvh min-h-80 flex-col overflow-hidden bg-background">
      <a
        href="#explore-main"
        className="sr-only z-50 rounded-lg bg-background p-3 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        탐색 화면으로 건너뛰기
      </a>
      <main
        id="explore-main"
        aria-label="RecycleYoungs 탐색 화면"
        tabIndex={-1}
        className="relative flex min-h-0 flex-1 flex-col outline-none md:flex-row"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && selectedMenu) {
            event.preventDefault();
            closePanel();
          }
        }}
      >
        <nav
          aria-label="탐색 메뉴"
          className="order-3 shrink-0 border-t bg-background p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:order-0 md:w-18 md:border-t-0 md:border-r md:pb-1"
        >
          <div className="mb-2 hidden h-16 items-center justify-center border-b md:flex">
            <div
              role="img"
              aria-label="RecycleYoungs"
              className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"
            >
              <Coffee aria-hidden="true" className="size-5" />
            </div>
          </div>
          <ul className="grid grid-cols-4 gap-1 md:flex md:flex-col md:gap-2">
            {menus.map(({ id, label, Icon }) => (
              <li key={id}>
                <Button
                  ref={(node) => {
                    menuRefs.current[id] = node;
                  }}
                  variant="navigation"
                  size="navigation"
                  aria-label={label}
                  aria-expanded={selectedMenu === id}
                  aria-controls="explore-panel"
                  onClick={() => {
                    setPanelMenu(id);
                    setSelectedMenu((current) => (current === id ? null : id));
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </nav>
        <PlaceSearch
          search={search}
          connection={connection}
          panelOpen={selectedMenu !== null}
          regionFiltered={!!region.districtCode}
          onNearby={(place) => {
            cafes.setMode('nearby');
            cafes.selectCenter({
              longitude: place.longitude,
              latitude: place.latitude,
            });
            setPanelMenu('cafes');
            setSelectedMenu('cafes');
            search.close();
            menuRefs.current.cafes?.focus();
          }}
        />
        <div
          className="explore-panel-shell order-2 md:order-0"
          data-open={selectedMenu !== null}
        >
          <aside
            id="explore-panel"
            aria-labelledby="explore-panel-title"
            aria-hidden={selectedMenu === null}
            inert={selectedMenu === null}
            className="explore-panel flex min-h-0 flex-col overflow-hidden border-t bg-background md:border-t-0 md:border-r"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
              <h2 id="explore-panel-title" className="text-base font-semibold">
                {selectedLabel ?? '탐색 도구'}
              </h2>
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={`${selectedLabel ?? '상세'} 패널 닫기`}
                onClick={closePanel}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <ExplorePanel
                key={panelMenu}
                menu={panelMenu}
                region={region}
                cafes={cafes}
                active={selectedMenu !== null}
              />
            </div>
          </aside>
        </div>
        <KakaoMapView
          target={region.target}
          cafes={cafes}
          connectionChanged={setConnection}
          searchSelection={search.selected}
          onSearchMarkerClick={search.showSelection}
          centerPicking={selectedMenu === 'cafes'}
        />
      </main>
    </div>
  );
}
