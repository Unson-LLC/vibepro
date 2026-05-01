import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, MANIFEST_FILE, SCHEMA_VERSION, toWorkspaceRelative, writeManifest } from './workspace.js';

export async function runDoctor(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const workspaceDir = getWorkspaceDir(root);
  const manifestPath = path.join(workspaceDir, MANIFEST_FILE);
  const result = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: 'doctor',
    fix: Boolean(options.fix),
    workspace: {
      initialized: false,
      path: '.vibepro'
    },
    overall_status: 'pass',
    checks: [],
    repairs: [],
    artifacts: {}
  };

  const manifest = await readManifestIfExists(manifestPath);
  if (!manifest) {
    result.overall_status = 'uninitialized';
    result.checks.push({
      id: 'VP-DOCTOR-UNINITIALIZED',
      severity: 'info',
      status: 'info',
      fixable: false,
      detail: '.vibepro workspaceが見つからない。',
      recommendation: 'vibepro init を実行してworkspaceを作成する。'
    });
    return result;
  }

  result.workspace.initialized = true;
  const missingEvidence = await findMissingEvidenceRuns(root, manifest);
  if (missingEvidence.length > 0) {
    result.checks.push({
      id: 'VP-DOCTOR-MISSING-EVIDENCE',
      severity: 'warning',
      status: options.fix ? 'fixed' : 'fixable',
      fixable: true,
      detail: `${missingEvidence.length} 件の診断runが存在しないevidenceを参照している。`,
      recommendation: 'run成果物を復元するか、不要なrun参照をmanifestから整理する。',
      items: missingEvidence
    });
  }

  if (options.fix && missingEvidence.length > 0) {
    const repair = removeMissingEvidenceRuns(manifest, missingEvidence);
    await writeManifest(root, manifest);
    result.repairs.push(repair);
  }

  result.overall_status = resolveDoctorStatus(result);
  await writeDoctorArtifact(root, result);
  return result;
}

export function renderDoctor(result) {
  const checks = result.checks.length === 0
    ? '- なし'
    : result.checks.map((check) => `- ${check.id}: ${check.status} - ${check.detail}`).join('\n');
  const repairs = result.repairs.length === 0
    ? '- なし'
    : result.repairs.map((repair) => `- ${repair.id}: ${repair.detail}`).join('\n');
  return `# VibePro Doctor

| 項目 | 内容 |
|------|------|
| Initialized | ${result.workspace.initialized ? 'yes' : 'no'} |
| Overall | ${result.overall_status} |
| Fix | ${result.fix ? 'yes' : 'no'} |

## Checks

${checks}

## Repairs

${repairs}
`;
}

async function readManifestIfExists(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function findMissingEvidenceRuns(repoRoot, manifest) {
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  const missing = [];
  for (const run of runs) {
    const evidencePath = run.artifacts?.evidence;
    if (!evidencePath) continue;
    if (!await fileExists(path.resolve(repoRoot, evidencePath))) {
      missing.push({
        run_id: run.run_id,
        story_id: run.story_id ?? null,
        path: evidencePath
      });
    }
  }
  return missing;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function removeMissingEvidenceRuns(manifest, missingEvidence) {
  const missingIds = new Set(missingEvidence.map((item) => item.run_id));
  const beforeCount = Array.isArray(manifest.runs) ? manifest.runs.length : 0;
  manifest.runs = (manifest.runs ?? []).filter((run) => !missingIds.has(run.run_id));
  if (missingIds.has(manifest.latest_run)) {
    manifest.latest_run = manifest.runs[0]?.run_id ?? null;
  }
  if (manifest.latest_run_by_story) {
    manifest.latest_run_by_story = Object.fromEntries(Object.entries(manifest.latest_run_by_story)
      .filter(([, runId]) => !missingIds.has(runId)));
  }
  return {
    id: 'remove-missing-evidence-runs',
    detail: `${beforeCount - manifest.runs.length} 件の欠けた診断run参照をmanifestから除去した。`,
    removed_run_ids: [...missingIds]
  };
}

function resolveDoctorStatus(result) {
  if (!result.workspace.initialized) return 'uninitialized';
  if (result.checks.some((check) => check.status === 'fixable')) return 'needs_maintenance';
  if (result.checks.some((check) => check.status === 'fixed')) return 'fixed';
  return 'pass';
}

async function writeDoctorArtifact(repoRoot, result) {
  if (!result.workspace.initialized) return;
  const doctorDir = path.join(getWorkspaceDir(repoRoot), 'doctor');
  await mkdir(doctorDir, { recursive: true });
  const jsonPath = path.join(doctorDir, 'doctor-result.json');
  const markdownPath = path.join(doctorDir, 'doctor-result.md');
  result.artifacts = {
    json: toWorkspaceRelative(repoRoot, jsonPath),
    markdown: toWorkspaceRelative(repoRoot, markdownPath)
  };
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(markdownPath, renderDoctor(result));
}
