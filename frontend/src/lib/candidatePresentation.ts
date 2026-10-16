import type { Candidate } from '../types/comparison'

export function candidateRegion(candidate: Candidate): string {
  if (candidate.location.loading) return '지역 확인 중'
  if (candidate.location.error) return '지역 판정 실패'
  const dong = candidate.location.result?.adminDong
  if (dong?.status === 'AMBIGUOUS_BOUNDARY') return '경계 모호성'
  if (dong?.status === 'OUTSIDE_OR_UNSUPPORTED') return '행정동 미확정 · 분석 범위 확인 필요'
  return dong?.resolvedDong?.name ?? '행정동 미확정'
}

export function candidateTitle(candidate: Candidate): string {
  return `후보 ${candidate.number} · ${candidateRegion(candidate)}`
}
