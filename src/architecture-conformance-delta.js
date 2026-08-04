import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { DEFAULT_TARGET_MODEL_PATH, runArchitectureConformance } from './architecture-conformance.js';
import { WORKSPACE_DIR } from './workspace.js';

const execFileAsync = promisify(execFile);

export const CONFORMANCE_DELTA_SCHEMA_VERSION = '0.1.0';

const DELTA_VIOLATION_KINDS = [
  'undeclared_dependency',
  'budget_violation',
  'orphan_file',
  'stale_pattern',
  'dependency_cycle'
];

// Computes a base/head architecture conformance delta (CDL-S-3/S-4) and persists it alongside a
// head snapshot at .vibepro/architecture/conformance/{conformance.json,delta.json} (CDL-S-7). This
// module lives in the `architecture` boundary (docs/architecture/target-model.json); gate-pr
// (src/pr-manager.js) must not import it directly -- see the dependency-injection note in
// src/pr-manager.js's architecture-conformance-delta stage. Only cli.js (allowed_dependencies: "*")
// imports this module and injects the exported function as a runner.
//
// The head side is always scanned from the live repoRoot (not a checked-out headRef) so it reflects
// exactly what pr prepare is evaluating right now, including any uncommitted state already staged
// for review -- consistent with how the rest of pr prepare treats the working tree as the review
// surface. The base side is scanned from a detached `git worktree` checkout of baseRef so history
// does not have to be reconstructed by hand; the worktree is always removed afterward, whether the
// scan succeeds or fails (see docs/architecture/vibepro-conformance-delta-ledger.md).
export async function runArchitectureConformanceDelta(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const modelPath = path.resolve(root, options.modelPath ?? DEFAULT_TARGET_MODEL_PATH);
  const graphPath = options.graphPath ? path.resolve(root, options.graphPath) : undefined;
  const baseRef = options.baseRef ?? null;
  const headRef = options.headRef ?? 'HEAD';

  const headSnapshot = await scanSafely(root, { modelPath, graphPath });
  const baseSnapshot = baseRef
    ? await scanRefSafely(root, baseRef, { modelPath, graphPath })
    : { status: 'inconclusive', reason: 'base_ref was not provided; cannot compute a base/head delta' };

  const delta = computeConformanceDelta({ base: baseSnapshot, head: headSnapshot });

  const base = summarizeSnapshot(baseSnapshot);
  const head = summarizeSnapshot(headSnapshot);
  const previousModelVersion = await readPreviousModelVersion(root);
  const output = {
    schema_version: CONFORMANCE_DELTA_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    base_ref: baseRef,
    head_ref: headRef,
    base,
    head,
    // TMG-S-3. Both sides are measured against the *current* target model (modelPath is resolved
    // against the live repoRoot before the base worktree is created), which is deliberate: a fixed
    // yardstick is what isolates "the code changed" from "the model changed". base.model_version
    // and head.model_version are therefore expected to agree, and are reported so a reader can
    // confirm the yardstick rather than assume it.
    //
    // The move that does need flagging is between *recorded measurements*: assigning orphan files
    // to modules surfaces imports that were previously invisible, so a model revision makes the
    // next delta show new violations without any code getting worse. Comparing the head model
    // version against the previously persisted delta artifact is what detects that.
    previous_model_version: previousModelVersion,
    model_version_changed: previousModelVersion != null && previousModelVersion !== head.model_version,
    delta
  };

  if (options.write !== false) {
    const outDir = path.join(root, WORKSPACE_DIR, 'architecture', 'conformance');
    await mkdir(outDir, { recursive: true });
    // Persist the head snapshot as the canonical conformance.json (this is the file
    // src/pr-manager.js's loadTargetArchitectureContext reads into senior-gap judgment's
    // ideal_state as conformance_summary). When the head scan itself is inconclusive, persist an
    // envelope without a `summary` key so `conformance?.summary ?? null` degrades exactly like the
    // pre-existing "conformance.json absent" case.
    const conformancePath = path.join(outDir, 'conformance.json');
    const headPersisted = headSnapshot.status === 'ok'
      ? headSnapshot.result
      : {
        schema_version: CONFORMANCE_DELTA_SCHEMA_VERSION,
        mode: 'dry_run',
        status: 'inconclusive',
        reason: headSnapshot.reason
      };
    await writeFile(conformancePath, `${JSON.stringify(headPersisted, null, 2)}\n`);
    const deltaPath = path.join(outDir, 'delta.json');
    await writeFile(deltaPath, `${JSON.stringify(output, null, 2)}\n`);
    output.artifacts = {
      conformance: toRepoRelative(root, conformancePath),
      delta: toRepoRelative(root, deltaPath)
    };
  }

  return output;
}

// Reads the head model version recorded by the previous delta run, if any. A missing, unreadable,
// or malformed artifact means "no prior measurement to compare against" -- never an error, since the
// first run of the ledger legitimately has no predecessor.
async function readPreviousModelVersion(root) {
  const deltaPath = path.join(root, WORKSPACE_DIR, 'architecture', 'conformance', 'delta.json');
  try {
    const previous = JSON.parse(await readFile(deltaPath, 'utf8'));
    const version = previous?.head?.model_version;
    return typeof version === 'number' ? version : null;
  } catch {
    return null;
  }
}

