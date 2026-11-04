import { useEffect, useRef, type RefObject } from 'react';
import type {
  KakaoMapContext,
  KakaoMarker,
  KakaoInfoWindow,
  KakaoMouseEvent,
  KakaoMarkerClusterer,
  KakaoCluster,
  KakaoMap,
} from '@/lib/kakao-maps';
import type { RegionMapTarget } from '@/lib/regions';
import type { CafeExplorer } from './use-cafe-explorer';
import { cafeAddress, formatCafeDistance, type Cafe } from '@/lib/cafes';

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
function cafeContent(cafe: Cafe) {
  const content = document.createElement('div');
  content.className =
    'w-[min(15rem,calc(100vw-4rem))] max-h-[min(16rem,30dvh)] box-border overflow-y-auto overscroll-contain whitespace-normal break-words p-4 pr-7 text-sm leading-5 [overflow-wrap:anywhere]';
  const purpose = document.createElement('p');
  purpose.className = 'mb-2 text-xs font-medium text-primary';
  purpose.textContent = '기존 경쟁 카페';
  content.append(purpose);
  const title = document.createElement('strong');
  title.className = 'block font-semibold';
  title.textContent = [cafe.storeName, cafe.branchName?.trim()]
    .filter(Boolean)
    .join(' · ');
  content.append(title);
  for (const text of [
    cafe.semasIndustryName,
    cafeAddress(cafe),
    cafe.distanceM === undefined
      ? null
      : `중심점에서 ${formatCafeDistance(cafe.distanceM)}`,
    '브랜드 구분 정보 없음',
  ]) {
    if (!text) continue;
    const line = document.createElement('p');
    line.className = 'mt-1 text-xs leading-5 text-muted-foreground';
    line.textContent = text;
    content.append(line);
  }
  return content;
}

/** 지도 이벤트·카페 오버레이 수명을 지도 생성과 분리합니다. 마커 갱신은 카메라를 움직이지 않습니다. */
export function useCafeMap(
  context: KakaoMapContext | null,
  movingRef: RefObject<boolean>,
  notifyRef: RefObject<(() => void) | null>,
  target: RegionMapTarget | null | undefined,
  cafes?: CafeExplorer,
  centerPicking = false,
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
  const status = cafes?.status;
  const scopeKey = cafes?.scopeKey;
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const cafeLayerEnabled = scopeKey !== undefined;
  const layerRef = useRef<{
    markers: Map<
      string,
      { marker: KakaoMarker; cafe: Cafe; click: () => void }
    >;
    info: KakaoInfoWindow;
    selectedId: string | null;
    onSelect?: (id: string) => void;
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
    if (!context || mode !== 'nearby' || !center || !radiusM) return;
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
      strokeStyle: 'dashed',
      fillColor: '#23513F',
      fillOpacity: 0.08,
    });
    marker.setMap(map);
    circle.setMap(map);
    return () => {
      marker.setMap(null);
      circle.setMap(null);
    };
  }, [context, mode, center, radiusM]);

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
    // 사용자 선택 시에는 화면 끝의 정보창도 읽을 수 있도록 SDK의 자동 패닝을 허용합니다.
    const info = new maps.InfoWindow({
      disableAutoPan: false,
      removable: true,
    });
    let positionFrame: number | null = null;
    const markers = new Map<
      string,
      { marker: KakaoMarker; cafe: Cafe; click: () => void }
    >();
    const layer = {
      markers,
      info,
      selectedId: null as string | null,
      onSelect: undefined as ((id: string) => void) | undefined,
      open: (id: string) => {
        const entry = markers.get(id);
        if (!entry) return;
        if (positionFrame !== null) cancelAnimationFrame(positionFrame);
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
        const content = cafeContent(entry.cafe);
        info.setContent(content);
        info.open(map, entry.marker);
        // SDK 자동 패닝은 지도 위의 고정 검색창을 모르므로 겹칠 때만 추가 여백을 확보합니다.
        positionFrame = requestAnimationFrame(() => {
          positionFrame = null;
          if (!content.isConnected) return;
          const search = document
            .querySelector<HTMLElement>(
              '[role="search"][aria-label="장소 검색"]',
            )
            ?.getBoundingClientRect();
          const area = content
            .closest<HTMLElement>('[aria-label="Kakao Maps 지도"]')
            ?.getBoundingClientRect();
          const bounds = content.getBoundingClientRect();
          const left = (area?.left ?? 0) + 12;
          const right = (area?.right ?? window.innerWidth) - 12;
          const x =
            bounds.left < left
              ? bounds.left - left
              : bounds.right > right
                ? bounds.right - right
                : 0;
          const overlapsSearch =
            search &&
            bounds.left - x < search.right &&
            bounds.right - x > search.left;
          const top = overlapsSearch
            ? Math.max((area?.top ?? 0) + 12, search.bottom + 12)
            : (area?.top ?? 0) + 12;
          const bottom = (area?.bottom ?? window.innerHeight) - 24;
          const y =
            bounds.top < top
              ? bounds.top - top
              : bounds.bottom > bottom
                ? bounds.bottom - bottom
                : 0;
          // 세로 패닝이 SDK의 가로 자동 이동을 중단할 수 있어 두 축을 한 번에 보정합니다.
          if (x || y) map.panBy(x, y);
        });
        layer.selectedId = id;
      },
      releaseSelection: () => {
        if (!layer.selectedId) return;
        if (positionFrame !== null) cancelAnimationFrame(positionFrame);
        info.close();
        const previous = markers.get(layer.selectedId);
        layer.selectedId = null;
        if (previous) {
          previous.marker.setZIndex(0);
          previous.marker.setMap(null);
          clusterer.addMarkers([previous.marker], true);
          clusterer.redraw();
        }
      },
    };
    layerRef.current = layer;
    return () => {
      if (positionFrame !== null) cancelAnimationFrame(positionFrame);
      info.close();
      clusterer.clear();
      for (const { marker, click } of markers.values()) {
        maps.event.removeListener(marker, 'click', click);
        marker.setMap(null);
      }
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
        removed.push(entry.marker);
        entry.marker.setMap(null);
        layer.markers.delete(id);
        if (layer.selectedId === id) {
          layer.info.close();
          layer.selectedId = null;
        }
      }
    }
    for (const cafe of items) {
      const existing = layer.markers.get(cafe.bizesId);
      if (existing) {
        existing.cafe = cafe;
        if (layer.selectedId === cafe.bizesId)
          layer.info.setContent(cafeContent(cafe));
        continue;
      }
      const marker = new maps.Marker({
        position: new maps.LatLng(cafe.latitude, cafe.longitude),
        title: cafe.storeName,
        clickable: true,
      });
      const click = () => {
        maps.event.preventMap();
        layer.onSelect?.(cafe.bizesId);
      };
      layer.markers.set(cafe.bizesId, { marker, cafe, click });
      maps.event.addListener(marker, 'click', click);
      added.push(marker);
    }
    // 최대 200개를 일괄 반영한 뒤 한 번만 다시 그립니다. 동일 결과는 재등록하지 않습니다.
    if (removed.length) clusterer.removeMarkers(removed, true);
    if (added.length) clusterer.addMarkers(added, true);
    if (removed.length || added.length) clusterer.redraw();
  }, [context, items, selectCafe, status, scopeKey]);

  useEffect(() => {
    if (selected) layerRef.current?.open(selected.bizesId);
    else layerRef.current?.releaseSelection();
  }, [context, selected]);
}
