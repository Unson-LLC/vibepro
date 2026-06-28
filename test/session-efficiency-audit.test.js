import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  collectSessionEfficiencyAudit
} from '../src/session-efficiency-audit.js';

const execFileAsync = promisify(execFile);
const CLI_BIN = fileURLToPath(new URL('../bin/vibepro.js', import.meta.url));

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-session-cost-repo-'));
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'vibepro-session-cost-codex-'));
  const storyId = 'STR-126';
  const sessionId = '019f0405-d790-70e1-882f-a436d8074dcd';

  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'vibepro@example.test']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.js'), 'export const value = 1;\n');
  await git(root, ['add', 'src/app.js']);
  await git(root, ['commit', '-m', 'base']);
  await git(root, ['tag', 'base']);

  await mkdir(path.join(root, 'test'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'audit-artifacts', storyId), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.js'), 'export const value = 2;\nexport const fixed = true;\n');
  await writeFile(path.join(root, 'test', 'app.test.js'), 'import "../src/app.js";\n');
  await writeFile(path.join(root, 'docs', 'specs', 'str-126.md'), '# STR-126\n\nSpec line.\n');
  await writeJson(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-bundle.json'), { story_id: storyId });
  await git(root, ['add', 'src/app.js', 'test/app.test.js', 'docs/specs/str-126.md', `docs/management/audit-artifacts/${storyId}/audit-bundle.json`]);
  await git(root, ['commit', '-m', 'story work']);

  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    story: { story_id: storyId },
    gate_status: {
      overall_status: 'needs_verification',
      ready_for_pr_create: false,
      critical_unresolved_gates: [{ id: 'gate:agent_review' }]
    }
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json'), {
    story_id: storyId,
    updated_at: '2026-06-27T13:54:00.000Z',
    commands: [
      { kind: 'unit', status: 'pass' },
      { kind: 'e2e', status: 'pass' }
    ]
  });

  await writeJson(path.join(codexHome, 'process_manager', 'chat_processes.json'), [{
    conversationId: sessionId,
    cwd: root,
    command: 'npm run start',
    turnId: 'turn-1',
    itemId: 'call-1',
    processId: '123',
    osPid: null,
    startedAtMs: 1782558419000,
    updatedAtMs: 1782558420000
  }]);
  const sessionPath = path.join(codexHome, 'sessions', '2026', '06', '27', `rollout-test-${sessionId}.jsonl`);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const lines = [
    {
      timestamp: '2026-06-27T13:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: sessionId, id: sessionId, cwd: '/wrong/canonical/root' }
    },
    {
      timestamp: '2026-06-27T13:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', started_at: 1782558001 }
    },
    {
      timestamp: '2026-06-27T13:00:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            output_tokens: 20,
            reasoning_output_tokens: 5,
            total_tokens: 120
          }
        }
      }
    },
    {
      timestamp: '2026-06-27T13:02:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 300,
            cached_input_tokens: 120,
            output_tokens: 70,
            reasoning_output_tokens: 15,
            total_tokens: 370
          }
        }
      }
    },
    {
      timestamp: '2026-06-27T13:02:20.000Z',
      type: 'event_msg',
      payload: { type: 'final_answer' }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  return { root, codexHome, storyId, sessionId, sessionPath };
}

test('session efficiency audit uses process-manager worktree and Codex token_count window', async () => {
  const { root, codexHome, storyId, sessionId } = await createFixture();
  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.audit_readiness.status, 'ready');
  assert.equal(result.observed_worktree, root);
  assert.equal(result.observed_worktree_source, 'process_manager');
  assert.equal(result.session.token_accounting.status, 'available');
  assert.equal(result.session.token_accounting.total_tokens, 250);
  assert.equal(result.session.token_accounting.input_tokens, 200);
  assert.equal(result.session.token_accounting.output_tokens, 50);
  assert.equal(result.session.elapsed_time_accounting.status, 'available');
  assert.equal(result.session.elapsed_time_accounting.elapsed_ms, 139000);
  assert.equal(result.story_artifacts.pr_prepare.overall_status, 'needs_verification');
  assert.equal(result.story_artifacts.verification.pass_count, 2);
  assert.equal(result.git.changed_lines.buckets.src.changed_lines > 0, true);
  assert.equal(result.git.changed_lines.buckets.test.changed_lines > 0, true);
  assert.equal(result.git.changed_lines.buckets.story_spec_architecture_docs.changed_lines > 0, true);
  assert.equal(result.git.changed_lines.buckets.audit_artifacts.changed_lines > 0, true);
  assert.equal(result.cost_breakdown.total_tokens, 250);
});

