import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  candidateSlots,
  candidateStorageKey,
  readCandidateStorage,
  sortCandidates,
  type Candidate,
  type CandidateSlot,
  type CandidateStorageRead,
  type StoredCandidate,
} from '@/lib/candidates';

type StorageIssue =
  'read-failed' | 'write-failed' | 'invalid' | 'unsupported' | 'conflict';
type EditableField = 'name' | 'note';
type Drafts = Partial<
  Record<CandidateSlot, Partial<Pick<StoredCandidate, EditableField>>>
>;
type NoteResults = Partial<Record<CandidateSlot, 'saved' | 'unsaved'>>;

type Snapshot = {
  records: StoredCandidate[];
  items: Candidate[];
  drafts: Drafts;
  noteResults: NoteResults;
  baseline: string | null | undefined;
  legacy: string | null;
  dirty: boolean;
  issue: StorageIssue | null;
};

function mapItems(records: StoredCandidate[], previous: Candidate[] = []) {
  if (
    records.length === previous.length &&
    records.every(({ slot, name, longitude, latitude }, index) => {
      const item = previous[index];
      return (
        slot === item.slot &&
        name === item.name &&
        longitude === item.longitude &&
        latitude === item.latitude
      );
    })
  )
    return previous;
  return records.map(({ slot, name, longitude, latitude }) => ({
    slot,
    name,
    longitude,
    latitude,
  }));
}

function readInitial(): Snapshot {
  const local = readCandidateStorage('localStorage');
  const session =
    local.status === 'missing' || local.status === 'read-failed'
      ? readCandidateStorage('sessionStorage')
      : null;
  const records =
    local.status === 'ready'
      ? local.items
      : session?.status === 'ready'
        ? session.items
        : [];
  const issue =
    local.status !== 'ready' && local.status !== 'missing'
      ? local.status
      : session && session.status !== 'ready' && session.status !== 'missing'
        ? session.status
        : null;
  return {
    records,
    items: mapItems(records),
    drafts: {},
    noteResults: {},
    baseline: 'raw' in local ? local.raw : undefined,
    legacy: session?.status === 'ready' ? session.raw : null,
    dirty: false,
    issue,
  };
}

function removeDraft(
  drafts: Drafts,
  slot: CandidateSlot,
  field: EditableField,
) {
  const next = { ...drafts };
  const draft = { ...next[slot] };
  delete draft[field];
  if (Object.keys(draft).length) next[slot] = draft;
  else delete next[slot];
  return next;
}

