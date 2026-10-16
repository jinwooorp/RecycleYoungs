import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select data-slot="native-select" className={cn('min-h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base text-foreground focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground', className)} {...props} />
}
export { NativeSelect }
