import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { assertManagedWorktreeCommandAllowed } from './managed-worktree.js';
import { collectGitContext } from './git-fingerprint.js';
import { collectCurrentGeneratedProjectionPaths } from './artifact-routing.js';
import { buildContentBinding } from './content-binding.js';
import { resolvePrArtifactFile } from './artifact-routing.js';
import { assertRuntimeIntegrity } from './runtime-info.js';
import { enqueueBrainbaseLearningCandidate } from './brainbase-integration.js';

const ALLOWED_KINDS = new Set(['unit', 'integration', 'e2e', 'typecheck', 'build']);
const ALLOWED_STATUSES = new Set(['pass', 'passed', 'success', 'ok', 'fail', 'failed', 'error', 'needs_setup']);
const PASS_STATUSES = new Set(['pass', 'passed', 'success', 'ok']);
const FAIL_STATUSES = new Set(['fail', 'failed', 'error']);
const EVIDENCE_LOCK_TIMEOUT_MS = 10000;
const EVIDENCE_LOCK_STALE_MS = 60000;

// Evidence source is a property of the recording path, never of agent input: there is no
// CLI flag for it. A caller that computes the outcome itself (the local runner, the CI
// importer) presents this receipt; every other caller records self-reported evidence.
export const RUNNER_EVIDENCE_RECEIPT = Symbol('vibepro-computed-verification-evidence');
// runner_direct: `verify run` executed argv itself and parsed the outcome from the run.
// autopilot_run: `pr autopilot` executed a configured shell command and derived the status
//   from its exit code — VibePro-computed, but without the runner's argv execution,
//   parsed counts, before/after tree sampling, or output hash.
// ci_import:     a completed CI check at the current head was transcribed.
const COMPUTED_EVIDENCE_SOURCES = new Set(['runner_direct', 'autopilot_run', 'ci_import']);
const SELF_REPORTED_EVIDENCE_SOURCE = 'self_reported';

