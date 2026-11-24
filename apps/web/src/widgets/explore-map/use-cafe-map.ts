import { useEffect, useRef, type RefObject } from 'react';
import type {
  KakaoMapContext,
  KakaoMarker,
  KakaoInfoWindow,
  KakaoMouseEvent,
  KakaoMarkerClusterer,
  KakaoCluster,
  KakaoMap,
} from '@/shared/kakao/kakao-maps';
import type { RegionMapTarget } from '@/entities/region/regions';
import type { CafeMapExplorer } from '@/features/cafe-exploration/use-cafe-explorer';
import {
  cafeAddress,
  formatCafeDistance,
  type Cafe,
} from '@/entities/cafe/cafes';

import { cafeBrandLabel } from '@/entities/cafe/cafe-brand';
import {
  boxesOverlap,
  cafeWindowBounds,
  fitCafeWindow,
  type Box,
} from './cafe-map-layout';

// 레벨 3 이상에서 60px 단위로 묶고, 레벨 2 이하는 개별 핀을 표시합니다.
// 2곳부터 묶어 밀집 지역의 겹침을 줄이며 실제 거리 반경과는 무관한 표시 설정입니다.
const clusterSettings = {
  minLevel: 3,
  gridSize: 60,
  minClusterSize: 2,
  averageCenter: true,
};
// 2px 테두리를 제외한 내부 버튼도 최소 44px가 되도록 크기를 지정합니다.
const clusterStyles = [48, 56, 64].map((size) => ({
  width: `${size}px`,
  height: `${size}px`,
  lineHeight: `${size - 4}px`,
  background: '#8BE26E',
  color: '#173629',
  borderRadius: '50%',
  border: '2px solid white',
  boxSizing: 'border-box',
}));

// 공식 Clusterer에는 dispose가 없습니다. 같은 지도에서는 비운 인스턴스를 재사용해
// StrictMode 재설정 때 SDK 내부 지도 리스너가 누적되지 않게 하고, 지도 폐기는 WeakMap에 맡깁니다.
const clusterers = new WeakMap<KakaoMap, KakaoMarkerClusterer>();

/** 외부 문자열 없이 SDK가 계산한 현재 마커 개수만 접근 가능한 버튼으로 표시합니다. */
function clusterText(count: number) {
  const size = Number.isInteger(count) && count >= 0 ? count : 0;
  return `<button type="button" class="cafe-cluster-button" aria-label="조회된 카페 ${size}곳, 확대" title="현재 조회된 카페 ${size}곳">${size}</button>`;
}

/** API 문자열은 textContent로만 전달해 HTML로 해석되지 않도록 합니다. */
function cafeContent(cafe: Cafe, close?: () => void) {
  const content = document.createElement('div');
  content.className =
    'cafe-map-info w-[min(14rem,calc(100vw-4rem))] [overflow-wrap:anywhere]';
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', '기존 경쟁 카페');
  const header = document.createElement('div');
  header.className = 'cafe-map-info-header';
  const purpose = document.createElement('p');
  purpose.className = 'text-xs font-medium text-primary';
  purpose.textContent = '기존 경쟁 카페';
  header.append(purpose);
  if (close) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cafe-map-info-close';
    button.setAttribute('aria-label', '카페 상세 정보 닫기');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 6l12 12M18 6 6 18');
    icon.append(path);
    button.append(icon);
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      close();
    });
    content.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    });
    header.append(button);
  }
  content.append(header);
  const body = document.createElement('div');
  body.className = 'cafe-map-info-body';
  const title = document.createElement('strong');
  title.className = 'block font-semibold';
  title.textContent = [cafe.storeName, cafe.branchName?.trim()]
    .filter(Boolean)
    .join(' · ');
  body.append(title);
  for (const text of [
    cafeBrandLabel(cafe),
    cafe.semasIndustryName,
    cafeAddress(cafe),
    cafe.distanceM === undefined
      ? null
      : `중심점에서 ${formatCafeDistance(cafe.distanceM)}`,
  ]) {
    if (!text) continue;
    const line = document.createElement('p');
    line.className = 'mt-1 text-xs leading-5 text-muted-foreground';
    line.textContent = text;
    body.append(line);
  }
  content.append(body);
  return content;
}

