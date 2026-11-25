import type { Cafe } from './cafes';

const brands = [
  ['컴포즈커피', 'COMPOSE COFFEE'],
  ['메가MGC커피', '메가커피', 'MEGA MGC COFFEE', 'MEGA COFFEE'],
  ['더벤티', 'THE VENTI'],
  ['스타벅스', 'STARBUCKS COFFEE', 'STARBUCKS'],
  ['투썸플레이스', 'A TWOSOME PLACE', 'TWOSOME PLACE'],
  ['이디야커피', '이디야', 'EDIYA COFFEE', 'EDIYA'],
  ['빽다방', "PAIK'S COFFEE", 'PAIKS COFFEE'],
];

function normalize(name: string) {
  return name.normalize('NFKC').trim().toUpperCase().replaceAll('’', "'");
}

function compact(name: string) {
  return normalize(name).replace(/\s+/g, '');
}

// 별칭 목록은 한글·영숫자·아포스트로피로 구성됩니다.
const patterns = brands.map(([brand, ...aliases]) => ({
  brand,
  aliases: [brand, ...aliases].map(
    (alias) => new RegExp(`^${[...compact(alias)].join('\\s*')}`),
  ),
}));

export function inferCafeBrand({
  storeName,
  branchName,
}: Pick<Cafe, 'storeName' | 'branchName'>) {
  const name = normalize(storeName);
  for (const { brand, aliases } of patterns) {
    for (const pattern of aliases) {
      const prefix = name.match(pattern)?.[0];
      if (!prefix) continue;
      const tail = name.slice(prefix.length);
      if (!tail) return brand;
      const branch = tail
        .trim()
        .replace(/^(?:·|-|\(|\[)\s*|[)\]]$/g, '')
        .trim();
      if (
        (branch && branchName && compact(branch) === compact(branchName)) ||
        (/^(?:\s|·|-|\(|\[)/.test(tail) && /^[가-힣A-Z0-9]+점$/.test(branch))
      )
        return brand;
    }
  }
  return null;
}

export function cafeBrandLabel(cafe: Pick<Cafe, 'storeName' | 'branchName'>) {
  const brand = inferCafeBrand(cafe);
  return brand ? `브랜드 추정 · ${brand}` : '브랜드 여부 미확인';
}
