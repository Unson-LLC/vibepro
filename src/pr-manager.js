// pr-manager.js — minimal-core rebuild (Slice 6a).
//
// This module used to carry a Gate DAG, readiness evaluation, risk/route
// classification, remediation-command generation, and canonical-audit/merge
// wiring (~15.7k lines). Per docs/management/REBUILD.md ("最小コアのスコープ"),
// all of that is removed. What remains is exactly two things:
//
//   - preparePullRequest: collect Story info, Spec presence, recorded
//     verification evidence, and recorded review status; write
//     `.vibepro/pr/<story>/pr-prepare.json` and a PR body markdown file.
//   - createPullRequest: turn a prepare result into an actual PR (push +
//     `gh pr create`, or refresh an existing open PR's body).
//
// No blocking, no gate_dag, no readiness/route classification, no
// remediation-command generation.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, normalizeActiveStories, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { localizedText, resolveHumanOutputLanguage } from './language.js';
import { readDrift, readInferredSpec } from './spec-store.js';
import { resolvePrArtifactFile } from './artifact-routing.js';
import { getAgentReviewStatus } from './agent-review.js';
import { bindStoryTraceability, buildTraceabilityClauseMap, summarizeTraceabilityClauseMap } from './traceability.js';
import { findStorySource } from './requirement-consistency.js';
import { assertDevelopmentAdmission } from './development-control.js';

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = '0.2.0';

// ---------------------------------------------------------------------------
// preparePullRequest
// ---------------------------------------------------------------------------

