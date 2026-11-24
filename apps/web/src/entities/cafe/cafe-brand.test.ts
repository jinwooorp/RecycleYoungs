import { expect, test } from 'vitest';
import { cafeBrandLabel, inferCafeBrand } from './cafe-brand';

test.each([
  ['컴포즈커피', null, '컴포즈커피'],
  ['컴포즈 커피 (홍대점)', null, '컴포즈커피'],
  ['컴포즈커피마포역', '마포역', '컴포즈커피'],
  ['compose coffee', '광화문점', '컴포즈커피'],
  ['메가ＭＧＣ 커피 강남점', null, '메가MGC커피'],
  ['메가커피', null, '메가MGC커피'],
  ['THE  VENTI', null, '더벤티'],
  ['스타벅스 - 성수점', null, '스타벅스'],
  ['STARBUCKS COFFEE', null, '스타벅스'],
  ['투썸플레이스 (시청점)', null, '투썸플레이스'],
  ['이디야커피', null, '이디야커피'],
  ['Paik’s Coffee', null, '빽다방'],
])(
  '%s와 지점명에서 허용된 브랜드를 추정한다',
  (storeName, branchName, brand) => {
    const cafe = { storeName, branchName };
    expect(inferCafeBrand(cafe)).toBe(brand);
    expect(cafeBrandLabel(cafe)).toBe(`브랜드 추정 · ${brand}`);
  },
);

test.each([
  '우리동네 스타벅스 옆 카페',
  '스타벅스터',
  '메가커피공방',
  '메가커피하우스',
  '컴포즈카페',
  '투썸플레이스랩 전시점',
  '스타벅스 원두 판매점',
  '스타벅스굿즈판매점',
  '이디야커피합정LIG점',
  '별빛 상점',
])('%s의 브랜드 여부를 미확인으로 남긴다', (storeName) => {
  expect(cafeBrandLabel({ storeName, branchName: null })).toBe(
    '브랜드 여부 미확인',
  );
});
