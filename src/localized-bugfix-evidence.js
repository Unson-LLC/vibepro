import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { normalizeChangedPath } from './docs-only-change.js';

const execFileAsync = promisify(execFile);

/** Mechanical localized_bug_fix thresholds (git/diff only; no human judgment). */
export const LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES = 2;
export const LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC = 80;

/**
 * Paths that disqualify the mechanical localized_bug_fix profile when touched.
 * Match is path-glob semantics (see `pathMatchesGlob`).
 */
export const SHARED_LAYOUT_CSS_PATH_GLOBS = [
  '**/globals.css',
  '**/global.css',
  '**/app.css',
  '**/layout.tsx',
  '**/layout.jsx',
  '**/Layout.tsx',
  '**/Layout.jsx',
  '**/root.tsx',
  '**/Root.tsx',
  '**/tailwind.config.*',
  '**/postcss.config.*',
  '**/design-system/**',
  '**/design-tokens/**',
  '**/theme/**',
  '**/styles/**',
  '**/shared/**/layout/**',
  '**/components/**/layout/**'
];

/** Default `primary` evidence tier caps for future Spec AC authoring. */
export const PRIMARY_EVIDENCE_MAX_PNG = 4;
export const PRIMARY_EVIDENCE_MAX_VIEWPORT_STATE_CELLS = 6;
export const PRIMARY_EVIDENCE_MIN_WIDTH_SANITY_PX = 760;

const PRODUCT_SOURCE_PREFIXES = ['src/', 'app/', 'lib/', 'packages/'];
const TEST_PATH_PATTERN = /(^|[\\/])(test|tests|__tests__|e2e)([\\/]|$)|\.(test|spec)\.[cm]?[jt]sx?$/i;

const REGRESSION_MATRIX_DEMAND_PATTERN = new RegExp(
  [
    'other[- ]screen',
    'full[- ]pixel',
    'full pixel matrix',
    'width\\s*[×x]\\s*state',
    'state\\s*[×x]\\s*width',
    'every viewport',
    'all screens',
    'all routes',
    'full responsive',
    'regression_matrix',
    'evidence matrix.*all',
    'viewport\\s*×\\s*state grid'
  ].join('|'),
  'i'
);

