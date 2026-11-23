import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  combineBoundaryExtents,
  fetchContainingRegions,
  fetchDistricts,
  fetchDongs,
  normalizeDistrictCodes,
  type RegionBoundary,
  type RegionMapTarget,
} from '@/lib/regions';
import type { CafeCenter } from '@/lib/cafes';
import { useRegionBoundaries } from './use-region-boundaries';

export interface RegionResource<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  error: string | null;
  retry: () => void;
}

/** 요청 키가 바뀐 즉시 이전 자료를 숨기고, 취소를 무시하는 응답도 차단합니다. */
export function useRegionRequest<T>(
  key: string | null,
  request: (signal: AbortSignal) => Promise<T>,
): RegionResource<T> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    error: string | null;
  } | null>(null);
  const requestKey = key === null ? null : `${key}:${attempt}`;
  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    let active = true;
    void request(controller.signal)
      .then((data) => {
        if (active) setResult({ key: requestKey, data, error: null });
      })
      .catch((error: unknown) => {
        if (active)
          setResult({
            key: requestKey,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : '지역 데이터를 불러오지 못했습니다.',
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [requestKey, request]);
  const retry = () => setAttempt((value) => value + 1);
  if (requestKey === null)
    return { status: 'idle', data: null, error: null, retry };
  if (result?.key !== requestKey)
    return { status: 'loading', data: null, error: null, retry };
  return {
    status: result.error ? 'error' : 'ready',
    data: result.data,
    error: result.error,
    retry,
  };
}

/** 지도 필터, 단일 통계 대상, 검색 위치의 수명을 패널과 독립적으로 관리합니다. */
export function useRegionExplorer() {
  const [selection, setSelection] = useState({
    districtCodes: [] as string[],
    dongCode: '',
    analysisDistrictCode: '',
    analysisDongCode: '',
    usePlaceAnalysis: false,
    revision: 0,
    place: null as CafeCenter | null,
    placeRevision: 0,
  });
  const {
    districtCodes,
    dongCode,
    place,
    placeRevision,
    analysisDistrictCode,
  } = selection;
  const districtCode = districtCodes.length === 1 ? districtCodes[0] : '';
  const districts = useRegionRequest('districts', fetchDistricts);
  const dongs = useRegionRequest(
    districtCode || null,
    useCallback((signal) => fetchDongs(districtCode, signal), [districtCode]),
  );
  const separateDongs = useRegionRequest(
    analysisDistrictCode !== districtCode && !selection.usePlaceAnalysis
      ? analysisDistrictCode || null
      : null,
    useCallback(
      (signal) => fetchDongs(analysisDistrictCode, signal),
      [analysisDistrictCode],
    ),
  );
  const analysisDongs =
    analysisDistrictCode === districtCode ? dongs : separateDongs;
  const boundaryKeys = useMemo(
    () =>
      dongCode
        ? [`dong:${dongCode}` as const]
        : districtCodes.map((code) => `district:${code}` as const),
    [districtCodes, dongCode],
  );
  const boundaries = useRegionBoundaries(boundaryKeys);
  const overlays = useMemo(
    () =>
      boundaries.flatMap(({ key, data }) =>
        data ? [{ key, geometry: data.geometry }] : [],
      ),
    [boundaries],
  );
  const boundary: RegionResource<RegionBoundary> = {
    status: !boundaries.length
      ? 'idle'
      : boundaries.some((entry) => entry.loading)
        ? 'loading'
        : boundaries.some((entry) => entry.error)
          ? 'error'
          : 'ready',
    data: boundaries.length === 1 ? boundaries[0].data : null,
    error: boundaries.find((entry) => entry.error)?.error ?? null,
    retry: () => boundaries.forEach((entry) => entry.retry()),
  };

  const placeRegion = useRegionRequest(
    place ? String(placeRevision) : null,
    useCallback(
      (signal) =>
        fetchContainingRegions(place!.longitude, place!.latitude, signal),
      [place],
    ),
  );
  const containingDistricts = placeRegion.data?.districts ?? [];
  const containingDongs = placeRegion.data?.dongs ?? [];
  const placeDistrict =
    containingDistricts.length === 1 ? containingDistricts[0] : null;
  const placeDong =
    containingDongs.length === 1 &&
    containingDongs[0].districtCode === placeDistrict?.districtCode
      ? containingDongs[0]
      : null;
  const fromSearch = selection.usePlaceAnalysis && !!place;
  const analysis = {
    fromSearch,
    districtCode: fromSearch
      ? (placeDistrict?.districtCode ?? '')
      : analysisDistrictCode,
    dongCode: fromSearch
      ? (placeDong?.dongCode ?? '')
      : selection.analysisDongCode,
    districtName: fromSearch
      ? placeDistrict?.districtName
      : districts.data?.find(
          (item) => item.districtCode === analysisDistrictCode,
        )?.districtName,
    dongName: fromSearch
      ? placeDong?.dongName
      : analysisDongs.data?.find(
          (item) => item.dongCode === selection.analysisDongCode,
        )?.dongName,
  };
  const searchOutsideFilter =
    !!place &&
    !!districtCodes.length &&
    !!containingDistricts.length &&
    !containingDistricts.some((item) =>
      districtCodes.includes(item.districtCode),
    );

  const target = useMemo<RegionMapTarget | null>(() => {
    if (place) return null;
    if (!boundaries.length) return { kind: 'default' };
    if (boundaries.some((entry) => !entry.data)) return null;
    const ready = boundaries.map((entry) => entry.data!);
    return ready.length === 1
      ? { kind: 'boundary', ...ready[0] }
      : { kind: 'bounds', extent: combineBoundaryExtents(ready) };
  }, [place, boundaries]);

  function selectPlace(center: CafeCenter) {
    setSelection((current) => ({
      ...current,
      place: center,
      usePlaceAnalysis: true,
      placeRevision: current.placeRevision + 1,
    }));
  }
  function applyDistricts(values: readonly string[]) {
    const next = normalizeDistrictCodes(values);
    if (
      next.some(
        (value) => !districts.data?.some((item) => item.districtCode === value),
      )
    )
      return false;
    if (
      next.length === districtCodes.length &&
      next.every((value, index) => value === districtCodes[index])
    )
      return false;
    setSelection((current) => {
      // 단일 구의 분석 대상은 자동 지정입니다. 다중 구끼리 바뀔 때만 명시 선택을 보존합니다.
      const keepAnalysis =
        current.districtCodes.length > 1 &&
        next.length > 1 &&
        next.includes(current.analysisDistrictCode);
      return {
        ...current,
        districtCodes: next,
        dongCode: '',
        analysisDistrictCode:
          next.length === 1
            ? next[0]
            : keepAnalysis
              ? current.analysisDistrictCode
              : '',
        analysisDongCode: keepAnalysis ? current.analysisDongCode : '',
        place: null,
        usePlaceAnalysis: false,
        revision: current.revision + 1,
      };
    });
    return true;
  }
  function selectDong(value: string) {
    if (
      !districtCode ||
      (value === dongCode && !place) ||
      (value && !dongs.data?.some((item) => item.dongCode === value))
    )
      return false;
    setSelection((current) => ({
      ...current,
      dongCode: value,
      analysisDistrictCode: districtCode,
      analysisDongCode: value,
      usePlaceAnalysis: false,
      place: null,
      revision: current.revision + 1,
    }));
    return true;
  }
  function selectAnalysisDistrict(value: string) {
    if (value && !districtCodes.includes(value)) return;
    setSelection((current) => ({
      ...current,
      usePlaceAnalysis: false,
      analysisDistrictCode: value,
      analysisDongCode: '',
    }));
  }
  function selectAnalysisDong(value: string) {
    if (
      !analysisDistrictCode ||
      (value && !analysisDongs.data?.some((item) => item.dongCode === value))
    )
      return;
    setSelection((current) => ({
      ...current,
      usePlaceAnalysis: false,
      analysisDongCode: value,
    }));
  }
  function analyzePlace() {
    setSelection((current) =>
      current.place ? { ...current, usePlaceAnalysis: true } : current,
    );
  }

  return {
    districtCode,
    districtCodes,
    dongCode,
    revision: selection.revision,
    cameraKey: `${selection.revision}:${placeRevision}`,
    districts,
    dongs,
    analysisDongs,
    boundary,
    boundaries,
    overlays,
    analysis,
    placeRegion,
    searchOutsideFilter,
    target,
    selectPlace,
    applyDistricts,
    selectDong,
    selectAnalysisDistrict,
    selectAnalysisDong,
    analyzePlace,
  };
}

export type RegionExplorer = ReturnType<typeof useRegionExplorer>;
