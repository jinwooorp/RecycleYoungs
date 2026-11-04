import { useCallback, useEffect, useRef, useState } from 'react';
import type { KakaoMaps } from '@/lib/kakao-maps';
import {
  requestCurrentPosition,
  verifySeoulLocation,
  type PositionResult,
} from '@/lib/current-location';

/** 지도 SDK와 위치 응답 순서에 의존하지 않으며 StrictMode에서는 같은 위치 요청을 구독합니다. */
export function useCurrentLocation(maps: KakaoMaps | null) {
  const [attempt, setAttempt] = useState(0);
  const options = useRef({ attempt: 0, intent: 0, automatic: true });
  const job = useRef<{
    attempt: number;
    promise: Promise<PositionResult>;
  } | null>(null);
  const inFlight = useRef(true);
  const completed = useRef<number | null>(null);
  const [result, setResult] = useState<
    | (PositionResult & { attempt: number; intent: number; automatic: boolean })
    | null
  >(null);
  useEffect(() => {
    if (completed.current === attempt) return;
    const request = options.current;
    if (job.current?.attempt !== attempt)
      job.current = { attempt, promise: requestCurrentPosition() };
    const controller = new AbortController();
    void job.current.promise.then(async (position) => {
      if (controller.signal.aborted) return;
      if (position.point && !maps) return;
      let outcome = position;
      if (position.point && maps) {
        try {
          const region = await verifySeoulLocation(
            maps,
            position.point,
            controller.signal,
          );
          outcome =
            region === 'seoul'
              ? position
              : {
                  point: null,
                  reason: region === 'outside' ? 'outside' : 'verification',
                };
        } catch {
          return;
        }
      }
      if (!controller.signal.aborted) {
        completed.current = attempt;
        inFlight.current = false;
        setResult({ ...outcome, ...request });
      }
    });
    return () => controller.abort();
  }, [attempt, maps]);
  const request = useCallback((beginIntent: () => number) => {
    // React가 비활성 버튼을 렌더링하기 전의 연속 입력도 중복 요청으로 만들지 않습니다.
    if (inFlight.current) return;
    inFlight.current = true;
    options.current = {
      attempt: options.current.attempt + 1,
      intent: beginIntent(),
      automatic: false,
    };
    setAttempt(options.current.attempt);
  }, []);
  const current = result?.attempt === attempt ? result : null;
  return { result: current, pending: current === null, request };
}