interface CafeMarkerEntry {
  marker: KakaoMarker;
  cafe: Cafe;
  click: () => void;
  over: () => void;
  out: () => void;
}

/** 지도 이벤트·카페 오버레이 수명을 지도 생성과 분리합니다. 마커 갱신은 카메라를 움직이지 않습니다. */
export function useCafeMap(
  context: KakaoMapContext | null,
  movingRef: RefObject<boolean>,
  notifyRef: RefObject<(() => void) | null>,
  target: RegionMapTarget | null | undefined,
  cafes?: CafeMapExplorer,
  centerPicking = false,
  overlaysHidden = false,
) {
  const onViewportChange =
    cafes?.mode === 'nearby' ? undefined : cafes?.onViewportChange;
  const mode = cafes?.mode;
  const center = cafes?.center;
  const radiusM = cafes?.radiusM;
  const selectCenter = cafes?.selectCenter;
  const items = cafes?.items;
  const selected = cafes?.selected;
  const selectCafe = cafes?.selectCafe;
  const clearCafeSelection = cafes?.clearCafeSelection;
  const status = cafes?.status;
  const scopeKey = cafes?.scopeKey;
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const cafeLayerEnabled = scopeKey !== undefined && !overlaysHidden;
  const layerRef = useRef<{
    markers: Map<string, CafeMarkerEntry>;
    selectedId: string | null;
    onSelect?: (id: string) => void;
    onClearSelection?: () => void;
    refreshLabels: () => void;
    showHover: (id: string) => void;
    hideHover: (id?: string) => void;
    updateContent: (id: string) => void;
    close: () => void;
    open: (id: string) => void;
    releaseSelection: () => void;
  } | null>(null);

  useEffect(() => {
    if (!context || mode !== 'nearby' || !centerPicking || !selectCenter)
      return;
    const onClick = (event?: KakaoMouseEvent) => {
      if (event?.latLng)
        selectCenter({
          longitude: event.latLng.getLng(),
          latitude: event.latLng.getLat(),
        });
    };
    context.maps.event.addListener(context.map, 'click', onClick);
    return () =>
      context.maps.event.removeListener(context.map, 'click', onClick);
  }, [context, mode, centerPicking, selectCenter]);

  useEffect(() => {
    if (!context || mode !== 'nearby' || !center || !radiusM || overlaysHidden)
      return;
    const { map, maps } = context;
    const position = new maps.LatLng(center.latitude, center.longitude);
    // 카페 기본 핀과 다른 고정 SVG 표식을 사용합니다. 외부 문자열을 포함하지 않습니다.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 39C12 32 1 25 1 16a15 15 0 1 1 30 0c0 9-11 16-15 23Z" fill="#23513F" stroke="white" stroke-width="2"/><circle cx="16" cy="16" r="7" fill="none" stroke="white" stroke-width="2"/><path d="M16 6v20M6 16h20" stroke="white" stroke-width="2"/></svg>';
    const marker = new maps.Marker({
      position,
      title: '임시 관심 위치',
      // 중심 표식을 클릭해도 지도 클릭으로 전파되지 않게 합니다.
      clickable: true,
      zIndex: 3,
      image: new maps.MarkerImage(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        new maps.Size(32, 40),
        { offset: new maps.Point(16, 40) },
      ),
    });
    const circle = new maps.Circle({
      center: position,
      radius: radiusM,
      strokeColor: '#23513F',
      strokeOpacity: 0.9,
      strokeWeight: 2,
      strokeStyle: 'dash',
      fillColor: '#23513F',
      fillOpacity: 0.08,
    });
    marker.setMap(map);
    circle.setMap(map);
    return () => {
      marker.setMap(null);
      circle.setMap(null);
    };
  }, [context, mode, center, radiusM, overlaysHidden]);

  useEffect(() => {
    if (!context || !onViewportChange) return;
    const { map, maps } = context;
    let timer: number | undefined;
    const report = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (movingRef.current) {
          report();
          return;
        }
        const bounds = map.getBounds();
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        onViewportChange(
          {
            west: sw.getLng(),
            south: sw.getLat(),
            east: ne.getLng(),
            north: ne.getLat(),
          },
          map.getLevel(),
        );
      }, 200);
    };
    notifyRef.current = report;
    maps.event.addListener(map, 'idle', report);
    report();
    return () => {
      window.clearTimeout(timer);
      notifyRef.current = null;
      maps.event.removeListener(map, 'idle', report);
      onViewportChange(null);
    };
  }, [context, onViewportChange, target, movingRef, notifyRef]);

  useEffect(() => {
    if (!context || !cafeLayerEnabled) return;
    const { map, maps } = context;
    let instance = clusterers.get(map);
    if (!instance) {
      instance = new maps.MarkerClusterer({
        map,
        ...clusterSettings,
        disableClickZoom: true,
        calculator: [10, 50],
        styles: clusterStyles,
        texts: clusterText,
      });
      clusterers.set(map, instance);
    }
    const clusterer = instance;
    clustererRef.current = clusterer;
    let active = true;
    const click = (cluster: KakaoCluster) => {
      if (!active) return;
      maps.event.preventMap();
      // 기본 영역 맞춤 확대와 중복 실행하지 않고 한 번에 한 레벨만 확대합니다.
      map.setLevel(Math.max(1, map.getLevel() - 1), {
        anchor: cluster.getCenter(),
      });
    };
    const clustered = (clusters: KakaoCluster[]) => {
      if (!active) return;
      // 후보지(6/7)·검색(4)·반경 중심(3) 마커보다 아래에 표시합니다.
      for (const cluster of clusters) cluster.getClusterMarker().setZIndex(1);
    };
    maps.event.addListener(clusterer, 'clusterclick', click);
    maps.event.addListener(clusterer, 'clustered', clustered);
    return () => {
      active = false;
      maps.event.removeListener(clusterer, 'clusterclick', click);
      maps.event.removeListener(clusterer, 'clustered', clustered);
      clusterer.clear();
      clustererRef.current = null;
    };
  }, [context, cafeLayerEnabled]);

  useEffect(() => {
    const clusterer = clustererRef.current;
    if (!context || !clusterer || scopeKey === undefined) return;
    const { map, maps } = context;
    // 카메라 보정은 SDK 바깥 프레임까지 측정한 뒤 한 번만 실행합니다.
    const info = new maps.InfoWindow({
      disableAutoPan: true,
      removable: false,
    });
    let pinnedContent: HTMLElement | null = null;
    let returnFocus: HTMLElement | null = null;
    let contentSize: { width: number; height: number } | null = null;
    // Hover는 카메라를 움직이지 않으며 선택 창과 별개의 수명을 가집니다.
    let hoverInfo: KakaoInfoWindow | null = null;
    let hoverContent: HTMLElement | null = null;
    let hoveredId: string | null = null;
    let active = true;
    let dragging = false;
    let panning = false;
    let pendingLayout = false;
    let positionFrame: number | null = null;
    let labelFrame: number | null = null;
    const labels: { setMap(map: KakaoMap | null): void }[] = [];
    const clearLabels = () => {
      labels.forEach((label) => label.setMap(null));
      labels.length = 0;
    };

    const area = document.querySelector<HTMLElement>(
      '[aria-label="Kakao Maps 지도"]',
    );
    const workspace = area?.closest<HTMLElement>('.explore-app');
    const panelShell = workspace?.querySelector('.explore-panel-shell');
    const panelIsResizing = () =>
      panelShell?.hasAttribute('data-size-transition');
    let userMovedDuringResize = false;
    const search = workspace?.querySelector('.explore-search');
    const searchForm = search?.querySelector('.explore-search-form');
    const filter = workspace?.querySelector('.region-filter');
    const visualViewport = window.visualViewport;
    const visibleBoxes = (root: ParentNode, selector: string) =>
      Array.from(root.querySelectorAll(selector), (element) =>
        element.getBoundingClientRect(),
      ).filter(({ width, height }) => width > 0 && height > 0);
    const cancelPosition = () => {
      if (positionFrame !== null) cancelAnimationFrame(positionFrame);
      positionFrame = null;
    };
    const clearRoom = () =>
      workspace?.style.removeProperty('--explore-cafe-panel-top');
    function readLayout() {
      const mapBounds = area?.getBoundingClientRect();
      const viewport =
        mapBounds?.width && mapBounds.height
          ? mapBounds
          : {
              left: 0,
              right: window.innerWidth,
              top: 0,
              bottom: window.innerHeight,
            };
      const obstacles = visibleBoxes(
        workspace ?? document,
        '.explore-search-form, [role="search"][aria-label="장소 검색"], .explore-search-results, .explore-search-error, .region-filter > button, .region-filter-controls:not([hidden]), .explore-home, .explore-map-controls, .explore-dock, .explore-location-toast, .explore-location-error',
      );
      const [panel] = visibleBoxes(
        workspace ?? document,
        '.explore-panel-shell[data-open="true"] .explore-panel',
      );
      return { viewport, obstacles, panel };
    }
    function placeInfo(content: HTMLElement, bounds: Box) {
      // 이전에 확보한 공간을 빼고 현재 패널의 원래 크기로 다시 판단합니다.
      const hadRoom = Boolean(clearRoom());
      const { viewport, obstacles, panel } = readLayout();
      const searchLoading = searchForm?.getAttribute('aria-busy') === 'true';
      const shiftsCard = (target: Box) =>
        Math.abs(bounds.left - target.left) > 0.5 ||
        Math.abs(bounds.top - target.top) > 0.5;
      // 지도 위쪽으로 옮기면 SDK가 창을 핀 아래로 뒤집을 수 있어, 새 위치는 검색 도구 아래에서 찾습니다.
      const panViewport = {
        left: viewport.left,
        right: viewport.right,
        bottom: viewport.bottom,
        top: Math.max(
          viewport.top,
          searchForm?.getBoundingClientRect().bottom ?? viewport.top,
        ),
      };
      const layoutObstacles = panel ? [...obstacles, panel] : obstacles;
      let destination = fitCafeWindow(bounds, viewport, layoutObstacles);
      if (destination && shiftsCard(destination))
        destination = fitCafeWindow(bounds, panViewport, layoutObstacles);
      if (
        panel &&
        workspace &&
        !searchLoading &&
        (!destination || (hadRoom && shiftsCard(destination)))
      ) {
        const canReserve = (target: Box) =>
          target.bottom + 12 <= panel.bottom - 56;
        const fitsWithoutPanel =
          hadRoom && fitCafeWindow(bounds, viewport, obstacles);
        const current =
          fitsWithoutPanel &&
          !shiftsCard(fitsWithoutPanel) &&
          canReserve(fitsWithoutPanel) &&
          fitsWithoutPanel;
        // 기존 여백 안에서 읽을 수 있으면 패널을 키우기 위해 지도를 다시 움직이지 않습니다.
        const above =
          current ||
          (!destination && fitCafeWindow(bounds, panViewport, obstacles, true));
        if (above && canReserve(above)) {
          const top = Math.ceil(
            above.bottom + 12 - workspace.getBoundingClientRect().top,
          );
          workspace.style.setProperty('--explore-cafe-panel-top', `${top}px`);
          destination = above;
        }
      }
      const x = destination ? bounds.left - destination.left : 0;
      const y = destination ? bounds.top - destination.top : 0;
      const needsPan = destination && shiftsCard(destination);
      if (!destination || (searchLoading && needsPan)) {
        // 공간이 부족하거나 결과 크기가 바뀌는 중에는 선택을 유지하고 창만 잠시 숨깁니다.
        content.classList.add('cafe-map-info-obscured');
        if (
          content.contains(document.activeElement) &&
          returnFocus?.isConnected
        )
          returnFocus.focus({ preventScroll: true });
        return;
      }
      content.classList.remove('cafe-map-info-obscured');
      if (!needsPan) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        map.setCenter(
          map
            .getProjection()
            .coordsFromContainerPoint(
              new maps.Point(
                (viewport.right - viewport.left) / 2 + x,
                (viewport.bottom - viewport.top) / 2 + y,
              ),
            ),
        );
      } else {
        panning = true;
        map.panBy(x, y);
      }
    }

    function schedulePosition(id: string) {
      cancelPosition();
      if (dragging || panelIsResizing()) return;
      let previous: number[] = [];
      let stableFrames = 0;
      let frames = 0;
      const measure = () => {
        positionFrame = null;
        if (
          !active ||
          layer.selectedId !== id ||
          !pinnedContent ||
          panelIsResizing()
        )
          return;
        const bounds = cafeWindowBounds(pinnedContent, area);
        const { viewport, obstacles, panel } = readLayout();
        const geometry = [
          bounds,
          viewport,
          ...obstacles,
          ...(panel ? [panel] : []),
        ].flatMap(({ left, top, right, bottom }) => [left, top, right, bottom]);
        const usable =
          pinnedContent.isConnected &&
          bounds.right > bounds.left &&
          bounds.bottom > bounds.top;
        const stable =
          usable &&
          geometry.length === previous.length &&
          geometry.every(
            (value, index) => Math.abs(value - previous[index]) < 0.5,
          );
        stableFrames = stable ? stableFrames + 1 : 0;
        if (++frames >= 32) return;
        if (stableFrames >= 2) {
          const { width, height } = pinnedContent.getBoundingClientRect();
          if (
            contentSize &&
            (Math.abs(contentSize.width - width) >= 1 ||
              Math.abs(contentSize.height - height) >= 1)
          ) {
            // CSS 크기가 바뀌면 Kakao가 기억하는 프레임과 꼬리의 위치도 새로 계산합니다.
            const focused = document.activeElement;
            contentSize = { width, height };
            info.setContent(pinnedContent);
            if (
              focused instanceof HTMLElement &&
              pinnedContent.contains(focused) &&
              focused !== document.activeElement
            )
              focused.focus({ preventScroll: true });
            stableFrames = 0;
          } else {
            contentSize = { width, height };
            const body = pinnedContent.querySelector<HTMLElement>(
              '.cafe-map-info-body',
            );
            if (body && body.scrollHeight > body.clientHeight)
              body.tabIndex = 0;
            placeInfo(pinnedContent, bounds);
            layer.refreshLabels();
            return;
          }
        }
        previous = geometry;
        positionFrame = requestAnimationFrame(measure);
      };
      positionFrame = requestAnimationFrame(measure);
    }

    const markers = new Map<string, CafeMarkerEntry>();
    const layer = {
      markers,
      selectedId: null as string | null,
      onSelect: undefined as ((id: string) => void) | undefined,
      onClearSelection: undefined as (() => void) | undefined,
      refreshLabels: () => {
        if (labelFrame !== null) cancelAnimationFrame(labelFrame);
        labelFrame = requestAnimationFrame(() => {
          labelFrame = null;
          clearLabels();
          // 클러스터가 없는 레벨 1·2에서만 화면 안의 겹치지 않는 이름을 최대 40개 표시합니다.
          if (!active || map.getLevel() >= clusterSettings.minLevel) return;
          const mapBounds = area?.getBoundingClientRect();
          const width = area?.clientWidth || window.innerWidth;
          const height = area?.clientHeight || window.innerHeight;
          const occupied: Box[] = [];
          for (const content of [pinnedContent, hoverContent]) {
            if (
              !content?.isConnected ||
              content.classList.contains('cafe-map-info-obscured')
            )
              continue;
            const bounds = cafeWindowBounds(content, area);
            const left = mapBounds?.left ?? 0;
            const top = mapBounds?.top ?? 0;
            occupied.push({
              left: bounds.left - left,
              right: bounds.right - left,
              top: bounds.top - top,
              bottom: bounds.bottom - top,
            });
          }
          const projection = map.getProjection();
          const measurement = document.createElement('div');
          measurement.className = 'cafe-label-measurement';
          measurement.setAttribute('aria-hidden', 'true');
          const candidates = [];
          for (const [id, entry] of markers) {
            if (id === layer.selectedId || id === hoveredId) continue;
            const position = new maps.LatLng(
              entry.cafe.latitude,
              entry.cafe.longitude,
            );
            const { x, y } = projection.containerPointFromCoords(position);
            if (x < 0 || x > width || y < 0 || y > height) continue;
            const content = document.createElement('span');
            content.className = 'cafe-marker-label';
            content.setAttribute('aria-hidden', 'true');
            content.textContent = [
              entry.cafe.storeName,
              entry.cafe.branchName?.trim(),
            ]
              .filter(Boolean)
              .join(' · ');
            measurement.append(content);
            candidates.push({ position, x, y, content });
          }
          (area ?? document.body).append(measurement);
          const measured = candidates.map((candidate) => ({
            ...candidate,
            size: candidate.content.getBoundingClientRect(),
          }));
          measurement.remove();
          for (const { position, x, y, content, size } of measured) {
            const labelWidth = size.width || 144;
            const labelHeight = size.height || 22;
            if (labelWidth + 8 > width) continue;
            const left = Math.max(
              4,
              Math.min(width - labelWidth - 4, x - labelWidth / 2),
            );
            const below = y + labelHeight * 0.2;
            const top =
              below + labelHeight <= height - 4 ? below : y - 38 - labelHeight;
            const box = {
              left,
              right: left + labelWidth,
              top,
              bottom: top + labelHeight,
            };
            if (
              top < 4 ||
              occupied.some((other) => boxesOverlap(box, other, 4))
            )
              continue;
            const label = new maps.CustomOverlay({
              position,
              content,
              xAnchor: (x - left) / labelWidth,
              yAnchor: (y - top) / labelHeight,
              zIndex: 0,
            });
            label.setMap(map);
            labels.push(label);
            occupied.push(box);
            if (labels.length === 40) break;
          }
        });
      },
      hideHover: (id?: string) => {
        if (id && hoveredId !== id) return;
        if (!hoveredId) return;
        hoverInfo?.close();
        hoverContent = null;
        hoveredId = null;
        layer.refreshLabels();
      },
      showHover: (id: string) => {
        const entry = markers.get(id);
        if (!active || !entry || layer.selectedId) return;
        layer.hideHover();
        hoverInfo ??= new maps.InfoWindow({
          disableAutoPan: true,
          removable: false,
        });
        hoverContent = cafeContent(entry.cafe);
        hoverInfo.setContent(hoverContent);
        hoverInfo.open(map, entry.marker);
        hoveredId = id;
        layer.refreshLabels();
      },
      updateContent: (id: string) => {
        const entry = markers.get(id);
        if (!entry) return;
        if (layer.selectedId === id) {
          const focused = pinnedContent?.contains(document.activeElement);
          const obscured = pinnedContent?.classList.contains(
            'cafe-map-info-obscured',
          );
          pinnedContent = cafeContent(entry.cafe, layer.close);
          pinnedContent.classList.toggle(
            'cafe-map-info-obscured',
            Boolean(obscured),
          );
          info.setContent(pinnedContent);
          contentSize = null;
          repositionSelected();
          if (focused)
            pinnedContent
              .querySelector('button')
              ?.focus({ preventScroll: true });
        }
        if (hoveredId === id) {
          hoverContent = cafeContent(entry.cafe);
          hoverInfo?.setContent(hoverContent);
        }
      },
      close: () => {
        maps.event.preventMap();
        const restore = pinnedContent?.contains(document.activeElement)
          ? returnFocus
          : null;
        layer.releaseSelection();
        layer.onClearSelection?.();
        if (restore?.isConnected) restore.focus({ preventScroll: true });
      },
      open: (id: string) => {
        const entry = markers.get(id);
        if (!entry) return;
        layer.hideHover();
        cancelPosition();
        panning = false;
        pendingLayout = false;
        userMovedDuringResize = false;
        clearRoom();
        const focused = document.activeElement;
        if (!pinnedContent?.contains(focused))
          returnFocus = focused instanceof HTMLElement ? focused : null;
        info.close();
        if (layer.selectedId !== id) {
          const previous = layer.selectedId
            ? markers.get(layer.selectedId)
            : undefined;
          if (previous) {
            previous.marker.setZIndex(0);
            previous.marker.setMap(null);
            clusterer.addMarkers([previous.marker], true);
          }
          // 선택 핀은 클러스터에서 분리해 이후 축소·재집계에도 정보창의 앵커를 보장합니다.
          clusterer.removeMarkers([entry.marker], true);
          entry.marker.setZIndex(2);
          entry.marker.setMap(map);
          layer.selectedId = id;
          clusterer.redraw();
        }
        if (map.getLevel() >= clusterSettings.minLevel) {
          const position = new maps.LatLng(
            entry.cafe.latitude,
            entry.cafe.longitude,
          );
          map.setLevel(clusterSettings.minLevel - 1, { anchor: position });
          map.setCenter(position);
        }
        pinnedContent = cafeContent(entry.cafe, layer.close);
        workspace?.setAttribute('data-cafe-detail', '');
        info.setContent(pinnedContent);
        info.open(map, entry.marker);
        contentSize = null;
        schedulePosition(id);
        layer.refreshLabels();
      },
      releaseSelection: () => {
        if (!layer.selectedId) return;
        cancelPosition();
        pendingLayout = false;
        clearRoom();
        workspace?.removeAttribute('data-cafe-detail');
        info.close();
        pinnedContent = null;
        returnFocus = null;
        const previous = markers.get(layer.selectedId);
        layer.selectedId = null;
        if (previous) {
          previous.marker.setZIndex(0);
          previous.marker.setMap(null);
          clusterer.addMarkers([previous.marker], true);
          clusterer.redraw();
        }
        layer.refreshLabels();
      },
    };
    layerRef.current = layer;
    function repositionSelected() {
      if (!layer.selectedId || dragging || panelIsResizing()) return;
      if (panning) pendingLayout = true;
      else schedulePosition(layer.selectedId);
    }
    const onIdle = () => {
      layer.refreshLabels();
      panning = false;
      if (!pendingLayout) return;
      pendingLayout = false;
      repositionSelected();
    };
    // 지도 DOM과 패널의 임시 높이 변경은 감시 밖에 두어 자체 보정이 재실행되지 않게 합니다.
    const observer = new MutationObserver((records) => {
      if (panelIsResizing()) {
        cancelPosition();
        return;
      }
      // 패널이 최종 크기로 돌아간 뒤에만 지도에서 여유 공간을 확인합니다.
      const finishedResize = records.some(
        ({ target, attributeName }) =>
          target === panelShell && attributeName === 'data-size-transition',
      );
      if (finishedResize && userMovedDuringResize) {
        userMovedDuringResize = false;
        return;
      }
      if (
        records.some(
          ({ target, type }) =>
            !panelShell?.contains(target) ||
            type === 'attributes' ||
            panelShell.getAttribute('data-compact') === 'true',
        )
      )
        repositionSelected();
    });
    if (panelShell)
      observer.observe(panelShell, {
        attributes: true,
        attributeFilter: [
          'data-open',
          'data-menu',
          'data-compact',
          'data-size-transition',
        ],
        childList: true,
        characterData: true,
        subtree: true,
      });
    if (filter)
      observer.observe(filter, {
        attributes: true,
        attributeFilter: ['data-open'],
      });
    if (search) observer.observe(search, { childList: true, subtree: true });
    if (searchForm)
      observer.observe(searchForm, {
        attributes: true,
        attributeFilter: ['aria-busy'],
      });
    const main = area?.closest('main');
    if (main)
      observer.observe(main, {
        attributes: true,
        attributeFilter: ['data-picking'],
      });
    if (area?.parentElement)
      observer.observe(area.parentElement, { childList: true });
    const cancelForMapInput = () => {
      if (panelIsResizing()) userMovedDuringResize = true;
      panning = false;
      pendingLayout = false;
      cancelPosition();
    };
    const startDrag = () => {
      dragging = true;
      cancelForMapInput();
    };
    const endDrag = () => {
      dragging = false;
    };
    const resize = () => {
      // 지도 relayout이 진행 중 이동을 중단하면 그 이동의 idle을 기다릴 수 없습니다.
      panning = false;
      pendingLayout = false;
      repositionSelected();
    };
    window.addEventListener('resize', resize);
    visualViewport?.addEventListener('resize', repositionSelected);
    search?.addEventListener('focusin', repositionSelected);
    search?.addEventListener('focusout', repositionSelected);
    area?.addEventListener('wheel', cancelForMapInput, { passive: true });
    maps.event.addListener(map, 'zoom_start', cancelForMapInput);
    maps.event.addListener(map, 'zoom_changed', layer.refreshLabels);
    maps.event.addListener(map, 'idle', onIdle);
    maps.event.addListener(map, 'dragstart', startDrag);
    maps.event.addListener(map, 'dragend', endDrag);
    return () => {
      active = false;
      cancelPosition();
      clearRoom();
      observer.disconnect();
      window.removeEventListener('resize', resize);
      visualViewport?.removeEventListener('resize', repositionSelected);
      search?.removeEventListener('focusin', repositionSelected);
      search?.removeEventListener('focusout', repositionSelected);
      area?.removeEventListener('wheel', cancelForMapInput);
      maps.event.removeListener(map, 'zoom_start', cancelForMapInput);
      workspace?.removeAttribute('data-cafe-detail');
      layer.hideHover();
      if (labelFrame !== null) cancelAnimationFrame(labelFrame);
      clearLabels();
      info.close();
      clusterer.clear();
      maps.event.removeListener(map, 'zoom_changed', layer.refreshLabels);
      maps.event.removeListener(map, 'idle', onIdle);
      maps.event.removeListener(map, 'dragstart', startDrag);
      maps.event.removeListener(map, 'dragend', endDrag);
      for (const { marker, click, over, out } of markers.values()) {
        maps.event.removeListener(marker, 'click', click);
        maps.event.removeListener(marker, 'mouseover', over);
        maps.event.removeListener(marker, 'mouseout', out);
        marker.setMap(null);
      }
      markers.clear();
      layerRef.current = null;
    };
  }, [context, scopeKey]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!context || !layer || !items) return;
    const { maps } = context;
    const clusterer = clustererRef.current;
    if (!clusterer) return;
    const removed: KakaoMarker[] = [];
    const added: KakaoMarker[] = [];
    layer.onSelect = selectCafe;
    layer.onClearSelection = clearCafeSelection;
    // 같은 지역의 지도 이동 중에는 기존 마커를 유지하고, 완료된 최신 결과와 대조합니다.
    // 지역 선택 변경은 위 effect의 scopeKey로 즉시 전체 정리합니다.
    if (status === 'loading') return;
    const next = new Map(items.map((cafe) => [cafe.bizesId, cafe]));
    for (const [id, entry] of layer.markers) {
      const cafe = next.get(id);
      if (
        !cafe ||
        cafe.latitude !== entry.cafe.latitude ||
        cafe.longitude !== entry.cafe.longitude ||
        cafe.storeName !== entry.cafe.storeName
      ) {
        maps.event.removeListener(entry.marker, 'click', entry.click);
        maps.event.removeListener(entry.marker, 'mouseover', entry.over);
        maps.event.removeListener(entry.marker, 'mouseout', entry.out);
        layer.hideHover(id);
        removed.push(entry.marker);
        entry.marker.setMap(null);
        layer.markers.delete(id);
        if (layer.selectedId === id) layer.releaseSelection();
      }
    }
    for (const cafe of items) {
      const existing = layer.markers.get(cafe.bizesId);
      if (existing) {
        if (
          existing.cafe.branchName !== cafe.branchName ||
          existing.cafe.roadAddress !== cafe.roadAddress ||
          existing.cafe.lotAddress !== cafe.lotAddress ||
          existing.cafe.semasIndustryName !== cafe.semasIndustryName ||
          existing.cafe.distanceM !== cafe.distanceM
        ) {
          existing.cafe = cafe;
          layer.updateContent(cafe.bizesId);
        }
        continue;
      }
      const marker = new maps.Marker({
        position: new maps.LatLng(cafe.latitude, cafe.longitude),
        title: cafe.storeName,
        clickable: true,
      });
      const click = () => {
        if (layer.markers.get(cafe.bizesId)?.marker !== marker) return;
        maps.event.preventMap();
        layer.hideHover();
        layer.onSelect?.(cafe.bizesId);
      };
      const over = () => {
        if (layer.markers.get(cafe.bizesId)?.marker === marker)
          layer.showHover(cafe.bizesId);
      };
      const out = () => layer.hideHover(cafe.bizesId);
      layer.markers.set(cafe.bizesId, { marker, cafe, click, over, out });
      maps.event.addListener(marker, 'click', click);
      maps.event.addListener(marker, 'mouseover', over);
      maps.event.addListener(marker, 'mouseout', out);
      added.push(marker);
    }
    // 최대 200개를 일괄 반영한 뒤 한 번만 다시 그립니다. 동일 결과는 재등록하지 않습니다.
    if (removed.length) clusterer.removeMarkers(removed, true);
    if (added.length) clusterer.addMarkers(added, true);
    if (removed.length || added.length) clusterer.redraw();
    layer.refreshLabels();
  }, [context, items, selectCafe, clearCafeSelection, status, scopeKey]);

  useEffect(() => {
    if (selected) layerRef.current?.open(selected.bizesId);
    else layerRef.current?.releaseSelection();
  }, [context, selected]);
}
