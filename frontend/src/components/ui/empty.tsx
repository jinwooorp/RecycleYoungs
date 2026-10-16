import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function Empty({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="empty" className={cn('flex min-w-0 flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center', className)} {...props} />
}
function EmptyTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="empty-title" className={cn('text-lg font-medium', className)} {...props} />
}
function EmptyDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="empty-description" className={cn('max-w-sm text-sm leading-relaxed text-muted-foreground', className)} {...props} />
}
export { Empty, EmptyTitle, EmptyDescription }