export async function recordVerificationEvidence(repoRoot, options = {}) {
  const storyId = options.storyId;
  if (!storyId) throw new Error('verify record requires --id <story-id>');
  if (!ALLOWED_KINDS.has(options.kind)) {
    throw new Error(`verify record --kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`);
  }
  if (!ALLOWED_STATUSES.has(options.status)) {
    throw new Error(`verify record --status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`);
  }
  const runtimeIdentity = await assertRuntimeIntegrity({
    purpose: 'evidence_generation',
    env: options.env
  });
  const computedRecording = resolveComputedRecording(options);
  // The receipt decides whether the computed keys on this record are the recording path's own
  // or a caller's, so it also decides whether either producer of observation.values may carry
  // one in. It is read once here and applied to both producers below.
  const receiptBacked = options.evidenceReceipt === RUNNER_EVIDENCE_RECEIPT;
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root);
  await assertManagedWorktreeCommandAllowed(root, {
    storyId,
    commandName: 'verify record'
  });
  const generatedProjectionPaths = await collectCurrentGeneratedProjectionPaths(root, { storyId });
  const gitContext = await collectGitContext(root, { userExcludePaths: generatedProjectionPaths });
  const { check: artifactCheck, observedValues: liftedArtifactValues } = await crossCheckArtifact(root, {
    artifact: options.artifact,
    status: options.status
  });
  // The artifact is a file the caller chose, so its lifted values are caller input on every
  // path but the receipt-backed one, where the artifact was written by the recording path
  // itself moments earlier and carries its own computed evidence_source.
  const artifactFilter = receiptBacked
    ? { values: liftedArtifactValues, rejected: [] }
    : partitionCallerForbiddenValues(liftedArtifactValues, `--artifact ${options.artifact}`);
  const artifactObservedValues = artifactFilter.values;
  const observation = buildObservation(options, artifactObservedValues, { receiptBacked });
  assertCommandMatchesVerificationKind(options.kind, options.command, options.status, observation, artifactCheck, artifactObservedValues);
  assertCommandNamedTestPathsExist(root, options.command, options.status);
  const observationCheck = buildObservationCheck({ status: options.status, observation });
  const evidencePath = await resolvePrArtifactFile(root, storyId, 'verification-evidence.json');
  await mkdir(path.dirname(evidencePath), { recursive: true });
  const contentBinding = await buildContentBinding(root, {
    gitContext,
    strictHead: options.strictHeadBinding === true,
    targets: observation.targets,
    artifacts: [options.artifact].filter(Boolean)
  });
  let previousCommand = null;
  const evidence = await withEvidenceLock(evidencePath, async () => {
    const existing = await readEvidence(root, evidencePath, storyId);
    previousCommand = existing.commands.find((item) => item.kind === options.kind) ?? null;
    const managedWorktreeWarning = normalizeWarning(options.managedWorktreeWarning);
    const observationWarning = observationCheck.status === 'missing'
      ? {
          id: 'verification_observation_missing',
          command_name: 'verify record',
          reason: `passing ${options.kind} claim was recorded without observation targets, scenarios, or observed values; add --target/--scenario/--observed so the evidence states what was observed, not only what was run`
        }
      : null;
    // A silent strip would leave the record looking as if the caller had never claimed the
    // key, so the rejected value is named on the record itself: a reader sees both that the
    // claim was made and that it was not recorded. The wording states only what this path
    // can verify — the claim arrived, it was not recorded, and who writes the key — and the
    // operator's next move. It does not assert why the key was present: this path never
    // inspects whether the artifact came from a runner replay (a mistake) or was written by
    // hand (a forgery), and this reason is rendered to the adjudicator, so an unverified
    // benign cause stated as fact would exonerate exactly the case the filter exists for.
    // The key and value stay quoted for the audit trail.
    const callerKeyWarnings = artifactFilter.rejected.map((item) => ({
      id: 'verification_observation_caller_key_rejected',
      command_name: 'verify record',
      reason: `${item.key}="${item.value}" arrived from ${item.producer} and was not recorded in observation.values: `
        + `this record is ${computedRecording.source}, and only the recording path writes that key. `
        + 'If this artifact came from a real runner run, rerun `vibepro verify run` to restore a runner_direct record.'
    }));
    const command = {
      kind: options.kind,
      status: options.status,
      command: options.command ?? null,
      summary: options.summary ?? options.status,
      artifact: options.artifact ? normalizeArtifact(root, options.artifact) : null,
      artifact_check: artifactCheck,
      artifact_observed_values: artifactObservedValues,
      observation,
      observation_check: observationCheck,
      evidence_source: computedRecording.source,
      ...(computedRecording.computedObservation
        ? { computed_observation: computedRecording.computedObservation }
        : {}),
      ...(computedRecording.observationOverrides.length > 0
        ? { observation_overrides: computedRecording.observationOverrides }
        : {}),
      executed_at: options.executedAt ?? new Date().toISOString(),
      git_context: gitContext,
      content_binding: contentBinding,
      runtime_identity: runtimeIdentity,
      managed_worktree_context: normalizeManagedWorktreeContext(options.managedWorktreeContext),
      warnings: mergeWarnings(
        [managedWorktreeWarning, observationWarning, ...callerKeyWarnings].filter(Boolean),
        computedRecording.additionalWarnings
      )
    };
    const commands = [
      command,
      ...existing.commands.filter((item) => item.kind !== command.kind)
    ];
    const nextEvidence = {
      schema_version: '0.1.0',
      story_id: storyId,
      updated_at: new Date().toISOString(),
      runtime_identity: runtimeIdentity,
      warnings: mergeWarnings([], commands.flatMap((item) => item.warnings ?? [])),
      commands
    };
    await writeJsonAtomic(evidencePath, nextEvidence);
    return nextEvidence;
  });
  let brainbaseLearning = null;
  if (computedRecording.source !== SELF_REPORTED_EVIDENCE_SOURCE && PASS_STATUSES.has(String(options.status).toLowerCase())) {
    // Candidate generation and delivery are deliberately best-effort from the
    // verification path: a verified command remains a pass even when Brainbase
    // is unavailable. The durable outbox records the pending/retry state.
    try {
      brainbaseLearning = await enqueueBrainbaseLearningCandidate(root, {
        storyId,
        command: evidence.commands.find((item) => item.kind === options.kind),
        previousCommand,
        evidence,
        gitContext,
        now: options.now,
        repositoryRef: options.repositoryRef,
        send: options.brainbaseSend,
        retryDelayMs: options.brainbaseRetryDelayMs
      });
    } catch {
      // Candidate/outbox persistence is intentionally fail-soft. Keep the
      // computed verification pass durable and expose an explicit retry state;
      // never copy a transport or filesystem error into a learning artifact.
      brainbaseLearning = {
        status: 'pending',
        story_id: storyId,
        reason: 'candidate_enqueue_failed'
      };
    }
  }
  return {
    evidence,
    runtime_identity: runtimeIdentity,
    artifact: toWorkspaceRelative(root, evidencePath),
    ...(brainbaseLearning ? { brainbase_learning: brainbaseLearning } : {})
  };
}

