import { formatReferenceMonth } from '@/shared/lib/data-source';
import {
  DataSourceDetails,
  PublishedDate,
} from '@/shared/components/data-provenance';
import { cafeSource } from './cafe-source';
import { cn } from '@/shared/lib/utils';

export function CafeProvenance({
  sourceBatch,
  inline = false,
}: {
  sourceBatch: { publishedAt: string; referenceMonth: string | null };
  inline?: boolean;
}) {
  const month = formatReferenceMonth(sourceBatch.referenceMonth);
  const content = (
    <>
      <div
        className={cn(
          'flex flex-wrap gap-x-3 gap-y-1',
          inline && 'max-w-full shrink-0',
        )}
      >
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
      </div>
      <DataSourceDetails sources={[cafeSource]} inline={inline} />
    </>
  );
  return (
    <div
      className={cn(
        'text-xs leading-5 text-muted-foreground',
        inline ? '@container/provenance w-full min-w-0' : 'space-y-1',
      )}
    >
      {inline ? (
        <div className="flex flex-col gap-x-3 gap-y-1 @min-[44rem]/provenance:flex-row @min-[44rem]/provenance:items-start">
          {content}
        </div>
      ) : (
        content
      )}
    </div>
  );
}
