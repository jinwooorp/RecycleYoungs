import {
  cafeSource,
  formatPublishedDate,
  formatReferenceMonth,
  type DataSource,
} from '@/lib/data-sources';

export function PublishedDate({
  publishedAt,
  showLabel = true,
}: {
  publishedAt: string;
  showLabel?: boolean;
}) {
  const label = formatPublishedDate(publishedAt);
  return (
    <span className="text-xs leading-5 font-normal text-muted-foreground">
      {showLabel && '서비스 DB 게시일 '}
      {label ? <time dateTime={publishedAt}>{label}</time> : '확인 불가'}
    </span>
  );
}

export function DataSourceDetails({
  sources,
}: {
  sources: readonly DataSource[];
}) {
  const [first] = sources;
  if (!first) return null;
  return (
    <div className="min-w-0 space-y-1 text-xs leading-5 text-muted-foreground">
      <p>
        제공기관 {first.provider} · {first.portal}
      </p>
      <details>
        <summary className="cursor-pointer rounded font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          데이터 출처 상세
        </summary>
        <ul className="mt-1 space-y-2 ps-4">
          {sources.map(({ url, title }) => (
            <li key={url}>
              <a
                href={url}
                className="rounded text-primary underline underline-offset-2 [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring"
              >
                {title}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function CafeProvenance({
  sourceBatch,
}: {
  sourceBatch: { publishedAt: string; referenceMonth: string | null };
}) {
  const month = formatReferenceMonth(sourceBatch.referenceMonth);
  return (
    <div className="space-y-1 text-xs leading-5 text-muted-foreground">
      <p>
        원천 기준년월{' '}
        {month ? (
          <time dateTime={month.dateTime}>{month.label}</time>
        ) : (
          '확인 불가'
        )}
      </p>
      <p>
        <PublishedDate publishedAt={sourceBatch.publishedAt} />
      </p>
      <DataSourceDetails sources={[cafeSource]} />
    </div>
  );
}
