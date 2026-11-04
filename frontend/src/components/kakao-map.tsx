import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CircleAlert,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  loadKakaoMaps,
  type KakaoMap,
  type KakaoPolygon,
  type KakaoMapContext,
} from '@/lib/kakao-maps';
import type { BoundaryGeometry, RegionMapTarget } from '@/lib/regions';
import type { CafeExplorer } from '@/hooks/use-cafe-explorer';
import { useCafeMap } from '@/hooks/use-cafe-map';
import type { PlaceSelection } from '@/hooks/use-place-search';
import type { CafeCenter } from '@/lib/cafes';

type MapStatus = 'loading' | 'ready' | 'error';
export interface MapConnection {
  status: MapStatus;
  context: KakaoMapContext | null;
  retry: () => void;
  focusLocation?: (center: CafeCenter, target: RegionMapTarget | null) => void;
}

/** SDK 수명은 로더가, 지도 인스턴스와 화면 이벤트는 이 컴포넌트가 관리합니다. */
export function KakaoMapView({
  target,
  cafes,
  centerPicking = false,
  connectionChanged,
  searchSelection,
  onSearchMarkerClick,
}: {
  target?: RegionMapTarget | null;
  cafes?: CafeExplorer;
  centerPicking?: boolean;
  connectionChanged?: (connection: MapConnection) => void;
  searchSelection?: PlaceSelection | null;
  onSearchMarkerClick?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const moveRef = useRef<
    ((next: RegionMapTarget | null, location?: CafeCenter) => void) | null
  >(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [context, setContext] = useState<KakaoMapContext | null>(null);
  const movingRef = useRef(false);
  const viewportChangedRef = useRef<(() => void) | null>(null);
  const [level, setLevel] = useState(5);
  const appKey = import.meta.env.VITE_KAKAO_MAP_APP_KEY?.trim() ?? '';
  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    connectionChanged?.({
      status,
      context: status === 'ready' ? context : null,
      retry,
      focusLocation: (center, target) => moveRef.current?.(target, center),
    });
  }, [status, context, retry, connectionChanged]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let release: (() => void) | undefined;
    const fail = () => {
      if (disposed) return;
      release?.();
      release = undefined;
      mapRef.current = null;
      moveRef.current = null;
      setContext(null);
      container.replaceChildren();
      setStatus('error');
    };

    void loadKakaoMaps(appKey)
      .then((maps) => {
        // StrictMode의 첫 effect나 언마운트된 화면에서는 지도를 만들지 않습니다.
        if (disposed) return;
        const map = new maps.Map(container, {
          center: new maps.LatLng(37.5665, 126.978),
          level: 5,
        });
        mapRef.current = map;
        let center = map.getCenter();
        let width = container.clientWidth;
        let height = container.clientHeight;
        let restoringCenter = false;
        let fitFrame: number | null = null;
        let polygons: KakaoPolygon[] = [];
        let geometry: BoundaryGeometry | null = null;
        const clearBoundary = () => {
          polygons.forEach((polygon) => polygon.setMap(null));
          polygons = [];
          geometry = null;
        };
        moveRef.current = (next, location) => {
          if (fitFrame !== null) cancelAnimationFrame(fitFrame);
          fitFrame = null;
          movingRef.current = !!next || !!location;
          const nextGeometry = next?.kind === 'boundary' ? next.geometry : null;
          if (nextGeometry !== geometry) {
            // 조회 중·실패 상태에서도 이전 지역의 강조를 즉시 제거합니다.
            clearBoundary();
            if (nextGeometry) {
              const areas =
                nextGeometry.type === 'Polygon'
                  ? [nextGeometry.coordinates]
                  : nextGeometry.coordinates;
              try {
                for (const rings of areas) {
                  const polygon = new maps.Polygon({
                    // 링을 합치지 않아 외부 경계와 내부 구멍의 관계를 유지합니다.
                    path: rings.map((ring) =>
                      ring.map(
                        ([longitude, latitude]) =>
                          new maps.LatLng(latitude, longitude),
                      ),
                    ),
                    strokeWeight: 3,
                    strokeColor: '#23513F',
                    strokeOpacity: 0.9,
                    strokeStyle: 'solid',
                    fillColor: '#23513F',
                    fillOpacity: 0.12,
                  });
                  polygons.push(polygon);
                  polygon.setMap(map);
                }
                geometry = nextGeometry;
              } catch {
                // 일부 영역 생성 후 SDK가 실패해도 오버레이와 지도 자원을 함께 정리합니다.
                fail();
                return;
              }
            }
          }
          if (!next && !location) return;
          let previousWidth = container.clientWidth;
          let previousHeight = container.clientHeight;
          let stableFrames = 0;
          // 패널 전환 중의 임시 너비에 맞추지 않고, 두 프레임 연속 안정된 크기를 사용합니다.
          const fit = () => {
            if (
              container.clientWidth === previousWidth &&
              container.clientHeight === previousHeight
            )
              stableFrames++;
            else {
              previousWidth = container.clientWidth;
              previousHeight = container.clientHeight;
              stableFrames = 0;
            }
            if (stableFrames < 2) {
              fitFrame = requestAnimationFrame(fit);
              return;
            }
            fitFrame = null;
            if (location) {
              map.setLevel(3);
              map.setCenter(
                new maps.LatLng(location.latitude, location.longitude),
              );
            } else if (next?.kind === 'default') {
              map.setLevel(5);
              map.setCenter(new maps.LatLng(37.5665, 126.978));
            } else if (next?.kind === 'boundary') {
              const { west, south, east, north } = next.extent;
              map.setBounds(
                new maps.LatLngBounds(
                  new maps.LatLng(south, west),
                  new maps.LatLng(north, east),
                ),
                96,
                32,
                48,
                32,
              );
            }
            // 크기 변경 알림 전 지도 이동이 끝난 경우에도 새 중심을 보존합니다.
            center = map.getCenter();
            onZoom();
            movingRef.current = false;
            viewportChangedRef.current?.();
          };
          fitFrame = requestAnimationFrame(fit);
        };
        const onCenterChanged = () => {
          // SDK는 크기가 바뀐 직후 중심을 재계산할 수 있어 사용자 탐색과 구분합니다.
          if (
            !restoringCenter &&
            width === container.clientWidth &&
            height === container.clientHeight
          ) {
            center = map.getCenter();
          }
        };
        const onZoom = () => setLevel(map.getLevel());
        const onResize = () => {
          // 복원 중 발생하는 center_changed는 사용자 이동이 아니며 반올림을 누적하지 않습니다.
          restoringCenter = true;
          try {
            map.relayout();
            map.setCenter(center);
          } finally {
            restoringCenter = false;
          }
          width = container.clientWidth;
          height = container.clientHeight;
          viewportChangedRef.current?.();
        };
        const observer = new ResizeObserver(onResize);
        // 리스너 등록 중 실패해도 이미 연결된 자원을 정리할 수 있도록 먼저 설정합니다.
        release = () => {
          observer.disconnect();
          if (fitFrame !== null) cancelAnimationFrame(fitFrame);
          movingRef.current = false;
          clearBoundary();
          maps.event.removeListener(map, 'zoom_changed', onZoom);
          maps.event.removeListener(map, 'center_changed', onCenterChanged);
        };
        maps.event.addListener(map, 'zoom_changed', onZoom);
        maps.event.addListener(map, 'center_changed', onCenterChanged);
        observer.observe(container);
        onZoom();
        // 이미 ready인 지도도 재초기화되면 현재 선택을 새 인스턴스에 적용합니다.
        setContext({ map, maps });
        setStatus('ready');
      })
      .catch(fail);

    return () => {
      disposed = true;
      release?.();
      mapRef.current = null;
      moveRef.current = null;
      setContext(null);
      container.replaceChildren();
    };
  }, [appKey, attempt]);

  useEffect(() => {
    if (status === 'ready')
      moveRef.current?.(target ?? null, searchSelection?.place);
  }, [status, target, context, searchSelection]);

  const searchIsRadiusCenter =
    cafes?.mode === 'nearby' &&
    cafes.center?.latitude === searchSelection?.place.latitude &&
    cafes.center?.longitude === searchSelection?.place.longitude;
  useEffect(() => {
    if (
      status !== 'ready' ||
      !context ||
      !searchSelection ||
      searchIsRadiusCenter
    )
      return;
    const { map, maps } = context;
    const place = searchSelection.place;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 39C12 32 1 25 1 16a15 15 0 1 1 30 0c0 9-11 16-15 23Z" fill="#B45309" stroke="white" stroke-width="2"/><circle cx="14" cy="14" r="6" fill="none" stroke="white" stroke-width="2"/><path d="m19 19 6 6" stroke="white" stroke-width="3"/></svg>';
    const marker = new maps.Marker({
      position: new maps.LatLng(place.latitude, place.longitude),
      title: `검색 위치: ${place.name}`,
      clickable: true,
      zIndex: 4,
      image: new maps.MarkerImage(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        new maps.Size(32, 40),
        { offset: new maps.Point(16, 40) },
      ),
    });
    const click = () => {
      maps.event.preventMap();
      onSearchMarkerClick?.();
    };
    maps.event.addListener(marker, 'click', click);
    marker.setMap(map);
    return () => {
      maps.event.removeListener(marker, 'click', click);
      marker.setMap(null);
    };
  }, [
    status,
    context,
    searchSelection,
    searchIsRadiusCenter,
    onSearchMarkerClick,
  ]);

  useCafeMap(
    status === 'ready' ? context : null,
    movingRef,
    viewportChangedRef,
    target,
    cafes,
    centerPicking,
  );

  function zoom(delta: number) {
    const map = mapRef.current;
    if (map) map.setLevel(Math.max(1, Math.min(14, map.getLevel() + delta)));
  }

  return (
    <section
      aria-label="서울 상권 지도"
      className="explore-map relative order-1 min-h-0 min-w-0 flex-1 overflow-hidden bg-muted md:order-0"
    >
      <div
        ref={containerRef}
        aria-label="Kakao Maps 지도"
        aria-busy={status === 'loading'}
        className="absolute inset-0"
      />
      {status !== 'ready' && (
        <div className="explore-map-notice absolute inset-x-0 top-24 bottom-0 z-10 flex overflow-y-auto px-4 pb-4">
          {status === 'loading' ? (
            <div
              role="status"
              className="m-auto flex shrink-0 flex-col items-center gap-3 text-muted-foreground"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-7 motion-safe:animate-spin"
              />
              <p className="text-sm">서울 지도를 불러오고 있습니다</p>
            </div>
          ) : (
            <div
              role="alert"
              className="m-auto flex w-full max-w-sm shrink-0 flex-col items-center gap-4 rounded-2xl border bg-background p-6 text-center shadow-sm"
            >
              <CircleAlert
                aria-hidden="true"
                className="size-8 text-muted-foreground"
              />
              <div className="flex flex-col gap-2">
                <h2 className="font-semibold">
                  {appKey
                    ? '지도를 불러오지 못했습니다'
                    : '지도 설정이 필요합니다'}
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  {appKey
                    ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요. 문제가 계속되면 지도 키와 등록 도메인을 확인해 주세요.'
                    : 'Kakao JavaScript 키를 설정하면 서울 지도를 탐색할 수 있습니다. 개발 환경 설정 안내를 확인해 주세요.'}
                </p>
              </div>
              {appKey && (
                <Button variant="outline" size="lg" onClick={retry}>
                  <RefreshCw aria-hidden="true" data-icon="inline-start" />
                  다시 시도
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <div
        role="group"
        aria-label="지도 확대·축소"
        className="explore-map-controls absolute z-10 flex flex-col bg-background"
      >
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="지도 확대"
          disabled={status !== 'ready' || level <= 1}
          onClick={() => zoom(-1)}
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="지도 축소"
          disabled={status !== 'ready' || level >= 14}
          onClick={() => zoom(1)}
        >
          <Minus aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
