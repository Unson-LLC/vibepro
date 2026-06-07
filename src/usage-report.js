import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveHumanOutputLanguage } from './language.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

export async function createUsageReport(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const workspaceDir = getWorkspaceDir(root);
  const since = parseSince(options.since);
  const language = await resolveHumanOutputLanguage(root, { language: options.language }).catch(() => options.language ?? 'ja');
  const prArtifacts = await collectPrArtifacts(root, workspaceDir, since);
  const reviewArtifacts = await collectReviewArtifacts(root, workspaceDir, since);
  const executionArtifacts = await collectExecutionArtifacts(root, workspaceDir, since);
  const logs = await collectUsageLogs(root, options);
  const storyMap = new Map();
  for (const artifact of prArtifacts) {
    const story = ensureStoryUsage(storyMap, artifact.story_id);
    story.artifacts.push(artifact.path);
    if (artifact.kind === 'pr_prepare') {
      story.prepared = true;
      story.prepare_count += 1;
      story.ready_for_pr_create ||= artifact.data?.gate_status?.ready_for_pr_create === true;
      story.blocked ||= artifact.data?.gate_status?.ready_for_pr_create === false;
      story.waiver_required ||= artifact.data?.gate_status?.execution_gate?.waiver_required === true;
      story.latest_gate_status = artifact.data?.gate_status?.overall_status ?? story.latest_gate_status;
    }
    if (artifact.kind === 'pr_create') {
      story.pr_create_count += 1;
      story.pr_created ||= Boolean(artifact.data?.pr_url) || artifact.data?.status === 'created';
      story.waiver_required ||= artifact.data?.gate_override?.allowed === true;
      story.latest_pr_url = artifact.data?.pr_url ?? story.latest_pr_url;
    }
    if (artifact.kind === 'gate_dag') collectGateMetrics(artifact.data, artifact.story_id, storyMap);
  }
  for (const artifact of reviewArtifacts) {
    const story = ensureStoryUsage(storyMap, artifact.story_id);
    story.artifacts.push(artifact.path);
    story.agent_review.required_role_count += artifact.data?.roles?.length ?? 0;
    story.agent_review.pass_count += artifact.data?.pass_count ?? 0;
    story.agent_review.block_count += artifact.data?.block_count ?? 0;
    story.agent_review.stale_count += artifact.data?.stale_count ?? 0;
    story.agent_review.timeout_count += artifact.data?.lifecycle?.timed_out_count ?? 0;
    story.agent_review.replaced_count += artifact.data?.lifecycle?.replaced_count ?? 0;
  }
  for (const artifact of executionArtifacts) {
    const story = ensureStoryUsage(storyMap, artifact.story_id);
    story.artifacts.push(artifact.path);
    story.execution_state_count += 1;
    story.blocked ||= artifact.data?.completion_status === 'blocked';
    story.latest_execution_status = artifact.data?.completion_status ?? story.latest_execution_status;
  }
  for (const finding of logs.raw_pr_create_mentions) {
    const story = ensureStoryUsage(storyMap, finding.story_id ?? 'unknown-log-story');
    story.raw_pr_bypass_suspected = true;
    story.log_findings.push(finding);
  }
  const stories = [...storyMap.values()].sort((a, b) => a.story_id.localeCompare(b.story_id));
  const gate_metrics = buildGateMetrics(prArtifacts);
  const agent_review = buildAgentReviewMetrics(stories);
  const value_signals = buildValueSignals(stories);
  const artifactCounts = {
    pr: prArtifacts.length,
    review: reviewArtifacts.length,
    execution: executionArtifacts.length,
    logs: logs.files.length
  };
  const artifact_source_hints = await buildArtifactSourceHints(root, since, artifactCounts);
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    output: { language },
    since: since ? since.toISOString() : null,
    artifact_counts: artifactCounts,
    artifact_source_hints,
    stories,
    gate_metrics,
    agent_review,
    value_signals,
    log_signals: logs
  };
}