export function useCandidateStorage() {
  const [state, setState] = useState(readInitial);
  const current = useRef(state);
  const initialized = useRef(false);

  function update(patch: Partial<Snapshot>) {
    const next = { ...current.current, ...patch };
    current.current = next;
    setState(next);
  }

  function adopt(local: Extract<CandidateStorageRead, { raw: string | null }>) {
    const records = local.status === 'ready' ? local.items : [];
    update({
      records,
      items: mapItems(records, current.current.items),
      drafts: {},
      noteResults: {},
      baseline: local.raw,
      legacy: null,
      dirty: false,
      issue: null,
    });
  }

  function persist() {
    const { records, baseline, legacy, issue, noteResults } = current.current;
    if (issue === 'conflict') return false;
    const local = readCandidateStorage('localStorage');
    if (!('raw' in local)) {
      update({ issue: local.status });
      return false;
    }
    if (local.raw !== (baseline ?? null)) {
      update({ issue: 'conflict' });
      return false;
    }
    const raw = JSON.stringify({ version: 2, items: records });
    try {
      if (local.raw !== raw)
        window.localStorage.setItem(candidateStorageKey, raw);
    } catch {
      update({ issue: 'write-failed' });
      return false;
    }
    const confirmed = readCandidateStorage('localStorage');
    if (!('raw' in confirmed)) {
      update({ baseline: raw, issue: confirmed.status });
      return false;
    }
    if (confirmed.raw !== raw) {
      update({ issue: 'conflict' });
      return false;
    }
    if (legacy !== null) {
      try {
        if (window.sessionStorage.getItem(candidateStorageKey) === legacy)
          window.sessionStorage.removeItem(candidateStorageKey);
      } catch {
        // 로컬 저장본이 검증됐으므로 탭 원본을 남겨도 다시 이전하지 않습니다.
      }
    }
    const saved = { ...noteResults };
    for (const slot of candidateSlots) {
      if (saved[slot] === 'unsaved') saved[slot] = 'saved';
    }
    update({
      baseline: raw,
      legacy: null,
      dirty: false,
      issue: null,
      noteResults: saved,
    });
    return true;
  }

  function receive(local: CandidateStorageRead) {
    const { baseline, drafts, dirty, issue } = current.current;
    if (issue === 'conflict') return;
    if (!('raw' in local)) {
      update({ issue: local.status });
      return;
    }
    if (local.raw === baseline) {
      if (!dirty && issue && local.status === 'ready') update({ issue: null });
      return;
    }
    if (dirty || Object.keys(drafts).length) {
      update({ issue: 'conflict' });
      return;
    }
    adopt(local);
  }

  function retryStorage() {
    const { legacy, dirty } = current.current;
    if (dirty) {
      persist();
      return;
    }
    const local = readCandidateStorage('localStorage');
    if (legacy !== null && local.status === 'missing') {
      const session = readCandidateStorage('sessionStorage');
      if (session.status !== 'ready' || session.raw !== legacy) {
        update({ issue: 'raw' in session ? 'conflict' : session.status });
        return;
      }
      update({ baseline: null, dirty: true });
      persist();
    } else {
      receive(local);
    }
  }

  function loadLatest() {
    const local = readCandidateStorage('localStorage');
    if (!('raw' in local)) return false;
    adopt(local);
    return true;
  }

  const start = useEffectEvent(retryStorage);
  const onStorage = useEffectEvent((event: StorageEvent) => {
    if (event.key !== null && event.key !== candidateStorageKey) return;
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      update({ issue: 'read-failed' });
      return;
    }
    receive(readCandidateStorage('localStorage'));
  });
  useEffect(() => {
    const listener = (event: StorageEvent) => onStorage(event);
    window.addEventListener('storage', listener);
    if (!initialized.current) {
      initialized.current = true;
      start();
    }
    return () => window.removeEventListener('storage', listener);
  }, []);

  function find(item: Candidate) {
    return current.current.records.find(
      ({ slot, longitude, latitude }) =>
        slot === item.slot &&
        longitude === item.longitude &&
        latitude === item.latitude,
    );
  }

  function edit(item: Candidate, field: EditableField, value: string) {
    const record = find(item);
    if (!record) return;
    const { drafts, noteResults } = current.current;
    const next =
      value === record[field]
        ? removeDraft(drafts, item.slot, field)
        : { ...drafts, [item.slot]: { ...drafts[item.slot], [field]: value } };
    const results = { ...noteResults };
    if (field === 'note') delete results[item.slot];
    update({ drafts: next, noteResults: results });
  }

  function commit(
    records: StoredCandidate[],
    drafts = current.current.drafts,
    noteResults = current.current.noteResults,
  ) {
    const sorted = sortCandidates(records);
    update({
      records: sorted,
      items: mapItems(sorted, current.current.items),
      drafts,
      noteResults,
      dirty: true,
    });
    return persist();
  }

  function saveField(item: Candidate, field: EditableField, value: string) {
    const record = find(item);
    if (!record) return;
    const { records, drafts } = current.current;
    const saved = commit(
      records.map((row) => (row === record ? { ...row, [field]: value } : row)),
      removeDraft(drafts, item.slot, field),
    );
    if (field === 'note')
      update({
        noteResults: {
          ...current.current.noteResults,
          [item.slot]: saved ? 'saved' : 'unsaved',
        },
      });
  }

  function remove(slot: CandidateSlot) {
    const { records, drafts, noteResults } = current.current;
    const nextDrafts = { ...drafts };
    const nextResults = { ...noteResults };
    delete nextDrafts[slot];
    delete nextResults[slot];
    commit(
      records.filter((item) => item.slot !== slot),
      nextDrafts,
      nextResults,
    );
  }

  return {
    items: state.items,
    records: state.records,
    drafts: state.drafts,
    issue: state.issue,
    noteResults: state.noteResults,
    edit,
    saveField,
    remove,
    retryStorage,
    loadLatest,
    add: (item: StoredCandidate) => commit([...current.current.records, item]),
    latest: () => current.current.records,
  };
}
