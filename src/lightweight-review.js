import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDir } from './workspace.js';
import { assertSafeStoryPathSegment } from './story-id.js';
import { buildContentBinding, evaluateContentBinding } from './content-binding.js';

const STATUSES = new Set(['pass', 'needs_changes', 'block', 'runtime_failed']);

function segment(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
  assertSafeStoryPathSegment(value, label);
  return value;
}

async function reviewDirectory(root, storyId) {
  segment(storyId, 'story id');
  await readFile(path.join(getWorkspaceDir(root), 'config.json'), 'utf8');
  return path.join(getWorkspaceDir(root), 'reviews', storyId, 'lightweight');
}

export async function prepareReview(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const directory = await reviewDirectory(root, options.storyId);
  const roles = [...new Set(options.roles?.length ? options.roles : ['reviewer'])].map(role => segment(role, 'role'));
  const plan = {
    story_id: options.storyId,
    roles,
    instructions: '変更箇所と受入条件を一度確認し、具体的な未解決事項と検証結果を記録してください。追加のレビュー段階は要求しません。'
  };
  await mkdir(directory, { recursive: true });
  const planPath = path.join(directory, 'plan.json');
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return { plan, artifacts: { plan: planPath } };
}

export async function recordReview(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const directory = await reviewDirectory(root, options.storyId);
  const role = segment(options.role ?? 'reviewer', 'role');
  if (!STATUSES.has(options.status)) throw new Error('review status must be pass, needs_changes, block, or runtime_failed');
  const summary = String(options.summary ?? options.stdinText ?? '').trim();
  if (!summary) throw new Error('review record requires --summary or --from-stdin');
  const contentBinding = await buildContentBinding(root, {
    inspectionInputs: options.inspectionInputs ?? [],
    artifacts: options.artifacts ?? [],
    excludeSurfacePaths: ['.vibepro/config.json']
  });
  if (options.status === 'pass' && (contentBinding.status !== 'recorded' || contentBinding.missing_files.length)) {
    throw new Error('A passing review requires existing inspection inputs outside .vibepro');
  }
  const record = {
    schema_version: '1.0.0', story_id: options.storyId, role, status: options.status,
    summary, recorded_at: new Date().toISOString(),
    findings: options.findings ?? [],
    content_binding: contentBinding,
    reviewer: { system: options.agentSystem ?? null, id: options.agentId ?? null }
  };
  await mkdir(directory, { recursive: true });
  const artifact = path.join(directory, `review-${role}.json`);
  await writeFile(artifact, `${JSON.stringify(record, null, 2)}\n`);
  return { record, artifact };
}

export async function getReviewStatus(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const directory = await reviewDirectory(root, options.storyId);
  let entries;
  try { entries = await readdir(directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  const records = [];
  for (const entry of entries.sort()) {
    if (!/^review-.*\.json$/.test(entry)) continue;
    const artifact = path.join(directory, entry);
    const record = JSON.parse(await readFile(artifact, 'utf8'));
    if (record.story_id !== options.storyId || !STATUSES.has(record.status)
      || typeof record.summary !== 'string' || !record.summary.trim()
      || `review-${segment(record.role, 'role')}.json` !== entry) {
      throw new Error(`Invalid lightweight review: ${artifact}`);
    }
    const binding = await evaluateContentBinding(root, record.content_binding);
    // Only content-scoped evidence can attest to a current review.
    const bindingStatus = binding?.status ?? 'unbound';
    records.push({ ...record, artifact, binding_status: bindingStatus });
  }
  const blockingFindings = records.filter(record => ['needs_changes', 'block'].includes(record.status))
    .map(record => ({ role: record.role, status: record.status, summary: record.summary, findings: record.findings }));
  const complete = records.length > 0 && records.every(record => record.status === 'pass' && record.binding_status === 'current');
  const status = blockingFindings.length ? 'blocked' : complete ? 'pass'
    : records.length === 0 ? 'not_recorded'
    : records.some(record => record.status === 'runtime_failed') ? 'runtime_failed' : 'stale';
  return { recorded: records.length > 0, complete, status, records, blocking_findings: blockingFindings };
}

export function renderReviewPrepareSummary(result) {
  return `# レビュー準備\n\n- 対象: ${result.plan.story_id}\n- 担当: ${result.plan.roles.join(', ')}\n\n${result.plan.instructions}\n`;
}
export function renderReviewRecordSummary(result) {
  return `# レビュー記録\n\n- ${result.record.role}: ${result.record.status}\n- ${result.record.summary}\n- 保存先: ${result.artifact}\n`;
}
export function renderReviewStatusSummary(result) {
  return `# レビュー状況\n\n- 状態: ${result.status}\n${result.records.map(record => `- ${record.role}: ${record.status} (${record.binding_status}) — ${record.summary}\n`).join('')}`;
}
