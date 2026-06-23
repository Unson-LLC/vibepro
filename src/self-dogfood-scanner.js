import { execFile } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

const TEXT_TARGETS = [
  'docs',
  'skills',
  'agent-instructions',
  '.github'
];

export async function scanSelfDogfood(root, options = {}) {
  const repoRoot = path.resolve(root);
  const workspaceDir = getWorkspaceDir(repoRoot);
  const storyFindings = await scanStoryGateArtifacts(repoRoot, workspaceDir, {
    storyId: options.storyId
  });
  const instructionFindings = await scanInstructionBypassLanguage(repoRoot, {
    storyId: options.storyId
  });
  const languageFindings = await scanHumanArtifactLanguage(repoRoot, workspaceDir, {
    storyId: options.storyId
  });
  const githubPrFindings = await scanCurrentGitHubPr(repoRoot, workspaceDir, {
    storyId: options.storyId,
    env: options.env
  });
  const findings = [...storyFindings, ...instructionFindings, ...languageFindings, ...githubPrFindings];
  const riskSummary = summarizeFindings(findings);
  return {
    schema_version: '0.1.0',
    status: riskSummary.block > 0 ? 'fail' : riskSummary.review > 0 ? 'needs_review' : 'pass',
    summary: {
      findings: findings.length,
      block: riskSummary.block,
      review: riskSummary.review,
      info: riskSummary.info
    },
    findings,
    risk_summary: {
      findings: riskSummary
    }
  };
}

async function scanHumanArtifactLanguage(repoRoot, workspaceDir, options = {}) {
  const config = await readJson(path.join(workspaceDir, 'config.json'));
  const language = config?.output?.language ?? 'ja';
  if (language !== 'ja') return [];
  if (!(await exists(workspaceDir))) return [];
  const files = await collectHumanArtifactFiles(workspaceDir);
  const scopedFiles = options.storyId
    ? files.filter((filePath) => filePath.includes(`${path.sep}${options.storyId}${path.sep}`) || filePath.includes(`${path.sep}${options.storyId}.`))
    : files;
  const findings = [];
  for (const filePath of scopedFiles) {
    const content = await readFile(filePath, 'utf8').catch(() => '');
    const matches = ENGLISH_FIXED_TEXT_PATTERNS
      .filter((item) => item.pattern.test(content))
      .map((item) => item.label);
    if (matches.length === 0) continue;
    findings.push({
      id: `self_dogfood.human_doc_language.${sanitizeFindingId(toWorkspaceRelative(repoRoot, filePath))}`,
      severity: 'medium',
      gate_effect: 'review',
      story_id: options.storyId ?? null,
      path: toWorkspaceRelative(repoRoot, filePath),
      detail: `Human-facing artifact was generated in a ja workspace but still contains fixed English text: ${matches.slice(0, 5).join(', ')}.`,
      required_action: 'Route this artifact renderer through output.language and localized fixed labels, or mark the detected text as machine-readable/externally sourced.'
    });
    if (findings.length >= 25) break;
  }
  return findings;
}

