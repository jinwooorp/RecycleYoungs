import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from 'cn';

export function SelectChevron({ className }: { className?: string }) {
  return (
    <ChevronDown
      aria-hidden="true"
      className={cn(
        'pointer-events-none size-4 text-muted-foreground',
        className,
      )}
    />
  );
}

export function NativeSelect({
  className,
  containerClassName,
  variant = 'default',
  ...props
}: ComponentProps<'select'> & {
  containerClassName?: string;
  variant?: 'default' | 'muted';
}) {
  return (
    <span className={cn('relative block min-w-0', containerClassName)}>
      <select
        className={cn(
          'block w-full min-w-0 appearance-none truncate rounded-lg border border-input pr-10 pl-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-muted-foreground',
          variant === 'muted' ? 'bg-muted/50' : 'bg-background',
          className,
        )}
        {...props}
      />
      <SelectChevron className="absolute top-1/2 right-3 -translate-y-1/2" />
    </span>
  );
}
