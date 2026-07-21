import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { collectSessionEfficiencyAudit } from '../src/session-efficiency-audit.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-explicit-run-attribution-lineage';
const SESSION_ID = '019f-lineage-session';
const HEAD_SHA = 'a'.repeat(40);

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

function lineage(runId, storyId = STORY_ID) {
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    run_id: runId,
    dispatch_id: `dispatch-${runId}`,
    worktree_root: '/fixture/worktree',
    branch: 'codex/lineage',
    head_sha: HEAD_SHA
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-run-lineage-repo-'));
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'vibepro-run-lineage-codex-'));
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'vibepro@example.test']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'base.js'), 'export const base = true;\n');
  await git(root, ['add', 'src/base.js']);
  await git(root, ['commit', '-m', 'base']);

  const sessionPath = path.join(codexHome, 'sessions', '2026', '07', '21', `${SESSION_ID}.jsonl`);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const timestamp = '2026-07-21T01:00:00.000Z';
  const entries = [
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'assistant_message',
        role: 'assistant',
        content: 'Read src/session-efficiency-audit.js',
        lineage: lineage('run-alpha')
      }
    },
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'assistant_message',
        role: 'assistant',
        content: 'Read test/session-efficiency-run-lineage.test.js',
        lineage: lineage('run-beta')
      }
    },
    {
      timestamp,
      type: 'event_msg',
      thread_id: 'thread-only-observation',
      payload: {
        type: 'assistant_message',
        role: 'assistant',
        content: 'Read src/without-authoritative-lineage.js'
      }
    }
  ];
  await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return { root, codexHome };
}

test('session efficiency audit attributes embedded lineage and leaves thread-only observations unattributed', async () => {
  const { root, codexHome } = await fixture();
  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    runId: 'run-alpha',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  const attribution = result.lineage_attribution;
  assert.equal(attribution.filter.run_id, 'run-alpha');
  assert.equal(attribution.filter.run_id_filter_applied, true);
  assert.equal(attribution.authoritative_event_count, 2);
  assert.equal(attribution.thread_only_event_count, 1);
  assert.equal(attribution.buckets.story_attributed.event_count, 1);
  assert.equal(attribution.buckets.other_story.event_count, 1);
  assert.equal(attribution.buckets.unattributed.event_count, 1);
  assert.equal(attribution.events.find((event) => event.thread_id)?.bucket, 'unattributed');
  assert.equal(attribution.events.find((event) => event.thread_id)?.run_id, null);
  assert.equal(result.session.lineage_attribution.total_event_count, 3);
});

test('session efficiency audit accepts the run_id alias without changed-line allocation', async () => {
  const { root, codexHome } = await fixture();
  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    run_id: 'run-beta',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.lineage_attribution.filter.run_id, 'run-beta');
  assert.equal(result.lineage_attribution.buckets.story_attributed.event_count, 1);
  assert.equal(result.lineage_attribution.buckets.other_story.event_count, 1);
  assert.equal(result.cost_breakdown.buckets.every((bucket) => bucket.changed_lines === 0), true);
});
