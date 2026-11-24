import { useEffect, useState } from 'react';
import {
  CAFE_BATCH_SIZE,
  CAFE_MAX_OFFSET,
  type CafePage,
} from '@/entities/cafe/cafes';

const PAGE_SIZE = 10;
const emptyPage: CafePage['items'] = [];

type Pages = {
  scope: string | null;
  first: CafePage | null;
  page: number;
  batches: ReadonlyMap<number, CafePage>;
  errors: ReadonlyMap<number, string>;
  changed: boolean;
};

function initialPages(scope: string | null, first: CafePage | null): Pages {
  return {
    scope,
    first,
    page: 1,
    batches: new Map(),
    errors: new Map(),
    changed: false,
  };
}

function batchOffset(page: number) {
  return (
    Math.floor(((page - 1) * PAGE_SIZE) / CAFE_BATCH_SIZE) * CAFE_BATCH_SIZE
  );
}

/** 목록은 현재 조회의 첫 응답을 기준으로 추가 묶음만 관리합니다. */
export function useCafePagination(
  scope: string | null,
  first: CafePage | null,
  request: (signal: AbortSignal, offset: number) => Promise<CafePage>,
  restart: () => void,
) {
  const [saved, setPages] = useState(() => initialPages(scope, first));
  let pages = saved;
  if (pages.scope !== scope || pages.first !== first) {
    pages = initialPages(scope, first);
    setPages(pages);
  }

  const { page, changed } = pages;
  const offset = batchOffset(page);
  const batch = offset === 0 ? first : pages.batches.get(offset);
  const failure = pages.errors.get(offset);
  const pending = !!first && !batch && !failure && !changed;
  useEffect(() => {
    if (!first || !pending) return;
    const controller = new AbortController();
    void request(controller.signal, offset).then(
      (next) => {
        if (controller.signal.aborted) return;
        setPages((current) => {
          if (current.first !== first || batchOffset(current.page) !== offset)
            return current;
          if (
            next.sourceBatch.batchId !== first.sourceBatch.batchId ||
            next.totalCount !== first.totalCount
          )
            return { ...current, changed: true };

          const ids = new Set(first.items.map(({ bizesId }) => bizesId));
          for (const cached of current.batches.values())
            for (const { bizesId } of cached.items) ids.add(bizesId);
          if (next.items.some(({ bizesId }) => ids.has(bizesId)))
            return {
              ...current,
              errors: new Map(current.errors).set(
                offset,
                '다른 페이지와 중복된 카페 정보를 받았습니다.',
              ),
            };
          return {
            ...current,
            batches: new Map(current.batches).set(offset, next),
          };
        });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setPages((current) =>
          current.first === first && batchOffset(current.page) === offset
            ? {
                ...current,
                errors: new Map(current.errors).set(
                  offset,
                  error instanceof Error
                    ? error.message
                    : '카페 목록을 불러오지 못했습니다.',
                ),
              }
            : current,
        );
      },
    );
    return () => controller.abort();
  }, [first, offset, pending, request]);

  const firstIndex = (page - 1) * PAGE_SIZE;
  const start = firstIndex - offset;
  const items =
    !changed && batch ? batch.items.slice(start, start + PAGE_SIZE) : emptyPage;
  const incomplete =
    !changed && !!batch && items.length === 0 && firstIndex < batch.totalCount;
  const totalPages = Math.ceil((first?.totalCount ?? 0) / PAGE_SIZE);
  return {
    page,
    totalPages,
    lastPage: Math.min(
      totalPages,
      (CAFE_MAX_OFFSET + CAFE_BATCH_SIZE) / PAGE_SIZE,
    ),
    firstIndex,
    items,
    pending,
    changed,
    error:
      failure ??
      (incomplete ? '이 페이지의 카페 정보가 누락되었습니다.' : null),
    goTo(next: number) {
      if (
        changed ||
        !Number.isInteger(next) ||
        next < 1 ||
        next > totalPages ||
        batchOffset(next) > CAFE_MAX_OFFSET ||
        next === page
      )
        return false;
      setPages((current) => ({ ...current, page: next }));
      return true;
    },
    retry() {
      if (incomplete && offset === 0) {
        restart();
        return;
      }
      setPages((current) => {
        const errors = new Map(current.errors);
        errors.delete(offset);
        const batches = new Map(current.batches);
        batches.delete(offset);
        return { ...current, errors, batches };
      });
    },
    restart,
  };
}