async function scanSafely(root, { modelPath, graphPath }) {
  try {
    const result = await runArchitectureConformance(root, { modelPath, graphPath, write: false });
    return { status: 'ok', result };
  } catch (error) {
    // CDL-S-5: a scanner exception (missing/invalid model, zero scannable files, ...) must not be
    // reported as violation_count=0 -- it degrades to inconclusive with the original reason.
    return { status: 'inconclusive', reason: error instanceof Error ? error.message : String(error) };
  }
}

async function scanRefSafely(repoRoot, ref, { modelPath, graphPath }) {
  const worktreeDir = path.join(os.tmpdir(), `vibepro-conformance-${randomUUID()}`);
  try {
    await execFileAsync('git', ['-C', repoRoot, 'worktree', 'add', '--detach', worktreeDir, ref]);
  } catch (error) {
    return {
      status: 'inconclusive',
      reason: `failed to check out base ref '${ref}' into a detached worktree: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  try {
    return await scanSafely(worktreeDir, { modelPath, graphPath });
  } finally {
    await execFileAsync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', worktreeDir]).catch(() => {});
    await rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
  }
}

function summarizeSnapshot(snapshot) {
  if (snapshot.status === 'ok') {
    return {
      status: 'ok',
      model_version: snapshot.result.model.version ?? null,
      violation_count: snapshot.result.violations.length,
      summary: snapshot.result.summary
    };
  }
  return { status: 'inconclusive', model_version: null, reason: snapshot.reason };
}

// CDL-S-3/S-4: matches base and head violations by stable violation id (architecture-conformance.js
// attaches `id` to every violation from the element's own semantic value -- never array index or
// group ordinal) and classifies them into new / resolved / unchanged, then a multi-dimensional
// summary (severity-split new, resolved, unchanged, per-kind breakdown) so no caller is tempted to
// collapse the delta back down to a single violation_count distance metric.
export function computeConformanceDelta({ base, head }) {
  if (base.status !== 'ok' || head.status !== 'ok') {
    return {
      status: 'inconclusive',
      base_status: base.status,
      head_status: head.status,
      base_reason: base.status === 'inconclusive' ? base.reason : null,
      head_reason: head.status === 'inconclusive' ? head.reason : null,
      new: null,
      resolved: null,
      unchanged: null,
      summary: null
    };
  }
  const baseById = new Map(base.result.violations.map((violation) => [violation.id, violation]));
  const headById = new Map(head.result.violations.map((violation) => [violation.id, violation]));
  const newList = [...headById.entries()]
    .filter(([id]) => !baseById.has(id))
    .map(([, violation]) => violation);
  const resolvedList = [...baseById.entries()]
    .filter(([id]) => !headById.has(id))
    .map(([, violation]) => violation);
  const unchangedList = [...headById.entries()]
    .filter(([id]) => baseById.has(id))
    .map(([, violation]) => violation);

  return {
    status: 'ok',
    new: newList,
    resolved: resolvedList,
    unchanged: unchangedList,
    summary: buildDeltaSummary({ newList, resolvedList, unchangedList })
  };
}

function buildDeltaSummary({ newList, resolvedList, unchangedList }) {
  const newBySeverity = {};
  for (const violation of newList) {
    newBySeverity[violation.severity] = (newBySeverity[violation.severity] ?? 0) + 1;
  }
  const byKind = {};
  for (const kind of DELTA_VIOLATION_KINDS) {
    byKind[kind] = {
      new: newList.filter((violation) => violation.kind === kind).length,
      resolved: resolvedList.filter((violation) => violation.kind === kind).length,
      unchanged: unchangedList.filter((violation) => violation.kind === kind).length
    };
  }
  return {
    new_count: newList.length,
    new_by_severity: newBySeverity,
    resolved_count: resolvedList.length,
    unchanged_count: unchangedList.length,
    by_kind: byKind
  };
}

export function renderConformanceDeltaMarkdown(output) {
  const lines = [
    '# Architecture Conformance Delta',
    '',
    `- base_ref: ${output.base_ref ?? '(none)'}`,
    `- head_ref: ${output.head_ref}`,
    `- base: ${renderSnapshotLine(output.base)}`,
    `- head: ${renderSnapshotLine(output.head)}`,
    `- model_version: ${output.head.model_version ?? 'unversioned'} (前回計測時: ${output.previous_model_version ?? 'なし'})${output.model_version_changed ? ' — モデル改訂を跨いだ計測。前回との件数比較は同一の物差しではない' : ''}`
  ];
  if (output.delta.status === 'ok') {
    const summary = output.delta.summary;
    lines.push(
      '',
      `- new: ${summary.new_count} (${Object.entries(summary.new_by_severity).map(([severity, count]) => `${severity}=${count}`).join(', ') || 'none'})`,
      `- resolved: ${summary.resolved_count}`,
      `- unchanged: ${summary.unchanged_count}`,
      '',
      '## 次元別内訳 (new / resolved / unchanged)',
      ''
    );
    for (const kind of DELTA_VIOLATION_KINDS) {
      const entry = summary.by_kind[kind];
      lines.push(`- ${kind}: new=${entry.new}, resolved=${entry.resolved}, unchanged=${entry.unchanged}`);
    }
  } else {
    lines.push('', `- delta: inconclusive (base=${output.delta.base_status}, head=${output.delta.head_status})`);
  }
  return `${lines.join('\n')}\n`;
}

function renderSnapshotLine(snapshot) {
  if (snapshot.status === 'ok') return `ok (violations=${snapshot.violation_count})`;
  return `inconclusive (${snapshot.reason})`;
}

function toRepoRelative(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}
