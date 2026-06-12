import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { recordVerificationEvidence } from './verification-evidence.js';

const execFileAsync = promisify(execFile);

const DEFAULT_CHECK_KIND_MATCHERS = [
  { pattern: /^test\b|^test\s*\(|^unit\b/i, kind: 'integration' }
];

// CI results are imported as the transcript of a real run, never synthesized:
// the head SHA must match the current checkout and only success conclusions
// become a passing claim. Importing is transcription, not observation.
export async function importCiEvidence(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId;
  if (!storyId) throw new Error('verify import-ci requires --id <story-id>');

  const currentHead = await gitHead(root);
  if (!currentHead) throw new Error('verify import-ci could not resolve the current git HEAD');

  const selector = options.pr ?? null;
  const view = await fetchPrChecks(root, selector, options.env);
  const ciHead = view.headRefOid ?? null;
  if (!ciHead || ciHead !== currentHead) {
    throw new Error(
      `verify import-ci rejected: CI head ${shortSha(ciHead)} does not match current HEAD ${shortSha(currentHead)}. ` +
      'Push the current commit and rerun after CI completes against it.'
    );
  }

  const mappings = parseCheckMappings(options.checks);
  const checks = normalizeChecks(view.statusCheckRollup);
  const imported = [];
  const skipped = [];
  const pending = [];
  const failures = [];

  for (const check of checks) {
    const kind = resolveCheckKind(check.name, mappings);
    if (!kind) {
      skipped.push({ check: check.name, reason: 'no kind mapping (use --check <name>=<kind>)' });
      continue;
    }
    if (String(check.status).toUpperCase() !== 'COMPLETED') {
      pending.push({ check: check.name, status: check.status, reason: 'CI check not completed' });
      continue;
    }
    if (String(check.conclusion).toUpperCase() !== 'SUCCESS') {
      failures.push({ check: check.name, conclusion: check.conclusion });
      continue;
    }
    const artifactPath = await writeCiArtifact(root, storyId, check, currentHead, view.url);
    await recordVerificationEvidence(root, {
      storyId,
      kind,
      status: 'pass',
      command: `CI ${check.workflow_name || check.name}: ${check.details_url || view.url || 'gh statusCheckRollup'}`,
      summary: `Imported CI evidence for ${check.name} (${check.conclusion}) at HEAD ${shortSha(currentHead)}`,
      artifact: toWorkspaceRelative(root, artifactPath),
      targets: [check.workflow_name || check.name],
      scenarios: [`CI run ${check.details_url || view.url || 'unknown'} succeeded at the current HEAD`],
      observed: [
        `check=${check.name}`,
        `conclusion=${check.conclusion}`,
        `run_url=${check.details_url || view.url || 'unknown'}`,
        `head_sha=${currentHead}`
      ],
      managedWorktreeContext: options.managedWorktreeContext ?? null,
      managedWorktreeWarning: options.managedWorktreeWarning ?? null
    });
    imported.push({ check: check.name, kind, status: 'pass', conclusion: check.conclusion, run_url: check.details_url || view.url || null });
  }

  return {
    schema_version: '0.1.0',
    story_id: storyId,
    head_sha: currentHead,
    pr: view.url ?? selector ?? null,
    imported,
    skipped,
    pending,
    failures
  };
}

export function renderCiImportSummary(result) {
  const lines = [
    '# VibePro CI Evidence Import',
    '',
    `- story: ${result.story_id}`,
    `- head: ${shortSha(result.head_sha)}`,
    `- pr: ${result.pr ?? '-'}`,
    `- imported: ${result.imported.length}`,
    `- skipped: ${result.skipped.length}`,
    `- pending: ${result.pending.length}`,
    `- failures: ${result.failures.length}`
  ];
  for (const item of result.imported) lines.push(`  - imported ${item.check} -> ${item.kind}`);
  for (const item of result.failures) lines.push(`  - FAILED ${item.check} (${item.conclusion}) — not imported as pass`);
  for (const item of result.pending) lines.push(`  - pending ${item.check} (${item.status})`);
  return `${lines.join('\n')}\n`;
}

async function writeCiArtifact(root, storyId, check, headSha, prUrl) {
  const dir = path.join(getWorkspaceDir(root), 'pr', storyId, 'ci-evidence');
  await mkdir(dir, { recursive: true });
  const fileName = `${check.name.replace(/[^a-z0-9._-]+/gi, '_')}.json`;
  const artifactPath = path.join(dir, fileName);
  const doc = {
    schema_version: '0.1.0',
    status: 'pass',
    exit_code: 0,
    head_sha: headSha,
    observed: {
      check: check.name,
      conclusion: check.conclusion,
      run_url: check.details_url || prUrl || null,
      head_sha: headSha
    },
    ci_check: check
  };
  await writeFile(artifactPath, `${JSON.stringify(doc, null, 2)}\n`);
  return artifactPath;
}

function parseCheckMappings(raw) {
  const mappings = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const text = String(entry);
    const separator = text.indexOf('=');
    const name = separator > 0 ? text.slice(0, separator).trim() : '';
    const kind = separator > 0 ? text.slice(separator + 1).trim() : '';
    if (!name || !kind) throw new Error(`verify import-ci --check must be name=kind, got: ${text}`);
    mappings.push({ name, kind });
  }
  return mappings;
}

function resolveCheckKind(checkName, mappings) {
  const explicit = mappings.find((mapping) => mapping.name === checkName);
  if (explicit) return explicit.kind;
  for (const matcher of DEFAULT_CHECK_KIND_MATCHERS) {
    if (matcher.pattern.test(checkName)) return matcher.kind;
  }
  return null;
}

function normalizeChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => ({
    name: check.name ?? check.context ?? 'unknown',
    status: check.status ?? 'UNKNOWN',
    conclusion: check.conclusion ?? '',
    workflow_name: check.workflowName ?? '',
    details_url: check.detailsUrl ?? null
  }));
}

async function fetchPrChecks(root, selector, env) {
  const args = ['pr', 'view'];
  if (selector) args.push(String(selector));
  args.push('--json', 'url,headRefName,headRefOid,baseRefName,statusCheckRollup');
  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd: root,
      encoding: 'utf8',
      env: env ?? process.env
    });
    return JSON.parse(stdout || '{}');
  } catch (error) {
    throw new Error(`verify import-ci could not read PR checks via gh: ${error.message}`);
  }
}

async function gitHead(root) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return null;
  }
}

function shortSha(value) {
  return String(value ?? 'unknown').slice(0, 12);
}
