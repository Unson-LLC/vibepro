import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { AgentRuntimeError, createAgentRuntimeCoordinator, defineAgentRuntimeAdapter } from './agent-runtime-adapter.js';

const execFile = promisify(nodeExecFile);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
const AUTH_PATTERN = /auth|login|credential|api key|unauthorized/i;
const QUOTA_PATTERN = /quota|rate.?limit|capacity|overloaded|usage limit/i;
const PERMISSION_PATTERN = /permission|approval|not allowed|sandbox/i;

export function createProductionRuntimeCoordinator(options = {}) {
  return createAgentRuntimeCoordinator({
    adapters: createProductionRuntimeConnectors(options),
    ...(options.now ? { now: options.now } : {})
  });
}

export function composeProductionRuntimeDependencies(dependencies = {}, options = {}) {
  return {
    ...dependencies,
    agentRuntimeCoordinator: dependencies.agentRuntimeCoordinator
      ?? createProductionRuntimeCoordinator(options)
  };
}

export function createProductionRuntimeConnectors(options = {}) {
  const env = options.env ?? process.env;
  const shared = { ...options, env };
  return [
    createCliRuntimeConnector({ id: 'codex', command: env.VIBEPRO_CODEX_COMMAND ?? 'codex', enabled: true, ...shared }),
    createCliRuntimeConnector({
      id: 'claude-code',
      command: env.VIBEPRO_CLAUDE_CODE_COMMAND ?? 'claude',
      enabled: env.VIBEPRO_CLAUDE_CODE_ENABLED === 'true',
      ...shared
    })
  ];
}

