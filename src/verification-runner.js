import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolvePrArtifactFile } from './artifact-routing.js';
import { toWorkspaceRelative } from './workspace.js';
import { RUNNER_EVIDENCE_RECEIPT, recordVerificationEvidence } from './verification-evidence.js';

const execFileAsync = promisify(execFile);

const ALLOWED_KINDS = new Set(['unit', 'integration', 'e2e', 'typecheck', 'build']);
const DEFAULT_TIMEOUT_MS = 1800000;
const MAX_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;
const MAX_STORED_LOG_BYTES = 256 * 1024;

// Every key in this set is produced by the runner from the actual execution.
// An agent-supplied --observed value for any of them is not recorded as-is:
// the computed value wins and the discarded input is kept as a visible diff.
export const COMPUTED_OBSERVATION_KEYS = Object.freeze([
  'status',
  'exit_code',
  'signal',
  'tests',
  'pass',
  'fail',
  'skipped',
  'todo',
  'duration_ms',
  'started_at',
  'finished_at',
  'head_sha',
  'head_sha_before',
  'head_sha_after',
  'stdout_sha256',
  'output_bytes',
  'evidence_source'
]);

const COMPUTED_OBSERVATION_KEY_SET = new Set(COMPUTED_OBSERVATION_KEYS);

// Markers that make a nested runner report to a foreign harness instead of running normally.
// Inheriting NODE_TEST_CONTEXT makes `node --test` exit 0 having run nothing and printed
// nothing — a silent green that this command exists to make impossible.
const HARNESS_ENV_MARKERS = Object.freeze(['NODE_TEST_CONTEXT']);

// `verify record` lets the agent write the command, the status, the observed numbers and
// the artifact they are cross-checked against, so the cross-check compares one piece of
// agent prose with another. `verify run` executes the command itself and records what the
// execution left behind: the exit code, the TAP counts parsed out of the real output, the
// head sha before and after the run, and the hash of the captured output. The agent can
// still declare procedure (kind, targets, scenarios, summary) but never the outcome.
export async function runVerificationCommand(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId;
  if (!storyId) throw new Error('verify run requires --id <story-id>');
  if (!ALLOWED_KINDS.has(options.kind)) {
    throw new Error(`verify run --kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`);
  }
  if (options.status !== undefined && options.status !== null) {
    throw new Error(
      'verify run does not accept --status: the status is computed from the exit code of the executed command. '
      + 'Use `vibepro verify record` if you need to transcribe an outcome observed outside VibePro.'
    );
  }
  const argv = normalizeArgv(options.argv);
  if (argv.length === 0) {
    throw new Error('verify run requires the command to execute after `--`, e.g. vibepro verify run . --id <id> --kind unit -- node --test test/foo.test.js');
  }
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  const headBefore = await gitHead(root);
  const startedAt = new Date();
  const execution = await executeCommand(root, argv, { timeoutMs, env: options.env });
  const finishedAt = new Date();
  const headAfter = await gitHead(root);

  const output = `${execution.stdout}${execution.stderr}`;
  const parsedCounts = extractOutputCounts(execution.stdout) ?? extractOutputCounts(output);
  const runCounts = parsedCounts?.counts ?? null;
  const outputMetrics = parsedCounts?.format ?? 'none';
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status = execution.exitCode === 0 && !execution.signal ? 'pass' : 'fail';
  const treeMutated = Boolean(headBefore && headAfter && headBefore !== headAfter);

  const computedValues = {
    exit_code: String(execution.exitCode),
    ...(execution.signal ? { signal: execution.signal } : {}),
    ...(runCounts
      ? Object.fromEntries(Object.entries(runCounts).map(([key, value]) => [key, String(value)]))
      : {}),
    duration_ms: String(durationMs),
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    ...(headBefore ? { head_sha_before: headBefore } : {}),
    ...(headAfter ? { head_sha_after: headAfter, head_sha: headAfter } : {}),
    stdout_sha256: sha256(execution.stdout),
    output_bytes: String(Buffer.byteLength(output))
  };

  const { retained, overrides } = partitionAgentObservations(options.observed, computedValues);

  const logPath = await writeRunLog(root, storyId, options.kind, output);
  const artifactPath = await writeRunArtifact(root, storyId, options.kind, {
    status,
    argv,
    command: renderCommand(argv),
    execution,
    startedAt,
    finishedAt,
    durationMs,
    headBefore,
    headAfter,
    treeMutated,
    counts: runCounts,
    outputMetrics,
    computedValues,
    overrides,
    logPath: toWorkspaceRelative(root, logPath),
    logTruncated: Buffer.byteLength(output) > MAX_STORED_LOG_BYTES,
    timeoutMs,
    timedOut: execution.timedOut
  });

  const warnings = [
    ...(options.managedWorktreeWarning ? [options.managedWorktreeWarning] : []),
    ...(treeMutated
      ? [{
          id: 'verification_tree_mutated_during_run',
          command_name: 'verify run',
          reason: `the working tree moved from ${shortSha(headBefore)} to ${shortSha(headAfter)} while the command was running; the recorded result does not describe a single tree`
        }]
      : []),
    ...(overrides.length > 0
      ? [{
          id: 'verification_observation_overridden',
          command_name: 'verify run',
          reason: `agent-supplied --observed values were discarded for computed keys: ${overrides.map((item) => item.key).join(', ')}`
        }]
      : []),
    ...(status === 'pass' && output.trim().length === 0
      ? [{
          id: 'verification_run_produced_no_output',
          command_name: 'verify run',
          reason: 'the command exited 0 without printing anything; a silent success is not evidence that any check ran'
        }]
      : []),
    ...(execution.timedOut
      ? [{
          id: 'verification_run_timed_out',
          command_name: 'verify run',
          reason: `the command was killed after ${timeoutMs}ms; the recorded fail status is a timeout, not a test failure`
        }]
      : [])
  ];

  const record = await recordVerificationEvidence(root, {
    storyId,
    kind: options.kind,
    status,
    command: renderCommand(argv),
    summary: options.summary ?? buildSummary(options.kind, status, execution, runCounts, durationMs),
    artifact: toWorkspaceRelative(root, artifactPath),
    targets: options.targets ?? [],
    scenarios: options.scenarios ?? [],
    observed: retained,
    executedAt: finishedAt.toISOString(),
    strictHeadBinding: options.strictHeadBinding === true,
    managedWorktreeContext: options.managedWorktreeContext ?? null,
    managedWorktreeWarning: options.managedWorktreeWarning ?? null,
    evidenceReceipt: RUNNER_EVIDENCE_RECEIPT,
    evidenceSource: 'runner_direct',
    computedObservation: {
      producer: 'vibepro verify run',
      computed_keys: Object.keys(computedValues),
      values: computedValues,
      run_artifact: toWorkspaceRelative(root, artifactPath),
      run_log: toWorkspaceRelative(root, logPath),
      tree_mutated_during_run: treeMutated,
      output_metrics: outputMetrics
    },
    observationOverrides: overrides,
    additionalWarnings: warnings
  });

  return {
    schema_version: '0.1.0',
    story_id: storyId,
    kind: options.kind,
    status,
    command: renderCommand(argv),
    exit_code: execution.exitCode,
    signal: execution.signal,
    timed_out: execution.timedOut,
    duration_ms: durationMs,
    head_sha_before: headBefore,
    head_sha_after: headAfter,
    tree_mutated_during_run: treeMutated,
    output_metrics: outputMetrics,
    counts: runCounts,
    observation_overrides: overrides,
    run_artifact: toWorkspaceRelative(root, artifactPath),
    run_log: toWorkspaceRelative(root, logPath),
    evidence: record.evidence,
    artifact: record.artifact
  };
}

