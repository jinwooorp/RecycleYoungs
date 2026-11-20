import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchBoundary,
  fetchContainingRegions,
  fetchDistricts,
  fetchDongs,
  type RegionMapTarget,
} from '@/lib/regions';
import type { CafeCenter } from '@/lib/cafes';

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

/** 패널 수명과 독립적으로 선택 지역·목록·지도 이동 대상을 관리합니다. */
export function useRegionExplorer() {
  const [selection, setSelection] = useState({
    districtCode: '',
    dongCode: '',
    revision: 0,
    place: null as CafeCenter | null,
    placeRevision: 0,
  });
  const { districtCode, dongCode, place, placeRevision } = selection;
  const districts = useRegionRequest('districts', fetchDistricts);
  const dongs = useRegionRequest(
    districtCode || null,
    useCallback((signal) => fetchDongs(districtCode, signal), [districtCode]),
  );
  const kind = dongCode ? 'dong' : 'district';
  const code = dongCode || districtCode;
  const boundary = useRegionRequest(
    code ? `${kind}:${code}` : null,
    useCallback((signal) => fetchBoundary(kind, code, signal), [kind, code]),
  );
  // 검색 좌표를 서버 경계로 확인합니다. 주소 문자열이나 이전 필터로 소속을 추정하지 않습니다.
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
  const analysis = {
    districtCode: place ? (placeDistrict?.districtCode ?? '') : districtCode,
    dongCode: place ? (placeDong?.dongCode ?? '') : dongCode,
    districtName:
      placeDistrict?.districtName ??
      districts.data?.find((item) => item.districtCode === districtCode)
        ?.districtName,
    dongName:
      placeDong?.dongName ??
      dongs.data?.find((item) => item.dongCode === dongCode)?.dongName,
  };
  const target = useMemo<RegionMapTarget | null>(() => {
    if (place) return null;
    if (!districtCode) return { kind: 'default' };
    return boundary.status === 'ready' && boundary.data
      ? { kind: 'boundary', ...boundary.data }
      : null;
  }, [place, districtCode, boundary.status, boundary.data]);
  function selectPlace(center: CafeCenter) {
    setSelection((current) => ({
      ...current,
      districtCode: '',
      dongCode: '',
      place: center,
      placeRevision: current.placeRevision + 1,
    }));
  }
  function selectDistrict(value: string) {
    if (value && !districts.data?.some((item) => item.districtCode === value))
      return;
    setSelection((current) => ({
      ...current,
      districtCode: value,
      dongCode: '',
      place: null,
      revision: current.revision + 1,
    }));
  }
  function selectDong(value: string) {
    if (value && !dongs.data?.some((item) => item.dongCode === value)) return;
    setSelection((current) => ({
      ...current,
      dongCode: value,
      place: null,
      revision: current.revision + 1,
    }));
  }
  return {
    districtCode,
    dongCode,
    revision: selection.revision,
    cameraKey: `${selection.revision}:${placeRevision}`,
    districts,
    dongs,
    boundary,
    analysis,
    placeRegion,
    target,
    selectPlace,
    selectDistrict,
    selectDong,
  };
}

export type RegionExplorer = ReturnType<typeof useRegionExplorer>;
