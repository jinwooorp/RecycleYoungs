import type { BoundaryMatch } from '../types/location'
export function boundaryRelation(match: BoundaryMatch) {
  return `${match.pointRelation === 'BOUNDARY' ? '지도 경계선 위의 지점입니다.' : '지도 경계 안에 포함된 지점입니다.'} ${match.qualityStatus === 'REPAIRED_OPERATIONAL' ? '원자료의 도형 문제를 보완한 경계를 사용했습니다.' : '원자료의 경계를 사용했습니다.'}`
}