export function renderUsageReport(report) {
  const language = report.output?.language ?? 'ja';
  const storyRows = report.stories.length
    ? report.stories.map((story) => (
        `- ${story.story_id}: prepared=${story.prepared} blocked=${story.blocked} ready=${story.ready_for_pr_create} pr_created=${story.pr_created} waiver_required=${story.waiver_required} raw_pr_bypass_suspected=${story.raw_pr_bypass_suspected} stale_evidence=${story.stale_evidence} story_source_mismatch=${story.story_source_mismatch}`
      )).join('\n')
    : '- none';
  const gateRows = report.gate_metrics.length
    ? report.gate_metrics.map((gate) => (
        `- ${gate.gate_id}: block=${gate.block_count} waiver=${gate.waiver_count} critical_unresolved=${gate.critical_unresolved_count}`
      )).join('\n')
    : '- none';
  const reviewRows = report.agent_review.by_story.length
    ? report.agent_review.by_story.map((item) => (
        `- ${item.story_id}: required=${item.required_role_count} pass=${item.pass_count} block=${item.block_count} timeout=${item.timeout_count} replaced=${item.replaced_count} stale=${item.stale_count}`
      )).join('\n')
    : '- none';
  const valueSignals = report.value_signals ?? {};
  const valueRows = [
    `- waiver_required: ${valueSignals.waiver_required_story_count ?? 0}/${valueSignals.story_count ?? 0} (${formatRate(valueSignals.waiver_required_rate)})`,
    `- stale_evidence: ${valueSignals.stale_evidence_story_count ?? 0}/${valueSignals.story_count ?? 0} (${formatRate(valueSignals.stale_evidence_rate)})`,
    `- story_source_mismatch: ${valueSignals.story_source_mismatch_story_count ?? 0}/${valueSignals.story_count ?? 0} (${formatRate(valueSignals.story_source_mismatch_rate)})`
  ].join('\n');
  const artifactHintRows = renderArtifactSourceHints(report);
  if (language === 'en') {
    return `# VibePro Usage Report

- since: ${report.since ?? 'all'}
- stories: ${report.stories.length}
- artifacts: pr=${report.artifact_counts.pr} review=${report.artifact_counts.review} execution=${report.artifact_counts.execution} logs=${report.artifact_counts.logs}
${artifactHintRows}

## Stories

${storyRows}

## Gates

${gateRows}

## Agent Review

${reviewRows}

## Value Signals

${valueRows}

## Log Signals

- raw gh pr create mentions: ${report.log_signals.raw_pr_create_mentions.length}
- VibePro command mentions: ${report.log_signals.vibepro_command_mentions.length}
`;
  }
  return `# VibePro利用状況レポート

- 対象期間: ${report.since ?? '全期間'}
- Story数: ${report.stories.length}
- artifact数: pr=${report.artifact_counts.pr} review=${report.artifact_counts.review} execution=${report.artifact_counts.execution} logs=${report.artifact_counts.logs}
${artifactHintRows}

## Story別

${storyRows}

## Gate別

${gateRows}

## Agent Review

${reviewRows}

## Value Signals

${valueRows}

## ログ補助シグナル

- raw gh pr create mentions: ${report.log_signals.raw_pr_create_mentions.length}
- VibePro command mentions: ${report.log_signals.vibepro_command_mentions.length}
`;
}

function ensureStoryUsage(storyMap, storyId) {
  const key = storyId || 'unknown';
  if (!storyMap.has(key)) {
    storyMap.set(key, {
      story_id: key,
      prepared: false,
      blocked: false,
      ready_for_pr_create: false,
      pr_created: false,
      waiver_required: false,
      raw_pr_bypass_suspected: false,
      stale_evidence: false,
      story_source_mismatch: false,
      prepare_count: 0,
      pr_create_count: 0,
      execution_state_count: 0,
      latest_gate_status: null,
      latest_execution_status: null,
      latest_pr_url: null,
      artifacts: [],
      log_findings: [],
      agent_review: {
        required_role_count: 0,
        pass_count: 0,
        block_count: 0,
        timeout_count: 0,
        replaced_count: 0,
        stale_count: 0
      },
      gate_metrics: {}
    });
  }
  return storyMap.get(key);
}