const ENGLISH_FIXED_TEXT_PATTERNS = [
  { label: 'VibePro Agent Review Request', pattern: /^# VibePro Agent Review Request/m },
  { label: 'VibePro Parallel Agent Review Dispatch', pattern: /^# VibePro Parallel Agent Review Dispatch/m },
  { label: 'Coordinator Instructions', pattern: /^## Coordinator Instructions/m },
  { label: 'Review Focus', pattern: /^## Review Focus/m },
  { label: 'Evidence Handling', pattern: /^## Evidence Handling/m },
  { label: 'Investigation Guidelines', pattern: /^## Investigation Guidelines/m },
  { label: 'If your coordinator runtime supports subagents', pattern: /If your coordinator runtime supports subagents/ },
  { label: 'VibePro Explore Dispatch', pattern: /^# VibePro Explore Dispatch/m },
  { label: 'VibePro Explore Request', pattern: /^# VibePro Explore Request/m },
  { label: 'Dispatch these read-only exploration requests', pattern: /Dispatch these read-only exploration requests/ },
  { label: 'Where To Look First', pattern: /Where To Look First/ },
  { label: 'What To Add Next', pattern: /What To Add Next/ },
  { label: 'Human-readable report', pattern: /Human-readable report/ },
  { label: 'VibePro Check Pack', pattern: /^# VibePro Check Pack/m },
  { label: 'Story Tasks', pattern: /^# Story Tasks/m },
  { label: 'Task Create', pattern: /^# Task Create/m },
  { label: 'Story Task', pattern: /^# Story Task/m },
  { label: 'Target Groups', pattern: /^## Target Groups/m },
  { label: 'Source Recovery', pattern: /^## Source Recovery/m },
  { label: 'Source Alignment Findings', pattern: /^## Source Alignment Findings/m },
  { label: 'Product Semantics', pattern: /^## Product Semantics/m },
  { label: 'Evidence Coverage', pattern: /^## Evidence Coverage/m },
  { label: 'Design System Validation', pattern: /^# Design System Validation:/m },
  { label: 'Authority Boundary', pattern: /^## Authority Boundary/m },
  { label: 'Design Language', pattern: /^## Design Language/m },
  { label: 'Color Roles', pattern: /^## Color Roles/m }
];

async function collectHumanArtifactFiles(dir) {
  const results = [];
  if (!(await exists(dir))) return results;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectHumanArtifactFiles(entryPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.md') || entry.name.endsWith('.html')) {
      results.push(entryPath);
    }
  }
  return results;
}

async function scanStoryGateArtifacts(repoRoot, workspaceDir, options = {}) {
  const prDir = path.join(workspaceDir, 'pr');
  if (!(await exists(prDir))) return [];
  const entries = await readdir(prDir, { withFileTypes: true });
  const findings = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const storyId = entry.name;
    if (options.storyId && storyId !== options.storyId) continue;
    const storyPrDir = path.join(prDir, storyId);
    const verificationPath = path.join(storyPrDir, 'verification-evidence.json');
    const preparePath = path.join(storyPrDir, 'pr-prepare.json');
    const gateDagPath = path.join(storyPrDir, 'gate-dag.json');
    const createPath = path.join(storyPrDir, 'pr-create.json');
    const hasVerification = await exists(verificationPath);
    const hasPrepare = await exists(preparePath);
    const hasGateDag = await exists(gateDagPath);
    const hasCreate = await exists(createPath);
    const hasSummaryGateContract = hasPrepare && !hasGateDag
      ? await hasSummaryDepthFinalGateContract(storyPrDir, storyId)
      : false;
    if (hasVerification && (!hasPrepare || (!hasGateDag && !hasSummaryGateContract))) {
      findings.push({
        id: `self_dogfood.final_gate_missing.${storyId}`,
        severity: 'high',
        gate_effect: 'review',
        story_id: storyId,
        path: toWorkspaceRelative(repoRoot, storyPrDir),
        detail: hasPrepare
          ? 'Verification evidence and pr-prepare.json exist, but neither gate-dag.json nor the summary-depth decision-index contract is present. Do not treat verify record as completion.'
          : 'Verification evidence exists, but final pr-prepare/gate-dag artifacts are missing. Do not treat verify record as completion.',
        required_action: `Run \`vibepro pr prepare . --story-id ${storyId} --base <base-ref>\` after recording verification evidence, or ensure summary depth writes evidence-plan.json plus decision-index.json.`
      });
    }
    if (hasGateDag) {
      const gateDag = await readJson(gateDagPath);
      if (!gateDag) {
        findings.push({
          id: `self_dogfood.invalid_gate_dag.${storyId}`,
          severity: 'critical',
          gate_effect: 'block',
          story_id: storyId,
          path: toWorkspaceRelative(repoRoot, gateDagPath),
          detail: 'Final Gate DAG artifact exists but is not valid JSON. Do not treat malformed gate evidence as completion.',
          required_action: 'Regenerate the final gate evidence with `vibepro pr prepare` and inspect any corrupt artifact before PR creation.'
        });
        continue;
      }
      if (gateDag.overall_status !== 'ready_for_review') {
        findings.push({
          id: `self_dogfood.unresolved_gate_dag.${storyId}`,
          severity: isCriticalGateDag(gateDag) ? 'critical' : 'medium',
          gate_effect: isCriticalGateDag(gateDag) ? 'block' : 'review',
          story_id: storyId,
          path: toWorkspaceRelative(repoRoot, gateDagPath),
          detail: `Final Gate DAG is ${gateDag.overall_status}; unresolved required gates remain.`,
          required_action: 'Resolve required gates, split scope, or record an auditable non-critical waiver through vibepro pr create.'
        });
      }
    }
    if (hasCreate) {
      const prCreate = await readJson(createPath);
      const gateDag = hasGateDag ? await readJson(gateDagPath) : null;
      const gate = prCreate?.execution?.gate_dag?.overall_status
        ?? prCreate?.gate_dag?.overall_status
        ?? gateDag?.overall_status
        ?? null;
      const gateOverrideAllowed = isAuditableGateOverride(prCreate?.execution?.gate_override)
        || isAuditableGateOverride(prCreate?.gate_override);
      if (gate && gate !== 'ready_for_review' && !gateOverrideAllowed) {
        findings.push({
          id: `self_dogfood.pr_create_without_gate_override.${storyId}`,
          severity: 'critical',
          gate_effect: 'block',
          story_id: storyId,
          path: toWorkspaceRelative(repoRoot, createPath),
          detail: `PR create evidence exists while Gate DAG is ${gate} and no VibePro waiver was recorded.`,
          required_action: 'Use vibepro pr create so unresolved gates and waiver reasons are captured.'
        });
      }
    }
  }
  return findings;
}

async function hasSummaryDepthFinalGateContract(storyPrDir, storyId) {
  const evidencePlan = await readJson(path.join(storyPrDir, 'evidence-plan.json'));
  const decisionIndex = await readJson(path.join(storyPrDir, 'decision-index.json'));
  if (!evidencePlan || !decisionIndex) return false;
  if (evidencePlan.evidence_depth !== 'summary' || decisionIndex.evidence_depth !== 'summary') return false;
  if (decisionIndex.story_id && decisionIndex.story_id !== storyId) return false;

  const generatedArtifacts = new Set(evidencePlan.generated_artifacts ?? evidencePlan.artifact_policy?.generated_artifacts ?? []);
  const skippedArtifacts = new Set(evidencePlan.skipped_artifacts ?? evidencePlan.artifact_policy?.skipped_artifacts ?? []);
  const gateDagExplicitlySkipped = evidencePlan.artifact_policy?.write_full_gate_dag_dump === false
    || skippedArtifacts.has('gate-dag.json');
  if (!gateDagExplicitlySkipped) return false;
  if (!generatedArtifacts.has('evidence-plan.json') || !generatedArtifacts.has('decision-index.json')) return false;

  return Boolean(decisionIndex.gate_summary && decisionIndex.engineering_judgment);
}

async function scanCurrentGitHubPr(repoRoot, workspaceDir, options = {}) {
  const currentPr = await readCurrentGitHubPr(repoRoot, options);
  if (!currentPr) return [];

  const findings = [];
  const body = typeof currentPr.body === 'string' ? currentPr.body : '';
  const prLabel = currentPr.number ? `#${currentPr.number}` : currentPr.url ?? currentPr.headRefName ?? 'current branch';
  const idSuffix = sanitizeFindingId(currentPr.headRefName ?? String(currentPr.number ?? 'current'));

  if (body.trim().length === 0 || !isVibeProPrBody(body)) {
    findings.push({
      id: `self_dogfood.github_pr_non_vibepro_body.${idSuffix}`,
      severity: 'critical',
      gate_effect: 'block',
      story_id: options.storyId ?? null,
      path: currentPr.url ?? null,
      detail: `GitHub PR ${prLabel} does not look like a VibePro PR body; decision brief, Gate DAG, or Execution Gate sections are missing.`,
      required_action: 'Regenerate the PR body through `vibepro pr prepare`, then create or update the PR through `vibepro pr create` so Gate evidence is visible.'
    });
  }

  if (hasEscapedNewlinePrBody(body)) {
    findings.push({
      id: `self_dogfood.github_pr_body_escaped_newlines.${idSuffix}`,
      severity: 'critical',
      gate_effect: 'block',
      story_id: options.storyId ?? null,
      path: currentPr.url ?? null,
      detail: `GitHub PR ${prLabel} contains literal escaped newline sequences, which usually means the PR body was passed inline instead of through VibePro's body file.`,
      required_action: 'Update the PR body from the generated VibePro `pr-body.md` artifact instead of passing a raw escaped string.'
    });
  }

  const matchingEvidence = await findMatchingPrCreateEvidence(repoRoot, workspaceDir, currentPr, options);
  if (!matchingEvidence) {
    findings.push({
      id: `self_dogfood.github_pr_missing_vibepro_create.${idSuffix}`,
      severity: 'critical',
      gate_effect: 'block',
      story_id: options.storyId ?? null,
      path: toWorkspaceRelative(repoRoot, path.join(workspaceDir, 'pr')),
      detail: `GitHub PR ${prLabel} is visible, but no matching .vibepro/pr pr-create.json evidence was found for this PR or head branch.`,
      required_action: 'Run `vibepro pr create` for the Story so GitHub PR creation, Gate DAG, waiver policy, and toolchain evidence are recorded together.'
    });
  }

  return findings;
}

async function readCurrentGitHubPr(repoRoot, options = {}) {
  try {
    const result = await execFileAsync('gh', ['pr', 'view', '--json', 'number,url,headRefName,headRefOid,body'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: options.env ?? process.env,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    const parsed = JSON.parse(result.stdout);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isVibeProPrBody(body) {
  const hasDecisionBrief = /(##\s+このPRで決めたいこと|##\s+What this PR needs to decide|このPRで閉じる問い|Review question)/i.test(body);
  return hasDecisionBrief && /##\s+Gate DAG/i.test(body) && /##\s+Execution Gate/i.test(body);
}

function hasEscapedNewlinePrBody(body) {
  if (!body.includes('\\n')) return false;
  const realNewlines = (body.match(/\n/g) ?? []).length;
  const escapedNewlines = (body.match(/\\n/g) ?? []).length;
  return escapedNewlines > 0 && realNewlines <= 1;
}

async function findMatchingPrCreateEvidence(repoRoot, workspaceDir, currentPr, options = {}) {
  const prDir = path.join(workspaceDir, 'pr');
  if (!(await exists(prDir))) return null;
  const entries = await readdir(prDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const storyId = entry.name;
    if (options.storyId && storyId !== options.storyId) continue;
    const createPath = path.join(prDir, storyId, 'pr-create.json');
    if (!(await exists(createPath))) continue;
    const prCreate = await readJson(createPath);
    if (isValidPrCreateEvidence(prCreate, currentPr) && matchesCurrentPr(prCreate, currentPr)) {
      return { story_id: storyId, path: toWorkspaceRelative(repoRoot, createPath), evidence: prCreate };
    }
  }
  return null;
}

function isValidPrCreateEvidence(prCreate, currentPr) {
  if (!prCreate || prCreate.mode !== 'pr_create') return false;
  if (prCreate.dry_run === true) return false;
  if (prCreate.status === 'failed' || prCreate.error) return false;

  const currentUrl = normalizeUrl(currentPr?.url);
  if (currentUrl && normalizeUrl(prCreate.pr_url) !== currentUrl) return false;

  const currentHeadOid = typeof currentPr?.headRefOid === 'string' ? currentPr.headRefOid.trim() : '';
  if (currentHeadOid) {
    return prCreate.toolchain?.source_git?.commit === currentHeadOid;
  }

  const results = Array.isArray(prCreate.results) ? prCreate.results : [];
  if (results.length === 0) return Boolean(normalizeUrl(prCreate.pr_url));
  const ghCreateResult = results.find((result) => /(^|\s)gh pr create(\s|$)/.test(result?.command ?? ''));
  return ghCreateResult?.exit_code === 0;
}

function matchesCurrentPr(prCreate, currentPr) {
  if (!prCreate || !currentPr) return false;
  const prUrl = normalizeUrl(prCreate.pr_url);
  const currentUrl = normalizeUrl(currentPr.url);
  if (prUrl && currentUrl && prUrl === currentUrl) return true;

  const head = typeof prCreate.head === 'string' ? prCreate.head : '';
  if (head && currentPr.headRefName && head === currentPr.headRefName) return true;

  const branch = prCreate.toolchain?.source_git?.branch;
  if (branch && currentPr.headRefName && branch === currentPr.headRefName) return true;

  return false;
}

function normalizeUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/$/, '') : '';
}

function sanitizeFindingId(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'current';
}

function isAuditableGateOverride(override) {
  if (!override || override.allowed !== true) return false;
  const reason = typeof override.reason === 'string' ? override.reason.trim() : '';
  const policy = typeof override.waiver_policy === 'string' ? override.waiver_policy.trim() : '';
  return reason.length > 0 && policy.length > 0;
}

async function scanInstructionBypassLanguage(repoRoot, options = {}) {
  const files = [];
  for (const target of TEXT_TARGETS) {
    const targetPath = path.join(repoRoot, target);
    if (await exists(targetPath)) {
      await collectTextFiles(targetPath, files);
    }
  }
  const findings = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const rel = toWorkspaceRelative(repoRoot, file);
    if (options.storyId && !text.includes(options.storyId) && !rel.includes(options.storyId)) continue;
    const checks = [
      {
        id: 'self_dogfood.agent_review_skip_language',
        pattern: /Agent Review Gate[^\n]{0,80}\b(skip|スキップ)\b/i,
        severity: 'critical',
        gate_effect: 'block',
        detail: 'Instruction text suggests skipping Agent Review Gate.'
      },
      {
        id: 'self_dogfood.raw_gh_pr_create_guidance',
        pattern: /(?:^|\n)[^\n]*(?:raw\s+)?`?gh pr create`?[^\n]*(?:use|使|作成|direct|直接)/i,
        severity: 'high',
        gate_effect: 'review',
        detail: 'Instruction text can route PR creation through raw gh pr create instead of VibePro.'
      },
      {
        id: 'self_dogfood.subagent_permission_waiting_language',
        pattern: /(ask exactly|明示.*許可|explicit user authorization|explicit permission is still required|permission-request\.md)/i,
        severity: 'high',
        gate_effect: 'review',
        detail: 'Instruction text can make Agent Review Gate look like a user-permission wait instead of an autonomous subagent dispatch contract.'
      }
    ];
    for (const check of checks) {
      if (hasInstructionFinding(text, check.pattern)) {
        findings.push({
          id: `${check.id}.${rel}`,
          severity: check.severity,
          gate_effect: check.gate_effect,
          path: rel,
          detail: check.detail,
          required_action: 'Rewrite the instruction to dispatch permitted Codex/Claude Code subagents by default and reserve human approval for policy blockers or waivers.'
        });
      }
    }
  }
  return findings;
}

function hasInstructionFinding(text, pattern) {
  return text.split(/\r?\n/).some((line) => {
    if (!pattern.test(line)) return false;
    if (/\b(do not|don't|never|禁止|使わない|使わず|直接.*使わない|バイパスしない)\b/i.test(line)) return false;
    if (/(使わない|使わず|直接.*使わない|ではなく|instead of|rather than|検出|検査|診断|finding|scanner|diagnostic|detect|flag|実行予定|標準出力|外部コマンド)/i.test(line)) return false;
    return true;
  });
}

async function collectTextFiles(dir, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      await collectTextFiles(fullPath, files);
      continue;
    }
    if (/\.(md|txt|yml|yaml|json)$/.test(entry.name)) files.push(fullPath);
  }
}

function isCriticalGateDag(gateDag) {
  return (gateDag.nodes ?? []).some((node) => node.required === true && [
    'story',
    'architecture_gate',
    'spec_gate',
    'verification_gate',
    'requirement_gate',
    'visual_qa_gate',
    'agent_review_gate',
    'pr_freshness_gate'
  ].includes(node.type) && [
    'missing',
    'implicit',
    'inferred_empty',
    'needs_evidence',
    'needs_setup',
    'needs_review',
    'needs_changes',
    'contradicted',
    'stale',
    'needs_rebase',
    'block',
    'failed'
  ].includes(node.status));
}

function summarizeFindings(findings) {
  return findings.reduce((summary, finding) => {
    const effect = ['block', 'review', 'info'].includes(finding.gate_effect) ? finding.gate_effect : 'info';
    summary[effect] += 1;
    return summary;
  }, { block: 0, review: 0, info: 0 });
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
