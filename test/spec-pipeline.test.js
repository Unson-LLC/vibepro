import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import { buildSpecFingerprint } from '../src/spec-fingerprint.js';
import { validateSpec, globToRegExp, matchGlob } from '../src/spec-validator.js';
import { buildSpecDrift } from '../src/spec-drift.js';
import { similarity, stabilizeClauseIds, writeInferredSpec } from '../src/spec-store.js';

const STORY_ID = 'story-spec-pipeline-test';

async function makeSpecRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-spec-'));
  await mkdir(path.join(root, 'src', 'lib', 'services'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'src', 'lib', 'services', 'billing.ts'), `
export function handleCancel(user, sub) {
  if (sub.cancelAtPeriodEnd === true && user.userType === 2) {
    return { userType: 2, status: 'premium_pending_cancel' };
  }
  if (sub.cancelAtPeriodEnd === false) {
    return { userType: 2, status: 'premium' };
  }
  return { userType: 1, status: 'free' };
}
`);
  await writeFile(path.join(root, 'test', 'billing.test.ts'), `
import { handleCancel } from '../src/lib/services/billing.ts';
test('keeps userType=2 until cancelAtPeriodEnd resolves', () => {
  const result = handleCancel({ userType: 2 }, { cancelAtPeriodEnd: true });
  expect(result.userType).toBe(2);
});
`);
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
---
# Premium 維持の不変条件

## 受け入れ基準
- premium ユーザーは current_period_end まで userType=2 を保持する
- cancelAtPeriodEnd が true でも期間内は premium を維持する
`);
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'spec pipeline test']);
  return root;
}

function readableFrom(text) {
  const stream = Readable.from([text]);
  stream.isTTY = false;
  return stream;
}

async function captureRunCli(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdin: options.stdin ?? null,
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } }
  });
  return { ...result, stdout, stderr };
}

test('spec fingerprint emits story, code, test, schema, and digests', async () => {
  const repo = await makeSpecRepo();
  const { exitCode, stdout } = await captureRunCli(['spec', 'fingerprint', repo, '--id', STORY_ID, '--include-instructions']);
  assert.equal(exitCode, 0);
  const fp = JSON.parse(stdout);
  assert.equal(fp.story_id, STORY_ID);
  assert.ok(fp.story?.acceptance_criteria?.length > 0, 'story acceptance_criteria captured');
  assert.ok(fp.code_fingerprint.branches.length > 0, 'code branches detected');
  assert.ok(fp.test_fingerprint.files.length > 0, 'test files detected');
  assert.equal(typeof fp.inputs_digest.story_sha, 'string');
  assert.equal(fp.previous_spec, null);
  assert.ok(fp.schema_for_your_output.$id.includes('spec'));
  assert.ok(typeof fp.instructions === 'string' && fp.instructions.length > 0);
});

test('spec fingerprint resolves the explicit story id instead of falling back to existing STR-001', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-spec-story-id-'));
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'search.ts'), `
export function searchDetail(params) {
  if (params.detail === true) return 'detail';
  return 'basic';
}
`);
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'STR-001.md'), `---
story_id: STR-001
---
# Existing STR story

## Acceptance Criteria
- Existing STR-001 acceptance criterion must not be selected for a new story.
`);
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-new-network-contract.md'), `---
story_id: story-new-network-contract
---
# New Network Contract Story