export function renderVerificationRunSummary(result) {
  const counts = result.counts
    ? Object.entries(result.counts).map(([key, value]) => `${key}=${value}`).join(', ')
    : 'not parsed from output';
  const overrides = result.observation_overrides.length > 0
    ? result.observation_overrides
      .map((item) => `- ${item.key}: agent="${item.agent_value}" discarded, computed="${item.computed_value}"`)
      .join('\n')
    : '- none';
  return `# VibePro Verification Run (runner-direct)

- story: ${result.story_id}
- kind: ${result.kind}
- command: ${result.command}
- status: ${result.status} (computed from exit code ${result.exit_code}${result.signal ? `, signal ${result.signal}` : ''})
- counts: ${counts}
- duration_ms: ${result.duration_ms}
- head before/after: ${shortSha(result.head_sha_before)} -> ${shortSha(result.head_sha_after)}${result.tree_mutated_during_run ? ' (TREE MUTATED DURING RUN)' : ''}
- run artifact: ${result.run_artifact}
- run log: ${result.run_log}
- evidence: ${result.artifact}

## Discarded Agent Observations

${overrides}
`;
}

function partitionAgentObservations(observed, computedValues) {
  const retained = [];
  const overrides = [];
  for (const entry of Array.isArray(observed) ? observed : []) {
    const raw = String(entry);
    const separator = raw.indexOf('=');
    const key = separator > 0 ? raw.slice(0, separator).trim() : '';
    const value = separator > 0 ? raw.slice(separator + 1).trim() : '';
    if (!key || !value) {
      throw new Error(`verify run --observed must be key=value, got: ${raw}`);
    }
    if (COMPUTED_OBSERVATION_KEY_SET.has(key)) {
      overrides.push({
        key,
        agent_value: value,
        computed_value: computedValues[key] ?? null,
        reason: computedValues[key] === undefined
          ? 'key is computed by the runner and was not observed in this run; the agent value is not recorded'
          : 'key is computed by the runner; the agent value is not recorded'
      });
      continue;
    }
    retained.push(`${key}=${value}`);
  }
  return { retained, overrides };
}

