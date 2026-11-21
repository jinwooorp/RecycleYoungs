import { readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const gitWarning = '이 Git 명령은 기존 변경 사항을 잃거나 원격 이력을 덮어쓸 수 있습니다.';
const sqlWarning = '이 DB 명령은 데이터나 스키마를 삭제할 수 있습니다.';
const volumeWarning = '이 Docker 명령은 볼륨에 저장된 데이터를 삭제할 수 있습니다.';
const publishWarning = 'ETL이 DB에 데이터를 게시합니다. 대상 로컬 DB와 백업을 확인하고 쓰기 승인을 받으세요.';
const apiWarning = 'ETL이 인증키를 보내는 외부 API 요청을 할 수 있습니다. 전송 대상·방식과 승인 범위를 확인하세요.';
const readWarning = 'ETL이 게시 DB를 읽기 전용으로 대조합니다. 대상 로컬 DB를 확인하세요.';
const approvalReminder = '실행하려면 사용자 승인과 작업 범위를 확인하세요.';
const etlDirectory = fileURLToPath(new URL('../../etl', import.meta.url));
const statistics = new Set(['stores', 'sales', 'foot-traffic', 'district-stores', 'district-sales', 'district-foot-traffic']);
const fileProbes = new Set(['district-stores', 'district-sales', 'district-foot-traffic']);

// 리터럴 인자와 선택적인 cd ... &&만 읽습니다. 확장, 리다이렉트, 그 밖의 복합 셸 문법은 평가하지 않습니다.
function shellArguments(command) {
  const parts = /[ \t]+|&&|'[^']*'|"(?:\\[^\r\n]|[^"\\])*"|\\[^\r\n]|[^\s'"\\$`|&<>();*?[\]{}~!]+/gy;
  const args = [];
  let token = null;
  while (parts.lastIndex < command.length) {
    const index = parts.lastIndex;
    if (token === null && command[index] === '#') break;
    const match = parts.exec(command);
    if (!match) return null;
    const part = match[0];
    if (part === '&&' || /^[ \t]/.test(part)) {
      if (token !== null) args.push(token);
      if (part === '&&') args.push(null);
      token = null;
      continue;
    }
    if (part.startsWith('"') && /[$`]/.test(part)) return null;
    if (part.startsWith("'")) token = (token ?? '') + part.slice(1, -1);
    else if (part.startsWith('"')) token = (token ?? '') + part.slice(1, -1).replace(/\\(["\\])/g, '$1');
    else token = (token ?? '') + part.replace(/^\\/, '');
  }
  if (token !== null) args.push(token);
  return args;
}

function commandName(path) {
  return basename(path).replace(/\.exe$/i, '');
}

function gitWarningFor(args) {
  let index = 0;
  while (index < args.length) {
    if (args[index] === '-C') index += 2;
    else if (['--no-pager', '--no-optional-locks'].includes(args[index])) index++;
    else break;
  }
  const [subcommand, ...operands] = args.slice(index);
  const separator = operands.indexOf('--');
  const options = separator < 0 ? operands : operands.slice(0, separator);
  if (options.includes('--help') || options.includes('-h')) return '';
  const has = (...flags) => flags.some((flag) => options.includes(flag));
  const short = (flag) => options.some((arg) => /^-[a-z]+$/i.test(arg) && arg.slice(1).includes(flag));
  let dryRun = false;
  for (let index = 0; index < options.length; index++) {
    const arg = options[index];
    if (['-e', '--exclude', '-o', '--push-option'].includes(arg)) index++;
    else if (arg === '--no-dry-run') dryRun = false;
    else if (arg === '--dry-run' || (/^-[a-z]+$/i.test(arg) && arg.includes('n'))) dryRun = true;
  }
  const destructive =
    (subcommand === 'reset' && has('--hard')) ||
    (subcommand === 'clean' && !dryRun) ||
    (subcommand === 'push' && !dryRun && (has('--force', '--force-with-lease', '--mirror') || short('f') ||
      options.some((arg) => arg.startsWith('--force-with-lease=')) ||
      operands.some((arg) => /^\+[^+]/.test(arg)))) ||
    (subcommand === 'restore' && (!has('--staged', '-S') || has('--worktree', '-W'))) ||
    (subcommand === 'checkout' && (has('--force', '-f') || (separator >= 0 && separator < operands.length - 1))) ||
    (subcommand === 'switch' && has('--discard-changes', '--force', '-f'));
  return destructive ? gitWarning : '';
}

function postgresWarningFor(command, args) {
  if (args.includes('--help') || args.includes('-?') || args.includes('--version') || args.includes('-V')) return '';
  if (command === 'dropdb') return sqlWarning;
  if (command !== 'psql') return '';
  for (let index = 0; index < args.length && args[index] !== '--'; index++) {
    const arg = args[index];
    let sql;
    if (arg === '-c' || arg === '--command') sql = args[++index];
    else if (arg.startsWith('--command=')) sql = arg.slice('--command='.length);
    else if (arg.startsWith('-c') && arg.length > 2) sql = arg.slice(2);
    if (!sql) continue;
    // SQL 문자열·식별자·주석에 들어 있는 예시 문구는 실행문으로 해석하지 않습니다.
    const statements = sql.replace(/(--[^\r\n]*|\/\*[\s\S]*?\*\/)|'(?:''|[^'])*'|"(?:\"\"|[^"])*"|(\$(?:[a-z_][\w]*)?\$)[\s\S]*?\2/gi,
      (match, comment) => comment ? ' ' : '_');
    if (/(?:^|;)\s*(?:DROP\s+(?:DATABASE|TABLE|SCHEMA|OWNED|MATERIALIZED\s+VIEW|VIEW)\b|TRUNCATE\b|DELETE\s+FROM\b)/i.test(statements)) return sqlWarning;
  }
  return '';
}

function dockerWarningFor(args) {
  if (args.includes('--help') || args.includes('-h')) return '';
  if (args[0] === 'volume' && (args[1] === 'rm' || args[1] === 'prune')) return volumeWarning;
  if (args[0] === 'system' && args[1] === 'prune' && args.includes('--volumes')) return volumeWarning;
  if (args[0] !== 'compose') return '';
  let index = 1;
  const composeOptions = new Set(['-f', '-p', '--file', '--project-name', '--project-directory', '--profile', '--env-file']);
  while (composeOptions.has(args[index]?.split('=')[0])) index += args[index].includes('=') ? 1 : 2;
  const [subcommand, ...operands] = args.slice(index);
  if (subcommand === 'down' && operands.some((arg) => ['-v', '--volumes'].includes(arg))) return volumeWarning;
  // 저장소의 Compose DB에 대한 직접 psql 실행도 같은 검사에 포함합니다.
  if (subcommand === 'exec') {
    const commandIndex = ['-T', '--no-TTY'].includes(operands[0]) ? 2 : 1;
    if (operands[commandIndex]) return postgresWarningFor(commandName(operands[commandIndex]), operands.slice(commandIndex + 1));
  }
  return '';
}

function etlWarningsFor(args, cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return [];
  let index = 0;
  let directory = cwd;
  while (index < args.length) {
    const arg = args[index++];
    if (arg === '--prefix' && args[index]) directory = resolve(cwd, args[index++]);
    else if (arg.startsWith('--prefix=')) directory = resolve(cwd, arg.slice('--prefix='.length));
    else if (arg !== '--silent' && arg !== '-s') { index--; break; }
  }
  const location = relative(etlDirectory, directory);
  if (isAbsolute(location) || location === '..' || location.startsWith('..' + sep)) return [];
  if (!['run', 'run-script'].includes(args[index]) || !['dev', 'start'].includes(args[index + 1]) || args[index + 2] !== '--') return [];
  const [command, ...options] = args.slice(index + 3);
  if (!statistics.has(command) && !['boundaries', 'industries', 'cafes'].includes(command)) return [];

  // 값과 플래그를 구분하되 행 수와 원본 검증은 실제 ETL CLI에 맡깁니다.
  const valueOptions = ['source', 'expected-rows', 'expected-districts', 'expected-dongs', 'expected-industries',
    'sales-source', 'industry-code', 'industry-name', 'compare-csv'];
  const flagOptions = ['probe', 'publish', 'api', 'allow-insecure-http', 'compare-db', 'csv-period'];
  const { values, positionals } = parseArgs({
    args: options,
    allowPositionals: true,
    options: {
      ...Object.fromEntries(valueOptions.map((name) => [name, { type: 'string' }])),
      ...Object.fromEntries(flagOptions.map((name) => [name, { type: 'boolean' }])),
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length) return [];
  if (command === 'cafes' && values['industry-code'] && values['industry-name'] && !values.api && !values.publish)
    return values.probe ? [apiWarning] : [apiWarning, publishWarning];
  const compareDb = command === 'district-foot-traffic' && values['compare-db'];
  if (values.api && statistics.has(command) && !values.source) {
    if (values.probe && !values.publish) return compareDb && values['compare-csv'] ? [apiWarning, readWarning] : [apiWarning];
    if (values.publish && !values.probe) return [apiWarning, publishWarning];
  }
  if (!values.api && !values.publish && values.source && command !== 'cafes') {
    if (values.probe) return fileProbes.has(command) && compareDb ? [readWarning] : [];
    return [publishWarning];
  }
  return [];
}

function inspect(event) {
  if (event?.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Bash') return [];
  const command = event.tool_input?.command;
  if (typeof command !== 'string' || command.length > 16_384 || /[\0\r\n]/.test(command)) return [];
  let args = shellArguments(command);
  if (!args?.length) return [];

  let cwd = event.cwd;
  if (args[0] === 'cd' && args[1] && args[2] === null && isAbsolute(cwd ?? '')) {
    cwd = resolve(cwd, args[1]);
    args = args.slice(3);
  }
  if (args.includes(null)) return [];
  const start = args.findIndex((arg) => !/^[a-z_][a-z0-9_]*=/i.test(arg));
  if (start < 0) return [];
  const [program, ...parameters] = args.slice(start);
  const name = commandName(program);
  if (name === 'npm') return etlWarningsFor(parameters, cwd);
  const warning = name === 'git' ? gitWarningFor(parameters) :
    name === 'docker' ? dockerWarningFor(parameters) : postgresWarningFor(name, parameters);
  return warning ? [warning, approvalReminder] : [];
}

try {
  const notices = inspect(JSON.parse(readFileSync(0, 'utf8')));
  if (notices.length) console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: notices.join(' ') },
  }));
} catch {
  // 잘못된 JSON이나 분류할 수 없는 인자에 원문을 포함한 오류를 출력하지 않습니다.
}
