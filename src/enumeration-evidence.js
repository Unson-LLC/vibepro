// Enumeration (sweep-range) evidence contract.
//
// Behaviour gates ask "does the change work". They never ask "did you cover the
// range", so the range is never checked and a review finding gets closed at the
// reported line while the rest of its class stays open. This module makes the
// range a first-class, machine-checked claim.
//
// The claim is a `verify record --scenario` string in one strict form:
//
//   enumeration: grepped <identifier> across <path>[, <path>...]; \
//   <N> sites found, <M> updated, <K> unchanged because <reason>
//
// Three independent checks make prose insufficient:
//   1. the grammar rejects count-free narration ("swept everything"),
//   2. the counts must partition (N === M + K, N >= 1),
//   3. N is *recounted* against the tree; a claimed number that does not match
//      the observed number fails closed.
//
// (3) is the load-bearing one: a scenario cannot be satisfied by writing a
// token, only by having actually swept the range it names.

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ENUMERATION_EVIDENCE_SCHEMA_VERSION = '0.1.0';

export const ENUMERATION_SCENARIO_PREFIX = 'enumeration:';

// Product source surfaces. `test/` is deliberately absent: the class that gets
// left half-closed is the production producer/consumer spread, and counting a
// literal that only exists in src plus its own test as "cross-file" would
// require enumeration for every single-site constant.
export const PRODUCT_SOURCE_PREFIXES = ['src/', 'bin/', 'lib/', 'scripts/'];

const PRODUCT_SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);

// Directories excluded from every count, so the recount is reproducible with a
// plain grep and so recorded evidence cannot inflate its own numbers by
// mentioning the identifier inside `.vibepro/`.
export const EXCLUDED_SCAN_DIRS = ['.git', 'node_modules', '.vibepro'];

const MAX_SCANNED_FILE_BYTES = 2_000_000;

// Mirror `grep -I`: a file containing a NUL byte is treated as binary and skipped.
const NUL_BYTE = /\u0000/;

// A value that joins an enumerable set in this codebase is a lowercase token
// with at least one `_` or `:` separator: `needs_evidence`, `not_applicable`,
// `cost_missing`, and namespaced ids like `gate:enumeration_coverage`.
//
// The `:` alternative is not cosmetic. Gate ids are the widest-spreading
// enumerable here — one id is registered in the DAG, in two independent
// blocking predicates, and in the depth planner's risk set — and an
// underscore-only pattern silently excluded every one of them.
//
// Requiring a separator excludes single English words, and forbidding
// whitespace excludes prose error messages.
const ENUMERABLE_LITERAL = /^[a-z][a-z0-9]*(?:[_:][a-z0-9]+)+$/;

