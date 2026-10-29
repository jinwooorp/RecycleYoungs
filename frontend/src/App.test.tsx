import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './App';

// 준비 안내와 비활성 버튼을 함께 확인해 미구현 기능이 사용 가능한 것처럼 보이지 않도록 합니다.
test('개발 환경의 초기 화면을 표시한다', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: 'RecycleYoungs' })).toBeVisible();
  expect(screen.getByText('개발 환경이 준비되었습니다.')).toBeVisible();
  expect(screen.getByRole('button', { name: '서비스 준비 중' })).toBeDisabled();
});
