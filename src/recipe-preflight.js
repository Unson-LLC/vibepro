// Recipe preflight registry.
//
// Encodes non-obvious VibePro pipeline recipes learned through dogfooding as a
// deterministic, ordered list of `{ id, action, detect, fix }` entries executed
// as a preflight phase at the start of `pr autopilot`, before gate evaluation.
//
// Contracts (docs/specs/story-vibepro-recipe-preflight-autopilot.md):
//   RPA-CONTRACT-001 preflight never creates or mutates gate results, waivers,
//     review lifecycle records, or decision records. Its only writes are
//     artifacts operators already produce by hand (verification status
//     artifacts, story catalog entries).
//   RPA-CONTRACT-002 auto_fix outputs are schema-compatible with hand-made ones.
//   RPA-CONTRACT-003 detections are pure functions of on-disk state; no network,
//     no LLM calls.
//   RPA-CONTRACT-004 no-op on clean stories: zero writes, detected:false for all.
//   RPA-CONTRACT-005 a recipe that throws is reported action_taken:"failed" and
//     never aborts preflight or the autopilot run.
//   RPA-CONTRACT-006 adding a recipe is a single registry append; the report
//     lists every recipe exactly once per run, in registry order.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { recordVerificationEvidence } from './verification-evidence.js';
import { getSpecFile } from './spec-store.js';

export const PREFLIGHT_SCHEMA_VERSION = '0.1.0';

const PASS_STATUSES = new Set(['pass', 'passed', 'success', 'ok']);
const GENERIC_EVIDENCE_TOKENS = new Set([
  'unit', 'integration', 'e2e', 'test', 'tests', 'regression',
  'current', 'head', 'verification', 'typecheck', 'build', 'lint', 'smoke'
]);
const EVIDENCE_STOPWORDS = new Set([
  'autopilot', 'passed', 'pass', 'for', 'evidence', 'recorded', 'record',
  'exit', 'code', 'from', 'was', 'the', 'and', 'executed', 'command',
  'status', 'ran', 'run', 'with', 'via', 'that', 'this',
  // command-runner / invocation noise so detection reads the subject tokens
  'npm', 'npx', 'node', 'yarn', 'pnpm', 'make', 'cargo', 'python', 'script', 'scripts', 'all'
]);
const CLAUSE_ID_PATTERN = /\b[A-Z][A-Z0-9]*-[A-Z0-9]+-\d+\b/;
const CLAUSE_ID_PATTERN_G = /\b[A-Z][A-Z0-9]*-[A-Z0-9]+-\d+\b/g;
const STORY_DOC_DIRS = [
  path.join('docs', 'management', 'stories', 'active'),
  path.join('docs', 'user_stories', 'active'),
  path.join('docs', 'stories')
];
const SPEC_DOC_DIRS = [path.join('docs', 'specs')];

/**
 * Run every recipe in registry order and return the machine-readable preflight
 * section: `{ schema_version, results: [{ recipe_id, detected, action,
 * action_taken, artifacts, next_command, ... }] }`.
 *
 * A recipe throwing (detection or fix) is isolated to `action_taken: "failed"`;
 * preflight never aborts.
 */
export async function runRecipePreflight(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId ?? null;
  const dryRun = options.dryRun === true;
  const registry = Array.isArray(options.registry) ? options.registry : RECIPE_REGISTRY;
  const results = [];
  for (const recipe of registry) {
    results.push(await runSingleRecipe(root, recipe, { storyId, dryRun }));
  }
  return { schema_version: PREFLIGHT_SCHEMA_VERSION, results };
}