test('audit session-cost CLI exposes JSON contract for active session cost audits', async () => {
  const { root, codexHome, storyId, sessionId } = await createFixture();
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      CLI_BIN,
      'audit',
      'session-cost',
      root,
      '--story-id',
      storyId,
      '--session-id',
      sessionId,
      '--codex-home',
      codexHome,
      '--base',
      'base',
      '--json'
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  const result = JSON.parse(stdout);
  assert.equal(result.artifact_kind, 'vibepro_session_efficiency_audit');
  assert.equal(result.session.token_accounting.total_tokens, 250);
  assert.equal(result.cost_breakdown.buckets.some((bucket) => bucket.label === 'src/ コード本体'), true);

  const help = await execFileAsync(process.execPath, [CLI_BIN, 'help', '--language', 'en'], { cwd: root, encoding: 'utf8' });
  assert.match(help.stdout, /vibepro audit session-cost/);
});

test('AUTCOST-SCENARIO-001 session efficiency audit uses automation memory daily window when explicit bounds are absent', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const automationMemoryPath = path.join(codexHome, 'automations', 'vibepro-value-audit', 'memory.md');
  await mkdir(path.dirname(automationMemoryPath), { recursive: true });
  await writeFile(automationMemoryPath, [
    '# vibepro-value-audit memory',
    '',
    '- 2026-06-28 daily value audit: window was `2026-06-27T13:01:00Z` to `2026-06-27T13:03:00Z`.',
    '- Window cost snapshot: downstream session from `2026-06-27T13:03:00Z` to `2026-06-27T13:05:00Z` should not replace the daily window.',
    ''
  ].join('\n'));
  const lines = [
    {
      timestamp: '2026-06-27T13:00:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }
      }
    },
    {
      timestamp: '2026-06-27T13:01:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 180, output_tokens: 30, total_tokens: 210 } }
      }
    },
    {
      timestamp: '2026-06-27T13:02:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 300, output_tokens: 70, total_tokens: 370 } }
      }
    },
    {
      timestamp: '2026-06-27T13:04:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 } }
      }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    automationMemoryPath,
    baseRef: 'base',
    now: '2026-06-28T00:05:00.000Z'
  });

  assert.equal(result.automation_memory.status, 'available');
  assert.equal(result.automation_memory.window_start, '2026-06-27T13:01:00.000Z');
  assert.equal(result.automation_memory.window_end, '2026-06-27T13:03:00.000Z');
  assert.equal(result.session.window.scope, 'bounded');
  assert.equal(result.session.token_accounting.total_tokens, 160);
  assert.equal(result.session.elapsed_time_accounting.status, 'available');
  assert.equal(result.session.elapsed_time_accounting.elapsed_ms, 120000);
  assert.equal(result.cost_breakdown.total_tokens, 160);

  const explicitBounds = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    automationMemoryPath,
    windowStart: '2026-06-27T13:00:00Z',
    windowEnd: '2026-06-27T13:03:00Z',
    baseRef: 'base',
    now: '2026-06-28T00:05:00.000Z'
  });
  assert.equal(explicitBounds.session.window.requested_start, '2026-06-27T13:00:00Z');
  assert.equal(explicitBounds.session.token_accounting.total_tokens, 250);

  const missingMemory = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    automationMemoryPath: path.join(codexHome, 'automations', 'missing', 'memory.md'),
    baseRef: 'base',
    now: '2026-06-28T00:05:00.000Z'
  });
  assert.equal(missingMemory.automation_memory.status, 'unavailable');
  assert.equal(missingMemory.session.token_accounting.status, 'available');
  assert.equal(missingMemory.session.token_accounting.total_tokens, 880);
});
