import type { CafeCenter } from './cafes';

export const candidateSlots = ['A', 'B', 'C'] as const;
export type CandidateSlot = (typeof candidateSlots)[number];
export interface Candidate extends CafeCenter {
  slot: CandidateSlot;
  name: string;
}
export const candidateStorageKey = 'recycleyoungs.candidates';
export const candidateNameLimit = 60;

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

export function sortCandidates(items: Candidate[]): Candidate[] {
  return items.sort(
    (a, b) => candidateSlots.indexOf(a.slot) - candidateSlots.indexOf(b.slot),
  );
}

export function readCandidates(): Candidate[] {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(candidateStorageKey) ?? 'null',
    );
    if (
      value?.version !== 1 ||
      !Array.isArray(value.items) ||
      value.items.length > candidateSlots.length
    )
      return [];
    const items: Candidate[] = [];
    for (const row of value.items) {
      if (
        !row ||
        !candidateSlots.includes(row.slot) ||
        typeof row.name !== 'string' ||
        row.name.length > candidateNameLimit ||
        !row.name.trim() ||
        !validCandidateCenter(row) ||
        items.some(
          (item) => item.slot === row.slot || sameCandidateLocation(item, row),
        )
      )
        return [];
      const { slot, name, longitude, latitude } = row;
      items.push({ slot, name, longitude, latitude });
    }
    return sortCandidates(items);
  } catch {
    return [];
  }
}
