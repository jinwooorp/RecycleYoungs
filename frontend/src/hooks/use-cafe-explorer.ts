import { useCallback, useMemo, useState } from 'react';
import {
  fetchViewportCafes,
  fetchNearbyCafes,
  type Cafe,
  type CafeCenter,
  type CafeRadius,
} from '@/lib/cafes';

import type { BoundaryExtent } from '@/lib/regions';
import { useRegionRequest } from './use-region-explorer';
import { useCenterAddress, type CenterPlace } from './use-center-address';
import type { KakaoMaps } from '@/lib/kakao-maps';

export type CafeMode = 'viewport' | 'nearby';

const noCafes: Cafe[] = [];

/** 패널과 독립적으로 조회하며, 지역 이동 전 좌표와 이전 요청 결과를 숨깁니다. */
export function useCafeExplorer(
  districtCode: string,
  dongCode: string,
  regionLoading: boolean,
  maps: KakaoMaps | null = null,
) {
  const [mode, changeMode] = useState<CafeMode>('viewport');
  const [center, setCenter] = useState<CafeCenter | null>(null);
  const [centerPlace, setCenterPlace] = useState<CenterPlace | null>(null);
  const centerDetails = useCenterAddress(maps, center, centerPlace);
  const [radiusM, changeRadius] = useState<CafeRadius>(500);
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
  const viewportQuery = useMemo(
    () =>
      viewport?.regionKey === regionKey && !regionLoading && !needsZoom
        ? { bounds: viewport.bounds, districtCode, dongCode }
        : null,
    [viewport, regionKey, regionLoading, districtCode, dongCode, needsZoom],
  );
  const nearbyQuery = useMemo(
    () => (center ? { center, radiusM } : null),
    [center, radiusM],
  );
  const scopeKey =
    mode === 'viewport' ? regionKey : `nearby:${JSON.stringify(nearbyQuery)}`;
  const query = mode === 'viewport' ? viewportQuery : nearbyQuery;
  const request = useCallback(
    (signal: AbortSignal) => {
      if (!query) throw new Error('카페 조회 조건이 없습니다.');
      return 'bounds' in query
        ? fetchViewportCafes(
            query.bounds,
            query.districtCode,
            signal,
            query.dongCode,
          )
        : fetchNearbyCafes(query.center, query.radiusM, signal);
    },
    [query],
  );
  const resource = useRegionRequest(
    query ? `${mode}:${JSON.stringify(query)}` : null,
    request,
  );
  const items = resource.status === 'ready' ? resource.data!.items : noCafes;
  const selected =
    selection?.scopeKey === scopeKey &&
    (resource.status === 'loading' ||
      items.some((cafe) => cafe.bizesId === selection.bizesId))
      ? selection
      : null;
  const selectCafe = useCallback(
    (bizesId: string) => {
      setSelection((previous) => ({
        bizesId,
        scopeKey,
        revision: (previous?.revision ?? 0) + 1,
      }));
    },
    [scopeKey],
  );
  const setMode = useCallback((next: CafeMode) => {
    changeMode(next);
    setSelection(null);
  }, []);
  const clearCafeSelection = useCallback(() => setSelection(null), []);
  const setRadiusM = useCallback((next: CafeRadius) => {
    changeRadius(next);
    setSelection(null);
  }, []);
  const selectCenter = useCallback(
    (next: CafeCenter, place?: CenterPlace) => {
      if (
        !Number.isFinite(next.longitude) ||
        !Number.isFinite(next.latitude) ||
        Math.abs(next.longitude) > 180 ||
        Math.abs(next.latitude) > 90
      )
        return;
      if (
        center?.longitude !== next.longitude ||
        center.latitude !== next.latitude
      ) {
        // 표시 정보를 섞지 않고 기존 좌표만 API 조회 키에 사용합니다.
        setCenter({ longitude: next.longitude, latitude: next.latitude });
        setSelection(null);
      }
      setCenterPlace(
        place
          ? { name: place.name.trim(), address: place.address.trim() }
          : null,
      );
    },
    [center],
  );
  const clearCenter = useCallback(() => {
    setCenter(null);
    setCenterPlace(null);
    setSelection(null);
  }, []);
  return {
    ...resource,
    needsZoom: mode === 'viewport' && needsZoom,
    mode,
    setMode,
    center,
    centerDetails,
    selectCenter,
    clearCenter,
    radiusM,
    setRadiusM,
    items,
    selected,
    selectCafe,
    clearCafeSelection,
    onViewportChange,
    scopeKey,
  };
}

export type CafeExplorer = ReturnType<typeof useCafeExplorer>;