const ENUMERABLE_LITERAL_SCAN = /['"]([a-z][a-z0-9]*(?:[_:][a-z0-9]+)+)['"]/g;

// An identifier must reach at least this many distinct product source files
// before it has a class worth enumerating. A literal confined to one file has
// no producer/consumer spread.
const CROSS_FILE_THRESHOLD = 2;

const ENUMERATION_SCENARIO_GRAMMAR = new RegExp(
  '^enumeration:\\s*grepped\\s+(?<identifier>\\S+)\\s+across\\s+(?<paths>[^;]+);'
  + '\\s*(?<found>\\d+)\\s+sites?\\s+found,'
  + '\\s*(?<updated>\\d+)\\s+updated,'
  + '\\s*(?<unchanged>\\d+)\\s+(?:deliberately\\s+)?unchanged'
  + '(?:\\s+because\\s+(?<reason>.+?))?\\s*$',
  'i'
);

const IDENTIFIER_SHAPE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

// Marks text as an attempted sweep claim rather than incidental prose that
// happens to begin with the prefix. "swept" is included deliberately so
// count-free sweep narration is still rejected rather than quietly ignored.
const ENUMERATION_CLAIM_SIGNAL = /\b(grepped|swept|sweep|sites?\s+found)\b|\b\d+\s+sites?\b/i;

/**
 * Parse one `--scenario` string as an enumeration claim.
 *
 * Returns `{ matched: false }` for scenarios that are not enumeration claims at
 * all, so ordinary scenarios pass through untouched. Returns
 * `{ matched: true, ok: false, rejection }` for text that announces itself as
 * an enumeration claim but does not satisfy the contract — that is the
 * fail-closed path, not a silent skip.
 */
export function parseEnumerationScenario(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw.toLowerCase().startsWith(ENUMERATION_SCENARIO_PREFIX)) {
    return { matched: false, ok: false, claim: null, rejection: null };
  }
  // The prefix alone is not enough to claim a scenario. Ordinary prose such as
  // "enumeration: covered all statuses" predates this contract and must keep
  // recording; only text that also announces a sweep is held to the grammar.
  if (!ENUMERATION_CLAIM_SIGNAL.test(raw)) {
    return { matched: false, ok: false, claim: null, rejection: null };
  }
  const match = ENUMERATION_SCENARIO_GRAMMAR.exec(raw);
  if (!match) {
    return {
      matched: true,
      ok: false,
      claim: null,
      rejection: {
        id: 'enumeration_scenario_malformed',
        reason: 'enumeration scenario does not match the required form: '
          + 'enumeration: grepped <identifier> across <path>[, <path>...]; '
          + '<N> sites found, <M> updated, <K> unchanged because <reason>',
        scenario: raw
      }
    };
  }
  const groups = match.groups ?? {};
  const identifier = groups.identifier ?? '';
  if (!IDENTIFIER_SHAPE.test(identifier)) {
    return {
      matched: true,
      ok: false,
      claim: null,
      rejection: {
        id: 'enumeration_identifier_invalid',
        reason: `enumeration identifier ${JSON.stringify(identifier)} is not a bare identifier; quote-free identifiers only`,
        scenario: raw
      }
    };
  }
  const paths = splitDeclaredPaths(groups.paths ?? '');
  if (paths.length === 0) {
    return {
      matched: true,
      ok: false,
      claim: null,
      rejection: {
        id: 'enumeration_paths_missing',
        reason: 'enumeration scenario declares no searchable path',
        scenario: raw
      }
    };
  }
  const reason = (groups.reason ?? '').trim();
  const claim = {
    identifier,
    paths,
    found: Number(groups.found),
    updated: Number(groups.updated),
    unchanged: Number(groups.unchanged),
    reason: reason.length > 0 ? reason : null,
    scenario: raw
  };
  const arithmetic = validateEnumerationClaim(claim);
  if (!arithmetic.ok) {
    return { matched: true, ok: false, claim, rejection: arithmetic.rejection };
  }
  return { matched: true, ok: true, claim, rejection: null };
}

/**
 * Counts must partition the discovered sites. `N sites found` with
 * `M updated` and `K unchanged` where `M + K !== N` describes a sweep that
 * silently dropped sites, which is exactly the failure this gate exists to
 * catch.
 */
export function validateEnumerationClaim(claim) {
  if (!claim) {
    return { ok: false, rejection: { id: 'enumeration_claim_missing', reason: 'no enumeration claim to validate', scenario: null } };
  }
  const { identifier, found, updated, unchanged, reason, scenario } = claim;
  if (!Number.isInteger(found) || !Number.isInteger(updated) || !Number.isInteger(unchanged)) {
    return {
      ok: false,
      rejection: { id: 'enumeration_counts_invalid', reason: 'enumeration counts must be integers', scenario }
    };
  }
  if (found < 1) {
    return {
      ok: false,
      rejection: {
        id: 'enumeration_found_zero',
        reason: `enumeration of ${identifier} reports 0 sites found; a sweep that discovers nothing is a discovery failure, not coverage`,
        scenario
      }
    };
  }
  if (updated + unchanged !== found) {
    return {
      ok: false,
      rejection: {
        id: 'enumeration_counts_unbalanced',
        reason: `enumeration of ${identifier} claims ${found} sites found but accounts for ${updated} updated + ${unchanged} unchanged = ${updated + unchanged}; every discovered site must be either updated or deliberately unchanged`,
        scenario
      }
    };
  }
  if (unchanged > 0 && !reason) {
    return {
      ok: false,
      rejection: {
        id: 'enumeration_unchanged_reason_missing',
        reason: `enumeration of ${identifier} leaves ${unchanged} site(s) unchanged without a "because <reason>" clause`,
        scenario
      }
    };
  }
  return { ok: true, rejection: null };
}

function splitDeclaredPaths(text) {
  return String(text)
    .split(/[,\s]+/)
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter((entry) => entry.length > 0);
}

