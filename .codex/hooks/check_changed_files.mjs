import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { devNull } from 'node:os';

const successHeader = 'Success. Updated the following files:';
const markdown = (path) => extname(path).toLowerCase() === '.md';
const gitEnv = { ...process.env };
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete gitEnv[name];

function git(cwd, ...args) {
  return spawnSync('git', ['--no-pager', '--no-optional-locks', '--literal-pathspecs',
    '-c', 'core.fsmonitor=false', ...args],
  { cwd, env: gitEnv, encoding: 'utf8', timeout: 1_000, maxBuffer: 512 * 1024 });
}

function inside(root, path) {
  const fromRoot = relative(root, path);
  return !isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith('..' + sep);
}

function location(root, path, exactCase = false) {
  if (!inside(root, path)) return 'unsupported';
  const parts = relative(root, path).split(sep).filter(Boolean);
  if (parts.some((part) => part.toLowerCase() === '.git' || /[\p{Cc}]/u.test(part))) return 'unsupported';
  let parent = root;
  // 심볼릭 링크는 따라가지 않습니다. macOS에서는 링크의 철자와 대소문자도 확인합니다.
  for (const [index, part] of parts.entries()) {
    try {
      if (exactCase && !readdirSync(parent).includes(part)) return 'missing';
      parent = join(parent, part);
      const stat = lstatSync(parent);
      if (stat.isSymbolicLink()) return 'unsupported';
      if (index === parts.length - 1 && stat.isFile()) return 'file';
      if (!stat.isDirectory()) return 'unsupported';
    } catch (error) {
      return error.code === 'ENOENT' ? 'missing' : 'unsupported';
    }
  }
  return 'directory';
}