export function createCliRuntimeConnector(options = {}) {
  const id = requiredText(options.id, 'connector id');
  const command = requiredText(options.command, 'connector command');
  const enabled = options.enabled === true;
  const env = options.env ?? process.env;
  const spawnProcess = options.spawnProcess ?? nodeSpawn;
  const probeCommand = options.probeCommand ?? probeCliRuntime;
  const createId = options.createId ?? randomUUID;
  const runs = new Map();

  return defineAgentRuntimeAdapter({
    id,
    async probe({ role } = {}) {
      if (!enabled) return unavailable('runtime_unavailable');
      try {
        await probeCommand(command, { env, id });
      } catch (error) {
        return unavailable(classifyUnavailable(error));
      }
      const review = role === 'review';
      const locallyContainedImplementation = !review && id === 'codex';
      return {
        available: true,
        capabilities: review
          ? ['review']
          : [
              'workspace_write',
              ...(locallyContainedImplementation ? ['local_workspace_only'] : [])
            ],
        sandbox: review ? 'read-only' : 'workspace-write',
        approval_policy: locallyContainedImplementation ? 'never' : 'managed',
        reason: null
      };
    },
    async start(request) {
      if (!enabled) throw new AgentRuntimeError('runtime_unavailable', `${id} connector is not enabled`);
      const providerRunId = `${id}-${createId()}`;
      const invocation = buildInvocation(id, request);
      let child;
      try {
        child = spawnProcess(command, invocation.args, {
          cwd: request.requirements.managed_worktree,
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        throw typedStartError(error);
      }
      const record = createRunRecord(providerRunId, request, child);
      runs.set(providerRunId, record);
      attachProcess(record);
      await waitForSpawn(record);
      return {
        provider: id,
        provider_run_id: providerRunId,
        agent_identity: request.role === 'review' ? request.reviewer_identity : `${id}-implementation`,
        session_id: providerRunId,
        thread_id: providerRunId,
        story_id: request.story_id,
        run_id: request.run_id,
        dispatch_id: request.dispatch_id,
        head_sha: request.input_head_sha
      };
    },
    async status({ provider_run_id: providerRunId }) {
      const record = requireRun(runs, providerRunId);
      return {
        status: record.status,
        message: record.message,
        stop_reason: record.stopReason,
        provider: id,
        provider_run_id: providerRunId,
        session_id: providerRunId,
        thread_id: providerRunId
      };
    },
    async cancel({ provider_run_id: providerRunId, force = false }) {
      const record = requireRun(runs, providerRunId);
      if (!TERMINAL.has(record.status)) {
        record.cancelRequested = true;
        record.child.kill(force ? 'SIGKILL' : 'SIGTERM');
        await record.settled;
      }
      return { status: record.status, provider: id, provider_run_id: providerRunId };
    },
    async collect_result({ provider_run_id: providerRunId }) {
      const record = requireRun(runs, providerRunId);
      if (record.status !== 'completed') {
        throw new AgentRuntimeError('invalid_runtime_result', `${id} runtime has not completed successfully`);
      }
      const parsed = extractStructuredResult(record.stdout);
      const identity = record.request.role === 'review'
        ? record.request.reviewer_identity
        : `${id}-implementation`;
      return {
        ...parsed,
        agent_identity: identity,
        session_id: providerRunId,
        thread_id: providerRunId,
        lifecycle: record.request.role === 'review' ? 'closed' : undefined,
        usage_accounting: parsed.usage_accounting ?? extractUsage(record.stdout, id)
      };
    }
  });
}

export async function probeCliRuntime(command, { env, id, execCommand = execFile }) {
  await execCommand(command, ['--version'], { env, timeout: 5000 });
  const authArgs = id === 'codex' ? ['login', 'status'] : ['auth', 'status'];
  const { stdout = '', stderr = '' } = await execCommand(command, authArgs, { env, timeout: 5000 });
  if (id === 'claude-code') {
    const status = JSON.parse(stdout);
    if (status.loggedIn !== true) throw new AgentRuntimeError('auth_denied', 'Claude Code is not authenticated');
  } else {
    const authStatus = `${stdout}\n${stderr}`;
    if (/not logged in|unauthenticated/i.test(authStatus) || !/logged in|authenticated/i.test(authStatus)) {
      throw new AgentRuntimeError('auth_denied', 'Codex is not authenticated');
    }
  }
}

function buildInvocation(id, request) {
  const prompt = buildPrompt(request);
  if (id === 'codex') {
    const implementationIsolation = request.role === 'review'
      ? []
      : [
          '--ignore-user-config',
          '-c', 'approval_policy="never"',
          '-c', 'sandbox_workspace_write.network_access=false'
        ];
    return {
      args: [
        'exec', '--json', '--color', 'never',
        ...implementationIsolation,
        '--sandbox', request.role === 'review' ? 'read-only' : 'workspace-write',
        '-C', request.requirements.managed_worktree,
        prompt
      ]
    };
  }
  return {
    args: [
      '--print', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', request.role === 'review' ? 'plan' : 'acceptEdits',
      prompt
    ]
  };
}

function buildPrompt(request) {
  const contract = request.role === 'review'
    ? 'Do not modify files. Inspect the current HEAD and report findings only. changed_files must be [].'
    : 'Work only inside the provided managed worktree. Complete the requested task and commit the focused change.';
  const resultShape = request.role === 'review'
    ? '{"completion_status":"completed","changed_files":[],"head_sha":"40-char git SHA","test_suggestions":["command"],"summary":"runtime result","status":"pass | needs_changes | block","inspection_summary":"what you inspected","inspection_evidence":"optional evidence reference","inspection_inputs":["file, command, artifact, log, URL, or state"],"judgment_delta":["initial concern -> conclusion and why"],"findings":[{"severity":"critical | high | medium | low","id":"stable-id","detail":"specific issue"}]}'
    : '{"completion_status":"completed","changed_files":["path"],"head_sha":"40-char git SHA","test_suggestions":["command"],"summary":"result"}';
  return [
    `VibePro runtime dispatch ${request.dispatch_id} for Story ${request.story_id}, task ${request.task_id}.`,
    `Objective: ${request.objective}`,
    contract,
    'Your final response MUST contain one JSON object with exactly these fields:',
    resultShape,
    'Do not claim completion unless head_sha is the actual current git HEAD.'
  ].join('\n');
}

function createRunRecord(providerRunId, request, child) {
  return { providerRunId, request, child, status: 'queued', message: null, stopReason: null, stdout: '', stderr: '', cancelRequested: false, timeoutRequested: false, timeoutHandle: null, spawned: null, settled: null };
}

function attachProcess(record) {
  record.spawned = new Promise((resolve, reject) => {
    record.child.once('spawn', () => {
      record.status = 'running';
      const timeoutMs = Number(record.request.requirements?.timeout_ms);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        record.timeoutHandle = setTimeout(() => {
          if (TERMINAL.has(record.status)) return;
          record.timeoutRequested = true;
          record.child.kill('SIGKILL');
        }, timeoutMs);
        record.timeoutHandle.unref?.();
      }
      resolve();
    });
    record.child.once('error', (error) => { record.status = 'failed'; record.message = error.message; reject(typedStartError(error)); });
  });
  record.child.stdout?.on('data', (chunk) => { record.stdout += chunk.toString(); });
  record.child.stderr?.on('data', (chunk) => { record.stderr += chunk.toString(); });
  record.settled = new Promise((resolve) => record.child.once('close', (code, signal) => {
    if (record.timeoutHandle) clearTimeout(record.timeoutHandle);
    if (record.cancelRequested) record.status = 'cancelled';
    else if (record.timeoutRequested) {
      record.status = 'timed_out';
      record.message = 'provider exceeded the requested timeout';
      record.stopReason = { code: 'timeout', message: record.message };
    }
    else if (signal) { record.status = 'failed'; record.message = `terminated by ${signal}`; }
    else if (code === 0) record.status = 'completed';
    else {
      record.status = 'failed';
      record.message = record.stderr.trim() || `provider exited with code ${code}`;
      record.stopReason = classifyProviderStop(record.message);
    }
    resolve();
  }));
}

async function waitForSpawn(record) {
  await record.spawned;
}

function classifyProviderStop(message) {
  const code = AUTH_PATTERN.test(message) ? 'auth_denied'
    : QUOTA_PATTERN.test(message) ? 'quota_exceeded'
      : PERMISSION_PATTERN.test(message) ? 'permission_wait' : 'runtime_failed';
  return { code, message };
}

function typedStartError(error) {
  const message = error?.message ?? String(error);
  const code = AUTH_PATTERN.test(message) ? 'auth_denied'
    : QUOTA_PATTERN.test(message) ? 'quota_exceeded'
      : PERMISSION_PATTERN.test(message) ? 'permission_wait' : 'runtime_unavailable';
  return new AgentRuntimeError(code, message);
}

function classifyUnavailable(error) {
  return typedStartError(error).code;
}

function unavailable(reason) {
  return { available: false, capabilities: [], sandbox: null, approval_policy: null, reason };
}

function requireRun(runs, providerRunId) {
  const record = runs.get(providerRunId);
  if (!record) throw new AgentRuntimeError('runtime_unavailable', `unknown provider run: ${providerRunId}`);
  return record;
}

function extractStructuredResult(output) {
  const candidates = [];
  for (const line of String(output).split(/\r?\n/)) {
    try { collectObjects(JSON.parse(line), candidates); } catch { /* provider text may not be JSON */ }
  }
  const result = candidates.findLast((value) => value?.completion_status === 'completed' && Array.isArray(value.changed_files));
  if (!result) throw new AgentRuntimeError('invalid_runtime_result', 'provider output did not contain the required structured completion result');
  return result;
}

function collectObjects(value, output) {
  if (!value || typeof value !== 'object') return;
  output.push(value);
  if (Array.isArray(value)) value.forEach((entry) => collectObjects(entry, output));
  else Object.values(value).forEach((entry) => collectObjects(entry, output));
  for (const field of ['text', 'result', 'output_text']) {
    if (typeof value[field] !== 'string') continue;
    const match = value[field].match(/\{[\s\S]*\}/);
    if (!match) continue;
    try { collectObjects(JSON.parse(match[0]), output); } catch { /* ignore non-contract text */ }
  }
}

function extractUsage(output, provider) {
  let totalTokens = null;
  let costUsd = null;
  for (const line of String(output).split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      const usage = event.usage ?? event.result?.usage ?? {};
      const tokens = usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0));
      if (Number.isFinite(tokens) && tokens > 0) totalTokens = tokens;
      const cost = event.total_cost_usd ?? event.cost_usd ?? event.result?.total_cost_usd;
      if (Number.isFinite(cost) && cost >= 0) costUsd = cost;
    } catch { /* ignore provider text */ }
  }
  return { total_tokens: totalTokens, cost_usd: costUsd, source: provider };
}

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new AgentRuntimeError('invalid_adapter', `${name} is required`);
  return value.trim();
}
