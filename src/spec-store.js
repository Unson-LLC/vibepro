import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { WORKSPACE_DIR } from './workspace.js';
import { assertArtifactWritePath, preflightArtifactWrites, resolveArtifactRoute, writeArtifactProjections } from './artifact-routing.js';

export const SPEC_SCHEMA_VERSION = '0.1.0';
const HISTORY_KEEP = 10;
const SIMILARITY_THRESHOLD = 0.7;

export function getSpecDir(repoRoot, storyId) {
  if (!storyId) throw new Error('storyId is required');
  return path.join(path.resolve(repoRoot), WORKSPACE_DIR, 'spec', storyId);
}

export function getSpecFile(repoRoot, storyId) {
  return path.join(getSpecDir(repoRoot, storyId), 'spec.json');
}

export async function resolveAcceptedSpecFile(repoRoot, storyId) {
  return (await resolveArtifactRoute(repoRoot, 'accepted_spec', { storyId })).canonical.absolute_path;
}

export function getSpecDraftFile(repoRoot, storyId) {
  return path.join(getSpecDir(repoRoot, storyId), 'draft.json');
}

export function getPreSpecReadinessFile(repoRoot, storyId) {
  return path.join(getSpecDir(repoRoot, storyId), 'pre-spec-readiness.json');
}

export function getDriftFile(repoRoot, storyId) {
  return path.join(getSpecDir(repoRoot, storyId), 'drift.json');
}

export function getDriftMarkdownFile(repoRoot, storyId) {
  return path.join(getSpecDir(repoRoot, storyId), 'drift.md');
}

export function getSuppressionsFile(repoRoot, storyId) {
  return path.join(getSpecDir(repoRoot, storyId), 'suppressions.json');
}

export async function ensureSpecDir(repoRoot, storyId) {
  const dir = getSpecDir(repoRoot, storyId);
  await mkdir(path.join(dir, 'spec.history'), { recursive: true });
  return dir;
}

