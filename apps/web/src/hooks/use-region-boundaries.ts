import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchBoundary, type RegionBoundary } from '@/lib/regions';

type BoundaryKey = `${'district' | 'dong'}:${string}`;
type Outcome =
  { data: RegionBoundary; error?: never } | { data?: never; error: string };

/** 선택 범위에 남은 요청과 성공한 경계는 탐색 화면 수명 동안 재사용합니다. */
export function useRegionBoundaries(keys: readonly BoundaryKey[]) {
  const pending = useRef(new Map<BoundaryKey, AbortController>());
  const settled = useRef(new Map<BoundaryKey, Outcome>());
  const [outcomes, setOutcomes] = useState<ReadonlyMap<BoundaryKey, Outcome>>(
    () => new Map(),
  );
  const request = useCallback((key: BoundaryKey) => {
    if (pending.current.has(key) || settled.current.has(key)) return;
    const controller = new AbortController();
    pending.current.set(key, controller);
    const [kind, code] = key.split(':') as ['district' | 'dong', string];
    const finish = (outcome: Outcome) => {
      if (controller.signal.aborted || pending.current.get(key) !== controller)
        return;
      pending.current.delete(key);
      settled.current.set(key, outcome);
      setOutcomes(new Map(settled.current));
    };
    void fetchBoundary(kind, code, controller.signal).then(
      (data) => finish({ data }),
      (error: unknown) =>
        finish({
          error:
            error instanceof Error
              ? error.message
              : '선택 지역의 경계를 불러오지 못했습니다.',
        }),
    );
  }, []);

  useEffect(() => {
    const requested = pending.current;
    return () => {
      for (const controller of requested.values()) controller.abort();
      requested.clear();
    };
  }, []);
  useEffect(() => {
    for (const [key, controller] of pending.current) {
      if (!keys.includes(key)) {
        controller.abort();
        pending.current.delete(key);
      }
    }
    for (const key of keys) request(key);
  }, [keys, request]);

  const retry = useCallback(
    (key: BoundaryKey) => {
      if (!keys.includes(key) || !settled.current.get(key)?.error) return;
      settled.current.delete(key);
      setOutcomes(new Map(settled.current));
      request(key);
    },
    [keys, request],
  );
  return useMemo(
    () =>
      keys.map((key) => {
        const result = outcomes.get(key);
        return {
          key,
          data: result?.data ?? null,
          error: result?.error ?? null,
          loading: result === undefined,
          retry: () => retry(key),
        };
      }),
    [keys, outcomes, retry],
  );
}