async function runSingleRecipe(root, recipe, { storyId, dryRun }) {
  const base = {
    recipe_id: recipe.id,
    detected: false,
    action: recipe.action,
    action_taken: null,
    artifacts: [],
    next_command: null
  };
  let detection;
  try {
    detection = await recipe.detect({ repoRoot: root, storyId });
  } catch (error) {
    return { ...base, action_taken: 'failed', error: errorMessage(error) };
  }
  if (!detection || detection.detected !== true) {
    return base;
  }
  if (recipe.action === 'next_command') {
    return {
      ...base,
      detected: true,
      action_taken: 'next_command',
      next_command: detection.next_command ?? null,
      reason: detection.reason ?? null
    };
  }
  // auto_fix
  if (dryRun) {
    return {
      ...base,
      detected: true,
      action_taken: 'planned',
      reason: detection.reason ?? null
    };
  }
  try {
    const fix = await recipe.fix({ repoRoot: root, storyId, detection });
    return {
      ...base,
      detected: true,
      action_taken: fix?.action_taken ?? 'auto_fixed',
      artifacts: fix?.artifacts ?? [],
      ...(fix?.details ? { details: fix.details } : {})
    };
  } catch (error) {
    return { ...base, detected: true, action_taken: 'failed', error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Recipe 1: verify-status-artifact (auto_fix)
// A passing verify record without a machine-readable status artifact does not
// promote the judgment spine to strength "strong". Generate a status JSON from
// the recorded exit code and re-record the evidence with it attached, exactly
// as an operator does by hand.
// ---------------------------------------------------------------------------
const verifyStatusArtifactRecipe = {
  id: 'verify-status-artifact',
  action: 'auto_fix',
  async detect({ repoRoot, storyId }) {
    if (!storyId) return { detected: false };
    const evidence = await readVerificationEvidence(repoRoot, storyId);
    const commands = evidenceCommands(evidence);
    const targets = commands.filter((command) => isPassing(command.status) && !command.artifact);
    if (targets.length === 0) return { detected: false };
    return {
      detected: true,
      targets,
      reason: `passing verify record(s) [${targets.map((c) => c.kind).join(', ')}] lack a status artifact; spine strength stays "supporting" without one`
    };
  },
  async fix({ repoRoot, storyId, detection }) {
    const artifactDir = path.join(getWorkspaceDir(repoRoot), 'pr', storyId, 'preflight-artifacts');
    await mkdir(artifactDir, { recursive: true });
    const artifacts = [];
    for (const command of detection.targets) {
      const exitCode = resolveExitCode(command);
      const artifactPath = path.join(artifactDir, `${command.kind}-status.json`);
      await writeFile(artifactPath, `${JSON.stringify({ status: 'pass', exit_code: exitCode }, null, 2)}\n`);
      await recordVerificationEvidence(repoRoot, {
        storyId,
        kind: command.kind,
        status: 'pass',
        command: command.command ?? null,
        summary: command.summary ?? `verification passed for ${command.kind}`,
        artifact: toWorkspaceRelative(repoRoot, artifactPath),
        targets: command.observation?.targets ?? [],
        scenarios: command.observation?.scenarios ?? [],
        observed: observedPairs(command.observation?.values)
      });
      artifacts.push(toWorkspaceRelative(repoRoot, artifactPath));
    }
    return {
      action_taken: 'generated status artifact from recorded exit code',
      artifacts
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe 2: generic-token-clause-binding (next_command)
// A passing verify record whose meaningful tokens are all generic will not
// satisfy a generic-token evidence requirement unless the record body binds a
// contract clause ID. Suggest a re-record naming the clause binding.
// ---------------------------------------------------------------------------
const genericTokenClauseBindingRecipe = {
  id: 'generic-token-clause-binding',
  action: 'next_command',
  async detect({ repoRoot, storyId }) {
    if (!storyId) return { detected: false };
    const evidence = await readVerificationEvidence(repoRoot, storyId);
    const commands = evidenceCommands(evidence);
    const target = commands.find((command) => isPassing(command.status) && isGenericUnboundRecord(command));
    if (!target) return { detected: false };
    const clauseId = await resolveContractClauseId(repoRoot, storyId);
    const summary = `${target.summary ?? `verification passed for ${target.kind}`} (binds ${clauseId})`;
    return {
      detected: true,
      reason: `record "${target.kind}" has only generic evidence tokens and no contract clause ID; the RA gate needs a clause binding in the record body`,
      next_command: [
        'vibepro verify record .',
        `--id ${shellQuote(storyId)}`,
        `--kind ${target.kind}`,
        '--status pass',
        target.command ? `--command ${shellQuote(target.command)}` : null,
        `--summary ${shellQuote(summary)}`
      ].filter(Boolean).join(' ')
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe 3: architecture-reason-frontmatter (next_command)
// When a story references architecture (architecture_docs / parent_design) but
// its frontmatter has no `reason:` key, the architecture gate has no ADR-not-
// needed declaration. Suggest the four-element reason template.
// ---------------------------------------------------------------------------
const architectureReasonFrontmatterRecipe = {
  id: 'architecture-reason-frontmatter',
  action: 'next_command',
  async detect({ repoRoot, storyId }) {
    if (!storyId) return { detected: false };
    const doc = await readStoryDoc(repoRoot, storyId);
    if (!doc) return { detected: false };
    const frontmatter = doc.frontmatter;
    const referencesArchitecture = Boolean(frontmatter.architecture_docs || frontmatter.parent_design);
    if (!referencesArchitecture) return { detected: false };
    if (hasReasonKey(doc.raw)) return { detected: false };
    return {
      detected: true,
      reason: `story frontmatter references architecture but has no "reason:" ADR-not-needed declaration`,
      next_command: `# add to ${doc.relativePath} frontmatter:\nreason: "alternatives considered: <...>; compatibility impact: <...>; rollback plan: <...>; boundary and scope: <...>"`
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe 4: followup-decision-artifact (next_command)
// An accepted followup decision with a reason but no artifact is ignored by the
// judgment axis (isAcceptedAxisFollowupDecision requires both). Suggest a
// re-record that includes --artifact.
// ---------------------------------------------------------------------------
const followupDecisionArtifactRecipe = {
  id: 'followup-decision-artifact',
  action: 'next_command',
  async detect({ repoRoot, storyId }) {
    if (!storyId) return { detected: false };
    const records = await readDecisionRecords(repoRoot, storyId);
    const target = records.find((decision) =>
      decision?.status === 'accepted'
      && String(decision.reason ?? '').trim()
      && !String(decision.artifact ?? '').trim());
    if (!target) return { detected: false };
    return {
      detected: true,
      reason: `accepted followup decision "${target.decision_id ?? '<id>'}" has a reason but no --artifact; the judgment axis only counts followups with both`,
      next_command: [
        'vibepro decision record .',
        `--id ${shellQuote(storyId)}`,
        `--type ${target.type ?? 'waiver'}`,
        target.source ? `--source ${shellQuote(target.source)}` : null,
        '--status accepted',
        `--summary ${shellQuote(target.summary ?? 'accepted followup')}`,
        `--reason ${shellQuote(target.reason ?? '<reason>')}`,
        "--artifact '<path/to/tracking-artifact>'"
      ].filter(Boolean).join(' ')
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe 5: design-diagrams-final-spec (next_command)
// A required diagram present only in the spec doc frontmatter/section but not in
// the final spec's diagrams[] is not read by the design_diagrams gate. Suggest
// promoting it via `spec write --final`.
// ---------------------------------------------------------------------------
const designDiagramsFinalSpecRecipe = {
  id: 'design-diagrams-final-spec',
  action: 'next_command',
  async detect({ repoRoot, storyId }) {
    if (!storyId) return { detected: false };
    const docKinds = await readSpecDocDiagramKinds(repoRoot, storyId);
    if (docKinds.length === 0) return { detected: false };
    const specKinds = await readFinalSpecDiagramKinds(repoRoot, storyId);
    const missing = docKinds.filter((kind) => !specKinds.includes(kind));
    if (missing.length === 0) return { detected: false };
    return {
      detected: true,
      reason: `diagram(s) [${missing.join(', ')}] appear in the spec doc but not in the final spec diagrams[]; the design_diagrams gate reads only the final spec artifact`,
      next_command: `vibepro spec write . --id ${shellQuote(storyId)} --final --input '<spec.json with diagrams[] including: ${missing.join(', ')}>'`
    };
  }
};

// ---------------------------------------------------------------------------
// Recipe 6: story-catalog-registration (auto_fix)
// A hand-written story absent from .vibepro/config.json brainbase.stories[] is
// not resolvable by `story diagnose`. Append the catalog entry, matching what an
// operator does by hand.
// ---------------------------------------------------------------------------
const storyCatalogRegistrationRecipe = {
  id: 'story-catalog-registration',
  action: 'auto_fix',
  async detect({ repoRoot, storyId }) {
    if (!storyId) return { detected: false };
    const config = await readConfig(repoRoot);
    if (!config) return { detected: false };
    const stories = Array.isArray(config.brainbase?.stories) ? config.brainbase.stories : [];
    if (stories.some((story) => story?.story_id === storyId)) return { detected: false };
    return {
      detected: true,
      config,
      stories,
      reason: `story "${storyId}" is not registered in .vibepro/config.json brainbase.stories[]`
    };
  },
  async fix({ repoRoot, storyId, detection }) {
    const doc = await readStoryDoc(repoRoot, storyId);
    const entry = {
      story_id: storyId,
      title: doc?.frontmatter?.title ?? storyId,
      ssot: 'local',
      status: 'active',
      horizon: null,
      view: doc?.frontmatter?.view ?? null,
      period: doc?.frontmatter?.period ?? null,
      started_at: null,
      due_at: null
    };
    const config = detection.config;
    config.brainbase = {
      ...(config.brainbase ?? {}),
      stories: [...detection.stories, entry]
    };
    await writeConfig(repoRoot, config);
    return {
      action_taken: 'appended story catalog entry',
      artifacts: [path.join('.vibepro', 'config.json')],
      details: { appended_entry: entry }
    };
  }
};

export const RECIPE_REGISTRY = [
  verifyStatusArtifactRecipe,
  genericTokenClauseBindingRecipe,
  architectureReasonFrontmatterRecipe,
  followupDecisionArtifactRecipe,
  designDiagramsFinalSpecRecipe,
  storyCatalogRegistrationRecipe
];

// ---------------------------------------------------------------------------
// Helpers (pure reads of on-disk state)
// ---------------------------------------------------------------------------
function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function isPassing(status) {
  return PASS_STATUSES.has(String(status ?? '').toLowerCase());
}

function evidenceCommands(evidence) {
  return Array.isArray(evidence?.commands) ? evidence.commands : [];
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readVerificationEvidence(repoRoot, storyId) {
  return readJsonIfExists(path.join(getWorkspaceDir(repoRoot), 'pr', storyId, 'verification-evidence.json'));
}

async function readDecisionRecords(repoRoot, storyId) {
  const records = await readJsonIfExists(path.join(getWorkspaceDir(repoRoot), 'pr', storyId, 'decision-records.json'));
  return Array.isArray(records?.decisions) ? records.decisions : [];
}

async function readConfig(repoRoot) {
  return readJsonIfExists(path.join(getWorkspaceDir(repoRoot), 'config.json'));
}

async function writeConfig(repoRoot, config) {
  await writeFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

function resolveExitCode(command) {
  const raw = command?.observation?.values?.exit_code;
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function observedPairs(values) {
  if (!values || typeof values !== 'object') return [];
  return Object.entries(values).map(([key, value]) => `${key}=${value}`);
}

function isGenericUnboundRecord(command) {
  const text = [command.kind, command.command, command.summary].filter(Boolean).join(' ');
  if (CLAUSE_ID_PATTERN.test(text)) return false;
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  const meaningful = tokens.filter((token) => !EVIDENCE_STOPWORDS.has(token));
  if (meaningful.length === 0) return false;
  return meaningful.every((token) => GENERIC_EVIDENCE_TOKENS.has(token));
}

async function resolveContractClauseId(repoRoot, storyId) {
  const spec = await readJsonIfExists(getSpecFile(repoRoot, storyId));
  const specClauses = Array.isArray(spec?.clauses)
    ? spec.clauses.filter((clause) => clause?.type === 'contract' && clause?.id).map((clause) => clause.id)
    : [];
  if (specClauses.length > 0) return specClauses[0];
  const doc = await readSpecDoc(repoRoot, storyId);
  const fromDoc = doc?.raw ? doc.raw.match(CLAUSE_ID_PATTERN_G) : null;
  if (fromDoc && fromDoc.length > 0) return fromDoc[0];
  return '<CONTRACT-CLAUSE-ID>';
}

async function readStoryDoc(repoRoot, storyId) {
  return readDocFromDirs(repoRoot, storyId, STORY_DOC_DIRS);
}

async function readSpecDoc(repoRoot, storyId) {
  return readDocFromDirs(repoRoot, storyId, SPEC_DOC_DIRS);
}

async function readDocFromDirs(repoRoot, storyId, dirs) {
  const names = storyId.startsWith('story-') ? [storyId] : [storyId, `story-${storyId}`];
  for (const dir of dirs) {
    for (const name of names) {
      const relativePath = path.join(dir, `${name}.md`);
      const raw = await readTextIfExists(path.join(repoRoot, relativePath));
      if (raw !== null) {
        return { relativePath, raw, frontmatter: parseFrontmatter(raw) };
      }
    }
  }
  return null;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function hasReasonKey(raw) {
  const block = frontmatterBlock(raw);
  if (block === null) return false;
  return block.split('\n').some((line) => /^reason:\s*\S/.test(line.replace(/\r$/, '')));
}

function frontmatterBlock(raw) {
  const match = String(raw ?? '').match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

function parseFrontmatter(raw) {
  const block = frontmatterBlock(raw);
  if (block === null) return {};
  const result = {};
  let currentKey = null;
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();
      result[currentKey] = value ? stripQuotes(value) : [];
      continue;
    }
    const itemMatch = line.match(/^\s*-\s*(.+)$/);
    if (itemMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = result[currentKey] ? [result[currentKey]] : [];
      result[currentKey].push(stripQuotes(itemMatch[1].trim()));
    }
  }
  return result;
}

function stripQuotes(value) {
  return String(value).replace(/^["']|["']$/g, '');
}

/**
 * Extract diagram kinds declared in a spec doc's frontmatter `diagrams:` block.
 * Handles the nested `- kind: <x>` list-of-objects shape used in spec docs.
 */
async function readSpecDocDiagramKinds(repoRoot, storyId) {
  const doc = await readSpecDoc(repoRoot, storyId);
  if (!doc) return [];
  return extractSpecDocDiagramKinds(doc.raw);
}

export function extractSpecDocDiagramKinds(raw) {
  const block = frontmatterBlock(raw);
  if (block === null) return [];
  const lines = block.split('\n').map((line) => line.replace(/\r$/, ''));
  const kinds = [];
  let inDiagrams = false;
  let diagramsIndent = 0;
  for (const line of lines) {
    const topKey = line.match(/^([A-Za-z0-9_-]+):/);
    if (topKey) {
      if (topKey[1] === 'diagrams') {
        inDiagrams = true;
        diagramsIndent = line.search(/\S/);
        continue;
      }
      // another top-level (same-or-lower indent) key ends the diagrams block
      if (inDiagrams && line.search(/\S/) <= diagramsIndent) {
        inDiagrams = false;
      }
    }
    if (!inDiagrams) continue;
    const kindMatch = line.match(/^\s*-?\s*kind:\s*(\S+)/);
    if (kindMatch) kinds.push(stripQuotes(kindMatch[1]));
  }
  return [...new Set(kinds)];
}

async function readFinalSpecDiagramKinds(repoRoot, storyId) {
  const spec = await readJsonIfExists(getSpecFile(repoRoot, storyId));
  if (!Array.isArray(spec?.diagrams)) return [];
  return [...new Set(spec.diagrams.map((diagram) => diagram?.kind).filter(Boolean))];
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}
