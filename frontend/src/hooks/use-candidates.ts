import { useCallback, useEffect, useRef, useState } from 'react';
import type { CafeCenter, CafeRadius } from '@/lib/cafes';
import { fetchContainingRegions } from '@/lib/regions';
import {
  candidateNameLimit,
  candidateSlots,
  candidateStorageKey,
  readCandidates,
  sameCandidateLocation,
  sortCandidates,
  validCandidateCenter,
  type Candidate,
  type CandidateSlot,
} from '@/lib/candidates';

export function useCandidates() {
  const [items, setItems] = useState(readCandidates);
  const [selected, setSelected] = useState<CandidateSlot | null>(null);
  const [picking, setPicking] = useState(false);
  const [radius, setRadius] = useState<CafeRadius>(500);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    error?: boolean;
    retry?: CafeCenter & { name?: string };
  } | null>(null);
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);
  const leave = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setPicking(false);
    setNotice(null);
  }, []);

  function persist(next: Candidate[]) {
    setItems(next);
    try {
      sessionStorage.setItem(
        candidateStorageKey,
        JSON.stringify({ version: 1, items: next }),
      );
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  }

  // 등록 검증 중에도 이름 변경·삭제가 가능하므로 완료 시점의 목록을 사용합니다.
  const currentItems = useRef(items);
  function update(next: Candidate[]) {
    const ordered = sortCandidates(next);
    currentItems.current = ordered;
    persist(ordered);
  }

  const add = async (draft: CafeCenter & { name?: string }) => {
    if (request.current) return;
    const { longitude, latitude } = draft;
    const center = { longitude, latitude };
    function availableSlot() {
      const latest = currentItems.current;
      const slot = candidateSlots.find(
        (letter) => !latest.some((item) => item.slot === letter),
      );
      if (!slot) {
        setNotice({
          error: true,
          message: '후보지는 최대 3곳까지 등록할 수 있습니다.',
        });
        return;
      }
      if (latest.some((item) => sameCandidateLocation(item, center))) {
        setNotice({ error: true, message: '이미 등록된 위치입니다.' });
        return;
      }
      return slot;
    }
    if (!validCandidateCenter(center)) {
      setNotice({ error: true, message: '좌표를 확인할 수 없습니다.' });
      return;
    }
    if (!availableSlot()) return;
    const controller = new AbortController();
    request.current = controller;
    setPicking(false);
    setPending(true);
    setNotice(null);
    try {
      const regions = await fetchContainingRegions(
        longitude,
        latitude,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!regions.districts.length) {
        setNotice({
          error: true,
          message: '서울 경계에 속하지 않는 위치는 등록할 수 없습니다.',
        });
        return;
      }
      const slot = availableSlot();
      if (!slot) return;
      const name =
        draft.name?.trim().slice(0, candidateNameLimit) || `후보지 ${slot}`;
      update([...currentItems.current, { ...center, slot, name }]);
      setSelected(slot);
      setNotice({ message: `후보지 ${slot}를 등록했습니다.` });
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice({
          error: true,
          retry: draft,
          message:
            error instanceof Error
              ? error.message
              : '후보지 소속을 확인할 수 없습니다.',
        });
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  };

  function rename(slot: CandidateSlot, name: string) {
    const trimmed = name.trim().slice(0, candidateNameLimit);
    if (trimmed)
      update(
        currentItems.current.map((item) =>
          item.slot === slot ? { ...item, name: trimmed } : item,
        ),
      );
  }

  function remove(slot: CandidateSlot) {
    update(currentItems.current.filter((item) => item.slot !== slot));
    setSelected((value) => (value === slot ? null : value));
  }

  return {
    items,
    selected,
    setSelected,
    picking,
    setPicking,
    radius,
    setRadius,
    notice,
    pending,
    storageUnavailable,
    add,
    rename,
    remove,
    leave,
  };
}

export type Candidates = ReturnType<typeof useCandidates>;