function resolveComputedRecording(options) {
  const selfReported = {
    source: SELF_REPORTED_EVIDENCE_SOURCE,
    computedObservation: null,
    observationOverrides: [],
    additionalWarnings: []
  };
  if (options.evidenceReceipt !== RUNNER_EVIDENCE_RECEIPT) {
    if (options.evidenceSource || options.computedObservation || options.observationOverrides) {
      throw new Error(
        'verification evidence source is decided by the recording path, not by its caller: '
        + 'computed evidence requires the internal receipt held by `vibepro verify run` and `vibepro verify import-ci`.'
      );
    }
    return selfReported;
  }
  if (!COMPUTED_EVIDENCE_SOURCES.has(options.evidenceSource)) {
    throw new Error(
      `computed verification evidence source must be one of: ${[...COMPUTED_EVIDENCE_SOURCES].join(', ')}`
    );
  }
  return {
    source: options.evidenceSource,
    computedObservation: options.computedObservation ?? null,
    observationOverrides: Array.isArray(options.observationOverrides) ? options.observationOverrides : [],
    additionalWarnings: Array.isArray(options.additionalWarnings) ? options.additionalWarnings : []
  };
}

export function assertCommandMatchesVerificationKind(kind, command, status, observation = null, artifactCheck = null, artifactObservedValues = {}) {
  if (!PASS_STATUSES.has(status)) return;
  const normalized = String(command ?? '').trim();
  if (!normalized) {
    throw new Error(`passing ${kind} verification evidence requires --command <executed-command>`);
  }
  let quote = null;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '`' || (char === '$' && quote !== "'")) {
      throw new Error(`passing ${kind} verification evidence requires a single executable command without shell substitution: ${normalized}`);
    }
    if (char === '\\' && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (';&|<>\n\r'.includes(char)) {
      throw new Error(`passing ${kind} verification evidence requires a single executable command without shell control operators: ${normalized}`);
    }
  }
  if (quote) {
    throw new Error(`passing ${kind} verification evidence requires a single executable command without an unterminated quote: ${normalized}`);
  }
  const inspectionOnly = /^(?:git\s+(?:diff|show|status|log|ls-files)|(?:rg|grep|find|ls)\b)/i.test(normalized);
  const bareNativeTest = /^node\s+--test\s*$/i.test(normalized);
  const observedTestCount = ['numTotalTests', 'numPassedTests']
    .map((key) => Number(artifactObservedValues?.[key]))
    .find((value) => Number.isFinite(value) && value > 0);
  const observedTapTestCount = ['tests', 'pass']
    .map((key) => Number(artifactObservedValues?.[key]))
    .find((value) => Number.isFinite(value) && value > 0);
  const specializedNativeTest = /(?:^|[\s/_.-])(?:e2e|integration)(?:[\s/_.-]|$)/i.test(normalized);
  const nativeTestCheck = (!specializedNativeTest
    && /^node\s+--test\b(?=[^\r\n]*(?:--test-name-pattern(?:=|\s)|\s(?!-)\S+))/i.test(normalized))
    || (bareNativeTest && artifactCheck?.format === 'vitest_jest' && observedTestCount !== undefined)
    || (bareNativeTest && artifactCheck?.format === 'tap' && observedTapTestCount !== undefined);
  const genericUnitCheck = /^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test|check|unit)\b|npx\s+(?:vitest|jest)\b|pytest\b|cargo\s+test\b|go\s+test\b|make\s+(?:test|check|unit)\b)/i;
  const integrationCheck = /^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test:)?integration\b|node\s+--test\b[^\r\n]*\bintegration\b|npx\s+(?:vitest|jest)\b[^\r\n]*\bintegration\b|pytest\b[^\r\n]*\bintegration\b|make\s+integration\b)/i;
  const e2eCheck = /^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test:)?e2e\b|node\s+--test\b[^\r\n]*\be2e\b|npx\s+(?:playwright|cypress)\b|make\s+e2e\b)/i;
  const kindChecks = {
    unit: { test: (value) => genericUnitCheck.test(value) || nativeTestCheck },
    integration: integrationCheck,
    e2e: e2eCheck,
    typecheck: /^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:typecheck|check|lint)\b|npx\s+(?:tsc|eslint)\b|(?:tsc|eslint)\b|cargo\s+check\b|go\s+vet\b|make\s+(?:typecheck|check|lint)\b)/i,
    build: /^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:(?:[\w-]+:)*build(?:[:][\w-]+)*|compile|typecheck)\b|npx\s+(?:tsc|vite|next)\b|(?:tsc|vite|next)(?:\s+build)?\b|cargo\s+build\b|go\s+build\b|make(?:\s+(?:build|compile))?\b|docker\s+(?:build|compose\b.*\bbuild)\b)/i
  };
  const verifiedCiTranscript = /^CI\s+[^:]+:\s+https?:\/\//i.test(normalized)
    && artifactCheck?.status === 'verified'
    && artifactCheck?.format === 'ci_import'
    && Boolean(observation?.values?.head_sha);
  const executableCheck = verifiedCiTranscript || kindChecks[kind]?.test(normalized) === true;
  if (inspectionOnly || !executableCheck) {
    throw new Error(
      `verify record --kind ${kind} requires a recognized executable ${kind} check; inspection-only or arbitrary command is not valid passing evidence: ${normalized}`
    );
  }
}

