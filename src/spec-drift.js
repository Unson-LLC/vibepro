import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { buildSpecFingerprint } from './spec-fingerprint.js';
import { matchGlob } from './spec-validator.js';
import { readInferredSpec, readSuppressions, writeSuppressions } from './spec-store.js';

const execFileAsync = promisify(execFile);
const SUPPRESS_DEMOTE_THRESHOLD = 3;

export async function buildSpecDrift(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId ?? null;
  if (!storyId) {
    return emptyDrift({ status: 'inconclusive', reason: 'storyId required' });
  }

  const spec = options.spec ?? (await readInferredSpec(root, storyId));
  if (!spec) {
    return emptyDrift({ storyId, status: 'inconclusive', reason: 'no inferred spec found' });
  }

  const fingerprint = options.fingerprint ?? (await buildSpecFingerprint(root, { storyId }));
  const suppressions = await readSuppressions(root, storyId);

  const items = [];

  for (const clause of spec.clauses ?? []) {
    items.push(...(await detectSpecCodeDrift(root, clause)));
    items.push(...(await detectSpecTestDrift(root, clause)));
  }

  items.push(...detectCodeTestDrift(spec, fingerprint));

  if (options.againstRef) {
    items.push(...(await detectSpecPrDrift(root, spec, options.againstRef)));
  }

  const finalItems = applySuppressions(items, suppressions);
  await updateSuppressionLedger(root, storyId, finalItems, suppressions);

  const summary = summarizeAxes(finalItems);
  const status = finalItems.length > 0 ? 'drift_detected' : 'clean';

  return {
    schema_version: '0.1.0',
    story_id: storyId,
    spec_id: spec.previous_spec_id ?? null,
    evaluated_at: new Date().toISOString(),
    status,
    summary,
    items: finalItems
  };
}

export function renderDriftMarkdown(drift) {
  if (!drift) return '# Spec Drift\n\n- 未生成\n';
  const lines = ['# Spec Drift', ''];
  lines.push(`- Status: ${drift.status}`);
  lines.push(`- Story: ${drift.story_id}`);
  lines.push(`- Evaluated at: ${drift.evaluated_at}`);
  lines.push('');
  if (drift.summary) {
    lines.push('| Axis | Count |');
    lines.push('|------|-------|');
    for (const [axis, count] of Object.entries(drift.summary)) {
      lines.push(`| ${axis} | ${count} |`);
    }
    lines.push('');
  }
  if (!drift.items || drift.items.length === 0) {
    lines.push('## Items', '', '- なし');
    return `${lines.join('\n')}\n`;
  }
  lines.push('## Items');
  for (const item of drift.items) {
    lines.push('');
    lines.push(`### ${item.id} [${item.severity}] (${item.axis})`);
    lines.push(`- Clause: ${item.clause_id ?? '-'}`);
    lines.push(`- Title: ${item.title}`);
    if (item.detail) lines.push(`- Detail: ${item.detail}`);
    if (item.suggested_action) lines.push(`- Suggested action: ${item.suggested_action}`);
  }
  return `${lines.join('\n')}\n`;
}

async function detectSpecCodeDrift(repoRoot, clause) {
  const items = [];
  const patterns = clause?.verifiable_by?.code_pattern ?? [];
  for (let i = 0; i < patterns.length; i += 1) {
    items.push(...(await checkPattern(repoRoot, clause, patterns[i], 'spec_code', `code_pattern[${i}]`)));
  }
  for (const ref of clause?.origin?.code_refs ?? []) {
    if (!ref?.file) continue;
    const stats = await statFile(repoRoot, ref.file);
    if (!stats.exists) {
      items.push({
        id: `DRIFT-${randomDriftId()}`,
        axis: 'spec_code',
        clause_id: clause.id,
        severity: 'high',
        title: `${clause.id} の参照ファイルが存在しない`,
        detail: `${ref.file} が repository に無い (Code が削除/移動された可能性)`,
        suggested_action: `clause "${clause.id}" の origin.code_refs を更新するか、Spec を再生成する`
      });
      continue;
    }
    if (ref.anchor && !(await fileIncludes(repoRoot, ref.file, ref.anchor))) {
      items.push({
        id: `DRIFT-${randomDriftId()}`,
        axis: 'spec_code',
        clause_id: clause.id,
        severity: 'medium',
        title: `${clause.id} の anchor が ${ref.file} に見つからない`,
        detail: `anchor "${ref.anchor}" が ${ref.file} に存在しない (リネーム/削除の可能性)`,
        suggested_action: `clause "${clause.id}" の anchor を更新するか、Spec を再生成する`
      });
    }
  }
  return items;
}

