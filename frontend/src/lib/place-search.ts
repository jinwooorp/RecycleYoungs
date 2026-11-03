import type { KakaoMaps, KakaoSearchCallback } from './kakao-maps';

export interface PlaceSearchResult {
  id: string;
  name: string;
  address: string;
  kind: string;
  longitude: number;
  latitude: number;
  isSeoul: boolean;
}
export interface PlaceSearchPage {
  items: PlaceSearchResult[];
  hasMore: boolean;
  partial: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
function coordinate(value: unknown, max: number) {
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value))
    return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= max ? number : null;
}

/** 건물명 유사 검색은 승격하지 않고 도로명·지번과 번지까지 일치하는 주소만 우선합니다. */
function matchesAddress(row: unknown, query: string) {
  if (
    !record(row) ||
    !/(?:로|길|동|읍|면|리|가)\s*(?:(?:산|지하)\s*)?\d+(?:\s*-\s*\d+)?$/.test(
      query,
    )
  )
    return false;
  const key = (value: string) =>
    value
      .replace(/^서울특별시/, '서울')
      .replace(/^서울시(?=\s)/, '서울')
      .replace(/\s+/g, '');
  const road = record(row.road_address) ? row.road_address : null;
  const lot = record(row.address) ? row.address : null;
  return [row.address_name, road?.address_name, lot?.address_name].some(
    (value) => {
      const parts = text(value).split(/\s+/);
      // 생략된 시·구는 허용하되 도로명 일부나 다른 번지를 부분 일치로 취급하지 않습니다.
      return parts.some(
        (_, index) => key(parts.slice(index).join(' ')) === key(query),
      );
    },
  );
}

function normalize(
  row: unknown,
  addressSearch: boolean,
): PlaceSearchResult | null {
  if (!record(row)) return null;
  const longitude = coordinate(row.x, 180);
  const latitude = coordinate(row.y, 90);
  if (longitude === null || latitude === null) return null;
  const road = record(row.road_address) ? row.road_address : null;
  const lot = record(row.address) ? row.address : null;
  const roadName = addressSearch
    ? text(road?.address_name)
    : text(row.road_address_name);
  const address =
    roadName ||
    (addressSearch ? text(lot?.address_name) : '') ||
    text(row.address_name);
  const name = addressSearch
    ? text(road?.building_name) || address
    : text(row.place_name);
  if (!name) return null;
  return {
    id: addressSearch
      ? `address:${longitude}:${latitude}:${address}`
      : `place:${text(row.id) || `${longitude}:${latitude}:${name}`}`,
    name,
    address: address || '주소 정보가 없습니다.',
    kind: addressSearch
      ? roadName
        ? '도로명주소'
        : '지번주소'
      : text(row.category_group_name) || text(row.category_name) || '장소',
    longitude,
    latitude,
    isSeoul: /^(?:서울특별시|서울)(?:\s|$)/.test(address),
  };
}

interface ServicePage {
  rows: unknown[];
  hasMore: boolean;
  failed: boolean;
}

/** SDK 콜백에는 취소 API가 없으므로 늦은 중복 콜백과 시간 초과를 이 호출 안에서 격리합니다. */
function invoke(
  maps: KakaoMaps,
  request: (callback: KakaoSearchCallback) => void,
): Promise<ServicePage> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (page: ServicePage) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(page);
    };
    const timer = window.setTimeout(
      () => finish({ rows: [], hasMore: false, failed: true }),
      10_000,
    );
    try {
      request((rows, status, pagination) => {
        if (status === maps.services.Status.ZERO_RESULT)
          finish({ rows: [], hasMore: false, failed: false });
        else if (status === maps.services.Status.OK && Array.isArray(rows))
          finish({
            rows,
            hasMore: pagination?.hasNextPage === true,
            failed: false,
          });
        else finish({ rows: [], hasMore: false, failed: true });
      });
    } catch {
      finish({ rows: [], hasMore: false, failed: true });
    }
  });
}

/** 키워드·주소 각각 첫 페이지를 정규화하며, 서울을 우선하되 서울 밖 좌표도 그대로 유지합니다. */
export async function searchPlaces(
  maps: KakaoMaps,
  query: string,
): Promise<PlaceSearchPage> {
  const keyword = query.trim();
  if (!keyword) throw new Error('검색어를 입력해 주세요.');
  if (
    !maps.services?.Places ||
    !maps.services.Geocoder ||
    !maps.services.Status ||
    !maps.services.SortBy
  )
    throw new Error(
      '검색 서비스를 불러오지 못했습니다. 지도를 다시 시도해 주세요.',
    );
  const pages = await Promise.all([
    invoke(maps, (callback) =>
      new maps.services.Places().keywordSearch(keyword, callback, {
        sort: maps.services.SortBy.ACCURACY,
        size: 15,
        page: 1,
      }),
    ),
    invoke(maps, (callback) =>
      new maps.services.Geocoder().addressSearch(keyword, callback, {
        size: 15,
        page: 1,
      }),
    ),
  ]);
  let partial = pages.some((page) => page.failed);
  const items: PlaceSearchResult[] = [];
  const exactAddresses = new Set<string>();
  const sameText = (value: string) =>
    value.replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
  for (const [index, page] of pages.entries()) {
    for (const row of page.rows) {
      const item = normalize(row, index === 1);
      if (!item) {
        partial = true;
        continue;
      }
      // 동일 건물의 서로 다른 상호는 보존하고, 주소 결과만 같은 위치·주소의 기존 장소와 합칩니다.
      const duplicateIndex = items.findIndex(
        (existing) =>
          existing.id === item.id ||
          (existing.longitude.toFixed(6) === item.longitude.toFixed(6) &&
            existing.latitude.toFixed(6) === item.latitude.toFixed(6) &&
            (sameText(existing.name) === sameText(item.name) ||
              (index === 1 &&
                sameText(existing.address) === sameText(item.address)))),
      );
      // 주소 검색에서는 같은 좌표의 개별 상호 대신 정확한 주소를 대표 결과로 남깁니다.
      if (index === 1 && matchesAddress(row, keyword)) {
        exactAddresses.add(item.id);
        if (duplicateIndex !== -1) items[duplicateIndex] = item;
      }
      if (duplicateIndex === -1) {
        items.push(item);
      }
    }
  }
  if (partial && items.length === 0)
    throw new Error(
      '장소·주소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    );
  items.sort(
    (a, b) =>
      Number(b.isSeoul) - Number(a.isSeoul) ||
      Number(exactAddresses.has(b.id)) - Number(exactAddresses.has(a.id)),
  );
  return {
    items: items.slice(0, 15),
    hasMore: items.length > 15 || pages.some((page) => page.hasMore),
    partial,
  };
}
