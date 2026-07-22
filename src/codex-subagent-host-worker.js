import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildCodexRuntimePrompt, codexRuntimeOutputSchema, toCodexCompletionResult } from './codex-runtime-output-contract.js';

const [runDir, repoRoot] = process.argv.slice(2);
if (!runDir || !repoRoot) process.exit(2);
let activeCodexChild = null;
let shutdownPromise = null;

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    shutdownPromise ??= stopActiveCodexChild(signal).finally(() => {
      process.exitCode = signal === 'SIGTERM' ? 143 : 130;
    });
  });
}

await main().catch(async (error) => {
  // A signal handler's promise is not itself an event-loop handle. Bind the
  // top-level lifecycle to it so this worker cannot exit before its direct
  // Codex child has emitted close and been reaped.
  if (shutdownPromise) await shutdownPromise;
  const request = await readJson(path.join(runDir, 'request.json'));
  const state = await readJson(path.join(runDir, 'state.json'));
  const event = {
    event_id: crypto.randomUUID(), dispatch_id: request?.dispatch_id, provider_run_id: state?.provider_run_id,
    kind: 'failed', observed_at: new Date().toISOString(), surface_hash: request?.inspection_surface_hash,
    payload: { message: boundedMessage(error) }
  };
  if (request && state) {
    const eventsDir = path.join(runDir, 'events');
    await mkdir(eventsDir, { recursive: true, mode: 0o700 });
    await writeJson(path.join(eventsDir, `000000-${event.event_id}.json`), event);
    await writeJson(path.join(runDir, 'completion-event.json'), event);
    await writeJson(path.join(runDir, 'state.json'), { ...state, status: 'failed', completed_at: event.observed_at, message: event.payload.message });
  }
  process.exitCode = 1;
});

async function main() {
  const request = await readJson(path.join(runDir, 'request.json'));
  const statePath = path.join(runDir, 'state.json');
  let state = await readJson(statePath);
  const schemaPath = path.join(runDir, 'output-schema.json');
  const outputPath = path.join(runDir, 'last-output.json');
  await writeJson(schemaPath, codexRuntimeOutputSchema(request));
  const args = ['exec', '--json', '--color', 'never', '--sandbox', 'read-only', '-C', repoRoot, '--output-schema', schemaPath, '-o', outputPath];
  if (process.env.VIBEPRO_CODEX_MODEL) args.push('--model', process.env.VIBEPRO_CODEX_MODEL);
  args.push('-');
  const observed = await runCodex(process.env.VIBEPRO_CODEX_EXECUTABLE ?? 'codex', args, buildCodexRuntimePrompt(request));
  state = {
    ...state,
    provider_session_id: observed.sessionId ?? null,
    ...(observed.usageAccounting ? { usage_accounting: observed.usageAccounting } : {})
  };
  const output = JSON.parse(await readFile(outputPath, 'utf8'));
  const result = toCodexCompletionResult(request, state, output);
  const eventsDir = path.join(runDir, 'events');
  await mkdir(eventsDir, { recursive: true, mode: 0o700 });
  let eventIndex = 0;
  const partialEvents = output.judgments.map((judgment) => ({
    event_id: crypto.randomUUID(), dispatch_id: request.dispatch_id, provider_run_id: state.provider_run_id,
    kind: 'partial_result', observed_at: new Date().toISOString(), surface_hash: request.inspection_surface_hash,
    payload: judgment
  }));
  for (const partial of partialEvents) {
    await writeJson(path.join(eventsDir, `${String(eventIndex).padStart(6, '0')}-${partial.event_id}.json`), partial);
    eventIndex += 1;
  }
  const event = {
    event_id: crypto.randomUUID(), dispatch_id: request.dispatch_id, provider_run_id: state.provider_run_id,
    kind: 'completed', observed_at: new Date().toISOString(), surface_hash: request.inspection_surface_hash, result
  };
  await writeJson(path.join(eventsDir, `${String(eventIndex).padStart(6, '0')}-${event.event_id}.json`), event);
  await writeJson(path.join(runDir, 'completion-event.json'), event);
  await writeJson(statePath, { ...state, status: 'delivery_pending', completion_observed_at: event.observed_at });
  await rm(outputPath, { force: true });
  try {
    for (const persistedEvent of [...partialEvents, event]) await deliverToRuntime(request, persistedEvent);
    await writeJson(statePath, { ...state, status: 'completed', completed_at: event.observed_at });
  } catch (error) {
    await writeJson(path.join(runDir, 'delivery-error.json'), { observed_at: new Date().toISOString(), message: boundedMessage(error) });
  }
  await writeJson(path.join(runDir, 'worker-finished.json'), { observed_at: new Date().toISOString() });
}

