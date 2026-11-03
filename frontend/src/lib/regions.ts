export interface District {
  districtCode: string;
  districtName: string;
}
export interface Dong {
  dongCode: string;
  districtCode: string;
  dongName: string;
  labelPoint: unknown;
}
export interface BoundaryExtent {
  west: number;
  south: number;
  east: number;
  north: number;
}
export type RegionMapTarget =
  { kind: 'default' } | { kind: 'boundary'; extent: BoundaryExtent };

/** 서버의 내부 오류 원문 대신 상태·코드별로 안전한 안내를 제공합니다. */
export class RegionRequestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new RegionRequestError('지역 데이터 응답 형식을 확인할 수 없습니다.');
}

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new RegionRequestError(
      '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
    );
  }
  if (!response.ok) {
    let code: unknown;
    try {
      const problem: unknown = await response.json();
      if (record(problem)) code = problem.code;
    } catch {
      /* 본문이 없어도 HTTP 상태로 안내합니다. */
    }
    const message =
      response.status === 400
        ? '지역 요청을 확인할 수 없습니다. 다시 선택해 주세요.'
        : response.status === 404
          ? '선택한 지역을 찾을 수 없습니다.'
          : response.status === 503 && code === 'DATA_NOT_READY'
            ? '지역 데이터가 아직 준비되지 않았습니다.'
            : response.status === 503
              ? '지역 서비스를 일시적으로 사용할 수 없습니다.'
              : '지역 데이터를 불러오지 못했습니다.';
    throw new RegionRequestError(message, response.status);
  }
  try {
    return await response.json();
  } catch {
    return invalid();
  }
}

export async function fetchDistricts(signal: AbortSignal): Promise<District[]> {
  const body = await request('/api/v1/districts', signal);
  if (!record(body) || !Array.isArray(body.items)) return invalid();
  return body.items.map((item: unknown) => {
    if (
      !record(item) ||
      typeof item.districtCode !== 'string' ||
      !/^[0-9]{5}$/.test(item.districtCode) ||
      typeof item.districtName !== 'string'
    )
      return invalid();
    return { districtCode: item.districtCode, districtName: item.districtName };
  });
}

export async function fetchDongs(
  districtCode: string,
  signal: AbortSignal,
): Promise<Dong[]> {
  const body = await request(
    `/api/v1/districts/${encodeURIComponent(districtCode)}/dongs`,
    signal,
  );
  if (!record(body) || !Array.isArray(body.items)) return invalid();
  return body.items.map((item: unknown) => {
    if (
      !record(item) ||
      typeof item.dongCode !== 'string' ||
      !/^[0-9]{8}$/.test(item.dongCode) ||
      item.districtCode !== districtCode ||
      typeof item.dongName !== 'string'
    )
      return invalid();
    return {
      dongCode: item.dongCode,
      districtCode,
      dongName: item.dongName,
      labelPoint: item.labelPoint,
    };
  });
}

/** GeoJSON의 [경도, 위도] 순서를 유지하며 모든 폴리곤·링의 범위를 계산합니다. */
export function geometryExtent(geometry: unknown): BoundaryExtent {
  if (!record(geometry) || !Array.isArray(geometry.coordinates))
    return invalid();
  const polygons: unknown[] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : invalid();
  if (!polygons.length) return invalid();
  const extent = {
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
  };
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) return invalid();
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return invalid();
      for (const point of ring) {
        if (!Array.isArray(point) || point.length < 2) return invalid();
        const [longitude, latitude] = point;
        if (
          typeof longitude !== 'number' ||
          typeof latitude !== 'number' ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude) ||
          longitude < -180 ||
          longitude > 180 ||
          latitude < -90 ||
          latitude > 90
        )
          return invalid();
        extent.west = Math.min(extent.west, longitude);
        extent.east = Math.max(extent.east, longitude);
        extent.south = Math.min(extent.south, latitude);
        extent.north = Math.max(extent.north, latitude);
      }
    }
  }
  return extent;
}

export async function fetchBoundary(
  kind: 'district' | 'dong',
  code: string,
  signal: AbortSignal,
): Promise<BoundaryExtent> {
  const body = await request(
    `/api/v1/${kind === 'district' ? 'districts' : 'dongs'}/${encodeURIComponent(code)}/boundary`,
    signal,
  );
  if (
    !record(body) ||
    body.type !== 'Feature' ||
    body.id !== code ||
    !record(body.properties) ||
    body.properties.regionCode !== code ||
    body.properties.regionType !== kind.toUpperCase()
  )
    return invalid();
  return geometryExtent(body.geometry);
}