async function collectPrArtifacts(root, workspaceDir, since) {
  const prDir = path.join(workspaceDir, 'pr');
  const storyDirs = await safeReaddir(prDir);
  const artifacts = [];
  for (const storyId of storyDirs) {
    const storyDir = path.join(prDir, storyId);
    for (const [file, kind] of [['pr-prepare.json', 'pr_prepare'], ['pr-create.json', 'pr_create'], ['gate-dag.json', 'gate_dag']]) {
      const filePath = path.join(storyDir, file);
      const data = await readJsonIfExists(filePath);
      if (!data || !isWithinSince(data.created_at ?? data.generated_at ?? data.updated_at, since)) continue;
      artifacts.push({ kind, story_id: data.story?.story_id ?? data.story_id ?? storyId, path: toWorkspaceRelative(root, filePath), data });
    }
  }
  return artifacts;
}

async function collectReviewArtifacts(root, workspaceDir, since) {
  const reviewDir = path.join(workspaceDir, 'reviews');
  const artifacts = [];
  for (const storyId of await safeReaddir(reviewDir)) {
    for (const stage of await safeReaddir(path.join(reviewDir, storyId))) {
      const filePath = path.join(reviewDir, storyId, stage, 'review-summary.json');
      const data = await readJsonIfExists(filePath);
      if (!data || !isWithinSince(data.updated_at, since)) continue;
      artifacts.push({ kind: 'review_summary', story_id: data.story_id ?? storyId, path: toWorkspaceRelative(root, filePath), data });
    }
  }
  return artifacts;
}

async function collectExecutionArtifacts(root, workspaceDir, since) {
  const executionDir = path.join(workspaceDir, 'executions');
  const artifacts = [];
  for (const storyId of await safeReaddir(executionDir)) {
    const filePath = path.join(executionDir, storyId, 'state.json');
    const data = await readJsonIfExists(filePath);
    if (!data || !isWithinSince(data.updated_at ?? data.started_at, since)) continue;
    artifacts.push({ kind: 'execution_state', story_id: data.story_id ?? storyId, path: toWorkspaceRelative(root, filePath), data });
  }
  return artifacts;
}

