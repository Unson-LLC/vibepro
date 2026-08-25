import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolvePrArtifactFile } from './artifact-routing.js';
import { assertRuntimeIntegrity } from './runtime-info.js';
import { toWorkspaceRelative } from './workspace.js';
import { classifyTermination, createProgressDeadline } from './progress-deadline.js';
import {
  RUNNER_EVIDENCE_RECEIPT,
  assertCommandMatchesVerificationKind,
  assertCommandNamedTestPathsExist,
  classifyRunnerArtifactProbe,
  normalizeVerificationScope,
  recordVerificationEvidence,
  runnerArtifactDerivedObservationKeys
} from './verification-evidence.js';

const execFileAsync = promisify(execFile);

const ALLOWED_KINDS = new Set(['unit', 'integration', 'e2e', 'typecheck', 'build']);
// The full suite has been measured at 28 minutes (load average ~100, unlimited parallelism)
// and 56 minutes (load average ~35, --test-concurrency=2); a default near those measurements
// records timeout-kill fails that are not test failures, so keep ~2x headroom over the worst.
const DEFAULT_TIMEOUT_MS = 7200000;
const MAX_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;
const MAX_STORED_LOG_BYTES = 256 * 1024;
// SIGTERM -> grace -> SIGKILL contract for a policy-killed run (wall-clock, no-progress, or
// output-limit cause). Short relative to typical suite run times so a killed run does not
// itself become a slow operation, but long enough for a well-behaved process to exit cleanly
// on SIGTERM before escalation.
const TERMINATION_GRACE_MS = 2000;
const PROGRESS_POLL_INTERVAL_MS = 200;

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
  'timed_out',
  'output_limit_exceeded',
  'external_kill_signal',
  'tree_mutated_during_run',
  'head_moved_during_run',
  'worktree_changed_during_run',
  'worktree_status_sha256_before',
  'worktree_status_sha256_after',
  'worktree_diff_sha256_before',
  'worktree_diff_sha256_after',
  'run_artifact',
  'run_log',
  'output_metrics',
  'timeout_ms',
  'max_output_bytes',
  'harness_env_removed',
  'runner_node_version',
  'evidence_source'
]);

const COMPUTED_OBSERVATION_KEY_SET = new Set(COMPUTED_OBSERVATION_KEYS);

// A computed key that is not in the protected set is agent-writable: CLI observations win
// the merge in buildObservation, so it would silently shadow the computed value with no
// override entry. Every fact the runner computes goes through this one object — not only
// the ones that read like observations — so adding a computed fact without protecting it
// fails the run instead of quietly reopening the hole.
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

// The assert above closes one direction only: everything this module computes is protected.
// It cannot see the second producer of observation.values — the extractor that lifts values
// back out of the written artifact — so a key added there would be agent-writable with this
// module silent. Asserting that direction too is what makes the protection a property of the
// key set rather than of the enumerated call sites, which is the distinction the round-5
// finding turned on.
// This runs before the command does, against the probe document, so a shape change fails the
// run instead of destroying the previous run's artifact first. The probe carries an empty
// `observed`, so it reports the keys the extractor lifts *around* the run's own computed
// values — the structural derivation, not this run's key set.
function assertArtifactDerivedKeysProtected(document = runArtifactProbeDocument()) {
  const derived = runnerArtifactDerivedObservationKeys(document);
  const unprotected = derived.filter((key) => !COMPUTED_OBSERVATION_KEY_SET.has(key));
  if (unprotected.length > 0) {
    throw new Error(
      'verify run writes an artifact whose top level is lifted into observation.values under '
      + `keys that are not protected from agent input: ${unprotected.join(', ')}. `
      + 'Add them to COMPUTED_OBSERVATION_KEYS so an --observed value cannot overwrite them.'
    );
  }
  // Returned rather than only asserted so dropping the call site is a failure rather than a
  // silent loss of the check.
  return derived;
}

