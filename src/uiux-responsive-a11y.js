import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MATRIX_SCHEMA_VERSION = '0.1.0';
const ACCESSIBILITY_STATUSES = new Set([
  'pass',
  'fail',
  'needs_setup',
  'auth_required',
  'resource_unavailable',
  'missing'
]);
const DEFAULT_VIEWPORTS = [
  { id: 'mobile', width: 390, height: 844 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', width: 1440, height: 900 }
];

export async function createResponsiveA11yMatrix(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options);
  const outDir = path.join(root, '.vibepro', 'uiux', storyId);
  const matrixPath = path.join(outDir, 'responsive-a11y-matrix.json');
  const markdownPath = path.join(outDir, 'responsive-a11y-matrix.md');
  const gitHead = await resolveGeneratedHeadSha(root);
  const routes = normalizeRoutes(options.routes);
  const viewports = normalizeViewports(options.viewports);
  const recordedEvidence = await collectRecordedEvidence(root, {
    storyId,
    sourcePath: options.sourcePath ?? options.from ?? options.visualResidual
  });
  const matrix = buildResponsiveA11yMatrix({
    storyId,
    gitHead,
    routes,
    viewports,
    recordedEvidence
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
  await writeFile(markdownPath, renderResponsiveA11yMatrixMarkdown(matrix));

  return {
    outDir,
    artifact: toRepoPath(root, matrixPath),
    markdown_artifact: toRepoPath(root, markdownPath),
    matrix
  };
}

export async function readResponsiveA11yMatrixForPr(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  const candidate = path.join(root, '.vibepro', 'uiux', storyId, 'responsive-a11y-matrix.json');
  try {
    const matrix = JSON.parse(await readFile(candidate, 'utf8'));
    return summarizeResponsiveA11yMatrixForPr(matrix, toRepoPath(root, candidate));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      status: 'missing',
      artifact: `.vibepro/uiux/${storyId}/responsive-a11y-matrix.json`,
      missing_evidence_count: null,
      reason: 'Run `vibepro uiux evidence <repo> --id <story-id>` for UI-heavy stories before PR evidence is finalized.'
    };
  }
}

export function renderResponsiveA11yMatrixSummary({ outDir, artifact, markdown_artifact: markdownArtifact, matrix }) {
  return `# UI/UX Responsive Accessibility Evidence Matrix

| Item | Value |
|------|-------|
| Story | ${matrix.story_id} |
| Status | ${matrix.status} |
| Generated HEAD | ${matrix.generated_head_sha ?? 'unavailable'} |
| Routes | ${matrix.routes.length} |
| Viewports | ${matrix.viewports.length} |
| Rows | ${matrix.rows.length} |
| Missing evidence | ${matrix.missing_evidence.length} |
| Artifact | ${artifact} |
| Markdown | ${markdownArtifact} |
| Output | ${outDir} |

## Visual Residual Authority

- Status: ${matrix.visual_residual_authority.status}
- Artifact: ${matrix.visual_residual_authority.artifact ?? '-'}

## Missing Evidence

${matrix.missing_evidence.length === 0 ? '- none' : matrix.missing_evidence.map((item) => `- ${item.route ?? '-'} ${item.viewport ?? '-'} ${item.state ?? '-'}: ${item.missing_fields.join(', ')}`).join('\n')}
`;
}

export function renderResponsiveA11yMatrixMarkdown(matrix) {
  const rows = matrix.rows.map((row) => [
    row.route ?? '-',
    row.viewport?.id ?? row.viewport ?? '-',
    row.state ?? '-',
    row.status,
    row.screenshot_artifact ?? '-',
    row.overflow_overlap_result?.status ?? '-',
    row.keyboard_focus_result?.status ?? '-',
    row.accessibility_result?.status ?? '-',
    row.git_head ?? '-'
  ]);
  return `# ${matrix.story_id} Responsive Accessibility Evidence Matrix

## Summary

- Status: ${matrix.status}
- Generated HEAD: ${matrix.generated_head_sha ?? 'unavailable'}
- Routes: ${matrix.routes.join(', ') || '-'}
- Viewports: ${matrix.viewports.map((viewport) => `${viewport.id}:${viewport.width}x${viewport.height}`).join(', ')}
- Missing evidence: ${matrix.missing_evidence.length}
- Visual residual authority: ${matrix.visual_residual_authority.status} ${matrix.visual_residual_authority.artifact ?? ''}

## Rows

| Route | Viewport | State | Status | Screenshot | Overflow/Overlap | Keyboard/Focus | Accessibility | Git HEAD |
|-------|----------|-------|--------|------------|------------------|----------------|---------------|----------|
${rows.length === 0 ? '| - | - | - | missing | - | - | - | missing | - |' : rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`).join('\n')}

