import type { CafeCenter } from '@/entities/cafe/cafes';

export const candidateSlots = ['A', 'B', 'C'] as const;
export type CandidateSlot = (typeof candidateSlots)[number];
export interface Candidate extends CafeCenter {
  slot: CandidateSlot;
  name: string;
}
export interface StoredCandidate extends Candidate {
  note: string;
}
export const candidateStorageKey = 'recycleyoungs.candidates';
export const candidateNameLimit = 60;
export const candidateNoteLimit = 800;

export type CandidateStorageRead =
  | { status: 'missing'; raw: null }
  | { status: 'ready'; raw: string; items: StoredCandidate[] }
  | { status: 'invalid' | 'unsupported' | 'read-failed' };

export function validCandidateCenter(center: CafeCenter) {
  return (
    Number.isFinite(center.longitude) &&
    Math.abs(center.longitude) <= 180 &&
    Number.isFinite(center.latitude) &&
    Math.abs(center.latitude) <= 90
  );
}

/** 약 0.1m 이내의 좌표 차이는 같은 지도 위치로 취급합니다. */
export function sameCandidateLocation(a: CafeCenter, b: CafeCenter) {
  return (
    Math.abs(a.longitude - b.longitude) <= 0.000001 &&
    Math.abs(a.latitude - b.latitude) <= 0.000001
  );
}

export function sortCandidates<T extends Candidate>(items: T[]): T[] {
  return items.sort(
    (a, b) => candidateSlots.indexOf(a.slot) - candidateSlots.indexOf(b.slot),
  );
}

export function readCandidateStorage(
  area: 'localStorage' | 'sessionStorage',
): CandidateStorageRead {
  let raw: string | null;
  try {
    raw = window[area].getItem(candidateStorageKey);
  } catch {
    return { status: 'read-failed' };
  }
  if (raw === null) return { status: 'missing', raw };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !Number.isInteger(value.version))
      return { status: 'invalid' };
    const version = area === 'localStorage' ? 2 : 1;
    if (value.version !== version) return { status: 'unsupported' };
    if (
      !Array.isArray(value.items) ||
      value.items.length > candidateSlots.length
    )
      return { status: 'invalid' };
    const items: StoredCandidate[] = [];
    for (const row of value.items) {
      if (
        !row ||
        !candidateSlots.includes(row.slot) ||
        typeof row.name !== 'string' ||
        row.name.length > candidateNameLimit ||
        !row.name.trim() ||
        !validCandidateCenter(row) ||
        (version === 2 &&
          (typeof row.note !== 'string' ||
            row.note.length > candidateNoteLimit)) ||
        items.some(
          (item) => item.slot === row.slot || sameCandidateLocation(item, row),
        )
      )
        return { status: 'invalid' };
      const { slot, name, longitude, latitude } = row;
      items.push({
        slot,
        name,
        longitude,
        latitude,
        note: version === 1 ? '' : row.note,
      });
    }
    return { status: 'ready', raw, items: sortCandidates(items) };
  } catch {
    return { status: 'invalid' };
  }
}
