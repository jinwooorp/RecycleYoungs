import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { FloatingPanel } from './floating-panel';

afterEach(() => vi.unstubAllGlobals());

function fixture(reduce = false) {
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
  const panelView = (open: boolean, compact: boolean, picking = false) => (
    <main>
      <div className="region-filter" data-open="false" />
      <FloatingPanel
        id="test-panel"
        menu="analysis"
        open={open}
        compact={compact}
        picking={picking}
        panelRef={null}
        titleRef={null}
        onClose={vi.fn()}
      >
        분석 내용
      </FloatingPanel>
    </main>
  );
  const view = render(panelView(false, true));
  const panel = view.container.querySelector('aside')!;
  const shell = panel.parentElement!;
  let frame: DOMRect | null = null;
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(
    () =>
      frame ??
      (shell.dataset.compact === 'true'
        ? new DOMRect(0, 0, 520, 230)
        : new DOMRect(0, 0, 924, 720)),
  );
  const animate = vi.fn(() => ({
    onfinish: null as (() => void) | null,
    oncancel: null as (() => void) | null,
    cancel: vi.fn(() => {
      frame = null;
    }),
  }));
  Object.defineProperty(panel, 'animate', { value: animate });
  view.rerender(panelView(true, true));
  return {
    panel,
    shell,
    animate,
    view,
    change: (...args: Parameters<typeof panelView>) =>
      view.rerender(panelView(...args)),
    frame: (width: number, height: number) => {
      frame = new DOMRect(0, 0, width, height);
    },
  };
}

test('펼친 콘텐츠 높이와 CSS 기본 크기 사이를 움직이고 중간 프레임에서 반대 방향으로 전환한다', () => {
  const { panel, shell, animate, change, frame } = fixture();
  change(true, false);
  expect(animate).toHaveBeenLastCalledWith(
    [
      { width: '520px', height: '230px' },
      { width: '924px', height: '720px' },
    ],
    { duration: 230, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' },
  );
  expect(shell).toHaveAttribute('data-size-transition');
  const first = animate.mock.results[0].value;
  frame(680, 410);
  change(true, true);
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenLastCalledWith(
    [
      { width: '680px', height: '410px' },
      { width: '520px', height: '230px' },
    ],
    expect.anything(),
  );
  act(() => first.onfinish?.());
  expect(shell).toHaveAttribute('data-size-transition');
  act(() => animate.mock.results[1].value.onfinish?.());
  expect(shell).not.toHaveAttribute('data-size-transition');
  expect(panel.style.height).toBe('');
  expect(panel.style.width).toBe('');
  change(true, true);
  expect(animate).toHaveBeenCalledTimes(2);
});

test('닫기·위치 선택·뷰포트 변경·언마운트가 진행 중인 크기 효과를 정리한다', () => {
  const { animate, change, shell, view } = fixture();
  change(true, false);
  change(false, false);
  expect(animate.mock.results[0].value.cancel).toHaveBeenCalledOnce();
  expect(shell).not.toHaveAttribute('data-size-transition');
  change(true, false);
  change(true, true);
  change(true, true, true);
  expect(animate.mock.results[1].value.cancel).toHaveBeenCalledOnce();
  expect(shell).not.toHaveAttribute('data-size-transition');
  change(true, false);
  fireEvent.resize(window);
  expect(animate.mock.results[2].value.cancel).toHaveBeenCalledOnce();
  expect(shell).not.toHaveAttribute('data-size-transition');
  change(true, true);
  view.unmount();
  expect(animate.mock.results[3].value.cancel).toHaveBeenCalledOnce();
});

test('모션 감소 설정에서는 CSS 최종 크기를 바로 쓴다', () => {
  const { animate, change, shell, panel } = fixture(true);
  change(true, false);
  expect(animate).not.toHaveBeenCalled();
  expect(shell).not.toHaveAttribute('data-size-transition');
  expect(panel.getBoundingClientRect().width).toBe(924);
});

test('모바일 지역 필터가 열린 동안에는 높이를 제한하고 닫힌 뒤 최종 크기로 전환한다', async () => {
  const { animate, change, panel, frame, view } = fixture();
  const filter = view.container.querySelector('.region-filter')!;
  filter.setAttribute('data-open', 'true');
  panel.style.setProperty('--explore-panel-filter-limited', '1');
  frame(366, 192);
  change(true, false);
  expect(animate).not.toHaveBeenCalled();
  await act(async () => {
    frame(366, 464);
    panel.style.removeProperty('--explore-panel-filter-limited');
    filter.setAttribute('data-open', 'false');
  });
  expect(animate).toHaveBeenLastCalledWith(
    [
      { width: '366px', height: '192px' },
      { width: '366px', height: '464px' },
    ],
    expect.anything(),
  );
});
