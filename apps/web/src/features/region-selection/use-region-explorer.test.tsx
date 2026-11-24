import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useRegionExplorer } from './use-region-explorer';

afterEach(() => vi.unstubAllGlobals());
const districts = [
  { districtCode: '00110', districtName: '가구' },
  { districtCode: '00140', districtName: '나구' },
  { districtCode: '00170', districtName: '다구' },
];
const dong = (districtCode: string) => ({
  districtCode,
  dongCode: `${districtCode}001`,
  dongName: '가동',
  labelPoint: { type: 'Point', coordinates: [127, 37] },
});
const boundary = (code: string, kind = 'DISTRICT', west = 126.9) => ({
  type: 'Feature',
  id: code,
  properties: { regionCode: code, regionType: kind },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [west, 37.5],
        [127.1, 37.5],
        [127.1, 37.6],
        [west, 37.5],
      ],
    ],
  },
});
const response = (body: unknown) => new Response(JSON.stringify(body));

function install(overrides: Record<string, () => Promise<Response>> = {}) {
  const fetch = vi.fn<
    (input: string, options?: RequestInit) => Promise<Response>
  >(async (input) => {
    if (overrides[input]) return overrides[input]();
    if (input === '/api/v1/districts') return response({ items: districts });
    const code = input.split('/')[4];
    if (input.endsWith('/dongs')) return response({ items: [dong(code)] });
    return response(
      boundary(
        code,
        input.includes('/dongs/') ? 'DONG' : 'DISTRICT',
        code.startsWith('00140') ? 126.8 : 126.9,
      ),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('단일 구의 자동 분석 대상을 다중 구에서 해제하고 명시 선택만 유지한다', async () => {
  const fetch = install();
  const { result } = renderHook(useRegionExplorer);
  await waitFor(() => expect(result.current.districts.status).toBe('ready'));
  function expectAnalysis(districtCode: string, dongCode = '') {
    expect(result.current.analysis).toMatchObject({ districtCode, dongCode });
  }

  expectAnalysis('');
  act(() => result.current.applyDistricts(['00110']));
  expectAnalysis('00110');
  await waitFor(() => expect(result.current.dongs.status).toBe('ready'));
  act(() => result.current.selectDong('00110001'));
  expectAnalysis('00110', '00110001');

  act(() => result.current.applyDistricts(['00110', '00140']));
  expectAnalysis('');
  expect(result.current.dongCode).toBe('');
  expect(result.current.analysisDongs.status).toBe('idle');
  await waitFor(() => expect(result.current.boundary.status).toBe('ready'));

  const { districtCodes, cameraKey, overlays, target } = result.current;
  const mapRequests = () =>
    fetch.mock.calls.filter(([url]) => url.endsWith('/boundary'));
  const boundaryRequests = mapRequests().length;
  act(() => result.current.selectAnalysisDistrict('00140'));
  await waitFor(() =>
    expect(result.current.analysisDongs.data?.[0].districtCode).toBe('00140'),
  );
  act(() => result.current.selectAnalysisDong('00140001'));
  expectAnalysis('00140', '00140001');
  expect(result.current.districtCodes).toBe(districtCodes);
  expect(result.current.cameraKey).toBe(cameraKey);
  expect(result.current.overlays).toBe(overlays);
  expect(result.current.target).toBe(target);
  expect(mapRequests()).toHaveLength(boundaryRequests);

  act(() => result.current.applyDistricts(['00110', '00140', '00170']));
  expectAnalysis('00140', '00140001');
  act(() => result.current.selectAnalysisDistrict('00170'));
  expectAnalysis('00170');
  await waitFor(() =>
    expect(result.current.analysisDongs.data?.[0].districtCode).toBe('00170'),
  );
  act(() => result.current.selectAnalysisDong('00140001'));
  expectAnalysis('00170');
  act(() => result.current.selectAnalysisDong('00170001'));
  expectAnalysis('00170', '00170001');

  act(() => result.current.applyDistricts(['00110', '00140']));
  expectAnalysis('');
  act(() => result.current.selectAnalysisDistrict('00110'));
  expectAnalysis('00110');
  act(() => result.current.applyDistricts(['00140']));
  expectAnalysis('00140');
  act(() => result.current.applyDistricts(['00110', '00140', '00170']));
  expectAnalysis('');
  act(() => result.current.selectAnalysisDistrict('00140'));
  act(() => result.current.applyDistricts([]));
  expectAnalysis('');
});

test('자치구 선택·행정동 조회·전체 선택과 구 변경 시 동 초기화를 처리한다', async () => {
  const fetch = install();
  const { result } = renderHook(() => useRegionExplorer());
  await waitFor(() => expect(result.current.districts.status).toBe('ready'));
  act(() => result.current.applyDistricts(['00110']));
  await waitFor(() => expect(result.current.dongs.status).toBe('ready'));
  act(() => result.current.selectDong('00110001'));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/dongs/00110001/boundary',
      expect.anything(),
    ),
  );
  await waitFor(() => expect(result.current.boundary.status).toBe('ready'));
  act(() => result.current.selectDong(''));
  await waitFor(() => expect(result.current.boundary.status).toBe('ready'));
  expect(result.current.districtCode).toBe('00110');
  act(() => result.current.selectDong('00110001'));
  act(() => result.current.applyDistricts(['00140']));
  expect(result.current.dongCode).toBe('');
  await waitFor(() =>
    expect(result.current.dongs.data?.[0].districtCode).toBe('00140'),
  );
  act(() => result.current.applyDistricts([]));
  expect(result.current.dongCode).toBe('');
  expect(result.current.dongs.status).toBe('idle');
  expect(result.current.target).toEqual({ kind: 'default' });
});

test('느린 이전 구의 목록과 경계 응답이 최신 선택을 덮어쓰지 않는다', async () => {
  let finishDongs!: (value: Response) => void;
  let finishBoundary!: (value: Response) => void;
  const fetch = install({
    '/api/v1/districts/00110/dongs': () =>
      new Promise((resolve) => {
        finishDongs = resolve;
      }),
    '/api/v1/districts/00110/boundary': () =>
      new Promise((resolve) => {
        finishBoundary = resolve;
      }),
  });
  const { result } = renderHook(() => useRegionExplorer());
  await waitFor(() => expect(result.current.districts.status).toBe('ready'));
  act(() => result.current.applyDistricts(['00110']));
  expect(result.current.dongs.status).toBe('loading');
  act(() => result.current.applyDistricts(['00140']));
  await waitFor(() =>
    expect(result.current.target).toEqual({
      kind: 'boundary',
      extent: { west: 126.8, south: 37.5, east: 127.1, north: 37.6 },
      geometry: boundary('00140', 'DISTRICT', 126.8).geometry,
    }),
  );
  await act(async () => {
    finishDongs(response({ items: [dong('00110')] }));
    finishBoundary(response(boundary('00110')));
  });
  expect(result.current.districtCode).toBe('00140');
  expect(result.current.dongs.data?.[0].districtCode).toBe('00140');
  expect(result.current.target).toEqual({
    kind: 'boundary',
    extent: { west: 126.8, south: 37.5, east: 127.1, north: 37.6 },
    geometry: boundary('00140', 'DISTRICT', 126.8).geometry,
  });
  const oldCall = fetch.mock.calls.find(
    ([url]) => url === '/api/v1/districts/00110/dongs',
  )!;
  expect(oldCall[1]?.signal?.aborted).toBe(true);
});

test('오류 후 재시도·빈 목록·StrictMode 정리를 지원한다', async () => {
  let failed = true;
  install({
    '/api/v1/districts': async () =>
      failed
        ? new Response(JSON.stringify({ code: 'DATA_NOT_READY' }), {
            status: 503,
          })
        : response({ items: [] }),
  });
  const { result } = renderHook(() => useRegionExplorer(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    ),
  });
  await waitFor(() => expect(result.current.districts.status).toBe('error'));
  expect(result.current.districts.error).toContain('준비');
  failed = false;
  act(() => result.current.districts.retry());
  expect(result.current.districts.status).toBe('loading');
  await waitFor(() => expect(result.current.districts.data).toEqual([]));
  expect(result.current.districts.status).toBe('ready');
});

test('경계 오류는 선택을 유지하고 재시도하며 전체 선택 후 늦은 응답을 무시한다', async () => {
  let failure = true;
  let finish!: (value: Response) => void;
  install({
    '/api/v1/districts/00110/boundary': () =>
      failure
        ? Promise.resolve(new Response('{}', { status: 404 }))
        : new Promise((resolve) => {
            finish = resolve;
          }),
  });
  const { result } = renderHook(() => useRegionExplorer());
  await waitFor(() => expect(result.current.districts.status).toBe('ready'));
  act(() => result.current.applyDistricts(['00110']));
  await waitFor(() => expect(result.current.boundary.status).toBe('error'));
  expect(result.current.districtCode).toBe('00110');
  expect(result.current.target).toBeNull();
  failure = false;
  act(() => result.current.boundary.retry());
  act(() => result.current.applyDistricts([]));
  await act(async () => finish(response(boundary('00110'))));
  expect(result.current.target).toEqual({ kind: 'default' });
});

test('장소는 소속 동으로 분석하며 늦은 검색 응답보다 마지막 지역 필터가 우선한다', async () => {
  let finish!: (value: Response) => void;
  const nearby = (code: string) => ({
    districts: [
      { districtCode: code, districtName: '검색구', containsCenter: true },
    ],
    dongs: [{ ...dong(code), containsCenter: true }],
  });
  const pending =
    '/api/v1/regions/nearby?longitude=127.02&latitude=37.5&radiusM=1';
  const fetch = install({
    '/api/v1/regions/nearby?longitude=127.01&latitude=37.5&radiusM=1':
      async () => response(nearby('00140')),
    [pending]: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const { result } = renderHook(useRegionExplorer);
  await waitFor(() => expect(result.current.districts.status).toBe('ready'));
  act(() => result.current.applyDistricts(['00110']));
  await waitFor(() => expect(result.current.target?.kind).toBe('boundary'));
  act(() => result.current.selectPlace({ longitude: 127.01, latitude: 37.5 }));
  expect(result.current.target).toBeNull();
  expect(result.current.analysis.districtCode).toBe('');
  await waitFor(() =>
    expect(result.current.analysis.dongCode).toBe('00140001'),
  );
  expect(result.current.analysis.districtName).toBe('검색구');

  act(() => result.current.selectPlace({ longitude: 127.02, latitude: 37.5 }));
  expect(result.current.districtCodes).toEqual(['00110']);
  act(() => result.current.applyDistricts(['00140']));
  await act(async () => finish(response(nearby('00140'))));
  expect(
    fetch.mock.calls.find(([url]) => url === pending)?.[1]?.signal?.aborted,
  ).toBe(true);
  expect(result.current.analysis.districtCode).toBe('00140');
  expect(result.current.placeRegion.status).toBe('idle');
});

test('경계 위의 장소는 유일한 자치구만 사용하고 겹치는 자치구를 임의로 고르지 않는다', async () => {
  const containingDistricts = districts.map((item) => ({
    ...item,
    containsCenter: true,
  }));
  const containingDongs = [
    { ...dong('00110'), containsCenter: true },
    { ...dong('00110'), dongCode: '00110002', containsCenter: true },
  ];
  install({
    '/api/v1/regions/nearby?longitude=127.01&latitude=37.5&radiusM=1':
      async () =>
        response({
          districts: containingDistricts.slice(0, 1),
          dongs: containingDongs,
        }),
    '/api/v1/regions/nearby?longitude=127.02&latitude=37.5&radiusM=1':
      async () =>
        response({ districts: containingDistricts, dongs: containingDongs }),
  });
  const { result } = renderHook(useRegionExplorer);
  act(() => result.current.selectPlace({ longitude: 127.01, latitude: 37.5 }));
  await waitFor(() => expect(result.current.placeRegion.status).toBe('ready'));
  expect(result.current.analysis).toMatchObject({
    districtCode: '00110',
    dongCode: '',
  });

  act(() => result.current.selectPlace({ longitude: 127.02, latitude: 37.5 }));
  await waitFor(() => expect(result.current.placeRegion.status).toBe('ready'));
  expect(result.current.analysis).toMatchObject({
    districtCode: '',
    dongCode: '',
  });
});

test('두 구를 한 번만 맞추고 실패한 경계만 재시도하며 분석 지역은 별도 유지한다', async () => {
  const failedPath = '/api/v1/districts/00140/boundary';
  const validPath = '/api/v1/districts/00110/boundary';
  let fail = true;
  const fetch = install({
    [failedPath]: async () =>
      fail
        ? new Response(JSON.stringify({ code: 'DATA_NOT_READY' }), {
            status: 503,
          })
        : response(boundary('00140', 'DISTRICT', 126.8)),
  });
  const { result } = renderHook(useRegionExplorer);
  await waitFor(() => expect(result.current.districts.status).toBe('ready'));
  act(() => result.current.applyDistricts(['00140', '00110', '00140']));
  expect(result.current.districtCodes).toEqual(['00110', '00140']);
  expect(result.current.analysis.districtCode).toBe('');
  await waitFor(() => expect(result.current.boundary.status).toBe('error'));
  expect(result.current.overlays.map(({ key }) => key)).toEqual([
    'district:00110',
  ]);
  const geometry = result.current.overlays[0].geometry;
  expect(result.current.target).toBeNull();
  fail = false;
  act(() => result.current.boundaries[1].retry());
  await waitFor(() =>
    expect(result.current.target).toEqual({
      kind: 'bounds',
      extent: { west: 126.8, south: 37.5, east: 127.1, north: 37.6 },
    }),
  );
  expect(result.current.overlays[0].geometry).toBe(geometry);
  expect(fetch.mock.calls.filter(([path]) => path === validPath)).toHaveLength(
    1,
  );
  expect(fetch.mock.calls.filter(([path]) => path === failedPath)).toHaveLength(
    2,
  );
  const { target, cameraKey } = result.current;
  act(() => result.current.selectAnalysisDistrict('00140'));
  await waitFor(() =>
    expect(result.current.analysisDongs.status).toBe('ready'),
  );
  act(() => result.current.selectAnalysisDong('00110001'));
  expect(result.current.analysis.dongCode).toBe('');
  act(() => result.current.selectAnalysisDong('00140001'));
  expect(result.current.analysis.dongCode).toBe('00140001');
  expect(result.current.dongCode).toBe('');
  expect(result.current.target).toBe(target);
  expect(result.current.cameraKey).toBe(cameraKey);
  act(() => {
    expect(result.current.applyDistricts(['00110', '00140'])).toBe(false);
  });
  expect(result.current.cameraKey).toBe(cameraKey);
  act(() => result.current.applyDistricts(['00110']));
  expect(result.current.analysis.districtCode).toBe('00110');
  expect(result.current.analysis.dongCode).toBe('');
});
