import { useEffect, useRef, useState } from 'react';
import {
  CircleAlert,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadKakaoMaps, type KakaoMap } from '@/lib/kakao-maps';

type MapStatus = 'loading' | 'ready' | 'error';

/** SDK 수명은 로더가, 지도 인스턴스와 화면 이벤트는 이 컴포넌트가 관리합니다. */
export function KakaoMapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [level, setLevel] = useState(5);
  const appKey = import.meta.env.VITE_KAKAO_MAP_APP_KEY?.trim() ?? '';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let release: (() => void) | undefined;

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
        const onCenterChanged = () => {
          // SDK는 크기가 바뀐 직후 중심을 재계산할 수 있어 사용자 탐색과 구분합니다.
          if (
            width === container.clientWidth &&
            height === container.clientHeight
          ) {
            center = map.getCenter();
          }
        };
        const onZoom = () => setLevel(map.getLevel());
        const onResize = () => {
          map.relayout();
          map.setCenter(center);
          width = container.clientWidth;
          height = container.clientHeight;
        };
        const observer = new ResizeObserver(onResize);
        // 리스너 등록 중 실패해도 이미 연결된 자원을 정리할 수 있도록 먼저 설정합니다.
        release = () => {
          observer.disconnect();
          maps.event.removeListener(map, 'zoom_changed', onZoom);
          maps.event.removeListener(map, 'center_changed', onCenterChanged);
        };
        maps.event.addListener(map, 'zoom_changed', onZoom);
        maps.event.addListener(map, 'center_changed', onCenterChanged);
        observer.observe(container);
        onZoom();
        setStatus('ready');
      })
      .catch(() => {
        if (disposed) return;
        release?.();
        release = undefined;
        mapRef.current = null;
        container.replaceChildren();
        setStatus('error');
      });

    return () => {
      disposed = true;
      release?.();
      mapRef.current = null;
      container.replaceChildren();
    };
  }, [appKey, attempt]);

  function retry() {
    setStatus('loading');
    setAttempt((value) => value + 1);
  }
  function zoom(delta: number) {
    const map = mapRef.current;
    if (map) map.setLevel(Math.max(1, Math.min(14, map.getLevel() + delta)));
  }

  return (
    <section
      aria-label="서울 상권 지도"
      className="relative order-1 min-h-0 min-w-0 flex-1 overflow-hidden bg-muted md:order-0"
    >
      <div
        ref={containerRef}
        aria-label="Kakao Maps 지도"
        aria-busy={status === 'loading'}
        className="absolute inset-0"
      />
      {status !== 'ready' && (
        <div className="absolute inset-x-0 top-24 bottom-0 z-10 flex overflow-y-auto px-4 pb-4">
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
        className="absolute right-4 bottom-8 z-10 flex flex-col gap-1 rounded-xl border bg-background p-1 shadow-sm"
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
