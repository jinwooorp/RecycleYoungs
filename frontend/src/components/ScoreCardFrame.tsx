import type { ReactNode } from 'react'

export function ScoreCardFrame({ title, compact, children }: { title: string; compact: boolean; children: ReactNode }) {
  const Title = compact ? 'h3' : 'h2'
  return <section className="score-card" aria-label={title}>
    <Title className="text-sm font-semibold text-primary">{title}</Title>
    <div className="score-card-content">{children}</div>
  </section>
}
