import assert from 'node:assert/strict';
import test from 'node:test';

import { detectLazyPatterns, listLazyPatternCatalog } from '../src/lazy-pattern-detector.js';

function file(path, lines) {
  return {
    path,
    added_lines: lines.map((content, idx) => ({ line_number: idx + 1, content }))
  };
}

function findingsFor(result, patternId) {
  return result.findings.filter((f) => f.pattern_id === patternId);
}

test('empty input returns empty findings (INV-LPD-3)', () => {
  assert.deepEqual(detectLazyPatterns({ files: [] }), { schema_version: '0.1.0', findings: [] });
  assert.deepEqual(detectLazyPatterns(), { schema_version: '0.1.0', findings: [] });
  assert.deepEqual(detectLazyPatterns({}), { schema_version: '0.1.0', findings: [] });
});

test('every finding includes the required keys', () => {
  const result = detectLazyPatterns({
    files: [file('src/foo.js', ['console.log("debug");'])]
  });
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  for (const key of ['pattern_id', 'severity', 'file', 'line_number', 'snippet', 'message', 'fix_hint']) {
    assert.ok(Object.prototype.hasOwnProperty.call(finding, key), `missing key: ${key}`);
  }
});

test('snippet is trimmed to ≤120 chars', () => {
  const longLine = `console.log("${'x'.repeat(200)}");`;
  const result = detectLazyPatterns({ files: [file('src/foo.js', [longLine])] });
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0].snippet.length <= 120);
});

test('merge_conflict_marker requires all three markers in the same file (INV-LPD-4)', () => {
  const positive = detectLazyPatterns({
    files: [file('src/foo.js', [
      '<<<<<<< HEAD',
      'a = 1',
      '=======',
      'a = 2',
      '>>>>>>> branch'
    ])]
  });
  assert.equal(findingsFor(positive, 'merge_conflict_marker').length, 1);

  const negativeIsolatedSeparator = detectLazyPatterns({
    files: [file('docs/x.md', ['# Heading', '======= just a heading rule'])]
  });
  assert.equal(findingsFor(negativeIsolatedSeparator, 'merge_conflict_marker').length, 0);

  const negativePartial = detectLazyPatterns({
    files: [file('src/foo.js', ['<<<<<<< HEAD', 'a = 1', '======='])]
  });
  assert.equal(findingsFor(negativePartial, 'merge_conflict_marker').length, 0);
});

test('commit_marker_left_in detects self-addressed markers in non-test files', () => {
  const positive = detectLazyPatterns({
    files: [file('src/foo.js', ['// REMOVE BEFORE COMMIT', 'doSomething();'])]
  });
  assert.equal(findingsFor(positive, 'commit_marker_left_in').length, 1);
  const negative = detectLazyPatterns({
    files: [file('src/foo.js', ['// review later', 'doSomething();'])]
  });
  assert.equal(findingsFor(negative, 'commit_marker_left_in').length, 0);
});

test('debug_print_left_in catches console.log/print/debugger/dbg!', () => {
  const result = detectLazyPatterns({
    files: [
      file('src/a.js', ['console.log("x");']),
      file('src/b.ts', ['debugger;']),
      file('src/c.py', ['print("hi")']),
      file('src/d.rs', ['dbg!(value);'])
    ]
  });
  assert.equal(findingsFor(result, 'debug_print_left_in').length, 4);
});

test('debug_print_left_in exempts test paths (INV-LPD-2)', () => {
  const result = detectLazyPatterns({
    files: [
      file('test/foo.test.js', ['console.log("ok");']),
      file('tests/bar.spec.ts', ['console.log("ok");']),
      file('__tests__/baz.js', ['console.log("ok");']),
      file('packages/x/quux.spec.py', ['print("ok")'])
    ]
  });
  assert.equal(findingsFor(result, 'debug_print_left_in').length, 0);
});

test('debug_print_left_in does not exempt production files under spec directories', () => {
  const result = detectLazyPatterns({
    files: [file('packages/x/spec/quux.py', ['print("debug")'])]
  });
  assert.equal(findingsFor(result, 'debug_print_left_in').length, 1);
});