## Missing Evidence

${matrix.missing_evidence.length === 0 ? '- none' : matrix.missing_evidence.map((item) => `- ${item.route ?? '-'} ${item.viewport ?? '-'} ${item.state ?? '-'}: ${item.missing_fields.join(', ')}`).join('\n')}
`;
}

function buildResponsiveA11yMatrix({ storyId, gitHead, routes, viewports, recordedEvidence }) {
  const records = normalizeEvidenceRecords(recordedEvidence);
  const targetRoutes = routes.length > 0
    ? routes
    : [...new Set(records.map((record) => record.route).filter(Boolean))];
  const rows = [];
  if (targetRoutes.length === 0) {
    rows.push(buildMatrixRow({
      storyId,
      route: null,
      viewport: null,
      state: null,
      record: records[0] ?? null,
      evidenceSource: recordedEvidence.source
    }));
  } else {
    for (const route of targetRoutes) {
      for (const viewport of viewports) {
        const record = findEvidenceRecord(records, { route, viewport });
        rows.push(buildMatrixRow({
          storyId,
          route,
          viewport,
          state: record?.state ?? 'default',
          record,
          evidenceSource: recordedEvidence.source
        }));
      }
    }
  }

  const missingEvidence = rows
    .filter((row) => row.missing_fields.length > 0 || row.status !== 'pass')
    .map((row) => ({
      route: row.route,
      viewport: row.viewport?.id ?? row.viewport ?? null,
      state: row.state,
      status: row.status,
      missing_fields: row.missing_fields,
      reason: row.status === 'pass' ? null : row.status
    }));
  const accessibilityChecks = rows.map((row) => ({
    route: row.route,
    viewport: row.viewport?.id ?? row.viewport ?? null,
    state: row.state,
    status: row.accessibility_result.status,
    artifact: row.accessibility_result.artifact ?? null,
    command: row.command ?? null
  }));

  return {
    schema_version: MATRIX_SCHEMA_VERSION,
    workflow: 'uiux-responsive-a11y-evidence-matrix',
    story_id: storyId,
    generated_at: new Date().toISOString(),
    generated_head_sha: gitHead,
    generated_git_context: {
      head_sha: gitHead,
      status: gitHead ? 'recorded' : 'unavailable'
    },
    status: missingEvidence.length === 0 ? 'ready' : 'needs_evidence',
    routes: targetRoutes,
    viewports,
    visual_residual_authority: {
      status: recordedEvidence.visualResidualStatus ?? 'missing',
      artifact: recordedEvidence.artifact ?? null,
      note: 'Visual residual analysis remains authoritative when present; this matrix organizes proof and does not waive residual findings.'
    },
    source_evidence: recordedEvidence.source,
    accessibility_checks: accessibilityChecks,
    missing_evidence: missingEvidence,
    rows
  };
}

function buildMatrixRow({ storyId, route, viewport, state, record, evidenceSource }) {
  const screenshotArtifact = record?.screenshot_artifact ?? record?.current_screenshot ?? record?.screenshot ?? null;
  const command = record?.command ?? null;
  const evidenceRoute = record ? (record.route ?? record.path ?? record.probe_path ?? null) : null;
  const evidenceViewport = record ? normalizeViewportObject(record.viewport ?? record.viewport_id) : null;
  const evidenceState = record ? (record.state ?? null) : null;
  const evidenceGitHead = record ? (record.git_head ?? record.generated_head_sha ?? null) : null;
  const rowGitHead = evidenceGitHead;
  const accessibilityStatus = normalizeAccessibilityStatus(
    record?.accessibility_result?.status ?? record?.accessibility_status ?? record?.a11y_status
  );
  const overflowStatus = normalizeCheckStatus(record?.overflow_overlap_result?.status ?? record?.overflow_overlap_status ?? record?.visual_status);
  const keyboardStatus = normalizeCheckStatus(record?.keyboard_focus_result?.status ?? record?.keyboard_focus_status);
  const resolvedRoute = evidenceRoute ?? route;
  const resolvedViewport = evidenceViewport ?? viewport;
  const resolvedState = evidenceState ?? state;
  const missingFields = [];
  if (!evidenceRoute) missingFields.push('route');
  if (!evidenceViewport?.id) missingFields.push('viewport');
  if (!evidenceState) missingFields.push('state');
  if (!screenshotArtifact) missingFields.push('screenshot_artifact');
  if (!command) missingFields.push('command');
  if (!evidenceGitHead) missingFields.push('git_head');
  if (accessibilityStatus === 'missing') missingFields.push('accessibility_result');

  const status = determineRowStatus({
    missingFields,
    accessibilityStatus,
    overflowStatus,
    keyboardStatus
  });

  return {
    story_id: storyId,
    route: resolvedRoute ?? null,
    screen: record?.screen ?? resolvedRoute ?? null,
    viewport: resolvedViewport,
    state: resolvedState ?? null,
    status,
    screenshot_artifact: screenshotArtifact,
    overflow_overlap_result: {
      status: overflowStatus,
      artifact: record?.overflow_overlap_result?.artifact ?? evidenceSource?.artifact ?? null
    },
    keyboard_focus_result: {
      status: keyboardStatus,
      artifact: record?.keyboard_focus_result?.artifact ?? null
    },
    accessibility_result: {
      status: accessibilityStatus,
      artifact: record?.accessibility_result?.artifact ?? null
    },
    command,
    git_head: rowGitHead,
    missing_fields: missingFields,
    evidence_source: evidenceSource
  };
}

function determineRowStatus({ missingFields, accessibilityStatus, overflowStatus, keyboardStatus }) {
  if (missingFields.length > 0) return 'needs_evidence';
  for (const status of [accessibilityStatus, overflowStatus, keyboardStatus]) {
    if (['needs_setup', 'auth_required', 'resource_unavailable'].includes(status)) return status;
    if (status === 'fail') return 'fail';
    if (status === 'missing') return 'needs_evidence';
    if (status !== 'pass') return 'needs_evidence';
  }
  return 'pass';
}

async function collectRecordedEvidence(repoRoot, { storyId, sourcePath }) {
  const candidates = [];
  if (sourcePath) candidates.push(sourcePath);
  candidates.push(
    path.join('.vibepro', 'qa', storyId, 'visual-residual.json'),
    path.join('.vibepro', 'qa', `${storyId}-visual`, 'visual-residual.json')
  );

  for (const candidate of candidates) {
    const absolutePath = path.isAbsolute(candidate) ? candidate : path.join(repoRoot, candidate);
    try {
      const data = JSON.parse(await readFile(absolutePath, 'utf8'));
      return {
        artifact: toRepoPath(repoRoot, absolutePath),
        visualResidualStatus: data.status ?? data.summary?.status ?? 'available',
        source: {
          type: data.artifact_kind === 'visual_residual' || /visual-residual\.json$/.test(candidate) ? 'visual_residual' : 'recorded_evidence',
          artifact: toRepoPath(repoRoot, absolutePath)
        },
        data
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {
    artifact: null,
    visualResidualStatus: 'missing',
    source: { type: 'missing_recorded_evidence', artifact: null },
    data: null
  };
}

function normalizeEvidenceRecords(recordedEvidence) {
  const data = recordedEvidence.data;
  if (!data) return [];
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.matrix_rows)) return data.matrix_rows;
  if (Array.isArray(data.responsive_a11y_rows)) return data.responsive_a11y_rows;
  if (Array.isArray(data.screenshots)) return data.screenshots.map((item) => normalizeCaptureRecord(item, recordedEvidence));
  if (Array.isArray(data.probes)) return data.probes.map((probe) => normalizeProbeRecord(probe, data, recordedEvidence));
  return [data];
}

function normalizeCaptureRecord(item, recordedEvidence) {
  return {
    ...item,
    screenshot_artifact: item.artifact ?? item.path ?? item.screenshot_artifact,
    visual_status: normalizeCheckStatus(item.status),
    command: item.command ?? recordedEvidence.data?.command ?? null,
    git_head: item.git_head ?? recordedEvidence.data?.git_context?.head_sha ?? recordedEvidence.data?.generated_head_sha ?? null
  };
}

function normalizeProbeRecord(probe, data, recordedEvidence) {
  return {
    route: probe.route ?? probe.path ?? probe.probe_path ?? null,
    screen: probe.title ?? probe.probe_id ?? probe.id ?? null,
    viewport: probe.viewport ?? probe.viewport_id ?? null,
    state: probe.state ?? 'default',
    screenshot_artifact: probe.current_screenshot ?? probe.screenshot_artifact ?? null,
    overflow_overlap_status: probe.overflow_overlap_status ?? probe.status ?? data.status,
    keyboard_focus_status: probe.keyboard_focus_status ?? 'missing',
    accessibility_status: probe.accessibility_status ?? 'missing',
    command: probe.command ?? data.command ?? null,
    git_head: probe.git_head ?? data.git_context?.head_sha ?? data.generated_head_sha ?? null,
    evidence_source: recordedEvidence.source
  };
}

function findEvidenceRecord(records, { route, viewport }) {
  return records.find((record) => {
    const recordRoute = record?.route ?? record?.path ?? record?.probe_path;
    const recordViewport = normalizeViewportObject(record?.viewport ?? record?.viewport_id);
    return recordRoute === route && recordViewport?.id === viewport.id;
  }) ?? records.find((record) => {
    const recordRoute = record?.route ?? record?.path ?? record?.probe_path;
    return recordRoute === route && !record?.viewport;
  }) ?? null;
}

function normalizeRoutes(routes = []) {
  if (!Array.isArray(routes)) return [];
  return [...new Set(routes.map((route) => String(route).trim()).filter(Boolean))];
}

function normalizeViewports(viewports = []) {
  const normalized = viewports.map(normalizeViewportObject).filter(Boolean);
  return normalized.length > 0 ? normalized : DEFAULT_VIEWPORTS;
}

function normalizeViewportObject(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    const id = String(value.id ?? value.name ?? '').trim();
    if (!id) return null;
    return {
      id,
      width: Number(value.width ?? value.w ?? 0) || null,
      height: Number(value.height ?? value.h ?? 0) || null
    };
  }
  const text = String(value).trim();
  const match = text.match(/^([^:]+):(\d+)x(\d+)$/);
  if (match) {
    return { id: match[1], width: Number(match[2]), height: Number(match[3]) };
  }
  const preset = DEFAULT_VIEWPORTS.find((viewport) => viewport.id === text);
  return preset ? { ...preset } : { id: text, width: null, height: null };
}

function normalizeAccessibilityStatus(status) {
  const normalized = String(status ?? 'missing').toLowerCase();
  return ACCESSIBILITY_STATUSES.has(normalized) ? normalized : 'missing';
}

function normalizeCheckStatus(status) {
  const normalized = String(status ?? 'missing').toLowerCase();
  if (['ready', 'ready_for_review', 'ok', 'passed'].includes(normalized)) return 'pass';
  if (ACCESSIBILITY_STATUSES.has(normalized)) return normalized;
  if (normalized === 'needs_review' || normalized === 'baseline_missing') return 'fail';
  return 'missing';
}

function summarizeResponsiveA11yMatrixForPr(matrix, artifact) {
  const missing = Array.isArray(matrix.missing_evidence) ? matrix.missing_evidence.length : 0;
  return {
    status: matrix.status ?? 'available',
    artifact,
    matrix_status: matrix.status ?? null,
    generated_head_sha: matrix.generated_head_sha ?? null,
    route_count: Array.isArray(matrix.routes) ? matrix.routes.length : 0,
    viewport_count: Array.isArray(matrix.viewports) ? matrix.viewports.length : 0,
    row_count: Array.isArray(matrix.rows) ? matrix.rows.length : 0,
    accessibility_check_count: Array.isArray(matrix.accessibility_checks) ? matrix.accessibility_checks.length : 0,
    missing_evidence_count: missing,
    missing_evidence: Array.isArray(matrix.missing_evidence) ? matrix.missing_evidence.slice(0, 10) : [],
    visual_residual_status: matrix.visual_residual_authority?.status ?? null,
    visual_residual_artifact: matrix.visual_residual_authority?.artifact ?? null
  };
}

async function resolveGeneratedHeadSha(repoRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD']);
    const headSha = stdout.trim();
    return headSha || null;
  } catch {
    return null;
  }
}

function requireStoryId(options) {
  const storyId = options.storyId ?? options.id;
  if (!storyId) throw new Error('UI/UX responsive/a11y evidence matrix requires --id <story-id>.');
  return storyId;
}

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function escapeMarkdownCell(value) {
  return String(value ?? '-')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}