## Acceptance Criteria
- New story acceptance criterion must be selected by explicit --id.
`);

  const { exitCode, stdout } = await captureRunCli([
    'spec',
    'fingerprint',
    repo,
    '--id',
    'story-new-network-contract'
  ]);

  assert.equal(exitCode, 0);
  const fp = JSON.parse(stdout);
  assert.equal(fp.story_id, 'story-new-network-contract');
  assert.equal(fp.story.story_id, 'story-new-network-contract');
  assert.equal(fp.story.path, 'docs/management/stories/active/story-new-network-contract.md');
  assert.equal(fp.story.acceptance_criteria.includes('New story acceptance criterion must be selected by explicit --id.'), true);
  assert.equal(fp.story.acceptance_criteria.includes('Existing STR-001 acceptance criterion must not be selected for a new story.'), false);
});

test('spec write rejects clauses whose code_refs do not exist', async () => {
  const repo = await makeSpecRepo();
  const bogus = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-1',
      type: 'invariant',
      statement: 'bogus clause referencing missing file',
      origin: { code_refs: [{ file: 'src/does-not-exist.ts', anchor: 'x' }] }
    }]
  };
  const { exitCode, stdout } = await captureRunCli(
    ['spec', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'test'],
    { stdin: readableFrom(JSON.stringify(bogus)) }
  );
  assert.equal(exitCode, 2);
  const report = JSON.parse(stdout);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((err) => err.code === 'code_ref_missing'));
});

test('spec write accepts valid clause and assigns stable id; spec show reads it back', async () => {
  const repo = await makeSpecRepo();
  const valid = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-1',
      type: 'invariant',
      statement: 'premium ユーザーは current_period_end まで userType=2 を保持する',
      rationale: 'Story 受け入れ基準と service.ts cancelAtPeriodEnd 分岐から',
      origin: {
        story_refs: [{ kind: 'acceptance_criteria', index: 0 }],
        code_refs: [{ file: 'src/lib/services/billing.ts', anchor: 'cancelAtPeriodEnd' }]
      },
      verifiable_by: {
        code_pattern: [{
          file_glob: 'src/lib/services/**/*.ts',
          must_contain: 'cancelAtPeriodEnd'
        }],
        test_pattern: [{
          file_glob: 'test/**/billing*.test.{js,ts}',
          must_cover: 'cancelAtPeriodEnd'
        }]
      }
    }]
  };
  const write = await captureRunCli(
    ['spec', 'write', repo, '--id', STORY_ID, '--from-stdin', '--caller', 'claude-code'],
    { stdin: readableFrom(JSON.stringify(valid)) }
  );
  assert.equal(write.exitCode, 0);

  const show = await captureRunCli(['spec', 'show', repo, '--id', STORY_ID]);
  assert.equal(show.exitCode, 0);
  const stored = JSON.parse(show.stdout);
  assert.equal(stored.clauses.length, 1);
  assert.equal(stored.clauses[0].id, 'INV-001', 'first invariant gets INV-001');
  assert.equal(stored.generated_by.caller, 'claude-code');
});

test('spec drift surfaces missing must_contain as high severity', async () => {
  // Simulate a spec that was valid earlier but now drifted from code: bypass the validator
  // by writing directly through spec-store, then run the drift detector.
  const repo = await makeSpecRepo();
  const driftedSpec = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    generated_at: new Date().toISOString(),
    clauses: [{
      id: 'INV-001',
      type: 'invariant',
      statement: 'service には STRIPE_WEBHOOK_VERIFIED マーカーが残る',
      origin: {
        code_refs: [{ file: 'src/lib/services/billing.ts', anchor: 'cancelAtPeriodEnd' }]
      },
      verifiable_by: {
        code_pattern: [{
          file_glob: 'src/lib/services/**/*.ts',
          must_contain: 'STRIPE_WEBHOOK_VERIFIED'
        }]
      }
    }]
  };
  await writeInferredSpec(repo, STORY_ID, driftedSpec);
  const drift = await captureRunCli(['spec', 'drift', repo, '--id', STORY_ID, '--json']);
  assert.equal(drift.exitCode, 0);
  const driftJson = JSON.parse(drift.stdout);
  assert.equal(driftJson.status, 'drift_detected');
  const high = driftJson.items.filter((item) => item.severity === 'high');
  assert.ok(high.length > 0, 'must_contain miss surfaces high-severity drift');
  assert.equal(high[0].axis, 'spec_code');
});

test('stabilizeClauseIds preserves id for similar statement', async () => {
  const previous = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-001',
      type: 'invariant',
      statement: 'premium ユーザーは current_period_end まで userType=2 を保持する',
      first_seen_at: '2026-01-01T00:00:00.000Z',
      origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
    }]
  };
  const next = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-9',
      type: 'invariant',
      statement: 'プレミアム ユーザーは current_period_end まで userType=2 を保持する',
      origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
    }]
  };
  const stabilized = stabilizeClauseIds(next, previous);
  assert.equal(stabilized.clauses[0].id, 'INV-001');
  assert.equal(stabilized.clauses[0].first_seen_at, '2026-01-01T00:00:00.000Z');
});

test('similarity returns 1 for identical and >0.7 for paraphrase', () => {
  assert.equal(similarity('abc def ghi', 'abc def ghi'), 1);
  const score = similarity(
    'premium ユーザーは current_period_end まで userType=2 を保持する',
    'プレミアム ユーザーは current_period_end まで userType=2 を保持する'
  );
  assert.ok(score >= 0.7, `similarity ${score} should be >= 0.7 for paraphrase`);
});

test('globToRegExp + matchGlob match nested directories', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-glob-'));
  await mkdir(path.join(repo, 'src', 'a', 'b'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'a', 'b', 'foo.ts'), 'export const ok = true');
  await writeFile(path.join(repo, 'src', 'a', 'b', 'bar.test.ts'), 'test("ok", () => {})');
  const matched = await matchGlob(repo, 'src/**/*.ts');
  assert.ok(matched.includes('src/a/b/foo.ts'));
  assert.ok(matched.includes('src/a/b/bar.test.ts'));
  const regex = globToRegExp('test/**/*.{test,spec}.{js,ts}');
  assert.ok(regex.test('test/foo.test.ts'));
  assert.ok(regex.test('test/nested/bar.spec.js'));
  assert.equal(regex.test('test/foo.tsx'), false);
});

test('validateSpec accepts well-formed spec built from real repo', async () => {
  const repo = await makeSpecRepo();
  const fingerprint = await buildSpecFingerprint(repo, { storyId: STORY_ID });
  assert.ok(fingerprint.code_fingerprint.files.includes('src/lib/services/billing.ts'));
  const spec = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    clauses: [{
      id: 'INV-NEW-1',
      type: 'invariant',
      statement: 'cancelAtPeriodEnd 分岐が service に存在し続ける',
      origin: {
        code_refs: [{ file: 'src/lib/services/billing.ts', anchor: 'cancelAtPeriodEnd' }]
      },
      verifiable_by: {
        code_pattern: [{ file_glob: 'src/lib/services/**/*.ts', must_contain: 'cancelAtPeriodEnd' }]
      }
    }]
  };
  const validation = await validateSpec(repo, spec, { expectedStoryId: STORY_ID });
  assert.equal(validation.ok, true, `unexpected errors: ${JSON.stringify(validation.errors)}`);
});

test('buildSpecDrift returns inconclusive when no spec exists', async () => {
  const repo = await makeSpecRepo();
  const drift = await buildSpecDrift(repo, { storyId: STORY_ID });
  assert.equal(drift.status, 'inconclusive');
  assert.equal(drift.items.length, 0);
});
