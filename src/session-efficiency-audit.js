import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  parseNumstat,
  summarizeDiffLineStats
} from './evidence-cost-budget.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

const SESSION_FILE_RE = /\.jsonl$/;
const DEFAULT_SESSION_LOOKBACK_DAYS = 14;
const ARTIFACT_TEXT_EXTENSIONS = new Set([
  '.json', '.md', '.txt', '.log', '.tap', '.html', '.xml', '.yaml', '.yml'
]);
const SESSION_EXPOSURE_BUCKETS = [
  {
    id: 'audit_evidence',
    label: '監査証跡 / canonical audit artifacts / gate-review-verification evidence'
  },
  {
    id: 'story_spec_architecture_docs',
    label: 'story/spec/architecture docs'
  },
  {
    id: 'src_code',
    label: 'src/ コード本体'
  },
  {
    id: 'test',
    label: 'test/'
  },
  {
    id: 'unattributed',
    label: 'unattributed Codex development in daily window'
  }
];
const SESSION_EXPOSURE_BUCKET_BY_ID = Object.fromEntries(SESSION_EXPOSURE_BUCKETS.map((bucket) => [bucket.id, bucket]));
const SESSION_EXPOSURE_SIGNALS = [
  {
    bucketId: 'audit_evidence',
    patterns: [
      /\.vibepro\/pr\//,
      /\.vibepro\/reviews\//,
      /\.vibepro\/artifacts\//,
      /\.vibepro\/checks\//,
      /docs\/management\/audit-artifacts\//,
      /\bpr-prepare(?:-current)?\.json\b/,
      /\bverification-evidence\.json\b/,
      /\bgate-dag\.json\b/,
      /\bgate-review\b/,
      /\bdecision-summary\b/,
      /\baudit-bundle\b/,
      /\bsenior-gap-judgment\.json\b/,
      /\bdesign-ssot-reconciliation\.json\b/
    ]
  },
  {
    bucketId: 'story_spec_architecture_docs',
    patterns: [
      /docs\/specs\//,
      /docs\/architecture\//,
      /docs\/management\/stories\//,
      /\.vibepro\.json\b/,
      /\bstory[-_]spec\b/,
      /\barchitecture[-_]notes?\b/
    ]
  },
  {
    bucketId: 'src_code',
    patterns: [
      /(?:^|[\s"'`])src\//,
      /(?:^|[\s"'`])lib\//,
      /(?:^|[\s"'`])app\//,
      /(?:^|[\s"'`])packages\/[^/\s"'`]+\/src\//
    ]
  },
  {
    bucketId: 'test',
    patterns: [
      /(?:^|[\s"'`])test\//,
      /(?:^|[\s"'`])tests\//,
      /\b(?:test|spec)\.[cm]?[jt]sx?\b/,
      /\bnode --test\b/,
      /\bnpm (?:run )?test\b/
    ]
  }
];

export async function collectSessionEfficiencyAudit(repoRoot, {
  storyId,
  sessionId,
  inferSession = false,
  codexHome = null,
  automationMemoryPath = null,
  windowStart = null,
  windowEnd = null,
  baseRef = null,
  headRef = 'HEAD',
  includeWorktreeDiff = true,
  now = null
} = {}) {
  if (!storyId) throw new Error('audit session-cost requires --story-id <id>');

  const root = path.resolve(repoRoot);
  const resolvedCodexHome = path.resolve(codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'));
  const automationMemory = await resolveAutomationMemoryWindow(automationMemoryPath, { now });
  const effectiveWindowStart = windowStart ?? automationMemory.window_start ?? null;
  const effectiveWindowEnd = windowEnd ?? automationMemory.window_end ?? null;
  const sessionSelection = await resolveSessionSelection(resolvedCodexHome, {
    requestedSessionId: sessionId,
    inferSession,
    repoRoot: root,
    storyId,
    windowStart: effectiveWindowStart,
    windowEnd: effectiveWindowEnd
  });
  if (!sessionSelection.session_id && !inferSession && sessionId !== 'auto') {
    throw new Error('audit session-cost requires --session-id <id> or --infer-session');
  }

  const selectedSessionId = sessionSelection.session_id;
  const processMetadata = selectedSessionId
    ? await readProcessMetadata(resolvedCodexHome, selectedSessionId)
    : null;
  const sessionFiles = selectedSessionId
    ? sessionSelection.source_paths ?? (sessionSelection.source_path ? [sessionSelection.source_path] : await findCodexSessionFiles(resolvedCodexHome, selectedSessionId))
    : [];
  const session = selectedSessionId && sessionFiles.length > 0
    ? await parseCodexSessionJsonlFiles(sessionFiles, { sessionId: selectedSessionId, storyId, windowStart: effectiveWindowStart, windowEnd: effectiveWindowEnd })
    : missingSessionAccounting(selectedSessionId, effectiveWindowStart, effectiveWindowEnd);
  const observedRoot = processMetadata?.cwd
    ? path.resolve(processMetadata.cwd)
    : (session.cwd ? path.resolve(session.cwd) : root);
  const observedWorktreeMatchesRepo = await matchesRepo(observedRoot, root);
  const artifactInventory = await collectStoryArtifactInventory(observedRoot, storyId, {
    sessionFiles
  });
  const git = await collectGitCostStats(observedRoot, {
    baseRef,
    headRef,
    includeWorktreeDiff
  });
  const costBreakdown = buildCostBreakdown({
    changedLines: git.changed_lines,
    tokenAccounting: session.token_accounting
  });

  return {
    schema_version: '0.1.0',
    artifact_kind: 'vibepro_session_efficiency_audit',
    story_id: storyId,
    session_id: selectedSessionId,
    generated_at: now ?? new Date().toISOString(),
    codex_home: resolvedCodexHome,
    automation_memory: automationMemory,
    session_selection: sessionSelection,
    repo_root: root,
    observed_worktree: observedRoot,
    observed_worktree_source: processMetadata?.cwd ? 'process_manager' : (session.cwd ? 'session_meta' : 'cli_repo'),
    observed_worktree_matches_repo: observedWorktreeMatchesRepo,
    session,
    process_manager: processMetadata ? {
      status: 'available',
      cwd: processMetadata.cwd ?? null,
      command: processMetadata.command ?? null,
      turn_id: processMetadata.turnId ?? null,
      item_id: processMetadata.itemId ?? null,
      process_id: processMetadata.processId ?? null,
      os_pid: processMetadata.osPid ?? null,
      started_at_ms: processMetadata.startedAtMs ?? null,
      updated_at_ms: processMetadata.updatedAtMs ?? null
    } : {
      status: 'unavailable',
      reason: 'process_manager entry was not found for session id'
    },
    story_artifacts: artifactInventory,
    git,
    cost_breakdown: costBreakdown,
    audit_readiness: buildAuditReadiness({
      session,
      processMetadata,
      observedWorktreeMatchesRepo,
      artifactInventory,
      git
    })
  };
}

export function renderSessionEfficiencyAudit(result) {
  const token = result.session.token_accounting;
  const exposure = result.session.artifact_token_accounting;
  const elapsed = result.session.elapsed_time_accounting;
  const lines = [
    `Session cost audit: ${result.story_id}`,
    `- session: ${result.session_id}`,
    `- observed_worktree: ${result.observed_worktree} (${result.observed_worktree_source})`,
    `- tokens: ${token.status} total=${token.total_tokens ?? '未確認'} source=${token.source ?? '-'}`,
    `- artifact_token_accounting: ${exposure.status} audit_evidence_tokens=${exposure.buckets?.audit_evidence?.estimated_tokens ?? '未確認'} session_ratio=${formatRatio(exposure.buckets?.audit_evidence?.ratio_of_session_tokens)} source=${exposure.source ?? '-'}`,
    `- elapsed_ms: ${elapsed.status} ${elapsed.elapsed_ms ?? '未確認'} source=${elapsed.source ?? '-'}`,
    `- changed_lines: ${result.git.changed_lines.total_changed_lines} status=${result.git.changed_lines.status}`,
    `- story_artifact_lines: ${result.story_artifacts.total_lines} files=${result.story_artifacts.file_count}`,
    `- story_artifact_lineage: ${result.story_artifacts.lineage?.status ?? 'unknown'} source=${result.story_artifacts.lineage?.effective_source ?? '-'}`,
    '',
    '| token区分 | estimated tokens | classified比率 | session比率 | events |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...SESSION_EXPOSURE_BUCKETS.map((bucket) => {
      const value = exposure.buckets?.[bucket.id] ?? null;
      return `| ${bucket.label} | ${value?.estimated_tokens ?? 0} | ${formatRatio(value?.ratio_of_classified_exposure)} | ${formatRatio(value?.ratio_of_session_tokens)} | ${value?.event_count ?? 0} |`;
    }),
    '',
    '| changed-line参考区分 | changed lines |',
    '| --- | ---: |',
    ...result.cost_breakdown.buckets.map((bucket) => (
      `| ${bucket.label} | ${bucket.changed_lines} |`
    )),
    ''
  ];
  return `${lines.join('\n')}\n`;
}

async function readProcessMetadata(codexHome, sessionId) {
  const filePath = path.join(codexHome, 'process_manager', 'chat_processes.json');
  let entries;
  try {
    entries = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!Array.isArray(entries)) return null;
  const matches = entries.filter((entry) => entry?.conversationId === sessionId);
  matches.sort((a, b) => Number(b.updatedAtMs ?? 0) - Number(a.updatedAtMs ?? 0));
  return matches[0] ?? null;
}

async function findCodexSessionFile(codexHome, sessionId) {
  const files = await findCodexSessionFiles(codexHome, sessionId);
  return files[0] ?? null;
}

async function findCodexSessionFiles(codexHome, sessionId) {
  const sessionsRoot = path.join(codexHome, 'sessions');
  const files = await findFilesByNameFragment(sessionsRoot, sessionId, 7);
  return files;
}

async function resolveSessionSelection(codexHome, {
  requestedSessionId,
  inferSession,
  repoRoot,
  storyId,
  windowStart,
  windowEnd
} = {}) {
  const normalizedRequested = normalizeRequestedSessionId(requestedSessionId);
  if (normalizedRequested) {
    return {
      status: 'explicit',
      session_id: normalizedRequested,
      source: 'cli',
      source_path: null,
      confidence: 'explicit',
      candidates_considered: 0,
      reason: null
    };
  }
  if (!inferSession && requestedSessionId !== 'auto') {
    return {
      status: 'not_requested',
      session_id: null,
      source: null,
      source_path: null,
      confidence: 'none',
      candidates_considered: 0,
      reason: 'session inference was not requested'
    };
  }

  const candidates = await findCodexSessionCandidates(codexHome, {
    repoRoot,
    storyId,
    windowStart,
    windowEnd
  });
  candidates.sort(compareSessionCandidates);
  const best = candidates[0] ?? null;
  const tied = best ? candidates.filter((candidate) => candidate.score === best.score) : [];
  if (!best) {
    return {
      status: 'unavailable',
      session_id: null,
      source: 'codex-session-jsonl',
      source_path: null,
      confidence: 'none',
      candidates_considered: 0,
      candidates: [],
      reason: 'no Codex session overlapped the requested repo/window'
    };
  }
  if (tied.length > 1 || best.score < 50) {
    return {
      status: 'ambiguous',
      session_id: null,
      source: 'codex-session-jsonl',
      source_path: null,
      confidence: best.score < 50 ? 'low' : 'ambiguous',
      candidates_considered: candidates.length,
      candidates: candidates.slice(0, 5).map(renderSessionCandidate),
      reason: best.score < 50
        ? 'best session candidate did not meet the confidence threshold'
        : 'multiple session candidates had the same top score'
    };
  }
  return {
    status: 'inferred',
    session_id: best.session_id,
    source: 'codex-session-jsonl',
    source_path: best.source_path,
    source_paths: best.source_paths ?? [best.source_path].filter(Boolean),
    confidence: best.score >= 85 ? 'high' : 'medium',
    score: best.score,
    candidates_considered: candidates.length,
    candidates: candidates.slice(0, 5).map(renderSessionCandidate),
    reason: null
  };
}

function normalizeRequestedSessionId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === 'auto') return null;
  return normalized;
}

async function findCodexSessionCandidates(codexHome, { repoRoot, storyId, windowStart, windowEnd } = {}) {
  const sessionsRoot = path.join(codexHome, 'sessions');
  const files = await collectCandidateSessionFiles(sessionsRoot, { windowStart, windowEnd });
  const processEntries = await readProcessEntries(codexHome);
  const candidates = [];
  for (const filePath of files) {
    const candidate = await summarizeSessionCandidate(filePath, {
      repoRoot,
      storyId,
      windowStart,
      windowEnd,
      processEntries
    });
    if (!candidate) continue;
    if (!candidate.window_overlap && !candidate.cwd_matches_repo && !candidate.story_ref_found) continue;
    candidates.push(candidate);
  }
  return mergeSessionCandidates(candidates);
}

function mergeSessionCandidates(candidates) {
  const bySession = new Map();
  for (const candidate of candidates) {
    const group = bySession.get(candidate.session_id) ?? [];
    group.push(candidate);
    bySession.set(candidate.session_id, group);
  }
  return [...bySession.values()].map(mergeSessionCandidateGroup);
}

function mergeSessionCandidateGroup(group) {
  const sorted = [...group].sort(compareSessionCandidates);
  const best = sorted[0];
  const cwdMatchesRepo = group.some((candidate) => candidate.cwd_matches_repo);
  const storyRefFound = group.some((candidate) => candidate.story_ref_found);
  const windowOverlap = group.some((candidate) => candidate.window_overlap);
  const tokenEventCount = group.reduce((sum, candidate) => sum + candidate.token_event_count, 0);
  const finalAnswerCount = group.reduce((sum, candidate) => sum + candidate.final_answer_count, 0);
  const processCwdAvailable = group.some((candidate) => candidate.process_cwd_available);
  const firstEventAt = minIso(group.map((candidate) => candidate.first_event_at));
  const lastEventAt = maxIso(group.map((candidate) => candidate.last_event_at));
  const sourcePaths = [...new Set(group.map((candidate) => candidate.source_path).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const score = [
    cwdMatchesRepo ? 45 : 0,
    storyRefFound ? 30 : 0,
    windowOverlap ? 20 : 0,
    processCwdAvailable ? 10 : 0,
    tokenEventCount > 0 ? 5 : 0,
    finalAnswerCount > 0 ? 5 : 0
  ].reduce((sum, value) => sum + value, 0);

  return {
    ...best,
    source_path: best.source_path,
    source_paths: sourcePaths,
    cwd_matches_repo: cwdMatchesRepo,
    story_ref_found: storyRefFound,
    window_overlap: windowOverlap,
    first_event_at: firstEventAt,
    last_event_at: lastEventAt,
    token_event_count: tokenEventCount,
    final_answer_count: finalAnswerCount,
    process_cwd_available: processCwdAvailable,
    score
  };
}

function compareSessionCandidates(a, b) {
  return b.score - a.score || String(b.last_event_at ?? '').localeCompare(String(a.last_event_at ?? ''));
}

function minIso(values) {
  const timestamps = values.map(normalizeTimeMs).filter((value) => value !== null);
  return timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null;
}

function maxIso(values) {
  const timestamps = values.map(normalizeTimeMs).filter((value) => value !== null);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

async function collectCandidateSessionFiles(sessionsRoot, { windowStart, windowEnd } = {}) {
  const dayDirs = await selectSessionDayDirs(sessionsRoot, { windowStart, windowEnd });
  const roots = dayDirs.length > 0 ? dayDirs.map((entry) => entry.path) : [sessionsRoot];
  const maxDepth = dayDirs.length > 0 ? 1 : 7;
  const files = [];
  for (const root of roots) {
    files.push(...await collectSessionJsonlFiles(root, maxDepth));
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

async function selectSessionDayDirs(sessionsRoot, { windowStart, windowEnd } = {}) {
  const dayDirs = await listSessionDayDirs(sessionsRoot);
  if (dayDirs.length === 0) return [];
  const startMs = normalizeTimeMs(windowStart);
  const endMs = normalizeTimeMs(windowEnd);
  if (startMs !== null || endMs !== null) {
    const start = startMs ?? endMs;
    const end = endMs ?? startMs;
    const startDay = dayOrdinal(start) - 1;
    const endDay = dayOrdinal(end) + 1;
    return dayDirs.filter((entry) => entry.ordinal >= startDay && entry.ordinal <= endDay);
  }
  return dayDirs
    .sort((a, b) => b.ordinal - a.ordinal)
    .slice(0, DEFAULT_SESSION_LOOKBACK_DAYS)
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function listSessionDayDirs(sessionsRoot) {
  const years = await listDirNames(sessionsRoot, (name) => /^\d{4}$/.test(name));
  const dayDirs = [];
  for (const year of years) {
    const yearPath = path.join(sessionsRoot, year);
    const months = await listDirNames(yearPath, (name) => /^\d{2}$/.test(name));
    for (const month of months) {
      const monthPath = path.join(yearPath, month);
      const days = await listDirNames(monthPath, (name) => /^\d{2}$/.test(name));
      for (const day of days) {
        const ordinal = sessionDayOrdinal(year, month, day);
        if (ordinal === null) continue;
        dayDirs.push({ path: path.join(monthPath, day), ordinal });
      }
    }
  }
  return dayDirs;
}

async function listDirNames(root, predicate) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && predicate(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function sessionDayOrdinal(year, month, day) {
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return dayOrdinal(ms);
}

function dayOrdinal(ms) {
  return Math.floor(ms / 86_400_000);
}

async function collectSessionJsonlFiles(root, maxDepth, depth = 0) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && SESSION_FILE_RE.test(entry.name)) {
      files.push(fullPath);
      continue;
    }
    if (depth < maxDepth && entry.isDirectory()) {
      files.push(...await collectSessionJsonlFiles(fullPath, maxDepth, depth + 1));
    }
  }
  return files;
}

async function readProcessEntries(codexHome) {
  const filePath = path.join(codexHome, 'process_manager', 'chat_processes.json');
  try {
    const entries = JSON.parse(await readFile(filePath, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

async function summarizeSessionCandidate(filePath, { repoRoot, storyId, windowStart, windowEnd, processEntries = [] } = {}) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n').filter(Boolean);
  let sessionId = inferSessionIdFromFile(filePath);
  let cwd = null;
  let firstEventMs = null;
  let lastEventMs = null;
  let tokenEventCount = 0;
  let finalAnswerCount = 0;
  const storyRefFound = storyId ? text.includes(storyId) : false;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const eventAt = normalizeTimeMs(entry.timestamp);
    if (eventAt !== null) {
      firstEventMs ??= eventAt;
      lastEventMs = eventAt;
    }
    if (entry.type === 'session_meta') {
      sessionId = entry.payload?.session_id ?? entry.payload?.id ?? sessionId;
      cwd = entry.payload?.cwd ?? cwd;
    }
    if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') tokenEventCount += 1;
    if (entry.type === 'event_msg' && entry.payload?.type === 'final_answer') finalAnswerCount += 1;
  }
  if (!sessionId) return null;
  const processEntry = processEntries.find((entry) => entry?.conversationId === sessionId) ?? null;
  const processCwd = processEntry?.cwd ?? null;
  const effectiveCwd = processCwd ?? cwd;
  const cwdMatchesRepo = effectiveCwd ? await matchesRepo(effectiveCwd, repoRoot) : false;
  const windowOverlap = overlapsWindow(firstEventMs, lastEventMs, normalizeTimeMs(windowStart), normalizeTimeMs(windowEnd));
  const score = [
    cwdMatchesRepo ? 45 : 0,
    storyRefFound ? 30 : 0,
    windowOverlap ? 20 : 0,
    processCwd ? 10 : 0,
    tokenEventCount > 0 ? 5 : 0,
    finalAnswerCount > 0 ? 5 : 0
  ].reduce((sum, value) => sum + value, 0);

  return {
    session_id: sessionId,
    source_path: filePath,
    cwd: effectiveCwd,
    cwd_matches_repo: cwdMatchesRepo,
    process_cwd_available: Boolean(processCwd),
    story_ref_found: storyRefFound,
    window_overlap: windowOverlap,
    first_event_at: firstEventMs === null ? null : new Date(firstEventMs).toISOString(),
    last_event_at: lastEventMs === null ? null : new Date(lastEventMs).toISOString(),
    token_event_count: tokenEventCount,
    final_answer_count: finalAnswerCount,
    score
  };
}

function inferSessionIdFromFile(filePath) {
  const match = path.basename(filePath).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] ?? null;
}

async function matchesRepo(candidatePath, repoRoot) {
  if (await sameExistingPath(candidatePath, repoRoot)) return true;
  try {
    const [candidateCommonDir, repoCommonDir] = await Promise.all([
      gitCommonDir(candidatePath),
      gitCommonDir(repoRoot)
    ]);
    return candidateCommonDir !== null && repoCommonDir !== null && await sameExistingPath(candidateCommonDir, repoCommonDir);
  } catch {
    return false;
  }
}

async function sameExistingPath(a, b) {
  try {
    const [resolvedA, resolvedB] = await Promise.all([realpath(a), realpath(b)]);
    return resolvedA === resolvedB;
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

async function gitCommonDir(cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], { cwd });
    const raw = stdout.trim();
    if (!raw) return null;
    return path.resolve(cwd, raw);
  } catch {
    return null;
  }
}

function overlapsWindow(firstMs, lastMs, startMs, endMs) {
  if (firstMs === null && lastMs === null) return false;
  const first = firstMs ?? lastMs;
  const last = lastMs ?? firstMs;
  if (startMs !== null && last < startMs) return false;
  if (endMs !== null && first > endMs) return false;
  return true;
}

function renderSessionCandidate(candidate) {
  return {
    session_id: candidate.session_id,
    score: candidate.score,
    source_path: candidate.source_path,
    source_paths: candidate.source_paths ?? [candidate.source_path].filter(Boolean),
    cwd: candidate.cwd,
    cwd_matches_repo: candidate.cwd_matches_repo,
    story_ref_found: candidate.story_ref_found,
    window_overlap: candidate.window_overlap,
    first_event_at: candidate.first_event_at,
    last_event_at: candidate.last_event_at,
    token_event_count: candidate.token_event_count
  };
}

async function findFileByNameFragment(root, fragment, maxDepth, depth = 0) {
  const files = await findFilesByNameFragment(root, fragment, maxDepth, depth);
  return files[0] ?? null;
}

async function findFilesByNameFragment(root, fragment, maxDepth, depth = 0) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.includes(fragment) && SESSION_FILE_RE.test(entry.name)) files.push(fullPath);
  }
  if (depth >= maxDepth) return files;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    files.push(...await findFilesByNameFragment(path.join(root, entry.name), fragment, maxDepth, depth + 1));
  }
  return files;
}

async function resolveAutomationMemoryWindow(automationMemoryPath, { now = null } = {}) {
  if (!automationMemoryPath) return { status: 'not_requested' };
  const filePath = resolveUserPath(automationMemoryPath);
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    return {
      status: 'unavailable',
      source_path: filePath,
      reason: error.message,
      window_start: null,
      window_end: null
    };
  }

  const windows = extractAutomationWindows(text);
  if (windows.length > 0) {
    windows.sort((a, b) => (
      (a.priority - b.priority)
      || (normalizeTimeMs(a.window_start) - normalizeTimeMs(b.window_start))
    ));
    const latest = windows.at(-1);
    return {
      status: 'available',
      source: latest.source,
      source_path: filePath,
      window_start: latest.window_start,
      window_end: latest.window_end,
      reason: null
    };
  }

  const lastRun = extractLastRun(text);
  if (lastRun) {
    return {
      status: 'partial',
      source: 'automation-memory-last-run',
      source_path: filePath,
      window_start: lastRun,
      window_end: now ?? new Date().toISOString(),
      reason: 'automation memory did not contain an explicit daily window; used Last run as start and now as end'
    };
  }

  return {
    status: 'unavailable',
    source_path: filePath,
    reason: 'automation memory did not contain a parseable daily window or Last run timestamp',
    window_start: null,
    window_end: null
  };
}

function extractAutomationWindows(text) {
  const windows = [];
  const patterns = [
    {
      source: 'automation-memory-daily-window',
      priority: 3,
      regex: /daily\s+value\s+audit:\s+window\s+(?:was|=|:)\s*`?([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?)`?\s*(?:to|->|から|〜|~)\s*`?([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?)`?/gi
    },
    {
      source: 'automation-memory-daily-window',
      priority: 2,
      regex: /window\s+(?:was|=|:)\s*`?([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?)`?\s*(?:to|->|から|〜|~)\s*`?([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?)`?/gi
    },
    {
      source: 'automation-memory-cost-snapshot-window',
      priority: 1,
      regex: /window\s+cost\s+snapshot:.*?from\s+`?([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?)`?\s+to\s+`?([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?)`?/gi
    }
  ];
  for (const { source, priority, regex } of patterns) {
    for (const match of text.matchAll(regex)) {
      const start = normalizeIso(match[1]);
      const end = normalizeIso(match[2]);
      if (!start || !end) continue;
      windows.push({ source, priority, window_start: start, window_end: end });
    }
  }
  return windows;
}

function extractLastRun(text) {
  const match = text.match(/Last run:\s*`?([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?)`?/i);
  return match ? normalizeIso(match[1]) : null;
}

function normalizeIso(value) {
  const ms = normalizeTimeMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function resolveUserPath(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

async function parseCodexSessionJsonlFiles(filePaths, { sessionId, storyId, windowStart, windowEnd } = {}) {
  const entries = await readCodexSessionEntries(filePaths);
  const startMs = normalizeTimeMs(windowStart);
  const endMs = normalizeTimeMs(windowEnd);
  const tokenEvents = [];
  const taskStartedEvents = [];
  const finalAnswerEvents = [];
  const exposureEvents = [];
  const inWindowEventTimestamps = [];
  let cwd = null;
  let firstEventAt = null;
  let lastEventAt = null;

  for (const { entry, sourcePath, line } of entries) {
    const eventAt = normalizeTimeMs(entry.timestamp);
    if (eventAt !== null) {
      firstEventAt ??= eventAt;
      lastEventAt = eventAt;
    }
    if (entry.type === 'session_meta') {
      cwd = entry.payload?.cwd ?? cwd;
    }
    if (!isInsideWindow(eventAt, startMs, endMs)) continue;
    if (eventAt !== null) inWindowEventTimestamps.push(eventAt);
    const exposure = summarizeSessionExposureEntry(entry, {
      storyId,
      sourcePath,
      line,
      timestampMs: eventAt
    });
    if (exposure) exposureEvents.push(exposure);
    if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
      const usage = entry.payload?.info?.total_token_usage;
      if (usage) tokenEvents.push({ line, source_path: sourcePath, timestamp_ms: eventAt, usage });
    }
    if (entry.type === 'event_msg' && entry.payload?.type === 'task_started') {
      taskStartedEvents.push({ line, source_path: sourcePath, timestamp_ms: eventAt, started_at: entry.payload?.started_at });
    }
    if (entry.type === 'event_msg' && entry.payload?.type === 'final_answer') {
      finalAnswerEvents.push({ line, source_path: sourcePath, timestamp_ms: eventAt });
    }
  }

  const firstToken = tokenEvents[0] ?? null;
  const lastToken = tokenEvents.at(-1) ?? null;
  const boundedWindowRequested = startMs !== null || endMs !== null;
  const hasInWindowEvents = inWindowEventTimestamps.length > 0;
  const windowStartedAt = boundedWindowRequested && !hasInWindowEvents
    ? null
    : (startMs ?? taskStartedEvents[0]?.timestamp_ms ?? firstToken?.timestamp_ms ?? inWindowEventTimestamps[0] ?? firstEventAt);
  const windowFinishedAt = boundedWindowRequested && !hasInWindowEvents
    ? null
    : (endMs ?? finalAnswerEvents.at(-1)?.timestamp_ms ?? lastToken?.timestamp_ms ?? inWindowEventTimestamps.at(-1) ?? lastEventAt);
  const tokenDelta = firstToken && lastToken
    ? subtractUsage(lastToken.usage, firstToken.usage)
    : null;
  const artifactTokenAccounting = buildArtifactTokenAccounting(exposureEvents, tokenDelta, {
    sessionId,
    filePaths,
    windowStart,
    windowEnd
  });

  return {
    status: 'available',
    source_path: filePaths[0] ?? null,
    source_paths: filePaths,
    cwd,
    line_count: entries.length,
    window: {
      session_id: sessionId,
      requested_start: windowStart ?? null,
      requested_end: windowEnd ?? null,
      first_token_line: firstToken?.line ?? null,
      last_token_line: lastToken?.line ?? null,
      token_event_count: tokenEvents.length,
      in_window_event_count: inWindowEventTimestamps.length,
      scope: windowStart || windowEnd ? 'bounded' : 'full_session'
    },
    token_accounting: tokenDelta ? {
      status: 'available',
      total_tokens: tokenDelta.total_tokens,
      input_tokens: tokenDelta.input_tokens,
      output_tokens: tokenDelta.output_tokens,
      cached_input_tokens: tokenDelta.cached_input_tokens,
      reasoning_output_tokens: tokenDelta.reasoning_output_tokens,
      source: 'codex-session-jsonl',
      window: {
        session_id: sessionId,
        source_path: firstToken.source_path,
        source_paths: filePaths,
        first_token_line: firstToken.line,
        last_token_line: lastToken.line,
        last_token_source_path: lastToken.source_path,
        scope: windowStart || windowEnd ? 'bounded' : 'full_session'
      },
      reason: null
    } : {
      status: 'unavailable',
      total_tokens: null,
      input_tokens: null,
      output_tokens: null,
      cached_input_tokens: null,
      reasoning_output_tokens: null,
      source: 'codex-session-jsonl',
      window: { session_id: sessionId, source_path: filePaths[0] ?? null, source_paths: filePaths },
      reason: 'no token_count events were found in the selected session window'
    },
    artifact_token_accounting: artifactTokenAccounting,
    elapsed_time_accounting: windowStartedAt !== null && windowFinishedAt !== null ? {
      status: finalAnswerEvents.length > 0 || windowEnd ? 'available' : 'partial',
      elapsed_ms: Math.max(0, windowFinishedAt - windowStartedAt),
      started_at: new Date(windowStartedAt).toISOString(),
      finished_at: new Date(windowFinishedAt).toISOString(),
      source: 'codex-session-jsonl',
      window: { session_id: sessionId, source_path: filePaths[0] ?? null, source_paths: filePaths },
      reason: finalAnswerEvents.length > 0 || windowEnd ? null : 'no final_answer event in selected window; used last observed event timestamp'
    } : {
      status: 'unavailable',
      elapsed_ms: null,
      started_at: null,
      finished_at: null,
      source: 'codex-session-jsonl',
      window: { session_id: sessionId, source_path: filePaths[0] ?? null, source_paths: filePaths },
      reason: boundedWindowRequested && !hasInWindowEvents
        ? 'no events were found in the selected bounded session window'
        : 'no usable timestamps were found in the selected session window'
    }
  };
}

async function parseCodexSessionJsonl(filePath, options = {}) {
  return parseCodexSessionJsonlFiles([filePath], options);
}

async function readCodexSessionEntries(filePaths) {
  const entries = [];
  for (const sourcePath of filePaths) {
    const text = await readFile(sourcePath, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      try {
        entries.push({
          entry: JSON.parse(lines[index]),
          sourcePath,
          line: index + 1
        });
      } catch {
        // Ignore malformed JSONL rows; other rows in the session may still carry usable accounting.
      }
    }
  }
  entries.sort((a, b) => (
    (normalizeTimeMs(a.entry.timestamp) ?? 0) - (normalizeTimeMs(b.entry.timestamp) ?? 0)
    || a.sourcePath.localeCompare(b.sourcePath)
    || a.line - b.line
  ));
  return entries;
}

function summarizeSessionExposureEntry(entry, { storyId, sourcePath, line, timestampMs }) {
  const textParts = extractSessionTranscriptText(entry);
  if (textParts.length === 0) return null;
  const text = textParts.join('\n').trim();
  if (!text) return null;
  const estimatedTokens = estimateTextTokens(text);
  const classification = classifySessionExposureText(text, { storyId });
  return {
    matched: Boolean(classification),
    bucket_id: classification?.bucket_id ?? 'unattributed',
    bucket_label: classification?.bucket_id ? SESSION_EXPOSURE_BUCKET_BY_ID[classification.bucket_id]?.label ?? classification.bucket_id : SESSION_EXPOSURE_BUCKET_BY_ID.unattributed.label,
    estimated_tokens: estimatedTokens,
    char_count: text.length,
    matched_signals: classification?.matched_signals ?? [],
    timestamp: timestampMs === null ? null : new Date(timestampMs).toISOString(),
    source_path: sourcePath,
    line,
    entry_type: entry.type ?? null,
    payload_type: entry.payload?.type ?? null,
    sample: text.slice(0, 280)
  };
}

function extractSessionTranscriptText(entry) {
  const out = [];
  const payload = entry?.payload;
  if (!payload || typeof payload !== 'object') return out;
  collectSessionTextFields(payload, out);
  return out;
}

function collectSessionTextFields(value, out) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectSessionTextFields(item, out);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'encrypted_content') continue;
    if (typeof item === 'string' && isTranscriptTextField(key)) {
      out.push(item);
      continue;
    }
    if (item && typeof item === 'object') collectSessionTextFields(item, out);
  }
}

function isTranscriptTextField(key) {
  return [
    'text',
    'output',
    'arguments',
    'summary',
    'content',
    'cmd',
    'command'
  ].includes(key);
}

function classifySessionExposureText(text, { storyId } = {}) {
  const normalized = text.replace(/\\/g, '/');
  const matched = [];
  for (const { bucketId, patterns } of SESSION_EXPOSURE_SIGNALS) {
    const signals = [];
    for (const pattern of patterns) {
      if (pattern.test(normalized)) signals.push(pattern.source);
    }
    if (storyId && bucketId === 'audit_evidence' && normalized.includes(storyId) && normalized.includes('.vibepro/')) {
      signals.push(`story:${storyId}+.vibepro`);
    }
    if (signals.length > 0) matched.push({ bucket_id: bucketId, matched_signals: uniqueStrings(signals) });
  }
  return matched[0] ?? null;
}

function estimateTextTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function buildArtifactTokenAccounting(exposureEvents, tokenAccounting, {
  sessionId,
  filePaths,
  windowStart,
  windowEnd
} = {}) {
  const matchedEvents = exposureEvents.filter((event) => event.matched);
  const unmatchedEvents = exposureEvents.filter((event) => !event.matched);
  const classifiedEstimatedTokens = sumTokens(matchedEvents);
  const totalSessionTokens = tokenAccounting?.total_tokens ?? null;
  const buckets = emptyExposureBuckets(totalSessionTokens);
  for (const bucket of Object.values(buckets)) {
    bucket.ratio_of_classified_exposure = classifiedEstimatedTokens > 0 ? 0 : null;
  }
  for (const event of matchedEvents) {
    const bucket = buckets[event.bucket_id] ?? buckets.unattributed;
    bucket.estimated_tokens += event.estimated_tokens;
    bucket.event_count += 1;
    bucket.matched_signals = uniqueStrings([...bucket.matched_signals, ...event.matched_signals]).slice(0, 12);
  }
  for (const bucket of Object.values(buckets)) {
    bucket.ratio_of_classified_exposure = classifiedEstimatedTokens > 0
      ? ratio(bucket.estimated_tokens, classifiedEstimatedTokens)
      : null;
    bucket.ratio_of_session_tokens = totalSessionTokens !== null && totalSessionTokens > 0
      ? ratio(bucket.estimated_tokens, totalSessionTokens)
      : null;
  }

  return {
    status: 'available',
    estimated_total_tokens: classifiedEstimatedTokens,
    classified_estimated_tokens: classifiedEstimatedTokens,
    total_session_tokens: totalSessionTokens,
    source: 'codex-session-jsonl-text-estimate',
    estimate_method: 'ceil(text.length / 4) for in-window transcript entries with artifact/code/doc path signals',
    coverage: 'signal-matched transcript entries only',
    buckets,
    top_exposures: matchedEvents
      .sort((a, b) => b.estimated_tokens - a.estimated_tokens || a.source_path.localeCompare(b.source_path) || a.line - b.line)
      .slice(0, 10)
      .map((event) => ({
        bucket_id: event.bucket_id,
        bucket_label: event.bucket_label,
        estimated_tokens: event.estimated_tokens,
        matched_signals: event.matched_signals.slice(0, 8),
        timestamp: event.timestamp,
        source_path: event.source_path,
        line: event.line,
        entry_type: event.entry_type,
        payload_type: event.payload_type,
        sample: event.sample
      })),
    unmatched_event_count: unmatchedEvents.length,
    unmatched_estimated_tokens: sumTokens(unmatchedEvents),
    window: {
      session_id: sessionId,
      source_path: filePaths?.[0] ?? null,
      source_paths: filePaths ?? [],
      requested_start: windowStart ?? null,
      requested_end: windowEnd ?? null,
      scope: windowStart || windowEnd ? 'bounded' : 'full_session'
    },
    reason: matchedEvents.length > 0 ? null : 'no signal-matched artifact/code/doc transcript entries were found in the selected session window'
  };
}

function emptyExposureBuckets(totalSessionTokens) {
  return Object.fromEntries(SESSION_EXPOSURE_BUCKETS.map((bucket) => [bucket.id, {
    id: bucket.id,
    label: bucket.label,
    estimated_tokens: 0,
    event_count: 0,
    ratio_of_classified_exposure: null,
    ratio_of_session_tokens: totalSessionTokens !== null && totalSessionTokens > 0 ? 0 : null,
    matched_signals: []
  }]));
}

function sumTokens(events) {
  return events.reduce((sum, event) => sum + (event.estimated_tokens ?? 0), 0);
}

function ratio(part, total) {
  return Number(((part / total) * 100).toFixed(1));
}

function formatRatio(value) {
  return value === null || value === undefined ? '未確認' : `${value}%`;
}

function missingSessionAccounting(sessionId, windowStart, windowEnd) {
  return {
    status: 'unavailable',
    source_path: null,
    cwd: null,
    line_count: 0,
    window: {
      session_id: sessionId,
      requested_start: windowStart ?? null,
      requested_end: windowEnd ?? null,
      scope: windowStart || windowEnd ? 'bounded' : 'full_session'
    },
    token_accounting: {
      status: 'unavailable',
      total_tokens: null,
      input_tokens: null,
      output_tokens: null,
      cached_input_tokens: null,
      reasoning_output_tokens: null,
      source: 'codex-session-jsonl',
      window: { session_id: sessionId },
      reason: 'codex session jsonl was not found'
    },
    elapsed_time_accounting: {
      status: 'unavailable',
      elapsed_ms: null,
      started_at: null,
      finished_at: null,
      source: 'codex-session-jsonl',
      window: { session_id: sessionId },
      reason: 'codex session jsonl was not found'
    },
    artifact_token_accounting: {
      status: 'unavailable',
      estimated_total_tokens: null,
      classified_estimated_tokens: null,
      total_session_tokens: null,
      source: 'codex-session-jsonl-text-estimate',
      estimate_method: 'ceil(text.length / 4) for in-window transcript entries with artifact/code/doc path signals',
      coverage: 'signal-matched transcript entries only',
      buckets: emptyExposureBuckets(null),
      top_exposures: [],
      unmatched_event_count: 0,
      unmatched_estimated_tokens: 0,
      window: { session_id: sessionId },
      reason: 'codex session jsonl was not found'
    }
  };
}

async function collectStoryArtifactInventory(repoRoot, storyId, { sessionFiles = [] } = {}) {
  const artifactRoot = path.join(getWorkspaceDir(repoRoot), 'pr', storyId);
  const lineage = await collectArtifactLineage(repoRoot, storyId, {
    currentArtifactRoot: artifactRoot,
    sessionFiles
  });
  const effectiveRoot = lineage.effective_root_path ?? artifactRoot;
  const files = await collectTextFiles(effectiveRoot);
  let totalLines = 0;
  const artifacts = [];
  for (const filePath of files) {
    const text = await readFile(filePath, 'utf8');
    const lineCount = countTextLines(text);
    totalLines += lineCount;
    artifacts.push({
      path: renderArtifactPath(repoRoot, filePath),
      lines: lineCount
    });
  }
  artifacts.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  const currentArtifactsAvailable = files.length > 0 && path.resolve(effectiveRoot) === path.resolve(artifactRoot);
  return {
    status: files.length > 0
      ? (currentArtifactsAvailable ? 'available' : 'detached_available')
      : 'unavailable',
    root: toWorkspaceRelative(repoRoot, artifactRoot),
    effective_root: renderArtifactPath(repoRoot, effectiveRoot),
    file_count: files.length,
    total_lines: totalLines,
    largest_files: artifacts.slice(0, 10),
    pr_prepare: await readPrPrepareSummary(repoRoot, storyId, effectiveRoot),
    verification: await readVerificationSummary(repoRoot, storyId, effectiveRoot),
    lineage
  };
}

async function collectArtifactLineage(repoRoot, storyId, {
  currentArtifactRoot,
  sessionFiles = []
} = {}) {
  const currentCandidate = await summarizeArtifactRoot(repoRoot, currentArtifactRoot, {
    source: 'current_worktree',
    source_path: renderArtifactPath(repoRoot, currentArtifactRoot),
    line: null,
    observed_at: null
  });
  const detachedCandidates = sessionFiles.length > 0
    ? await collectDetachedArtifactCandidates(repoRoot, storyId, sessionFiles, currentArtifactRoot)
    : [];
  const readableDetached = detachedCandidates.find((candidate) => candidate.exists && candidate.file_count > 0) ?? null;
  const observedDetached = detachedCandidates[0] ?? null;
  const effective = currentCandidate.exists && currentCandidate.file_count > 0
    ? currentCandidate
    : readableDetached;
  const status = currentCandidate.exists && currentCandidate.file_count > 0
    ? (detachedCandidates.length > 0 ? 'current_with_detached_candidates' : 'current')
    : readableDetached
      ? 'detached_artifact_found'
      : observedDetached
        ? 'detached_artifact_observed'
        : 'missing';

  return {
    status,
    current: currentCandidate,
    effective_root_path: effective?.root_path ?? null,
    effective_source: effective?.source ?? null,
    detached_candidates: detachedCandidates.map((candidate) => ({
      source: candidate.source,
      root: candidate.root,
      root_path: candidate.root_path,
      exists: candidate.exists,
      file_count: candidate.file_count,
      total_lines: candidate.total_lines,
      first_observed_at: candidate.first_observed_at,
      last_observed_at: candidate.last_observed_at,
      first_line: candidate.first_line,
      last_line: candidate.last_line,
      observation_count: candidate.observation_count,
      evidence_refs: candidate.evidence_refs.slice(0, 5)
    })),
    reason: lineageReason(status)
  };
}

async function collectDetachedArtifactCandidates(repoRoot, storyId, sessionFiles, currentArtifactRoot) {
  const byRoot = new Map();
  let latestCwd = null;
  for (const sessionFile of sessionFiles) {
    let text;
    try {
      text = await readFile(sessionFile, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n').filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      let entry;
      try {
        entry = JSON.parse(lines[index]);
      } catch {
        continue;
      }
      const observedAt = normalizeIso(entry.timestamp);
      const strings = collectJsonStrings(entry);
      const cwdHints = collectCwdHints(entry);
      if (entry.type === 'session_meta') {
        latestCwd = entry.payload?.cwd ?? latestCwd;
      }
      if (cwdHints.length > 0) latestCwd = cwdHints.at(-1);
      const candidateBases = uniqueStrings([
        latestCwd,
        ...cwdHints
      ].filter(Boolean));

      const roots = new Set();
      for (const value of strings) {
        for (const root of extractArtifactRoots(value, storyId, candidateBases)) {
          roots.add(root);
        }
      }
      if (roots.size === 0 && lines[index].includes(storyId) && /\bvibepro\b|\.vibepro\//.test(lines[index])) {
        for (const base of candidateBases) {
          if (path.isAbsolute(base)) roots.add(path.join(base, '.vibepro', 'pr', storyId));
        }
      }
      for (const root of roots) {
        const resolved = path.resolve(root);
        if (path.resolve(currentArtifactRoot) === resolved) continue;
        const current = byRoot.get(resolved) ?? {
          root_path: resolved,
          first_observed_at: observedAt,
          last_observed_at: observedAt,
          first_line: index + 1,
          last_line: index + 1,
          observation_count: 0,
          evidence_refs: []
        };
        current.first_observed_at ??= observedAt;
        current.last_observed_at = observedAt ?? current.last_observed_at;
        current.last_line = index + 1;
        current.observation_count += 1;
        current.evidence_refs.push({
          source_path: sessionFile,
          line: index + 1,
          observed_at: observedAt
        });
        byRoot.set(resolved, current);
      }
    }
  }

  const candidates = [];
  for (const candidate of byRoot.values()) {
    candidates.push(await summarizeArtifactRoot(repoRoot, candidate.root_path, {
      source: 'codex-session-jsonl',
      source_path: candidate.evidence_refs[0]?.source_path ?? null,
      line: candidate.first_line,
      observed_at: candidate.first_observed_at,
      first_observed_at: candidate.first_observed_at,
      last_observed_at: candidate.last_observed_at,
      first_line: candidate.first_line,
      last_line: candidate.last_line,
      observation_count: candidate.observation_count,
      evidence_refs: candidate.evidence_refs
    }));
  }
  candidates.sort((a, b) => Number(b.exists) - Number(a.exists) || b.file_count - a.file_count || a.root.localeCompare(b.root));
  return candidates;
}

async function summarizeArtifactRoot(repoRoot, artifactRoot, observation) {
  const files = await collectTextFiles(artifactRoot);
  let totalLines = 0;
  for (const filePath of files) {
    const text = await readFile(filePath, 'utf8');
    totalLines += countTextLines(text);
  }
  return {
    source: observation.source,
    root: renderArtifactPath(repoRoot, artifactRoot),
    root_path: path.resolve(artifactRoot),
    exists: files.length > 0,
    file_count: files.length,
    total_lines: totalLines,
    source_path: observation.source_path ?? null,
    line: observation.line ?? null,
    first_observed_at: observation.first_observed_at ?? observation.observed_at ?? null,
    last_observed_at: observation.last_observed_at ?? observation.observed_at ?? null,
    first_line: observation.first_line ?? observation.line ?? null,
    last_line: observation.last_line ?? observation.line ?? null,
    observation_count: observation.observation_count ?? (observation.line ? 1 : 0),
    evidence_refs: observation.evidence_refs ?? []
  };
}

function collectJsonStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonStrings(item, out);
    return out;
  }
  for (const item of Object.values(value)) collectJsonStrings(item, out);
  return out;
}

function collectCwdHints(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectCwdHints(item, out);
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'cwd' || key === 'workdir') && typeof item === 'string' && path.isAbsolute(item)) out.push(item);
    collectCwdHints(item, out);
  }
  return uniqueStrings(out);
}

function extractArtifactRoots(value, storyId, candidateBases) {
  if (!value.includes('.vibepro') || !value.includes(storyId)) return [];
  const escapedStoryId = escapeRegex(storyId);
  const roots = [];
  const absolute = new RegExp(`(/[^\\s"'\\\`]+?\\.vibepro/pr/${escapedStoryId})(?:/[^\\s"'\\\`]*)?`, 'g');
  for (const match of value.matchAll(absolute)) {
    roots.push(match[1]);
  }
  const relative = new RegExp(`(^|[\\s"'\\\`])((?:\\./)?\\.vibepro/pr/${escapedStoryId})(?:/[^\\s"'\\\`]*)?`, 'g');
  for (const match of value.matchAll(relative)) {
    for (const base of candidateBases) {
      if (path.isAbsolute(base)) roots.push(path.resolve(base, match[2]));
    }
  }
  return uniqueStrings(roots);
}

function renderArtifactPath(repoRoot, filePath) {
  const relative = toWorkspaceRelative(repoRoot, filePath);
  return relative.startsWith('..') ? path.resolve(filePath) : relative;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineageReason(status) {
  if (status === 'current') return null;
  if (status === 'current_with_detached_candidates') return 'current story artifacts were available; detached candidates are secondary provenance';
  if (status === 'detached_artifact_found') return 'current story artifacts were unavailable, but a readable detached artifact root was found from Codex session JSONL';
  if (status === 'detached_artifact_observed') return 'current story artifacts were unavailable, and Codex session JSONL observed a detached artifact root that is no longer readable';
  return 'no current or detached story artifact root was found';
}

async function collectTextFiles(root) {
  const out = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectTextFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!ARTIFACT_TEXT_EXTENSIONS.has(path.extname(entry.name))) continue;
    const info = await stat(fullPath);
    if (info.size > 2 * 1024 * 1024) continue;
    out.push(fullPath);
  }
  return out;
}

async function readPrPrepareSummary(repoRoot, storyId, artifactRoot = path.join(getWorkspaceDir(repoRoot), 'pr', storyId)) {
  const candidates = [
    path.join(artifactRoot, 'pr-prepare-current.json'),
    path.join(artifactRoot, 'pr-prepare.json')
  ];
  for (const filePath of candidates) {
    const parsed = await readJsonIfExists(filePath);
    if (!parsed) continue;
    return {
      status: 'available',
      source: renderArtifactPath(repoRoot, filePath),
      overall_status: parsed.gate_status?.overall_status ?? parsed.overall_status ?? null,
      ready_for_pr_create: parsed.gate_status?.ready_for_pr_create ?? parsed.ready_for_pr_create ?? null,
      critical_unresolved_gate_count: parsed.gate_status?.critical_unresolved_gates?.length ?? null
    };
  }
  return { status: 'unavailable', reason: 'pr-prepare artifact was not found' };
}

async function readVerificationSummary(repoRoot, storyId, artifactRoot = path.join(getWorkspaceDir(repoRoot), 'pr', storyId)) {
  const filePath = path.join(artifactRoot, 'verification-evidence.json');
  const parsed = await readJsonIfExists(filePath);
  if (!parsed) return { status: 'unavailable', reason: 'verification-evidence artifact was not found' };
  const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
  return {
    status: 'available',
    source: renderArtifactPath(repoRoot, filePath),
    updated_at: parsed.updated_at ?? null,
    command_count: commands.length,
    pass_count: commands.filter((command) => command.status === 'pass').length,
    fail_count: commands.filter((command) => command.status === 'fail').length
  };
}

async function collectGitCostStats(repoRoot, { baseRef, headRef, includeWorktreeDiff }) {
  const head = headRef ?? 'HEAD';
  const committed = baseRef
    ? await gitNumstat(repoRoot, [baseRef, head], `git diff --numstat ${baseRef}...${head}`)
    : unavailableDiff('base ref was not provided');
  const unstaged = includeWorktreeDiff
    ? await gitNumstat(repoRoot, [null], 'git diff --numstat')
    : unavailableDiff('worktree diff collection disabled');
  const staged = includeWorktreeDiff
    ? await gitNumstat(repoRoot, ['--cached'], 'git diff --cached --numstat')
    : unavailableDiff('worktree diff collection disabled');
  const mergedStats = mergeDiffStats(committed.stats, unstaged.stats, staged.stats);
  const changedLines = summarizeDiffLineStats(mergedStats);
  changedLines.source = [
    committed.status === 'available' ? committed.source : null,
    unstaged.status === 'available' ? unstaged.source : null,
    staged.status === 'available' ? staged.source : null
  ].filter(Boolean).join(' + ') || null;
  changedLines.reason = changedLines.status === 'available' ? null : 'no git diff stats were available';

  return {
    status: changedLines.status,
    base_ref: baseRef ?? null,
    head_ref: head,
    committed,
    unstaged,
    staged,
    changed_lines: changedLines
  };
}

async function gitNumstat(repoRoot, args, source) {
  try {
    const gitArgs = args[0] === '--cached'
      ? ['diff', '--cached', '--numstat']
      : args.length === 1 && args[0] === null
        ? ['diff', '--numstat']
        : ['diff', '--numstat', `${args[0]}...${args[1]}`];
    const { stdout } = await execFileAsync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return {
      status: 'available',
      source,
      stats: parseNumstat(stdout)
    };
  } catch (error) {
    return {
      status: 'unavailable',
      source,
      stats: null,
      reason: error.message
    };
  }
}

function unavailableDiff(reason) {
  return { status: 'unavailable', source: null, stats: null, reason };
}

function mergeDiffStats(...statsList) {
  const merged = {};
  for (const stats of statsList) {
    if (!stats) continue;
    for (const [filePath, item] of Object.entries(stats)) {
      const current = merged[filePath] ?? { additions: 0, deletions: 0 };
      if (item.additions === null || item.deletions === null || current.additions === null || current.deletions === null) {
        merged[filePath] = { additions: null, deletions: null };
        continue;
      }
      merged[filePath] = {
        additions: current.additions + item.additions,
        deletions: current.deletions + item.deletions
      };
    }
  }
  return merged;
}

function buildCostBreakdown({ changedLines, tokenAccounting }) {
  const labels = {
    src: 'src/ コード本体',
    test: 'test/',
    story_spec_architecture_docs: 'story/spec/architecture docs',
    audit_artifacts: '監査証跡 / canonical audit artifacts / gate-review-verification evidence',
    other: 'other'
  };
  const total = changedLines.total_changed_lines;
  const tokens = tokenAccounting.status === 'available' ? tokenAccounting.total_tokens : null;
  const buckets = Object.entries(changedLines.buckets).map(([key, bucket]) => {
    const ratio = total > 0 ? Number(((bucket.changed_lines / total) * 100).toFixed(1)) : null;
    return {
      key,
      label: labels[key] ?? key,
      changed_lines: bucket.changed_lines,
      estimated_tokens: tokens !== null && ratio !== null ? Math.round(tokens * bucket.changed_lines / total) : null,
      ratio
    };
  });
  return {
    status: tokens !== null && total > 0 ? 'available' : 'partial',
    allocation_basis: tokens !== null ? 'session token delta apportioned by changed-line bucket ratio' : 'changed lines only; token_count unavailable',
    total_changed_lines: total,
    total_tokens: tokens,
    buckets
  };
}

function buildAuditReadiness({ session, processMetadata, observedWorktreeMatchesRepo, artifactInventory, git }) {
  const blockers = [
    session.token_accounting.status !== 'available' ? 'token_count_unavailable' : null,
    session.elapsed_time_accounting.status === 'unavailable' ? 'elapsed_time_unavailable' : null,
    !processMetadata && !session.cwd ? 'session_cwd_unavailable' : null,
    observedWorktreeMatchesRepo === false ? 'session_cwd_mismatch' : null,
    !isUsableArtifactInventory(artifactInventory) ? artifactInventoryBlocker(artifactInventory) : null,
    git.changed_lines.status !== 'available' ? 'changed_lines_unavailable' : null
  ].filter(Boolean);
  return {
    status: blockers.length === 0 ? 'ready' : 'partial',
    blockers
  };
}

function isUsableArtifactInventory(artifactInventory) {
  return artifactInventory.status === 'available' || artifactInventory.status === 'detached_available';
}

function artifactInventoryBlocker(artifactInventory) {
  return artifactInventory.lineage?.status === 'detached_artifact_observed'
    ? 'story_artifacts_detached_unavailable'
    : 'story_artifacts_unavailable';
}

function subtractUsage(last, first) {
  return {
    total_tokens: diffNumber(last?.total_tokens, first?.total_tokens),
    input_tokens: diffNumber(last?.input_tokens, first?.input_tokens),
    output_tokens: diffNumber(last?.output_tokens, first?.output_tokens),
    cached_input_tokens: diffNumber(last?.cached_input_tokens, first?.cached_input_tokens),
    reasoning_output_tokens: diffNumber(last?.reasoning_output_tokens, first?.reasoning_output_tokens)
  };
}

function diffNumber(last, first) {
  if (!Number.isFinite(last) || !Number.isFinite(first)) return null;
  return Math.max(0, last - first);
}

function isInsideWindow(timestampMs, startMs, endMs) {
  if (timestampMs === null) return startMs === null && endMs === null;
  if (startMs !== null && timestampMs < startMs) return false;
  if (endMs !== null && timestampMs > endMs) return false;
  return true;
}

function normalizeTimeMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function countTextLines(text) {
  if (!text) return 0;
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
