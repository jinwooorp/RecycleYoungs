import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCli } from './cli/runner.js';

export {
  parseDistrictFootTrafficArguments,
  parseDistrictSalesArguments,
  parseDistrictStoreArguments,
  parseCafeArguments,
  parseBoundaryArguments,
  parseStoreArguments,
  parseSalesArguments,
  parseFootTrafficArguments,
  parseIndustryArguments,
} from './cli/arguments.js';

// 다른 모듈이나 테스트에서 가져올 때는 실행하지 않고, CLI로 직접 호출했을 때만 명령을 실행합니다.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runCli(process.argv.slice(2));
}
