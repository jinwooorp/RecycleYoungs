import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BarChart3, ChevronLeft, Coffee, GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExplorePanel, type ExploreMenu } from '@/components/explore-panel';
import { PlaceSearch } from '@/components/place-search';
import { RegionFilter } from '@/components/region-filter';
import { usePlaceSearch } from '@/hooks/use-place-search';
import type { MapConnection } from '@/components/kakao-map';
import { KakaoMapView } from '@/components/kakao-map';
import { useRegionExplorer } from '@/hooks/use-region-explorer';
import { useCafeExplorer } from '@/hooks/use-cafe-explorer';
import { useCandidates } from '@/hooks/use-candidates';
import { useCandidateMap } from '@/hooks/use-candidate-map';
import { CandidatePanel } from '@/components/candidate-panel';
import type { Candidate } from '@/lib/candidates';

const menus = [
  { id: 'cafes', label: '주변 카페', Icon: Coffee },
  { id: 'analysis', label: '상권 분석', Icon: BarChart3 },
  { id: 'compare', label: '후보지 분석', Icon: GitCompareArrows },
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
    connection?.status === 'ready' ? (connection.context?.maps ?? null) : null,
  );
  const [selectedMenu, setSelectedMenu] = useState<ExploreMenu | null>(null);
  // 닫는 전환이 끝날 때까지 마지막 내용을 유지해 깜빡임을 방지합니다.
  const [panelMenu, setPanelMenu] = useState<ExploreMenu>('cafes');
  const menuRefs = useRef<
    Partial<Record<ExploreMenu, HTMLButtonElement | null>>
  >({});
  const panelRef = useRef<HTMLElement>(null);
  const panelTitleRef = useRef<HTMLHeadingElement>(null);
  const focusPanelTitle = useRef(false);
  useLayoutEffect(() => {
    if (selectedMenu && focusPanelTitle.current) {
      focusPanelTitle.current = false;
      panelTitleRef.current?.focus({ preventScroll: true });
    }
  }, [selectedMenu]);
  const candidates = useCandidates();
  function selectCandidate(item: Candidate) {
    candidates.setSelected(item.slot);
    connection?.focusLocation?.(item, region.target);
  }
  useCandidateMap(
    connection?.context ?? null,
    candidates.items,
    candidates.selected,
    selectedMenu === 'compare' && candidates.picking,
    selectCandidate,
    (center) => {
      if (selectedMenu === 'compare' && candidates.picking)
        void candidates.add(center);
    },
  );
  const selectedLabel = menus.find(({ id }) => id === panelMenu)!.label;

  function closePanel() {
    // 패널 안에 있던 키보드 포커스가 숨겨지지 않도록 메뉴로 돌려보냅니다.
    if (selectedMenu && panelRef.current?.contains(document.activeElement))
      menuRefs.current[selectedMenu]?.focus({ preventScroll: true });
    if (selectedMenu === 'compare') candidates.leave();
    setSelectedMenu(null);
  }
  return (
    <div className="explore-app flex h-dvh min-h-80 flex-col overflow-hidden bg-background">
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
        <Link
          to="/"
          aria-label="RecycleYoungs 홈으로"
          title="RecycleYoungs 홈으로"
          className="explore-home"
        >
          <Coffee aria-hidden="true" />
        </Link>
        <nav
          aria-label="탐색 메뉴"
          className="explore-navigation order-3 shrink-0 bg-background md:order-0"
        >
          <ul className="explore-menu-list grid grid-cols-3 md:flex md:flex-col">
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
                  onClick={(event) => {
                    if (selectedMenu === id) {
                      closePanel();
                      return;
                    }
                    focusPanelTitle.current =
                      event.detail === 0 ||
                      panelRef.current?.contains(document.activeElement) ===
                        true;
                    if (selectedMenu === 'compare') candidates.leave();
                    setPanelMenu(id);
                    setSelectedMenu(id);
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </nav>
        <RegionFilter
          region={region}
          onOpen={search.close}
          panelOpen={selectedMenu !== null}
        />
        <PlaceSearch
          search={search}
          connection={connection}
          panelOpen={selectedMenu !== null}
          regionFiltered={!!region.districtCode}
          onCandidate={(place) => {
            setPanelMenu('compare');
            setSelectedMenu('compare');
            search.close();
            menuRefs.current.compare?.focus();
            void candidates.add(place);
          }}
          onNearby={(place) => {
            if (selectedMenu === 'compare') candidates.leave();
            cafes.setMode('nearby');
            cafes.selectCenter(
              {
                longitude: place.longitude,
                latitude: place.latitude,
              },
              place,
            );
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
            ref={panelRef}
            id="explore-panel"
            aria-labelledby="explore-panel-title"
            aria-hidden={selectedMenu === null}
            inert={selectedMenu === null}
            className="explore-panel flex min-h-0 flex-col overflow-hidden border-t bg-background md:border-t-0 md:border-r"
          >
            <div className="explore-panel-heading flex shrink-0 items-center justify-between gap-3">
              <h2
                ref={panelTitleRef}
                id="explore-panel-title"
                tabIndex={-1}
                className="text-base font-semibold"
              >
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
            <div className="explore-panel-content min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {panelMenu === 'compare' ? (
                <CandidatePanel
                  candidates={candidates}
                  active={selectedMenu === 'compare'}
                  mapReady={connection?.status === 'ready'}
                  onSelect={selectCandidate}
                />
              ) : (
                <ExplorePanel
                  key={panelMenu}
                  menu={panelMenu}
                  region={region}
                  cafes={cafes}
                  active={selectedMenu !== null}
                />
              )}
            </div>
          </aside>
        </div>
        <KakaoMapView
          regionRevision={region.revision}
          searchOpen={search.isOpen}
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