async function detectSpecTestDrift(repoRoot, clause) {
  const items = [];
  const patterns = clause?.verifiable_by?.test_pattern ?? [];
  for (let i = 0; i < patterns.length; i += 1) {
    items.push(...(await checkPattern(repoRoot, clause, patterns[i], 'spec_test', `test_pattern[${i}]`)));
  }
  if (patterns.length === 0 && clause.type === 'invariant') {
    items.push({
      id: `DRIFT-${randomDriftId()}`,
      axis: 'spec_test',
      clause_id: clause.id,
      severity: 'low',
      title: `${clause.id} を機械検証する test_pattern が宣言されていない`,
      detail: '不変条件は test_pattern を持つことを推奨',
      suggested_action: `clause "${clause.id}" に verifiable_by.test_pattern を追加`
    });
  }
  return items;
}

async function checkPattern(repoRoot, clause, pattern, axis, locator) {
  const items = [];
  if (!pattern?.file_glob) return items;
  const matched = await matchGlob(repoRoot, pattern.file_glob);
  if (matched.length === 0) {
    items.push({
      id: `DRIFT-${randomDriftId()}`,
      axis,
      clause_id: clause.id,
      severity: 'medium',
      title: `${clause.id}.${locator} の file_glob にマッチするファイルが無い`,
      detail: `file_glob "${pattern.file_glob}" matched 0 files`,
      suggested_action: 'pattern.file_glob を更新するか、不要なら spec から削除する'
    });
    return items;
  }
  if (pattern.must_contain && !(await anyFileContains(repoRoot, matched, pattern.must_contain))) {
    items.push({
      id: `DRIFT-${randomDriftId()}`,
      axis,
      clause_id: clause.id,
      severity: 'high',
      title: `${clause.id}.${locator}.must_contain が満たされていない`,
      detail: `must_contain "${pattern.must_contain}" が ${pattern.file_glob} のいずれにも存在しない`,
      suggested_action: clause.type === 'invariant'
        ? '実装が不変条件を満たしていない可能性。Code を修正するか Spec を再評価する'
        : 'Spec と実装の整合性を確認する'
    });
  }
  if (pattern.must_not_contain) {
    const offender = await firstFileContaining(repoRoot, matched, pattern.must_not_contain);
    if (offender) {
      items.push({
        id: `DRIFT-${randomDriftId()}`,
        axis,
        clause_id: clause.id,
        severity: 'high',
        title: `${clause.id}.${locator}.must_not_contain 違反`,
        detail: `must_not_contain "${pattern.must_not_contain}" が ${offender} に存在する`,
        suggested_action: '不変条件と矛盾する実装。Code を修正するか Spec を再評価する'
      });
    }
  }
  if (pattern.must_cover && !(await anyFileContains(repoRoot, matched, pattern.must_cover))) {
    items.push({
      id: `DRIFT-${randomDriftId()}`,
      axis,
      clause_id: clause.id,
      severity: axis === 'spec_test' ? 'high' : 'medium',
      title: `${clause.id}.${locator}.must_cover が満たされていない`,
      detail: `must_cover "${pattern.must_cover}" が ${pattern.file_glob} のテストで参照されていない`,
      suggested_action: 'テストを追加するか、clause の verifiable_by.test_pattern を見直す'
    });
  }
  return items;
}

function detectCodeTestDrift(spec, fingerprint) {
  const items = [];
  if (!fingerprint?.test_fingerprint?.files) return items;
  const allExpects = fingerprint.test_fingerprint.files
    .flatMap((file) => file.cases.flatMap((entry) => entry.expects))
    .map((entry) => entry.toLowerCase());
  for (const branch of fingerprint.code_fingerprint?.branches ?? []) {
    if (!branch.domain_keywords || branch.domain_keywords.length === 0) continue;
    const condition = (branch.condition ?? '').toLowerCase();
    if (!condition) continue;
    const fragment = condition.split(/\s+/).find((token) => token.length >= 4) ?? condition.slice(0, 12);
    if (!fragment) continue;
    const covered = allExpects.some((expect) => expect.includes(fragment));
    if (!covered) {
      items.push({
        id: `DRIFT-${randomDriftId()}`,
        axis: 'code_test',
        clause_id: null,
        severity: 'low',
        title: `${branch.file} の domain 分岐がテスト で参照されていない`,
        detail: `condition "${branch.condition}" を検証している assertion / case が見当たらない`,
        suggested_action: 'domain 分岐に対する test を追加するか、Spec を更新して分岐の意図を明示する'
      });
      if (items.length >= 8) return items;
    }
  }
  return items;
}

