import { useCallback } from 'react';
import { useRegionRequest } from './use-region-explorer';
import { useStatisticsExplorer } from './use-statistics-explorer';
import { fetchContainingRegions } from '@/lib/regions';
import { fetchNearbyCafes, type CafeRadius } from '@/lib/cafes';
import type { Candidate } from '@/lib/candidates';

/** 표시 이름과 분리한 좌표 키로 소속·반경 조회의 수명을 관리합니다. */
function useCandidateLocation(
  item: Candidate | undefined,
  radius: CafeRadius,
  active: boolean,
) {
  const longitude = item?.longitude ?? 0;
  const latitude = item?.latitude ?? 0;
  const key = active && item ? `${longitude}:${latitude}` : null;
  const regions = useRegionRequest(
    key,
    useCallback(
      (signal) => fetchContainingRegions(longitude, latitude, signal),
      [longitude, latitude],
    ),
  );
  const districts = regions.data?.districts ?? [];
  const dongs = regions.data?.dongs ?? [];
  const soleDistrict = districts.length === 1 ? districts[0] : null;
  const soleDong = dongs.length === 1 ? dongs[0] : null;
  const dong =
    soleDistrict && soleDong?.districtCode === soleDistrict.districtCode
      ? soleDong
      : null;
  const cafes = useRegionRequest(
    key && districts.length ? `${key}:${radius}` : null,
    useCallback(
      (signal) => fetchNearbyCafes({ longitude, latitude }, radius, signal),
      [longitude, latitude, radius],
    ),
  );
  const unavailable =
    regions.status === 'idle'
      ? '소속 확인 대기 중'
      : regions.status === 'loading'
        ? '소속 확인 중'
        : regions.status === 'error'
          ? '소속 확인 실패'
          : !districts.length
            ? '서울 경계 밖'
            : districts.length > 1
              ? '여러 자치구 경계에 걸쳐 있어 행정동 통계를 비교할 수 없습니다.'
              : soleDong && !dong
                ? '자치구와 행정동의 소속 코드가 일치하지 않아 비교할 수 없습니다.'
                : '여러 행정동 경계 또는 소속 행정동 미확인으로 통계를 비교할 수 없습니다.';
  return { item, regions, cafes, dong, unavailable };
}

/** 고정된 A·B·C 슬롯의 조회를 유지하고 같은 행정동의 통계는 한 응답을 공유합니다. */
export function useCandidateAnalysis(
  items: Candidate[],
  radius: CafeRadius,
  active: boolean,
) {
  const a = useCandidateLocation(
    items.find((item) => item.slot === 'A'),
    radius,
    active,
  );
  const b = useCandidateLocation(
    items.find((item) => item.slot === 'B'),
    radius,
    active,
  );
  const c = useCandidateLocation(
    items.find((item) => item.slot === 'C'),
    radius,
    active,
  );
  const locations = [a, b, c];
  // 같은 행정동은 먼저 등장한 슬롯만 조회합니다. 삭제·새 좌표의 늦은 응답은 요청 키로 차단합니다.
  const codes = locations.map((location, index) =>
    location.dong &&
    !locations
      .slice(0, index)
      .some((other) => other.dong?.dongCode === location.dong!.dongCode)
      ? location.dong.dongCode
      : '',
  );
  const first = useStatisticsExplorer('', codes[0], active);
  const second = useStatisticsExplorer('', codes[1], active);
  const third = useStatisticsExplorer('', codes[2], active);
  const statistics = [first, second, third];
  return locations.flatMap((location) =>
    location.item
      ? [
          {
            ...location,
            item: location.item,
            statistics: location.dong
              ? statistics[codes.indexOf(location.dong.dongCode)]
              : null,
          },
        ]
      : [],
  );
}

export type CandidateAnalysis = ReturnType<typeof useCandidateAnalysis>[number];
