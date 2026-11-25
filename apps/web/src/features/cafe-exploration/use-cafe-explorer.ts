import { useCallback, useMemo, useState } from 'react';
import {
  CAFE_BATCH_SIZE,
  fetchViewportCafes,
  fetchNearbyCafes,
  type Cafe,
  type CafeCenter,
  type CafePage,
  type CafeRadius,
} from '@/entities/cafe/cafes';

import {
  normalizeDistrictCodes,
  type BoundaryExtent,
} from '@/entities/region/regions';
import { useRequest } from '@/shared/hooks/use-request';
import { useCafePagination } from './use-cafe-pagination';
import { useCenterAddress, type CenterPlace } from './use-center-address';
import type { KakaoMaps } from '@/shared/kakao/kakao-maps';

export type CafeMode = 'viewport' | 'nearby';

const noCafes: Cafe[] = [];

/** 패널과 독립적으로 조회하며, 지역 이동 전 좌표와 이전 요청 결과를 숨깁니다. */
export function useCafeExplorer(
  districtSelection: string | readonly string[],
  dongCode: string,
  regionLoading: boolean,
  maps: KakaoMaps | null = null,
  cameraKey = '',
) {
  const [mode, changeMode] = useState<CafeMode>('viewport');
  const [center, setCenter] = useState<CafeCenter | null>(null);
  const [centerPlace, setCenterPlace] = useState<CenterPlace | null>(null);
  const centerDetails = useCenterAddress(maps, center, centerPlace);
  const [radiusM, changeRadius] = useState<CafeRadius>(500);
  const districtKey =
    typeof districtSelection === 'string'
      ? districtSelection
      : normalizeDistrictCodes(districtSelection).join(',');
  const districts = useMemo(
    () => (districtKey ? districtKey.split(',') : []),
    [districtKey],
  );
  const mapDongCode = districts.length === 1 ? dongCode : '';
  const regionKey = `${districtKey}:${mapDongCode}:${cameraKey}`;
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
  const [listSelection, setListSelection] = useState<{
    first: CafePage;
    cafe: Cafe;
  } | null>(null);
  const onViewportChange = useCallback(
    (bounds: BoundaryExtent | null, level = 5) => {
      if (regionLoading && bounds) return;
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
    [regionKey, regionLoading],
  );
  // Kakao Maps는 레벨이 작을수록 확대됩니다. 구 미선택에서는 동네 규모로 확대한 뒤 조회합니다.
  const needsZoom = !districtKey && (!viewport || viewport.level > 4);
  const viewportQuery = useMemo(
    () =>
      viewport?.regionKey === regionKey && !regionLoading && !needsZoom
        ? { bounds: viewport.bounds, districts, dongCode: mapDongCode }
        : null,
    [viewport, regionKey, regionLoading, districts, mapDongCode, needsZoom],
  );
  const nearbyQuery = useMemo(
    () => (center ? { center, radiusM } : null),
    [center, radiusM],
  );
  const scopeKey =
    mode === 'viewport' ? regionKey : `nearby:${JSON.stringify(nearbyQuery)}`;
  const query = mode === 'viewport' ? viewportQuery : nearbyQuery;
  const queryKey = query ? `${mode}:${JSON.stringify(query)}` : null;
  const request = useCallback(
    (signal: AbortSignal, offset = 0) => {
      if (!query) throw new Error('카페 조회 조건이 없습니다.');
      const page = { limit: CAFE_BATCH_SIZE, offset };
      return 'bounds' in query
        ? fetchViewportCafes(
            query.bounds,
            query.districts,
            signal,
            query.dongCode,
            page,
          )
        : fetchNearbyCafes(query.center, query.radiusM, signal, page);
    },
    [query],
  );
  const resource = useRequest(queryKey, request);
  const pagination = useCafePagination(
    queryKey,
    resource.data,
    request,
    resource.retry,
  );
  const items = resource.status === 'ready' ? resource.data!.items : noCafes;
  const listOnlyCafe =
    listSelection?.first === resource.data &&
    pagination.items.includes(listSelection.cafe)
      ? listSelection.cafe
      : null;
  const selected =
    selection?.scopeKey === scopeKey &&
    (resource.status === 'loading' ||
      items.some((cafe) => cafe.bizesId === selection.bizesId))
      ? selection
      : null;
  const selectCafe = useCallback(
    (bizesId: string) => {
      setListSelection(null);
      setSelection((previous) => ({
        bizesId,
        scopeKey,
        revision: (previous?.revision ?? 0) + 1,
      }));
    },
    [scopeKey],
  );
  function selectListCafe(cafe: Cafe) {
    if (items.some(({ bizesId }) => bizesId === cafe.bizesId)) {
      selectCafe(cafe.bizesId);
    } else if (resource.data) {
      setSelection(null);
      setListSelection({ first: resource.data, cafe });
    }
  }
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
    pagination,
    listOnlyCafe,
    selectListCafe,
    selected,
    selectCafe,
    clearCafeSelection,
    onViewportChange,
    scopeKey,
  };
}

export type CafeExplorer = ReturnType<typeof useCafeExplorer>;

export type CafeMapExplorer = Omit<
  CafeExplorer,
  'pagination' | 'listOnlyCafe' | 'selectListCafe'
>;
