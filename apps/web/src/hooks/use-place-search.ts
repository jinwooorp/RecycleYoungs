import { useCallback, useEffect, useRef, useState } from 'react';
import type { KakaoMaps } from '@/lib/kakao-maps';
import {
  searchPlaces,
  type PlaceSearchPage,
  type PlaceSearchResult,
} from '@/lib/place-search';

export interface PlaceSelection {
  place: PlaceSearchResult;
  scope: number;
  revision: number;
}

/** 취소할 수 없는 Services 콜백은 요청 세대로 격리하고 지역 재선택 이전의 검색 위치를 숨깁니다. */
export function usePlaceSearch(
  maps: KakaoMaps | null,
  regionRevision: number,
  session: object | null = maps,
) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'closed' | 'results' | 'selection'>(
    'closed',
  );
  const [selection, setSelection] = useState<PlaceSelection | null>(null);
  const [response, setResponse] = useState<{
    session: object;
    term: string;
    status: 'loading' | 'ready' | 'error';
    data: PlaceSearchPage | null;
    error: string | null;
  } | null>(null);
  const generation = useRef(0);
  const alive = useRef(false);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      invalidate();
    };
  }, [maps, session, invalidate]);
  const changeQuery = useCallback((value: string) => {
    generation.current++;
    setQuery(value);
    setResponse(null);
    setView('closed');
  }, []);
  const submit = useCallback(() => {
    const term = query.trim();
    if (!term || !maps || !session) return;
    const request = ++generation.current;
    setView('results');
    setResponse({ session, term, status: 'loading', data: null, error: null });
    void searchPlaces(maps, term)
      .then((data) => {
        if (alive.current && request === generation.current)
          setResponse({ session, term, status: 'ready', data, error: null });
      })
      .catch((error: unknown) => {
        if (alive.current && request === generation.current)
          setResponse({
            session,
            term,
            status: 'error',
            data: null,
            error:
              error instanceof Error ? error.message : '검색에 실패했습니다.',
          });
      });
  }, [maps, query, session]);
  const selected = selection?.scope === regionRevision ? selection : null;
  const selectResult = useCallback(
    (place: PlaceSearchResult) => {
      setSelection((previous) => ({
        place,
        scope: regionRevision,
        revision: (previous?.revision ?? 0) + 1,
      }));
      setView('selection');
    },
    [regionRevision],
  );
  const close = useCallback(() => setView('closed'), []);
  const showSelection = useCallback(() => setView('selection'), []);
  const current = response?.session === session ? response : null;
  return {
    query,
    changeQuery,
    submit,
    view,
    selected,
    selectResult,
    close,
    showSelection,
    isOpen: view === 'results' || (view === 'selection' && selected !== null),
    status: current?.status ?? 'idle',
    data: current?.data ?? null,
    error: current?.error ?? null,
  };
}
export type PlaceSearchState = ReturnType<typeof usePlaceSearch>;
