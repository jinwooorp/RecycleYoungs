import { useEffect, useRef } from 'react';
import { LoaderCircle, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlaceSearchState } from '@/hooks/use-place-search';
import type { PlaceSearchResult } from '@/lib/place-search';
import type { MapConnection } from './kakao-map';

/** 검색창은 패널 너비와 독립적이며, 검색 결과와 선택 위치의 안내를 구분합니다. */
export function PlaceSearch({
  search,
  connection,
  panelOpen,
  regionFiltered,
  onNearby,
}: {
  search: PlaceSearchState;
  connection: MapConnection | null;
  panelOpen: boolean;
  regionFiltered: boolean;
  onNearby: (place: PlaceSearchResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nearbyRef = useRef<HTMLButtonElement>(null);
  const ready = connection?.status === 'ready';
  useEffect(() => {
    if (search.isOpen && search.view === 'selection')
      nearbyRef.current?.focus();
  }, [search.isOpen, search.view, search.selected]);
  function close() {
    search.close();
    inputRef.current?.focus();
  }
  return (
    <div
      role="search"
      aria-label="장소 검색"
      className="absolute top-4 left-4 z-30 w-[calc(100%-134px)] max-w-[346px] min-w-0 sm:w-[329px] md:left-22"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && search.isOpen) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <form
        className="flex h-12 items-center gap-2 rounded-xl border bg-background px-3 shadow-sm focus-within:ring-2 focus-within:ring-ring"
        onSubmit={(event) => {
          event.preventDefault();
          search.submit();
        }}
      >
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <label htmlFor="place-search" className="sr-only">
          장소 검색
        </label>
        <input
          ref={inputRef}
          id="place-search"
          type="text"
          value={search.query}
          onChange={(event) => search.changeQuery(event.target.value)}
          disabled={!ready}
          placeholder="장소·주소·지하철역"
          aria-describedby="place-search-help"
          aria-controls={
            search.isOpen && ready ? 'place-search-results' : undefined
          }
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none disabled:text-muted-foreground"
        />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          aria-label="장소 검색 실행"
          disabled={!ready || !search.query.trim()}
        >
          {search.status === 'loading' ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-4 motion-safe:animate-spin"
            />
          ) : (
            '검색'
          )}
        </Button>
      </form>
      <p id="place-search-help" className="sr-only">
        {ready
          ? '검색어를 입력하고 Enter 또는 검색 버튼을 누르세요. 서울 소재 결과를 우선 표시합니다.'
          : '지도와 검색 서비스를 준비한 뒤 검색할 수 있습니다.'}
      </p>
      {connection?.status === 'error' && (
        <div className="mt-2 rounded-xl border bg-background p-3 text-xs leading-5 shadow-sm">
          <p>지도와 검색 서비스를 불러오지 못했습니다.</p>
          <Button variant="outline" size="sm" onClick={connection.retry}>
            검색 서비스 다시 시도
          </Button>
        </div>
      )}
      {search.isOpen && ready && (
        <section
          id="place-search-results"
          aria-label="장소 검색 결과"
          className={`absolute top-full left-0 mt-2 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl border bg-background p-3 shadow-md ${panelOpen ? 'max-h-[min(24rem,calc(55dvh-10rem))]' : 'max-h-[min(32rem,calc(100dvh-7rem))]'} md:max-h-[min(32rem,calc(100dvh-7rem))]`}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {search.view === 'selection' ? '선택한 위치' : '검색 결과'}
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="검색 결과 닫기"
              onClick={close}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          {search.view === 'results' ? (
            <>
              {search.status === 'loading' && (
                <p
                  role="status"
                  className="text-xs leading-5 text-muted-foreground"
                >
                  장소·주소 검색 중…
                </p>
              )}
              {search.status === 'error' && (
                <div
                  role="alert"
                  className="flex flex-col items-start gap-2 text-xs leading-5"
                >
                  <p>{search.error}</p>
                  <Button variant="outline" size="sm" onClick={search.submit}>
                    검색 다시 시도
                  </Button>
                </div>
              )}
              {search.status === 'ready' && search.data && (
                <>
                  <p
                    role="status"
                    className="text-xs leading-5 text-muted-foreground"
                  >
                    {search.data.items.length
                      ? `${search.data.items.length}개 결과 · 서울 소재 우선`
                      : '검색 결과가 없습니다. 다른 검색어로 시도해 주세요.'}
                  </p>
                  {(search.data.hasMore || search.data.partial) && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {search.data.partial
                        ? '일부 검색을 불러오지 못했습니다. '
                        : ''}
                      첫 페이지의 최대 15개 결과만 표시합니다.
                    </p>
                  )}
                  {search.data.partial && (
                    <Button variant="outline" size="sm" onClick={search.submit}>
                      검색 다시 시도
                    </Button>
                  )}
                  <ul className="flex flex-col divide-y">
                    {search.data.items.map((place) => (
                      <li key={place.id}>
                        <button
                          type="button"
                          aria-label={`${place.name} · ${place.address} · ${place.kind}${place.isSeoul ? '' : ' · 서울 서비스 범위 밖 또는 소재 확인 필요'}`}
                          className="flex w-full flex-col gap-1 rounded-lg p-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => search.selectResult(place)}
                        >
                          <span className="text-sm font-medium [overflow-wrap:anywhere]">
                            {place.name}
                          </span>
                          <span className="text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                            {place.address}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {place.kind}
                            {!place.isSeoul &&
                              ' · 서울 서비스 범위 밖 또는 소재 확인 필요'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            search.selected && (
              <>
                <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">
                  {search.selected.place.name}
                </h3>
                <p className="text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                  {search.selected.place.address}
                </p>
                <p className="text-xs text-muted-foreground">
                  {search.selected.place.kind}
                </p>
                {!search.selected.place.isSeoul && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    서울 서비스 범위 밖이거나 소재를 확인할 수 없는 위치입니다.
                    주변 카페 조회는 서울 공공데이터만 대상으로 합니다.
                  </p>
                )}
                {regionFiltered && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    기존 구·동 필터가 유지됩니다. 지도 영역 카페는 해당 필터로
                    조회하며, 반경 탐색에는 적용하지 않습니다.
                  </p>
                )}
                <Button
                  ref={nearbyRef}
                  size="sm"
                  onClick={() => onNearby(search.selected!.place)}
                >
                  이 위치 주변 카페 보기
                </Button>
              </>
            )
          )}
        </section>
      )}
    </div>
  );
}
