import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace, toWorkspaceRelative } from './workspace.js';

const LEARNING_STATUSES = new Set(['candidate', 'reviewed', 'accepted', 'rejected']);

export async function recordSessionLearning(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  const store = await readLearningStore(root);
  const learning = {
    id: options.id ?? buildLearningId(store.learnings.length + 1),
    kind: options.kind ?? 'repeated_mistake',
    summary: requireText(options.summary, 'harness learn requires --summary <text>'),
    source: options.source ?? 'manual',
    evidence: options.evidence ?? null,
    pattern: options.pattern ?? null,
    status: normalizeLearningStatus(options.status ?? 'candidate'),
    skill_candidate: options.skillCandidate ?? null,
    target_surfaces: parseList(options.targets ?? []),
    created_at: new Date().toISOString()
  };
  const next = {
    ...store,
    updated_at: learning.created_at,
    learnings: [
      learning,
      ...store.learnings.filter((item) => item.id !== learning.id)
    ]
  };
  await writeLearningStore(root, next);
  return {
    learning,
    store: summarizeLearningStore(next),
    artifacts: {
      json: toWorkspaceRelative(root, getLearningStorePath(root))
    }
  };
}

export async function reviewSessionLearnings(repoRoot) {
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  const store = await readLearningStore(root);
  const markdown = renderSessionLearningsReview(store);
  const reviewPath = path.join(getHarnessDir(root), 'session-learnings-review.md');
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await writeFile(reviewPath, markdown);
  return {
    store: summarizeLearningStore(store),
    learnings: store.learnings,
    artifacts: {
      json: toWorkspaceRelative(root, getLearningStorePath(root)),
      review_markdown: toWorkspaceRelative(root, reviewPath)
    },
    markdown
  };
}

export function renderSessionLearningRecordSummary(result) {
  return `# Session Learning Recorded

- id: ${result.learning.id}
- kind: ${result.learning.kind}
- status: ${result.learning.status}
- store: ${result.artifacts.json}
`;
}

export function renderSessionLearningsReviewSummary(result) {
  return result.markdown;
}

function renderSessionLearningsReview(store) {
  const candidates = store.learnings.filter((item) => item.status === 'candidate');
  const lines = [
    '# Session Learnings Review',
    '',
    `Total: ${store.learnings.length}`,
    `Candidates: ${candidates.length}`,
    '',
    'This report proposes updates for Skills / AGENTS.md / CLAUDE.md. It does not modify those files automatically.',
    '',
    '## Candidates',
    ''
  ];
  if (candidates.length === 0) {
    lines.push('- none');
  } else {
    for (const item of candidates) {
      lines.push(`### ${item.id}: ${item.summary}`);
      lines.push('');
      lines.push(`- kind: ${item.kind}`);
      lines.push(`- source: ${item.source}`);
      if (item.evidence) lines.push(`- evidence: ${item.evidence}`);
      if (item.pattern) lines.push(`- pattern: ${item.pattern}`);
      lines.push(`- target surfaces: ${item.target_surfaces.join(', ') || '-'}`);
      lines.push(`- skill candidate: ${item.skill_candidate ?? '-'}`);
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

async function readLearningStore(root) {
  try {
    return JSON.parse(await readFile(getLearningStorePath(root), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      schema_version: '0.1.0',
      updated_at: null,
      learnings: []
    };
  }
}

async function writeLearningStore(root, store) {
  const storePath = getLearningStorePath(root);
  await mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`);
  await rename(tempPath, storePath);
}

function summarizeLearningStore(store) {
  return {
    schema_version: store.schema_version,
    updated_at: store.updated_at,
    total: store.learnings.length,
    candidate: store.learnings.filter((item) => item.status === 'candidate').length,
    accepted: store.learnings.filter((item) => item.status === 'accepted').length,
    rejected: store.learnings.filter((item) => item.status === 'rejected').length
  };
}

function getHarnessDir(root) {
  return path.join(getWorkspaceDir(root), 'harness');
}

function getLearningStorePath(root) {
  return path.join(getHarnessDir(root), 'session-learnings.json');
}

function buildLearningId(index) {
  return `learning-${String(index).padStart(3, '0')}`;
}

function normalizeLearningStatus(status) {
  if (!LEARNING_STATUSES.has(status)) {
    throw new Error(`learning status must be one of: ${[...LEARNING_STATUSES].join(', ')}`);
  }
  return status;
}

function requireText(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function parseList(values) {
  return values.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean);
}