function sanitizeEnv(env) {
  const base = { ...(env ?? process.env) };
  const removed = HARNESS_ENV_MARKERS.filter((key) => base[key] !== undefined);
  for (const key of removed) delete base[key];
  return { env: base, removed };
}

async function executeCommand(root, argv, { timeoutMs, env }) {
  const sanitized = sanitizeEnv(env);
  try {
    const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
      cwd: root,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BUFFER_BYTES,
      env: sanitized.env
    });
    return { stdout, stderr, exitCode: 0, signal: null, timedOut: false, envRemoved: sanitized.removed };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`verify run could not execute ${argv[0]}: command not found`);
    }
    if (typeof error.code !== 'number' && !error.killed) throw error;
    return {
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
      exitCode: typeof error.code === 'number' ? error.code : 1,
      signal: error.signal ?? null,
      timedOut: error.killed === true && Boolean(error.signal),
      envRemoved: sanitized.removed
    };
  }
}

// node --test emits a summary block whose prefix depends on the active reporter: `# tests N`
// under the TAP reporter, `ℹ tests N` under the spec reporter (the default since Node 22
// regardless of TTY). Both are read from the real output; the plan line is deliberately not
// used because it counts top-level tests while the summary counts every subtest.
function extractOutputCounts(output) {
  const lines = String(output ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (const [format, pattern] of [
    ['tap', /^#\s+(tests|pass|fail|skipped|todo)\s+(\d+)\s*$/],
    ['node_spec', /^\s*[ℹi]\s+(tests|pass|fail|skipped|todo)\s+(\d+)\s*$/]
  ]) {
    const counts = {};
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) counts[match[1]] = Number(match[2]);
    }
    if (counts.tests !== undefined && counts.pass !== undefined && counts.fail !== undefined) {
      return { format, counts };
    }
  }
  return null;
}

async function writeRunLog(root, storyId, kind, output) {
  const logPath = await resolvePrArtifactFile(root, storyId, path.join('verification-runs', `${kind}.log`));
  await mkdir(path.dirname(logPath), { recursive: true });
  const buffer = Buffer.from(output);
  const stored = buffer.byteLength > MAX_STORED_LOG_BYTES
    ? `[truncated: kept the last ${MAX_STORED_LOG_BYTES} bytes of ${buffer.byteLength}]\n${buffer.subarray(buffer.byteLength - MAX_STORED_LOG_BYTES).toString('utf8')}`
    : output;
  await writeFile(logPath, stored);
  return logPath;
}

async function writeRunArtifact(root, storyId, kind, run) {
  const artifactPath = await resolvePrArtifactFile(root, storyId, path.join('verification-runs', `${kind}.json`));
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const doc = {
    schema_version: '0.1.0',
    status: run.status,
    exit_code: run.execution.exitCode,
    evidence_source: 'runner_direct',
    producer: 'vibepro verify run',
    kind,
    story_id: storyId,
    head_sha: run.headAfter,
    observed: run.computedValues,
    run: {
      argv: run.argv,
      command: run.command,
      cwd: '.',
      started_at: run.startedAt.toISOString(),
      finished_at: run.finishedAt.toISOString(),
      duration_ms: run.durationMs,
      exit_code: run.execution.exitCode,
      signal: run.execution.signal,
      timed_out: run.timedOut,
      timeout_ms: run.timeoutMs,
      head_sha_before: run.headBefore,
      head_sha_after: run.headAfter,
      tree_mutated_during_run: run.treeMutated,
      output_metrics: run.outputMetrics,
      counts: run.counts,
      harness_env_removed: run.execution.envRemoved ?? [],
      log: run.logPath,
      log_truncated: run.logTruncated
    },
    discarded_agent_observations: run.overrides
  };
  await writeFile(artifactPath, `${JSON.stringify(doc, null, 2)}\n`);
  return artifactPath;
}

function buildSummary(kind, status, execution, runCounts, durationMs) {
  const counts = runCounts ? `, tests=${runCounts.tests} pass=${runCounts.pass} fail=${runCounts.fail}` : '';
  return `vibepro verify run executed the ${kind} command: exit_code=${execution.exitCode}${counts}, duration_ms=${durationMs}, status=${status} computed from the exit code`;
}

function normalizeArgv(argv) {
  return (Array.isArray(argv) ? argv : []).map((item) => String(item)).filter((item) => item.length > 0);
}

function normalizeTimeout(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_TIMEOUT_MS;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`verify run --timeout-ms must be a positive number, got: ${value}`);
  }
  return number;
}

// The recorded command string is for humans and for kind matching; the execution itself
// always uses argv, so nothing here can reintroduce a shell.
function renderCommand(argv) {
  return argv.map((item) => (/[\s"']/.test(item) ? JSON.stringify(item) : item)).join(' ');
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

async function gitHead(root) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return null;
  }
}

function shortSha(value) {
  return String(value ?? 'unknown').slice(0, 12);
}