// Markers that make a nested runner report to a foreign harness instead of running normally.
// Inheriting NODE_TEST_CONTEXT makes `node --test` exit 0 having run nothing and printed
// nothing — a silent green that this command exists to make impossible.
const HARNESS_ENV_MARKERS = Object.freeze(['NODE_TEST_CONTEXT', 'VIBEPRO_RUNTIME_MODE']);

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
  const scope = normalizeVerificationScope(options.scope, 'verify run');
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
  const runtimeIdentity = await assertRuntimeIntegrity({
    purpose: 'evidence_generation',
    env: options.env
  });
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const maxOutputBytes = normalizeOutputLimit(options.maxOutputBytes);
  // Defaults to timeoutMs when unset: with no separate --no-progress-deadline-ms, the
  // no-progress clock is exactly as permissive as the wall clock, so an already-silent
  // command is killed at the same instant either way and the wall-clock cause wins by
  // precedence — existing --timeout-ms-only behavior is unchanged. Passing a smaller value
  // lets a caller catch a stalled-but-still-running suite before the full wall-clock budget
  // is spent, while an actively progressing suite (tests keep completing) is not penalized.
  const noProgressDeadlineMs = normalizeNoProgressDeadline(options.noProgressDeadlineMs, timeoutMs);
  // Check the declared kind against the command before running it: the artifact and log
  // for this kind are overwritten by the run, so a post-execution rejection would destroy
  // the previous record's artifact while leaving that record pointing at it.
  assertRunnableKindCommand(options.kind, renderCommand(argv));
  // Reject nonexistent named test paths before executing: `node --test <missing-file>`
  // exits 0, so without this the run would produce a passing record crediting coverage
  // that never executed.
  assertCommandNamedTestPathsExist(root, renderCommand(argv), 'pass');

  // "The tree" is the checked-out commit plus the working tree: a suite that rewrites a
  // source file mid-run moves the tree without moving HEAD, so both are sampled.
  const treeBefore = await sampleTreeState(root);
  const startedAt = new Date();
  const execution = await executeCommand(root, argv, { timeoutMs, noProgressDeadlineMs, maxOutputBytes, env: options.env });
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
  const worktreeComparison = compareWorktreeSamples(treeBefore, treeAfter);
  const worktreeSampled = worktreeComparison.sampled;
  const worktreeSamplingComplete = worktreeComparison.complete;
  const worktreeChanged = worktreeComparison.changed;
  const treeMutated = headMoved || worktreeChanged;

  const runFilePaths = await resolveRunFilePaths(root, storyId, options.kind);
  assertArtifactDerivedKeysProtected();
  const computedValues = assertComputedKeysProtected({
    // status and evidence_source are computed here too, and both reach observation.values.
    // Carrying them in this object rather than only in the protected-key list is what puts
    // them under the assert instead of under a hand-maintained exception, and it gives the
    // discarded-input diff a real computed_value for them instead of null.
    status,
    evidence_source: 'runner_direct',
    run_artifact: toWorkspaceRelative(root, runFilePaths.artifactPath),
    run_log: toWorkspaceRelative(root, runFilePaths.logPath),
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
    log_truncated: String(Buffer.byteLength(output) > MAX_STORED_LOG_BYTES),
    output_metrics: outputMetrics,
    timed_out: String(execution.timedOut === true),
    output_limit_exceeded: String(execution.outputLimitExceeded === true),
    // A signal the runner did not send (someone else's SIGTERM, an OOM killer SIGKILL, a
    // manual `kill`) is recorded here rather than folded into timed_out: the misdiagnosis
    // this replaces was exactly that fold — an external kill recorded as a policy timeout.
    external_kill_signal: execution.externalKillSignal ?? 'none',
    // The declared limits are recorded whether or not they were hit, so a run capped low
    // enough to matter leaves a trace even when it finished inside the cap.
    timeout_ms: String(timeoutMs),
    max_output_bytes: String(maxOutputBytes),
    harness_env_removed: (execution.envRemoved ?? []).join(',') || 'none',
    runner_node_version: process.version,
    tree_mutated_during_run: String(treeMutated),
    head_moved_during_run: String(headMoved),
    worktree_changed_during_run: String(worktreeChanged),
    // The component hashes the verdict is actually computed from, so a reader can
    // recompute it from the record instead of trusting the conclusion.
    ...(treeBefore.status ? { worktree_status_sha256_before: treeBefore.status } : {}),
    ...(treeAfter.status ? { worktree_status_sha256_after: treeAfter.status } : {}),
    ...(treeBefore.diff ? { worktree_diff_sha256_before: treeBefore.diff } : {}),
    ...(treeAfter.diff ? { worktree_diff_sha256_after: treeAfter.diff } : {})
  });

  const { retained, overrides } = partitionAgentObservations(options.observed, computedValues);

  const warnings = buildRunWarnings({
    treeMutated,
    headMoved,
    worktreeChanged,
    worktreeSampled,
    worktreeSamplingComplete,
    status,
    outputEmpty: output.trim().length === 0,
    runCounts,
    timedOut: execution.timedOut === true,
    outputLimitExceeded: execution.outputLimitExceeded === true,
    externalKillSignal: execution.externalKillSignal ?? null,
    headBefore,
    headAfter,
    overrides,
    timeoutMs,
    maxOutputBytes,
    managedWorktreeWarning: options.managedWorktreeWarning ?? null
  });

  const restorePreviousRunFiles = await snapshotRunFiles(runFilePaths);
  const logPath = await withRunFileRestore(restorePreviousRunFiles, () => writeRunLog(runFilePaths.logPath, output));
  const written = await withRunFileRestore(restorePreviousRunFiles, () => writeRunArtifact(runFilePaths.artifactPath, storyId, options.kind, {
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
    maxOutputBytes,
    warnings,
    runtimeIdentity
  }));
  const artifactPath = written.artifactPath;
  // Classified from the document actually written, not from the empty probe: the probe carries
  // no `observed` block, so its two structural keys are not this run's key set — the extractor
  // also lifts every key under `observed`, which is the whole computed-value object. Reporting
  // the probe's answer stated `exit_code, status` on a record whose observation.values carried
  // ~37 artifact-lifted keys, which is a false claim about this record. The probe assert above
  // stays where it is, before execution, as the protection check; this is the description of
  // what happened. Re-asserting here covers the keys the probe cannot see: every one of them
  // comes from computedValues, which assertComputedKeysProtected already checked, so this can
  // only fire if a future edit lifts something from outside that object. Wrapped in the same
  // restore as the writes around it: this assert sits after the new artifact is on disk and
  // before the record commits, so a throw here without the restore would leave the evidence
  // file pointing at a replaced artifact — the exact window the restore invariant covers.
  const artifactDerivedKeys = await withRunFileRestore(restorePreviousRunFiles, () => assertArtifactDerivedKeysProtected(written.document));

  const record = await withRunFileRestore(restorePreviousRunFiles, () => recordVerificationEvidence(root, {
    storyId,
    kind: options.kind,
    status,
    command: renderCommand(argv),
    // An agent-supplied summary is added to the computed sentence, never in place of it:
    // `summary` is the first thing a reader (and some consumers) look at, so the runner's
    // own account of the run stays on every record.
    summary: composeSummary(options.summary, buildSummary(options.kind, status, execution, runCounts, durationMs)),
    scope,
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
      // Every fact mirrored here is also in `values`, which assertComputedKeysProtected has
      // checked against the protected set; nothing is computed on this object alone.
      values: computedValues,
      // The keys the record path lifts back out of *this run's* written artifact into
      // observation.values, classified off the document on disk.
      artifact_derived_keys: artifactDerivedKeys,
      run_artifact: computedValues.run_artifact,
      run_log: computedValues.run_log,
      tree_mutated_during_run: treeMutated,
      head_moved_during_run: headMoved,
      worktree_changed_during_run: worktreeChanged,
      worktree_sampled: worktreeSampled,
      worktree_sampling_complete: worktreeSamplingComplete,
      output_metrics: outputMetrics
    },
    observationOverrides: overrides,
    additionalWarnings: warnings,
    env: options.env
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
    runtime_identity: runtimeIdentity,
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

// Streams the command through node:child_process spawn instead of buffering it whole through
// execFile, so in-flight progress (the completed-test count, parsed off the growing stdout by
// the same extractOutputCounts() the post-run summary uses) can be fed to the shared
// progress-deadline kernel as it happens: a long suite stays alive while tests keep
// completing, and is killed once progress stalls. --timeout-ms remains an independent hard
// cap the kernel can never extend, matching the pre-existing semantics.
//
// On a policy kill (wall-clock, no-progress, or output-limit cause) the process group is sent
// SIGTERM, given TERMINATION_GRACE_MS to exit, then escalated to SIGKILL. classifyTermination
// (src/progress-deadline.js) distinguishes that from a signal verify run did not send — the
// external-kill case that the former `error.killed === true && Boolean(error.signal)` check
// used to fold into timed_out:true regardless of who sent the signal.
// Exported for direct unit testing of the streaming/bounding behavior (progress extension,
// no-progress kill independent of the wall clock, external-signal attribution) without
// routing through a shell runner whose own signal-propagation behavior would otherwise be
// what the test exercises. runVerificationCommand() remains the public contract.
export function executeCommand(root, argv, { timeoutMs, noProgressDeadlineMs, maxOutputBytes, env }) {
  const sanitized = sanitizeEnv(env);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: root,
        env: sanitized.env,
        detached: process.platform !== 'win32'
      });
    } catch (error) {
      reject(wrapSpawnError(error, argv[0]));
      return;
    }

    const kernel = createProgressDeadline({
      no_progress_deadline_ms: noProgressDeadlineMs,
      max_wall_clock_ms: timeoutMs,
      started_at: Date.now(),
      now: () => Date.now()
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputLimitExceeded = false;
    let policyKillCause = null;
    let settled = false;
    const sentSignals = [];
    let pollTimer;
    let escalationTimer;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(escalationTimer);
      resolve(result);
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (Buffer.byteLength(stdout) < maxOutputBytes) stdout += chunk;
      checkOutputLimit();
    });
    child.stderr?.on('data', (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (Buffer.byteLength(stderr) < maxOutputBytes) stderr += chunk;
      checkOutputLimit();
    });

    function checkOutputLimit() {
      if (outputLimitExceeded || policyKillCause) return;
      if (stdoutBytes > maxOutputBytes || stderrBytes > maxOutputBytes) {
        outputLimitExceeded = true;
        policyKillCause = 'output_limit_exceeded';
        killWithGrace();
      }
    }

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(escalationTimer);
      reject(wrapSpawnError(error, argv[0]));
    });

    child.on('close', (exitCode, signal) => {
      const termination = classifyTermination({ signal, sentSignals });
      const timedOut = policyKillCause === 'max_wall_clock_exceeded' || policyKillCause === 'no_progress_deadline_exceeded';
      settle({
        stdout,
        stderr,
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        signal: signal ?? null,
        timedOut,
        outputLimitExceeded,
        externalKillSignal: termination.kind === 'external_signal' ? termination.signal : null,
        envRemoved: sanitized.removed
      });
    });

    pollTimer = setInterval(() => {
      if (settled || policyKillCause) return;
      // The completed-test count parsed off the growing stdout so far is the monotonic
      // progress token: node --test prints a `# tests N` / `ℹ tests N` summary block per
      // completed describe/suite as it finishes, not only once at the very end, so this
      // value genuinely advances while the suite is progressing.
      const counts = extractOutputCounts(stdout);
      if (counts?.counts && Number.isFinite(counts.counts.tests)) kernel.observe(counts.counts.tests);
      const verdict = kernel.check();
      if (!verdict.ok) {
        policyKillCause = verdict.kill.code;
        killWithGrace();
      }
    }, PROGRESS_POLL_INTERVAL_MS);
    pollTimer.unref?.();

    function killWithGrace() {
      clearInterval(pollTimer);
      sendSignal('SIGTERM');
      escalationTimer = setTimeout(() => sendSignal('SIGKILL'), TERMINATION_GRACE_MS);
      escalationTimer.unref?.();
    }

    function sendSignal(signal) {
      if (!child.pid) return;
      sentSignals.push(signal);
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // ESRCH: the process already exited; nothing left to signal.
      }
    }
  });
}

