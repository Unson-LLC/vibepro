import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { recordDecision } from '../../src/decision-records.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_BIN = path.join(root, 'bin', 'vibepro.js');

// story-vibepro-budget-grant-tracked-decision-doc acceptance spec.
// Each block replays one acceptance criterion against the real CLI or the
// real repository content — no mocked decision store.
async function makeGrantRepo({ ignoreDocs = false } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bgt-acc-'));
  await execFileAsync('git', ['init'], { cwd: repo });
  await writeFile(path.join(repo, '.gitignore'), `.vibepro/*\n!.vibepro/config.json\n${ignoreDocs ? 'docs/\n' : ''}`);
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(repo, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  await writeConfig(repo, { max_subagent_count: 10, amendment_reason: 'closure sequence raise' });
  return repo;
}

async function writeConfig(repo, override) {
  await writeFile(
    path.join(repo, '.vibepro', 'config.json'),
    JSON.stringify({
      schema_version: '0.1.0',
      budgets: {
        delivery_efficiency: { max_subagent_count: 6 },
        delivery_efficiency_by_story: { 'story-bgt-acc': override }
      }
    }, null, 2)
  );
}

function grantOptions(overrides = {}) {
  return {
    storyId: 'story-bgt-acc',
    type: 'waiver',
    status: 'accepted',
    source: 'budget:delivery_efficiency:story-bgt-acc',
    summary: 'owner approved raising the Story subagent cap to 10',
    reason: 'owner approved the raise for the closure sequence',
    budgetGrantor: 'sato-keigo',
    budgetGrantorKind: 'human',
    agentSystem: 'claude_code',
    agentId: 'agent-bgt-acc',
    ...overrides
  };
}

function grantArgs(repo) {
  return [
    CLI_BIN, 'decision', 'record', repo,
    '--id', 'story-bgt-acc',
    '--type', 'waiver',
    '--status', 'accepted',
    '--source', 'budget:delivery_efficiency:story-bgt-acc',
    '--summary', 'owner approved raising the Story subagent cap to 10',
    '--reason', 'owner approved the raise for the closure sequence',
    '--budget-grantor', 'sato-keigo',
    '--budget-grantor-kind', 'human',
    '--agent-system', 'claude_code',
    '--agent-id', 'agent-bgt-acc',
    '--json'
  ];
}

test('story-vibepro-budget-grant-tracked-decision-doc acceptance: grant flow through the real CLI', async () => {
  const repo = await makeGrantRepo();
  const { stdout } = await execFileAsync(process.execPath, grantArgs(repo), { cwd: root });
  const result = JSON.parse(stdout);
  const approval = result.decision.budget_approval;

  // story-vibepro-budget-grant-tracked-decision-doc ac:1 budget grant generates docs/management/decisions/<date>-budget-override-<story-id>-<digest8>.md with budget_override_approval frontmatter and the reason body
  assert.match(approval.decision_doc, /^docs\/management\/decisions\/\d{4}-\d{2}-\d{2}-budget-override-story-bgt-acc-[0-9a-f]{8}\.md$/);
  const doc = await readFile(path.join(repo, approval.decision_doc), 'utf8');
  assert.match(doc, /type: budget_override_approval/);
  assert.match(doc, new RegExp(`decision_id: ${result.decision.decision_id}`));
  assert.match(doc, /approver: sato-keigo/);
  assert.match(doc, /approver_kind: human/);
  assert.match(doc, new RegExp(`approved_at: ${result.decision.recorded_at}`));
  assert.match(doc, new RegExp(`override_digest: ${approval.override_digest}`));
  assert.match(doc, /agent_id: agent-bgt-acc/);
  assert.match(doc, /owner approved the raise for the closure sequence/);

  // story-vibepro-budget-grant-tracked-decision-doc ac:2 the generated document's repo-relative path is recorded as budget_approval.decision_doc so both channels cross-reference
  const records = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-bgt-acc', 'decision-records.json'), 'utf8'));
  assert.equal(records.decisions[0].budget_approval.decision_doc, approval.decision_doc);
  await assert.rejects(execFileAsync('git', ['check-ignore', approval.decision_doc], { cwd: repo }),
    undefined, 'the document must be on the tracked side of the gitignore boundary');
});

test('story-vibepro-budget-grant-tracked-decision-doc acceptance: fail-closed and unchanged surfaces', async () => {
  // story-vibepro-budget-grant-tracked-decision-doc ac:3 a gitignored document path makes decision record fail without recording the grant
  const ignoredRepo = await makeGrantRepo({ ignoreDocs: true });
  await assert.rejects(
    execFileAsync(process.execPath, grantArgs(ignoredRepo), { cwd: root }),
    /gitignored/
  );
  const leaked = await readFile(path.join(ignoredRepo, '.vibepro', 'pr', 'story-bgt-acc', 'decision-records.json'), 'utf8')
    .catch((error) => error.code);
  assert.equal(leaked, 'ENOENT');

  // story-vibepro-budget-grant-tracked-decision-doc ac:4 a decision record without a budget grant writes no document and keeps its previous output shape
  const plainRepo = await makeGrantRepo();
  const plain = await recordDecision(plainRepo, {
    storyId: 'story-bgt-acc',
    type: 'needs_review',
    summary: 'plain decision',
    status: 'accepted'
  });
  assert.equal(plain.decision.budget_approval, null);
  const decisionsDir = await readFile(path.join(plainRepo, 'docs', 'management', 'decisions')).catch((error) => error.code);
  assert.equal(decisionsDir, 'ENOENT');

  // story-vibepro-budget-grant-tracked-decision-doc ac:5 same story and digest re-record overwrites the same path; a changed budget produces a new file with a new digest prefix
  const digestRepo = await makeGrantRepo();
  const first = await recordDecision(digestRepo, grantOptions());
  const again = await recordDecision(digestRepo, grantOptions());
  assert.equal(first.decision.budget_approval.decision_doc, again.decision.budget_approval.decision_doc);
  await writeConfig(digestRepo, { max_subagent_count: 14, amendment_reason: 'second raise' });
  const changed = await recordDecision(digestRepo, grantOptions());
  assert.notEqual(changed.decision.budget_approval.decision_doc, first.decision.budget_approval.decision_doc);
  await readFile(path.join(digestRepo, first.decision.budget_approval.decision_doc), 'utf8');
  await readFile(path.join(digestRepo, changed.decision.budget_approval.decision_doc), 'utf8');
});

test('story-vibepro-budget-grant-tracked-decision-doc acceptance: repository backfill and docs', () => {
  // story-vibepro-budget-grant-tracked-decision-doc ac:6 the backfill document for the parent story's three grants exists in the tracked channel with grantor, current digest, and session provenance
  const backfill = readFileSync(path.join(root,
    'docs/management/decisions/2026-07-30-budget-override-story-vibepro-owner-gated-budget-override-1f29ffff.md'), 'utf8');
  assert.match(backfill, /type: budget_override_approval/);
  assert.match(backfill, /approver: sato_keigo/);
  assert.match(backfill, /override_digest: 1f29ffffec31a9405881c332f49136b4331b7d37cd0a9d869fd6b4ac20f02156/);
  assert.match(backfill, /70ea817c-ee56-48c0-ab7c-612da8629872/);

  // story-vibepro-budget-grant-tracked-decision-doc ac:7 docs/reference/cli.md and docs/ja/reference/cli.md document the tracked document generation
  for (const ref of ['docs/reference/cli.md', 'docs/ja/reference/cli.md']) {
    const text = readFileSync(path.join(root, ref), 'utf8');
    assert.match(text, /budget_approval\.decision_doc/);
    assert.match(text, /budget_override_approval/);
  }
});
