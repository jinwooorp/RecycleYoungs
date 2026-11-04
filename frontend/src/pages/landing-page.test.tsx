import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import LandingPage from './landing-page';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function motionEnvironment({ reduced = false, desktop = true } = {}) {
  const media = new Map<
    string,
    {
      matches: boolean;
      listeners: Set<() => void>;
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    }
  >();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      if (!media.has(query)) {
        const listeners = new Set<() => void>();
        media.set(query, {
          matches: query.includes('reduced-motion') ? reduced : desktop,
          listeners,
          addEventListener: vi.fn((_: string, callback: () => void) =>
            listeners.add(callback),
          ),
          removeEventListener: vi.fn((_: string, callback: () => void) =>
            listeners.delete(callback),
          ),
        });
      }
      return media.get(query)!;
    }),
  );
  const observers: {
    callback: IntersectionObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
    },
  );
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.stubGlobal('innerHeight', 800);
  const position = { scroll: 1164 };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      const index = ['features', 'analysis', 'comparison'].indexOf(this.id);
      const top = this.matches('.landing-header')
        ? 0
        : 1200 + Math.max(index, 0) * 800 - position.scroll;
      const height = this.matches('.landing-header')
        ? 72
        : this.matches('[data-landing-story]')
          ? 2400
          : 800;
      return {
        top,
        bottom: top + height,
        height,
        width: 1000,
        left: 0,
        right: 1000,
        x: 0,
        y: top,
        toJSON() {},
      };
    },
  );
  const flush = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    });
  return { media, observers, frames, position, flush };
}

function page() {
  return (
    <StrictMode>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </StrictMode>
  );
}

test('반복 진입·퇴장에도 관찰을 유지하며 콘텐츠를 영구적으로 숨기지 않는다', () => {
  const env = motionEnvironment({ desktop: false });
  const view = render(page());
  const observer = env.observers.at(-1)!;
  expect(env.observers[0].disconnect).toHaveBeenCalledOnce();
  const target = observer.observe.mock.calls[0][0] as Element;
  for (const visible of [true, false, true]) {
    act(() =>
      observer.callback(
        [{ target, isIntersecting: visible } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(target).toHaveAttribute('data-motion-visible', String(visible));
  }
  expect(document.querySelector('[data-reveal-pending]')).toBeNull();
  view.unmount();
  expect(observer.disconnect).toHaveBeenCalledOnce();
  expect(target).not.toHaveAttribute('data-motion-visible');
});

test('실제 스크롤 위치로 프리뷰를 양방향 교체하고 빠른 스크롤은 프레임 하나로 묶는다', () => {
  const env = motionEnvironment();
  render(page());
  env.flush();
  const layers = [
    ...document.querySelectorAll<HTMLElement>('[data-story-preview]'),
  ];
  expect(layers).toHaveLength(3);
  expect(layers[0].style.getPropertyValue('--preview-opacity')).toBe('1');
  env.position.scroll = 2800;
  for (let index = 0; index < 10; index++) fireEvent.scroll(window);
  expect(env.frames.size).toBe(1);
  env.flush();
  expect(layers[2].style.getPropertyValue('--preview-opacity')).toBe('1');
  env.position.scroll = 1164;
  fireEvent.scroll(window);
  env.flush();
  expect(layers[0].style.getPropertyValue('--preview-opacity')).toBe('1');
  expect(layers[2].style.getPropertyValue('--preview-opacity')).toBe('0');
});

test('중간 스크롤에서는 인접 프리뷰를 crossfade하고 복원된 위치도 반영한다', () => {
  const env = motionEnvironment();
  env.position.scroll = 1564;
  render(page());
  env.flush();
  const layers = [
    ...document.querySelectorAll<HTMLElement>('[data-story-preview]'),
  ];
  const first = Number(layers[0].style.getPropertyValue('--preview-opacity'));
  const second = Number(layers[1].style.getPropertyValue('--preview-opacity'));
  expect(first).toBeGreaterThan(0.3);
  expect(first).toBeLessThan(0.7);
  expect(first + second).toBeCloseTo(1);
  env.position.scroll = 2800;
  fireEvent(window, new Event('pageshow'));
  env.flush();
  expect(layers[2].style.getPropertyValue('--preview-opacity')).toBe('1');
});

test('모바일은 고정 프리뷰 없이 각 설명과 원본 이미지를 순서대로 표시한다', () => {
  const env = motionEnvironment({ desktop: false });
  render(page());
  env.flush();
  expect(document.querySelector('[data-story-motion]')).toBeNull();
  expect(
    screen.getByRole('heading', {
      name: '숫자가 가리키는 범위부터 살펴보세요',
    }),
  ).toBeVisible();
});

test('모션 감소 설정 전환 시 프레임·관찰을 정리하고 정적 화면으로 복귀한다', () => {
  const env = motionEnvironment();
  render(page());
  const reduced = [...env.media.entries()].find(([query]) =>
    query.includes('reduced-motion'),
  )![1];
  act(() => {
    reduced.matches = true;
    for (const listener of reduced.listeners) listener();
  });
  expect(document.querySelector('[data-story-motion]')).toBeNull();
  expect(document.querySelector('[data-motion-visible]')).toBeNull();
  expect(env.frames.size).toBe(0);
  expect(env.observers.at(-1)!.disconnect).toHaveBeenCalledOnce();
});

test('모션 감소 환경에서는 모든 콘텐츠를 관찰 없이 즉시 표시한다', () => {
  const env = motionEnvironment({ reduced: true });
  render(page());
  expect(env.observers).toHaveLength(0);
  expect(document.querySelector('[data-story-motion]')).toBeNull();
  expect(screen.getAllByRole('link', { name: '시작하기' })).toHaveLength(3);
});

test('IntersectionObserver 미지원이면 정적 콘텐츠와 CTA를 제공한다', () => {
  motionEnvironment();
  vi.stubGlobal('IntersectionObserver', undefined);
  render(page());
  expect(document.querySelector('[data-story-motion]')).toBeNull();
  expect(document.querySelector('[data-motion-visible]')).toBeNull();
  expect(
    screen.getByRole('heading', { name: '후보지를 같은 기준으로 비교하세요' }),
  ).toBeVisible();
  expect(screen.getAllByRole('link', { name: '시작하기' })).toHaveLength(3);
});

test('StrictMode·언마운트에서 리스너·관찰·예약 프레임을 모두 정리한다', () => {
  const env = motionEnvironment();
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const view = render(page());
  expect(env.frames.size).toBe(1);
  view.unmount();
  expect(env.frames.size).toBe(0);
  for (const type of ['scroll', 'resize', 'pageshow']) {
    const handlers = add.mock.calls
      .filter(([event]) => event === type)
      .map(([, callback]) => callback);
    for (const handler of handlers)
      expect(
        remove.mock.calls.some(
          ([event, callback]) => event === type && callback === handler,
        ),
      ).toBe(true);
  }
  for (const observer of env.observers)
    expect(observer.disconnect).toHaveBeenCalledOnce();
  for (const item of env.media.values()) expect(item.listeners.size).toBe(0);
});
