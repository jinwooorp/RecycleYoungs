import type { ComponentProps } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Adapted from shadcn/ui new-york-v4: light theme, 44px targets, no animation.
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent text-base font-semibold whitespace-nowrap focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:border-border',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground enabled:hover:bg-primary/90',
        outline: 'border-input bg-background enabled:hover:bg-accent enabled:hover:text-accent-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Button({ className, variant, asChild = false, ...props }:
  ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant }), 'min-h-11 px-5 py-2', className)} {...props} />
}

export { Button }
