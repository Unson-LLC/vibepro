import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, initWorkspace, toWorkspaceRelative } from './workspace.js';
import { localizedText, resolveHumanOutputLanguage } from './language.js';

const execFileAsync = promisify(execFile);
const DEFAULT_EXPLORE_ROLES = ['codebase_context', 'risk_surface', 'test_surface'];
const EXPLORE_STATUSES = new Set(['pass', 'needs_review', 'block']);

export async function prepareExploreEvidence(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'explore prepare');
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  const language = await resolveHumanOutputLanguage(root, options);
  const exploreDir = getExploreDir(root, storyId);
  const requestDir = path.join(exploreDir, 'requests');
  await mkdir(requestDir, { recursive: true });

  const roles = parseRoles(options.roles);
  const gitContext = await collectGitContext(root);
  const plan = {
    schema_version: '0.1.0',
    story_id: storyId,
    topic: options.topic ?? 'read-only codebase exploration before implementation',
    created_at: new Date().toISOString(),
    output: { language },
    mode: 'read_only_exploration',
    git_context: gitContext,
    roles,
    instructions: buildExploreInstructions(language),
    requests: roles.map((role) => ({
      role,
      artifact: toWorkspaceRelative(root, getExploreRequestPath(requestDir, role)),
      record_command: buildExploreRecordCommand({ storyId, role })
    }))
  };

  await writeJson(path.join(exploreDir, 'explore-plan.json'), plan);
  await writeFile(path.join(exploreDir, 'parallel-dispatch.md'), renderExploreDispatch(plan, language));
  for (const role of roles) {
    await writeFile(getExploreRequestPath(requestDir, role), renderExploreRequest({ plan, role, language }));
  }
  const summary = await buildExploreSummary(root, storyId);
  await writeExploreSummary(root, storyId, summary);
  return {
    plan,
    summary,
    artifacts: {
      plan: toWorkspaceRelative(root, path.join(exploreDir, 'explore-plan.json')),
      parallel_dispatch: toWorkspaceRelative(root, path.join(exploreDir, 'parallel-dispatch.md')),
      summary_json: toWorkspaceRelative(root, path.join(exploreDir, 'explore-summary.json')),
      summary_markdown: toWorkspaceRelative(root, path.join(exploreDir, 'explore-summary.md')),
      requests: Object.fromEntries(roles.map((role) => [role, toWorkspaceRelative(root, getExploreRequestPath(requestDir, role))]))
    }
  };
}

export async function recordExploreEvidence(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'explore record');
  const role = options.role;
  if (!role) throw new Error('explore record requires --role <role>');
  if (!EXPLORE_STATUSES.has(options.status)) {
    throw new Error(`explore record --status must be one of: ${[...EXPLORE_STATUSES].join(', ')}`);
  }
  if (!options.summary && !options.stdinText) {
    throw new Error('explore record requires --summary <text> or --from-stdin');
  }
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  const exploreDir = getExploreDir(root, storyId);
  const resultDir = path.join(exploreDir, 'results');
  await mkdir(resultDir, { recursive: true });
  const result = {
    schema_version: '0.1.0',
    story_id: storyId,
    role,
    status: options.status,
    summary: options.summary ?? options.stdinText.trim(),
    findings: parseFindings(options.findings ?? []),
    artifacts: (options.artifacts ?? []).map((artifact) => normalizeArtifact(root, artifact)),
    recorded_at: new Date().toISOString(),
    git_context: await collectGitContext(root),
    agent_provenance: buildAgentProvenance(root, options)
  };
  const resultPath = path.join(resultDir, `${sanitizeId(role)}.json`);
  await writeJson(resultPath, result);
  const summary = await buildExploreSummary(root, storyId);
  await writeExploreSummary(root, storyId, summary);
  return {
    evidence: result,
    summary,
    artifact: toWorkspaceRelative(root, resultPath)
  };
}

export async function getExploreEvidenceStatus(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'explore status');
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  return buildExploreSummary(root, storyId);
}

export async function summarizeExploreEvidenceForPr(repoRoot, options = {}) {
  if (!options.storyId) return null;
  const root = path.resolve(repoRoot);
  const summaryPath = path.join(getExploreDir(root, options.storyId), 'explore-summary.json');
  return readJsonIfExists(summaryPath);
}

