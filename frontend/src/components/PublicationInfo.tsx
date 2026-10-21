import type { PublicationMetadata } from '../types/api'
import { DataIdentifiers } from './DataProvenance'

export function PublicationInfo({ metadata }: { metadata?: PublicationMetadata }) {
  if (!metadata) return <p className="text-sm text-muted-foreground">이 자료에는 공개 버전과 수집 시각 정보가 없습니다. 원자료 기준일·완전성은 미검증입니다.</p>
  return <div className="flex flex-col gap-2 text-sm text-muted-foreground">
    <p>점포 자료 기준년월: {metadata.storeReferenceMonth.slice(0, 4)}년 {Number(metadata.storeReferenceMonth.slice(4))}월. 통계 분기와 다르며 실제 영업 관측일·완전성을 보장하지 않습니다.</p>
    <p>자료 묶음의 최종 수집 종료: {new Date(metadata.collectedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국 시간). 원천별 수집 시각·실제 관측일은 다를 수 있습니다.</p>
    <DataIdentifiers><p className="break-all">공개 자료 버전: {metadata.dataVersion}</p><p>점포 수집 범위: {metadata.storeScope === 'I21201' ? '서울 카페' : '서울 전체 업종'} · 원천 snapshot 확인 상태: UNVERIFIED</p></DataIdentifiers>
  </div>
}
