import { formatPublishedDate, type DataSource } from '@/shared/lib/data-source';
import { cn } from '@/shared/lib/utils';

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
  inline = false,
}: {
  sources: readonly DataSource[];
  inline?: boolean;
}) {
  const [first] = sources;
  if (!first) return null;
  const provider = (
    <p>
      제공기관 {first.provider} · {first.portal}
    </p>
  );
  const links = (
    <ul
      className={cn(
        'mt-1 space-y-2 ps-4',
        inline &&
          'min-w-0 @min-[44rem]/provenance:mt-0 @min-[44rem]/provenance:ps-0',
      )}
    >
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
  );
  return (
    <div
      className={cn(
        'min-w-0 space-y-1 text-xs leading-5 text-muted-foreground',
        inline && 'grow',
      )}
    >
      {!inline && provider}
      <details
        className={
          inline
            ? 'items-start gap-x-3 @min-[44rem]/provenance:grid @min-[44rem]/provenance:grid-cols-[max-content_minmax(0,1fr)]'
            : undefined
        }
      >
        <summary className="cursor-pointer rounded font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          데이터 출처 상세
        </summary>
        {inline ? (
          <div className="min-w-0 [overflow-wrap:anywhere] @min-[44rem]/provenance:flex @min-[44rem]/provenance:flex-wrap @min-[44rem]/provenance:gap-x-2">
            {provider}
            {links}
          </div>
        ) : (
          links
        )}
      </details>
    </div>
  );
}