export function isProductSourcePath(filePath) {
  const normalized = String(filePath ?? '').replaceAll('\\', '/');
  if (!PRODUCT_SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  return PRODUCT_SOURCE_EXTENSIONS.has(path.extname(normalized));
}

/**
 * Extract enumerable string literals from raw text (an added-diff hunk or a
 * whole file).
 */
export function extractEnumerableLiterals(text) {
  const found = new Set();
  for (const match of String(text ?? '').matchAll(ENUMERABLE_LITERAL_SCAN)) {
    const literal = match[1];
    if (!ENUMERABLE_LITERAL.test(literal)) continue;
    // Node builtin module specifiers share the namespaced shape but are import
    // targets, never enumerable domain values.
    if (literal.startsWith('node:')) continue;
    found.add(literal);
  }
  return found;
}

export function buildWholeTokenMatcher(identifier) {
  const escaped = String(identifier).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
}

/**
 * Decide which identifiers this change must enumerate.
 *
 * Required = introduced by this change (absent from the base tree) AND spread
 * across at least `CROSS_FILE_THRESHOLD` product source files at head. Both
 * halves matter: the first keeps pre-existing vocabulary out of scope, the
 * second keeps single-site constants out of scope.
 */
export function selectRequiredIdentifiers({
  addedLiterals = new Set(),
  baseLiterals = new Set(),
  headFileCounts = new Map(),
  headSiteCounts = new Map()
} = {}) {
  const required = [];
  const skipped = [];
  for (const literal of [...addedLiterals].sort()) {
    const fileCount = headFileCounts.get(literal) ?? 0;
    const siteCount = headSiteCounts.get(literal) ?? 0;
    if (baseLiterals.has(literal)) {
      skipped.push({ identifier: literal, reason: 'pre_existing_in_base', product_source_files: fileCount, product_source_sites: siteCount });
      continue;
    }
    // Spread is measured by sites, not only by files. A gate id registered
    // twice inside one module (a node type plus a collector allowlist) is
    // exactly the registration class that gets half closed, and a file-only
    // threshold is blind to it by construction.
    if (fileCount < CROSS_FILE_THRESHOLD && siteCount < CROSS_FILE_THRESHOLD) {
      skipped.push({ identifier: literal, reason: 'single_product_source_site', product_source_files: fileCount, product_source_sites: siteCount });
      continue;
    }
    required.push({ identifier: literal, product_source_files: fileCount, product_source_sites: siteCount });
  }
  return { required, skipped };
}

/**
 * Only current-bound evidence counts, matching how the failure-mode coverage
 * gate reads verification evidence. A stale-bound enumeration claim describes a
 * tree that no longer exists, so accepting it would close the gate on a range
 * nobody swept.
 */
export function collectEnumerationScenarios(verificationEvidence = null) {
  const scenarios = [];
  for (const command of verificationEvidence?.commands ?? []) {
    if (command?.binding?.status !== 'current') continue;
    for (const scenario of command?.observation?.scenarios ?? []) {
      const parsed = parseEnumerationScenario(scenario);
      if (!parsed.matched) continue;
      scenarios.push({ ...parsed, kind: command?.kind ?? null, binding: command?.binding?.status ?? null });
    }
  }
  return scenarios;
}

export function reproductionCommand(identifier, paths) {
  const excludes = EXCLUDED_SCAN_DIRS.map((dir) => `--exclude-dir=${dir}`).join(' ');
  return `grep -rIn ${excludes} -w -- ${shellQuote(identifier)} ${paths.map(shellQuote).join(' ')} | wc -l`;
}

export function scenarioTemplate(identifier, paths = ['src', 'test', 'docs']) {
  return `enumeration: grepped ${identifier} across ${paths.join(', ')}; `
    + '<N> sites found, <M> updated, <K> unchanged because <reason>';
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Tree access. Split behind a provider so the pure decision logic above stays
// testable without spawning git.
// ---------------------------------------------------------------------------

export function createGitTreeProvider({ repoRoot, baseRef, headRef }) {
  return {
    async addedLiterals() {
      // Returns null when the diff itself could not be produced, so an
      // unreadable change set fails closed rather than looking like "no new
      // identifiers". git diff exits 0 with empty output for an empty diff.
      let result = await gitResult(repoRoot, [
        'diff', '-U0', `${baseRef}...${headRef}`, '--', ...PRODUCT_SOURCE_PREFIXES
      ]);
      if (!result.ok) {
        result = await gitResult(repoRoot, [
          'diff', '-U0', baseRef, headRef, '--', ...PRODUCT_SOURCE_PREFIXES
        ]);
      }
      if (!result.ok) return null;
      const added = result.stdout
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .join('\n');
      return extractEnumerableLiterals(added);
    },
    async baseLiterals() {
      // Scope is only "unknown" when the base ref itself cannot be resolved.
      // `git grep` exiting 1 means the base tree genuinely contains no
      // enumerable literal (a fresh repo, or one with no product source at
      // all) — that is an empty set, not an unreadable tree. Conflating the
      // two would report inconclusive, and therefore block, on every such repo.
      if (!baseRef) return null;
      const resolved = await gitResult(repoRoot, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
      if (!resolved.ok || resolved.stdout.trim().length === 0) return null;
      // Must stay the same shape as ENUMERABLE_LITERAL_SCAN. A narrower
      // producer pattern here makes pre-existing literals look newly
      // introduced, which is the producer/consumer split this gate exists to
      // catch — so the two are asserted equivalent in the test suite.
      const grep = await gitResult(repoRoot, [
        'grep', '-oh', '-E', "['\"][a-z][a-z0-9]*([_:][a-z0-9]+)+['\"]",
        baseRef, '--', ...PRODUCT_SOURCE_PREFIXES
      ]);
      if (!grep.ok && grep.code !== 1) return null;
      return extractEnumerableLiterals(grep.stdout);
    },
    async productSourceFiles() {
      return listFilesUnder(repoRoot, PRODUCT_SOURCE_PREFIXES, isProductSourcePath);
    },
    async readTextFile(relativePath) {
      return readTextFileIfSmall(path.join(repoRoot, relativePath));
    },
    async countSites(identifier, declaredPaths) {
      return countSitesOnDisk(repoRoot, identifier, declaredPaths);
    }
  };
}

async function gitOptional(repoRoot, args) {
  return (await gitResult(repoRoot, args)).stdout;
}

// Keeps the exit code, so callers can tell "command succeeded and found
// nothing" apart from "command failed".
async function gitResult(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024
    });
    return { ok: true, code: 0, stdout };
  } catch (error) {
    return { ok: false, code: typeof error?.code === 'number' ? error.code : null, stdout: error?.stdout ?? '' };
  }
}

