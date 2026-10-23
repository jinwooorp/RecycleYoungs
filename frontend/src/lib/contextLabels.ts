export function exactContextNumber(value: string | null) {
  if (value === null) return '원천 값 미제공'
  const [integer,decimal] = value.split('.')
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decimal === undefined?'':`.${decimal}`)
}
export const contextNames = {population:'활동인구',residents:'상주인구·가구',workers:'직장인구',facilities:'시설 종류',change:'상권 변화 참고',consumption:'지역 소비 자료'}
const names: Record<string,string> = {
  TOT_HSHLD_CO:'전체 가구 수',PBLOFC_CO:'관공서',BANK_CO:'은행',GEHSPT_CO:'종합병원',GNRL_HSPTL_CO:'일반병원',PARMACY_CO:'약국',
  KNDRGR_CO:'유치원',ELESCH_CO:'초등학교',MSKUL_CO:'중학교',HGSCHL_CO:'고등학교',UNIV_CO:'대학교',DRTS_CO:'백화점',SUPMK_CO:'슈퍼마켓',
  THEAT_CO:'극장',STAYNG_FCLTY_CO:'숙박시설',ARPRT_CO:'공항',RLROAD_STATN_CO:'철도역',BUS_TRMINL_CO:'버스터미널',SUBWAY_STATN_CO:'지하철역',BUS_STTN_CO:'버스정거장',
  OPR_SALE_MT_AVRG:'행정동 운영 영업 개월 평균',CLS_SALE_MT_AVRG:'행정동 폐업 영업 개월 평균',
  SU_OPR_SALE_MT_AVRG:'서울 운영 영업 개월 평균',SU_CLS_SALE_MT_AVRG:'서울 폐업 영업 개월 평균',
}
export const salesCodeNames: Record<string,string> = {
  MDWK:'주중',WKEND:'주말',MON:'월요일',TUES:'화요일',WED:'수요일',THUR:'목요일',FRI:'금요일',SAT:'토요일',SUN:'일요일',
  ML:'남성',FML:'여성','10':'10대','20':'20대','30':'30대','40':'40대','50':'50대','60_ABOVE':'60대 이상',
}
export function contextMetricName(field: string) {
  if (names[field]) return names[field]
  const prefix = field.replace(/_(FLPOP_CO|REPOP_CO|WRC_POPLTN_CO)$/, '')
  if (prefix === 'TOT') return '전체'
  if (prefix === 'ML' || prefix === 'FML') return salesCodeNames[prefix]
  if (prefix.startsWith('TMZON_')) return `${prefix.slice(6).replace('_','~')}시`
  if (/^(AGRDE|MAG|FAG)_/.test(prefix)) {
    const age = prefix.replace(/^(AGRDE|MAG|FAG)_/,'')
    return `${prefix.startsWith('MAG_')?'남성 ':prefix.startsWith('FAG_')?'여성 ':''}${salesCodeNames[age] ?? age}`
  }
  return salesCodeNames[prefix] ?? field
}
export const contextReasons: Record<string,string> = {
  OBSERVATION_DATE_UNKNOWN:'실제 관측일을 확인하지 못했습니다.',AGGREGATION_UNVERIFIED:'원천의 집계 방식·기간 내 중복을 확인하지 못했습니다. 고유 고객 수나 일평균으로 해석하지 마세요.',
  ANNUAL_REPEAT:'연간 자료가 여러 분기에 반복될 수 있습니다.',COVERAGE_GAP:'직장인구는 일부 행정동의 집계 행이 없습니다.',
  TOTAL_DEFINITION_UNVERIFIED:'시설 종류별 값은 더해서 총수나 밀도로 계산하지 않습니다.',
  SOURCE_CONFLICT:'음수 자료와 원천 정의 충돌이 확인돼 지역 소비 수치를 공개하지 않습니다.',QUALITY_WITHHELD:'품질 검증 전까지 전체 보류합니다.',
}