// Runner prefixes whose positional file arguments name the tests the command claims to have
// executed. `node --test <missing>` prints "Could not find" and still exits 0, so a passing
// record naming a nonexistent file credits coverage that never ran; the only deterministic
// check is resolving the named paths themselves.
const TEST_RUNNER_COMMAND_PREFIX = /^(?:node\s+--test\b|(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+test\b|(?:npx\s+)?(?:vitest|jest|playwright)\b)/i;
const TEST_FILE_ARGUMENT = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
// Flags whose value is a separate token; the value must not be resolved as a path.
const VALUE_TAKING_FLAGS = new Set([
  '--test-name-pattern', '--test-reporter', '--test-reporter-destination', '--test-concurrency',
  '--config', '-c', '--reporter', '--grep', '-g', '-t', '--testNamePattern',
  '--project', '--workers', '--retries', '--timeout', '--shard', '--output',
  '--environment', '--dir', '--root', '--outputFile', '--maxWorkers'
]);

export function assertCommandNamedTestPathsExist(repoRoot, command, status) {
  if (!PASS_STATUSES.has(status)) return;
  const missing = missingNamedTestPaths(repoRoot, command);
  if (missing.length > 0) {
    throw new Error(
      'passing verification evidence names test paths that do not exist in the repository, '
      + `so the named coverage cannot have executed: ${missing.join(', ')}`
    );
  }
}

function missingNamedTestPaths(repoRoot, command) {
  const normalized = String(command ?? '').trim();
  if (!TEST_RUNNER_COMMAND_PREFIX.test(normalized)) return [];
  const tokens = tokenizeCommand(normalized);
  const missing = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const value = token.value;
    if (value === '--') continue;
    if (value.startsWith('-')) {
      const name = value.includes('=') ? value.slice(0, value.indexOf('=')) : value;
      if (!value.includes('=') && VALUE_TAKING_FLAGS.has(name)) index += 1;
      continue;
    }
    if (!TEST_FILE_ARGUMENT.test(value)) continue;
    if (/[*?[\]{}]/.test(value)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
    const absolute = path.resolve(repoRoot, value);
    const relative = path.relative(path.resolve(repoRoot), absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    if (!existsSync(absolute)) missing.push(value);
  }
  return missing;
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  let quoted = false;
  const push = () => {
    if (current.length > 0 || quoted) tokens.push({ value: current, quoted });
    current = '';
    quoted = false;
  };
  for (const char of String(command ?? '')) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      quoted = true;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    current += char;
  }
  push();
  return tokens;
}

export function renderVerificationEvidenceSummary(result) {
  const latest = result.evidence.commands[0];
  const warnings = latest.warnings?.length
    ? latest.warnings.map((warning) => `- ${warning.id}: ${warning.reason}`).join('\n')
    : '- none';
  const managedWorktree = formatManagedWorktreeContextSummary(latest.managed_worktree_context);
  return `# VibePro Verification Evidence

- story: ${result.evidence.story_id}
- kind: ${latest.kind}
- status: ${latest.status}
- evidence_source: ${latest.evidence_source ?? SELF_REPORTED_EVIDENCE_SOURCE}
- command: ${latest.command ?? '-'}
- artifact: ${result.artifact}
- managed_worktree: ${managedWorktree.headline}

## Managed Worktree Context

${managedWorktree.details}

## Warnings

${warnings}
`;
}

// The plain-text verify record output is a primary surface for policy drift: a policy_sync
// failure during this command's own gate/context refresh must be visible here, not only
// via --json (same rationale as the execution-state text summary).
function formatManagedWorktreeContextSummary(context) {
  if (!context) {
    return {
      headline: 'not_recorded',
      details: '- status: not_recorded'
    };
  }
  const worktree = context.managed_worktree ?? null;
  const policySync = worktree?.policy_sync ?? null;
  const policySyncHeadline = policySync?.status === 'failed' ? '/policy_sync_failed' : '';
  const headline = `${context.mode ?? 'unknown'}/${context.status ?? 'unknown'}${policySyncHeadline}`;
  const policySyncLines = policySync
    ? [
      `- policy_sync: ${policySync.status ?? '-'}${policySync.sections_updated?.length ? ` (${policySync.sections_updated.join(', ')})` : ''}`,
      ...(policySync.status === 'failed' || policySync.status === 'skipped'
        ? [`- policy_sync_reason: ${policySync.reason ?? '-'}`]
        : []),
      ...(policySync.last_event
        ? [`- policy_sync_last_event: ${policySync.last_event.status ?? '-'}${policySync.last_event.sections_updated?.length ? ` (${policySync.last_event.sections_updated.join(', ')})` : ''} at ${policySync.last_event.synced_at ?? '-'}`]
        : [])
    ]
    : ['- policy_sync: not_recorded'];
  return {
    headline,
    details: [
      `- status: ${context.status ?? '-'}`,
      `- mode: ${context.mode ?? '-'}`,
      `- reason: ${context.reason ?? '-'}`,
      ...(worktree
        ? [
          `- path: ${worktree.path ?? '-'}`,
          `- branch: ${worktree.branch ?? '-'}`,
          `- actual_branch: ${worktree.actual_branch ?? '-'}`,
          `- dirty: ${worktree.dirty === true ? 'true' : worktree.dirty === false ? 'false' : '-'}`,
          `- raw_dirty: ${worktree.raw_dirty === true ? 'true' : worktree.raw_dirty === false ? 'false' : '-'}`,
          ...policySyncLines
        ]
        : ['- worktree: not_recorded'])
    ].join('\n')
  };
}

async function readEvidence(repoRoot, evidencePath, storyId) {
  try {
    const parsed = JSON.parse(await readFile(evidencePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SyntaxError('verification evidence root must be a JSON object');
    }
    return {
      ...parsed,
      commands: Array.isArray(parsed.commands) ? parsed.commands : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        schema_version: '0.1.0',
        story_id: storyId,
        warnings: [],
        commands: []
      };
    }
    if (error instanceof SyntaxError) {
      const backupPath = await quarantineCorruptEvidence(repoRoot, evidencePath);
      throw new Error(
        `verification evidence JSON is corrupt: ${toWorkspaceRelative(repoRoot, evidencePath)}. ` +
        `Moved the corrupt file to ${toWorkspaceRelative(repoRoot, backupPath)}; inspect it before recording new evidence.`
      );
    }
    throw error;
  }
}

function normalizeWarning(warning) {
  return warning && typeof warning === 'object' ? warning : null;
}

function normalizeManagedWorktreeContext(context) {
  return context && typeof context === 'object' ? context : null;
}

function mergeWarnings(existing = [], next = []) {
  const warnings = [];
  const seen = new Set();
  for (const warning of [...next, ...existing]) {
    if (!warning?.id) continue;
    const key = `${warning.id}:${warning.command_name ?? ''}:${warning.reason ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(warning);
  }
  return warnings;
}

async function quarantineCorruptEvidence(repoRoot, evidencePath) {
  const backupPath = `${evidencePath}.corrupt-${Date.now()}-${process.pid}.bak`;
  await rename(evidencePath, backupPath);
  return backupPath;
}

async function withEvidenceLock(evidencePath, action) {
  const lockPath = `${evidencePath}.lock`;
  await acquireLock(lockPath);
  try {
    return await action();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function acquireLock(lockPath) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < EVIDENCE_LOCK_TIMEOUT_MS) {
    try {
      await mkdir(lockPath);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await removeStaleLock(lockPath);
      await sleep(25 + Math.floor(Math.random() * 25));
    }
  }
  throw new Error(`Timed out waiting for verification evidence lock: ${lockPath}`);
}

async function removeStaleLock(lockPath) {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > EVIDENCE_LOCK_STALE_MS) {
      await rm(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function assertInitializedWorkspace(repoRoot) {
  try {
    await readFile(path.join(getWorkspaceDir(repoRoot), 'vibepro-manifest.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('verify record requires an initialized VibePro workspace. Run `vibepro init <repo>` first.');
    }
    throw error;
  }
}

function normalizeArtifact(repoRoot, artifact) {
  const resolved = path.resolve(repoRoot, artifact);
  return toWorkspaceRelative(repoRoot, resolved);
}

// Exported for the sink test: the assert below is unreachable from the CLI while both of
// today's producers filter first, so the only way to prove it still fires — and that deleting
// it is a test failure — is to call this function with a producer that did not.
export function buildObservation(options, artifactObservedValues = {}, { receiptBacked = false } = {}) {
  const targets = normalizeStringList(options.targets);
  const scenarios = normalizeStringList(options.scenarios);
  const cliValues = parseObservedPairs(options.observed);
  // artifact-derived values first so explicit CLI observations win on key conflicts
  const values = { ...artifactObservedValues, ...cliValues };
  // The rule is enforced on the merged object as well as on each producer: a non-receipt
  // producer added later and routed through this function is covered without knowing the rule
  // exists. It is a backstop for that route, not for every route — a caller that assembles a
  // record without coming through here is outside its reach.
  if (!receiptBacked) {
    const leaked = Object.keys(values).filter((key) => isCallerForbiddenObservationKey(key));
    if (leaked.length > 0) {
      throw new Error(
        `verification observation values reached a self-reported record carrying ${leaked.join(', ')}, `
        + 'which states how the record was produced. A producer of observation.values bypassed '
        + 'the caller-forbidden key rule; route it through partitionCallerForbiddenValues.'
      );
    }
  }
  return { targets, scenarios, values };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

// observation.values has two caller-reachable producers — the `--observed` pairs parsed below
// and the values lifted back out of the cross-checked artifact, which is a file the caller
// wrote and chose — so the rule is one set applied to both, gated on the recording receipt.
//
// The set is drawn along one line: **provenance and integrity facts versus outcome facts**.
// A provenance fact states how the record was produced or proves that the production was
// undisturbed — the trust marker itself, the paths of the run files, the output and worktree
// hashes, the before/after head shas, the during-run mutation verdicts, the sampling
// completeness flags, the harness scrub, the declared limits and whether they were hit. None
// of those can be honestly asserted by a caller: they are readings a runner takes of its own
// execution, and a hand-recorded run has no execution of its own to read. An outcome fact —
// status, exit code, signal, counts, duration, timestamps, the head the work sits on — is
// something an agent transcribing a run it performed by hand legitimately reports, and
// `verify import-ci` legitimately lifts `head_sha` from the CI check it read.
//
// Restricting the set to `evidence_source` closed one instance and left the class open: a
// forged artifact still lifted `run_artifact`, `stdout_sha256`, `worktree_sha256_before` and
// a dozen siblings onto a self_reported record, which then read as machine-produced to any
// consumer that inspects observation.values rather than the one field. The relationship
// between this set, the allowlist below, and the runner's COMPUTED_OBSERVATION_KEYS is
// asserted in test/verification-runner.test.js, so a computed key added later must be
// classified into one of the two lists or the test fails.
export const CALLER_FORBIDDEN_OBSERVATION_KEYS = new Set([
  'evidence_source',
  'run_artifact',
  'run_log',
  'stdout_sha256',
  'output_sha256',
  'output_bytes',
  'log_truncated',
  'output_metrics',
  'timed_out',
  'output_limit_exceeded',
  'external_kill_signal',
  'timeout_ms',
  'max_output_bytes',
  'harness_env_removed',
  'runner_node_version',
  'head_sha_before',
  'head_sha_after',
  'head_moved_during_run',
  'tree_mutated_during_run',
  'worktree_changed_during_run',
  'worktree_sampled',
  'worktree_sampling_complete',
  'worktree_sha256_before',
  'worktree_sha256_after',
  'worktree_status_sha256_before',
  'worktree_status_sha256_after',
  'worktree_diff_sha256_before',
  'worktree_diff_sha256_after'
]);

// The other side of the partition: computed keys a caller may still supply, because they are
// outcomes an agent can observe without being the runner. Declared here rather than left
// implicit so the partition is a checkable property of two named sets instead of the
// complement of one.
export const HAND_SUPPLIABLE_OBSERVATION_KEYS = new Set([
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
  'head_sha'
]);

export function isCallerForbiddenObservationKey(key) {
  return CALLER_FORBIDDEN_OBSERVATION_KEYS.has(key);
}

// Direct CLI input is rejected outright (below); values arriving inside a file are stripped
// and reported instead, because an artifact written by some other tool is not something the
// caller can always edit, and refusing to record the run at all would cost more than dropping
// one key from it. Both producers apply the same set.
function partitionCallerForbiddenValues(values, producer) {
  const kept = {};
  const rejected = [];
  for (const [key, value] of Object.entries(values ?? {})) {
    if (isCallerForbiddenObservationKey(key)) {
      rejected.push({ key, value: String(value), producer });
      continue;
    }
    kept[key] = value;
  }
  return { values: kept, rejected };
}

function parseObservedPairs(observed) {
  const values = {};
  for (const entry of Array.isArray(observed) ? observed : []) {
    const raw = String(entry);
    const separator = raw.indexOf('=');
    const key = separator > 0 ? raw.slice(0, separator).trim() : '';
    const value = separator > 0 ? raw.slice(separator + 1).trim() : '';
    if (!key || !value) {
      throw new Error(`verify record --observed must be key=value, got: ${raw}`);
    }
    if (isCallerForbiddenObservationKey(key)) {
      throw new Error(
        `verify record --observed cannot set ${key}: it states how the record was produced `
        + 'and is written by the recording path itself.'
      );
    }
    values[key] = value;
  }
  return values;
}

function buildObservationCheck({ status, observation }) {
  const claimedOutcome = PASS_STATUSES.has(status) ? 'pass' : FAIL_STATUSES.has(status) ? 'fail' : null;
  const hasTargets = observation.targets.length > 0;
  const hasScenarios = observation.scenarios.length > 0;
  const hasValues = Object.keys(observation.values).length > 0;
  if (claimedOutcome === null) {
    return {
      status: 'not_applicable',
      reason: `claimed status "${status}" has no pass/fail outcome to observe`
    };
  }
  if (!hasTargets && !hasScenarios && !hasValues) {
    if (claimedOutcome !== 'pass') {
      return {
        status: 'not_applicable',
        reason: 'failing claim recorded without observation; observation is audited for passing claims'
      };
    }
    return {
      status: 'missing',
      reason: 'passing claim has no observation targets, scenarios, or observed values'
    };
  }
  if (hasTargets && (hasScenarios || hasValues)) {
    return {
      status: 'recorded',
      reason: 'observation states the inspected targets and what was observed'
    };
  }
  return {
    status: 'partial',
    reason: 'observation is incomplete; record targets plus scenarios or observed values'
  };
}

function extractArtifactObservedValues(data, parsed) {
  const values = {};
  const record = (key, value) => {
    if (value === undefined || value === null) return;
    values[key] = String(value);
  };
  if (parsed.format === 'vitest_jest') {
    record('numTotalTests', data.numTotalTests);
    record('numFailedTests', data.numFailedTests);
    record('numPassedTests', data.numPassedTests);
    record('success', data.success);
  }
  if (parsed.format === 'playwright') {
    record('expected', data.stats?.expected);
    record('unexpected', data.stats?.unexpected);
  }
  if (parsed.format === 'generic_status') {
    record('status', data.status);
    record('exit_code', data.exit_code);
    if (data.observed && typeof data.observed === 'object' && !Array.isArray(data.observed)) {
      for (const [key, value] of Object.entries(data.observed)) record(key, value);
    }
  }
  if (parsed.format === 'tap') {
    record('tests', data.tests);
    record('pass', data.pass);
    record('fail', data.fail);
  }
  if (parsed.format === 'ci_import') {
    record('check', data.observed?.check);
    record('conclusion', data.observed?.conclusion);
    record('run_url', data.observed?.run_url);
    record('head_sha', data.head_sha);
  }
  return values;
}

// observation.values has two producers: the CLI observations parsed here, and the values
// lifted back out of the run artifact above. The runner's protection assert only sees the
// first. This classifies a document the runner's own artifact writer produced, through the
// same parseArtifactOutcome the record path runs, rather than restating either the artifact
// shape or the extraction: a new artifact field that reroutes format detection (a `success`
// flag, a `stats` object) changes the lifted key set here instead of drifting away from the
// protected set unnoticed. verification-runner.js cross-asserts the result; see
// assertArtifactDerivedKeysProtected.
export function classifyRunnerArtifactProbe(probeDocument) {
  const parsed = parseArtifactOutcome(JSON.stringify(probeDocument));
  if (!parsed) {
    throw new Error(
      'the document `vibepro verify run` writes as its run artifact is no longer recognized by the '
      + 'record path artifact parser, so neither the values it will lift into observation.values nor '
      + 'the artifact_check shape the pre-flight must mirror can be derived from it.'
    );
  }
  return {
    format: parsed.format,
    derivedKeys: Object.keys(extractArtifactObservedValues(parsed.data, parsed))
  };
}

export function runnerArtifactDerivedObservationKeys(probeDocument) {
  return classifyRunnerArtifactProbe(probeDocument).derivedKeys;
}

async function crossCheckArtifact(repoRoot, { artifact, status }) {
  const claimedOutcome = PASS_STATUSES.has(status) ? 'pass' : FAIL_STATUSES.has(status) ? 'fail' : null;
  if (!artifact) {
    if (claimedOutcome !== 'pass') return { check: null, observedValues: {} };
    return {
      check: {
        status: 'missing',
        format: null,
        artifact_outcome: null,
        reason: 'no machine-readable artifact was provided for a passing claim'
      },
      observedValues: {}
    };
  }
  let raw;
  try {
    raw = await readFile(path.resolve(repoRoot, artifact), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `verify record --artifact not found: ${artifact}. ` +
        'Provide a machine-readable test output file that exists, or omit --artifact.'
      );
    }
    throw error;
  }
  const parsed = parseArtifactOutcome(raw);
  if (!parsed) {
    return {
      check: {
        status: 'unrecognized',
        format: null,
        artifact_outcome: null,
        reason: 'artifact is not a recognized machine-readable test output (vitest/jest, Playwright, TAP, or generic status JSON); recorded without cross-check'
      },
      observedValues: {}
    };
  }
  const observedValues = extractArtifactObservedValues(parsed.data, parsed);
  if (claimedOutcome === null) {
    return {
      check: {
        status: 'not_applicable',
        format: parsed.format,
        artifact_outcome: parsed.outcome,
        reason: `claimed status "${status}" has no pass/fail outcome to cross-check`
      },
      observedValues
    };
  }
  if (claimedOutcome === 'pass' && parsed.outcome === 'fail') {
    throw new Error(
      `verify record --status ${status} contradicts artifact ${artifact}: ` +
      `${parsed.format} output reports failures (${parsed.detail}). ` +
      'Fix the failures and rerun, or record the real status.'
    );
  }
  if (claimedOutcome !== parsed.outcome) {
    return {
      check: {
        status: 'contradicted',
        format: parsed.format,
        artifact_outcome: parsed.outcome,
        reason: `claimed status "${status}" but artifact reports ${parsed.outcome} (${parsed.detail})`
      },
      observedValues
    };
  }
  return {
    check: {
      status: 'verified',
      format: parsed.format,
      artifact_outcome: parsed.outcome,
      reason: `${parsed.format} artifact outcome matches the claimed status (${parsed.detail})`
    },
    observedValues
  };
}

function parseArtifactOutcome(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return parseTapArtifactOutcome(raw);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.schema_version === '0.1.0'
    && data.status === 'pass'
    && data.exit_code === 0
    && typeof data.head_sha === 'string'
    && data.head_sha.length > 0
    && data.observed?.head_sha === data.head_sha
    && String(data.ci_check?.status).toUpperCase() === 'COMPLETED'
    && String(data.ci_check?.conclusion).toUpperCase() === 'SUCCESS') {
    return {
      format: 'ci_import',
      outcome: 'pass',
      detail: `check=${data.observed?.check ?? data.ci_check?.name ?? 'unknown'}, head_sha=${data.head_sha}`,
      data
    };
  }
  if (typeof data.success === 'boolean' || typeof data.numFailedTests === 'number') {
    const failed = data.success === false || (data.numFailedTests ?? 0) > 0;
    return {
      format: 'vitest_jest',
      outcome: failed ? 'fail' : 'pass',
      detail: `numFailedTests=${data.numFailedTests ?? 0}, success=${data.success ?? 'unknown'}`,
      data
    };
  }
  const stats = data.stats;
  if (stats && typeof stats === 'object' && (typeof stats.unexpected === 'number' || typeof stats.expected === 'number')) {
    const failed = (stats.unexpected ?? 0) > 0;
    return {
      format: 'playwright',
      outcome: failed ? 'fail' : 'pass',
      detail: `unexpected=${stats.unexpected ?? 0}, expected=${stats.expected ?? 0}`,
      data
    };
  }
  if (typeof data.status === 'string') {
    if (PASS_STATUSES.has(data.status)) {
      return { format: 'generic_status', outcome: 'pass', detail: `status=${data.status}`, data };
    }
    if (FAIL_STATUSES.has(data.status)) {
      return { format: 'generic_status', outcome: 'fail', detail: `status=${data.status}`, data };
    }
  }
  return null;
}

function parseTapArtifactOutcome(raw) {
  const lines = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n');
  const plans = lines
    .map((line) => line.match(/^(\s*)(\d+)\.\.(\d+)(?:\s+#.*)?\s*$/))
    .filter(Boolean);
  const topLevelPlans = plans.filter((match) => match[1].length === 0);
  if (topLevelPlans.length !== 1) return null;
  const plan = topLevelPlans[0];
  const start = Number(plan[2]);
  const end = Number(plan[3]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;
  const expectedTests = end - start + 1;
  const points = lines
    .map((line) => line.match(/^(\s*)(not ok|ok)\b/))
    .filter((match) => match && match[1].length === 0);
  if (points.length !== expectedTests) return null;
  const failedPoints = points.filter((match) => match[2] === 'not ok').length;
  const summary = {};
  for (const line of lines) {
    const match = line.match(/^#\s+(tests|pass|fail)\s+(\d+)\s*$/);
    if (match) summary[match[1]] = Number(match[2]);
  }
  if (summary.tests !== undefined && summary.tests !== expectedTests) return null;
  if (summary.pass !== undefined && summary.pass !== expectedTests - failedPoints) return null;
  if (summary.fail !== undefined && summary.fail !== failedPoints) return null;
  if (failedPoints > 0 || summary.fail > 0) {
    return {
      format: 'tap',
      outcome: 'fail',
      detail: `plan=${start}..${end}, tests=${expectedTests}, pass=${summary.pass ?? expectedTests - failedPoints}, fail=${summary.fail ?? failedPoints}`,
      data: { tests: expectedTests, pass: summary.pass ?? expectedTests - failedPoints, fail: summary.fail ?? failedPoints }
    };
  }
  return {
    format: 'tap',
    outcome: 'pass',
    detail: `plan=${start}..${end}, tests=${expectedTests}, pass=${summary.pass ?? expectedTests}, fail=${summary.fail ?? 0}`,
    data: { tests: expectedTests, pass: summary.pass ?? expectedTests, fail: summary.fail ?? 0 }
  };
}
