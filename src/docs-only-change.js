// Deterministic docs-only change detection.
//
// This module answers exactly one question: "does this change touch product
// code?". It is an *input* to the existing evidence depth planner and the
// canonical evidence cost budget (story-vibepro-docs-only-evidence-profile,
// DOE-S-4) — it deliberately does not re-implement depth resolution.
//
// The classification is conservative by construction: anything that cannot be
// proven to be documentation or a VibePro-managed record keeps the change on
// the implementation path. A wrong `docs_only` verdict silently lightens
// evidence, a wrong `product_change` verdict only costs tokens.

export const DOCS_ONLY_CHANGE_SCHEMA_VERSION = '0.1.0';

const SAMPLE_PATH_LIMIT = 5;

// VibePro-managed evidence/record surfaces. Changing these alone never
// constitutes a product change, and they are what a docs/roadmap Story
// unavoidably touches (Story catalog registration, design registry, promoted
// audit bundles).
const EVIDENCE_ARTIFACT_PREFIXES = [
  '.vibepro/',
  'docs/management/audit-artifacts/'
];

const EVIDENCE_ARTIFACT_FILES = new Set([
  'design-ssot.json',
  'docs/design-ssot.json',
  'docs/management/design-ssot.json'
]);

// Product code surfaces. `docs/` is checked first, so a markdown file under
// `docs/` is never captured here.
const PRODUCT_CODE_PREFIXES = [
  'src/',
  'test/',
  'tests/',
  'bin/',
  'lib/',
  'app/',
  'scripts/',
  'templates/',
  '.github/'
];

const PRODUCT_CODE_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'tsconfig.json',
  'eslint.config.js',
  'playwright.config.ts',
  'vitest.config.ts',
  'Dockerfile',
  'Makefile'
]);

const DOCS_PREFIXES = ['docs/'];

// Not everything under `docs/` is documentation. This repository builds and
// deploys a public manual from `docs/`, so the site generator config and the
// deployed static surface (including security headers and redirects) are
// product code that happens to live in the documentation tree. Machine-read
// responsibility contracts drive gate behaviour and are treated the same way.
const DOCS_TREE_PRODUCT_PREFIXES = [
  'docs/.vitepress/',
  'docs/public/',
  'docs/contracts/'
];

// Documentation trees whose contents are documentation regardless of file
// extension: a Story, an Architecture note, and a Spec are all requirement
// surfaces, and a Spec is routinely serialized as JSON.
const DOCS_TREE_DOCUMENT_PREFIXES = [
  'docs/management/',
  'docs/specs/',
  'docs/architecture/',
  'docs/adr/'
];

// Machine-read registries that happen to live inside those documentation
// trees. These are read by VibePro at runtime to drive conformance, senior-gap,
// ROI and responsibility verdicts, so changing one changes behaviour and must
// keep the change on the implementation profile.
const DOCS_TREE_MACHINE_READ_PREFIXES = [
  'docs/management/roi-ledger/',
  'docs/management/responsibility-authority/'
];

const DOCS_TREE_MACHINE_READ_FILES = new Set([
  'docs/architecture/target-model.json'
]);

const DOCS_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.rst', '.txt', '.adoc']);

const DOCS_FILES = new Set([
  'LICENSE',
  'NOTICE',
  'CODEOWNERS'
]);

