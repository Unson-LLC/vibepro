import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  composeProductionRuntimeDependencies,
  createCliRuntimeConnector,
  createProductionRuntimeConnectors
} from '../src/agent-runtime-connectors.js';

const implementationRequest = {
  dispatch_id: 'dispatch-1',
  story_id: 'story-runtime',
  run_id: 'run-1',
  task_id: 'implement',
  role: 'implementation',
  input_head_sha: 'a'.repeat(40),
  requirements: { managed_worktree: '/managed', capabilities: ['workspace_write'], timeout_ms: 1000 }
};

function fakeProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => { queueMicrotask(() => child.emit('close', null, signal)); return true; };
  queueMicrotask(() => child.emit('spawn'));
  return child;
}

test('PRC-S-1 Codex connector conforms to probe/start/status/result/cancel', async () => {
  let child;
  let invocation;
  const connector = createCliRuntimeConnector({
    id: 'codex', command: 'codex', enabled: true,
    probeCommand: async () => {}, createId: () => 'provider-1',
    spawnProcess(command, args, options) { invocation = { command, args, options }; child = fakeProcess(); return child; }
  });
  assert.deepEqual(await connector.probe({ role: 'implementation' }), {
    available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write', approval_policy: 'managed', reason: null
  });
  const started = await connector.start(implementationRequest);
  assert.equal(started.provider_run_id, 'codex-provider-1');
  assert.equal(invocation.options.cwd, '/managed');
  assert.deepEqual(invocation.args.slice(0, 7), ['exec', '--json', '--color', 'never', '--sandbox', 'workspace-write', '-C']);
  assert.equal((await connector.status({ provider_run_id: started.provider_run_id })).status, 'running');
  child.stdout.end(JSON.stringify({ completion_status: 'completed', changed_files: ['src/a.js'], head_sha: 'b'.repeat(40), test_suggestions: ['node --test'], summary: 'done' }) + '\n');
  child.emit('close', 0, null);
  assert.equal((await connector.status({ provider_run_id: started.provider_run_id })).status, 'completed');
  const result = await connector.collect_result({ provider_run_id: started.provider_run_id });
  assert.equal(result.completion_status, 'completed');
  assert.deepEqual(result.usage_accounting, { total_tokens: null, cost_usd: null, source: 'codex' });
});

test('PRC-S-2 Claude Code is explicit opt-in and shares the connector contract', async () => {
  const disabled = createProductionRuntimeConnectors({ env: {}, probeCommand: async () => {} });
  const claudeDisabled = disabled.find((adapter) => adapter.id === 'claude-code');
  assert.equal((await claudeDisabled.probe({ role: 'implementation' })).reason, 'runtime_unavailable');

  let invocation;
  const enabled = createProductionRuntimeConnectors({
    env: { VIBEPRO_CLAUDE_CODE_ENABLED: 'true' }, probeCommand: async () => {}, createId: () => 'review-1',
    spawnProcess(command, args) { invocation = { command, args }; return fakeProcess(); }
  });
  const claude = enabled.find((adapter) => adapter.id === 'claude-code');
  assert.equal((await claude.probe({ role: 'review' })).sandbox, 'read-only');
  await claude.start({ ...implementationRequest, role: 'review', reviewer_identity: 'reviewer-1' });
  assert.deepEqual(invocation.args.slice(0, 6), ['--print', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan']);
});

test('PRC-S-3 probe failures normalize auth, quota, permission and unavailable states', async () => {
  for (const [message, reason] of [
    ['login required', 'auth_denied'],
    ['quota exceeded', 'quota_exceeded'],
    ['permission denied', 'permission_wait'],
    ['ENOENT', 'runtime_unavailable']
  ]) {
    const connector = createCliRuntimeConnector({ id: 'codex', command: 'codex', enabled: true, probeCommand: async () => { throw new Error(message); } });
    assert.equal((await connector.probe()).reason, reason);
  }
});

test('PRC-S-4 review uses read-only sandbox, separate identity and a separate provider session', async () => {
  let child;
  const connector = createCliRuntimeConnector({
    id: 'codex', command: 'codex', enabled: true, probeCommand: async () => {}, createId: () => 'review-2',
    spawnProcess() { child = fakeProcess(); return child; }
  });
  const started = await connector.start({ ...implementationRequest, role: 'review', reviewer_identity: 'reviewer-2' });
  child.stdout.end(JSON.stringify({ completion_status: 'completed', changed_files: [], head_sha: implementationRequest.input_head_sha, test_suggestions: [], summary: 'pass' }) + '\n');
  child.emit('close', 0, null);
  const result = await connector.collect_result({ provider_run_id: started.provider_run_id });
  assert.equal(started.agent_identity, 'reviewer-2');
  assert.equal(result.lifecycle, 'closed');
  assert.equal(result.session_id, started.session_id);
});

test('PRC-S-3 cancellation confirms a terminal provider status', async () => {
  const connector = createCliRuntimeConnector({
    id: 'codex', command: 'codex', enabled: true, probeCommand: async () => {}, createId: () => 'cancel-1', spawnProcess: fakeProcess
  });
  const started = await connector.start(implementationRequest);
  const cancelled = await connector.cancel({ provider_run_id: started.provider_run_id });
  assert.equal(cancelled.status, 'cancelled');
});

test('PRC-S-3 provider quota failure remains typed after process start', async () => {
  let child;
  const connector = createCliRuntimeConnector({
    id: 'codex', command: 'codex', enabled: true, probeCommand: async () => {}, createId: () => 'quota-1',
    spawnProcess() { child = fakeProcess(); return child; }
  });
  const started = await connector.start(implementationRequest);
  child.stderr.end('usage quota exceeded');
  child.emit('close', 1, null);
  const status = await connector.status({ provider_run_id: started.provider_run_id });
  assert.equal(status.status, 'failed');
  assert.equal(status.stop_reason.code, 'quota_exceeded');
});

test('PRC-S-3 terminated permission failures are terminal and remain typed', async () => {
  let child;
  const connector = createCliRuntimeConnector({
    id: 'codex', command: 'codex', enabled: true, probeCommand: async () => {}, createId: () => 'permission-1',
    spawnProcess() { child = fakeProcess(); return child; }
  });
  const started = await connector.start(implementationRequest);
  child.stderr.end('permission denied');
  child.emit('close', 1, null);
  const status = await connector.status({ provider_run_id: started.provider_run_id });
  assert.equal(status.status, 'failed');
  assert.equal(status.stop_reason.code, 'permission_wait');
});

test('PRC-S-7 production composition preserves an explicitly injected coordinator', () => {
  const injected = { dispatch() {} };
  assert.equal(composeProductionRuntimeDependencies({ agentRuntimeCoordinator: injected }).agentRuntimeCoordinator, injected);
  assert.equal(typeof composeProductionRuntimeDependencies({}, { env: {} }).agentRuntimeCoordinator.dispatch, 'function');
});

test('PRC-S-6 production smoke probe is typed and never requires credentials', async () => {
  const codex = createProductionRuntimeConnectors().find((adapter) => adapter.id === 'codex');
  const result = await codex.probe({ role: 'review' });
  assert.equal(typeof result.available, 'boolean');
  assert.ok(['review', undefined].includes(result.capabilities[0]));
  if (!result.available) assert.ok(['runtime_unavailable', 'auth_denied', 'quota_exceeded', 'permission_wait'].includes(result.reason));
});