async function readTextFileIfSmall(fullPath, skipped = null) {
  try {
    const stats = await stat(fullPath);
    if (!stats.isFile()) return null;
    if (stats.size > MAX_SCANNED_FILE_BYTES) {
      // `grep -I` has no size cap, so a file we decline to read would make the
      // recount disagree with the command this gate tells operators to run.
      // Record it instead of dropping it silently.
      skipped?.push(fullPath);
      return null;
    }
    const content = await readFile(fullPath, 'utf8');
    return NUL_BYTE.test(content) ? null : content;
  } catch {
    return null;
  }
}

async function listFilesUnder(repoRoot, prefixes, filter) {
  const results = [];
  for (const prefix of prefixes) {
    await walk(path.join(repoRoot, prefix), prefix.replace(/\/$/, ''));
  }
  return results;

  async function walk(absolute, relative) {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDED_SCAN_DIRS.includes(entry.name)) continue;
      const childRelative = `${relative}/${entry.name}`;
      const childAbsolute = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        await walk(childAbsolute, childRelative);
      } else if (entry.isFile() && (!filter || filter(childRelative))) {
        results.push(childRelative);
      }
    }
  }
}

/**
 * Recount an identifier across the declared paths, with the same semantics as
 * the `grep -rIn --exclude-dir=... -w` command published in the gate output, so
 * an implementer can reproduce the number by hand.
 */