async function collectUsageLogs(root, options = {}) {
  const files = [...(options.logs ?? []), ...(options.codexLogs ?? []), ...(options.claudeLogs ?? [])]
    .map((file) => path.resolve(root, file));
  const rawMentions = [];
  const vibeproMentions = [];
  for (const file of files) {
    const text = await readTextIfExists(file);
    if (!text) continue;
    const relative = toWorkspaceRelative(root, file);
    let latestStoryId = inferStoryId(text);
    for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
      const lineStoryId = inferStoryId(line);
      if (lineStoryId) latestStoryId = lineStoryId;
      const rawMatches = [...line.matchAll(/(?:^|[^A-Za-z0-9_-])(gh\s+pr\s+create)(?=$|[^A-Za-z0-9_-])/g)];
      const vibeproMatches = [...line.matchAll(/(?:^|[^A-Za-z0-9_-])(vibepro\s+[a-z][^`]*)/g)];
      for (const _match of rawMatches) {
        rawMentions.push({
          file: relative,
          line: lineIndex + 1,
          story_id: lineStoryId ?? latestStoryId,
          signal: 'raw_gh_pr_create'
        });
      }
      for (const match of vibeproMatches) {
        vibeproMentions.push({
          file: relative,
          line: lineIndex + 1,
          story_id: lineStoryId ?? latestStoryId,
          command: normalizeLogCommand(match[1])
        });
      }
    }
  }
  return {
    files: files.map((file) => toWorkspaceRelative(root, file)),
    raw_pr_create_mentions: rawMentions,
    vibepro_command_mentions: vibeproMentions
  };
}

async function buildArtifactSourceHints(root, since, artifactCounts) {
  const localArtifactCount = artifactCounts.pr + artifactCounts.review + artifactCounts.execution;
  if (localArtifactCount > 0) {
    return {
      status: 'not_applicable',
      reason: 'current checkout contains VibePro artifacts',
      current_repo_root: root,
      current_workspace_dir: getWorkspaceDir(root),
      candidates: []
    };
  }

  const worktrees = await listGitWorktrees(root);
  if (worktrees.length === 0) {
    return {
      status: 'no_git_worktrees_found',
      reason: 'git worktree list did not return alternative checkouts',
      current_repo_root: root,
      current_workspace_dir: getWorkspaceDir(root),
      candidates: []
    };
  }

  const current = await canonicalPath(root);
  const candidates = [];
  for (const worktree of worktrees) {
    const candidateRoot = path.resolve(worktree.path);
    const candidateCanonical = await canonicalPath(candidateRoot);
    if (candidateCanonical && current && candidateCanonical === current) continue;
    if (worktree.prunable) continue;

    const workspaceDir = getWorkspaceDir(candidateRoot);
    const [prArtifacts, reviewArtifacts, executionArtifacts] = await Promise.all([
      collectPrArtifacts(candidateRoot, workspaceDir, since),
      collectReviewArtifacts(candidateRoot, workspaceDir, since),
      collectExecutionArtifacts(candidateRoot, workspaceDir, since)
    ]);
    const counts = {
      pr: prArtifacts.length,
      review: reviewArtifacts.length,
      execution: executionArtifacts.length
    };
    if (counts.pr + counts.review + counts.execution === 0) continue;
    candidates.push({
      repo_root: candidateRoot,
      workspace_dir: workspaceDir,
      branch: worktree.branch,
      head: worktree.head,
      artifact_counts: counts
    });
  }

  candidates.sort((a, b) => (
    (b.artifact_counts.pr + b.artifact_counts.review + b.artifact_counts.execution)
    - (a.artifact_counts.pr + a.artifact_counts.review + a.artifact_counts.execution)
  ));

  return {
    status: candidates.length > 0 ? 'possible_worktree_false_negative' : 'no_alternative_artifacts_found',
    reason: candidates.length > 0
      ? 'current checkout has no VibePro artifacts, but another git worktree for the same repository does'
      : 'current checkout has no VibePro artifacts and no alternative git worktree with artifacts was found',
    current_repo_root: root,
    current_workspace_dir: getWorkspaceDir(root),
    candidates
  };
}

async function listGitWorktrees(root) {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf8'
    });
    return parseGitWorktreePorcelain(stdout);
  } catch (_error) {
    return [];
  }
}

function parseGitWorktreePorcelain(output) {
  const records = [];
  let record = null;
  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (!line.trim()) {
      if (record) records.push(record);
      record = null;
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (record) records.push(record);
      record = {
        path: line.slice('worktree '.length),
        head: null,
        branch: null,
        prunable: false
      };
      continue;
    }
    if (!record) continue;
    if (line.startsWith('HEAD ')) record.head = line.slice('HEAD '.length);
    if (line.startsWith('branch ')) record.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    if (line.startsWith('prunable')) record.prunable = true;
  }
  if (record) records.push(record);
  return records.filter((item) => item.path);
}

async function canonicalPath(filePath) {
  try {
    return path.resolve(await realpath(filePath));
  } catch (_error) {
    return null;
  }
}

function renderArtifactSourceHints(report) {
  const hints = report.artifact_source_hints;
  if (!hints || hints.status !== 'possible_worktree_false_negative' || hints.candidates.length === 0) return '';
  const rows = hints.candidates.slice(0, 3).map((candidate) => (
    `- ${candidate.repo_root}: pr=${candidate.artifact_counts.pr} review=${candidate.artifact_counts.review} execution=${candidate.artifact_counts.execution}`
  )).join('\n');
  if (report.output?.language === 'en') {
    return `
- artifact source warning: this checkout has no VibePro artifacts, but another git worktree does. Run the report against one of these roots:
${rows}`;
  }
  return `
- artifact source warning: この checkout には VibePro artifacts がありませんが、同じ git repo の別 worktree には存在します。以下の root で report を再実行してください:
${rows}`;
}

function normalizeLogCommand(value) {
  return String(value ?? '')
    .trim()
    .replace(/[`"'）)】\].,;:、。]+$/g, '')
    .trim();
}

function buildGateMetrics(prArtifacts) {
  const metrics = new Map();
  const ensure = (gateId) => {
    if (!metrics.has(gateId)) metrics.set(gateId, { gate_id: gateId, block_count: 0, waiver_count: 0, critical_unresolved_count: 0 });
    return metrics.get(gateId);
  };
  for (const artifact of prArtifacts) {
    if (artifact.kind === 'gate_dag') {
      for (const node of artifact.data?.nodes ?? []) {
        const metric = ensure(node.id ?? 'unknown_gate');
        if (['block', 'needs_evidence', 'needs_review', 'failed'].includes(node.status)) metric.block_count += 1;
        if (node.status === 'bypassed') metric.waiver_count += 1;
      }
    }
    if (artifact.kind === 'pr_prepare') {
      for (const gate of artifact.data?.gate_status?.critical_unresolved_gates ?? []) {
        ensure(gate.id ?? 'unknown_gate').critical_unresolved_count += 1;
      }
    }
    if (artifact.kind === 'pr_create' && artifact.data?.gate_override?.allowed) {
      for (const gate of artifact.data?.gate_override?.unresolved_gates ?? []) {
        ensure(gate.id ?? 'unknown_gate').waiver_count += 1;
      }
    }
  }
  return [...metrics.values()].sort((a, b) => a.gate_id.localeCompare(b.gate_id));
}

function collectGateMetrics(gateDag, storyId, storyMap) {
  const story = ensureStoryUsage(storyMap, storyId);
  for (const node of gateDag?.nodes ?? []) {
    const gateId = node.id ?? 'unknown_gate';
    const metric = story.gate_metrics[gateId] ?? { block_count: 0, waiver_count: 0, critical_unresolved_count: 0 };
    if (['block', 'needs_evidence', 'needs_review', 'failed'].includes(node.status)) metric.block_count += 1;
    if (node.status === 'bypassed') metric.waiver_count += 1;
    story.gate_metrics[gateId] = metric;
    if (node.status === 'stale_evidence') story.stale_evidence = true;
    if (node.status === 'story_source_mismatch') story.story_source_mismatch = true;
  }
}

function buildValueSignals(stories) {
  const storyCount = stories.length;
  const waiverRequiredCount = stories.filter((story) => story.waiver_required).length;
  const staleEvidenceCount = stories.filter((story) => story.stale_evidence).length;
  const storySourceMismatchCount = stories.filter((story) => story.story_source_mismatch).length;
  return {
    story_count: storyCount,
    waiver_required_story_count: waiverRequiredCount,
    stale_evidence_story_count: staleEvidenceCount,
    story_source_mismatch_story_count: storySourceMismatchCount,
    waiver_required_rate: calculateRate(waiverRequiredCount, storyCount),
    stale_evidence_rate: calculateRate(staleEvidenceCount, storyCount),
    story_source_mismatch_rate: calculateRate(storySourceMismatchCount, storyCount)
  };
}

function calculateRate(count, total) {
  if (!total) return null;
  return Number((count / total).toFixed(4));
}

function formatRate(value) {
  if (typeof value !== 'number') return '-';
  return `${Math.round(value * 100)}%`;
}

function buildAgentReviewMetrics(stories) {
  return {
    totals: stories.reduce((totals, story) => ({
      required_role_count: totals.required_role_count + story.agent_review.required_role_count,
      pass_count: totals.pass_count + story.agent_review.pass_count,
      block_count: totals.block_count + story.agent_review.block_count,
      timeout_count: totals.timeout_count + story.agent_review.timeout_count,
      replaced_count: totals.replaced_count + story.agent_review.replaced_count,
      stale_count: totals.stale_count + story.agent_review.stale_count
    }), { required_role_count: 0, pass_count: 0, block_count: 0, timeout_count: 0, replaced_count: 0, stale_count: 0 }),
    by_story: stories.map((story) => ({ story_id: story.story_id, ...story.agent_review }))
  };
}

async function safeReaddir(dir) {
  try {
    const entries = await readdir(dir);
    const dirs = [];
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if ((await stat(full)).isDirectory()) dirs.push(entry);
    }
    return dirs.sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function parseSince(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`usage report --since is not a valid date: ${value}`);
  return parsed;
}

function isWithinSince(value, since) {
  if (!since || !value) return true;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed >= since;
}

function inferStoryId(text) {
  const match = text.match(/story-[a-z0-9][a-z0-9-]+/i);
  return match ? match[0] : null;
}
