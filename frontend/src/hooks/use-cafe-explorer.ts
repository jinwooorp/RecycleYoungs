import { useCallback, useMemo, useState } from 'react';
import { fetchViewportCafes, type Cafe } from '@/lib/cafes';
import type { BoundaryExtent } from '@/lib/regions';
import { useRegionRequest } from './use-region-explorer';

const noCafes: Cafe[] = [];

/** 패널과 독립적으로 조회하며, 지역 이동 전 좌표와 이전 요청 결과를 숨깁니다. */
export function useCafeExplorer(
  districtCode: string,
  dongCode: string,
  regionLoading: boolean,
) {
  const regionKey = `${districtCode}:${dongCode}`;
  const [viewport, setViewport] = useState<{
    regionKey: string;
    bounds: BoundaryExtent;
    level: number;
  } | null>(null);
  const [selection, setSelection] = useState<{
    bizesId: string;
    scopeKey: string;
    revision: number;
  } | null>(null);
  const onViewportChange = useCallback(
    (bounds: BoundaryExtent | null, level = 5) => {
      setViewport((current) => {
        if (!bounds) return null;
        if (
          current?.regionKey === regionKey &&
          current.level === level &&
          JSON.stringify(current.bounds) === JSON.stringify(bounds)
        )
          return current;
        return { regionKey, bounds, level };
      });
    },
    [regionKey],
  );
  // Kakao Maps는 레벨이 작을수록 확대됩니다. 구 미선택에서는 동네 규모로 확대한 뒤 조회합니다.
  const needsZoom = !districtCode && (!viewport || viewport.level > 4);
  const query = useMemo(
    () =>
      viewport?.regionKey === regionKey && !regionLoading && !needsZoom
        ? { bounds: viewport.bounds, districtCode, dongCode }
        : null,
    [viewport, regionKey, regionLoading, districtCode, dongCode, needsZoom],
  );
  const request = useCallback(
    (signal: AbortSignal) =>
      fetchViewportCafes(
        query!.bounds,
        query!.districtCode,
        signal,
        query!.dongCode,
      ),
    [query],
  );
  const resource = useRegionRequest(
    query ? JSON.stringify(query) : null,
    request,
  );
  const items = resource.status === 'ready' ? resource.data!.items : noCafes;
  const selected =
    selection?.scopeKey === regionKey &&
    (resource.status === 'loading' ||
      items.some((cafe) => cafe.bizesId === selection.bizesId))
      ? selection
      : null;
  const selectCafe = useCallback(
    (bizesId: string) => {
      setSelection((previous) => ({
        bizesId,
        scopeKey: regionKey,
        revision: (previous?.revision ?? 0) + 1,
      }));
    },
    [regionKey],
  );
  return {
    ...resource,
    needsZoom,
    items,
    selected,
    selectCafe,
    onViewportChange,
    scopeKey: regionKey,
  };
}

export type CafeExplorer = ReturnType<typeof useCafeExplorer>;