async function countSitesOnDisk(repoRoot, identifier, declaredPaths) {
  const matcher = buildWholeTokenMatcher(identifier);
  const missingPaths = [];
  const skippedAbsolute = [];
  let lines = 0;
  let files = 0;
  const root = path.resolve(repoRoot);
  for (const declared of declaredPaths) {
    const normalized = declared.replace(/^\.\//, '').replace(/\/$/, '');
    const absolute = path.resolve(root, normalized);
    // A declared range outside the repository is not a range this gate can
    // verify; treat it as missing rather than reading arbitrary paths.
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      missingPaths.push(declared);
      continue;
    }
    let stats;
    try {
      stats = await stat(absolute);
    } catch {
      missingPaths.push(declared);
      continue;
    }
    const candidates = stats.isDirectory()
      ? await listFilesUnder(repoRoot, [`${normalized}/`], null)
      : [normalized];
    for (const candidate of candidates) {
      const content = await readTextFileIfSmall(path.join(repoRoot, candidate), skippedAbsolute);
      if (content === null) continue;
      let fileHit = false;
      for (const line of content.split('\n')) {
        if (matcher.test(line)) {
          lines += 1;
          fileHit = true;
        }
      }
      if (fileHit) files += 1;
    }
  }
  return {
    lines,
    files,
    missing_paths: missingPaths,
    unscannable_paths: skippedAbsolute.map((absolute) => path.relative(root, absolute))
  };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

/**
 * Produce the enumeration coverage report consumed by
 * `gate:enumeration_coverage`.
 *
 * Statuses:
 *   not_applicable — the change introduces no cross-file enumerable identifier
 *   inconclusive   — the base tree could not be read, so scope is unknown
 *   needs_evidence — a required identifier has no enumeration scenario
 *   failed         — a scenario exists but its claim does not survive checking
 *   passed         — every required identifier has a verified claim
 */
export async function collectEnumerationCoverage({
  verificationEvidence = null,
  provider = null,
  repoRoot = null,
  baseRef = null,
  headRef = 'HEAD'
} = {}) {
  const tree = provider ?? createGitTreeProvider({ repoRoot, baseRef, headRef });
  const scenarios = collectEnumerationScenarios(verificationEvidence);
  const baseLiterals = await tree.baseLiterals();
  if (baseLiterals === null) {
    return {
      schema_version: ENUMERATION_EVIDENCE_SCHEMA_VERSION,
      status: 'inconclusive',
      reason: baseRef
        ? `the base tree ${baseRef} could not be scanned for existing enumerable literals, so the required enumeration scope is unknown`
        : 'no base ref was resolved, so the required enumeration scope is unknown',
      required: [],
      skipped: [],
      claims: scenarios.map(describeScenario),
      rejections: scenarios.filter((entry) => !entry.ok).map((entry) => entry.rejection)
    };
  }

  const added = await tree.addedLiterals();
  // A diff that could not be read must not fall through to a silent
  // not_applicable: an unknown change set is unknown scope, same as an
  // unreadable base tree.
  if (added === null) {
    return {
      schema_version: ENUMERATION_EVIDENCE_SCHEMA_VERSION,
      status: 'inconclusive',
      reason: `the diff between ${baseRef} and ${headRef} could not be read, so the introduced-identifier scope is unknown`,
      required: [],
      missing: [],
      skipped: [],
      claims: scenarios.map(describeScenario),
      rejections: scenarios.filter((entry) => !entry.ok).map((entry) => entry.rejection)
    };
  }
  const addedLiterals = added;
  const { fileCounts, siteCounts } = await countHeadFiles(tree, addedLiterals);
  const { required, skipped } = selectRequiredIdentifiers({
    addedLiterals,
    baseLiterals,
    headFileCounts: fileCounts,
    headSiteCounts: siteCounts
  });

  const rejections = scenarios.filter((entry) => !entry.ok).map((entry) => entry.rejection);
  const verifiedByIdentifier = new Map();
  const claims = [];
  for (const entry of scenarios) {
    if (!entry.ok) {
      claims.push(describeScenario(entry));
      continue;
    }
    const observed = await tree.countSites(entry.claim.identifier, entry.claim.paths);
    const requirement = required.find((item) => item.identifier === entry.claim.identifier) ?? null;
    const verification = verifyObservedCount(entry.claim, observed, requirement);
    claims.push({ ...describeScenario(entry), observed, verified: verification.ok, verification_reason: verification.reason });
    if (verification.ok) {
      verifiedByIdentifier.set(entry.claim.identifier, entry.claim);
    } else {
      rejections.push({
        id: verification.id,
        reason: verification.reason,
        scenario: entry.claim.scenario
      });
    }
  }

  const missing = required.filter((item) => !verifiedByIdentifier.has(item.identifier));
  // A recorded claim that does not survive checking fails the gate even when
  // this change required no enumeration: an unchecked false claim about the
  // tree is exactly the overclaim this gate exists to stop.
  const status = rejections.length > 0
    ? 'failed'
    : required.length === 0
      ? 'not_applicable'
      : missing.length > 0
        ? 'needs_evidence'
        : 'passed';

  return {
    schema_version: ENUMERATION_EVIDENCE_SCHEMA_VERSION,
    status,
    reason: buildReason({ status, required, missing, rejections, skipped }),
    required,
    missing: missing.map((item) => item.identifier),
    skipped,
    claims,
    rejections
  };
}

function verifyObservedCount(claim, observed, requirement = null) {
  if (observed.missing_paths.length > 0) {
    return {
      ok: false,
      id: 'enumeration_path_missing',
      reason: `enumeration of ${claim.identifier} declares path(s) that do not exist: ${observed.missing_paths.join(', ')}`
    };
  }
  // The published grep has no size cap. If the declared range contains a file
  // this scan cannot read, the two counts would disagree for a reason the
  // operator cannot see, so say so instead of returning a number that silently
  // omits it.
  if ((observed.unscannable_paths ?? []).length > 0) {
    return {
      ok: false,
      id: 'enumeration_range_unscannable',
      reason: `enumeration of ${claim.identifier} declares a range containing file(s) this recount cannot read, so the recount and the published grep would disagree: ${observed.unscannable_paths.join(', ')}; narrow the declared range to exclude them`
    };
  }
  // A claimant choosing a trivially narrow range would otherwise close the gate
  // over a fraction of the class. The range must reach at least as many files
  // as the identifier is known to span in product source.
  const expectedFiles = requirement?.product_source_files ?? 0;
  if (expectedFiles > 0 && observed.files < expectedFiles) {
    return {
      ok: false,
      id: 'enumeration_range_too_narrow',
      reason: `enumeration of ${claim.identifier} declares a range covering ${observed.files} file(s), but the identifier spans ${expectedFiles} product source file(s); declare a range that reaches the whole class`
    };
  }
  if (observed.lines !== claim.found) {
    return {
      ok: false,
      id: 'enumeration_count_mismatch',
      reason: `enumeration of ${claim.identifier} claims ${claim.found} site(s) across ${claim.paths.join(', ')}, `
        + `but recounting the same range observes ${observed.lines}; rerun ${reproductionCommand(claim.identifier, claim.paths)} and record the observed number`
    };
  }
  return { ok: true, id: null, reason: `recount over ${claim.paths.join(', ')} observed ${observed.lines} site(s), matching the claim` };
}

async function countHeadFiles(tree, literals) {
  const fileCounts = new Map();
  const siteCounts = new Map();
  if (literals.size === 0) return { fileCounts, siteCounts };
  const files = await tree.productSourceFiles();
  const matchers = new Map([...literals].map((literal) => [literal, buildWholeTokenMatcher(literal)]));
  for (const file of files) {
    const content = await tree.readTextFile(file);
    if (content === null) continue;
    const lines = content.split('\n');
    for (const [literal, matcher] of matchers) {
      if (!matcher.test(content)) continue;
      fileCounts.set(literal, (fileCounts.get(literal) ?? 0) + 1);
      const hits = lines.reduce((total, line) => (matcher.test(line) ? total + 1 : total), 0);
      siteCounts.set(literal, (siteCounts.get(literal) ?? 0) + hits);
    }
  }
  return { fileCounts, siteCounts };
}

function describeScenario(entry) {
  return {
    identifier: entry.claim?.identifier ?? null,
    paths: entry.claim?.paths ?? [],
    found: entry.claim?.found ?? null,
    updated: entry.claim?.updated ?? null,
    unchanged: entry.claim?.unchanged ?? null,
    unchanged_reason: entry.claim?.reason ?? null,
    kind: entry.kind ?? null,
    binding: entry.binding ?? null,
    accepted: entry.ok,
    rejection: entry.rejection ?? null
  };
}

function buildReason({ status, required, missing, rejections, skipped }) {
  if (status === 'not_applicable') {
    return skipped.length > 0
      ? `this change introduces no enumerable identifier spanning ${CROSS_FILE_THRESHOLD}+ product source files (${skipped.length} candidate(s) examined)`
      : 'this change introduces no new enumerable identifier in product source';
  }
  if (status === 'passed') {
    return `${required.length} introduced identifier(s) each carry a recounted enumeration claim`;
  }
  if (status === 'failed' && missing.length === 0) {
    return `${rejections.length} enumeration claim(s) failed contract or recount checking`;
  }
  return `${missing.length} of ${required.length} introduced identifier(s) lack a verified enumeration claim`
    + (rejections.length > 0 ? `; ${rejections.length} recorded claim(s) were rejected` : '');
}
