import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

export const TRACEABILITY_SCHEMA_VERSION = '0.1.0';
export const TRACEABILITY_LIFECYCLES = [
  'declared_not_started',
  'in_progress',
  'evidence_in_other_worktree',
  'merged_without_vibepro_evidence',
  'unknown'
];
// Manual declarations may only state judgment calls; evidence-backed lifecycles must come from observation
export const DECLARABLE_LIFECYCLES = ['declared_not_started', 'unknown'];

const REAL_PR_ARTIFACT_FILES = ['pr-prepare.json', 'pr-create.json', 'gate-dag.json', 'pr-merge.json'];
const EXPLICIT_NOT_STARTED_DOC_STATUSES = ['backlog', 'draft', 'planned', 'idea', 'proposed'];
const MAX_GIT_EVIDENCE_COMMITS = 5;

export function buildTraceability(existing, { storyId, storyDocPath = null, source, lifecycle, evidence = [], now = null }) {
  const timestamp = now ?? new Date().toISOString();
  const baseEvidence = Array.isArray(existing?.evidence) ? existing.evidence : [];
  const mergedEvidence = [...baseEvidence];
  for (const item of evidence) {
    if (mergedEvidence.some((entry) => entry.type === item.type && entry.ref === item.ref)) continue;
    mergedEvidence.push(item);
  }
  return {
    schema_version: TRACEABILITY_SCHEMA_VERSION,
    story_id: storyId,
    story_doc_path: storyDocPath ?? existing?.story_doc_path ?? null,
    source,
    lifecycle,
    evidence: mergedEvidence,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };
}

export function traceabilityArtifactPath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(path.resolve(repoRoot)), 'pr', storyId, 'traceability.json');
}

export async function readTraceability(repoRoot, storyId) {
  return readJsonIfExists(traceabilityArtifactPath(repoRoot, storyId));
}

