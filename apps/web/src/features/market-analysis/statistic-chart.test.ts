import { describe, expect, it } from 'vitest';
import { BAR_AXIS_WIDTH, scaleStatisticBars } from './statistic-chart';

describe('scaleStatisticBars', () => {
  it('안전 정수 한계 아래·위의 값을 구분해 실제 최댓값을 사용한다', () => {
    const values = Object.freeze([
      '9007199254740992',
      '9007199254740991',
      '9007199254740993',
    ]);
    const { maximum, bars } = scaleStatisticBars(values);

    expect(maximum).toBe('9007199254740993');
    expect(bars.map((bar) => bar?.width)).toEqual([9999, 9999, BAR_AXIS_WIDTH]);
  });

  it('서로 다른 소수 자릿수를 맞추고 축 상한의 원본 후행 0을 보존한다', () => {
    const { maximum, bars } = scaleStatisticBars([
      '9007199254740993.123456789012345678899',
      '9007199254740993.123456789012345678900',
      '4503599627370496.5',
    ]);

    expect(maximum).toBe('9007199254740993.123456789012345678900');
    expect(bars.map((bar) => bar?.width)).toEqual([9999, BAR_AXIS_WIDTH, 4999]);
  });

  it('화면 좌표에서 구별하기 어려운 양수와 실제 0과 NULL을 구분한다', () => {
    const { maximum, bars } = scaleStatisticBars([
      '0.000000000000000000001',
      '0.0000',
      null,
      '9223372036854775807',
    ]);

    expect(maximum).toBe('9223372036854775807');
    expect(bars).toEqual([
      { width: 0, zero: false, tiny: true },
      { width: 0, zero: true, tiny: false },
      null,
      { width: BAR_AXIS_WIDTH, zero: false, tiny: false },
    ]);
  });

  it('모든 값이 0이면 기준점만 제공하고 모든 값이 NULL이면 축을 정하지 않는다', () => {
    expect(scaleStatisticBars(['0.0000', '0'])).toEqual({
      maximum: '0.0000',
      bars: [
        { width: 0, zero: true, tiny: false },
        { width: 0, zero: true, tiny: false },
      ],
    });
    expect(scaleStatisticBars([null, null])).toEqual({
      maximum: null,
      bars: [null, null],
    });
  });

  it('NULL을 제외한 그룹 상한에서 나머지 값의 선형 길이를 독립적으로 계산한다', () => {
    const { maximum, bars } = scaleStatisticBars(['3', null, '12']);

    expect(maximum).toBe('12');
    expect(bars.map((bar) => bar?.width ?? null)).toEqual([
      2500,
      null,
      BAR_AXIS_WIDTH,
    ]);
  });
});
