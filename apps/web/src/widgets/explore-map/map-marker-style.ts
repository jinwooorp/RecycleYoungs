import type { CandidateSlot } from '@/entities/candidate/candidates';
import type { KakaoMaps } from '@/shared/kakao/kakao-maps';

// MarkerImage의 독립 SVG는 문서의 CSS 변수를 상속하지 않습니다.
const primary = '#173629';
const action = '#8be26e';
const candidateSelected = '#4338ca';
export const radiusColor = '#23513f';

type MarkerImage = InstanceType<KakaoMaps['MarkerImage']>;
type MarkerKind = 'cafe' | 'cafe-selected' | 'radius' | 'search';
type ImageKey = MarkerKind | CandidateSlot | `${CandidateSlot}-selected`;
const cache = new WeakMap<KakaoMaps, Map<ImageKey, MarkerImage>>();

function image(
  maps: KakaoMaps,
  key: ImageKey,
  width: number,
  height: number,
  content: string,
) {
  let images = cache.get(maps);
  if (!images) {
    images = new Map();
    cache.set(maps, images);
  }
  const existing = images.get(key);
  if (existing) return existing;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
  const marker = new maps.MarkerImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    new maps.Size(width, height),
    { offset: new maps.Point(width / 2, height) },
  );
  images.set(key, marker);
  return marker;
}

const cafePin = 'M14 32C11 28 2 22 2 14a12 12 0 1 1 24 0c0 8-9 14-12 18Z';
const placePin = 'M16 39C12 33 2 25 2 16a14 14 0 0 1 28 0c0 9-10 17-14 23Z';

export function cafeMarkerImages(maps: KakaoMaps) {
  const cup =
    '<path d="M8.5 10.5h9v4a4.5 4.5 0 0 1-9 0v-4Zm9 1H19a2 2 0 0 1 0 4h-1.6M9 21.5h10" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  return {
    normal: image(
      maps,
      'cafe',
      28,
      34,
      `<path d="${cafePin}" fill="${primary}" stroke="white" stroke-width="1.5"/>${cup}`,
    ),
    selected: image(
      maps,
      'cafe-selected',
      28,
      34,
      `<path d="${cafePin}" fill="${primary}" stroke="white" stroke-width="3"/><path d="${cafePin}" fill="none" stroke="${action}" stroke-width="1.4"/>${cup}`,
    ),
  };
}

export function candidateMarkerImage(
  maps: KakaoMaps,
  slot: CandidateSlot,
  selected: boolean,
) {
  const pin =
    'M20 41 13 32H10a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5h20a5 5 0 0 1 5 5v20a5 5 0 0 1-5 5h-3Z';
  const fill = selected ? candidateSelected : '#475569';
  const inset = selected
    ? '<rect x="9" y="6" width="22" height="22" rx="3" fill="none" stroke="white" stroke-width="1.5"/>'
    : '';
  // 이름 대신 검증된 A·B·C 슬롯만 SVG에 넣습니다.
  return image(
    maps,
    selected ? `${slot}-selected` : slot,
    40,
    42,
    `<path d="${pin}" fill="${fill}" stroke="white" stroke-width="2" stroke-linejoin="round"/>${inset}<text x="20" y="23" text-anchor="middle" font-family="sans-serif" font-size="17" font-weight="700" fill="white">${slot}</text>`,
  );
}

export function radiusMarkerImage(maps: KakaoMaps) {
  return image(
    maps,
    'radius',
    32,
    40,
    `<path d="${placePin}" fill="${radiusColor}" stroke="white" stroke-width="2"/><circle cx="16" cy="16" r="7" fill="none" stroke="white" stroke-width="1.7"/><path d="M16 6v6m0 8v6M6 16h6m8 0h6" stroke="white" stroke-width="1.7" stroke-linecap="round"/><circle cx="16" cy="16" r="2" fill="white"/>`,
  );
}

export function searchMarkerImage(maps: KakaoMaps) {
  return image(
    maps,
    'search',
    32,
    40,
    `<path d="${placePin}" fill="#b45309" stroke="white" stroke-width="2"/><circle cx="14" cy="14" r="6" fill="none" stroke="white" stroke-width="2"/><path d="m18.5 18.5 6 6" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`,
  );
}
