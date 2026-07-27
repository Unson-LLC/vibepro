import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolvePrArtifactFile } from './artifact-routing.js';
import { toWorkspaceRelative } from './workspace.js';
import { RUNNER_EVIDENCE_RECEIPT, assertCommandMatchesVerificationKind, recordVerificationEvidence } from './verification-evidence.js';

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
  'worktree_sha256_before',
  'worktree_sha256_after',
  'worktree_sampled',
  'worktree_sampling_complete',
  'stdout_sha256',
  'output_sha256',
  'output_bytes',
  'log_truncated',
  'evidence_source'
]);

const COMPUTED_OBSERVATION_KEY_SET = new Set(COMPUTED_OBSERVATION_KEYS);

// A computed key that is not in the protected set is agent-writable: CLI observations win
// the merge in buildObservation, so it would silently shadow the computed value with no
// override entry. Asserting the subset at the point of construction keeps the two from
// drifting apart when a new computed value is added.
function assertComputedKeysProtected(computedValues) {
  const unprotected = Object.keys(computedValues).filter((key) => !COMPUTED_OBSERVATION_KEY_SET.has(key));
  if (unprotected.length > 0) {
    throw new Error(
      `verify run computed values that are not protected from agent input: ${unprotected.join(', ')}. `
      + 'Add them to COMPUTED_OBSERVATION_KEYS so an --observed value cannot overwrite them.'
    );
  }
  return computedValues;
}

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
  const maxOutputBytes = normalizeOutputLimit(options.maxOutputBytes);
  // Check the declared kind against the command before running it: the artifact and log
  // for this kind are overwritten by the run, so a post-execution rejection would destroy
  // the previous record's artifact while leaving that record pointing at it.
  assertRunnableKindCommand(options.kind, renderCommand(argv));

  // "The tree" is the checked-out commit plus the working tree: a suite that rewrites a
  // source file mid-run moves the tree without moving HEAD, so both are sampled.
  const treeBefore = await sampleTreeState(root);
  const startedAt = new Date();
  const execution = await executeCommand(root, argv, { timeoutMs, maxOutputBytes, env: options.env });
  const finishedAt = new Date();
  const treeAfter = await sampleTreeState(root);

  const headBefore = treeBefore.head;
  const headAfter = treeAfter.head;
  const output = `${execution.stdout}${execution.stderr}`;
  const parsedCounts = extractOutputCounts(execution.stdout) ?? extractOutputCounts(output);
  const runCounts = parsedCounts?.counts ?? null;
  const outputMetrics = parsedCounts?.format ?? 'none';
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status = execution.exitCode === 0 && !execution.signal ? 'pass' : 'fail';
  const headMoved = Boolean(headBefore && headAfter && headBefore !== headAfter);
  // A difference between two fingerprints is proof of a change even when one of them was
  // only partially computed; it is the *absence* of a difference that a partial sample
  // cannot establish. Sampling state is recorded separately from the verdict.
  const worktreeSampled = Boolean(treeBefore.worktree && treeAfter.worktree);
  const worktreeSamplingComplete = worktreeSampled && treeBefore.complete && treeAfter.complete;
  const worktreeChanged = worktreeSampled && treeBefore.worktree !== treeAfter.worktree;
  const treeMutated = headMoved || worktreeChanged;

  const computedValues = assertComputedKeysProtected({
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
    worktree_sampled: String(worktreeSampled),
    worktree_sampling_complete: String(worktreeSamplingComplete),
    ...(treeBefore.worktree ? { worktree_sha256_before: treeBefore.worktree } : {}),
    ...(treeAfter.worktree ? { worktree_sha256_after: treeAfter.worktree } : {}),
    // stdout_sha256 covers stdout alone; output_sha256 covers exactly the stdout+stderr
    // stream the retained log is written from, so the log can be checked against it
    // whenever log_truncated is false.
    stdout_sha256: sha256(execution.stdout),
    output_sha256: sha256(output),
    output_bytes: String(Buffer.byteLength(output)),
    log_truncated: String(Buffer.byteLength(output) > MAX_STORED_LOG_BYTES)
  });

  const { retained, overrides } = partitionAgentObservations(options.observed, computedValues);

  const warnings = [
    ...(options.managedWorktreeWarning ? [options.managedWorktreeWarning] : []),
    ...(treeMutated
      ? [{
          id: 'verification_tree_mutated_during_run',
          command_name: 'verify run',
          reason: headMoved
            ? `HEAD moved from ${shortSha(headBefore)} to ${shortSha(headAfter)} while the command was running${worktreeChanged ? ' and the working tree changed as well' : ''}; the recorded result does not describe a single tree`
            : 'the working tree changed while the command was running (HEAD is unchanged, tracked file state is not); the recorded result does not describe a single tree'
        }]
      : []),
    ...(overrides.length > 0
      ? [{
          id: 'verification_observation_overridden',
          command_name: 'verify run',
          reason: `agent-supplied --observed values were discarded for computed keys: ${overrides.map((item) => item.key).join(', ')}`
        }]
      : []),
    ...(!worktreeSampled
      ? [{
          id: 'verification_worktree_not_sampled',
          command_name: 'verify run',
          reason: 'the working-tree fingerprint could not be computed before and after the run, so an uncommitted mid-run change would not have been detected; only the HEAD comparison applies to this record'
        }]
      : []),
    ...(worktreeSampled && !worktreeSamplingComplete && !worktreeChanged
      ? [{
          id: 'verification_worktree_sampling_partial',
          command_name: 'verify run',
          reason: 'the working-tree fingerprint was computed from status lines only (the diff sample failed), so no difference was seen but an uncommitted mid-run change cannot be ruled out for this record'
        }]
      : []),
    ...(status === 'pass' && output.trim().length === 0
      ? [{
          id: 'verification_run_produced_no_output',
          command_name: 'verify run',
          reason: 'the command exited 0 without printing anything; a silent success is not evidence that any check ran'
        }]
      : []),
    // Exit code 0 says the command did not fail; it does not say anything ran. Without
    // parsed counts the record carries no measure of how much was checked, so the gap is
    // named on the record instead of being left for a reader to notice.
    ...(status === 'pass' && output.trim().length > 0 && !runCounts
      ? [{
          id: 'verification_run_counts_not_parsed',
          command_name: 'verify run',
          reason: 'the command exited 0 but no test counts could be parsed from its output; the record proves the command did not fail, not how much it checked'
        }]
      : []),
    ...(status === 'pass' && runCounts && Number(runCounts.tests) <= 1
      ? [{
          id: 'verification_run_counts_trivial',
          command_name: 'verify run',
          reason: `the command exited 0 reporting only ${runCounts.tests} test(s); node --test reports tests 1 / pass 1 for a file that defines no tests, so this count does not distinguish a real check from an empty one`
        }]
      : []),
    ...(execution.timedOut
      ? [{
          id: 'verification_run_timed_out',
          command_name: 'verify run',
          reason: `the command was killed after ${timeoutMs}ms; the recorded fail status is a timeout, not a test failure`
        }]
      : []),
    ...(execution.outputLimitExceeded
      ? [{
          id: 'verification_run_output_limit_exceeded',
          command_name: 'verify run',
          reason: `the command was killed after exceeding the ${maxOutputBytes}-byte output buffer; the recorded fail status is an output-volume kill, not a test failure, and the captured output is incomplete`
        }]
      : [])
  ];

  // The previous run's artifact and log are the ones the current evidence record points
  // at. They are only replaced once the new record commits: any throw after this point
  // (evidence lock timeout, corrupt-evidence quarantine, lineage assertion) would
  // otherwise leave the surviving record pointing at a run that was never recorded.
  const restorePreviousRunFiles = await snapshotRunFiles(root, storyId, options.kind);
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
    treeBefore,
    treeAfter,
    treeMutated,
    headMoved,
    worktreeChanged,
    counts: runCounts,
    outputMetrics,
    computedValues,
    overrides,
    logPath: toWorkspaceRelative(root, logPath),
    logTruncated: Buffer.byteLength(output) > MAX_STORED_LOG_BYTES,
    timeoutMs,
    timedOut: execution.timedOut,
    worktreeSampled,
    worktreeSamplingComplete,
    warnings
  });

  const record = await recordEvidenceOrRestore(restorePreviousRunFiles, () => recordVerificationEvidence(root, {
    storyId,
    kind: options.kind,
    status,
    command: renderCommand(argv),
    // An agent-supplied summary is added to the computed sentence, never in place of it:
    // `summary` is the first thing a reader (and some consumers) look at, so the runner's
    // own account of the run stays on every record.
    summary: composeSummary(options.summary, buildSummary(options.kind, status, execution, runCounts, durationMs)),
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
      head_moved_during_run: headMoved,
      worktree_changed_during_run: worktreeChanged,
      output_metrics: outputMetrics
    },
    observationOverrides: overrides,
    additionalWarnings: warnings
  }));

  return {
    schema_version: '0.1.0',
    story_id: storyId,
    kind: options.kind,
    status,
    command: renderCommand(argv),
    exit_code: execution.exitCode,
    signal: execution.signal,
    timed_out: execution.timedOut,
    output_limit_exceeded: execution.outputLimitExceeded === true,
    duration_ms: durationMs,
    head_sha_before: headBefore,
    head_sha_after: headAfter,
    tree_mutated_during_run: treeMutated,
    worktree_sampled: worktreeSampled,
    worktree_sampling_complete: worktreeSamplingComplete,
    output_metrics: outputMetrics,
    counts: runCounts,
    warnings,
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
  // The warnings are the part an operator most needs: a killed run and a failing suite
  // both print `status: fail`, and only the warning says which one happened.
  const warnings = result.warnings?.length
    ? result.warnings.map((warning) => `- ${warning.id}: ${warning.reason}`).join('\n')
    : '- none';
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
- worktree sampled: ${result.worktree_sampled ? 'yes' : 'no'}
- run artifact: ${result.run_artifact}
- run log: ${result.run_log}
- evidence: ${result.artifact}

## Warnings

${warnings}

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

async function executeCommand(root, argv, { timeoutMs, maxOutputBytes, env }) {
  const sanitized = sanitizeEnv(env);
  try {
    const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
      cwd: root,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
      env: sanitized.env
    });
    return { stdout, stderr, exitCode: 0, signal: null, timedOut: false, envRemoved: sanitized.removed };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`verify run could not execute ${argv[0]}: command not found`);
    }
    // A maxBuffer overflow carries a string code and no killed/signal, so it would be
    // rethrown by the numeric-code guard and never reach the classification below.
    const outputLimitExceeded = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    if (typeof error.code !== 'number' && !error.killed && !outputLimitExceeded) throw error;
    return {
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
      exitCode: typeof error.code === 'number' ? error.code : 1,
      signal: error.signal ?? null,
        timedOut: error.killed === true && Boolean(error.signal) && !outputLimitExceeded,
      outputLimitExceeded,
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
      output_limit_exceeded: run.execution.outputLimitExceeded === true,
      timeout_ms: run.timeoutMs,
      head_sha_before: run.headBefore,
      head_sha_after: run.headAfter,
      worktree_sha256_before: run.treeBefore?.worktree ?? null,
      worktree_sha256_after: run.treeAfter?.worktree ?? null,
      tree_mutated_during_run: run.treeMutated,
      head_moved_during_run: run.headMoved,
      worktree_changed_during_run: run.worktreeChanged,
      worktree_sampled: run.worktreeSampled,
      worktree_sampling_complete: run.worktreeSamplingComplete,
      output_metrics: run.outputMetrics,
      counts: run.counts,
      harness_env_removed: run.execution.envRemoved ?? [],
      log: run.logPath,
      log_truncated: run.logTruncated
    },
    discarded_agent_observations: run.overrides,
    warnings: run.warnings
  };
  await writeFile(artifactPath, `${JSON.stringify(doc, null, 2)}\n`);
  return artifactPath;
}

