import { useCallback, useEffect, useRef, useState } from 'react';
import type { CafeCenter, CafeRadius } from '@/lib/cafes';
import { fetchContainingRegions } from '@/lib/regions';
import { useCandidateStorage } from './use-candidate-storage';
import {
  candidateNameLimit,
  candidateNoteLimit,
  candidateSlots,
  sameCandidateLocation,
  validCandidateCenter,
  type Candidate,
  type CandidateSlot,
} from '@/lib/candidates';

export function useCandidates() {
  const storage = useCandidateStorage();
  const { items, records, drafts } = storage;
  const [selection, setSelection] = useState<Candidate | null>(null);
  const selected =
    selection &&
    items.some(
      (item) =>
        item.slot === selection.slot &&
        item.longitude === selection.longitude &&
        item.latitude === selection.latitude,
    )
      ? selection.slot
      : null;
  function setSelected(slot: CandidateSlot | null) {
    setSelection(storage.latest().find((item) => item.slot === slot) ?? null);
  }
  const [picking, setPicking] = useState(false);
  const [radius, setRadius] = useState<CafeRadius>(500);
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

  const add = async (draft: CafeCenter & { name?: string }) => {
    if (request.current) return;
    const { longitude, latitude } = draft;
    const center = { longitude, latitude };
    function availableSlot() {
      // 경계 확인 중 편집이 끝날 수 있으므로 완료 시점의 목록을 사용합니다.
      const latest = storage.latest();
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
      storage.add({ ...center, slot, name, note: '' });
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

  function rename(item: Candidate, name: string) {
    const trimmed = name.trim();
    if (trimmed && trimmed.length <= candidateNameLimit)
      storage.saveField(item, 'name', trimmed);
    else storage.edit(item, 'name', item.name);
  }

  function saveNote(item: Candidate, note: string) {
    if (note.length <= candidateNoteLimit)
      storage.saveField(item, 'note', note);
  }

  function remove(slot: CandidateSlot) {
    storage.remove(slot);
    setSelection((value) => (value?.slot === slot ? null : value));
  }

  return {
    items,
    records,
    drafts,
    selected,
    setSelected,
    picking,
    setPicking,
    radius,
    setRadius,
    notice,
    pending,
    storageIssue: storage.issue,
    retryStorage: storage.retryStorage,
    loadLatest: () => {
      if (storage.loadLatest()) leave();
    },
    noteResults: storage.noteResults,
    edit: storage.edit,
    saveNote,
    add,
    rename,
    remove,
    leave,
  };
}

export type Candidates = ReturnType<typeof useCandidates>;
