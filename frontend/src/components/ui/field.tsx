import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function FieldGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('flex flex-col gap-4', className)} {...props} />
}
function Field({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="field" className={cn('flex min-w-0 flex-col gap-2', className)} {...props} />
}
function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label data-slot="field-label" className={cn('text-sm font-medium', className)} {...props} />
}
export { FieldGroup, Field, FieldLabel }