export function renderExplorePrepareSummary(result) {
  const language = result.plan.output?.language ?? 'ja';
  if (language === 'en') {
  return `# Explore Prepare

- story: ${result.plan.story_id}
- topic: ${result.plan.topic}
- roles: ${result.plan.roles.join(', ')}
- plan: ${result.artifacts.plan}
- parallel dispatch: ${result.artifacts.parallel_dispatch}
- summary: ${result.artifacts.summary_markdown}
`;
  }
  return `# Explore準備

- story: ${result.plan.story_id}
- topic: ${result.plan.topic}
- roles: ${result.plan.roles.join(', ')}
- plan: ${result.artifacts.plan}
- parallel dispatch: ${result.artifacts.parallel_dispatch}
- summary: ${result.artifacts.summary_markdown}
`;
}

export function renderExploreRecordSummary(result) {
  return `# Explore Record

- story: ${result.evidence.story_id}
- role: ${result.evidence.role}
- status: ${result.evidence.status}
- agent provenance: ${result.evidence.agent_provenance.system}/${result.evidence.agent_provenance.execution_mode}
- artifact: ${result.artifact}
`;
}

export function renderExploreStatusSummary(status) {
  const rows = (status.roles ?? []).map((role) => `- ${role.role}: ${role.status} - ${role.summary ?? '-'}`);
  return `# Explore Status

- story: ${status.story_id}
- status: ${status.status}
- recorded: ${status.summary.recorded_role_count}/${status.summary.expected_role_count}

${rows.join('\n') || '- no explore evidence recorded'}
`;
}

export function renderExplorePrSection(exploreEvidence) {
  if (!exploreEvidence) return '- Explore evidence未生成';
  const rows = (exploreEvidence.roles ?? []).map((role) => `- ${role.role}: ${role.status}${role.summary ? ` - ${role.summary}` : ''}`);
  return `- Status: ${exploreEvidence.status}
- Recorded roles: ${exploreEvidence.summary?.recorded_role_count ?? 0}/${exploreEvidence.summary?.expected_role_count ?? 0}
${rows.join('\n') || '- no explore evidence recorded'}`;
}

async function buildExploreSummary(root, storyId) {
  const exploreDir = getExploreDir(root, storyId);
  const plan = await readJsonIfExists(path.join(exploreDir, 'explore-plan.json'));
  const expectedRoles = plan?.roles ?? DEFAULT_EXPLORE_ROLES;
  const results = await readExploreResults(path.join(exploreDir, 'results'));
  const roles = expectedRoles.map((role) => {
    const result = results.find((item) => item.role === role);
    return result
      ? {
          role,
          status: result.status,
          summary: result.summary,
          recorded_at: result.recorded_at,
          agent_provenance: result.agent_provenance
        }
      : { role, status: 'missing', summary: null };
  });
  const status = roles.some((role) => role.status === 'block')
    ? 'block'
    : roles.some((role) => ['needs_review', 'missing'].includes(role.status))
      ? 'needs_review'
      : 'pass';
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    status,
    plan_created_at: plan?.created_at ?? null,
    topic: plan?.topic ?? null,
    roles,
    artifacts: {
      plan: await pathExists(path.join(exploreDir, 'explore-plan.json')) ? toWorkspaceRelative(root, path.join(exploreDir, 'explore-plan.json')) : null,
      parallel_dispatch: await pathExists(path.join(exploreDir, 'parallel-dispatch.md')) ? toWorkspaceRelative(root, path.join(exploreDir, 'parallel-dispatch.md')) : null,
      summary_json: toWorkspaceRelative(root, path.join(exploreDir, 'explore-summary.json')),
      summary_markdown: toWorkspaceRelative(root, path.join(exploreDir, 'explore-summary.md'))
    },
    summary: {
      expected_role_count: expectedRoles.length,
      recorded_role_count: results.length,
      missing_role_count: roles.filter((role) => role.status === 'missing').length,
      needs_review_count: roles.filter((role) => role.status === 'needs_review').length,
      block_count: roles.filter((role) => role.status === 'block').length
    }
  };
}

async function writeExploreSummary(root, storyId, summary) {
  const exploreDir = getExploreDir(root, storyId);
  await mkdir(exploreDir, { recursive: true });
  await writeJson(path.join(exploreDir, 'explore-summary.json'), summary);
  await writeFile(path.join(exploreDir, 'explore-summary.md'), renderExploreStatusSummary(summary));
}

function buildExploreInstructions(language = 'ja') {
  return localizedText(language, {
    ja: [
      'read-only explorationだけを行い、fileを編集しない。',
      '広いsummaryより、具体的なfile path、確認したcommand、観測したriskを優先する。',
      'PR preparationがこのcontextを表示できるよう、vibepro explore recordで結果を記録する。'
    ],
    en: [
      'Use read-only exploration only. Do not edit files.',
      'Prefer concrete file paths, commands, and observed risks over broad summaries.',
      'Record the result with vibepro explore record so PR preparation can surface this context.'
    ]
  });
}

