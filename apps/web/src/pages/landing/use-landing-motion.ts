import { useEffect, type RefObject } from 'react';

/** 스크롤 위치는 DOM 스타일로만 반영해 페이지 전체의 반복 렌더링을 피합니다. */
export function useLandingMotion(pageRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const page = pageRef.current;
    if (
      !page ||
      typeof IntersectionObserver === 'undefined' ||
      !window.matchMedia
    )
      return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = window.matchMedia(
      '(min-width: 1024px) and (min-height: 640px)',
    );
    const story = page.querySelector<HTMLElement>('[data-landing-story]');
    const steps = [...page.querySelectorAll<HTMLElement>('[data-story-step]')];
    const layers = [
      ...page.querySelectorAll<HTMLElement>('[data-story-preview]'),
    ];
    const targets = [
      ...page.querySelectorAll<HTMLElement>('[data-landing-reveal]'),
    ];
    let disposeMotion = () => {};

    const configure = () => {
      disposeMotion();
      if (reduced.matches) return;
      let disposed = false;
      let frame = 0;
      const update = () => {
        frame = 0;
        if (disposed || !story || !desktop.matches) return;
        const headerBottom =
          page.querySelector('.landing-header')?.getBoundingClientRect()
            .bottom ?? 72;
        const focus = headerBottom + (window.innerHeight - headerBottom) * 0.5;
        // 각 설명의 중앙 사이에서만 보간하므로 빠른 이동·뒤로 가기도 현재 위치를 즉시 따릅니다.
        const centers = steps.map((step) => {
          const rect = step.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
        let progress = 0;
        for (let index = 0; index < centers.length - 1; index++) {
          if (focus >= centers[index]) {
            const fraction =
              (focus - centers[index]) /
              Math.max(1, centers[index + 1] - centers[index]);
            // 읽는 구간은 선명하게 유지하고 두 설명 사이의 짧은 구간에서만 전환합니다.
            const blend = Math.max(0, Math.min(1, (fraction - 0.4) / 0.2));
            progress = index + blend * blend * (3 - 2 * blend);
          }
        }
        layers.forEach((layer, index) => {
          const weight = Math.max(0, 1 - Math.abs(index - progress));
          layer.style.setProperty('--preview-opacity', String(weight));
          layer.style.setProperty(
            '--preview-y',
            `${(index - progress) * 14}px`,
          );
          layer.style.setProperty(
            '--preview-scale',
            String(0.985 + weight * 0.015),
          );
        });
        steps.forEach((step, index) => {
          const weight = Math.max(0, 1 - Math.abs(index - progress));
          step.style.setProperty(
            '--copy-opacity',
            String(0.92 + weight * 0.08),
          );
        });
      };
      const schedule = () => {
        if (!disposed && !frame) frame = window.requestAnimationFrame(update);
      };
      const observer = new IntersectionObserver(
        (entries) => {
          if (disposed) return;
          for (const { target, isIntersecting } of entries) {
            // 영역을 벗어나도 관찰을 유지하며 CSS에서 최소 가독성을 항상 보장합니다.
            target.setAttribute('data-motion-visible', String(isIntersecting));
          }
        },
        { threshold: 0.08 },
      );
      for (const target of targets) observer.observe(target);
      if (desktop.matches && story) {
        story.setAttribute('data-story-motion', '');
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        window.addEventListener('pageshow', schedule);
        // 초기 표시와 이력 복원에서도 첫 scroll 이벤트를 기다리지 않고 위치를 맞춥니다.
        update();
        schedule();
      }
      disposeMotion = () => {
        if (disposed) return;
        disposed = true;
        observer.disconnect();
        if (frame) window.cancelAnimationFrame(frame);
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        window.removeEventListener('pageshow', schedule);
        story?.removeAttribute('data-story-motion');
        for (const target of targets)
          target.removeAttribute('data-motion-visible');
        for (const layer of layers) {
          layer.style.removeProperty('--preview-opacity');
          layer.style.removeProperty('--preview-y');
          layer.style.removeProperty('--preview-scale');
        }
        for (const step of steps) step.style.removeProperty('--copy-opacity');
      };
    };
    configure();
    reduced.addEventListener?.('change', configure);
    desktop.addEventListener?.('change', configure);
    return () => {
      disposeMotion();
      reduced.removeEventListener?.('change', configure);
      desktop.removeEventListener?.('change', configure);
    };
  }, [pageRef]);
}
