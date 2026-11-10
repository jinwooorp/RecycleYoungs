import { createServer } from 'node:http';
import {
  cafePage,
  districts,
  dongs,
  sourceBatch,
  statistics,
} from './fixtures.ts';

/** 외부 연결·DB·파일 입력 없이 loopback에서만 합성 REST 응답을 제공합니다. */
export function startMockApi(port = 4174) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const scenario = /(?:^|;\s*)ry-e2e-scenario=([^;]*)/.exec(
      request.headers.cookie ?? '',
    )?.[1];
    const send = (status: number, data: unknown) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-RecycleYoungs-E2E': 'synthetic-v1',
      });
      response.end(JSON.stringify(data));
    };
    const invalid = () => send(400, { code: 'INVALID_PARAMETER', status: 400 });
    const missing = () => send(404, { code: 'REGION_NOT_FOUND', status: 404 });
    const knownRegion = (kind: string, code: string) =>
      kind === 'districts'
        ? districts.some((row) => row.districtCode === code)
        : dongs.some((row) => row.dongCode === code);
    const validPoint = () =>
      ['longitude', 'latitude'].every((key) => {
        const value = url.searchParams.get(key);
        return (
          value !== null &&
          value.trim() !== '' &&
          Number.isFinite(Number(value)) &&
          Math.abs(Number(value)) <= (key === 'longitude' ? 180 : 90)
        );
      });
    if (request.method !== 'GET') return invalid();
    if (url.pathname === '/__e2e/health')
      return send(200, { fixture: 'synthetic-v1' });
    if (url.pathname === '/api/v1/districts') {
      if (scenario === 'districts-error')
        return send(503, { code: 'DATA_NOT_READY', status: 503 });
      return send(200, { items: districts });
    }
    const dongList = /^\/api\/v1\/districts\/(\d{5})\/dongs$/.exec(
      url.pathname,
    );
    if (dongList) {
      if (!knownRegion('districts', dongList[1])) return missing();
      return send(200, {
        items: dongs
          .filter((dong) => dong.districtCode === dongList[1])
          .map((dong) => ({
            ...dong,
            labelPoint: {
              type: 'Point',
              coordinates:
                dong.districtCode === '11440'
                  ? [126.923, 37.556]
                  : [127.048, 37.546],
            },
          })),
      });
    }
    const boundary = /^\/api\/v1\/(districts|dongs)\/(\d+)\/boundary$/.exec(
      url.pathname,
    );
    if (boundary) {
      if (!knownRegion(boundary[1], boundary[2])) return missing();
      return send(200, {
        type: 'Feature',
        id: boundary[2],
        properties: {
          regionCode: boundary[2],
          regionType: boundary[1] === 'districts' ? 'DISTRICT' : 'DONG',
          sourceBatch,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [126.9, 37.54],
              [127.06, 37.54],
              [127.06, 37.57],
              [126.9, 37.54],
            ],
          ],
        },
      });
    }
    const stat =
      /^\/api\/v1\/(districts|dongs)\/(\d+)\/stats\/(stores|sales|foot-traffic)$/.exec(
        url.pathname,
      );
    if (stat) {
      const [, kind, code, metric] = stat;
      if (!knownRegion(kind, code)) return missing();
      const quarter = url.searchParams.get('quarterCode');
      if (
        !['20261', '20262'].includes(quarter ?? '') ||
        (metric === 'foot-traffic'
          ? url.searchParams.has('industryCode')
          : url.searchParams.get('industryCode') !== 'CS100010')
      )
        return invalid();
      if (metric === 'sales' && scenario === 'sales-error')
        return send(503, { code: 'DATA_NOT_READY', status: 503 });
      return send(200, {
        [kind === 'districts' ? 'districtCode' : 'dongCode']: code,
        quarterCode: quarter,
        ...(metric === 'foot-traffic' ? {} : { industryCode: 'CS100010' }),
        data:
          metric === 'sales' && scenario === 'sales-empty'
            ? null
            : statistics(metric, code),
      });
    }
    if (url.pathname === '/api/v1/regions/nearby') {
      if (!validPoint() || url.searchParams.get('radiusM') !== '1')
        return invalid();
      const index = Number(url.searchParams.get('longitude')) > 127 ? 1 : 0;
      return send(200, {
        districts: [{ ...districts[index], containsCenter: true }],
        dongs: [{ ...dongs[index], containsCenter: true }],
      });
    }
    if (url.pathname === '/api/v1/cafes/nearby') {
      const radius = Number(url.searchParams.get('radiusM'));
      if (
        !validPoint() ||
        ![500, 1000].includes(radius) ||
        url.searchParams.get('limit') !== '200' ||
        url.searchParams.get('offset') !== '0'
      )
        return invalid();
      return send(200, cafePage(radius));
    }
    // 정의하지 않은 경로는 실제 Backend로 전달하거나 성공 응답으로 덮지 않습니다.
    return send(404, { code: 'E2E_UNEXPECTED_ENDPOINT', status: 404 });
  });
  return new Promise<typeof server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