export async function preparePullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options.storyId, 'pr prepare');
  const language = await resolveHumanOutputLanguage(root, options);
  const developmentControl = options.developmentControl ?? await assertDevelopmentAdmission(root, {
    storyId,
    commandName: 'pr prepare'
  });

  const [story, git, spec, drift, verification, review] = await Promise.all([
    readStory(root, storyId),
    collectGitState(root, options),
    readInferredSpec(root, storyId).catch(() => null),
    readDrift(root, storyId).catch(() => null),
    readVerificationSummary(root, storyId),
    readReviewSummary(root, storyId)
  ]);

  const jsonPath = await resolvePrArtifactFile(root, storyId, 'pr-prepare.json');
  const bodyPath = await resolvePrArtifactFile(root, storyId, 'pr-body.md');

  const storySource = await findStorySource(root, story).catch(() => null);
  const clauseMap = buildClauseMapForPrepare({ storyId, storySource, git });

  const preparation = {
    schema_version: SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    story,
    task_context: options.taskId || options.groupId ? { task_id: options.taskId ?? null, group_id: options.groupId ?? null } : null,
    output: { language },
    git,
    spec: spec ? { present: true, story_id: spec.story_id ?? storyId, clause_count: (spec.clauses ?? []).length } : { present: false },
    spec_drift: drift ? { status: drift.status ?? null, item_count: (drift.items ?? []).length } : null,
    verification,
    review,
    development_control: developmentControl,
    story_source: summarizeStorySource(storySource),
    // Informational only — never blocks `pr prepare`. Unmapped AC ids are
    // surfaced in pr-body.md as "unaddressed"; see renderPrBody().
    traceability: summarizeClauseMapForPrepare(clauseMap)
  };

  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(preparation, null, 2)}\n`, 'utf8');
  const body = renderPrBody(preparation);
  await writeFile(bodyPath, body, 'utf8');

  await recordManifestPrPrepare(root, storyId, { jsonPath, bodyPath }).catch(() => null);
  await recordTraceabilityForPrepare(root, storyId, { bodyPath, verification, storySource }).catch(() => null);

  return {
    story,
    preparation,
    artifacts: {
      json: jsonPath,
      pr_body: bodyPath
    }
  };
}

function requireStoryId(storyId, commandName) {
  if (!storyId) throw new Error(`${commandName} requires --story-id <id>`);
  return storyId;
}

async function readStory(repoRoot, storyId) {
  let config = null;
  try {
    config = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
  } catch {
    config = null;
  }
  const stories = normalizeActiveStories(config?.brainbase?.stories);
  const found = stories.find((item) => item.story_id === storyId);
  if (found) return found;
  return {
    story_id: storyId,
    title: storyId,
    ssot: null,
    status: 'unknown',
    horizon: null,
    view: null,
    period: null,
    started_at: null,
    due_at: null
  };
}

async function readVerificationSummary(repoRoot, storyId) {
  const evidencePath = await resolvePrArtifactFile(repoRoot, storyId, 'verification-evidence.json').catch(() => null);
  if (!evidencePath) return { recorded: false, commands: [] };
  let evidence = null;
  try {
    evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  } catch {
    return { recorded: false, commands: [] };
  }
  const commands = (evidence.commands ?? []).map((command) => ({
    kind: command.kind,
    status: command.status,
    command: command.command ?? null,
    summary: command.summary ?? null,
    evidence_source: command.evidence_source ?? null,
    executed_at: command.executed_at ?? null
  }));
  return {
    recorded: commands.length > 0,
    updated_at: evidence.updated_at ?? null,
    artifact: toWorkspaceRelative(repoRoot, evidencePath),
    commands
  };
}

async function readReviewSummary(repoRoot, storyId) {
  try {
    const status = await getAgentReviewStatus(repoRoot, { storyId });
    return {
      recorded: (status.summary?.stage_count ?? 0) > 0,
      status: status.status ?? null,
      summary: status.summary ?? null,
      stages: (status.stages ?? []).map((stage) => ({
        stage: stage.stage,
        status: stage.status,
        roles: (stage.roles ?? []).map((role) => role.role ?? role.name ?? role).filter(Boolean)
      }))
    };
  } catch {
    return { recorded: false, status: null, summary: null, stages: [] };
  }
}

async function recordTraceabilityForPrepare(repoRoot, storyId, { bodyPath, verification, storySource }) {
  const evidence = buildPrArtifactEvidence(repoRoot, { bodyPath, verification });
  await bindStoryTraceability(repoRoot, {
    storyId,
    storyDocPath: storySource?.path ?? null,
    source: 'pr_prepare',
    lifecycle: 'in_progress',
    evidence
  });
}

function buildPrArtifactEvidence(repoRoot, { bodyPath, verification }) {
  const evidence = [{ type: 'pr_artifact', ref: toWorkspaceRelative(repoRoot, bodyPath) }];
  if (verification?.recorded && verification.artifact) {
    evidence.push({ type: 'pr_artifact', ref: verification.artifact });
  }
  return evidence;
}

// ---------------------------------------------------------------------------
// Story source discovery + AC/scenario -> code/test traceability
//
// Both are informational only: `pr prepare` never blocks on missing story
// docs or unmapped acceptance criteria. Unmapped clauses are surfaced in
// pr-body.md as "unaddressed" so a human reviewer sees the gap.
// ---------------------------------------------------------------------------

function summarizeStorySource(storySource) {
  if (!storySource || !storySource.path) {
    return { path: null, title: storySource?.title ?? null, found: false, acceptance_criteria_count: 0 };
  }
  return {
    // findStorySource() already returns a repo-relative path (see
    // parseStoryLikeDocument in requirement-consistency.js) — do not run it
    // through toWorkspaceRelative() again, which expects an absolute input.
    path: storySource.path,
    title: storySource.title ?? null,
    found: true,
    acceptance_criteria_count: (storySource.acceptance_criteria ?? []).length
  };
}

function buildClauseMapForPrepare({ storyId, storySource, git }) {
  const changedFiles = git.changed_files ?? [];
  const testFiles = changedFiles.filter((file) => /(^|[\\/])(test|tests|spec)([\\/]|$)|\.(test|spec)\.[jt]sx?$/i.test(file.path ?? ''));
  // No evidence array here on purpose: passing the always-present pr_artifact
  // (pr-body.md) ref would trip buildTraceabilityClauseMap's "broad evidence"
  // fallback and mark every clause at least weakly_mapped, hiding genuinely
  // unaddressed clauses. This summary reflects only changed-file/test matches.
  const acceptanceCriteria = storySource?.acceptance_criteria?.length ? storySource.acceptance_criteria : null;
  return buildTraceabilityClauseMap({
    storyId,
    storyText: storySource?.content ?? '',
    acceptanceCriteria,
    changedFiles,
    tests: testFiles,
    evidence: [],
    scenarioClauses: []
  });
}

function summarizeClauseMapForPrepare(clauseMap) {
  const acceptanceCriteria = clauseMap.acceptance_criteria.map((clause) => ({
    id: clause.id,
    status: clause.status,
    text: clause.source_text,
    mapped_files: clause.mapped_files,
    mapped_tests: clause.mapped_tests,
    weak_mapping_reason: clause.weak_mapping_reason
  }));
  return {
    acceptance_criteria: acceptanceCriteria,
    summary: summarizeTraceabilityClauseMap({
      acceptance_criteria: clauseMap.acceptance_criteria,
      scenario_clauses: [],
      scenario_lineage: null
    })
  };
}

async function recordManifestPrPrepare(repoRoot, storyId, artifacts) {
  const manifest = await readManifest(repoRoot);
  manifest.pr_prepares = {
    ...(manifest.pr_prepares ?? {}),
    [storyId]: {
      latest_json: toWorkspaceRelative(repoRoot, artifacts.jsonPath),
      latest_body: toWorkspaceRelative(repoRoot, artifacts.bodyPath),
      latest_prepared_at: new Date().toISOString()
    }
  };
  await writeManifest(repoRoot, manifest);
}

// ---------------------------------------------------------------------------
// Git state (minimal: branch, head, base, changed files, dirty files)
// ---------------------------------------------------------------------------

async function collectGitState(repoRoot, options) {
  const currentBranch = await gitOptional(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const headSha = await gitOptional(repoRoot, ['rev-parse', 'HEAD']);
  const baseRef = await resolveBaseRef(repoRoot, options.baseRef);
  const headRef = options.headRef ?? 'HEAD';
  const changedFiles = await getChangedFiles(repoRoot, baseRef, headRef);
  const dirtyFiles = await getDirtyFiles(repoRoot);
  const commitCount = await gitOptional(repoRoot, ['rev-list', '--count', `${baseRef}..${headRef}`]);
  return {
    current_branch: currentBranch || null,
    head_sha: headSha || null,
    base_ref: baseRef,
    head_ref: headRef,
    changed_files: changedFiles,
    dirty_files: dirtyFiles,
    commit_count: commitCount ? Number.parseInt(commitCount, 10) || 0 : 0
  };
}

async function resolveBaseRef(repoRoot, explicit) {
  if (explicit) return explicit;
  const symbolic = await gitOptional(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (symbolic) return symbolic;
  if (await gitRefExists(repoRoot, 'origin/main')) return 'origin/main';
  if (await gitRefExists(repoRoot, 'origin/master')) return 'origin/master';
  return 'main';
}

async function gitRefExists(repoRoot, ref) {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', ref], { cwd: repoRoot, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

async function getChangedFiles(repoRoot, baseRef, headRef) {
  const output = await gitOptional(repoRoot, ['diff', '--name-status', `${baseRef}...${headRef}`]);
  if (!output) return [];
  return output.split('\n').filter(Boolean).map((line) => {
    const [status, ...rest] = line.split('\t');
    return { status, path: rest[rest.length - 1] };
  });
}

async function getDirtyFiles(repoRoot) {
  const output = await gitOptional(repoRoot, ['status', '--porcelain']);
  if (!output) return [];
  return output.split('\n').filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim(),
    path: line.slice(3)
  }));
}

async function gitOptional(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// PR body rendering
// ---------------------------------------------------------------------------

function renderPrBody(preparation) {
  const { story, git, spec, spec_drift: specDrift, verification, review, story_source: storySource, traceability } = preparation;
  const lines = [];
  lines.push(`## ${story.title ?? story.story_id}`);
  lines.push('');
  lines.push(`Story: \`${story.story_id}\``);
  if (story.ssot) lines.push(`SSOT: ${story.ssot}`);
  lines.push('');
  lines.push('### Story document');
  if (storySource?.found) {
    lines.push(`- ${storySource.path}${storySource.title ? ` — ${storySource.title}` : ''}`);
  } else {
    lines.push('- no story document found (informational only; does not block PR creation)');
  }
  lines.push('');
  lines.push('### Acceptance criteria');
  const acceptanceCriteria = traceability?.acceptance_criteria ?? [];
  if (acceptanceCriteria.length === 0) {
    lines.push('- no acceptance criteria found in the story document');
  } else {
    for (const clause of acceptanceCriteria) {
      const marker = clause.status === 'unmapped' ? '未対応' : clause.status;
      lines.push(`- [${marker}] ${clause.id}: ${clause.text}`);
    }
  }
  lines.push('');
  lines.push('### Spec');
  lines.push(spec.present
    ? `- accepted spec present (\`${spec.story_id}\`, ${spec.clause_count} clause(s))`
    : '- no accepted spec found for this story');
  if (specDrift) {
    lines.push(`- drift: ${specDrift.status ?? 'unknown'} (${specDrift.item_count} item(s))`);
  }
  lines.push('');
  lines.push('### Development control');
  if (preparation.development_control) {
    const control = preparation.development_control;
    lines.push(`- mode: ${control.mode}`);
    lines.push(`- enforcement: ${control.enforcement}`);
    lines.push(`- intent: ${control.intent ?? '-'}`);
    lines.push(`- admission: ${control.admission?.status ?? '-'}`);
    lines.push(`- snapshot: ${control.projection?.snapshot_ref ?? '-'}`);
  } else {
    lines.push('- no development control projection');
  }
  lines.push('');
  lines.push('### Verification evidence');
  if (verification.recorded) {
    for (const command of verification.commands) {
      lines.push(`- [${command.kind}] ${command.status}${command.command ? ` — \`${command.command}\`` : ''}`);
    }
  } else {
    lines.push('- no verification evidence recorded (`vibepro verify run` / `vibepro verify record`)');
  }
  lines.push('');
  lines.push('### Review');
  if (review.recorded) {
    lines.push(`- status: ${review.status ?? 'unknown'} (pass=${review.summary?.pass ?? 0}, needs_review=${review.summary?.needs_review ?? 0}, block=${review.summary?.block ?? 0})`);
    for (const stage of review.stages) {
      lines.push(`  - ${stage.stage}: ${stage.status}${stage.roles.length ? ` (${stage.roles.join(', ')})` : ''}`);
    }
  } else {
    lines.push('- no review recorded (`vibepro review prepare` / `vibepro review record`)');
  }
  lines.push('');
  lines.push('### Changed files');
  if (git.changed_files.length > 0) {
    for (const file of git.changed_files.slice(0, 100)) {
      lines.push(`- ${file.status}\t${file.path}`);
    }
    if (git.changed_files.length > 100) lines.push(`- ... and ${git.changed_files.length - 100} more`);
  } else {
    lines.push('- (no diff against base)');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// createPullRequest
// ---------------------------------------------------------------------------

export async function createPullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const prepareResult = await preparePullRequest(root, options);
  const { preparation } = prepareResult;
  const currentBranch = preparation.git.current_branch;
  const headBranch = options.headBranch ?? currentBranch;
  if (!headBranch) {
    throw new Error('Current branch could not be resolved. Specify --head or run on a named branch.');
  }
  const baseBranch = stripRemote(options.prBase ?? preparation.git.base_ref);
  const title = options.title ?? buildPrTitle(preparation);
  const bodyFile = prepareResult.artifacts.pr_body;
  const dryRun = options.dryRun === true;
  const warnings = [];
  if (headBranch === baseBranch) {
    warnings.push(`head branch equals base branch: ${headBranch}`);
    if (!dryRun) {
      throw new Error(`Cannot create PR because head branch equals base branch: ${headBranch}. Switch to a feature branch or specify --head.`);
    }
  }

  const pushCommand = ['git', ['push', '-u', 'origin', headBranch]];
  const ghCreateCommand = ['gh', ['pr', 'create', '--base', baseBranch, '--head', headBranch, '--title', title, '--body-file', bodyFile]];
  const ghExistingPrListCommand = ['gh', [
    'pr', 'list', '--base', baseBranch, '--head', headBranch, '--state', 'open',
    '--json', 'number,url,state,isDraft,headRefName,headRefOid,baseRefName',
    '--limit', '1'
  ]];
  const createdAt = new Date().toISOString();
  const execution = {
    schema_version: SCHEMA_VERSION,
    created_at: createdAt,
    dry_run: dryRun,
    story: preparation.story,
    base: baseBranch,
    head: headBranch,
    title,
    body_file: toWorkspaceRelative(root, bodyFile),
    warnings,
    commands: [formatCommand(pushCommand), formatCommand(ghCreateCommand)],
    results: [],
    status: dryRun ? 'dry_run' : 'pending'
  };

  if (!dryRun) {
    const pushResult = await runCommand(root, pushCommand, options);
    execution.results.push(pushResult);
    if (pushResult.exit_code !== 0) {
      execution.status = 'failed';
      execution.error = `Command failed: ${pushResult.command}`;
      await writePrCreateArtifacts(root, prepareResult, execution);
      throw new Error(execution.error);
    }
    const ghResult = await runCommand(root, ghCreateCommand, options);
    execution.results.push(ghResult);
    if (ghResult.exit_code !== 0) {
      if (!isExistingPullRequestCreateError(ghResult)) {
        execution.status = 'failed';
        execution.error = `Command failed: ${ghResult.command}`;
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      execution.commands.push(formatCommand(ghExistingPrListCommand));
      const listResult = await runCommand(root, ghExistingPrListCommand, options);
      execution.results.push(listResult);
      const existingPr = parseExistingPullRequestFromList(listResult.stdout);
      if (listResult.exit_code !== 0 || !existingPr) {
        execution.status = 'failed';
        execution.error = 'Existing PR create response was returned, but no open PR matched the requested base/head.';
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      const editTarget = existingPr.url ?? (existingPr.number ? String(existingPr.number) : null);
      const ghEditCommand = ['gh', ['pr', 'edit', editTarget, '--title', title, '--body-file', bodyFile]];
      execution.commands.push(formatCommand(ghEditCommand));
      const editResult = await runCommand(root, ghEditCommand, options);
      execution.results.push(editResult);
      if (editResult.exit_code !== 0) {
        execution.status = 'failed';
        execution.error = `Existing PR body refresh failed: ${editResult.command}`;
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      execution.status = 'updated_existing_pr';
      execution.pr_url = existingPr.url ?? null;
      execution.warnings.push('Existing open PR detected for the requested base/head; refreshed its body instead of creating a duplicate PR.');
    } else {
      execution.status = 'created';
      execution.pr_url = extractPrUrl(ghResult.stdout);
    }
  }

  const artifacts = await writePrCreateArtifacts(root, prepareResult, execution);
  return {
    story: preparation.story,
    preparation,
    execution,
    artifacts: { ...prepareResult.artifacts, ...artifacts }
  };
}

function buildPrTitle(preparation) {
  return preparation.story?.title ?? preparation.story?.story_id ?? 'VibePro change';
}

function stripRemote(ref) {
  return String(ref ?? '').replace(/^origin\//, '');
}

function formatCommand(command) {
  const [bin, args] = command;
  return [bin, ...args.map(shellQuote)].join(' ');
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function runCommand(repoRoot, command, options = {}) {
  const [bin, args] = command;
  const startedAt = new Date().toISOString();
  try {
    const result = await execFileAsync(bin, args, { cwd: repoRoot, encoding: 'utf8', env: options.env });
    return {
      command: formatCommand(command),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    };
  } catch (error) {
    return {
      command: formatCommand(command),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: Number.isInteger(error.code) ? error.code : 1,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? error.message ?? '').trim()
    };
  }
}

function extractPrUrl(stdout) {
  const match = String(stdout ?? '').match(/https?:\/\/\S+/);
  return match?.[0] ?? null;
}

function isExistingPullRequestCreateError(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  return /pull request/i.test(text) && /(already|exist)/i.test(text);
}

function parseExistingPullRequestFromList(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const pr = Array.isArray(parsed) ? parsed[0] ?? null : (parsed && typeof parsed === 'object' ? parsed : null);
    if (!pr) return null;
    return {
      number: Number.isInteger(pr.number) ? pr.number : null,
      url: typeof pr.url === 'string' && pr.url ? pr.url : null
    };
  } catch {
    return null;
  }
}

async function writePrCreateArtifacts(repoRoot, prepareResult, execution) {
  const storyId = execution.story.story_id;
  const jsonPath = await resolvePrArtifactFile(repoRoot, storyId, 'pr-create.json');
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(execution, null, 2)}\n`, 'utf8');
  try {
    const manifest = await readManifest(repoRoot);
    manifest.pr_creations = {
      ...(manifest.pr_creations ?? {}),
      [storyId]: {
        latest_create: toWorkspaceRelative(repoRoot, jsonPath),
        latest_pr_url: execution.pr_url ?? null,
        latest_created_at: execution.created_at,
        latest_dry_run: execution.dry_run
      }
    };
    await writeManifest(repoRoot, manifest);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { pr_create_json: jsonPath };
}

// ---------------------------------------------------------------------------
// CLI rendering
// ---------------------------------------------------------------------------

export function renderPrPrepareSummary(result) {
  const { preparation } = result;
  const lines = [
    localizedText(preparation.output?.language, { ja: '# PR Prepare', en: '# PR Prepare' }),
    '',
    `- story: ${preparation.story.story_id}`,
    `- base: ${preparation.git.base_ref}`,
    `- head: ${preparation.git.head_ref} (${preparation.git.head_sha ?? '-'})`,
    `- changed files: ${preparation.git.changed_files.length}`,
    `- spec: ${preparation.spec.present ? 'present' : 'missing'}`,
    `- verification: ${preparation.verification.recorded ? `${preparation.verification.commands.length} command(s) recorded` : 'not recorded'}`,
    `- review: ${preparation.review.recorded ? (preparation.review.status ?? 'recorded') : 'not recorded'}`,
    `- artifacts: ${result.artifacts.json}, ${result.artifacts.pr_body}`,
    ''
  ];
  return `${lines.join('\n')}\n`;
}

export function renderPrCreateSummary(result) {
  const { execution } = result;
  const lines = [
    '# PR Create',
    '',
    `- story: ${execution.story.story_id}`,
    `- status: ${execution.status}`,
    `- base: ${execution.base}`,
    `- head: ${execution.head}`,
    `- pr_url: ${execution.pr_url ?? '-'}`,
    ...(execution.warnings.length > 0 ? ['- warnings:', ...execution.warnings.map((w) => `  - ${w}`)] : []),
    ''
  ];
  return `${lines.join('\n')}\n`;
}
