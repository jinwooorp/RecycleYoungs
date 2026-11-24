import { useEffect, useState } from 'react';

export interface RequestResource<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  error: string | null;
  retry: () => void;
}

/** 요청 키가 바뀐 즉시 이전 자료를 숨기고, 취소를 무시하는 응답도 차단합니다. */
export function useRequest<T>(
  key: string | null,
  request: (signal: AbortSignal) => Promise<T>,
): RequestResource<T> {
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
