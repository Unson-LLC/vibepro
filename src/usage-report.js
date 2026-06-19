import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { collectCanonicalAuditArtifacts, mergeArtifactsPreferLocal } from './canonical-audit.js';
import { resolveHumanOutputLanguage } from './language.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);
const ROI_AGENT_SYSTEMS = new Set(['codex', 'claude_code']);
const ROI_DISPOSITIONS = ['accepted', 'rejected', 'duplicate', 'deferred', 'false_positive'];

export async function createUsageReport(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const workspaceDir = getWorkspaceDir(root);
  const since = parseSince(options.since);
  const language = await resolveHumanOutputLanguage(root, { language: options.language }).catch(() => options.language ?? 'ja');
  const localPrArtifacts = await collectPrArtifacts(root, workspaceDir, since);
  const localReviewArtifacts = await collectReviewArtifacts(root, workspaceDir, since);
  const canonicalArtifacts = await collectCanonicalAuditArtifacts(root, since);
  const prArtifacts = mergeArtifactsPreferLocal(localPrArtifacts, canonicalArtifacts.prArtifacts);
  const reviewArtifacts = mergeArtifactsPreferLocal(localReviewArtifacts, canonicalArtifacts.reviewArtifacts);
  const executionArtifacts = await collectExecutionArtifacts(root, workspaceDir, since);
  const storyDocs = await collectStoryDocs(root, since);
  const logs = await collectUsageLogs(root, options);
  const storyMap = new Map();
  for (const doc of storyDocs) {
    const story = ensureStoryUsage(storyMap, doc.story_id);
    story.story_doc_present = true;
    story.story_doc_path = doc.path;
    story.story_status = doc.status ?? story.story_status;
    story.artifacts.push(doc.path);
  }
  for (const artifact of prArtifacts) {
    const story = ensureStoryUsage(storyMap, artifact.story_id);
    story.artifacts.push(artifact.path);
    recordStoryArtifactSource(story, artifact);
    if (artifact.kind === 'pr_prepare') {
      story.prepared = true;
      story.prepare_count += 1;
      story.ready_for_pr_create ||= artifact.data?.gate_status?.ready_for_pr_create === true;
      story.fast_lane ||= artifact.data?.gate_status?.fast_lane === true;
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
    if (artifact.kind === 'pr_merge') {
      story.pr_merge_count += 1;
      story.latest_merge_status = artifact.data?.status ?? story.latest_merge_status;
      story.latest_merged_at = artifact.data?.merged_at ?? story.latest_merged_at;
    }
    if (artifact.kind === 'gate_dag') collectGateMetrics(artifact.data, artifact.story_id, storyMap);
    if (artifact.kind === 'traceability') {
      story.traceability_lifecycle = artifact.data?.lifecycle ?? story.traceability_lifecycle;
    }
    if (artifact.kind === 'verification_evidence') {
      story.verification_observation_missing ||= (artifact.data?.commands ?? []).some((command) => (
        ['pass', 'passed', 'success', 'ok'].includes(command?.status)
        && command?.observation_check?.status === 'missing'
      ));
    }
  }
  for (const artifact of reviewArtifacts) {
    const story = ensureStoryUsage(storyMap, artifact.story_id);
    story.artifacts.push(artifact.path);
    if (artifact.kind !== 'review_summary') continue;
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
  evaluateTraceabilityGaps(storyMap, { prArtifacts, reviewArtifacts });
  const stories = [...storyMap.values()].sort((a, b) => a.story_id.localeCompare(b.story_id));
  const gate_metrics = buildGateMetrics(prArtifacts);
  const agent_review = buildAgentReviewMetrics(stories);
  const subagent_roi = options.subagentRoi ? buildSubagentRoiMetrics(reviewArtifacts) : null;
  const value_signals = buildValueSignals(stories);
  const artifactCounts = {
    pr: countRealPrArtifacts(prArtifacts),
    traceability: prArtifacts.length - countRealPrArtifacts(prArtifacts),
    review: reviewArtifacts.length,
    canonical_audit: canonicalArtifacts.bundleArtifacts.length,
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
    ...(subagent_roi ? { subagent_roi } : {}),
    value_signals,
    log_signals: logs
  };
}

export function renderUsageReport(report) {
  const language = report.output?.language ?? 'ja';
  const storyRows = report.stories.length
    ? report.stories.map((story) => (
        `- ${story.story_id}: prepared=${story.prepared} blocked=${story.blocked} ready=${story.ready_for_pr_create} pr_created=${story.pr_created} waiver_required=${story.waiver_required} raw_pr_bypass_suspected=${story.raw_pr_bypass_suspected} stale_evidence=${story.stale_evidence} story_source_mismatch=${story.story_source_mismatch} traceability=${story.traceability_resolution?.status ?? 'unknown'} artifact_source=${formatArtifactSources(story.artifact_sources)}`
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
  const subagentRoiRows = renderSubagentRoiRows(report);
  const valueSignals = report.value_signals ?? {};
  const valueRows = [
    `- waiver_required: ${valueSignals.waiver_required_story_count ?? 0}/${valueSignals.story_count ?? 0} (${formatRate(valueSignals.waiver_required_rate)})`,
    `- stale_evidence: ${valueSignals.stale_evidence_story_count ?? 0}/${valueSignals.story_count ?? 0} (${formatRate(valueSignals.stale_evidence_rate)})`,
    `- story_source_mismatch: ${valueSignals.story_source_mismatch_story_count ?? 0}/${valueSignals.story_count ?? 0} (${formatRate(valueSignals.story_source_mismatch_rate)})`,
    `- traceability_gaps: ${valueSignals.traceability_gap_count ?? 0}/${valueSignals.story_count ?? 0} (${formatRate(valueSignals.traceability_gap_rate)})`,
    `- actual_missing_traceability_gaps: ${valueSignals.actual_missing_traceability_gap_count ?? 0}/${valueSignals.story_count ?? 0}`,
    `- alternate_source_resolved_traceability: ${valueSignals.alternate_source_resolved_traceability_count ?? 0}/${valueSignals.story_count ?? 0}`,
    `- declared_unstarted: ${valueSignals.declared_unstarted_story_count ?? 0}/${valueSignals.story_count ?? 0}`,
    `- verification_observation_missing: ${valueSignals.verification_observation_missing_story_count ?? 0}/${valueSignals.story_count ?? 0}`,
    `- fast_lane: ${valueSignals.fast_lane_story_count ?? 0}/${valueSignals.story_count ?? 0}`,
    `- merged_without_vibepro_evidence: ${valueSignals.merged_without_vibepro_evidence_story_count ?? 0}/${valueSignals.story_count ?? 0}`,
    `- evidence_in_other_worktree: ${valueSignals.evidence_in_other_worktree_story_count ?? 0}/${valueSignals.story_count ?? 0}`
  ].join('\n');
  const traceabilityRows = renderTraceabilityGaps(report);
  const artifactHintRows = renderArtifactSourceHints(report);
  if (language === 'en') {
    return `# VibePro Usage Report

- since: ${report.since ?? 'all'}
- stories: ${report.stories.length}
- artifacts: pr=${report.artifact_counts.pr} review=${report.artifact_counts.review} canonical_audit=${report.artifact_counts.canonical_audit ?? 0} execution=${report.artifact_counts.execution} logs=${report.artifact_counts.logs}
${artifactHintRows}

## Stories

${storyRows}

## Gates

${gateRows}

## Agent Review

${reviewRows}
${subagentRoiRows}

## Value Signals

${valueRows}

## Traceability Gaps

${traceabilityRows}

## Log Signals

- raw gh pr create mentions: ${report.log_signals.raw_pr_create_mentions.length}
- VibePro command mentions: ${report.log_signals.vibepro_command_mentions.length}
- subagent activity mentions: ${report.log_signals.subagent_activity_mentions?.length ?? 0}
`;
  }
  return `# VibePro利用状況レポート

- 対象期間: ${report.since ?? '全期間'}
- Story数: ${report.stories.length}
- artifact数: pr=${report.artifact_counts.pr} review=${report.artifact_counts.review} canonical_audit=${report.artifact_counts.canonical_audit ?? 0} execution=${report.artifact_counts.execution} logs=${report.artifact_counts.logs}
${artifactHintRows}

## Story別

${storyRows}

## Gate別

${gateRows}

## Agent Review

${reviewRows}
${subagentRoiRows}

## Value Signals

${valueRows}

## Traceability Gaps

${traceabilityRows}

## ログ補助シグナル

- raw gh pr create mentions: ${report.log_signals.raw_pr_create_mentions.length}
- VibePro command mentions: ${report.log_signals.vibepro_command_mentions.length}
- subagent activity mentions: ${report.log_signals.subagent_activity_mentions?.length ?? 0}
`;
}

function ensureStoryUsage(storyMap, storyId) {
  const key = storyId || 'unknown';
  if (!storyMap.has(key)) {
    storyMap.set(key, {
      story_id: key,
      story_doc_present: false,
      story_doc_path: null,
      story_status: null,
      prepared: false,
      blocked: false,
      ready_for_pr_create: false,
      pr_created: false,
      pr_merge_count: 0,
      waiver_required: false,
      raw_pr_bypass_suspected: false,
      stale_evidence: false,
      story_source_mismatch: false,
      traceability_lifecycle: null,
      declared_unstarted: false,
      verification_observation_missing: false,
      fast_lane: false,
      merged_without_vibepro_evidence: false,
      evidence_in_other_worktree: false,
      artifact_sources: [],
      traceability_resolution: {
        status: 'unknown',
        artifact_source: null,
        artifact: null
      },
      traceability_gaps: [],
      prepare_count: 0,
      pr_create_count: 0,
      execution_state_count: 0,
      latest_gate_status: null,
      latest_execution_status: null,
      latest_pr_url: null,
      latest_merge_status: null,
      latest_merged_at: null,
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
    for (const [file, kind] of [['pr-prepare.json', 'pr_prepare'], ['pr-create.json', 'pr_create'], ['gate-dag.json', 'gate_dag'], ['pr-merge.json', 'pr_merge'], ['traceability.json', 'traceability'], ['verification-evidence.json', 'verification_evidence']]) {
      const filePath = path.join(storyDir, file);
      const data = await readJsonIfExists(filePath);
      if (!data || !isWithinSince(data.created_at ?? data.generated_at ?? data.updated_at ?? data.merged_at, since)) continue;
      artifacts.push({ kind, story_id: data.story?.story_id ?? data.story_id ?? storyId, path: toWorkspaceRelative(root, filePath), data });
    }
  }
  return artifacts;
}

async function collectStoryDocs(root, since) {
  const storyRoot = path.join(root, 'docs', 'management', 'stories');
  const files = await listMarkdownFiles(storyRoot);
  const docs = [];
  for (const filePath of files) {
    const text = await readTextIfExists(filePath);
    const metadata = parseStoryDocMetadata(text, filePath);
    if (!metadata.story_id || !isWithinSince(metadata.updated_at ?? metadata.created_at, since)) continue;
    docs.push({
      ...metadata,
      path: toWorkspaceRelative(root, filePath)
    });
  }
  return docs;
}

async function collectReviewArtifacts(root, workspaceDir, since) {
  const reviewDir = path.join(workspaceDir, 'reviews');
  const artifacts = [];
  for (const storyId of await safeReaddir(reviewDir)) {
    for (const stage of await safeReaddir(path.join(reviewDir, storyId))) {
      const stageDir = path.join(reviewDir, storyId, stage);
      const filePath = path.join(stageDir, 'review-summary.json');
      const data = await readJsonIfExists(filePath);
      if (data && isWithinSince(data.updated_at, since)) {
        artifacts.push({ kind: 'review_summary', story_id: data.story_id ?? storyId, path: toWorkspaceRelative(root, filePath), data });
      }
      for (const entry of await safeReaddirEntries(stageDir)) {
        if (!entry.isFile() || !/^review-result-.+\.json$/.test(entry.name)) continue;
        const resultPath = path.join(stageDir, entry.name);
        const result = await readJsonIfExists(resultPath);
        if (!result || !isWithinSince(result.recorded_at ?? result.updated_at ?? result.created_at, since)) continue;
        artifacts.push({ kind: 'review_result', story_id: result.story_id ?? storyId, path: toWorkspaceRelative(root, resultPath), data: result });
      }
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
  const subagentActivityMentions = [];
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
      const subagentActivity = parseSubagentActivityLine(line);
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
      if (subagentActivity) {
        subagentActivityMentions.push({
          file: relative,
          line: lineIndex + 1,
          story_id: lineStoryId ?? latestStoryId,
          ...subagentActivity
        });
      }
    }
  }
  return {
    files: files.map((file) => toWorkspaceRelative(root, file)),
    raw_pr_create_mentions: rawMentions,
    vibepro_command_mentions: vibeproMentions,
    subagent_activity_mentions: subagentActivityMentions
  };
}

async function listMarkdownFiles(dir) {
  const files = [];
  async function visit(current) {
    for (const entry of await safeReaddirEntries(current)) {
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
      pr: countRealPrArtifacts(prArtifacts),
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

function renderTraceabilityGaps(report) {
  const gaps = report.value_signals?.traceability_gaps ?? [];
  if (gaps.length === 0) return '- none';
  return gaps.map((gap) => (
    `- ${gap.story_id}: ${gap.kind} artifact=${gap.artifact ?? '-'} next="${gap.next_command}"`
  )).join('\n');
}

function formatArtifactSources(sources) {
  const items = Array.isArray(sources)
    ? sources
    : Object.entries(sources && typeof sources === 'object' ? sources : {})
      .map(([kind, value]) => ({ kind, ...(value && typeof value === 'object' ? value : {}) }));
  const entries = items
    .filter((value) => value && typeof value === 'object' && value.source)
    .map((value) => [
      value.kind ?? 'artifact',
      value.source,
      value.artifact
    ].filter(Boolean).join(':'));
  return entries.length ? entries.join(',') : '-';
}

function normalizeLogCommand(value) {
  return String(value ?? '')
    .trim()
    .replace(/[`"'）)】\].,;:、。]+$/g, '')
    .trim();
}

function parseSubagentActivityLine(line) {
  if (!/multi_agent_v1(?:spawn_agent|wait_agent|close_agent)|spawn_agent|wait_agent|close_agent/.test(line)) return null;
  const text = String(line ?? '');
  const kind = text.includes('multi_agent_v1spawn_agent') || /\bspawn_agent\b/.test(text)
    ? 'spawn'
    : text.includes('multi_agent_v1wait_agent') || /\bwait_agent\b/.test(text)
      ? 'wait'
      : text.includes('multi_agent_v1close_agent') || /\bclose_agent\b/.test(text)
        ? 'close'
        : null;
  if (!kind) return null;
  const agentIds = [...new Set([
    ...[...text.matchAll(/"target"\s*:\s*"([^"]+)"/g)].map((match) => match[1]),
    ...[...text.matchAll(/"targets"\s*:\s*\[([^\]]*)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((idMatch) => idMatch[1])),
    ...[...text.matchAll(/\btarget=([0-9a-f-]{12,})/g)].map((match) => match[1])
  ])];
  const threadId = text.match(/\bthread_id=([0-9a-f-]{12,})/)?.[1] ?? null;
  return {
    kind,
    agent_ids: agentIds,
    thread_id: threadId
  };
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

function evaluateTraceabilityGaps(storyMap, { prArtifacts, reviewArtifacts }) {
  const prByStory = groupArtifactsByStory(prArtifacts);
  const reviewsByStory = groupArtifactsByStory(reviewArtifacts);
  for (const story of storyMap.values()) {
    const prItems = prByStory.get(story.story_id) ?? [];
    const reviewItems = reviewsByStory.get(story.story_id) ?? [];
    // traceability.json is a lifecycle declaration, never PR evidence by itself
    const hasRealPrArtifact = prItems.some((item) => !NON_PR_EVIDENCE_KINDS.has(item.kind));
    const mergeArtifact = latestArtifact(prItems.filter((item) => item.kind === 'pr_merge'));
    const createArtifact = latestArtifact(prItems.filter((item) => item.kind === 'pr_create'));
    const prepareArtifact = latestArtifact(prItems.filter((item) => item.kind === 'pr_prepare'));
    const traceabilityArtifact = latestArtifact(prItems.filter((item) => item.kind === 'traceability'));
    const selectedRealArtifact = latestArtifact(prItems.filter((item) => !NON_PR_EVIDENCE_KINDS.has(item.kind)));

    if (hasRealPrArtifact) {
      const artifactSource = getArtifactSource(selectedRealArtifact);
      story.traceability_resolution = {
        status: artifactSource === 'local' ? 'local_resolved' : 'alternate_source_resolved',
        artifact_source: artifactSource,
        artifact: selectedRealArtifact?.path ?? null
      };
    }

    if (story.story_doc_present && !hasRealPrArtifact) {
      const lifecycle = traceabilityArtifact?.data?.lifecycle ?? null;
      if (lifecycle === 'declared_not_started') {
        story.declared_unstarted = true;
        story.traceability_resolution = {
          status: 'declared_not_started',
          artifact_source: getArtifactSource(traceabilityArtifact),
          artifact: traceabilityArtifact?.path ?? null
        };
      } else if (lifecycle === 'merged_without_vibepro_evidence') {
        story.merged_without_vibepro_evidence = true;
        story.traceability_resolution = {
          status: 'alternate_source_resolved',
          artifact_source: getArtifactSource(traceabilityArtifact),
          artifact: traceabilityArtifact?.path ?? null
        };
      } else if (lifecycle === 'evidence_in_other_worktree') {
        story.evidence_in_other_worktree = true;
        story.traceability_resolution = {
          status: 'alternate_source_resolved',
          artifact_source: getArtifactSource(traceabilityArtifact),
          artifact: traceabilityArtifact?.path ?? null
        };
      } else {
        story.traceability_resolution = {
          status: 'actual_missing',
          artifact_source: null,
          artifact: story.story_doc_path
        };
        addTraceabilityGap(story, {
          kind: 'traceability_missing_pr_artifact',
          artifact: story.story_doc_path,
          detail: 'Story doc exists but .vibepro/pr/<story-id> artifacts were not found',
          next_command: `vibepro pr prepare . --story-id ${story.story_id} --base <base-ref>`
        });
      }
    }

    if (isMergedOrClosedStory(story, createArtifact, mergeArtifact)) {
      const staleMergeReason = getStaleMergeArtifactReason({ story, mergeArtifact, createArtifact, prepareArtifact });
      if (staleMergeReason) {
        addTraceabilityGap(story, {
          kind: 'traceability_stale_merge_artifact',
          artifact: mergeArtifact?.path ?? story.story_doc_path ?? null,
          detail: staleMergeReason,
          next_command: `vibepro execute merge . --story-id ${story.story_id} --pr <pr-number> --dry-run`
        });
      }
    }

    for (const review of reviewItems) {
      if (review.kind !== 'review_summary') continue;
      const reason = getIncompleteReviewEvidenceReason(review.data);
      if (!reason) continue;
      addTraceabilityGap(story, {
        kind: 'traceability_incomplete_review_evidence',
        artifact: review.path,
        detail: reason,
        next_command: `vibepro review repair . --story-id ${story.story_id}`
      });
    }
  }
}

const NON_PR_EVIDENCE_KINDS = new Set(['traceability', 'verification_evidence']);

function countRealPrArtifacts(prArtifacts) {
  return prArtifacts.filter((artifact) => !NON_PR_EVIDENCE_KINDS.has(artifact.kind)).length;
}

function groupArtifactsByStory(artifacts) {
  const grouped = new Map();
  for (const artifact of artifacts) {
    const items = grouped.get(artifact.story_id) ?? [];
    items.push(artifact);
    grouped.set(artifact.story_id, items);
  }
  return grouped;
}

function latestArtifact(artifacts) {
  return artifacts
    .slice()
    .sort((a, b) => artifactTime(b) - artifactTime(a))[0] ?? null;
}

function artifactTime(artifact) {
  const value = artifact?.data?.updated_at ?? artifact?.data?.recorded_at ?? artifact?.data?.created_at ?? artifact?.data?.generated_at ?? artifact?.data?.merged_at;
  const parsed = new Date(value ?? 0);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function isMergedOrClosedStory(story, createArtifact, mergeArtifact) {
  const status = String(story.story_status ?? '').toLowerCase();
  return ['merged', 'closed', 'done', 'completed'].includes(status)
    || mergeArtifact?.data?.status === 'merged'
    || createArtifact?.data?.status === 'merged'
    || createArtifact?.data?.merged === true;
}

function getStaleMergeArtifactReason({ story, mergeArtifact, createArtifact, prepareArtifact }) {
  if (!mergeArtifact) return 'Story appears merged/closed but pr-merge.json is missing';
  if (mergeArtifact.data?.status !== 'merged') return `pr-merge.json status is ${mergeArtifact.data?.status ?? 'missing'}, not merged`;
  const mergeHead = mergeArtifact.data?.pr?.head_ref_oid ?? mergeArtifact.data?.current_head_sha ?? mergeArtifact.data?.head_sha;
  const prepareHead = prepareArtifact?.data?.toolchain?.source_git?.commit
    ?? prepareArtifact?.data?.current_git_context?.head_sha
    ?? prepareArtifact?.data?.gate_status?.current_git_context?.head_sha;
  if (mergeHead && prepareHead && mergeHead !== prepareHead) {
    return `pr-merge.json head ${shortSha(mergeHead)} does not match latest prepare head ${shortSha(prepareHead)}`;
  }
  const createUrl = createArtifact?.data?.pr_url ?? createArtifact?.data?.url;
  const mergeUrl = mergeArtifact.data?.pr?.url ?? mergeArtifact.data?.pr_url ?? mergeArtifact.data?.url;
  if (createUrl && mergeUrl && createUrl !== mergeUrl) {
    return 'pr-merge.json PR URL does not match pr-create.json';
  }
  if (story.latest_pr_url && mergeUrl && story.latest_pr_url !== mergeUrl) {
    return 'pr-merge.json PR URL does not match latest story PR URL';
  }
  return null;
}

export function getIncompleteReviewRoleReason(role) {
  if (!role?.role) return 'review role name is missing';
  if (!role.status && !role.effective_status) return `review role ${role.role} has no status`;
  if (!role.provenance_status && !role.agent_provenance) return `review role ${role.role} has no agent provenance`;
  if (role.provenance_status && role.provenance_status !== 'verified_agent') return `review role ${role.role} provenance is ${role.provenance_status}`;
  if (role.agent_provenance && role.agent_provenance.lifecycle?.agent_closed !== true) return `review role ${role.role} agent lifecycle is not closed`;
  return null;
}

function getIncompleteReviewEvidenceReason(summary) {
  const roles = summary?.roles;
  if (!Array.isArray(roles) || roles.length === 0) return 'review summary has no required role records';
  for (const role of roles) {
    const reason = getIncompleteReviewRoleReason(role);
    if (reason) return reason;
  }
  return null;
}

function addTraceabilityGap(story, gap) {
  if (story.traceability_gaps.some((item) => item.kind === gap.kind && item.artifact === gap.artifact && item.detail === gap.detail)) return;
  story.traceability_gaps.push(gap);
}

function recordStoryArtifactSource(story, artifact) {
  const entry = {
    kind: artifact.kind,
    source: getArtifactSource(artifact),
    artifact: artifact.path
  };
  if (story.artifact_sources.some((item) => item.kind === entry.kind && item.source === entry.source && item.artifact === entry.artifact)) return;
  story.artifact_sources.push(entry);
}

function getArtifactSource(artifact) {
  return artifact?.source ?? 'local';
}

function shortSha(value) {
  return String(value ?? '').slice(0, 12);
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
  const traceabilityGaps = stories.flatMap((story) => (
    story.traceability_gaps.map((gap) => ({ story_id: story.story_id, ...gap }))
  ));
  const traceabilityGapStoryCount = stories.filter((story) => story.traceability_gaps.length > 0).length;
  const actualMissingTraceabilityGapCount = stories.filter((story) => story.traceability_resolution?.status === 'actual_missing').length;
  const alternateSourceResolvedTraceabilityCount = stories.filter((story) => story.traceability_resolution?.status === 'alternate_source_resolved').length;
  const declaredUnstartedCount = stories.filter((story) => story.declared_unstarted).length;
  const verificationObservationMissingCount = stories.filter((story) => story.verification_observation_missing).length;
  const fastLaneCount = stories.filter((story) => story.fast_lane).length;
  const mergedWithoutEvidenceCount = stories.filter((story) => story.merged_without_vibepro_evidence).length;
  const evidenceInOtherWorktreeCount = stories.filter((story) => story.evidence_in_other_worktree).length;
  return {
    story_count: storyCount,
    waiver_required_story_count: waiverRequiredCount,
    stale_evidence_story_count: staleEvidenceCount,
    story_source_mismatch_story_count: storySourceMismatchCount,
    traceability_gap_count: traceabilityGapStoryCount,
    actual_missing_traceability_gap_count: actualMissingTraceabilityGapCount,
    alternate_source_resolved_traceability_count: alternateSourceResolvedTraceabilityCount,
    declared_unstarted_story_count: declaredUnstartedCount,
    verification_observation_missing_story_count: verificationObservationMissingCount,
    fast_lane_story_count: fastLaneCount,
    merged_without_vibepro_evidence_story_count: mergedWithoutEvidenceCount,
    evidence_in_other_worktree_story_count: evidenceInOtherWorktreeCount,
    traceability_gaps: traceabilityGaps,
    waiver_required_rate: calculateRate(waiverRequiredCount, storyCount),
    stale_evidence_rate: calculateRate(staleEvidenceCount, storyCount),
    story_source_mismatch_rate: calculateRate(storySourceMismatchCount, storyCount),
    traceability_gap_rate: calculateRate(traceabilityGapStoryCount, storyCount)
  };
}

function buildSubagentRoiMetrics(reviewArtifacts) {
  const reviewByKey = new Map();
  for (const artifact of reviewArtifacts) {
    for (const { storyId, stage, role, lifecycleEntries } of expandSubagentRoiArtifactRoles(artifact)) {
      const provenance = role.agent_provenance ?? {};
      if (!ROI_AGENT_SYSTEMS.has(provenance.system) || provenance.execution_mode !== 'parallel_subagent') continue;
      const lifecycleEntry = findLifecycleEntryForReviewRole(role, lifecycleEntries);
      const findings = normalizeReviewFindings(role);
      const findingCount = Math.max(findings.length, Number(role.finding_count ?? 0));
      const dispositions = normalizeReviewDispositions(role.finding_dispositions);
      const dispositionCounts = countDispositions(dispositions);
      const usage = normalizeReviewUsage(role.agent_usage);
      const elapsedMs = lifecycleEntry?.elapsed_ms ?? role.lifecycle?.latest?.elapsed_ms ?? null;
      const score = scoreSubagentReview({
        role,
        provenance,
        lifecycleEntry,
        findings,
        findingCount,
        dispositionCounts,
        usage,
        elapsedMs
      });
      const review = {
        source_kind: artifact.kind,
        source_kinds: [artifact.kind],
        story_id: storyId,
        stage,
        role: role.role,
        status: role.status ?? 'missing',
        effective_status: role.effective_status ?? role.status ?? 'missing',
        artifact: artifact.path,
        agent: {
          system: provenance.system ?? null,
          agent_id: provenance.agent_id ?? lifecycleEntry?.agent_id ?? null,
          model: provenance.model ?? lifecycleEntry?.agent_model ?? null,
          reasoning_effort: provenance.reasoning_effort ?? lifecycleEntry?.agent_reasoning_effort ?? null,
          cost_tier: provenance.cost_tier ?? lifecycleEntry?.agent_cost_tier ?? null,
          evidence_strength: provenance.evidence_strength ?? null
        },
        cost: {
          elapsed_ms: elapsedMs,
          agent_minutes: elapsedMs === null ? null : Number((elapsedMs / 60000).toFixed(2)),
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          total_tokens: usage.total_tokens,
          cost_usd: usage.cost_usd
        },
        findings: {
          total: findingCount,
          accepted: dispositionCounts.accepted,
          rejected: dispositionCounts.rejected,
          duplicate: dispositionCounts.duplicate,
          deferred: dispositionCounts.deferred,
          false_positive: dispositionCounts.false_positive,
          resolved: dispositions.filter((item) => item.resolved_by.length > 0).length,
          undisposed: Math.max(0, findingCount - dispositions.length)
        },
        value_score: score.score,
        value_band: score.band,
        value_signals: score.value_signals,
        waste_signals: score.waste_signals
      };
      const key = buildSubagentRoiReviewKey({ review, provenance, lifecycleEntry });
      reviewByKey.set(key, preferSubagentRoiReview(reviewByKey.get(key), review));
    }
  }
  const reviews = [...reviewByKey.values()];
  reviews.sort((a, b) => (
    a.story_id.localeCompare(b.story_id)
    || a.stage.localeCompare(b.stage)
    || a.role.localeCompare(b.role)
  ));
  return {
    schema_version: '0.1.0',
    summary: summarizeSubagentRoiReviews(reviews),
    by_story: summarizeSubagentRoiByStory(reviews),
    by_review: reviews
  };
}

function expandSubagentRoiArtifactRoles(artifact) {
  if (artifact.kind === 'review_result') {
    return [{
      storyId: artifact.data?.story_id ?? artifact.story_id,
      stage: artifact.data?.stage ?? 'unknown',
      role: artifact.data ?? {},
      lifecycleEntries: []
    }];
  }
  const lifecycleEntries = Array.isArray(artifact.data?.lifecycle?.entries) ? artifact.data.lifecycle.entries : [];
  return (artifact.data?.roles ?? []).map((role) => ({
    storyId: artifact.story_id,
    stage: artifact.data?.stage ?? role.stage ?? 'unknown',
    role,
    lifecycleEntries
  }));
}

function buildSubagentRoiReviewKey({ review, provenance, lifecycleEntry }) {
  const agentId = provenance.agent_id ?? lifecycleEntry?.agent_id ?? review.agent.agent_id ?? review.artifact;
  return [review.story_id, review.stage, review.role, agentId].join('\0');
}

function preferSubagentRoiReview(previous, next) {
  if (!previous) return next;
  const previousPriority = previous.source_kind === 'review_result' ? 2 : 1;
  const nextPriority = next.source_kind === 'review_result' ? 2 : 1;
  const primary = nextPriority >= previousPriority ? next : previous;
  const fallback = primary === next ? previous : next;
  const elapsedMs = primary.cost.elapsed_ms ?? fallback.cost.elapsed_ms;
  return {
    ...primary,
    source_kinds: [...new Set([...(fallback.source_kinds ?? [fallback.source_kind]), ...(primary.source_kinds ?? [primary.source_kind])])],
    agent: {
      ...primary.agent,
      agent_id: primary.agent.agent_id ?? fallback.agent.agent_id,
      model: primary.agent.model ?? fallback.agent.model,
      reasoning_effort: primary.agent.reasoning_effort ?? fallback.agent.reasoning_effort,
      cost_tier: primary.agent.cost_tier ?? fallback.agent.cost_tier,
      evidence_strength: primary.agent.evidence_strength ?? fallback.agent.evidence_strength
    },
    cost: {
      elapsed_ms: elapsedMs,
      agent_minutes: elapsedMs === null ? null : Number((elapsedMs / 60000).toFixed(2)),
      input_tokens: primary.cost.input_tokens ?? fallback.cost.input_tokens,
      output_tokens: primary.cost.output_tokens ?? fallback.cost.output_tokens,
      total_tokens: primary.cost.total_tokens ?? fallback.cost.total_tokens,
      cost_usd: primary.cost.cost_usd ?? fallback.cost.cost_usd
    }
  };
}

function findLifecycleEntryForReviewRole(role, entries) {
  const agentId = role.agent_provenance?.agent_id;
  const roleEntries = entries.filter((entry) => (
    entry.role === role.role
    && (!agentId || entry.agent_id === agentId)
  ));
  return roleEntries.at(-1) ?? role.lifecycle?.latest ?? null;
}

function normalizeReviewFindings(role) {
  if (!Array.isArray(role.findings)) return [];
  return role.findings.map((finding) => ({
    id: String(finding?.id ?? 'finding'),
    severity: String(finding?.severity ?? 'medium').toLowerCase(),
    detail: finding?.detail ?? null
  }));
}

function normalizeReviewDispositions(dispositions = []) {
  if (!Array.isArray(dispositions)) return [];
  return dispositions.map((item) => {
    const disposition = String(item?.disposition ?? '').toLowerCase();
    return {
      finding_id: String(item?.finding_id ?? ''),
      disposition: ROI_DISPOSITIONS.includes(disposition) ? disposition : 'deferred',
      resolved_by: Array.isArray(item?.resolved_by) ? item.resolved_by.filter(Boolean) : [],
      reason: item?.reason ?? null
    };
  }).filter((item) => item.finding_id);
}

function countDispositions(dispositions) {
  const counts = Object.fromEntries(ROI_DISPOSITIONS.map((disposition) => [disposition, 0]));
  for (const item of dispositions) counts[item.disposition] += 1;
  return counts;
}

function normalizeReviewUsage(usage = null) {
  const inputTokens = normalizeNullableNumber(usage?.input_tokens);
  const outputTokens = normalizeNullableNumber(usage?.output_tokens);
  const explicitTotal = normalizeNullableNumber(usage?.total_tokens);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: explicitTotal ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    cost_usd: normalizeNullableNumber(usage?.cost_usd)
  };
}

function scoreSubagentReview({ role, provenance, lifecycleEntry, findings, findingCount, dispositionCounts, usage, elapsedMs }) {
  let score = 0;
  const valueSignals = [];
  const wasteSignals = [];
  const status = role.effective_status ?? role.status;
  if (status === 'block') {
    score += 35;
    valueSignals.push('blocked_merge_risk');
  } else if (status === 'needs_changes') {
    score += 25;
    valueSignals.push('requested_change');
  } else if (status === 'pass') {
    score += 12;
    valueSignals.push('independent_pass_confirmation');
  }
  if (dispositionCounts.accepted > 0) {
    score += Math.min(45, dispositionCounts.accepted * 25);
    valueSignals.push('accepted_finding');
    valueSignals.push('high_value_candidate');
  }
  const resolvedCount = normalizeReviewDispositions(role.finding_dispositions).filter((item) => item.resolved_by.length > 0).length;
  if (resolvedCount > 0) {
    score += Math.min(30, resolvedCount * 15);
    valueSignals.push('resolved_finding');
    valueSignals.push('high_value_candidate');
  }
  if (findingCount > 0 && normalizeReviewDispositions(role.finding_dispositions).length === 0) {
    wasteSignals.push('undisposed_finding');
  }
  const highSeverityCount = findings.filter((finding) => ['critical', 'high'].includes(finding.severity)).length;
  if (highSeverityCount > 0 && ['block', 'needs_changes'].includes(role.status)) {
    score += 10;
    valueSignals.push('high_severity_finding');
  }
  if ((role.inspection?.inputs ?? []).length > 0) {
    score += 8;
    valueSignals.push('reconstructable_inputs');
  }
  if ((role.judgment_delta ?? []).length > 0) {
    score += 8;
    valueSignals.push('judgment_delta_recorded');
  }
  if (provenance.evidence_strength === 'strong') {
    score += 8;
    valueSignals.push('strong_agent_provenance');
  }
  if (provenance.lifecycle?.agent_closed === true || lifecycleEntry?.effective_status === 'closed' || lifecycleEntry?.status === 'closed') {
    score += 6;
    valueSignals.push('closed_lifecycle');
  }
  if (findingCount === 0 && (role.judgment_delta ?? []).length === 0 && role.status === 'pass') {
    score -= 10;
    wasteSignals.push('pass_only_no_decision_signal');
    wasteSignals.push('pass_only_no_judgment_delta');
  }
  if (dispositionCounts.duplicate > 0) {
    score -= Math.min(30, dispositionCounts.duplicate * 15);
    wasteSignals.push('duplicate_finding');
  }
  if (dispositionCounts.false_positive > 0) {
    score -= Math.min(40, dispositionCounts.false_positive * 20);
    wasteSignals.push('false_positive_finding');
  }
  if (status === 'stale') {
    score -= 20;
    wasteSignals.push('stale_review');
  }
  if (lifecycleEntry?.effective_status === 'timed_out' || role.lifecycle?.timed_out_count > 0) {
    score -= 15;
    wasteSignals.push('timed_out_lifecycle');
  }
  if (role.lifecycle?.replaced_count > 0) {
    score -= 5;
    wasteSignals.push('replacement_overhead');
  }
  if (provenance.evidence_strength && provenance.evidence_strength !== 'strong') {
    score -= 15;
    wasteSignals.push('weak_agent_provenance');
  }
  if (Number.isFinite(elapsedMs) && elapsedMs > 10 * 60 * 1000) {
    score -= elapsedMs > 20 * 60 * 1000 ? 10 : 5;
    wasteSignals.push('high_elapsed_time');
  }
  if (usage?.total_tokens === null || usage?.total_tokens === undefined) {
    wasteSignals.push('token_missing');
  }
  if (usage?.cost_usd === null || usage?.cost_usd === undefined) {
    wasteSignals.push('cost_missing');
  }
  const clamped = valueSignals.includes('high_value_candidate')
    ? Math.max(70, Math.max(0, Math.min(100, score)))
    : Math.max(0, Math.min(100, score));
  return {
    score: clamped,
    band: clamped >= 70 ? 'high' : clamped >= 40 ? 'medium' : 'low',
    value_signals: [...new Set(valueSignals)],
    waste_signals: [...new Set(wasteSignals)]
  };
}

function summarizeSubagentRoiReviews(reviews) {
  const tokenObservedCount = reviews.filter((review) => review.cost.total_tokens !== null).length;
  const totalElapsedMs = sumNumbers(reviews.map((review) => review.cost.elapsed_ms));
  return {
    total_reviews: reviews.length,
    high_value_review_count: reviews.filter((review) => review.value_band === 'high').length,
    medium_value_review_count: reviews.filter((review) => review.value_band === 'medium').length,
    low_value_review_count: reviews.filter((review) => review.value_band === 'low').length,
    value_score_average: averageNumbers(reviews.map((review) => review.value_score)),
    accepted_finding_count: sumNumbers(reviews.map((review) => review.findings.accepted)),
    resolved_finding_count: sumNumbers(reviews.map((review) => review.findings.resolved)),
    duplicate_finding_count: sumNumbers(reviews.map((review) => review.findings.duplicate)),
    false_positive_finding_count: sumNumbers(reviews.map((review) => review.findings.false_positive)),
    undisposed_finding_count: sumNumbers(reviews.map((review) => review.findings.undisposed)),
    pass_only_no_decision_signal_count: reviews.filter((review) => review.waste_signals.includes('pass_only_no_decision_signal')).length,
    pass_only_no_judgment_delta_count: reviews.filter((review) => review.waste_signals.includes('pass_only_no_judgment_delta')).length,
    stale_review_count: reviews.filter((review) => review.waste_signals.includes('stale_review')).length,
    timed_out_review_count: reviews.filter((review) => review.waste_signals.includes('timed_out_lifecycle')).length,
    total_agent_elapsed_ms: totalElapsedMs,
    total_agent_minutes: Number((totalElapsedMs / 60000).toFixed(2)),
    total_input_tokens: sumNumbers(reviews.map((review) => review.cost.input_tokens)),
    total_output_tokens: sumNumbers(reviews.map((review) => review.cost.output_tokens)),
    total_tokens: sumNumbers(reviews.map((review) => review.cost.total_tokens)),
    total_cost_usd: Number(sumNumbers(reviews.map((review) => review.cost.cost_usd)).toFixed(6)),
    token_observed_review_count: tokenObservedCount,
    token_missing_review_count: reviews.filter((review) => review.waste_signals.includes('token_missing')).length,
    cost_missing_review_count: reviews.filter((review) => review.waste_signals.includes('cost_missing')).length
  };
}

function summarizeSubagentRoiByStory(reviews) {
  const byStory = new Map();
  for (const review of reviews) {
    const item = byStory.get(review.story_id) ?? {
      story_id: review.story_id,
      review_count: 0,
      value_score_average: null,
      accepted_finding_count: 0,
      resolved_finding_count: 0,
      duplicate_finding_count: 0,
      false_positive_finding_count: 0,
      total_agent_elapsed_ms: 0,
      total_agent_minutes: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      role_recommendations: {
        continue: [],
        reduce: [],
        needs_evidence: []
      }
    };
    item.review_count += 1;
    item.accepted_finding_count += review.findings.accepted;
    item.resolved_finding_count += review.findings.resolved;
    item.duplicate_finding_count += review.findings.duplicate;
    item.false_positive_finding_count += review.findings.false_positive;
    item.total_agent_elapsed_ms += review.cost.elapsed_ms ?? 0;
    item.total_tokens += review.cost.total_tokens ?? 0;
    item.total_cost_usd += review.cost.cost_usd ?? 0;
    if (review.value_signals.includes('high_value_candidate')) item.role_recommendations.continue.push(review.role);
    if (review.waste_signals.includes('pass_only_no_decision_signal')) item.role_recommendations.reduce.push(review.role);
    if (review.waste_signals.includes('undisposed_finding') || review.waste_signals.includes('token_missing') || review.waste_signals.includes('cost_missing')) {
      item.role_recommendations.needs_evidence.push(review.role);
    }
    const scores = [...(item._scores ?? []), review.value_score];
    item._scores = scores;
    item.value_score_average = averageNumbers(scores);
    item.total_agent_minutes = Number((item.total_agent_elapsed_ms / 60000).toFixed(2));
    item.total_cost_usd = Number(item.total_cost_usd.toFixed(6));
    byStory.set(review.story_id, item);
  }
  return [...byStory.values()]
    .map(({ _scores, ...item }) => ({
      ...item,
      role_recommendations: {
        continue: unique(item.role_recommendations.continue),
        reduce: unique(item.role_recommendations.reduce),
        needs_evidence: unique(item.role_recommendations.needs_evidence)
      }
    }))
    .sort((a, b) => a.story_id.localeCompare(b.story_id));
}

function renderSubagentRoiRows(report) {
  const roi = report.subagent_roi;
  if (!roi) return '';
  const summary = roi.summary ?? {};
  const reviewRows = roi.by_review?.length
    ? roi.by_review.slice().sort(compareSubagentRoiForOperations).slice(0, 12).map((review) => (
        `- ${review.story_id}:${review.stage}:${review.role}: score=${review.value_score} band=${review.value_band} accepted=${review.findings.accepted} duplicate=${review.findings.duplicate} false_positive=${review.findings.false_positive} minutes=${review.cost.agent_minutes ?? '-'} tokens=${review.cost.total_tokens ?? '-'} waste=${review.waste_signals.join('|') || '-'}`
      )).join('\n')
    : '- none';
  const title = report.output?.language === 'en' ? '## Subagent ROI' : '## Subagent ROI';
  return `
${title}

- reviews: ${summary.total_reviews ?? 0}
- value_score_average: ${summary.value_score_average ?? '-'}
- high/medium/low: ${summary.high_value_review_count ?? 0}/${summary.medium_value_review_count ?? 0}/${summary.low_value_review_count ?? 0}
- accepted/resolved findings: ${summary.accepted_finding_count ?? 0}/${summary.resolved_finding_count ?? 0}
- duplicate/false_positive findings: ${summary.duplicate_finding_count ?? 0}/${summary.false_positive_finding_count ?? 0}
- total_agent_minutes: ${summary.total_agent_minutes ?? 0}
- total_tokens: ${(summary.token_observed_review_count ?? 0) > 0 ? summary.total_tokens : 'unknown'} (observed_reviews=${summary.token_observed_review_count ?? 0}, missing_reviews=${summary.token_missing_review_count ?? 0})
- cost_usd: ${(summary.cost_missing_review_count ?? 0) > 0 ? 'partial_or_unknown' : summary.total_cost_usd ?? 0}

${reviewRows}
`;
}

function compareSubagentRoiForOperations(a, b) {
  return subagentOperationalRank(a) - subagentOperationalRank(b)
    || b.value_score - a.value_score
    || a.story_id.localeCompare(b.story_id)
    || a.role.localeCompare(b.role);
}

function subagentOperationalRank(review) {
  if (review.value_signals.includes('high_value_candidate')) return 0;
  if (review.waste_signals.includes('undisposed_finding') || review.waste_signals.includes('token_missing') || review.waste_signals.includes('cost_missing')) return 1;
  if (review.waste_signals.includes('pass_only_no_decision_signal')) return 2;
  return 3;
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumNumbers(values) {
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function averageNumbers(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return Number((sumNumbers(numbers) / numbers.length).toFixed(2));
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

async function safeReaddirEntries(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
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

function parseStoryDocMetadata(text, filePath) {
  const frontmatter = String(text ?? '').match(/^---\n([\s\S]*?)\n---/);
  const source = frontmatter?.[1] ?? String(text ?? '').slice(0, 2000);
  return {
    story_id: matchYamlString(source, 'story_id') ?? inferStoryId(path.basename(filePath)),
    status: matchYamlString(source, 'status'),
    created_at: matchYamlString(source, 'created_at'),
    updated_at: matchYamlString(source, 'updated_at')
  };
}

function matchYamlString(text, key) {
  const match = String(text ?? '').match(new RegExp(`^${key}:\\s*['"]?([^'"\\n#]+)['"]?\\s*$`, 'm'));
  return match ? match[1].trim() : null;
}