export async function readInferredSpec(repoRoot, storyId) {
  if (!storyId) return null;
  try {
    return JSON.parse(await readFile(await resolveAcceptedSpecFile(repoRoot, storyId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readPreSpecReadiness(repoRoot, storyId) {
  if (!storyId) return null;
  try {
    return JSON.parse(await readFile(getPreSpecReadinessFile(repoRoot, storyId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readDrift(repoRoot, storyId) {
  if (!storyId) return null;
  try {
    return JSON.parse(await readFile(getDriftFile(repoRoot, storyId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readSuppressions(repoRoot, storyId) {
  try {
    return JSON.parse(await readFile(getSuppressionsFile(repoRoot, storyId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { schema_version: SPEC_SCHEMA_VERSION, items: [] };
    throw error;
  }
}

export async function writeInferredSpec(repoRoot, storyId, spec) {
  const route = await resolveArtifactRoute(repoRoot, 'accepted_spec', { storyId });
  await preflightArtifactWrites(repoRoot, route);
  await ensureSpecDir(repoRoot, storyId);
  const specPath = await assertArtifactWritePath(repoRoot, route.canonical.relative_path);
  await mkdir(path.dirname(specPath), { recursive: true });
  const content = `${JSON.stringify(spec, null, 2)}\n`;
  await writeFile(specPath, content);
  await writeArtifactProjections(repoRoot, route, content);

  const historyDir = path.join(getSpecDir(repoRoot, storyId), 'spec.history');
  const stamp = spec.generated_at?.replace(/[:.]/g, '-') ?? new Date().toISOString().replace(/[:.]/g, '-');
  const historyPath = path.join(historyDir, `spec-${stamp}.json`);
  await writeFile(historyPath, `${JSON.stringify(spec, null, 2)}\n`);
  await pruneHistory(historyDir);
  return specPath;
}

export async function writeDraftSpec(repoRoot, storyId, spec) {
  await ensureSpecDir(repoRoot, storyId);
  const specPath = getSpecDraftFile(repoRoot, storyId);
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  return specPath;
}

export async function writePreSpecReadiness(repoRoot, storyId, readiness) {
  await ensureSpecDir(repoRoot, storyId);
  const readinessPath = getPreSpecReadinessFile(repoRoot, storyId);
  await writeFile(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`);
  return readinessPath;
}

export async function writeDrift(repoRoot, storyId, drift) {
  await ensureSpecDir(repoRoot, storyId);
  const driftPath = getDriftFile(repoRoot, storyId);
  await writeFile(driftPath, `${JSON.stringify(drift, null, 2)}\n`);
  return driftPath;
}

export async function writeDriftMarkdown(repoRoot, storyId, markdown) {
  await ensureSpecDir(repoRoot, storyId);
  const driftPath = getDriftMarkdownFile(repoRoot, storyId);
  await writeFile(driftPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
  return driftPath;
}

export async function writeSuppressions(repoRoot, storyId, suppressions) {
  await ensureSpecDir(repoRoot, storyId);
  const target = getSuppressionsFile(repoRoot, storyId);
  await writeFile(target, `${JSON.stringify(suppressions, null, 2)}\n`);
  return target;
}

async function pruneHistory(historyDir) {
  let entries;
  try {
    entries = await readdir(historyDir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const sorted = entries
    .filter((name) => name.startsWith('spec-') && name.endsWith('.json'))
    .sort()
    .reverse();
  const stale = sorted.slice(HISTORY_KEEP);
  if (stale.length === 0) return;
  const { rm } = await import('node:fs/promises');
  await Promise.all(stale.map((name) => rm(path.join(historyDir, name), { force: true })));
}

export function stabilizeClauseIds(newSpec, previousSpec) {
  if (!previousSpec || !Array.isArray(previousSpec.clauses)) {
    return assignFreshIds(newSpec);
  }

  const usedPreviousIds = new Set();
  const usedNewIds = new Set();
  const issuedAt = new Date().toISOString();

  const claimMatch = (clause) => {
    let best = null;
    for (const prev of previousSpec.clauses) {
      if (usedPreviousIds.has(prev.id)) continue;
      if (prev.type !== clause.type) continue;
      const score = similarity(clause.statement, prev.statement);
      if (!best || score > best.score) best = { clause: prev, score };
    }
    if (best && best.score >= SIMILARITY_THRESHOLD) {
      usedPreviousIds.add(best.clause.id);
      return best.clause;
    }
    return null;
  };

  const clauses = newSpec.clauses.map((clause) => {
    const match = claimMatch(clause);
    if (match) {
      usedNewIds.add(match.id);
      return {
        ...clause,
        id: match.id,
        first_seen_at: match.first_seen_at ?? issuedAt,
        last_revised_at: issuedAt
      };
    }
    return {
      ...clause,
      id: nextFreshId(clause, usedNewIds, previousSpec, issuedAt),
      first_seen_at: issuedAt,
      last_revised_at: issuedAt
    };
  });

  return { ...newSpec, clauses };
}

function assignFreshIds(spec) {
  const usedIds = new Set();
  const issuedAt = new Date().toISOString();
  const clauses = (spec.clauses ?? []).map((clause) => ({
    ...clause,
    id: nextFreshId(clause, usedIds, null, issuedAt),
    first_seen_at: clause.first_seen_at ?? issuedAt,
    last_revised_at: issuedAt
  }));
  return { ...spec, clauses };
}

function nextFreshId(clause, usedIds, previousSpec, issuedAt) {
  const prefix = clausePrefix(clause.type);
  const reserved = new Set(usedIds);
  if (previousSpec && Array.isArray(previousSpec.clauses)) {
    for (const prev of previousSpec.clauses) reserved.add(prev.id);
  }
  let n = 1;
  while (reserved.has(`${prefix}-${pad3(n)}`)) n += 1;
  const id = `${prefix}-${pad3(n)}`;
  usedIds.add(id);
  return id;
}

function clausePrefix(type) {
  switch (type) {
    case 'invariant': return 'INV';
    case 'scenario': return 'S';
    case 'contract': return 'C';
    case 'sla': return 'SLA';
    default: return 'X';
  }
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

export function similarity(a, b) {
  const sa = normalizeStatement(a);
  const sb = normalizeStatement(b);
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  const tokenSim = jaccardTokens(sa, sb);
  const editSim = 1 - levenshteinNormalized(sa, sb);
  return tokenSim * 0.6 + editSim * 0.4;
}

function normalizeStatement(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function jaccardTokens(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(text) {
  return text
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function levenshteinNormalized(a, b) {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  return levenshtein(a, b) / max;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
