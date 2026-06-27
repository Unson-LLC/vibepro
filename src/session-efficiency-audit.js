import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
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
const ARTIFACT_TEXT_EXTENSIONS = new Set([
  '.json', '.md', '.txt', '.log', '.tap', '.html', '.xml', '.yaml', '.yml'
]);

export async function collectSessionEfficiencyAudit(repoRoot, {
  storyId,
  sessionId,
  codexHome = null,
  windowStart = null,
  windowEnd = null,
  baseRef = null,
  headRef = 'HEAD',
  includeWorktreeDiff = true,
  now = null
} = {}) {
  if (!storyId) throw new Error('audit session-cost requires --story-id <id>');
  if (!sessionId) throw new Error('audit session-cost requires --session-id <id>');

  const root = path.resolve(repoRoot);
  const resolvedCodexHome = path.resolve(codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'));
  const processMetadata = await readProcessMetadata(resolvedCodexHome, sessionId);
  const sessionFile = await findCodexSessionFile(resolvedCodexHome, sessionId);
  const session = sessionFile
    ? await parseCodexSessionJsonl(sessionFile, { sessionId, windowStart, windowEnd })
    : missingSessionAccounting(sessionId, windowStart, windowEnd);
  const observedRoot = processMetadata?.cwd
    ? path.resolve(processMetadata.cwd)
    : (session.cwd ? path.resolve(session.cwd) : root);
  const artifactInventory = await collectStoryArtifactInventory(observedRoot, storyId);
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
    session_id: sessionId,
    generated_at: now ?? new Date().toISOString(),
    codex_home: resolvedCodexHome,
    repo_root: root,
    observed_worktree: observedRoot,
    observed_worktree_source: processMetadata?.cwd ? 'process_manager' : (session.cwd ? 'session_meta' : 'cli_repo'),
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
    audit_readiness: buildAuditReadiness({ session, processMetadata, artifactInventory, git })
  };
}

export function renderSessionEfficiencyAudit(result) {
  const token = result.session.token_accounting;
  const elapsed = result.session.elapsed_time_accounting;
  const lines = [
    `Session cost audit: ${result.story_id}`,
    `- session: ${result.session_id}`,
    `- observed_worktree: ${result.observed_worktree} (${result.observed_worktree_source})`,
    `- tokens: ${token.status} total=${token.total_tokens ?? '未確認'} source=${token.source ?? '-'}`,
    `- elapsed_ms: ${elapsed.status} ${elapsed.elapsed_ms ?? '未確認'} source=${elapsed.source ?? '-'}`,
    `- changed_lines: ${result.git.changed_lines.total_changed_lines} status=${result.git.changed_lines.status}`,
    `- story_artifact_lines: ${result.story_artifacts.total_lines} files=${result.story_artifacts.file_count}`,
    '',
    '| 区分 | changed lines | tokens 推定 | 比率 |',
    '| --- | ---: | ---: | ---: |',
    ...result.cost_breakdown.buckets.map((bucket) => (
      `| ${bucket.label} | ${bucket.changed_lines} | ${bucket.estimated_tokens ?? '未確認'} | ${bucket.ratio === null ? '未確認' : `${bucket.ratio}%`} |`
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
  const sessionsRoot = path.join(codexHome, 'sessions');
  const direct = await findFileByNameFragment(sessionsRoot, sessionId, 7);
  if (direct) return direct;
  return null;
}

async function findFileByNameFragment(root, fragment, maxDepth, depth = 0) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.includes(fragment) && SESSION_FILE_RE.test(entry.name)) return fullPath;
  }
  if (depth >= maxDepth) return null;
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const found = await findFileByNameFragment(path.join(root, entry.name), fragment, maxDepth, depth + 1);
    if (found) return found;
  }
  return null;
}