export async function bindStoryTraceability(repoRoot, { storyId, storyDocPath = null, source, lifecycle, evidence = [] }) {
  const artifactPath = traceabilityArtifactPath(repoRoot, storyId);
  const existing = await readJsonIfExists(artifactPath);
  const traceability = buildTraceability(existing, { storyId, storyDocPath, source, lifecycle, evidence });
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(traceability, null, 2)}\n`);
  return traceability;
}

export async function declareTraceability(repoRoot, { storyId, lifecycle, reason = null }) {
  if (!storyId) throw new Error('--story-id is required for trace declare');
  if (!DECLARABLE_LIFECYCLES.includes(lifecycle)) {
    throw new Error(`lifecycle must be one of ${DECLARABLE_LIFECYCLES.join(', ')}; evidence-backed lifecycles cannot be manually declared`);
  }
  return bindStoryTraceability(repoRoot, {
    storyId,
    source: 'manual_declaration',
    lifecycle,
    evidence: [{
      type: 'manual_declaration',
      ref: new Date().toISOString(),
      summary: reason ?? 'declared by operator without stated reason'
    }]
  });
}

export async function backfillTraceability(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const dryRun = options.dryRun === true;
  const storyDocs = await collectBackfillStoryDocs(root);
  const otherWorktrees = await listOtherWorktrees(root);
  const candidates = [];
  for (const doc of storyDocs) {
    if (options.storyId && doc.story_id !== options.storyId) continue;
    if (await hasRealPrArtifact(root, doc.story_id)) continue;
    const worktreeEvidence = await collectWorktreeEvidence(otherWorktrees, doc.story_id);
    const evidence = worktreeEvidence.length > 0
      ? worktreeEvidence
      : await collectGitLogEvidence(root, doc.story_id);
    const lifecycle = classifyLifecycle(doc, evidence);
    const candidate = {
      story_id: doc.story_id,
      story_doc_path: doc.path,
      story_status: doc.status,
      lifecycle,
      evidence,
      written: false
    };
    if (!dryRun) {
      await bindStoryTraceability(root, {
        storyId: doc.story_id,
        storyDocPath: doc.path,
        source: 'trace_backfill',
        lifecycle,
        evidence
      });
      candidate.written = true;
    }
    candidates.push(candidate);
  }
  return {
    schema_version: TRACEABILITY_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    candidates
  };
}

export function renderTraceabilityBackfill(result) {
  const header = result.dry_run
    ? '# Traceability Backfill (dry-run)'
    : '# Traceability Backfill';
  const rows = result.candidates.length
    ? result.candidates.map((candidate) => {
        const evidence = candidate.evidence.length
          ? ` evidence=${candidate.evidence.map((item) => item.ref?.slice(0, 12)).join(',')}`
          : '';
        return `- ${candidate.story_id}: lifecycle=${candidate.lifecycle} written=${candidate.written}${evidence}`;
      }).join('\n')
    : '- no backfill candidates';
  return `${header}\n\n${rows}\n`;
}

function classifyLifecycle(doc, evidence) {
  if (evidence.some((item) => item.type === 'worktree_artifact')) return 'evidence_in_other_worktree';
  if (evidence.some((item) => item.type === 'git_log')) return 'merged_without_vibepro_evidence';
  const status = String(doc.status ?? '').toLowerCase();
  // only explicit unstarted declarations qualify; active/null must not be guessed as "not started"
  if (EXPLICIT_NOT_STARTED_DOC_STATUSES.includes(status)) return 'declared_not_started';
  return 'unknown';
}

async function listOtherWorktrees(root) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }));
  } catch {
    return [];
  }
  const currentReal = await realpathIfExists(root);
  const worktrees = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const worktreePath = line.slice('worktree '.length).trim();
    if (!worktreePath) continue;
    const real = await realpathIfExists(worktreePath);
    if (real && currentReal && real === currentReal) continue;
    worktrees.push(worktreePath);
  }
  return worktrees;
}

async function collectWorktreeEvidence(worktrees, storyId) {
  const evidence = [];
  for (const worktree of worktrees) {
    const prDir = path.join(getWorkspaceDir(worktree), 'pr', storyId);
    for (const file of REAL_PR_ARTIFACT_FILES) {
      const artifactPath = path.join(prDir, file);
      if (await readJsonIfExists(artifactPath) === null) continue;
      evidence.push({
        type: 'worktree_artifact',
        ref: artifactPath,
        summary: `real PR artifact found in linked worktree ${worktree}`
      });
    }
    if (evidence.length > 0) break;
  }
  return evidence;
}

async function realpathIfExists(filePath) {
  try {
    return path.resolve(await realpath(filePath));
  } catch {
    return null;
  }
}

async function hasRealPrArtifact(root, storyId) {
  const prDir = path.join(getWorkspaceDir(root), 'pr', storyId);
  for (const file of REAL_PR_ARTIFACT_FILES) {
    if (await readJsonIfExists(path.join(prDir, file))) return true;
  }
  return false;
}

async function collectGitLogEvidence(root, storyId) {
  try {
    const { stdout } = await execFileAsync('git', [
      'log',
      `--grep=${storyId}`,
      '--fixed-strings',
      `--max-count=${MAX_GIT_EVIDENCE_COMMITS}`,
      '--format=%H%x09%s'
    ], { cwd: root, encoding: 'utf8' });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ref, ...subject] = line.split('\t');
        return { type: 'git_log', ref, summary: subject.join('\t') };
      });
  } catch {
    return [];
  }
}

async function collectBackfillStoryDocs(root) {
  const storyRoot = path.join(root, 'docs', 'management', 'stories');
  const files = await listMarkdownFiles(storyRoot);
  const docs = [];
  for (const filePath of files) {
    const text = await readTextIfExists(filePath);
    if (text === null) continue;
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    const source = frontmatter?.[1] ?? text.slice(0, 2000);
    const storyId = matchYamlString(source, 'story_id') ?? inferStoryId(path.basename(filePath));
    if (!storyId) continue;
    docs.push({
      story_id: storyId,
      status: matchYamlString(source, 'status'),
      path: toWorkspaceRelative(root, filePath)
    });
  }
  return docs;
}

async function listMarkdownFiles(dir) {
  const files = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(full);
      }
    }
  }
  await visit(dir);
  return files.sort();
}

function inferStoryId(text) {
  const match = String(text ?? '').match(/story-[a-z0-9][a-z0-9-]+/i);
  return match ? match[0] : null;
}

function matchYamlString(text, key) {
  const match = String(text ?? '').match(new RegExp(`^${key}:\\s*['"]?([^'"\\n#]+)['"]?\\s*$`, 'm'));
  return match ? match[1].trim() : null;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function readJsonIfExists(filePath) {
  const text = await readTextIfExists(filePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
