import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './App';

test('개발 환경의 초기 화면을 표시한다', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: 'RecycleYoungs' })).toBeVisible();
  expect(screen.getByText('개발 환경이 준비되었습니다.')).toBeVisible();
  expect(screen.getByRole('button', { name: '서비스 준비 중' })).toBeDisabled();
});
