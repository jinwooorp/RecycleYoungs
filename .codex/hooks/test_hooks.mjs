import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const preHook = fileURLToPath(new URL('./check_dangerous_commands.mjs', import.meta.url));
const postHook = fileURLToPath(new URL('./check_changed_files.mjs', import.meta.url));
const repository = fileURLToPath(new URL('../../', import.meta.url));
const fixtureEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull };
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete fixtureEnv[name];

function hook(script, input, cwd = repository) {
  const result = spawnSync(process.execPath, [script], {
    cwd, env: fixtureEnv, encoding: 'utf8', timeout: 6_000,
    input: typeof input === 'string' ? input : JSON.stringify(input),
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  if (!result.stdout) return '';
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ['hookSpecificOutput']);
  const details = output.hookSpecificOutput;
  assert.deepEqual(Object.keys(details), ['hookEventName', 'additionalContext']);
  assert.equal(details.hookEventName, script === preHook ? 'PreToolUse' : 'PostToolUse');
  return details.additionalContext;
}

function pre(command, cwd = repository) {
  return hook(preHook, { hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command } });
}

function setup(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'ry Hooks 한글 '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, env: fixtureEnv, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git('init', '--quiet', '--template=');
  const write = (file, text) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const post = (patch, summary, cwd = root) => hook(postHook, {
    hook_event_name: 'PostToolUse', tool_name: 'apply_patch', cwd,
    tool_input: { command: ['*** Begin Patch', ...patch, '*** End Patch'].join('\n') },
    tool_response: ['Success. Updated the following files:', ...summary, ''].join('\n'),
  }, root);
  return { root, git, write, post };
}

test('Git 파괴 명령은 실행 없이 분류합니다', () => {
  for (const command of ['git reset --hard HEAD', 'git -C "디렉터리 이름" clean -fdx',
    'git push --force-with-lease=main origin main', 'git push origin +HEAD:main', 'git restore a.txt',
    'git checkout HEAD -- a.txt', 'git switch --discard-changes main']) {
    assert.match(pre(command), /Git.*사용자 승인/);
  }
});

test('조회, 미리보기, 도움말과 인용된 예시는 경고하지 않습니다', () => {
  for (const command of ['git status --short', 'git diff --check', 'git clean -n', 'git clean -ndfx',
    'git clean --dry-run -f', 'git push --force --dry-run origin main', 'git clean -h', 'git reset -- --hard', 'git restore --staged a.txt',
    'echo "git reset --hard"', 'cat <<EOF\ngit reset --hard\nEOF', "node -e 'console.log(\"git clean -fd\")'"]) {
    assert.equal(pre(command), '', command);
  }
});

test('직접 SQL 실행과 Docker 볼륨 삭제를 구분합니다', () => {
  for (const command of ["psql -c 'DROP TABLE items'", "psql --command='BEGIN; TRUNCATE items'",
    "psql -c '/* 이전 상태 */ DELETE FROM items'", 'dropdb demo',
    "docker compose exec -T db psql -c 'DROP DATABASE demo'"]) assert.match(pre(command), /DB.*사용자 승인/);
  for (const command of ['docker volume rm demo', 'docker volume prune',
    'docker compose -f "설정 파일.yml" down --volumes', 'docker system prune --volumes'])
    assert.match(pre(command), /Docker.*사용자 승인/);
  for (const command of ["psql -c \"SELECT 'DROP TABLE items; DELETE FROM items'\"",
    "psql -c 'SELECT 1 /* TRUNCATE a */'", 'psql --help', 'docker volume ls',
    'docker compose -f down down']) assert.equal(pre(command), '', command);
});

test('ETL 파일 검사, DB 대조, 외부 API와 게시를 구분합니다', () => {
  const cwd = join(repository, 'etl');
  const fileOptions = '--source "원본 파일.csv" --expected-rows 3';
  assert.equal(pre('npm run dev -- district-stores --probe ' + fileOptions, cwd), '');
  assert.equal(pre('npm run dev -- official-sources --probe --manifest manifest.json', cwd), '');
  assert.equal(pre('npm run dev -- stores --help', cwd), '');
  assert.equal(pre('npm run dev -- stores ' + fileOptions, repository), '');
  assert.match(pre('npm run dev -- stores ' + fileOptions, cwd), /DB에 데이터를 게시/);
  assert.match(pre('npm --prefix etl run start -- district-stores ' + fileOptions), /쓰기 승인/);
  assert.match(pre('cd etl && npm --silent run dev -- stores ' + fileOptions), /쓰기 승인/);
  const read = pre('npm run dev -- district-foot-traffic --probe --compare-db ' + fileOptions, cwd);
  assert.match(read, /읽기 전용/);
  assert.doesNotMatch(read, /외부 API|쓰기 승인/);
  const api = pre('npm run dev -- district-foot-traffic --api --probe', cwd);
  assert.match(api, /외부 API/);
  assert.doesNotMatch(api, /쓰기 승인|읽기 전용/);
  const combined = pre('npm run dev -- district-foot-traffic --api --probe --compare-csv x.csv --compare-db', cwd);
  assert.match(combined, /외부 API.*읽기 전용/);
  const publish = pre('npm run dev -- sales --api --publish --expected-rows 3 --compare-csv x.csv', cwd);
  assert.match(publish, /외부 API.*쓰기 승인/);
  const cafe = 'npm run dev -- cafes --industry-code I101 --industry-name 커피';
  assert.match(pre(cafe + ' --probe', cwd), /외부 API/);
  assert.doesNotMatch(pre(cafe + ' --probe', cwd), /쓰기 승인/);
  assert.match(pre(cafe, cwd), /외부 API.*쓰기 승인/);
});

