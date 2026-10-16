import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva('relative grid w-full gap-2 rounded-lg border p-4 text-sm', {
  variants: { variant: {
    default: 'border-border bg-card text-card-foreground',
    destructive: 'border-destructive/25 bg-destructive/5 text-destructive',
    warning: 'border-warning/25 bg-warning/10 text-warning-foreground',
  } }, defaultVariants: { variant: 'default' },
})
function Alert({ className, variant, role = 'alert', ...props }: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role={role} className={cn(alertVariants({ variant }), className)} {...props} />
}
function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="alert-title" className={cn('font-medium', className)} {...props} />
}
function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('flex flex-col gap-2 leading-relaxed', className)} {...props} />
}
export { Alert, AlertTitle, AlertDescription }