function renderExploreDispatch(plan, language = plan?.output?.language ?? 'ja') {
  if (language === 'en') {
  return `# VibePro Explore Dispatch

Story: ${plan.story_id}
Topic: ${plan.topic}

Dispatch these read-only exploration requests in parallel. Do not edit files.

${plan.requests.map((request) => `- ${request.role}: ${request.artifact}\n  - record: \`${request.record_command}\``).join('\n')}
`;
  }
  return `# VibePro Explore Dispatch

Story: ${plan.story_id}
Topic: ${plan.topic}

下記のread-only exploration requestをparallelでdispatchする。fileは編集しない。

${plan.requests.map((request) => `- ${request.role}: ${request.artifact}\n  - record: \`${request.record_command}\``).join('\n')}
`;
}

function renderExploreRequest({ plan, role, language = plan?.output?.language ?? 'ja' }) {
  if (language === 'en') {
  return `# VibePro Explore Request

Story: ${plan.story_id}
Role: ${role}
Topic: ${plan.topic}

## Rules

- Read-only exploration only.
- Return concrete file paths, commands inspected, risks, and unknowns.
- Do not make code changes.

## Output

- status: pass | needs_review | block
- summary
- findings

## Record

\`${buildExploreRecordCommand({ storyId: plan.story_id, role })}\`
`;
  }
  return `# VibePro Explore Request

Story: ${plan.story_id}
Role: ${role}
Topic: ${plan.topic}

## ルール

- read-only explorationだけを行う。
- 具体的なfile path、確認したcommand、risk、unknownを返す。
- code changeは行わない。

## 出力

- status: pass | needs_review | block
- summary
- findings

## 記録

\`${buildExploreRecordCommand({ storyId: plan.story_id, role })}\`
`;
}

function buildExploreRecordCommand({ storyId, role }) {
  return `vibepro explore record . --id ${storyId} --role ${role} --status <pass|needs_review|block> --summary <text> --agent-system codex|claude_code --execution-mode parallel_subagent --agent-id <id>`;
}

function parseRoles(roles = []) {
  const parsed = roles.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean);
  return parsed.length > 0 ? [...new Set(parsed.map(sanitizeId))] : DEFAULT_EXPLORE_ROLES;
}

async function readExploreResults(resultDir) {
  try {
    const entries = await readdir(resultDir, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const result = await readJsonIfExists(path.join(resultDir, entry.name));
      if (result) results.push(result);
    }
    return results.sort((a, b) => a.role.localeCompare(b.role));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function buildAgentProvenance(root, options = {}) {
  return {
    system: options.agentSystem ?? 'unknown',
    execution_mode: options.executionMode ?? 'unknown',
    agent_id: options.agentId ?? null,
    agent_model: options.agentModel ?? null,
    transcript: options.agentTranscript ? normalizeArtifact(root, options.agentTranscript) : null,
    recorded_by: options.recordedBy ?? 'vibepro explore record'
  };
}

function parseFindings(values) {
  return values.map((value) => {
    const [severity, id, ...detailParts] = String(value).split(':');
    return {
      severity: severity || 'info',
      id: id || 'finding',
      detail: detailParts.join(':') || value
    };
  });
}

function normalizeArtifact(root, artifact) {
  if (!artifact) return artifact;
  const absolute = path.resolve(root, artifact);
  const relative = path.relative(root, absolute);
  return relative.startsWith('..') ? artifact : relative;
}

async function collectGitContext(root) {
  const [head, status] = await Promise.all([
    runGit(root, ['rev-parse', 'HEAD']),
    runGit(root, ['status', '--porcelain'])
  ]);
  return {
    head: head.trim() || null,
    dirty: status.trim().length > 0,
    dirty_files: status.split('\n').filter(Boolean).map((line) => line.slice(3))
  };
}

async function runGit(root, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root });
    return stdout;
  } catch {
    return '';
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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function getExploreDir(root, storyId) {
  return path.join(getWorkspaceDir(root), 'explore', storyId);
}

function getExploreRequestPath(requestDir, role) {
  return path.join(requestDir, `${sanitizeId(role)}.md`);
}

function sanitizeId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'explore';
}

function requireStoryId(storyId, commandName) {
  if (!storyId) throw new Error(`${commandName} requires --id <story-id>`);
  return storyId;
}