function wrapSpawnError(error, commandName) {
  if (error.code === 'ENOENT') {
    return new Error(`verify run could not execute ${commandName}: command not found`);
  }
  return error;
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

async function writeRunLog(logPath, output) {
  await mkdir(path.dirname(logPath), { recursive: true });
  const buffer = Buffer.from(output);
  const stored = buffer.byteLength > MAX_STORED_LOG_BYTES
    ? `[truncated: kept the last ${MAX_STORED_LOG_BYTES} bytes of ${buffer.byteLength}]\n${buffer.subarray(buffer.byteLength - MAX_STORED_LOG_BYTES).toString('utf8')}`
    : output;
  await writeFile(logPath, stored);
  return logPath;
}

// The written document is returned alongside its path so the caller can classify what it
// actually wrote rather than re-deriving it from a probe that stands in for it.
async function writeRunArtifact(artifactPath, storyId, kind, run) {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const document = buildRunArtifactDocument(storyId, kind, run);
  await writeFile(artifactPath, `${JSON.stringify(document, null, 2)}\n`);
  return { artifactPath, document };
}

// The document a run artifact is written from. It is a named builder rather than an inline
// literal so the protection assert and the pre-flight artifact_check shape can be derived
// from the real shape (see runArtifactProbeDocument) instead of restating it.
function buildRunArtifactDocument(storyId, kind, run) {
  return {
    schema_version: '0.1.0',
    status: run.status,
    exit_code: run.execution.exitCode,
    evidence_source: 'runner_direct',
    producer: 'vibepro verify run',
    kind,
    story_id: storyId,
    runtime_identity: run.runtimeIdentity ?? null,
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
      external_kill_signal: run.execution.externalKillSignal ?? null,
      timeout_ms: run.timeoutMs,
      max_output_bytes: run.maxOutputBytes,
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
      node_version: run.computedValues.runner_node_version,
      harness_env_removed: run.execution.envRemoved ?? [],
      log: run.logPath,
      log_truncated: run.logTruncated
    },
    discarded_agent_observations: run.overrides,
    warnings: run.warnings
  };
}

