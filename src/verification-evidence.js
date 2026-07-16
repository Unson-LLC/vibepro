import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { assertManagedWorktreeCommandAllowed } from './managed-worktree-gate.js';
import { collectGitContext } from './git-fingerprint.js';
import { buildContentBinding } from './content-binding.js';
import { refreshActiveRunContextCapsule } from './run-context-capsule.js';

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
  const { check: artifactCheck, observedValues: artifactObservedValues } = await crossCheckArtifact(root, {
    artifact: options.artifact,
    status: options.status
  });
  const observation = buildObservation(options, artifactObservedValues);
  const observationCheck = buildObservationCheck({ status: options.status, observation });
  const prDir = path.join(getWorkspaceDir(root), 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  const evidencePath = path.join(prDir, 'verification-evidence.json');
  const gitContext = await collectGitContext(root);
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
      observation,
      observation_check: observationCheck,
      executed_at: options.executedAt ?? new Date().toISOString(),
      git_context: gitContext,
      content_binding: contentBinding,
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

export function renderVerificationEvidenceSummary(result) {
  const latest = result.evidence.commands[0];
  const warnings = latest.warnings?.length
    ? latest.warnings.map((warning) => `- ${warning.id}: ${warning.reason}`).join('\n')
    : '- none';
  return `# VibePro Verification Evidence

- story: ${result.evidence.story_id}
- kind: ${latest.kind}
- status: ${latest.status}
- command: ${latest.command ?? '-'}
- artifact: ${result.artifact}

## Warnings

${warnings}
`;
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
        reason: 'artifact is not a recognized machine-readable test output (vitest/jest, Playwright, or generic status JSON); recorded without cross-check'
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
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
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