function patchChanges(patch) {
  if (typeof patch !== 'string' || patch.length > 512 * 1024) return null;
  const lines = patch.trimEnd().split(/\r?\n/);
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') return null;
  const changes = [];
  let current;
  for (const line of lines) {
    const entry = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (entry) {
      current = { kind: entry[1], file: entry[2] };
      changes.push(current);
    } else if (move && current?.kind === 'Update' && !current.destination) {
      current.destination = move[1];
    } else if (!current || !/^(?:[-+ ]|@@|\*\*\* End of File$|$)/.test(line)) {
      return null;
    } else if (current.kind === 'Update' && /^-\s{0,3}(?:#{1,6}(?:\s|$)|<(?:a|span)\b)/i.test(line)) {
      current.removedHeading = true;
    }
  }
  return changes;
}

function confirmedPaths(changes, response, cwd) {
  // 0.171.0은 이동을 원본 삭제 행 없이 목적지 M 행으로 보고합니다.
  if (typeof response !== 'string') return false;
  const lines = response.trimEnd().split(/\r?\n/);
  // Codex 0.171.0은 성공 요약 앞에 도구 실행 정보를 붙입니다.
  if (lines[0] === 'Exit code: 0') {
    if (!/^Wall time: \d+(?:\.\d+)? seconds?$/.test(lines[1]) || lines[2] !== 'Output:') return false;
    lines.splice(0, 3);
  }
  if (lines.shift() !== successHeader || lines.length !== changes.length) return false;
  const status = { Add: 'A', Update: 'M', Delete: 'D' };
  const expected = new Set(changes.map(({kind, file, destination}) =>
    status[kind] + ' ' + resolve(cwd, destination ?? file)));
  return lines.every((line) => /^[AMD] .+/.test(line) &&
    expected.delete(line[0] + ' ' + resolve(cwd, line.slice(2)))) && expected.size === 0;
}

function checkWhitespace(root, paths, filePaths, report) {
  const options = ['--check', '--no-ext-diff', '--no-textconv', '--no-renames'];
  const check = (...args) => {
    const result = git(root, 'diff', ...args);
    if (!result.error && result.status === 0) return;
    const issues = result.stdout?.split('\n').flatMap((line) => {
      // Git의 원문과 행 내용은 버리고 경로와 행 번호만 알립니다.
      const prefix = /^(.+):(\d+): /.exec(line);
      return prefix && paths.includes(prefix[1]) ? [prefix[1] + ':' + prefix[2]] : [];
    }) ?? [];
    for (const issue of issues) report(issue + ' 공백 오류');
    if (!issues.length && (result.error || result.status !== 1 || result.stderr || result.stdout))
      report('Git 공백 검사를 완료하지 못했습니다.');
  };
  check(...options, '--', ...paths);
  check('--cached', ...options, '--', ...paths);

  if (!filePaths.length) return;
  const tracked = git(root, 'ls-files', '--cached', '-z', '--', ...filePaths);
  if (tracked.status !== 0 || tracked.error) {
    report('추적 여부를 확인하지 못해 새 파일의 공백 검사가 완료되지 않았습니다.');
    return;
  }
  const indexed = new Set(tracked.stdout.split('\0'));
  for (const path of filePaths) {
    if (!indexed.has(path)) check('--no-index', ...options, '--', devNull, path);
  }
}

// 인라인 링크·이미지와 저장소에서 사용하는 HTML 링크의 단순 형태만 읽습니다.
const inlineLinks = /(?<!\\)\[[^\]\n]*\]\([ \t]*(?:<([^<>\n]+)>|([^\s()<>]+))(?:[ \t]+(?:"[^"]*"|'[^']*'))?[ \t]*\)|<(?:img|a)\b[^>\n]*?\s(?:src|href)=["']([^"'\n]+)["'][^>\n]*>/gi;
const inlineCode = /(?<!`)(`+)([^`]|`(?!\1))*?\1(?!`)/g;

function readMarkdown(path) {
  if (lstatSync(path).size > 512 * 1024) return null;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const anchors = new Set();
  const links = [];
  let unsupportedLine;
  let unsupportedAnchors = false;
  let previousProse = false;
  let fence;
  let comment = false;
  const frontmatterEnd = lines[0] === '---' && /^\w[\w-]*:/.test(lines[1] ?? '') ? lines.indexOf('---', 1) : -1;

  for (const [index, line] of lines.entries()) {
    if (index <= frontmatterEnd) continue;
    const lineNumber = index + 1;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim())
        fence = undefined;
      continue;
    }
    if (!comment && marker) {
      fence = marker[1];
      previousProse = false;
      continue;
    }
    if (!comment && /^(?: {4}|\t)/.test(line)) continue;
    let text = line;
    if (comment) {
      const end = line.indexOf('-->');
      if (end === -1) continue;
      comment = false;
      text = line.slice(end + 3);
    }
    text = text.replace(/<!--.*?-->/g, '');
    const start = text.indexOf('<!--');
    if (start >= 0) {
      comment = true;
      text = text.slice(0, start);
    }
    const heading = /^ {0,3}#{1,6}[ \t]+(.+?)\s*#*\s*$/.exec(text);
    const setextUnderline = /^ {0,3}(?:=+|-+)[ \t]*$/.test(text);
    if ((previousProse && setextUnderline) || /<h[1-6](?:\s|>)/i.test(text)) unsupportedAnchors = true;
    previousProse = Boolean(text.trim()) && !heading && !setextUnderline && !/^\s*[#>|<]/.test(text);
    if (heading) {
      const base = heading[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '')
        .toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}_ -]/gu, '').replace(/ /g, '-');
      let unique = base;
      for (let suffix = 1; anchors.has(unique); suffix++) unique = base + '-' + suffix;
      anchors.add(unique);
    }
    const prose = text.replace(inlineCode, '');
    for (const match of prose.matchAll(/<(?:a|span)\b[^>]*?\s(?:id|name)=["']([^"']+)["']/gi)) anchors.add(match[1]);
    const remaining = prose.replace(inlineLinks, (_match, angle, plain, html) => {
      links.push({ href: angle ?? plain ?? html, lineNumber });
      return '';
    });
    if (/(?<!\\)\][ \t]*\(|\[[^\]]+\]\[[^\]]*\]|^ {0,3}\[[^\]]+\]:/.test(remaining)) unsupportedLine ??= lineNumber;
  }
  return { anchors, links, unsupportedLine, unsupportedAnchors };
}

function linkTarget(document, href) {
  if (/^(?:[a-z][\da-z+.-]*:|\/\/)/i.test(href)) return null;
  const [path, fragment] = href.split(/#(.*)/s);
  if (path.startsWith('/')) return { unsupported: true };
  try {
    const pathname = decodeURIComponent(path.split('?')[0]);
    return {
      path: pathname ? resolve(dirname(document), pathname) : document,
      fragment: fragment ? decodeURIComponent(fragment) : '',
    };
  } catch {
    return { unsupported: true };
  }
}

function checkLinks(root, documents, affectedTargets, report) {
  const cache = new Map();
  const load = (path) => {
    if (!cache.has(path)) cache.set(path, readMarkdown(path));
    return cache.get(path);
  };
  const scan = new Set(documents);
  if (affectedTargets.size) {
    // 역참조는 파일 이동·삭제 또는 제목 제거 시에만 검사합니다.
    const files = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z');
    if (files.error || files.status !== 0) report('이동·삭제 대상의 역참조를 확인하지 못했습니다.');
    else {
      const names = [...new Set(files.stdout.split('\0').filter(markdown))];
      if (names.length > 100) report('문서가 많아 이동·삭제 대상의 역참조 검사를 생략했습니다.');
      else for (const name of names) scan.add(resolve(root, name));
    }
  }
  for (const document of scan) {
    if (location(root, document) !== 'file') continue;
    const parsed = load(document);
    const name = relative(root, document);
    const changed = documents.has(document);
    if (!parsed) { report(name + ' 문서 크기로 링크 검사를 생략했습니다.'); continue; }
    if (changed && parsed.unsupportedLine) report(name + ':' + parsed.unsupportedLine + ' 지원 범위 밖 Markdown 링크 미검증');
    for (const { href, lineNumber } of parsed.links) {
      const target = linkTarget(document, href);
      if (!target || (!changed && !affectedTargets.has(target.path))) continue;
      const source = name + ':' + lineNumber;
      const kind = target.unsupported ? 'unsupported' : location(root, target.path, true);
      if (kind === 'missing') report(source + ' 내부 링크 대상 없음');
      else if (kind === 'unsupported') report(source + ' 내부 링크 경로 미검증');
      else if (target.fragment) {
        const targetDocument = kind === 'file' && markdown(target.path) ? load(target.path) : null;
        if (!targetDocument) report(source + ' 대상 앵커 미검증');
        else if (!targetDocument.anchors.has(target.fragment))
          report(source + (targetDocument.unsupportedAnchors ? ' 대상 앵커 미검증' : ' 제목 앵커 없음'));
      }
    }
  }
}

function inspect(event, report) {
  if (event?.hook_event_name !== 'PostToolUse' || event.tool_name !== 'apply_patch') return;
  const changes = patchChanges(event.tool_input?.command);
  if (!changes || typeof event.cwd !== 'string' || !isAbsolute(event.cwd) ||
    !confirmedPaths(changes, event.tool_response, event.cwd)) {
    report('패치 형식이나 적용 결과를 확인할 수 없어 변경 파일을 검사하지 않았습니다.');
    return;
  }
  if (!changes.length) return;
  const result = git(process.cwd(), 'rev-parse', '--show-toplevel');
  if (result.status !== 0) { report('저장소 루트를 찾지 못해 변경 파일을 검사하지 않았습니다.'); return; }
  const root = realpathSync(result.stdout.replace(/\r?\n$/, ''));
  if (!inside(root, event.cwd) || location(root, event.cwd) !== 'directory') {
    report('저장소 밖의 작업 경로는 검사하지 않았습니다.');
    return;
  }
  const paths = new Set();
  const filePaths = new Set();
  const documents = new Set();
  const affectedTargets = new Set();
  const include = (path, removed) => {
    const expected = removed ? 'missing' : 'file';
    if (location(root, path) !== expected) {
      report('패치 경로가 저장소 밖에 있거나 파일 상태를 확인할 수 없어 일부 검사를 생략했습니다.');
      return;
    }
    const name = relative(root, path);
    paths.add(name);
    if (removed) affectedTargets.add(path);
    else {
      filePaths.add(name);
      if (markdown(path)) documents.add(path);
    }
  };
  for (const { kind, file, destination, removedHeading } of changes) {
    const path = resolve(event.cwd, file);
    include(path, kind === 'Delete' || Boolean(destination));
    if (destination) include(resolve(event.cwd, destination), false);
    if (removedHeading && documents.has(path)) affectedTargets.add(path);
  }
  if (paths.size) checkWhitespace(root, [...paths], [...filePaths], report);
  if (documents.size || affectedTargets.size) checkLinks(root, documents, affectedTargets, report);
}

const issues = new Set();
try {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  inspect(event, (message) => issues.add(message));
} catch {
  issues.add('이벤트 입력 또는 파일 접근 문제로 변경 파일 검사가 완료되지 않았습니다.');
}
if (issues.size) {
  const details = [...issues].slice(0, 8);
  if (issues.size > details.length) details.push('외 ' + (issues.size - details.length) + '건');
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: '변경 파일 검사\n' + details.join('\n') },
  }));
}
