import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { similarity } from './spec-store.js';
import { WORKSPACE_DIR } from './workspace.js';

export const REPORT_SCHEMA_VERSION = '0.1.0';
export const REPORT_KINDS = new Set(['pr-body']);
const HISTORY_KEEP = 10;
const TP_SIMILARITY_THRESHOLD = 0.7;

export function getReportDir(repoRoot, storyId, kind) {
  if (!storyId) throw new Error('storyId is required');
  if (!REPORT_KINDS.has(kind)) throw new Error(`Unsupported report kind: ${kind}`);
  return path.join(path.resolve(repoRoot), WORKSPACE_DIR, 'report', storyId, kind);
}

export function getNarrativeFile(repoRoot, storyId, kind) {
  return path.join(getReportDir(repoRoot, storyId, kind), 'narrative.json');
}

export async function ensureReportDir(repoRoot, storyId, kind) {
  const dir = getReportDir(repoRoot, storyId, kind);
  await mkdir(path.join(dir, 'narrative.history'), { recursive: true });
  return dir;
}

export async function readNarrative(repoRoot, storyId, kind) {
  if (!storyId) return null;
  try {
    return JSON.parse(await readFile(getNarrativeFile(repoRoot, storyId, kind), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeNarrative(repoRoot, storyId, kind, narrative) {
  await ensureReportDir(repoRoot, storyId, kind);
  const target = getNarrativeFile(repoRoot, storyId, kind);
  await writeFile(target, `${JSON.stringify(narrative, null, 2)}\n`);

  const historyDir = path.join(getReportDir(repoRoot, storyId, kind), 'narrative.history');
  const stamp = (narrative.generated_at ?? new Date().toISOString()).replace(/[:.]/g, '-');
  const historyPath = path.join(historyDir, `narrative-${stamp}.json`);
  await writeFile(historyPath, `${JSON.stringify(narrative, null, 2)}\n`);
  await pruneHistory(historyDir);
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
    .filter((name) => name.startsWith('narrative-') && name.endsWith('.json'))
    .sort()
    .reverse();
  const stale = sorted.slice(HISTORY_KEEP);
  if (stale.length === 0) return;
  await Promise.all(stale.map((name) => rm(path.join(historyDir, name), { force: true })));
}

export function stabilizeTalkingPointIds(narrative, previous) {
  if (!narrative || !Array.isArray(narrative.narrative_slots)) {
    return { ...narrative, narrative_slots: [] };
  }
  if (!previous || !Array.isArray(previous.narrative_slots)) {
    return assignFreshTpIds(narrative);
  }

  const usedPrevious = new Set();
  const usedNew = new Set();
  const issuedAt = new Date().toISOString();

  const slots = narrative.narrative_slots.map((slot) => {
    let best = null;
    for (const prev of previous.narrative_slots) {
      if (usedPrevious.has(prev.id)) continue;
      if (prev.slot !== slot.slot) continue;
      const score = similarity(slot.text, prev.text);
      if (!best || score > best.score) best = { slot: prev, score };
    }
    if (best && best.score >= TP_SIMILARITY_THRESHOLD) {
      usedPrevious.add(best.slot.id);
      usedNew.add(best.slot.id);
      return {
        ...slot,
        id: best.slot.id,
        first_seen_at: best.slot.first_seen_at ?? issuedAt,
        last_revised_at: issuedAt
      };
    }
    return {
      ...slot,
      id: nextFreshTpId(usedNew, previous, issuedAt),
      first_seen_at: issuedAt,
      last_revised_at: issuedAt
    };
  });

  return { ...narrative, narrative_slots: slots };
}

function assignFreshTpIds(narrative) {
  const usedNew = new Set();
  const issuedAt = new Date().toISOString();
  const slots = narrative.narrative_slots.map((slot) => ({
    ...slot,
    id: nextFreshTpId(usedNew, null, issuedAt),
    first_seen_at: slot.first_seen_at ?? issuedAt,
    last_revised_at: issuedAt
  }));
  return { ...narrative, narrative_slots: slots };
}

function nextFreshTpId(usedNew, previous, issuedAt) {
  const reserved = new Set(usedNew);
  if (previous && Array.isArray(previous.narrative_slots)) {
    for (const slot of previous.narrative_slots) reserved.add(slot.id);
  }
  let n = 1;
  while (reserved.has(`TP-${pad3(n)}`)) n += 1;
  const id = `TP-${pad3(n)}`;
  usedNew.add(id);
  return id;
}

function pad3(n) {
  return String(n).padStart(3, '0');
}
