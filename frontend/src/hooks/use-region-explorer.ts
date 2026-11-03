import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchBoundary,
  fetchDistricts,
  fetchDongs,
  type RegionMapTarget,
} from '@/lib/regions';

export interface RegionResource<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  error: string | null;
  retry: () => void;
}

/** 요청 키가 바뀐 즉시 이전 자료를 숨기고, 취소를 무시하는 응답도 차단합니다. */
function useRegionRequest<T>(
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
  });
  const { districtCode, dongCode } = selection;
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
  const target = useMemo<RegionMapTarget | null>(() => {
    if (!districtCode) return { kind: 'default' };
    return boundary.status === 'ready' && boundary.data
      ? { kind: 'boundary', extent: boundary.data }
      : null;
  }, [districtCode, boundary.status, boundary.data]);
  function selectDistrict(value: string) {
    if (value && !districts.data?.some((item) => item.districtCode === value))
      return;
    setSelection({ districtCode: value, dongCode: '' });
  }
  function selectDong(value: string) {
    if (value && !dongs.data?.some((item) => item.dongCode === value)) return;
    setSelection((current) => ({ ...current, dongCode: value }));
  }
  return {
    districtCode,
    dongCode,
    districts,
    dongs,
    boundary,
    target,
    selectDistrict,
    selectDong,
  };
}

export type RegionExplorer = ReturnType<typeof useRegionExplorer>;