async function parseCodexSessionJsonl(filePath, { sessionId, windowStart, windowEnd } = {}) {
  const text = await readFile(filePath, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const startMs = normalizeTimeMs(windowStart);
  const endMs = normalizeTimeMs(windowEnd);
  const tokenEvents = [];
  const taskStartedEvents = [];
  const finalAnswerEvents = [];
  let cwd = null;
  let firstEventAt = null;
  let lastEventAt = null;

  for (let index = 0; index < lines.length; index += 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    const eventAt = normalizeTimeMs(entry.timestamp);
    if (eventAt !== null) {
      firstEventAt ??= eventAt;
      lastEventAt = eventAt;
    }
    if (entry.type === 'session_meta') {
      cwd = entry.payload?.cwd ?? cwd;
    }
    if (!isInsideWindow(eventAt, startMs, endMs)) continue;
    if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
      const usage = entry.payload?.info?.total_token_usage;
      if (usage) tokenEvents.push({ line: index + 1, timestamp_ms: eventAt, usage });
    }
    if (entry.type === 'event_msg' && entry.payload?.type === 'task_started') {
      taskStartedEvents.push({ line: index + 1, timestamp_ms: eventAt, started_at: entry.payload?.started_at });
    }
    if (entry.type === 'event_msg' && entry.payload?.type === 'final_answer') {
      finalAnswerEvents.push({ line: index + 1, timestamp_ms: eventAt });
    }
  }

  const firstToken = tokenEvents[0] ?? null;
  const lastToken = tokenEvents.at(-1) ?? null;
  const windowStartedAt = startMs ?? taskStartedEvents[0]?.timestamp_ms ?? firstToken?.timestamp_ms ?? firstEventAt;
  const windowFinishedAt = endMs ?? finalAnswerEvents.at(-1)?.timestamp_ms ?? lastToken?.timestamp_ms ?? lastEventAt;
  const tokenDelta = firstToken && lastToken
    ? subtractUsage(lastToken.usage, firstToken.usage)
    : null;

  return {
    status: 'available',
    source_path: filePath,
    cwd,
    line_count: lines.length,
    window: {
      session_id: sessionId,
      requested_start: windowStart ?? null,
      requested_end: windowEnd ?? null,
      first_token_line: firstToken?.line ?? null,
      last_token_line: lastToken?.line ?? null,
      token_event_count: tokenEvents.length,
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
        source_path: filePath,
        first_token_line: firstToken.line,
        last_token_line: lastToken.line,
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
      window: { session_id: sessionId, source_path: filePath },
      reason: 'no token_count events were found in the selected session window'
    },
    elapsed_time_accounting: windowStartedAt !== null && windowFinishedAt !== null ? {
      status: finalAnswerEvents.length > 0 || windowEnd ? 'available' : 'partial',
      elapsed_ms: Math.max(0, windowFinishedAt - windowStartedAt),
      started_at: new Date(windowStartedAt).toISOString(),
      finished_at: new Date(windowFinishedAt).toISOString(),
      source: 'codex-session-jsonl',
      window: { session_id: sessionId, source_path: filePath },
      reason: finalAnswerEvents.length > 0 || windowEnd ? null : 'no final_answer event in selected window; used last observed event timestamp'
    } : {
      status: 'unavailable',
      elapsed_ms: null,
      started_at: null,
      finished_at: null,
      source: 'codex-session-jsonl',
      window: { session_id: sessionId, source_path: filePath },
      reason: 'no usable timestamps were found in the selected session window'
    }
  };
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
    }
  };
}

async function collectStoryArtifactInventory(repoRoot, storyId) {
  const artifactRoot = path.join(getWorkspaceDir(repoRoot), 'pr', storyId);
  const files = await collectTextFiles(artifactRoot);
  let totalLines = 0;
  const artifacts = [];
  for (const filePath of files) {
    const text = await readFile(filePath, 'utf8');
    const lineCount = countTextLines(text);
    totalLines += lineCount;
    artifacts.push({
      path: toWorkspaceRelative(repoRoot, filePath),
      lines: lineCount
    });
  }
  artifacts.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  return {
    status: files.length > 0 ? 'available' : 'unavailable',
    root: toWorkspaceRelative(repoRoot, artifactRoot),
    file_count: files.length,
    total_lines: totalLines,
    largest_files: artifacts.slice(0, 10),
    pr_prepare: await readPrPrepareSummary(repoRoot, storyId),
    verification: await readVerificationSummary(repoRoot, storyId)
  };
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

async function readPrPrepareSummary(repoRoot, storyId) {
  const candidates = [
    path.join(getWorkspaceDir(repoRoot), 'pr', storyId, 'pr-prepare-current.json'),
    path.join(getWorkspaceDir(repoRoot), 'pr', storyId, 'pr-prepare.json')
  ];
  for (const filePath of candidates) {
    const parsed = await readJsonIfExists(filePath);
    if (!parsed) continue;
    return {
      status: 'available',
      source: toWorkspaceRelative(repoRoot, filePath),
      overall_status: parsed.gate_status?.overall_status ?? parsed.overall_status ?? null,
      ready_for_pr_create: parsed.gate_status?.ready_for_pr_create ?? parsed.ready_for_pr_create ?? null,
      critical_unresolved_gate_count: parsed.gate_status?.critical_unresolved_gates?.length ?? null
    };
  }
  return { status: 'unavailable', reason: 'pr-prepare artifact was not found' };
}

async function readVerificationSummary(repoRoot, storyId) {
  const filePath = path.join(getWorkspaceDir(repoRoot), 'pr', storyId, 'verification-evidence.json');
  const parsed = await readJsonIfExists(filePath);
  if (!parsed) return { status: 'unavailable', reason: 'verification-evidence artifact was not found' };
  const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
  return {
    status: 'available',
    source: toWorkspaceRelative(repoRoot, filePath),
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

function buildAuditReadiness({ session, processMetadata, artifactInventory, git }) {
  const blockers = [
    session.token_accounting.status !== 'available' ? 'token_count_unavailable' : null,
    session.elapsed_time_accounting.status === 'unavailable' ? 'elapsed_time_unavailable' : null,
    !processMetadata ? 'process_manager_cwd_unavailable' : null,
    artifactInventory.status !== 'available' ? 'story_artifacts_unavailable' : null,
    git.changed_lines.status !== 'available' ? 'changed_lines_unavailable' : null
  ].filter(Boolean);
  return {
    status: blockers.length === 0 ? 'ready' : 'partial',
    blockers
  };
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