test('잘못된 JSON은 조용히 처리하고 경고에는 명령 원문과 비밀을 남기지 않습니다', () => {
  assert.equal(hook(preHook, '{ 잘못된 JSON'), '');
  const message = pre("DB_PASSWORD=fake-password psql 'postgresql://user:fake-key@localhost/test' -c 'DELETE FROM secret'");
  assert.match(message, /DB 명령/);
  assert.doesNotMatch(message, /psql|fake-password|fake-key|postgresql:|secret/);
});

test('Markdown 인라인 링크와 한글·공백 경로를 하위 디렉터리에서 확인합니다', (t) => {
  const { root, write, post } = setup(t);
  write('안내 폴더/대상 파일.md', '# 한글 제목\n\n## 같은 제목\n\n## 같은 제목\n');
  write('안내 폴더/안내.md', [
    '# 시작', '[같은 문서](#시작)', '[다른 문서](<대상 파일.md#한글-제목>)',
    '[중복 제목](대상%20파일.md#같은-제목-1)', '[외부](https://example.invalid/file)',
    '`[코드](없는.md)`', '```bash', '[코드 블록](없는.md)', '```', '',
  ].join('\n'));
  assert.equal(post(['*** Add File: 안내.md', '+# 시작'], ['A 안내.md'], join(root, '안내 폴더')), '');
});

test('잘못된 상대경로, 제목 앵커와 철자를 알려 줍니다', (t) => {
  const { write, post } = setup(t);
  write('Target.md', '# 한글 제목\n');
  write('Guide.md', '[누락](missing.md)\n[없는 제목](Target.md#없는-제목)\n[철자](target.md)\n');
  const message = post(['*** Add File: Guide.md', '+[누락](missing.md)'], ['A Guide.md']);
  assert.match(message, /Guide\.md:1 내부 링크 대상 없음/);
  assert.match(message, /Guide\.md:2 제목 앵커 없음/);
  assert.match(message, /Guide\.md:3 내부 링크 대상 없음/);
});

test('Codex의 실제 패치 응답에서 성공과 적용 경로를 확인합니다', (t) => {
  const { root, write } = setup(t);
  write('Guide.md', '[누락](missing.md)\n');
  const event = {
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    cwd: root,
    tool_input: { command: '*** Begin Patch\n*** Add File: Guide.md\n+[누락](missing.md)\n*** End Patch' },
  };
  const respond = (exitCode, outputHeader, summary) => hook(postHook, {
    ...event,
    tool_response: [
      'Exit code: ' + exitCode, 'Wall time: 0.1 seconds', outputHeader,
      'Success. Updated the following files:', summary, '',
    ].join('\n'),
  }, root);

  assert.match(respond(0, 'Output:', 'A Guide.md'), /Guide\.md:1 내부 링크 대상 없음/);
  for (const message of [
    respond(1, 'Output:', 'A Guide.md'),
    respond(0, 'Unexpected header:', 'A Guide.md'),
    respond(0, 'Output:', 'A Other.md'),
  ]) {
    assert.match(message, /형식이나 적용 결과/);
    assert.doesNotMatch(message, /내부 링크 대상 없음/);
  }
});

test('현재 패치 경로만 스테이징 및 추적 전 공백을 검사합니다', (t) => {
  const { root, write, git, post } = setup(t);
  write('공백 파일.txt', 'fake-token-from-staged-line  \n');
  write('unrelated.txt', '이전 작업  \n');
  git('add', '--', '공백 파일.txt', 'unrelated.txt');
  write('새 파일.txt', 'fake-token-from-untracked-line \n');
  const message = post([
    '*** Update File: 공백 파일.txt', '@@', '+fake-token-from-staged-line  ',
    '*** Add File: 새 파일.txt', '+fake-token-from-untracked-line ',
  ], ['M 공백 파일.txt', 'A 새 파일.txt']);
  assert.match(message, /공백 파일\.txt:1 공백 오류/);
  assert.match(message, /새 파일\.txt:1 공백 오류/);
  assert.doesNotMatch(message, /unrelated|fake-token/);
  assert.equal(readFileSync(join(root, '새 파일.txt'), 'utf8'), 'fake-token-from-untracked-line \n');
  assert.match(git('status', '--short'), /^\?\? .*$/m);
});

