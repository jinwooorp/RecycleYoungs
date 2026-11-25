import { cn } from 'cn';

export const brandName = '여기 창업해도 돼?';

export function BrandLogo({
  variant = 'wordmark',
  background = 'light',
  size = 24,
  className,
}: {
  variant?: 'symbol' | 'wordmark';
  background?: 'light' | 'dark';
  size?: number;
  className?: string;
}) {
  const symbolOnly = variant === 'symbol';
  const dark = background === 'dark';
  const asset = `${import.meta.env.BASE_URL}favicon.svg`;
  const symbol = (
    <svg
      viewBox="0 0 110 110"
      width={size}
      height={size}
      className={cn('shrink-0', symbolOnly && className)}
      aria-hidden={symbolOnly ? undefined : true}
      aria-label={symbolOnly ? brandName : undefined}
      role={symbolOnly ? 'img' : undefined}
      focusable="false"
    >
      <use
        href={`${asset}#pin`}
        x={5}
        fill={dark ? 'var(--brand-accent)' : 'var(--brand-primary)'}
      />
      <use
        href={`${asset}#question`}
        x={5}
        color={dark ? 'var(--brand-primary)' : 'var(--brand-accent)'}
      />
    </svg>
  );

  if (symbolOnly) return symbol;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-[0.65rem] whitespace-nowrap',
        dark ? 'text-[var(--brand-background)]' : 'text-primary',
        className,
      )}
    >
      {symbol}
      <span>{brandName}</span>
    </span>
  );
}
