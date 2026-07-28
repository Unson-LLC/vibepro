import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { authorizeAgentReviewDispatch, prepareAgentReview } from '../src/agent-review.js';
import { computeBudgetOverrideDigest } from '../src/budget-override-authority.js';
import { recordDecision } from '../src/decision-records.js';
import { buildAgentReviewEfficiencySummary } from '../src/pr-manager.js';

// GE-001. The override authority status was wired into both consuming surfaces
// but nothing exercised either surface: the acceptance spec called the resolver
// in process, so deleting `budget_override` from `review authorize` or from
// `pr prepare` left the whole suite green. These tests call the real surfaces.

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-surface-test';
const OVERRIDE = { max_subagent_count: 9, amendment_reason: 'one extra repair round' };

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-budget-surface-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(root, 'README.md'), '# test');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = true;\n');
  await git(root, ['add', 'README.md', 'src']);
  await git(root, ['commit', '-m', 'init']);
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', selected_story_id: STORY_ID })
  );
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    budgets: {
      delivery_efficiency: { max_subagent_count: 6 },
      delivery_efficiency_by_story: { [STORY_ID]: OVERRIDE }
    }
  }));
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`),
    `---\nstory_id: ${STORY_ID}\ntitle: Surface\n---\n\n# Story\n\n## Background\nTest.\n\n## Acceptance Criteria\n- Test.\n`
  );
  await prepareAgentReview(root, { storyId: STORY_ID, stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  return root;
}

function authorize(root) {
  return authorizeAgentReviewDispatch(root, {
    storyId: STORY_ID,
    stage: 'gate',
    role: 'gate_evidence',
    reviewKind: 'preflight',
    closesRisks: ['budget override authority is reported at the dispatch surface'],
    expectedJudgmentDelta: 'Confirm the override status reaches the authorize surface.'
  });
}

test('OGB-SURF-1 review authorize reports an inert Story override on its own surface', async () => {
  const root = await setupRepo();

  const inert = await authorize(root);
  assert.equal(inert.budget_override.status, 'unauthorized',
    'review authorize must report that the configured override did not take effect');
  assert.deepEqual(inert.budget_override.reasons, ['missing_approval']);
  assert.equal(inert.authorization.budget_override.status, 'unauthorized',
    'the persisted authorization record must carry the override status, not just the return value');
});

test('OGB-SURF-2 review authorize reports an authorized override once a grant exists', async () => {
  const root = await setupRepo();

  await recordDecision(root, {
    storyId: STORY_ID,
    type: 'waiver',
    status: 'accepted',
    source: `budget:delivery_efficiency:${STORY_ID}`,
    summary: 'raise the cap to 9',
    reason: 'owner approved the raise',
    budgetGrantor: 'sato-keigo',
    budgetGrantorKind: 'human',
    agentSystem: 'claude_code',
    agentId: 'agent-surface'
  });

  const granted = await authorize(root);
  assert.equal(granted.budget_override.status, 'authorized',
    'review authorize must report the override as authorized once an accepted grant exists');
  assert.equal(granted.budget_override.digest, computeBudgetOverrideDigest(STORY_ID, OVERRIDE));
  assert.equal(granted.budget_override.approval.grantor, 'sato-keigo');
});

test('OGB-SURF-3 a dispatch stop names the inert override instead of only the base limit', async () => {
  const root = await setupRepo();
  // Exhaust the base budget so the dispatch decision stops. Without the override
  // status in the stop, the operator sees the base limit while config says 9.
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    budgets: {
      delivery_efficiency: { max_subagent_count: 0 },
      delivery_efficiency_by_story: { [STORY_ID]: OVERRIDE }
    }
  }));

  await assert.rejects(
    () => authorize(root),
    (error) => {
      assert.match(error.message, /budget override is configured but inert/,
        'the stop message must say the configured override was ignored');
      assert.match(error.message, /missing_approval/);
      assert.equal(error.budget_override?.status, 'unauthorized');
      return true;
    }
  );
});

test('OGB-SURF-4 pr prepare efficiency summary carries the override status and debt', () => {
  const unauthorized = buildAgentReviewEfficiencySummary({
    delivery_efficiency: {
      policy: { max_subagent_count: 6 },
      budget_override: { status: 'unauthorized', story_id: STORY_ID, digest: 'abc', reasons: ['self_approved'], approval: null }
    }
  }, true);
  assert.equal(unauthorized.budget_override.status, 'unauthorized',
    'pr prepare must expose the override status so an inert raise reaches the human');
  assert.deepEqual(unauthorized.budget_override.reasons, ['self_approved']);
  assert.ok(unauthorized.debt.some((entry) => entry.kind === 'budget_override_unauthorized'),
    'an inert override must appear as efficiency debt in the pr prepare summary');

  const absent = buildAgentReviewEfficiencySummary({ delivery_efficiency: { policy: {} } }, true);
  assert.equal(absent.budget_override.status, 'absent');
  assert.ok(!absent.debt.some((entry) => entry.kind === 'budget_override_unauthorized'));
});
