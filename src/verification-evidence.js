import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { assertManagedWorktreeCommandAllowed } from './managed-worktree-gate.js';
import { collectGitContext } from './git-fingerprint.js';
import { collectCurrentGeneratedProjectionPaths } from './artifact-routing.js';
import { buildContentBinding } from './content-binding.js';
import { refreshActiveRunContextCapsule } from './run-context-capsule.js';
import { assertRunLineageBinding, createRunLineageEnvelope } from './run-lineage.js';

const ALLOWED_KINDS = new Set(['unit', 'integration', 'e2e', 'typecheck', 'build']);
const ALLOWED_STATUSES = new Set(['pass', 'passed', 'success', 'ok', 'fail', 'failed', 'error', 'needs_setup']);
const PASS_STATUSES = new Set(['pass', 'passed', 'success', 'ok']);
const FAIL_STATUSES = new Set(['fail', 'failed', 'error']);
const EVIDENCE_LOCK_TIMEOUT_MS = 10000;
const EVIDENCE_LOCK_STALE_MS = 60000;

export async function recordVerificationEvidence(repoRoot, options = {}) {
  const storyId = options.storyId;
  if (!storyId) throw new Error('verify record requires --id <story-id>');
  if (!ALLOWED_KINDS.has(options.kind)) {
    throw new Error(`verify record --kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`);
  }
  if (!ALLOWED_STATUSES.has(options.status)) {
    throw new Error(`verify record --status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`);
  }
  const root = path.resolve(repoRoot);
  await assertInitializedWorkspace(root);
  await assertManagedWorktreeCommandAllowed(root, {
    storyId,
    commandName: 'verify record'
  });
  const generatedProjectionPaths = await collectCurrentGeneratedProjectionPaths(root, { storyId });
  const gitContext = await collectGitContext(root, { userExcludePaths: generatedProjectionPaths });
  const lineage = resolveRecorderLineage(options, {
    story_id: storyId,
    worktree_root: root,
    branch: gitContext.current_branch,
    head_sha: gitContext.head_sha
  }, `verification-${options.kind}`);
  const { check: artifactCheck, observedValues: artifactObservedValues } = await crossCheckArtifact(root, {
    artifact: options.artifact,
    status: options.status
  });
  const observation = buildObservation(options, artifactObservedValues);
  assertCommandMatchesVerificationKind(options.kind, options.command, options.status, observation, artifactCheck, artifactObservedValues);
  const observationCheck = buildObservationCheck({ status: options.status, observation });
  const prDir = path.join(getWorkspaceDir(root), 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  const evidencePath = path.join(prDir, 'verification-evidence.json');
  const contentBinding = await buildContentBinding(root, {
    gitContext,
    strictHead: options.strictHeadBinding === true,
    targets: observation.targets,
    artifacts: [options.artifact].filter(Boolean)
  });
  const evidence = await withEvidenceLock(evidencePath, async () => {
    const existing = await readEvidence(root, evidencePath, storyId);
    const managedWorktreeWarning = normalizeWarning(options.managedWorktreeWarning);
    const observationWarning = observationCheck.status === 'missing'
      ? {
          id: 'verification_observation_missing',
          command_name: 'verify record',
          reason: `passing ${options.kind} claim was recorded without observation targets, scenarios, or observed values; add --target/--scenario/--observed so the evidence states what was observed, not only what was run`
        }
      : null;
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
      executed_at: options.executedAt ?? new Date().toISOString(),
      git_context: gitContext,
      content_binding: contentBinding,
      ...(lineage ? { lineage } : {}),
      managed_worktree_context: normalizeManagedWorktreeContext(options.managedWorktreeContext),
      warnings: [managedWorktreeWarning, observationWarning].filter(Boolean)
    };
    const commands = [
      command,
      ...existing.commands.filter((item) => item.kind !== command.kind)
    ];
    const nextEvidence = {
      schema_version: '0.1.0',
      story_id: storyId,
      updated_at: new Date().toISOString(),
      warnings: mergeWarnings([], commands.flatMap((item) => item.warnings ?? [])),
      commands
    };
    await writeJsonAtomic(evidencePath, nextEvidence);
    return nextEvidence;
  });
  await refreshActiveRunContextCapsule(root, {
    storyId,
    reason: 'verification_recorded'
  });
  return {
    evidence,
    artifact: toWorkspaceRelative(root, evidencePath)
  };
}

function resolveRecorderLineage(options, recorderAuthority, dispatchId) {
  const supplied = options.lineage ?? options.runLineage;
  const runAuthority = options.runAuthority ?? options.activeRun ?? options.run ?? null;
  if (!supplied && !runAuthority) return null;
  const authority = runAuthority ? {
    ...runAuthority,
    story_id: runAuthority.story_id ?? runAuthority.storyId,
    run_id: runAuthority.run_id ?? runAuthority.runId,
    worktree_root: runAuthority.worktree_root ?? runAuthority.root_realpath ?? runAuthority.execution_context?.root_realpath,
    branch: runAuthority.branch ?? runAuthority.current_branch,
    head_sha: runAuthority.head_sha ?? runAuthority.current_head_sha
  } : null;
  const lineage = supplied
    ? assertRunLineageBinding(supplied, authority)
    : createRunLineageEnvelope({ ...authority, dispatch_id: authority.dispatch_id ?? dispatchId });
  assertRunLineageBinding(lineage, recorderAuthority);
  return lineage;
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
  const nativeTestCheck = /^node\s+--test\b(?=[^\r\n]*(?:--test-name-pattern(?:=|\s)|\s(?!-)\S+))/i.test(normalized)
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
    build: /^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:build|compile|typecheck)\b|npx\s+(?:tsc|vite|next)\b|(?:tsc|vite|next)(?:\s+build)?\b|cargo\s+build\b|go\s+build\b|make(?:\s+(?:build|compile))?\b|docker\s+(?:build|compose\b.*\bbuild)\b)/i
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

function buildObservation(options, artifactObservedValues = {}) {
  const targets = normalizeStringList(options.targets);
  const scenarios = normalizeStringList(options.scenarios);
  const cliValues = parseObservedPairs(options.observed);
  // artifact-derived values first so explicit CLI observations win on key conflicts
  return {
    targets,
    scenarios,
    values: { ...artifactObservedValues, ...cliValues }
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
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