export function normalizeChangedPath(filePath) {
  return String(filePath ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Classifies a single changed path into the surface that decides whether the
 * change is docs-only.
 *
 * @returns {'product_code'|'docs'|'evidence_artifacts'|'unknown'}
 */
export function classifyEvidenceChangeSurface(filePath) {
  const normalized = normalizeChangedPath(filePath);
  if (normalized.length === 0) return 'unknown';

  if (EVIDENCE_ARTIFACT_FILES.has(normalized)) return 'evidence_artifacts';
  if (EVIDENCE_ARTIFACT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return 'evidence_artifacts';

  // `docs/` outranks the product prefixes so documentation is never mistaken
  // for code, but it is checked after the evidence prefixes because promoted
  // audit bundles also live under `docs/`.
  if (DOCS_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    if (DOCS_TREE_PRODUCT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return 'product_code';
    if (DOCS_TREE_MACHINE_READ_FILES.has(normalized)) return 'product_code';
    if (DOCS_TREE_MACHINE_READ_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return 'product_code';
    if (DOCS_TREE_DOCUMENT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return 'docs';
    // Elsewhere under `docs/`, only documentation file types are documentation.
    // A build script, config, or shipped asset changes what deploys, so it
    // keeps the change on the implementation profile.
    return DOCS_EXTENSIONS.has(extensionOf(normalized)) ? 'docs' : 'product_code';
  }

  if (PRODUCT_CODE_FILES.has(normalized)) return 'product_code';
  if (PRODUCT_CODE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return 'product_code';
  if (/(^|\/)__tests__\//.test(normalized)) return 'product_code';

  if (DOCS_FILES.has(normalized)) return 'docs';
  const extension = extensionOf(normalized);
  if (DOCS_EXTENSIONS.has(extension)) return 'docs';

  return 'unknown';
}

/**
 * Detects whether an observed change set is docs-only.
 *
 * Inputs are the two change-surface observations VibePro already carries:
 * `git.diff_line_stats` (per-file numstat) and `git.changed_files`. Line counts
 * are reported when numstat is available and left `null` otherwise, so a caller
 * can never mistake "not measured" for "zero".
 *
 * @returns {{status: 'docs_only'|'product_change'|'unknown'}}
 */
export function detectDocsOnlyChange({
  diffStats = null,
  changedFiles = null,
  diffStatsStatus = null
} = {}) {
  const observation = collectObservedPaths({ diffStats, changedFiles, diffStatsStatus });
  if (observation.reason) return docsOnlyResult({ status: 'unknown', reason: observation.reason, source: observation.source });

  const counts = {
    product_code: 0,
    docs: 0,
    evidence_artifacts: 0,
    unknown: 0
  };
  const lines = {
    product_code: 0,
    docs: 0,
    evidence_artifacts: 0,
    unknown: 0
  };
  const samples = { product_code: [], unknown: [], evidence_artifacts: [] };
  let lineDataAvailable = observation.source === 'diff_line_stats';

  for (const entry of observation.paths) {
    const surface = classifyEvidenceChangeSurface(entry.path);
    counts[surface] += 1;
    if (entry.changed_lines === null) {
      lineDataAvailable = false;
    } else {
      lines[surface] += entry.changed_lines;
    }
    if (surface === 'product_code' && samples.product_code.length < SAMPLE_PATH_LIMIT) {
      samples.product_code.push(entry.path);
    }
    if (surface === 'unknown' && samples.unknown.length < SAMPLE_PATH_LIMIT) {
      samples.unknown.push(entry.path);
    }
    // A docs_only verdict tolerates VibePro-managed records silently otherwise.
    // `.vibepro/config.json` in particular carries review-role policy and
    // evidence budgets alongside the Story catalog, so name what was tolerated.
    if (surface === 'evidence_artifacts' && samples.evidence_artifacts.length < SAMPLE_PATH_LIMIT) {
      samples.evidence_artifacts.push(entry.path);
    }
  }

  const shared = {
    source: observation.source,
    evaluated_path_count: observation.paths.length,
    product_code_path_count: counts.product_code,
    docs_path_count: counts.docs,
    evidence_artifact_path_count: counts.evidence_artifacts,
    unknown_path_count: counts.unknown,
    product_code_changed_lines: lineDataAvailable ? lines.product_code : null,
    docs_changed_lines: lineDataAvailable ? lines.docs : null,
    sample_product_code_paths: samples.product_code,
    sample_unknown_paths: samples.unknown,
    sample_evidence_artifact_paths: samples.evidence_artifacts
  };

  if (counts.product_code > 0) {
    return docsOnlyResult({ status: 'product_change', reason: 'product_code_paths_changed', ...shared });
  }
  if (counts.unknown > 0) {
    // Unclassifiable paths are not evidence of a docs-only change. Staying on
    // the implementation profile keeps evidence at full strength until the
    // classifier learns the surface.
    return docsOnlyResult({ status: 'unknown', reason: 'unclassified_paths_present', ...shared });
  }
  if (counts.docs === 0) {
    // Only VibePro-managed records moved. That is an evidence-bookkeeping
    // change, not a documentation change, and it is too weak a signal to
    // lighten the profile on.
    return docsOnlyResult({ status: 'unknown', reason: 'no_docs_paths_changed', ...shared });
  }
  return docsOnlyResult({ status: 'docs_only', reason: 'no_product_code_paths_changed', ...shared });
}

export function isDocsOnlyChange(docsOnlyChange) {
  return docsOnlyChange?.status === 'docs_only';
}

function docsOnlyResult({
  status,
  reason,
  source = null,
  evaluated_path_count = 0,
  product_code_path_count = 0,
  docs_path_count = 0,
  evidence_artifact_path_count = 0,
  unknown_path_count = 0,
  product_code_changed_lines = null,
  docs_changed_lines = null,
  sample_product_code_paths = [],
  sample_unknown_paths = [],
  sample_evidence_artifact_paths = []
}) {
  return {
    schema_version: DOCS_ONLY_CHANGE_SCHEMA_VERSION,
    status,
    reason,
    source,
    evaluated_path_count,
    product_code_path_count,
    docs_path_count,
    evidence_artifact_path_count,
    unknown_path_count,
    product_code_changed_lines,
    docs_changed_lines,
    sample_product_code_paths,
    sample_unknown_paths,
    sample_evidence_artifact_paths
  };
}

function collectObservedPaths({ diffStats, changedFiles, diffStatsStatus }) {
  const status = normalizeStatus(diffStatsStatus);
  if (status !== null && status !== 'available') {
    return { paths: [], source: null, reason: 'diff_stats_unavailable' };
  }

  const hasDiffStats = diffStats && typeof diffStats === 'object' && !Array.isArray(diffStats);
  if (hasDiffStats) {
    const paths = Object.entries(diffStats).map(([path, stats]) => ({
      path: normalizeChangedPath(path),
      changed_lines: changedLineCount(stats)
    })).filter((entry) => entry.path.length > 0);
    if (paths.length > 0) return { paths, source: 'diff_line_stats' };
  }

  // Falling through covers a numstat that observed nothing measurable — an
  // untracked/binary-only change at `pr prepare` time — while still refusing to
  // invent a verdict when there is no second observation either. An empty
  // numstat is also what a lost pre-merge diff base looks like, and that must
  // never be read as "nothing but docs changed".
  const files = normalizeChangedFileList(changedFiles);
  if (files.length > 0) {
    return { paths: files.map((path) => ({ path, changed_lines: null })), source: 'changed_files' };
  }
  if (hasDiffStats || Array.isArray(changedFiles)) {
    return {
      paths: [],
      source: hasDiffStats ? 'diff_line_stats' : 'changed_files',
      reason: 'no_changed_paths_observed'
    };
  }
  return { paths: [], source: null, reason: 'change_surface_unavailable' };
}

function normalizeChangedFileList(changedFiles) {
  if (!Array.isArray(changedFiles)) return [];
  return changedFiles
    .map((file) => normalizeChangedPath(typeof file === 'string' ? file : file?.path ?? file?.file))
    .filter((path) => path.length > 0);
}

function changedLineCount(stats) {
  const additions = stats?.additions;
  const deletions = stats?.deletions;
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) return null;
  return additions + deletions;
}

function normalizeStatus(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function extensionOf(normalizedPath) {
  const filename = normalizedPath.split('/').at(-1) ?? '';
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex <= 0 ? '' : filename.slice(dotIndex).toLowerCase();
}
