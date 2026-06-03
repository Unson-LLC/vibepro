import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const CLAUSE_TYPES = new Set(['invariant', 'scenario', 'contract', 'sla']);
const ORIGIN_KINDS = new Set(['acceptance_criteria', 'background', 'policy', 'frontmatter', 'other']);
const DIAGRAM_KINDS = new Set(['er', 'state', 'sequence', 'flow', 'c4_context', 'deployment', 'threat_model', 'dfd']);
const DIAGRAM_PREFIXES = {
  er: ['erDiagram'],
  state: ['stateDiagram-v2', 'stateDiagram'],
  sequence: ['sequenceDiagram'],
  flow: ['flowchart ', 'flowchart\n', 'graph ', 'graph\n'],
  c4_context: ['C4Context', 'C4Container'],
  deployment: ['flowchart ', 'flowchart\n', 'graph ', 'graph\n', 'C4Deployment'],
  threat_model: ['flowchart ', 'flowchart\n', 'graph ', 'graph\n'],
  dfd: ['flowchart ', 'flowchart\n', 'graph ', 'graph\n']
};
const DIAGRAM_KINDS_REQUIRING_ENTITIES = new Set(['er', 'state', 'sequence', 'c4_context']);

export async function validateSpec(repoRoot, spec, options = {}) {
  const root = path.resolve(repoRoot);
  const errors = [];
  const warnings = [];

  if (!spec || typeof spec !== 'object') {
    return { ok: false, errors: [{ code: 'invalid_root', message: 'spec must be a JSON object' }], warnings };
  }

  if (spec.schema_version !== '0.1.0') {
    errors.push({ code: 'schema_version', message: `expected schema_version "0.1.0", got "${spec.schema_version}"` });
  }
  if (!spec.story_id || typeof spec.story_id !== 'string') {
    errors.push({ code: 'story_id', message: 'story_id must be a non-empty string' });
  }
  if (options.expectedStoryId && spec.story_id !== options.expectedStoryId) {
    errors.push({
      code: 'story_id_mismatch',
      message: `story_id "${spec.story_id}" does not match expected "${options.expectedStoryId}"`
    });
  }
  if (!Array.isArray(spec.clauses)) {
    errors.push({ code: 'clauses_missing', message: 'clauses must be an array' });
    return { ok: false, errors, warnings, spec };
  }

  const clauseReports = [];
  for (let index = 0; index < spec.clauses.length; index += 1) {
    const clause = spec.clauses[index];
    const report = await validateClause(root, clause, index);
    if (report.errors.length > 0) errors.push(...report.errors);
    if (report.warnings.length > 0) warnings.push(...report.warnings);
    clauseReports.push(report);
  }

  if (spec.diagrams !== undefined) {
    if (!Array.isArray(spec.diagrams)) {
      errors.push({ code: 'diagrams_shape', message: 'diagrams must be an array when present' });
    } else {
      const clauseTexts = (spec.clauses ?? [])
        .map((c) => `${c?.statement ?? ''}\n${c?.rationale ?? ''}`)
        .join('\n');
      for (let index = 0; index < spec.diagrams.length; index += 1) {
        const diagram = spec.diagrams[index];
        const report = validateDiagram(diagram, index, clauseTexts);
        if (report.errors.length > 0) errors.push(...report.errors);
        if (report.warnings.length > 0) warnings.push(...report.warnings);
      }
    }
  }

  if (Array.isArray(spec.open_questions)) {
    for (let index = 0; index < spec.open_questions.length; index += 1) {
      const question = spec.open_questions[index];
      if (!question || typeof question !== 'object') {
        errors.push({ code: 'open_question_shape', message: `open_questions[${index}] must be an object` });
        continue;
      }
      if (!question.id || typeof question.id !== 'string') {
        errors.push({ code: 'open_question_id', message: `open_questions[${index}].id must be a string` });
      }
      if (!question.question || typeof question.question !== 'string') {
        errors.push({ code: 'open_question_text', message: `open_questions[${index}].question must be a string` });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    clause_reports: clauseReports,
    spec
  };
}

async function validateClause(repoRoot, clause, index) {
  const errors = [];
  const warnings = [];

  if (!clause || typeof clause !== 'object') {
    errors.push({ code: 'clause_shape', message: `clauses[${index}] must be an object` });
    return { index, errors, warnings };
  }

  const locator = clause.id ? `clauses[${index}] (${clause.id})` : `clauses[${index}]`;
  if (!clause.id || typeof clause.id !== 'string') {
    errors.push({ code: 'clause_id_missing', message: `${locator}.id is required` });
  }
  if (!CLAUSE_TYPES.has(clause.type)) {
    errors.push({
      code: 'clause_type',
      message: `${locator}.type must be one of invariant|scenario|contract|sla`
    });
  }
  if (typeof clause.statement !== 'string' || clause.statement.trim().length < 4) {
    errors.push({ code: 'clause_statement', message: `${locator}.statement must be a non-empty string` });
  }

  const origin = clause.origin ?? {};
  const storyRefs = Array.isArray(origin.story_refs) ? origin.story_refs : [];
  const architectureRefs = Array.isArray(origin.architecture_refs) ? origin.architecture_refs : [];
  const codeRefs = Array.isArray(origin.code_refs) ? origin.code_refs : [];
  const testRefs = Array.isArray(origin.test_refs) ? origin.test_refs : [];
  if (storyRefs.length === 0 && architectureRefs.length === 0 && codeRefs.length === 0 && testRefs.length === 0) {
    errors.push({
      code: 'origin_empty',
      message: `${locator}.origin must include at least one of story_refs / architecture_refs / code_refs / test_refs`
    });
  }

  for (let i = 0; i < storyRefs.length; i += 1) {
    const ref = storyRefs[i];
    if (!ref || !ORIGIN_KINDS.has(ref.kind)) {
      errors.push({
        code: 'story_ref_kind',
        message: `${locator}.origin.story_refs[${i}].kind must be one of ${[...ORIGIN_KINDS].join('|')}`
      });
    }
  }

  for (let i = 0; i < architectureRefs.length; i += 1) {
    const ref = architectureRefs[i];
    if (!ref?.file || typeof ref.file !== 'string') {
      errors.push({ code: 'architecture_ref_file', message: `${locator}.origin.architecture_refs[${i}].file required` });
      continue;
    }
    const fileResult = await verifyFileExists(repoRoot, ref.file);
    if (!fileResult.exists) {
      errors.push({
        code: 'architecture_ref_missing',
        message: `${locator}.origin.architecture_refs[${i}].file "${ref.file}" not found in repository`
      });
    }
  }

  for (let i = 0; i < codeRefs.length; i += 1) {
    const ref = codeRefs[i];
    if (!ref?.file || typeof ref.file !== 'string') {
      errors.push({ code: 'code_ref_file', message: `${locator}.origin.code_refs[${i}].file required` });
      continue;
    }
    const fileResult = await verifyFileExists(repoRoot, ref.file);
    if (!fileResult.exists) {
      errors.push({
        code: 'code_ref_missing',
        message: `${locator}.origin.code_refs[${i}].file "${ref.file}" not found in repository`
      });
      continue;
    }
    if (ref.anchor) {
      const anchorHit = await fileIncludes(repoRoot, ref.file, ref.anchor);
      if (!anchorHit) {
        errors.push({
          code: 'code_ref_anchor',
          message: `${locator}.origin.code_refs[${i}].anchor "${ref.anchor}" not present in ${ref.file}`
        });
      }
    }
  }

  for (let i = 0; i < testRefs.length; i += 1) {
    const ref = testRefs[i];
    if (!ref?.file || typeof ref.file !== 'string') {
      errors.push({ code: 'test_ref_file', message: `${locator}.origin.test_refs[${i}].file required` });
      continue;
    }
    const fileResult = await verifyFileExists(repoRoot, ref.file);
    if (!fileResult.exists) {
      errors.push({
        code: 'test_ref_missing',
        message: `${locator}.origin.test_refs[${i}].file "${ref.file}" not found in repository`
      });
    }
  }

  if (clause.verifiable_by) {
    const codePatterns = Array.isArray(clause.verifiable_by.code_pattern) ? clause.verifiable_by.code_pattern : [];
    const testPatterns = Array.isArray(clause.verifiable_by.test_pattern) ? clause.verifiable_by.test_pattern : [];
    for (let i = 0; i < codePatterns.length; i += 1) {
      const issues = await verifyPattern(repoRoot, codePatterns[i], { locator: `${locator}.verifiable_by.code_pattern[${i}]` });
      for (const issue of issues) {
        if (issue.severity === 'error') errors.push(issue);
        else warnings.push(issue);
      }
    }
    for (let i = 0; i < testPatterns.length; i += 1) {
      const issues = await verifyPattern(repoRoot, testPatterns[i], { locator: `${locator}.verifiable_by.test_pattern[${i}]` });
      for (const issue of issues) {
        if (issue.severity === 'error') errors.push(issue);
        else warnings.push(issue);
      }
    }
  }

  return { index, id: clause.id ?? null, errors, warnings };
}

async function verifyPattern(repoRoot, pattern, { locator }) {
  const issues = [];
  if (!pattern || typeof pattern !== 'object' || typeof pattern.file_glob !== 'string') {
    issues.push({ severity: 'error', code: 'pattern_shape', message: `${locator}.file_glob required` });
    return issues;
  }
  const matched = await matchGlob(repoRoot, pattern.file_glob);
  if (matched.length === 0) {
    issues.push({
      severity: 'error',
      code: 'pattern_no_files',
      message: `${locator}: file_glob "${pattern.file_glob}" matched no files`
    });
    return issues;
  }

  if (pattern.must_contain) {
    const found = await anyFileContains(repoRoot, matched, pattern.must_contain);
    if (!found) {
      issues.push({
        severity: 'error',
        code: 'pattern_must_contain',
        message: `${locator}: must_contain "${pattern.must_contain}" not found in ${matched.length} matched file(s)`
      });
    }
  }
  if (pattern.must_not_contain) {
    const offender = await firstFileContaining(repoRoot, matched, pattern.must_not_contain);
    if (offender) {
      issues.push({
        severity: 'error',
        code: 'pattern_must_not_contain',
        message: `${locator}: must_not_contain "${pattern.must_not_contain}" found in ${offender}`
      });
    }
  }
  if (pattern.must_cover) {
    const found = await anyFileContains(repoRoot, matched, pattern.must_cover);
    if (!found) {
      issues.push({
        severity: 'warning',
        code: 'pattern_must_cover',
        message: `${locator}: must_cover "${pattern.must_cover}" not found in matched files`
      });
    }
  }

  return issues;
}

async function verifyFileExists(repoRoot, relativeFile) {
  const absolute = path.join(repoRoot, relativeFile);
  try {
    const stats = await stat(absolute);
    return { exists: stats.isFile(), absolute };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, absolute };
    throw error;
  }
}

async function fileIncludes(repoRoot, relativeFile, anchor) {
  try {
    const content = await readFile(path.join(repoRoot, relativeFile), 'utf8');
    return content.includes(anchor);
  } catch {
    return false;
  }
}

async function anyFileContains(repoRoot, files, needle) {
  for (const file of files) {
    if (await fileIncludes(repoRoot, file, needle)) return true;
  }
  return false;
}

async function firstFileContaining(repoRoot, files, needle) {
  for (const file of files) {
    if (await fileIncludes(repoRoot, file, needle)) return file;
  }
  return null;
}

export async function matchGlob(repoRoot, glob) {
  const root = path.resolve(repoRoot);
  const regex = globToRegExp(glob);
  const collected = [];
  await walkRepo(root, root, (relative) => {
    if (regex.test(relative)) collected.push(relative);
  });
  return collected;
}

async function walkRepo(currentDir, root, visit) {
  let entries = [];
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vibepro') continue;
    const next = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkRepo(next, root, visit);
      continue;
    }
    const relative = path.relative(root, next).split(path.sep).join('/');
    visit(relative);
  }
}