// A minimal run put through the real artifact builder: what the record path will see, in the
// shape this module actually writes. Everything derived from the artifact — the keys lifted
// back into observation.values, the artifact_check format the pre-flight mirrors — is read
// off this document, so a field added to the builder reaches both derivations.
export function runArtifactProbeDocument() {
  const epoch = new Date(0);
  return buildRunArtifactDocument('probe-story', 'unit', {
    status: 'pass',
    argv: ['node'],
    command: 'node',
    execution: { exitCode: 0, signal: null, envRemoved: [], outputLimitExceeded: false },
    startedAt: epoch,
    finishedAt: epoch,
    durationMs: 0,
    headBefore: null,
    headAfter: null,
    treeBefore: null,
    treeAfter: null,
    treeMutated: false,
    headMoved: false,
    worktreeChanged: false,
    counts: null,
    outputMetrics: 'none',
    // Empty: the values the runner puts here are covered by assertComputedKeysProtected, and
    // this probe exists to derive what the extractor lifts around them.
    computedValues: {},
    overrides: [],
    logPath: null,
    logTruncated: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    timedOut: false,
    worktreeSampled: false,
    worktreeSamplingComplete: false,
    maxOutputBytes: MAX_OUTPUT_BUFFER_BYTES,
    warnings: []
  });
}

