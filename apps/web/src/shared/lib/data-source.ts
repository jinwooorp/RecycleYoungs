export interface DataSource {
  provider: string;
  portal: string;
  title: string;
  url: string;
}

const publishedDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function formatPublishedDate(value: string): string | null {
  if (!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? publishedDateFormatter.format(timestamp)
    : null;
}

export function parseReferenceMonth(value: unknown): string | null {
  return typeof value === 'string' &&
    /^(?!0000)[0-9]{4}(0[1-9]|1[0-2])$/.test(value)
    ? value
    : null;
}

export function formatReferenceMonth(value: string | null) {
  const valid = parseReferenceMonth(value);
  if (!valid) return null;
  const year = valid.slice(0, 4);
  const month = valid.slice(4);
  return {
    dateTime: `${year}-${month}`,
    label: `${year}년 ${Number(month)}월`,
  };
}