function runCodex(executable, args, prompt) {
  const executableArgs = JSON.parse(process.env.VIBEPRO_CODEX_EXECUTABLE_ARGS ?? '[]');
  const child = spawn(executable, [...executableArgs, ...args], {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  activeCodexChild = child;
  const completion = new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = boundedAppend(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = boundedAppend(stderr, chunk); });
    child.on('error', (error) => {
      activeCodexChild = null;
      reject(error);
    });
    child.on('close', (code) => {
      activeCodexChild = null;
      if (shutdownPromise) return reject(new Error('Codex exec stopped by host shutdown'));
      if (code !== 0) return reject(new Error(`Codex exec failed (${code}): ${stderr.slice(-4096)}`));
      let sessionId = null;
      let usageAccounting = null;
      for (const line of stdout.split('\n')) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'thread.started') sessionId = event.thread_id ?? event.thread?.id ?? null;
          usageAccounting = mergeUsageAccounting(usageAccounting, usageFromEvent(event));
        } catch {}
      }
      resolve({ sessionId, usageAccounting });
    });
  });
  return writeJson(path.join(runDir, 'codex-process.json'), { pid: child.pid, started_at: new Date().toISOString() })
    .then(() => {
      child.stdin.end(prompt);
      return completion;
    }, (error) => {
      signalCodexTree(child, 'SIGTERM');
      throw error;
    });
}

async function stopActiveCodexChild(signal) {
  const child = activeCodexChild;
  if (child) {
    const closed = new Promise((resolve) => child.once('close', resolve));
    signalCodexTree(child, signal);
    const stopped = await Promise.race([
      closed.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1500))
    ]);
    if (!stopped) {
      signalCodexTree(child, 'SIGKILL');
      const killed = await Promise.race([
        closed.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 3000))
      ]);
      if (!killed) return;
    }
  }
  await writeJson(path.join(runDir, 'shutdown-finished.json'), { observed_at: new Date().toISOString() });
}

function signalCodexTree(child, signal) {
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error.code === 'ESRCH') return;
      if (error.code !== 'EINVAL' && error.code !== 'EPERM') throw error;
    }
  }
  child.kill(signal);
}

async function deliverToRuntime(request, event) {
  const eventPath = path.join(runDir, 'runtime-event.json');
  await writeJson(eventPath, event);
  const cliPath = path.join(repoRoot, 'bin', 'vibepro.js');
  const args = [cliPath, 'execute', 'runtime-ingest', repoRoot, '--story-id', request.story_id, '--run-id', request.run_id,
    '--dispatch-id', request.dispatch_id, '--event', eventPath, '--json'];
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = boundedAppend(stderr, chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`runtime-ingest exited ${code}: ${stderr.slice(-4096)}`)));
  });
}

function boundedAppend(current, chunk) { return `${current}${chunk}`.slice(-1024 * 1024); }
function boundedMessage(error) { return String(error?.message ?? error).slice(0, 4096); }
function usageFromEvent(event) {
  const source = event?.usage_accounting ?? event?.usage ?? event?.turn?.usage;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const inputTokens = nonNegativeNumber(source.input_tokens);
  const outputTokens = nonNegativeNumber(source.output_tokens);
  const explicitTotal = nonNegativeNumber(source.total_tokens);
  const costUsd = nonNegativeNumber(source.cost_usd);
  const usage = {};
  if (inputTokens !== null) usage.input_tokens = inputTokens;
  if (outputTokens !== null) usage.output_tokens = outputTokens;
  if (explicitTotal !== null) usage.total_tokens = explicitTotal;
  else if (inputTokens !== null || outputTokens !== null) usage.total_tokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  if (costUsd !== null) usage.cost_usd = costUsd;
  return Object.keys(usage).length > 0 ? usage : null;
}
function mergeUsageAccounting(current, observed) {
  if (!observed) return current;
  if (!current) return observed;
  const merged = { ...current };
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'cost_usd']) {
    if (observed[key] !== undefined) merged[key] = Math.max(merged[key] ?? 0, observed[key]);
  }
  return merged;
}
function nonNegativeNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}