async function resolveRunFilePaths(root, storyId, kind) {
  return {
    artifactPath: await resolvePrArtifactFile(root, storyId, path.join('verification-runs', `${kind}.json`)),
    logPath: await resolvePrArtifactFile(root, storyId, path.join('verification-runs', `${kind}.log`))
  };
}

// Reads whatever the previous run left at the per-kind artifact and log paths so it can be
// put back verbatim if the new record does not commit. The `spent` flag makes the restore
// idempotent across the wrapped steps; it does not detect a commit, so the narrow window
// where recordVerificationEvidence throws after writing the evidence file would still roll
// the run files back under a committed record.
async function snapshotRunFiles({ artifactPath, logPath }) {
  const previous = [];
  for (const filePath of [artifactPath, logPath]) {
    try {
      previous.push({ filePath, content: await readFile(filePath) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      previous.push({ filePath, content: null });
    }
  }
  let spent = false;
  return async () => {
    if (spent) return;
    spent = true;
    // Every file is attempted before reporting: restoring one and abandoning the other
    // would leave a mismatched pair on disk under the surviving evidence record, which is
    // the state this exists to prevent.
    const failures = [];
    for (const { filePath, content } of previous) {
      try {
        if (content === null) await rm(filePath, { force: true });
        else await writeFile(filePath, content);
      } catch (error) {
        failures.push(`${filePath}: ${error.message}`);
      }
    }
    if (failures.length > 0) throw new Error(failures.join('; '));
  };
}

// Required rather than defaulted: a benign default would silently drop the caveat for any
// fact a future caller forgets to pass, which is the failure mode these warnings exist to
// prevent.
export function buildRunWarnings(input) {
  const required = [
    'treeMutated', 'headMoved', 'worktreeChanged', 'worktreeSampled', 'worktreeSamplingComplete',
    'status', 'outputEmpty', 'timedOut', 'outputLimitExceeded', 'overrides', 'timeoutMs', 'maxOutputBytes'
  ];
  const missing = required.filter((key) => input?.[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`buildRunWarnings requires every observed fact; missing: ${missing.join(', ')}`);
  }
  const {
    treeMutated, headMoved, worktreeChanged, worktreeSampled, worktreeSamplingComplete,
    status, outputEmpty, runCounts = null, timedOut, outputLimitExceeded,
    externalKillSignal = null,
    headBefore = null, headAfter = null, overrides,
    timeoutMs, maxOutputBytes, managedWorktreeWarning = null
  } = input;
  return [
    ...(managedWorktreeWarning ? [managedWorktreeWarning] : []),
    ...(treeMutated
      ? [{
          id: 'verification_tree_mutated_during_run',
          command_name: 'verify run',
          reason: headMoved
            ? `HEAD moved from ${shortSha(headBefore)} to ${shortSha(headAfter)} while the command was running${worktreeChanged ? ' and the working tree changed as well' : ''}; the recorded result does not describe a single tree`
            : 'the working tree changed while the command was running (HEAD is unchanged, tracked file state is not); the recorded result does not describe a single tree'
        }]
      : []),
    ...(!worktreeSampled
      ? [{
          id: 'verification_worktree_not_sampled',
          command_name: 'verify run',
          reason: 'the working-tree fingerprint could not be computed before and after the run, so an uncommitted mid-run change would not have been detected; only the HEAD comparison applies to this record'
        }]
      : []),
    ...(worktreeSampled && !worktreeSamplingComplete
      ? [{
          id: 'verification_worktree_sampling_partial',
          command_name: 'verify run',
          reason: 'the working-tree sample fell back to status lines only (the diff sample failed), so a mid-run edit that leaves the status lines unchanged would not have been detected for this record'
        }]
      : []),
    ...(overrides.length > 0
      ? [{
          id: 'verification_observation_overridden',
          command_name: 'verify run',
          reason: `agent-supplied --observed values were discarded for computed keys: ${overrides.map((item) => item.key).join(', ')}`
        }]
      : []),
    ...(status === 'pass' && outputEmpty
      ? [{
          id: 'verification_run_produced_no_output',
          command_name: 'verify run',
          reason: 'the command exited 0 without printing anything; a silent success is not evidence that any check ran'
        }]
      : []),
    ...(status === 'pass' && !outputEmpty && !runCounts
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
    ...(timedOut
      ? [{
          id: 'verification_run_timed_out',
          command_name: 'verify run',
          reason: `the command was killed after ${timeoutMs}ms; the recorded fail status is a timeout, not a test failure`
        }]
      : []),
    ...(outputLimitExceeded
      ? [{
          id: 'verification_run_output_limit_exceeded',
          command_name: 'verify run',
          reason: `the command was killed after exceeding the ${maxOutputBytes}-byte output buffer; the recorded fail status is an output-volume kill, not a test failure, and the captured output is incomplete`
        }]
      : []),
    // Distinct from verification_run_timed_out: this signal was not sent by `verify run`
    // itself, so a failing status here is neither a policy timeout nor a test failure — it
    // is whatever killed the process from outside. Folding this into timed_out is the exact
    // misattribution this warning exists to prevent.
    ...(externalKillSignal
      ? [{
          id: 'verification_run_killed_by_external_signal',
          command_name: 'verify run',
          reason: `the command exited on ${externalKillSignal}, a signal verify run did not send; the recorded fail status is an external kill, not a policy timeout or a test failure`
        }]
      : [])
  ];
}

// Any failure between the snapshot and a committed record puts the previous run's files
// back. A restore that itself fails is reported rather than swallowed: the operator would
// otherwise be told only about the original error while the run files on disk no longer
// match the evidence record that points at them.
async function withRunFileRestore(restore, action) {
  try {
    return await action();
  } catch (error) {
    try {
      await restore();
    } catch (restoreError) {
      throw new Error(
        `${error.message}\n\nThe previous run artifact and log could not be restored after this failure: `
        + `${restoreError.message}. The files under .vibepro/pr/<story-id>/verification-runs/ no longer `
        + 'match the evidence record that references them; inspect them before recording again.',
        { cause: error }
      );
    }
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

// The pre-flight must mirror the record-time rule, not a more permissive version of it: any
// allowance that depends on the artifact format would otherwise be granted here and refused
// after the command had already run. The format is classified from the document this module
// writes rather than named, so an artifact field that reroutes format detection moves the
// pre-flight and the record-time rule together instead of splitting them apart.
export function runnerArtifactCheckShape() {
  return Object.freeze({
    status: 'verified',
    format: classifyRunnerArtifactProbe(runArtifactProbeDocument()).format
  });
}

function assertRunnableKindCommand(kind, command) {
  try {
    assertCommandMatchesVerificationKind(kind, command, 'pass', null, runnerArtifactCheckShape(), {});
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

function normalizeNoProgressDeadline(value, timeoutMs) {
  if (value === undefined || value === null || value === '') return timeoutMs;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`verify run --no-progress-deadline-ms must be a positive number, got: ${value}`);
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
    status: worktree.status,
    diff: worktree.diff,
    complete: worktree.complete
  };
}

// Compares the two samples component by component. The diff component is only meaningful
// when both samples captured it: a sample that fell back to status lines alone hashes
// differently from a complete one even with an unchanged tree, so comparing the combined
// fingerprints would report a change that did not happen.
export function compareWorktreeSamples(before, after) {
  const sampled = Boolean(before.worktree && after.worktree);
  if (!sampled) return { sampled: false, complete: false, changed: false };
  const complete = Boolean(before.complete && after.complete);
  const statusChanged = before.status !== after.status;
  const diffChanged = complete && before.diff !== after.diff;
  return { sampled: true, complete, changed: statusChanged || diffChanged };
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
    const status = sha256(lines.join('\n'));
    const diffHash = diff.complete ? sha256(diff.text) : null;
    return {
      fingerprint: sha256(`${status}\n${diffHash ?? 'diff_unavailable'}`),
      status,
      diff: diffHash,
      complete: diff.complete
    };
  } catch {
    return { fingerprint: null, status: null, diff: null, complete: false };
  }
}

function shortSha(value) {
  return String(value ?? 'unknown').slice(0, 12);
}
