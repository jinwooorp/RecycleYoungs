import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { MapPin } from 'lucide-react';
import { ExplorePanel, type ExploreMenu } from '@/components/explore-panel';
import { FloatingDock } from '@/components/floating-dock';
import { FloatingPanel } from '@/components/floating-panel';
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
import { sameCandidateLocation, type Candidate } from '@/lib/candidates';
import { StatisticsQuarterSelect } from '@/components/statistics-quarter-select';
import { useStatisticsQuarters } from '@/hooks/use-statistics-quarters';

const panelId = 'explore-panel';

export default function App() {
  const region = useRegionExplorer();
  const quarterCatalog = useStatisticsQuarters();
  const [connection, setConnection] = useState<MapConnection | null>(null);
  const search = usePlaceSearch(
    connection?.status === 'ready' ? (connection.context?.maps ?? null) : null,
    region.revision,
    connection?.context ?? null,
  );
  const cafes = useCafeExplorer(
    region.districtCodes,
    region.dongCode,
    region.boundary.status === 'loading',
    connection?.status === 'ready' ? (connection.context?.maps ?? null) : null,
    region.cameraKey,
  );
  const [selectedMenu, setSelectedMenu] = useState<ExploreMenu | null>(null);
  // 닫는 전환이 끝날 때까지 마지막 내용을 유지해 깜빡임을 방지합니다.
  const [panelMenu, setPanelMenu] = useState<ExploreMenu>('cafes');
  const workspaceRef = useRef<HTMLDivElement>(null);
  const menuRefs = useRef<
    Partial<Record<ExploreMenu, HTMLButtonElement | null>>
  >({});
  const panelRef = useRef<HTMLElement>(null);
  const panelTitleRef = useRef<HTMLHeadingElement>(null);
  const focusPanelTitle = useRef(false);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const workspace = workspaceRef.current;
    if (!viewport || !workspace) return;
    const update = () => {
      const short =
        viewport.scale === 1 && workspace.clientHeight - viewport.height > 80;
      workspace.toggleAttribute('data-compact-keyboard', short);
      if (viewport.scale === 1)
        workspace.style.setProperty(
          '--explore-overlay-height',
          `${viewport.height}px`,
        );
      else workspace.style.removeProperty('--explore-overlay-height');
    };
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);
  useLayoutEffect(() => {
    if (selectedMenu && focusPanelTitle.current) {
      focusPanelTitle.current = false;
      panelTitleRef.current?.focus({ preventScroll: true });
    }
  }, [selectedMenu]);
  const candidates = useCandidates();
  const candidatePicking = selectedMenu === 'compare' && candidates.picking;
  const centerPicking = selectedMenu === 'cafes';
  const searchedPlace = search.selected?.place;
  const searchMarkerHidden =
    !!searchedPlace &&
    candidates.items.some((item) => sameCandidateLocation(item, searchedPlace));
  function resetNearby() {
    cafes.clearCenter();
    cafes.setMode('viewport');
  }
  function selectCandidate(item: Candidate) {
    candidates.setSelected(item.slot);
    connection?.focusLocation?.(item, region.target);
  }
  useCandidateMap(
    connection?.context ?? null,
    candidates.items,
    candidates.selected,
    candidatePicking,
    selectCandidate,
    (center) => {
      if (candidatePicking) void candidates.add(center);
    },
  );
  function closePanel() {
    // 패널 안에 있던 키보드 포커스가 숨겨지지 않도록 메뉴로 돌려보냅니다.
    if (selectedMenu && panelRef.current?.contains(document.activeElement))
      menuRefs.current[selectedMenu]?.focus({ preventScroll: true });
    if (selectedMenu === 'compare') candidates.leave();
    setSelectedMenu(null);
  }
  function openPanel(menu: ExploreMenu, moveFocus = false) {
    if (selectedMenu === 'compare' && menu !== 'compare') candidates.leave();
    focusPanelTitle.current = moveFocus;
    setPanelMenu(menu);
    setSelectedMenu(menu);
  }
  function openFromSearch(menu: ExploreMenu) {
    openPanel(menu);
    search.close();
    menuRefs.current[menu]?.focus({ preventScroll: true });
  }
  return (
    <div
      ref={workspaceRef}
      className="explore-app relative h-dvh overflow-hidden bg-background"
    >
      <a
        href="#explore-main"
        className="sr-only z-50 rounded-lg bg-background p-3 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        탐색 화면으로 건너뛰기
      </a>
      <main
        id="explore-main"
        aria-label="여기 창업해도 돼? 탐색 화면"
        tabIndex={-1}
        className="relative isolate h-full outline-none"
        data-picking={
          candidatePicking ||
          (centerPicking && cafes.mode === 'nearby' && !cafes.center)
        }
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            selectedMenu &&
            !event.defaultPrevented &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            closePanel();
          }
        }}
      >
        <Link
          to="/"
          aria-label="여기 창업해도 돼? 홈으로"
          title="여기 창업해도 돼? 홈으로"
          className="explore-home"
        >
          <MapPin aria-hidden="true" />
        </Link>
        <PlaceSearch
          search={search}
          connection={connection}
          outsideDistrictFilter={region.searchOutsideFilter}
          onSelect={(place) => {
            if (candidatePicking) candidates.setPicking(false);
            resetNearby();
            region.selectPlace(place);
          }}
          onAnalysis={() => {
            region.analyzePlace();
            openFromSearch('analysis');
          }}
          onCandidate={(place) => {
            openFromSearch('compare');
            void candidates.add(place);
          }}
          onNearby={(place) => {
            cafes.setMode('nearby');
            cafes.selectCenter(
              {
                longitude: place.longitude,
                latitude: place.latitude,
              },
              place,
            );
            openFromSearch('cafes');
          }}
        />
        <RegionFilter
          region={region}
          onOpen={search.close}
          onSelection={() => {
            resetNearby();
            search.close();
          }}
        />
        <KakaoMapView
          regionRevision={region.revision}
          target={region.target}
          boundaries={region.overlays}
          cafes={cafes}
          connectionChanged={setConnection}
          searchSelection={search.selected}
          searchMarkerHidden={searchMarkerHidden}
          onSearchMarkerClick={search.showSelection}
          centerPicking={centerPicking}
          candidatePicking={candidatePicking}
        />
        <FloatingDock
          selected={selectedMenu}
          panelId={panelId}
          registerButton={(menu, node) => {
            menuRefs.current[menu] = node;
          }}
          onSelect={(menu, keyboard) => {
            if (selectedMenu === menu) {
              closePanel();
              return;
            }
            if (!keyboard)
              menuRefs.current[menu]?.focus({ preventScroll: true });
            openPanel(menu, keyboard);
          }}
        />
        <FloatingPanel
          id={panelId}
          menu={panelMenu}
          open={selectedMenu !== null}
          panelRef={panelRef}
          titleRef={panelTitleRef}
          onClose={closePanel}
        >
          {panelMenu !== 'cafes' && (
            <StatisticsQuarterSelect catalog={quarterCatalog} />
          )}
          {panelMenu === 'compare' ? (
            <CandidatePanel
              candidates={candidates}
              active={selectedMenu === 'compare'}
              quarter={quarterCatalog.selected}
              mapReady={connection?.status === 'ready'}
              onSelect={selectCandidate}
              onStartPicking={search.close}
            />
          ) : (
            <ExplorePanel
              menu={panelMenu}
              region={region}
              cafes={cafes}
              active={selectedMenu === panelMenu}
              quarter={quarterCatalog.selected}
            />
          )}
        </FloatingPanel>
      </main>
    </div>
  );
}
