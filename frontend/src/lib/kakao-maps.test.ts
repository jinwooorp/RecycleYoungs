import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  document
    .querySelectorAll('script[data-kakao-maps-sdk]')
    .forEach((script) => script.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function script() {
  return document.querySelector<HTMLScriptElement>(
    'script[data-kakao-maps-sdk]',
  )!;
}

function sdk() {
  const maps = {
    load: vi.fn((callback: () => void) => callback()),
    Map: vi.fn(),
    LatLng: vi.fn(),
  };
  vi.stubGlobal('kakao', { maps });
  return maps;
}

test('빈 키는 SDK 요청 없이 거부한다', async () => {
  const { loadKakaoMaps } = await import('./kakao-maps');
  await expect(loadKakaoMaps('  ')).rejects.toThrow('JavaScript 키');
  expect(script()).toBeNull();
});

test('동시 호출은 하나의 비동기 SDK 로딩과 준비 콜백을 공유한다', async () => {
  const { loadKakaoMaps } = await import('./kakao-maps');
  const first = loadKakaoMaps('test-key');
  const second = loadKakaoMaps('test-key');
  expect(first).toBe(second);
  expect(document.querySelectorAll('script[data-kakao-maps-sdk]')).toHaveLength(
    1,
  );
  expect(script().async).toBe(true);
  expect(new URL(script().src).searchParams.get('autoload')).toBe('false');
  const maps = sdk();
  script().dispatchEvent(new Event('load'));
  await expect(first).resolves.toBe(maps);
  expect(maps.load).toHaveBeenCalledOnce();
  await expect(loadKakaoMaps('test-key')).resolves.toBe(maps);
});

test('SDK 스크립트 실패 후 새 요청으로 재시도할 수 있다', async () => {
  const { loadKakaoMaps } = await import('./kakao-maps');
  const first = loadKakaoMaps('test-key');
  const rejected = expect(first).rejects.toThrow('불러오지 못했습니다');
  const failedScript = script();
  failedScript.dispatchEvent(new Event('error'));
  await rejected;
  expect(failedScript.isConnected).toBe(false);
  const retry = loadKakaoMaps('test-key');
  expect(script()).not.toBe(failedScript);
  const maps = sdk();
  script().dispatchEvent(new Event('load'));
  await expect(retry).resolves.toBe(maps);
});

test('SDK 준비 콜백이 오지 않으면 시간 초과하고 늦은 콜백은 무시한다', async () => {
  const { loadKakaoMaps } = await import('./kakao-maps');
  const first = loadKakaoMaps('test-key');
  let complete = () => {};
  vi.stubGlobal('kakao', {
    maps: {
      load: (callback: () => void) => {
        complete = callback;
      },
    },
  });
  script().dispatchEvent(new Event('load'));
  const rejected = expect(first).rejects.toThrow('시간');
  await vi.advanceTimersByTimeAsync(15_000);
  await rejected;
  const retry = loadKakaoMaps('test-key');
  complete();
  const maps = sdk();
  script().dispatchEvent(new Event('load'));
  await expect(retry).resolves.toBe(maps);
});

test('스크립트만 로드되고 SDK가 없으면 실패로 처리한다', async () => {
  const { loadKakaoMaps } = await import('./kakao-maps');
  const result = loadKakaoMaps('test-key');
  const rejected = expect(result).rejects.toThrow('불러오지 못했습니다');
  script().dispatchEvent(new Event('load'));
  await rejected;
});
