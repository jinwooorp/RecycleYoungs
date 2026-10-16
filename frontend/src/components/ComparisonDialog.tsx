import type { ReactNode } from 'react'
import { Dialog } from './ui/dialog'

export function ComparisonDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return <Dialog open={open} onClose={onClose} labelledBy="comparison-title" closeLabel="비교 닫기">{children}</Dialog>
}