test('파일 삭제와 이동은 그 경로를 가리키는 문서만 알립니다', (t) => {
  const { root, write, git, post } = setup(t);
  write('old.md', '# 이전\n');
  write('removed.md', '# 삭제\n');
  write('README.md', '[이동](old.md)\n[삭제](removed.md)\n[기존 오류](unrelated.md)\n');
  git('add', '--', 'old.md', 'removed.md', 'README.md');
  renameSync(join(root, 'old.md'), join(root, 'new.md'));
  rmSync(join(root, 'removed.md'));
  const message = post(['*** Delete File: removed.md', '*** Update File: old.md', '*** Move to: new.md'], [
    'M new.md', 'D removed.md',
  ]);
  assert.match(message, /README\.md:1 내부 링크 대상 없음/);
  assert.match(message, /README\.md:2 내부 링크 대상 없음/);
  assert.doesNotMatch(message, /README\.md:3/);
});

test('제목 변경 시 그 앵커를 참조하는 문서를 확인합니다', (t) => {
  const { write, git, post } = setup(t);
  write('README.md', '[제목](Guide.md#이전)\n');
  write('Guide.md', '# 이전\n');
  git('add', '--', 'README.md', 'Guide.md');
  write('Guide.md', '# 새 제목\n');
  assert.match(post(['*** Update File: Guide.md', '@@', '-# 이전', '+# 새 제목'], ['M Guide.md']),
    /README\.md:1 제목 앵커 없음/);
});

test('비어 있거나 확인할 수 없는 패치는 전수 검사하지 않습니다', (t) => {
  const { root, write, post } = setup(t);
  write('README.md', '[깨진 기존 링크](missing.md)\n');
  assert.equal(post([], []), '');
  assert.match(post(['*** Unsupported File: README.md'], ['M README.md']), /형식이나 적용 결과/);
  assert.match(post(['*** Add File: README.md'], ['M README.md']), /형식이나 적용 결과/);
  assert.match(hook(postHook, '{oops', root), /입력.*완료되지/);
  assert.equal(hook(postHook, { hook_event_name: 'PostToolUse', tool_name: 'Bash' }, root), '');
});

test('복잡한 링크 형식과 외부 경로는 미검증으로 알립니다', (t) => {
  const { root, write, post } = setup(t);
  write('Target.md', '구분선 제목\n==========\n');
  write('Guide.md', '[참조][ref]\n\n[ref]: other.md\n[밖](../path.md)\n[앵커](Target.md#구분선-제목)\n');
  const message = post(['*** Add File: Guide.md', '+[참조][ref]'], ['A Guide.md']);
  assert.match(message, /Guide\.md:1 지원 범위 밖/);
  assert.match(message, /Guide\.md:4 내부 링크 경로 미검증/);
  assert.match(message, /Guide\.md:5 대상 앵커 미검증/);
  assert.match(post(['*** Add File: ../outside.md'], ['A ../outside.md']), /저장소 밖/);
  if (process.platform !== 'win32') {
    symlinkSync(join(root, '..'), join(root, 'outside'));
    write('Guide.md', '[심볼릭 링크](outside/private.md)\n');
    assert.match(post(['*** Update File: Guide.md', '@@', '+[심볼릭 링크](outside/private.md)'], ['M Guide.md']),
      /Guide\.md:1 내부 링크 경로 미검증/);
  }
});

test('공식 이벤트 두 개만 등록하고 하위 경로에서 스크립트를 찾습니다', () => {
  const config = JSON.parse(readFileSync(new URL('../hooks.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(config.hooks), ['PreToolUse', 'PostToolUse']);
  for (const [event, matcher] of [['PreToolUse', '^Bash$'], ['PostToolUse', '^apply_patch$']]) {
    assert.equal(config.hooks[event].length, 1);
    assert.equal(config.hooks[event][0].matcher, matcher);
    const [handler] = config.hooks[event][0].hooks;
    assert.equal(config.hooks[event][0].hooks.length, 1);
    assert.equal(handler.type, 'command');
    assert.ok(handler.timeout > 0 && handler.timeout <= 6);
    if (process.platform !== 'win32') {
      const result = spawnSync('/bin/sh', ['-c', handler.command], {
        cwd: join(repository, 'frontend'), env: fixtureEnv, input: '{}', encoding: 'utf8', timeout: 6_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout + result.stderr, '');
    }
  }
});
