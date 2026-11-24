import { StrictMode, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  candidateStorageKey as key,
  readCandidateStorage,
  type StoredCandidate,
} from '@/entities/candidate/candidates';
import { useCandidates } from './use-candidates';

const a = {
  slot: 'A',
  name: '후보지 A',
  longitude: 127,
  latitude: 37.5,
} as const;
const b = { ...a, slot: 'B', name: '후보지 B', longitude: 127.01 } as const;
const legacy = JSON.stringify({ version: 1, items: [b, a] });
const v2 = (...items: StoredCandidate[]) =>
  JSON.stringify({ version: 2, items });

function changeInAnotherTab(raw: string | null, dispatch = true) {
  const oldValue = localStorage.getItem(key);
  if (raw === null) localStorage.removeItem(key);
  else localStorage.setItem(key, raw);
  if (dispatch)
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          oldValue,
          newValue: raw,
          storageArea: localStorage,
        }),
      ),
    );
}

function mockMembership() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        districts: [
          { districtCode: '11140', districtName: '중구', containsCenter: true },
        ],
        dongs: [],
      }),
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
});

test('빈 저장소는 첫 사용자 변경까지 쓰지 않는다', () => {
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const { result } = renderHook(useCandidates);
  expect(result.current.items).toEqual([]);
  expect(result.current.storageIssue).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

test('StrictMode에서 로컬 검증 후에만 v1을 한 번 이전하고 정리한다', () => {
  sessionStorage.setItem(key, legacy);
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const originalRemove = Storage.prototype.removeItem;
  const remove = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, name) {
      expect(this).toBe(sessionStorage);
      expect(localStorage.getItem(key)).toBe(
        v2({ ...a, note: '' }, { ...b, note: '' }),
      );
      originalRemove.call(this, name);
    });
  const { result } = renderHook(useCandidates, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    ),
  });
  expect(result.current.items).toEqual([a, b]);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(write).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledOnce();
});

test.each([v2(), v2({ ...a, note: '로컬에 쓴 메모' })])(
  '빈 목록을 포함한 v2가 이미 있으면 과거 탭 원본을 덮어쓰거나 정리하지 않는다',
  (raw) => {
    localStorage.setItem(key, raw);
    sessionStorage.setItem(key, legacy);
    const { result } = renderHook(useCandidates);
    expect(result.current.records).toEqual(JSON.parse(raw).items);
    expect(localStorage.getItem(key)).toBe(raw);
    expect(sessionStorage.getItem(key)).toBe(legacy);
  },
);

test('초기 읽기 뒤 다른 탭이 먼저 쓴 로컬 목록을 사용한다', () => {
  sessionStorage.setItem(key, legacy);
  const primary = v2({ ...a, note: '다른 탭' });
  const original = Storage.prototype.getItem;
  let localReads = 0;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
    this: Storage,
    name,
  ) {
    if (this === localStorage && name === key && ++localReads === 2)
      localStorage.setItem(key, primary);
    return original.call(this, name);
  });
  const { result } = renderHook(useCandidates);
  expect(result.current.records[0].note).toBe('다른 탭');
  expect(localStorage.getItem(key)).toBe(primary);
  expect(sessionStorage.getItem(key)).toBe(legacy);
});

test.each([
  ['{', 'invalid'],
  [v2({ ...a, note: '' }, { ...a, longitude: 128, note: '' }), 'invalid'],
  [
    v2({ ...a, note: '' }, { ...b, longitude: a.longitude, note: '' }),
    'invalid',
  ],
  [v2({ ...a, longitude: 181, note: '' }), 'invalid'],
  [JSON.stringify({ version: 2, items: [{ ...a, note: 7 }] }), 'invalid'],
  [v2({ ...a, note: '메'.repeat(801) }), 'invalid'],
  [JSON.stringify({ version: 3, items: [] }), 'unsupported'],
])(
  '손상·미지원 로컬 데이터를 그대로 두고 메모리 등록은 허용한다',
  async (raw, issue) => {
    mockMembership();
    localStorage.setItem(key, raw);
    sessionStorage.setItem(key, legacy);
    const { result } = renderHook(useCandidates);
    expect(result.current.storageIssue).toBe(issue);
    expect(result.current.items).toEqual([]);
    await act(async () => {
      await result.current.add(a);
    });
    expect(result.current.items).toEqual([a]);
    expect(result.current.storageIssue).toBe(issue);
    expect(localStorage.getItem(key)).toBe(raw);
    expect(sessionStorage.getItem(key)).toBe(legacy);
  },
);

