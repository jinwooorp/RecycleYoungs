import type { ComponentProps } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

// Adapted from shadcn/ui new-york-v4; asChild preserves semantic sections.
function Card({ className, asChild = false, density = 'default', ...props }: ComponentProps<'div'> & { asChild?: boolean; density?: 'default' | 'compact' }) {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp data-slot="card" data-density={density} className={cn('group/card flex flex-col rounded-xl border border-border bg-card text-card-foreground', density === 'compact' ? 'gap-3 py-4' : 'gap-6 py-6', className)} {...props} />
  )
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('grid gap-2 px-6 group-data-[density=compact]/card:px-4', className)} {...props} />
}
function CardTitle({ className, asChild = false, ...props }: ComponentProps<'h2'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'h2'
  return <Comp data-slot="card-title" className={cn('text-lg font-semibold leading-snug', className)} {...props} />
}
function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...props} />
}
function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('min-w-0 px-6 group-data-[density=compact]/card:px-4', className)} {...props} />
}
function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex flex-wrap items-center gap-3 px-6', className)} {...props} />
}
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
