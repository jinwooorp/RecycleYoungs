import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Button } from './button'

export function Dialog({ open, onClose, labelledBy, closeLabel, children }: {
  open: boolean; onClose: () => void; labelledBy: string; closeLabel: string; children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element || !open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    element.scrollTop = 0
    close.current?.focus()
    return () => {
      if (typeof element.close === 'function') element.close()
      else element.removeAttribute('open')
      queueMicrotask(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }) })
    }
  }, [open])
  return <dialog ref={dialog} hidden={!open} aria-labelledby={labelledBy} className="workspace-dialog"
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="dialog-toolbar"><Button ref={close} type="button" variant="outline" onClick={onClose}>{closeLabel}</Button></div>
    <div className="dialog-content">{children}</div>
  </dialog>
}