// Reads whatever the previous run left at the per-kind artifact and log paths so it can be
// put back verbatim if the new record does not commit.
async function snapshotRunFiles(root, storyId, kind) {
  const artifactPath = await resolvePrArtifactFile(root, storyId, path.join('verification-runs', `${kind}.json`));
  const logPath = await resolvePrArtifactFile(root, storyId, path.join('verification-runs', `${kind}.log`));
  const previous = [];
  for (const filePath of [artifactPath, logPath]) {
    try {
      previous.push({ filePath, content: await readFile(filePath) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      previous.push({ filePath, content: null });
    }
  }
  return async () => {
    for (const { filePath, content } of previous) {
      if (content === null) await rm(filePath, { force: true });
      else await writeFile(filePath, content);
    }
  };
}

async function recordEvidenceOrRestore(restore, record) {
  try {
    return await record();
  } catch (error) {
    await restore().catch(() => null);
    throw error;
  }
}

function composeSummary(agentSummary, computedSummary) {
  const declared = String(agentSummary ?? '').trim();
  return declared ? `${computedSummary} | agent summary: ${declared}` : computedSummary;
}

function buildSummary(kind, status, execution, runCounts, durationMs) {
  const counts = runCounts ? `, tests=${runCounts.tests} pass=${runCounts.pass} fail=${runCounts.fail}` : '';
  return `vibepro verify run executed the ${kind} command: exit_code=${execution.exitCode}${counts}, duration_ms=${durationMs}, status=${status} computed from the exit code`;
}

// The pre-flight must mirror the record-time rule, not a more permissive version of it:
// the runner's own artifact always parses as generic_status, so any allowance that depends
// on a tap/vitest artifact would be granted here and refused after the command had already
// run. It is checked against the same shape the record path will see.
export const RUNNER_ARTIFACT_CHECK_SHAPE = Object.freeze({ status: 'verified', format: 'generic_status' });

function assertRunnableKindCommand(kind, command) {
  try {
    assertCommandMatchesVerificationKind(kind, command, 'pass', null, RUNNER_ARTIFACT_CHECK_SHAPE, {});
  } catch (error) {
    throw new Error(
      `${String(error.message).replace('verify record --kind', 'verify run --kind')}`
      + ' (verify run checks the command against the declared kind before executing it, so a rejected'
      + ' command never overwrites the previous run artifact; name the test files or use'
      + ' --test-name-pattern instead of a bare runner invocation)'
    );
  }
}

function normalizeArgv(argv) {
  return (Array.isArray(argv) ? argv : []).map((item) => String(item)).filter((item) => item.length > 0);
}

function normalizeOutputLimit(value) {
  if (value === undefined || value === null || value === '') return MAX_OUTPUT_BUFFER_BYTES;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`verify run --max-output-bytes must be a positive number, got: ${value}`);
  }
  return number;
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

async function sampleTreeState(root) {
  const worktree = await worktreeFingerprint(root);
  return {
    head: await gitHead(root),
    worktree: worktree.fingerprint,
    complete: worktree.complete
  };
}

async function gitHead(root) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return null;
  }
}

// Porcelain status plus the index/worktree tree hash: catches an edit to a tracked file,
// a new untracked file, and a staged change, none of which move HEAD.
async function worktreeFingerprint(root) {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024
    });
    const lines = stdout.replace(/\r\n?/g, '\n').split('\n').filter(Boolean).sort();
    const diff = await execFileAsync('git', ['diff', '--no-ext-diff'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    }).then((result) => ({ text: result.stdout, complete: true })).catch(() => ({ text: '', complete: false }));
    return { fingerprint: sha256(`${lines.join('\n')}\n${diff.text}`), complete: diff.complete };
  } catch {
    return { fingerprint: null, complete: false };
  }
}

function shortSha(value) {
  return String(value ?? 'unknown').slice(0, 12);
}
