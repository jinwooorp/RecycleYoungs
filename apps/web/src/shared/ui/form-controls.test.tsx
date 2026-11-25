import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Button } from './button';
import { NativeSelect } from './native-select';

test('버튼은 위험 동작과 비활성 상태를 지원하고 asChild 링크 의미를 유지한다', () => {
  const onClick = vi.fn();
  render(
    <>
      <Button variant="destructive" disabled onClick={onClick}>
        삭제
      </Button>
      <Button asChild size="landing">
        <a href="/explore">시작하기</a>
      </Button>
    </>,
  );
  const remove = screen.getByRole('button', { name: '삭제' });
  expect(remove).toBeDisabled();
  expect(remove).toHaveAttribute('data-variant', 'destructive');
  fireEvent.click(remove);
  expect(onClick).not.toHaveBeenCalled();
  const link = screen.getByRole('link', { name: '시작하기' });
  expect(link).toHaveAttribute('href', '/explore');
  expect(link).toHaveAttribute('data-slot', 'button');
});

test('공통 select는 네이티브 동작, 포커스 참조, 설명과 장식 아이콘을 유지한다', () => {
  const ref = createRef<HTMLSelectElement>();
  const onChange = vi.fn();
  render(
    <>
      <label htmlFor="range">탐색 반경</label>
      <p id="range-info">후보지에 공통 적용</p>
      <NativeSelect
        ref={ref}
        id="range"
        aria-describedby="range-info"
        defaultValue="500"
        onChange={onChange}
      >
        <option value="500">500m</option>
        <option value="1000">1km</option>
      </NativeSelect>
    </>,
  );
  const select = screen.getByRole('combobox', { name: '탐색 반경' });
  expect(select).toBe(ref.current);
  expect(select).toHaveAccessibleDescription('후보지에 공통 적용');
  expect(select).toHaveValue('500');
  fireEvent.change(select, { target: { value: '1000' } });
  expect(select).toHaveValue('1000');
  expect(onChange).toHaveBeenCalledOnce();
  expect(select.parentElement?.querySelector('svg')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
});
