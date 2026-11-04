import { useEffect, useEffectEvent } from 'react';
import type { KakaoMapContext, KakaoMouseEvent } from '@/lib/kakao-maps';
import type { Candidate, CandidateSlot } from '@/lib/candidates';
import type { CafeCenter } from '@/lib/cafes';

export function useCandidateMap(
  context: KakaoMapContext | null,
  items: Candidate[],
  selected: CandidateSlot | null,
  picking: boolean,
  select: (item: Candidate) => void,
  add: (center: CafeCenter) => void,
) {
  const selectCandidate = useEffectEvent(select);
  const addCandidate = useEffectEvent(add);

  useEffect(() => {
    if (!context) return;
    const { maps, map } = context;
    const overlays = items.map((item) => {
      const color = item.slot === selected ? '#4338CA' : '#475569';
      // 표식에는 검증된 A·B·C 슬롯만 넣고 사용자 이름은 SDK 제목으로 전달합니다.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="42" viewBox="0 0 40 42"><path d="M20 41 12 31H4V1H36V31H28Z" fill="${color}" stroke="white" stroke-width="2"/><text x="20" y="22" text-anchor="middle" font-family="sans-serif" font-size="19" font-weight="bold" fill="white">${item.slot}</text></svg>`;
      const marker = new maps.Marker({
        position: new maps.LatLng(item.latitude, item.longitude),
        title: `후보지 ${item.slot}: ${item.name}`,
        zIndex: item.slot === selected ? 7 : 6,
        clickable: true,
        image: new maps.MarkerImage(
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          new maps.Size(40, 42),
          { offset: new maps.Point(20, 42) },
        ),
      });
      const click = () => {
        maps.event.preventMap();
        selectCandidate(item);
      };
      maps.event.addListener(marker, 'click', click);
      marker.setMap(map);
      return { marker, click };
    });
    return () => {
      for (const { marker, click } of overlays) {
        maps.event.removeListener(marker, 'click', click);
        marker.setMap(null);
      }
    };
  }, [context, items, selected]);

  useEffect(() => {
    if (!context || !picking) return;
    const { maps, map } = context;
    const click = (event?: KakaoMouseEvent) => {
      if (event?.latLng)
        addCandidate({
          longitude: event.latLng.getLng(),
          latitude: event.latLng.getLat(),
        });
    };
    maps.event.addListener(map, 'click', click);
    return () => maps.event.removeListener(map, 'click', click);
  }, [context, picking]);
}
