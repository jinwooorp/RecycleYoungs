/** 기존 CLI 도움말을 명령 안내 순서대로 출력합니다. */
export function printHelp(): void {
  console.log(
    '사용법:\n  npm run dev -- cafes [--probe] --industry-code <공식 카페 코드> --industry-name <공식 명칭> [--expected-rows <전체 건수>]\n  npm run dev -- boundaries --source /절대경로/경계.zip --expected-dongs 425 --expected-districts 25\n  npm run dev -- industries --source /절대경로/점포.csv --sales-source /절대경로/매출.csv --expected-industries 100\n  npm run dev -- stores --source /절대경로/점포.csv --expected-rows 211832\n  npm run dev -- sales --source /절대경로/매출.csv --expected-rows 100431\n  npm run dev -- foot-traffic --source /절대경로/유동인구.csv --expected-rows 9350\n.shp 입력은 같은 이름의 .dbf/.prj/.cpg가 필요합니다. 업종·점포·추정매출·유동인구 입력은 CSV 또는 CSV 한 개를 담은 ZIP이며 --sales-source는 업종 명령의 선택 인자입니다. 건수는 입력 버전에 맞게 지정하세요.',
  );
  console.log(
    '  npm run dev -- district-stores [--probe] --source /절대경로/자치구점포.csv --expected-rows <원본 전체 행 수>\n자치구 점포는 CSV/단일 CSV ZIP을 적재하며 --probe에서는 DB 설정·접속·배치 생성·적재를 하지 않습니다.',
  );
  console.log(
    '  npm run dev -- district-sales [--probe] --source /절대경로/자치구매출.csv --expected-rows <원본 전체 행 수>\n자치구 추정매출은 CSV/단일 CSV ZIP을 적재하며 --probe에서는 DB 설정·접속·배치 생성·적재·네트워크 요청을 하지 않습니다.',
  );
  console.log(
    '  npm run dev -- district-foot-traffic [--probe] --source /절대경로/자치구인구.csv --expected-rows <원본 전체 행 수>\n자치구 길단위인구는 CSV/단일 CSV ZIP을 적재하며 --probe에서는 DB·배치·적재·네트워크 요청을 사용하지 않습니다.',
  );
  console.log(
    '  npm run dev -- district-foot-traffic --api --probe [--allow-insecure-http] [--expected-rows <API 전체 행 수>] [--compare-csv /절대경로/자치구인구.csv]\n공식 HTTP 주소에 SEOUL_OPEN_API_KEY를 보내려면 --allow-insecure-http가 필요합니다. HTTP에서는 키와 응답이 암호화되지 않습니다. 이 검증은 DB·배치·적재를 사용하지 않습니다.',
  );
  console.log(
    '  npm run dev -- district-foot-traffic --api --publish [--allow-insecure-http] --expected-rows <API 전체 행 수>\nAPI 게시는 SEOUL_OPEN_API_KEY와 로컬 DATABASE_URL을 사용합니다. 전체 수집 검증 뒤에 통계를 반영하며 --compare-csv는 probe에서 사용합니다.',
  );
  console.log(
    '  npm run dev -- official-sources --probe --manifest /절대경로/official-sources.json\n공식 자치구 원본 세 종의 통합 검증은 로컬 CSV·ZIP만 읽습니다.',
  );
}