export function globToRegExp(glob) {
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          pattern += '(?:.*/)?';
          i += 3;
          continue;
        }
        pattern += '.*';
        i += 2;
        continue;
      }
      pattern += '[^/]*';
      i += 1;
      continue;
    }
    if (char === '?') {
      pattern += '[^/]';
      i += 1;
      continue;
    }
    if (char === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        pattern += '\\{';
        i += 1;
        continue;
      }
      const options = glob.slice(i + 1, end).split(',').map((opt) => escapeRegExp(opt));
      pattern += `(?:${options.join('|')})`;
      i = end + 1;
      continue;
    }
    if ('.+^$()|[]\\'.includes(char)) {
      pattern += `\\${char}`;
      i += 1;
      continue;
    }
    pattern += char;
    i += 1;
  }
  return new RegExp(`^${pattern}$`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateDiagram(diagram, index, clauseTexts) {
  const errors = [];
  const warnings = [];
  const locator = `diagrams[${index}]`;

  if (!diagram || typeof diagram !== 'object') {
    errors.push({ code: 'diagram_shape', message: `${locator} must be an object` });
    return { errors, warnings };
  }
  if (!DIAGRAM_KINDS.has(diagram.kind)) {
    errors.push({
      code: 'diagram_kind',
      message: `${locator}.kind must be one of ${[...DIAGRAM_KINDS].join(', ')}`
    });
    return { errors, warnings };
  }
  if (typeof diagram.mermaid !== 'string' || diagram.mermaid.trim().length === 0) {
    errors.push({ code: 'diagram_mermaid_missing', message: `${locator}.mermaid must be a non-empty string` });
    return { errors, warnings };
  }

  const firstLine = diagram.mermaid.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const trimmed = firstLine.trimStart();
  const prefixes = DIAGRAM_PREFIXES[diagram.kind] ?? [];
  const matchesPrefix = prefixes.some((prefix) => trimmed.startsWith(prefix.trim()));
  if (!matchesPrefix) {
    errors.push({
      code: 'diagram_mermaid_prefix',
      message: `${locator}.mermaid first line must start with one of: ${prefixes.map((p) => p.trim()).join(' | ')} (got "${trimmed.slice(0, 40)}")`
    });
  }

  if (DIAGRAM_KINDS_REQUIRING_ENTITIES.has(diagram.kind)) {
    if (!Array.isArray(diagram.entities) || diagram.entities.length === 0) {
      errors.push({
        code: 'diagram_entities_required',
        message: `${locator}.entities is required and non-empty for kind=${diagram.kind}`
      });
    } else if (clauseTexts) {
      for (const entity of diagram.entities) {
        if (typeof entity !== 'string' || entity.length === 0) continue;
        if (!clauseTexts.includes(entity)) {
          warnings.push({
            code: 'diagram_entity_clause_mismatch',
            message: `${locator}.entities entry "${entity}" does not appear in any clause statement or rationale`
          });
        }
      }
    }
  }

  return { errors, warnings };
}

// Compute the design_diagrams gate verdict by comparing required vs provided.
// Pure function — no I/O.
export function evaluateDesignDiagramsGate({ required_diagrams = [], reasons = [], spec } = {}) {
  const providedKinds = new Set(
    Array.isArray(spec?.diagrams)
      ? spec.diagrams.map((d) => d?.kind).filter((k) => DIAGRAM_KINDS.has(k))
      : []
  );
  const missing = required_diagrams.filter((kind) => !providedKinds.has(kind));
  let status;
  if (required_diagrams.length === 0) status = 'not_applicable';
  else if (missing.length === 0) status = 'pass';
  else status = 'blocked';
  return {
    id: 'gate:design_diagrams',
    label: 'Design Diagrams (MUST-HAVE)',
    blocking: true,
    status,
    required: [...required_diagrams],
    provided: [...providedKinds],
    missing,
    reasons
  };
}
