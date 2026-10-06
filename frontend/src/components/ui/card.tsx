import type { ComponentProps } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

// Adapted from shadcn/ui new-york-v4; asChild preserves semantic sections.
function Card({ className, asChild = false, ...props }: ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp data-slot="card" className={cn('flex flex-col gap-6 rounded-xl border border-border bg-card py-6 text-card-foreground', className)} {...props} />
  )
}

export { Card }
