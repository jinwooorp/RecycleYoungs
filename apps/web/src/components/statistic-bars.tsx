import { useId } from 'react';
import { BAR_AXIS_WIDTH, scaleStatisticBars } from '@/lib/statistic-chart';
import { formatStatistic } from '@/lib/statistics';

export function StatisticBars({
  title,
  scope,
  unit,
  items,
}: {
  title: string;
  scope: string;
  unit: string;
  items: readonly { label: string; value: string | null }[];
}) {
  const titleId = useId();
  const { maximum, bars } = scaleStatisticBars(items.map(({ value }) => value));

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 space-y-3 rounded-xl border px-4 py-3"
    >
      <div className="space-y-1">
        <h5 id={titleId} className="text-sm font-semibold">
          {title}
        </h5>
        <p className="text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {scope} · 단위 {unit}
        </p>
      </div>
      <dl className="space-y-3">
        {items.map(({ label, value }, index) => {
          const bar = bars[index];
          return (
            <div key={label} className="min-w-0 space-y-1">
              <dt className="text-xs leading-5 text-muted-foreground">
                {label}
              </dt>
              <dd className="min-w-0 space-y-1">
                <div className="text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">
                  {formatStatistic(value, { trimTrailingZeros: true })}
                  {value !== null && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {unit}
                    </span>
                  )}
                </div>
                {bar && (
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox={`0 0 ${BAR_AXIS_WIDTH} 8`}
                    preserveAspectRatio="none"
                    className="block h-2 w-full rounded-sm bg-muted text-primary"
                  >
                    <rect width={bar.width} height="8" fill="currentColor" />
                    {bar.zero && (
                      <line
                        x1="0"
                        x2="0"
                        y1="0"
                        y2="8"
                        stroke="currentColor"
                        strokeWidth="3"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                )}
                {bar?.tiny && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    축에서 막대 폭을 구분하기 어려운 작은 값입니다.
                  </p>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {maximum !== null && (
        <div className="flex min-w-0 items-baseline justify-between gap-3 border-t pt-2 text-xs text-muted-foreground tabular-nums">
          <span>0 {unit}</span>
          <span className="min-w-0 text-right [overflow-wrap:anywhere]">
            상한 {formatStatistic(maximum, { trimTrailingZeros: true })} {unit}
          </span>
        </div>
      )}
    </section>
  );
}
