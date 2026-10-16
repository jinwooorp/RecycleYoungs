import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <div data-slot="native-select-wrapper" className="relative w-full min-w-0">
    <select data-slot="native-select" className={cn('min-h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-card py-2 pr-10 pl-3 text-base text-foreground focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground', className)} {...props} />
    <svg data-slot="native-select-icon" aria-hidden="true" className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 9 6 6 6-6" /></svg>
  </div>
}
export { NativeSelect }
