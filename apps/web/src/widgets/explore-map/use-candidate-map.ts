import { useEffect, useEffectEvent, useRef } from 'react';
import type {
  KakaoMapContext,
  KakaoMarker,
  KakaoMouseEvent,
} from '@/shared/kakao/kakao-maps';
import type { Candidate, CandidateSlot } from '@/entities/candidate/candidates';
import type { CafeCenter } from '@/entities/cafe/cafes';
import { candidateMarkerImage } from './map-marker-style';

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
  const readSelection = useEffectEvent(() => selected);
  const markers = useRef<{ marker: KakaoMarker; slot: CandidateSlot }[]>([]);
  const previousSelection = useRef<CandidateSlot | null>(null);

  useEffect(() => {
    if (!context || picking) return;
    const { maps, map } = context;
    const selected = readSelection();
    previousSelection.current = selected;
    const overlays = items.map((item) => {
      const active = item.slot === selected;
      const marker = new maps.Marker({
        position: new maps.LatLng(item.latitude, item.longitude),
        title: `후보지 ${item.slot}: ${item.name}`,
        zIndex: active ? 7 : 6,
        clickable: true,
        image: candidateMarkerImage(maps, item.slot, active),
      });
      const click = () => {
        maps.event.preventMap();
        selectCandidate(item);
      };
      maps.event.addListener(marker, 'click', click);
      marker.setMap(map);
      return { marker, click, slot: item.slot };
    });
    markers.current = overlays;
    return () => {
      markers.current = [];
      for (const { marker, click } of overlays) {
        maps.event.removeListener(marker, 'click', click);
        marker.setMap(null);
      }
    };
  }, [context, items, picking]);

  useEffect(() => {
    const previous = previousSelection.current;
    if (!context || previous === selected) return;
    previousSelection.current = selected;
    for (const entry of markers.current) {
      if (entry.slot !== previous && entry.slot !== selected) continue;
      const active = entry.slot === selected;
      entry.marker.setImage(
        candidateMarkerImage(context.maps, entry.slot, active),
      );
      entry.marker.setZIndex(active ? 7 : 6);
    }
  }, [context, selected]);

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
