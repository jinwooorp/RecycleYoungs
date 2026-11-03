import type { BoundaryExtent } from './regions';

export interface Cafe {
  bizesId: string;
  storeName: string;
  branchName: string | null;
  semasIndustryCode: string;
  semasIndustryName: string;
  roadAddress: string | null;
  lotAddress: string | null;
  longitude: number;
  latitude: number;
}

export interface CafePage {
  items: Cafe[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  sourceBatch: { batchId: string; publishedAt: string };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function coordinate(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= max
  );
}
function invalid(): never {
  throw new Error('카페 데이터 응답 형식을 확인할 수 없습니다.');
}

/** 지도 사각 영역과 선택 구·동을 조회하며 페이지 상한을 200건으로 고정합니다. */
export async function fetchViewportCafes(
  bounds: BoundaryExtent,
  districtCode: string,
  signal: AbortSignal,
  dongCode = '',
): Promise<CafePage> {
  const { west, south, east, north } = bounds;
  if (
    !coordinate(west, 180) ||
    !coordinate(east, 180) ||
    !coordinate(south, 90) ||
    !coordinate(north, 90) ||
    west >= east ||
    south >= north
  )
    throw new Error('지도 영역을 확인할 수 없습니다.');
  const params = new URLSearchParams({
    west: String(west),
    south: String(south),
    east: String(east),
    north: String(north),
  });
  if (districtCode) params.set('districtCodes', districtCode);
  if (dongCode) params.set('dongCodes', dongCode);
  params.set('limit', '200');
  params.set('offset', '0');
  let response: Response;
  try {
    response = await fetch(`/api/v1/cafes/viewport?${params}`, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('네트워크 연결을 확인한 뒤 다시 시도해 주세요.', {
      cause: error,
    });
  }
  if (!response.ok) {
    const problem: unknown = await response.json().catch(() => null);
    const code = record(problem) ? problem.code : null;
    throw new Error(
      response.status === 400
        ? '카페 조회 요청을 확인할 수 없습니다.'
        : response.status === 404
          ? '선택한 지역을 찾을 수 없습니다.'
          : response.status === 503 && code === 'DATA_NOT_READY'
            ? '카페 데이터가 아직 준비되지 않았습니다.'
            : response.status === 503
              ? '카페 서비스를 일시적으로 사용할 수 없습니다.'
              : '카페 정보를 불러오지 못했습니다.',
    );
  }
  const body: unknown = await response.json().catch(invalid);
  if (
    !record(body) ||
    !Array.isArray(body.items) ||
    body.items.length > 200 ||
    !Number.isSafeInteger(body.totalCount) ||
    (body.totalCount as number) < body.items.length ||
    body.limit !== 200 ||
    body.offset !== 0 ||
    typeof body.hasMore !== 'boolean' ||
    body.hasMore !== body.items.length < (body.totalCount as number) ||
    !record(body.sourceBatch) ||
    !text(body.sourceBatch.batchId) ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      body.sourceBatch.batchId,
    ) ||
    !text(body.sourceBatch.publishedAt) ||
    !Number.isFinite(Date.parse(body.sourceBatch.publishedAt))
  )
    return invalid();
  const ids = new Set<string>();
  const items = body.items.map((item: unknown): Cafe => {
    if (
      !record(item) ||
      !text(item.bizesId) ||
      ids.has(item.bizesId) ||
      !text(item.storeName) ||
      !text(item.semasIndustryCode) ||
      !text(item.semasIndustryName) ||
      !nullableText(item.branchName) ||
      !nullableText(item.roadAddress) ||
      !nullableText(item.lotAddress) ||
      !coordinate(item.longitude, 180) ||
      !coordinate(item.latitude, 90)
    )
      return invalid();
    ids.add(item.bizesId);
    return {
      bizesId: item.bizesId,
      storeName: item.storeName,
      branchName: item.branchName,
      semasIndustryCode: item.semasIndustryCode,
      semasIndustryName: item.semasIndustryName,
      roadAddress: item.roadAddress,
      lotAddress: item.lotAddress,
      longitude: item.longitude,
      latitude: item.latitude,
    };
  });
  return {
    items,
    totalCount: body.totalCount as number,
    limit: body.limit,
    offset: body.offset,
    hasMore: body.hasMore,
    sourceBatch: {
      batchId: body.sourceBatch.batchId,
      publishedAt: body.sourceBatch.publishedAt,
    },
  };
}

export function cafeAddress(cafe: Cafe) {
  return (
    cafe.roadAddress?.trim() ||
    cafe.lotAddress?.trim() ||
    '주소 정보가 없습니다.'
  );
}
