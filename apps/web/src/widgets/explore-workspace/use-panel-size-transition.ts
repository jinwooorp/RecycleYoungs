import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

const reducedMotion = '(prefers-reduced-motion: reduce)';

function sizeOf(panel: HTMLElement) {
  const { width, height } = panel.getBoundingClientRect();
  return { width, height };
}

type Size = ReturnType<typeof sizeOf>;
interface TransitionState {
  open: boolean;
  compact: boolean;
  size: Size | null;
  animation: Animation | null;
  waitingForFilter: boolean;
  dragging: boolean;
}

function cancelAnimation(state: TransitionState) {
  const animation = state.animation;
  state.animation = null;
  animation?.cancel();
}

function animateSize(
  shell: HTMLElement,
  panel: HTMLElement,
  state: TransitionState,
  from: Size | null,
  to: Size,
  kind = '',
) {
  state.size = to;
  if (
    !from?.width ||
    !from.height ||
    (Math.abs(from.width - to.width) < 0.5 &&
      Math.abs(from.height - to.height) < 0.5) ||
    typeof panel.animate !== 'function' ||
    window.matchMedia?.(reducedMotion).matches
  ) {
    shell.removeAttribute('data-size-transition');
    return;
  }
  const animation = panel.animate(
    [from, to].map(({ width, height }) => ({
      width: `${width}px`,
      height: `${height}px`,
    })),
    { duration: 230, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' },
  );
  state.animation = animation;
  shell.setAttribute('data-size-transition', kind);
  const finish = () => {
    if (state.animation !== animation) return;
    cancelAnimation(state);
    shell.removeAttribute('data-size-transition');
    state.size = sizeOf(panel);
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
}

/** 전환이 끝나면 콘텐츠 자동 높이를 포함한 원래의 CSS 크기로 돌아갑니다. */
export function usePanelSizeTransition(
  shellRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  compact: boolean,
  picking: boolean,
  snap: object | null = null,
) {
  const previousSnap = useRef(snap);
  const stateRef = useRef<TransitionState>({
    open: false,
    compact,
    size: null,
    animation: null,
    waitingForFilter: false,
    dragging: false,
  });

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const panel = shell?.firstElementChild;
    if (!shell || !(panel instanceof HTMLElement)) return;
    const state = stateRef.current;
    const rememberSize = () => {
      if (!state.animation && !state.dragging) state.size = sizeOf(panel);
    };
    const stop = () => {
      state.waitingForFilter = false;
      if (!state.animation && !state.dragging) return;
      cancelAnimation(state);
      state.dragging = false;
      panel.style.removeProperty('--explore-sheet-drag-height');
      shell.removeAttribute('data-size-transition');
      rememberSize();
    };
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(rememberSize)
        : undefined;
    observer?.observe(panel, { box: 'border-box' });
    const filter = shell.closest('main')?.querySelector('.region-filter');
    const filterObserver = new MutationObserver(() => {
      if (
        !state.waitingForFilter ||
        filter?.getAttribute('data-open') === 'true'
      )
        return;
      state.waitingForFilter = false;
      animateSize(shell, panel, state, state.size, sizeOf(panel));
    });
    if (filter)
      filterObserver.observe(filter, {
        attributes: true,
        attributeFilter: ['data-open'],
      });
    const motion = window.matchMedia?.(reducedMotion);
    const viewport = window.visualViewport;
    motion?.addEventListener?.('change', stop);
    viewport?.addEventListener('resize', stop);
    window.addEventListener('resize', stop);
    return () => {
      stop();
      state.open = false;
      observer?.disconnect();
      filterObserver.disconnect();
      motion?.removeEventListener?.('change', stop);
      viewport?.removeEventListener('resize', stop);
      window.removeEventListener('resize', stop);
    };
  }, [shellRef]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const panel = shell?.firstElementChild;
    if (!shell || !(panel instanceof HTMLElement)) return;
    const state = stateRef.current;
    const movedByUser = snap !== previousSnap.current;
    const shouldAnimate =
      open &&
      state.open &&
      (state.compact !== compact || movedByUser) &&
      !picking;
    previousSnap.current = snap;
    state.open = open;
    state.compact = compact;
    if (!shouldAnimate && open && !picking && state.animation) return;

    // 반대 방향으로 전환할 때는 화면에 표시된 중간 크기를 시작점으로 사용합니다.
    const from = state.animation || state.dragging ? sizeOf(panel) : state.size;
    cancelAnimation(state);
    state.dragging = false;
    panel.style.removeProperty('--explore-sheet-drag-height');
    const to = sizeOf(panel);
    if (
      shouldAnimate &&
      getComputedStyle(panel)
        .getPropertyValue('--explore-panel-filter-limited')
        .trim() === '1'
    ) {
      state.waitingForFilter = true;
    } else if (shouldAnimate) {
      state.waitingForFilter = false;
      animateSize(shell, panel, state, from, to, movedByUser ? 'sheet' : '');
      return;
    } else if (!open || picking) {
      state.waitingForFilter = false;
    }
    shell.removeAttribute('data-size-transition');
    state.size = to;
  }, [shellRef, open, compact, picking, snap]);

  const dragHeight = useCallback(
    (height?: number) => {
      const shell = shellRef.current;
      const panel = shell?.firstElementChild;
      if (!shell || !(panel instanceof HTMLElement)) return 0;
      const state = stateRef.current;
      const next = height ?? sizeOf(panel).height;
      if (!state.dragging) {
        cancelAnimation(state);
        state.waitingForFilter = false;
        state.dragging = true;
        shell.setAttribute('data-size-transition', 'sheet');
      }
      panel.style.setProperty('--explore-sheet-drag-height', `${next}px`);
      return next;
    },
    [shellRef],
  );

  const cancelDrag = useCallback(() => {
    const shell = shellRef.current;
    const panel = shell?.firstElementChild;
    const state = stateRef.current;
    if (!shell || !(panel instanceof HTMLElement) || !state.dragging) return;
    state.dragging = false;
    panel.style.removeProperty('--explore-sheet-drag-height');
    shell.removeAttribute('data-size-transition');
    state.size = sizeOf(panel);
  }, [shellRef]);

  return { dragHeight, cancelDrag };
}
