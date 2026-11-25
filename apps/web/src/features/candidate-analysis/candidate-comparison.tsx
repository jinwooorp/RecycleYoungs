import { useId, useSyncExternalStore, type ReactNode } from 'react';
import type { Candidate, CandidateSlot } from '@/entities/candidate/candidates';

const wideQuery = '(min-width: 64rem)';

function subscribeWidth(change: () => void) {
  const media = window.matchMedia?.(wideQuery);
  media?.addEventListener('change', change);
  return () => media?.removeEventListener('change', change);
}

const isWide = () => window.matchMedia?.(wideQuery).matches ?? true;

export function CandidateComparison({
  title,
  scope,
  candidates,
  selected,
  rows,
}: {
  title: string;
  scope: string;
  candidates: readonly Candidate[];
  selected: CandidateSlot | null;
  rows: readonly { label: string; cells: readonly ReactNode[] }[];
}) {
  const wide = useSyncExternalStore(subscribeWidth, isWide, () => true);
  const titleId = useId();
  const scopeId = useId();

  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-3">
      <header className="space-y-1">
        <h3 id={titleId} className="text-sm font-semibold">
          {title}
        </h3>
        <p id={scopeId} className="text-xs text-muted-foreground">
          {scope}
        </p>
      </header>
      {wide ? (
        <table
          aria-labelledby={titleId}
          aria-describedby={scopeId}
          className="w-full table-fixed border-collapse text-sm [overflow-wrap:anywhere]"
        >
          <thead>
            <tr className="border-y bg-muted text-primary">
              <th
                scope="col"
                className="w-1/5 px-3 py-2 text-left font-semibold"
              >
                지표
              </th>
              {candidates.map(({ slot, name }) => (
                <th
                  key={slot}
                  scope="col"
                  data-selected={selected === slot}
                  className="px-3 py-2 text-left font-semibold data-[selected=true]:bg-candidate-selected/10 data-[selected=true]:text-candidate-selected data-[selected=true]:underline data-[selected=true]:underline-offset-4"
                >
                  {slot} · {name}
                  {selected === slot && (
                    <span className="sr-only"> · 지도 선택됨</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, cells }) => (
              <tr key={label} className="border-b align-top">
                <th scope="row" className="px-3 py-3 text-left font-medium">
                  {label}
                </th>
                {candidates.map(({ slot }, index) => (
                  <td
                    key={slot}
                    data-selected={selected === slot}
                    className="px-3 py-3 tabular-nums data-[selected=true]:bg-candidate-selected/5"
                  >
                    {cells[index]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="space-y-2">
          {rows.map(({ label, cells }) => (
            <section
              key={label}
              aria-label={label}
              className="min-w-0 rounded-xl border bg-card text-sm text-card-foreground [overflow-wrap:anywhere]"
            >
              <h4 className="rounded-t-xl border-b bg-muted px-3 py-2 font-semibold text-primary">
                {label}
              </h4>
              <dl className="divide-y">
                {candidates.map(({ slot, name }, index) => (
                  <div
                    key={slot}
                    data-selected={selected === slot}
                    className="group grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 px-3 py-2 data-[selected=true]:bg-candidate-selected/5"
                  >
                    <dt className="font-medium group-data-[selected=true]:text-candidate-selected group-data-[selected=true]:underline group-data-[selected=true]:underline-offset-4">
                      {slot} · {name}
                      {selected === slot && (
                        <span className="sr-only"> · 지도 선택됨</span>
                      )}
                    </dt>
                    <dd className="min-w-0 tabular-nums">{cells[index]}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