const PNG_TOKEN_PATTERN = /\.png\b/gi;
const VIEWPORT_STATE_GRID_PATTERN = /(\d+)\s*(?:viewports?|widths?).{0,40}?(\d+)\s*(?:states?|modes?)/i;

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isProductSourcePath(filePath) {
  const normalized = normalizeChangedPath(filePath);
  if (!normalized || TEST_PATH_PATTERN.test(normalized)) return false;
  if (!PRODUCT_SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  if (normalized.startsWith('packages/') && !/\/src\//.test(normalized)) return false;
  return true;
}

/**
 * @param {string} filePath
 * @param {string} glob
 */
export function pathMatchesGlob(filePath, glob) {
  const normalized = normalizeChangedPath(filePath);
  const g = glob.replaceAll('\\', '/');
  if (g.includes('**')) {
    const escaped = g
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '§§')
      .replace(/\*/g, '[^/]*')
      .replace(/§§/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(normalized);
  }
  if (g.includes('*')) {
    const escaped = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`, 'i').test(normalized);
  }
  return normalized === g || normalized.endsWith(`/${g}`);
}

export function touchesSharedLayoutCssPath(filePath) {
  return SHARED_LAYOUT_CSS_PATH_GLOBS.some((glob) => pathMatchesGlob(filePath, glob));
}

/**
 * @param {{ path: string, changed_lines?: number|null }[]} paths
 */
export function assessMechanicalLocalizedBugFixProfile(paths) {
  const productPaths = [];
  let productLoc = 0;
  let lineDataAvailable = true;
  const sharedLayoutHits = [];

  for (const entry of paths ?? []) {
    const filePath = normalizeChangedPath(entry.path);
    if (!filePath) continue;
    if (touchesSharedLayoutCssPath(filePath)) sharedLayoutHits.push(filePath);
    if (!isProductSourcePath(filePath)) continue;
    productPaths.push(filePath);
    if (entry.changed_lines === null || entry.changed_lines === undefined) {
      lineDataAvailable = false;
    } else {
      productLoc += entry.changed_lines;
    }
  }

  const reasons = [];
  if (sharedLayoutHits.length > 0) {
    reasons.push(`shared_layout_css_paths:${sharedLayoutHits.slice(0, 3).join(',')}`);
  }
  if (productPaths.length > LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES) {
    reasons.push(`product_source_files:${productPaths.length}>${LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES}`);
  }
  if (lineDataAvailable && productLoc > LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC) {
    reasons.push(`product_source_loc:${productLoc}>${LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC}`);
  }
  if (!lineDataAvailable && productPaths.length > 0) {
    reasons.push('product_source_loc_unmeasured');
  }

  const meets = reasons.length === 0
    && productPaths.length > 0
    && lineDataAvailable;

  return {
    meets_mechanical_localized_bug_fix: meets,
    product_source_file_count: productPaths.length,
    product_source_changed_lines: lineDataAvailable ? productLoc : null,
    product_source_paths: productPaths,
    shared_layout_css_hits: sharedLayoutHits,
    disqualifiers: reasons
  };
}

function clauseTextBlob(clause) {
  return `${clause?.statement ?? ''}\n${clause?.rationale ?? ''}`;
}

/**
 * Infer demanded UI evidence from Spec clauses and optional `ui_verification`.
 */
export function assessUiEvidenceDemands(spec) {
  const texts = [];
  for (const clause of spec?.clauses ?? []) texts.push(clauseTextBlob(clause));
  const ui = spec?.ui_verification ?? {};
  if (ui.statement) texts.push(String(ui.statement));
  const joined = texts.join('\n');

  const pngMentions = (joined.match(PNG_TOKEN_PATTERN) ?? []).length;
  const explicitPng = Number.isFinite(ui.required_png_count) ? ui.required_png_count : null;
  const demandedPng = Math.max(pngMentions, explicitPng ?? 0);

  let demandedViewportState = Number.isFinite(ui.required_viewport_state_cells)
    ? ui.required_viewport_state_cells
    : 0;
  const gridMatch = joined.match(VIEWPORT_STATE_GRID_PATTERN);
  if (gridMatch) {
    demandedViewportState = Math.max(
      demandedViewportState,
      Number(gridMatch[1]) * Number(gridMatch[2])
    );
  }
  if (/viewport\s*×\s*state|width\s*×\s*state/i.test(joined) && demandedViewportState === 0) {
    demandedViewportState = PRIMARY_EVIDENCE_MAX_VIEWPORT_STATE_CELLS + 1;
  }

  const regressionMatrixDemanded = ui.evidence_tier === 'regression_matrix'
    || REGRESSION_MATRIX_DEMAND_PATTERN.test(joined);

  const tierDeclared = ui.evidence_tier === 'primary' || ui.evidence_tier === 'regression_matrix'
    ? ui.evidence_tier
    : null;

  return {
    demanded_png_count: demandedPng,
    demanded_viewport_state_cells: demandedViewportState,
    regression_matrix_demanded: regressionMatrixDemanded,
    declared_evidence_tier: tierDeclared,
    nondeterministic_surfaces: Array.isArray(ui.nondeterministic_surfaces)
      ? ui.nondeterministic_surfaces.map((s) => String(s).trim()).filter(Boolean)
      : []
  };
}

/**
 * Non-blocking Spec warnings for localized bug_fix evidence bloat (future AC authoring).
 *
 * @param {object} spec
 * @param {object} options
 * @param {string} [options.storyContractType]
 * @param {ReturnType<typeof assessMechanicalLocalizedBugFixProfile>} [options.mechanicalProfile]
 */
export function assessLocalizedBugFixEvidenceWarnings(spec, options = {}) {
  const warnings = [];
  const contract = String(options.storyContractType ?? spec?.story_contract_type ?? '').toLowerCase();
  const bugFixStory = ['bug', 'bug_fix', 'regression_fix'].includes(contract);
  if (!bugFixStory) return warnings;

  const mechanical = options.mechanicalProfile
    ?? assessMechanicalLocalizedBugFixProfile(options.changePaths ?? []);
  if (!mechanical.meets_mechanical_localized_bug_fix) return warnings;

  const demands = assessUiEvidenceDemands(spec);
  const exceedsPng = demands.demanded_png_count > PRIMARY_EVIDENCE_MAX_PNG;
  const exceedsGrid = demands.demanded_viewport_state_cells > PRIMARY_EVIDENCE_MAX_VIEWPORT_STATE_CELLS;
  const primaryCapExceeded = exceedsPng || exceedsGrid || demands.regression_matrix_demanded;

  if (!primaryCapExceeded) return warnings;

  const parts = [];
  if (exceedsPng) {
    parts.push(`png>${PRIMARY_EVIDENCE_MAX_PNG} (demanded≈${demands.demanded_png_count})`);
  }
  if (exceedsGrid) {
    parts.push(
      `viewport×state>${PRIMARY_EVIDENCE_MAX_VIEWPORT_STATE_CELLS} (demanded≈${demands.demanded_viewport_state_cells})`
    );
  }
  if (demands.regression_matrix_demanded) parts.push('regression_matrix_language');

  warnings.push({
    code: 'localized_bugfix_primary_evidence_cap_exceeded',
    message: [
      'Mechanical localized_bug_fix profile applies',
      `(≤${LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES} product source files,`,
      `≤${LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC} product LOC,`,
      'no shared layout/CSS glob hit).',
      'Default evidence tier is `primary` for future Spec AC authoring:',
      `≤${PRIMARY_EVIDENCE_MAX_PNG} representative PNGs,`,
      `viewport×state≤${PRIMARY_EVIDENCE_MAX_VIEWPORT_STATE_CELLS},`,
      'placement/measure *-summary.json + unit test.',
      'Escalate to `regression_matrix` only when the Story explicitly marks',
      'multi-route blast radius or a shared layout/CSS path is in the diff.',
      `Current Spec demands exceed primary cap: ${parts.join('; ')}.`,
      'Does not apply retroactively to in-flight deliveries.'
    ].join(' '),
    path: 'ui_verification.evidence_tier'
  });

  if (demands.declared_evidence_tier === 'regression_matrix' && !demands.regression_matrix_demanded) {
    warnings.push({
      code: 'localized_bugfix_regression_tier_without_blast_signal',
      message: 'Spec declares regression_matrix tier but clauses lack blast-radius / matrix language; confirm shared layout or multi-route touch before requiring full matrices.',
      path: 'ui_verification.evidence_tier'
    });
  }

  return warnings;
}

export async function collectWorkingTreeChangePaths(repoRoot) {
  const root = String(repoRoot ?? '').trim();
  if (!root) return { paths: [], source: 'unavailable' };
  try {
    const [unstaged, staged, untracked] = await Promise.all([
      gitLines(root, ['diff', '--name-only', 'HEAD']),
      gitLines(root, ['diff', '--cached', '--name-only', 'HEAD']),
      gitLines(root, ['ls-files', '--others', '--exclude-standard'])
    ]);
    const names = [...new Set([...unstaged, ...staged, ...untracked])]
      .map((p) => normalizeChangedPath(p))
      .filter(Boolean);
    if (names.length === 0) return { paths: [], source: 'changed_files' };

    const numstat = await gitLines(root, ['diff', '--numstat', 'HEAD']);
    const statMap = parseNumstat(numstat);
    const paths = names.map((filePath) => ({
      path: filePath,
      changed_lines: statMap.has(filePath) ? statMap.get(filePath) : null
    }));
    return { paths, source: statMap.size > 0 ? 'diff_line_stats' : 'changed_files' };
  } catch {
    return { paths: [], source: 'unavailable' };
  }
}

async function gitLines(cwd, args) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function parseNumstat(lines) {
  const map = new Map();
  for (const line of lines) {
    const [add, del, file] = line.split('\t');
    if (!file || file === '-') continue;
    const additions = Number(add);
    const deletions = Number(del);
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;
    map.set(normalizeChangedPath(file), additions + deletions);
  }
  return map;
}
