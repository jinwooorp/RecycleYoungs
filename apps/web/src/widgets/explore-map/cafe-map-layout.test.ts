import { expect, test } from 'vitest';
import {
  boxesOverlap,
  cafeWindowBounds,
  fitCafeWindow,
} from './cafe-map-layout';

test('SDK 바깥 프레임과 아래쪽 꼬리까지 정보창 크기로 사용한다', () => {
  const map = document.createElement('div');
  const frame = document.createElement('div');
  const tail = document.createElement('div');
  const wrapper = document.createElement('div');
  const content = document.createElement('div');
  content.getBoundingClientRect = () => new DOMRect(14, 16, 224, 120);
  wrapper.getBoundingClientRect = () => new DOMRect(14, 16, 224, 120);
  frame.getBoundingClientRect = () => new DOMRect(13, 15, 224, 120);
  tail.getBoundingClientRect = () => new DOMRect(120, 135, 11, 9);
  wrapper.append(content);
  frame.append(tail, wrapper);
  map.append(frame);
  expect(cafeWindowBounds(content, map)).toEqual({
    left: 13,
    top: 15,
    right: 238,
    bottom: 144,
  });
});

test.each([
  [-40, 120, 12, 120],
  [370, 120, 288, 120],
  [120, -80, 120, 12],
  [120, 290, 120, 196],
])(
  '정보창을 지도 바깥에서 가장 가까운 안전한 위치로 옮긴다',
  (left, top, x, y) => {
    const card = { left, top, right: left + 100, bottom: top + 80 };
    expect(fitCafeWindow(card, new DOMRect(0, 0, 400, 300), [])).toMatchObject({
      left: x,
      top: y,
    });
  },
);

test('도구와 패널 사각형을 피하고 공간이 없을 때만 패널 상단 여유가 필요하다', () => {
  const card = new DOMRect(600, 210, 225, 180);
  const map = new DOMRect(0, 0, 1440, 900);
  const panel = new DOMRect(258, 78, 924, 720);
  const search = new DOMRect(68, 16, 368, 48);
  const filter = new DOMRect(1290, 16, 135, 48);
  const fitted = fitCafeWindow(card, map, [panel, search, filter])!;
  expect(fitted.right).toBe(246);
  expect(boxesOverlap(fitted, panel, 12)).toBe(false);
  const narrowMap = new DOMRect(0, 0, 320, 568);
  const narrowPanel = new DOMRect(12, 180, 296, 286);
  const mobileTools = [
    new DOMRect(68, 12, 240, 48),
    new DOMRect(166, 72, 142, 44),
  ];
  expect(
    fitCafeWindow(card, narrowMap, [...mobileTools, narrowPanel]),
  ).toBeNull();
  const above = fitCafeWindow(card, narrowMap, mobileTools, true)!;
  expect(above.top).toBe(128);
  expect(above.bottom).toBe(308);
});
