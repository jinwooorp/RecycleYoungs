import type { Candidate } from '../types/comparison'
import { Button } from './ui/button'
import { candidateTitle } from '../lib/candidatePresentation'

export function CandidateTray({ candidates, onCompare, onSelect, onRemove }: {
  candidates: Candidate[]; onCompare: () => void; onSelect?: (candidate: Candidate) => void; onRemove?: (id: string) => void
}) {
  return <aside aria-label="담은 후보" className="candidate-tray">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-medium" aria-live="polite">등록한 후보 {candidates.length}/3</p>
      <Button type="button" size="sm" variant="outline" onClick={onCompare} disabled={!candidates.length}>후보 비교 보기</Button>
    </div>
    {candidates.length ? <ul className="flex flex-col gap-1">{candidates.map(candidate => <li key={candidate.id} className="flex min-w-0 items-center gap-1">
      <Button type="button" variant="ghost" className="min-w-0 flex-1 justify-start" onClick={() => onSelect?.(candidate)}>
        <span className="truncate">{candidateTitle(candidate)}</span></Button>
      {onRemove && <Button type="button" variant="ghost" aria-label={`담은 후보 ${candidate.number} 삭제`} onClick={() => onRemove(candidate.id)}>삭제</Button>}
    </li>)}</ul> : <p className="text-xs text-muted-foreground">관심 위치를 담아 같은 조건으로 비교하세요.</p>}
  </aside>
}
