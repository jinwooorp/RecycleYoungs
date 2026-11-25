import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BrandLogo, brandName } from './brand-logo';

test('워드마크 링크의 이름은 텍스트에서 한 번만 읽고 SVG는 숨긴다', () => {
  render(
    <a href="/">
      <BrandLogo />
    </a>,
  );
  const link = screen.getByRole('link', { name: brandName });
  expect(link).toHaveTextContent(brandName);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});

test('심볼은 이름과 크기를 제공하며 밝은 배경과 어두운 배경에서 같은 도형을 쓴다', () => {
  const { rerender } = render(<BrandLogo variant="symbol" size={16} />);
  const logo = screen.getByRole('img', { name: brandName });
  const [pin, question] = logo.querySelectorAll('use');
  expect(logo).toHaveAttribute('width', '16');
  expect(logo).toHaveAttribute('height', '16');
  expect(logo).toHaveAttribute('focusable', 'false');
  expect(pin).toHaveAttribute('href', '/favicon.svg#pin');
  expect(question).toHaveAttribute('href', '/favicon.svg#question');
  expect(pin).toHaveAttribute('fill', 'var(--brand-primary)');
  expect(question).toHaveAttribute('color', 'var(--brand-accent)');

  rerender(<BrandLogo variant="symbol" size={64} background="dark" />);
  expect(logo).toHaveAttribute('width', '64');
  expect(pin).toHaveAttribute('href', '/favicon.svg#pin');
  expect(question).toHaveAttribute('href', '/favicon.svg#question');
  expect(pin).toHaveAttribute('fill', 'var(--brand-accent)');
  expect(question).toHaveAttribute('color', 'var(--brand-primary)');
});