async function detectSpecPrDrift(repoRoot, spec, againstRef) {
  const items = [];
  let stdout;
  try {
    const result = await execFileAsync('git', ['diff', '--name-only', againstRef, '--', '.'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    stdout = result.stdout;
  } catch {
    return items;
  }
  const changedFiles = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const clause of spec.clauses ?? []) {
    const referencedFiles = (clause?.origin?.code_refs ?? []).map((ref) => ref.file).filter(Boolean);
    const touched = referencedFiles.filter((file) => changedFiles.includes(file));
    if (touched.length === 0) continue;
    items.push({
      id: `DRIFT-${randomDriftId()}`,
      axis: 'spec_pr',
      clause_id: clause.id,
      severity: 'medium',
      title: `${clause.id} が参照するコードが PR で変更されている`,
      detail: `${touched.join(', ')} が ${againstRef} と比べて変更されている。Spec の見直しが必要かもしれない`,
      suggested_action: 'Spec を再生成 (vibepro spec fingerprint → write) し、clause の有効性を確認する'
    });
  }
  return items;
}

function summarizeAxes(items) {
  const summary = { spec_code_drift: 0, spec_test_drift: 0, code_test_drift: 0, spec_pr_drift: 0 };
  for (const item of items) {
    if (item.axis === 'spec_code') summary.spec_code_drift += 1;
    else if (item.axis === 'spec_test') summary.spec_test_drift += 1;
    else if (item.axis === 'code_test') summary.code_test_drift += 1;
    else if (item.axis === 'spec_pr') summary.spec_pr_drift += 1;
  }
  return summary;
}

function applySuppressions(items, suppressions) {
  const suppressedKeys = new Map();
  for (const entry of suppressions.items ?? []) {
    if (entry.expires_at && new Date(entry.expires_at) < new Date()) continue;
    suppressedKeys.set(entry.key, entry);
  }
  return items.map((item) => {
    const key = driftKey(item);
    if (suppressedKeys.has(key)) {
      return { ...item, severity: demoteSeverity(item.severity), suppression_applied: true };
    }
    return item;
  });
}

async function updateSuppressionLedger(repoRoot, storyId, items, suppressions) {
  const ledger = { schema_version: suppressions.schema_version ?? '0.1.0', items: [...(suppressions.items ?? [])] };
  const now = new Date().toISOString();
  for (const item of items) {
    if (item.severity !== 'high') continue;
    const key = driftKey(item);
    const existing = ledger.items.find((entry) => entry.key === key);
    if (!existing) {
      ledger.items.push({ key, first_seen_at: now, ack_count: 0, expires_at: null });
      continue;
    }
    existing.ack_count = (existing.ack_count ?? 0) + 1;
    existing.last_seen_at = now;
    if (existing.ack_count >= SUPPRESS_DEMOTE_THRESHOLD && !existing.expires_at) {
      existing.expires_at = futureIso(30);
      existing.demoted_at = now;
    }
  }
  await writeSuppressions(repoRoot, storyId, ledger);
}

function driftKey(item) {
  return `${item.axis}|${item.clause_id ?? ''}|${item.title}`;
}

function demoteSeverity(severity) {
  if (severity === 'high') return 'medium';
  if (severity === 'medium') return 'low';
  return 'low';
}

function futureIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function emptyDrift({ storyId = null, status, reason }) {
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    spec_id: null,
    evaluated_at: new Date().toISOString(),
    status,
    reason,
    summary: { spec_code_drift: 0, spec_test_drift: 0, code_test_drift: 0, spec_pr_drift: 0 },
    items: []
  };
}

async function fileIncludes(repoRoot, relativeFile, anchor) {
  try {
    const content = await readFile(path.join(repoRoot, relativeFile), 'utf8');
    return content.includes(anchor);
  } catch {
    return false;
  }
}

async function anyFileContains(repoRoot, files, needle) {
  for (const file of files) {
    if (await fileIncludes(repoRoot, file, needle)) return true;
  }
  return false;
}

async function firstFileContaining(repoRoot, files, needle) {
  for (const file of files) {
    if (await fileIncludes(repoRoot, file, needle)) return file;
  }
  return null;
}

async function statFile(repoRoot, relativeFile) {
  try {
    const { stat } = await import('node:fs/promises');
    const stats = await stat(path.join(repoRoot, relativeFile));
    return { exists: stats.isFile() };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false };
    throw error;
  }
}

function randomDriftId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
