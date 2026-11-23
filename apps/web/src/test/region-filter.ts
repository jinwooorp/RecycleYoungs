import { fireEvent, screen, within } from '@testing-library/react';

export function openTestRegionFilter() {
  const trigger = screen.getByRole('button', { name: '지역 필터' });
  if (trigger.getAttribute('aria-expanded') !== 'true')
    fireEvent.click(trigger);
  return trigger;
}

export function selectTestDistricts(...codes: string[]) {
  const trigger = openTestRegionFilter();
  if (screen.queryByRole('group', { name: '행정동 목록' }))
    fireEvent.click(screen.getByRole('button', { name: '이전 단계: 자치구' }));
  const list = within(screen.getByRole('group', { name: '자치구 목록' }));
  if (!codes.length)
    fireEvent.click(list.getByRole('button', { name: '서울 전체' }));
  else {
    const options = list
      .getAllByRole<HTMLButtonElement>('button')
      .filter(({ value }) => value);
    for (const option of options.filter(
      (item) => !codes.includes(item.value),
    )) {
      if (option.getAttribute('aria-pressed') === 'true')
        fireEvent.click(option);
    }
    for (const option of options.filter((item) => codes.includes(item.value))) {
      if (option.getAttribute('aria-pressed') === 'false')
        fireEvent.click(option);
    }
  }
  return trigger;
}

export function openTestRegionDongs() {
  openTestRegionFilter();
  if (!screen.queryByRole('group', { name: '행정동 목록' }))
    fireEvent.click(screen.getByRole('button', { name: '행정동' }));
  return within(screen.getByRole('group', { name: '행정동 목록' }));
}