test('silent_catch detects empty catch in JS/TS and except: pass in Python', () => {
  const result = detectLazyPatterns({
    files: [
      file('src/a.js', ['try { x() } catch (e) {}']),
      file('src/b.ts', ['try { x() } catch {}']),
      file('src/c.py', ['try:', '    do()', 'except Exception: pass'])
    ]
  });
  assert.ok(findingsFor(result, 'silent_catch').length >= 3);
});

test('silent_catch exempts test paths (INV-LPD-2)', () => {
  const result = detectLazyPatterns({
    files: [file('test/foo.test.js', ['try { x() } catch (e) {}'])]
  });
  assert.equal(findingsFor(result, 'silent_catch').length, 0);
});

test('todo_fixme_marker catches TODO/FIXME/XXX in code but not in markdown', () => {
  const positive = detectLazyPatterns({
    files: [file('src/a.js', ['// TODO: handle case', '// FIXME: leak', '// XXX hack'])]
  });
  assert.equal(findingsFor(positive, 'todo_fixme_marker').length, 3);
  const negative = detectLazyPatterns({
    files: [file('docs/notes.md', ['- TODO: write more docs'])]
  });
  assert.equal(findingsFor(negative, 'todo_fixme_marker').length, 0);
});

test('eslint_disable_without_reason flags bare disables but not justified ones', () => {
  const result = detectLazyPatterns({
    files: [
      file('src/a.js', ['// eslint-disable-next-line no-console']),
      file('src/b.js', ['// eslint-disable-next-line no-console -- emit telemetry only here']),
      file('src/c.js', ['/* eslint-disable */']),
      file('src/d.js', ['// eslint-disable-next-line']),
      file('src/e.js', ['// eslint-disable-line'])
    ]
  });
  const ids = findingsFor(result, 'eslint_disable_without_reason').map((f) => f.file);
  assert.ok(ids.includes('src/a.js'));
  assert.ok(ids.includes('src/d.js'));
  assert.ok(ids.includes('src/e.js'));
  assert.ok(!ids.includes('src/b.js'));
});

test('placeholder_text matches common LLM placeholders case-insensitively', () => {
  const result = detectLazyPatterns({
    files: [
      file('src/a.js', ['const company = "Acme Corp";']),
      file('docs/spec.md', ['Contact john doe at foo@bar.com']),
      file('docs/legit.md', ['Contact the team at hello@unson.example'])
    ]
  });
  const findings = findingsFor(result, 'placeholder_text');
  assert.ok(findings.length >= 2);
  assert.ok(!findings.some((f) => f.file === 'docs/legit.md'));
});

test('em_dash_in_prose only fires on Markdown', () => {
  const positive = detectLazyPatterns({
    files: [file('docs/post.md', ['It was the best of times — really.'])]
  });
  assert.equal(findingsFor(positive, 'em_dash_in_prose').length, 1);
  const negative = detectLazyPatterns({
    files: [file('src/a.js', ['const dash = "—";'])]
  });
  assert.equal(findingsFor(negative, 'em_dash_in_prose').length, 0);
});

test('a line with both TODO and eslint-disable produces two findings (INV-LPD-5)', () => {
  const result = detectLazyPatterns({
    files: [file('src/a.js', ['someCall(); // TODO: rename; eslint-disable-next-line no-unused'])]
  });
  const ids = result.findings.map((f) => f.pattern_id).sort();
  assert.ok(ids.includes('todo_fixme_marker'));
  assert.ok(ids.includes('eslint_disable_without_reason'));
});

test('listLazyPatternCatalog returns all 8 pattern ids', () => {
  const catalog = listLazyPatternCatalog();
  const ids = catalog.map((p) => p.id).sort();
  assert.deepEqual(ids, [
    'commit_marker_left_in',
    'debug_print_left_in',
    'em_dash_in_prose',
    'eslint_disable_without_reason',
    'merge_conflict_marker',
    'placeholder_text',
    'silent_catch',
    'todo_fixme_marker'
  ]);
});

test('files without added_lines are skipped without throwing', () => {
  const result = detectLazyPatterns({
    files: [{ path: 'src/a.js' }, null, { path: 'src/b.js', added_lines: null }]
  });
  assert.deepEqual(result.findings, []);
});