test.each(['reading', 'writing', 'verification'] as const)(
  '이전 중 %s 실패 시 v1을 보존하고 성공 확인 뒤 정리한다',
  (failure) => {
    sessionStorage.setItem(key, legacy);
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    let failed = true;
    let wrote = false;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      name,
    ) {
      if (
        this === localStorage &&
        failed &&
        (failure === 'reading' || (failure === 'verification' && wrote))
      )
        throw new DOMException('denied', 'SecurityError');
      return getItem.call(this, name);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      name,
      value,
    ) {
      if (this === localStorage && failed && failure === 'writing')
        throw new DOMException('quota', 'QuotaExceededError');
      setItem.call(this, name, value);
      wrote = true;
    });
    const { result } = renderHook(useCandidates);
    expect(result.current.items).toEqual([a, b]);
    expect(result.current.storageIssue).toBe(
      failure === 'writing' ? 'write-failed' : 'read-failed',
    );
    expect(sessionStorage.getItem(key)).toBe(legacy);
    failed = false;
    act(() => result.current.retryStorage());
    expect(result.current.storageIssue).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(key)).toBe(
      v2({ ...a, note: '' }, { ...b, note: '' }),
    );
  },
);

test('메모 저장 실패 내용을 화면에 유지하고 재시도 성공을 표시한다', () => {
  const raw = v2({ ...a, note: '저장본' });
  localStorage.setItem(key, raw);
  const { result } = renderHook(useCandidates);
  const mapItems = result.current.items;
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  act(() => result.current.edit(a, 'note', '지속 저장할 내용'));
  act(() => result.current.saveNote(a, '지속 저장할 내용'));
  expect(result.current.records[0].note).toBe('지속 저장할 내용');
  expect(result.current.noteResults.A).toBe('unsaved');
  expect(localStorage.getItem(key)).toBe(raw);
  spy.mockRestore();
  act(() => result.current.retryStorage());
  expect(result.current.noteResults.A).toBe('saved');
  expect(result.current.items).toBe(mapItems);
  expect(localStorage.getItem(key)).toBe(
    v2({ ...a, note: '지속 저장할 내용' }),
  );
});

test.each([true, false])(
  '다른 탭의 저장을 감지해 기존 초안을 보호한다 (이벤트 전달 %s)',
  (dispatch) => {
    localStorage.setItem(key, v2({ ...a, note: '기존' }));
    const { result } = renderHook(useCandidates);
    const mapItems = result.current.items;
    const latest = v2({ ...a, note: '다른 탭 메모' });
    changeInAnotherTab(latest);
    expect(result.current.records[0].note).toBe('다른 탭 메모');
    expect(result.current.items).toBe(mapItems);
    act(() => result.current.edit(a, 'note', '이 탭에서 편집 중'));
    const replacement = v2({ ...a, longitude: 127.02, note: '새 위치 메모' });
    changeInAnotherTab(replacement, dispatch);
    if (dispatch) {
      expect(result.current.drafts.A?.note).toBe('이 탭에서 편집 중');
      expect(result.current.storageIssue).toBe('conflict');
    }
    act(() => result.current.saveNote(a, '이 탭에서 편집 중'));
    expect(result.current.records[0].note).toBe('이 탭에서 편집 중');
    expect(result.current.storageIssue).toBe('conflict');
    expect(localStorage.getItem(key)).toBe(replacement);
    act(() => result.current.loadLatest());
    expect(result.current.records[0].note).toBe('새 위치 메모');
    act(() => result.current.saveNote(a, '오래 열린 편집기'));
    expect(localStorage.getItem(key)).toBe(replacement);
  },
);

test('마지막 삭제를 빈 목록으로 저장하고 슬롯을 다시 써도 과거 메모를 복원하지 않는다', async () => {
  mockMembership();
  localStorage.setItem(key, v2({ ...a, note: '삭제할 메모' }));
  sessionStorage.setItem(key, legacy);
  const first = renderHook(useCandidates);
  act(() => first.result.current.edit(a, 'note', '삭제할 초안'));
  act(() => first.result.current.remove('A'));
  expect(localStorage.getItem(key)).toBe(v2());
  first.unmount();
  const { result } = renderHook(useCandidates);
  expect(result.current.items).toEqual([]);
  await act(async () => {
    await result.current.add({ ...a, longitude: 127.01 });
  });
  expect(result.current.records).toEqual([
    { ...a, longitude: 127.01, note: '' },
  ]);
  expect(result.current.drafts.A).toBeUndefined();
  expect(readCandidateStorage('localStorage')).toMatchObject({
    status: 'ready',
    items: result.current.records,
  });
});

test('다른 탭의 최신 목록을 불러오면 진행 중인 후보지 등록도 취소한다', async () => {
  localStorage.setItem(key, v2({ ...a, note: '' }));
  const { result } = renderHook(useCandidates);
  let finish!: (response: Response) => void;
  const fetch = vi.fn((_path: string, options: { signal: AbortSignal }) => {
    expect(options.signal.aborted).toBe(false);
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal('fetch', fetch);
  act(() => {
    result.current.edit(a, 'note', '작성 중');
    void result.current.add(b);
  });
  const latest = v2({ ...a, note: '다른 탭 메모' });
  changeInAnotherTab(latest);
  expect(result.current.storageIssue).toBe('conflict');
  act(() => result.current.loadLatest());
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(result.current.pending).toBe(false);
  await act(async () =>
    finish(
      Response.json({
        districts: [
          { districtCode: '11140', districtName: '중구', containsCenter: true },
        ],
        dongs: [],
      }),
    ),
  );
  expect(result.current.items).toEqual([a]);
  expect(localStorage.getItem(key)).toBe(latest);
});
