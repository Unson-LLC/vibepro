import { STANDARD_JUDGMENT_AXES } from './senior-judgment-dag.js';

const SECTION_TITLES = Object.freeze({
  'Problem Frame': 'problem_frame',
  'Constraints': 'constraints',
  'Options': 'options',
  'Current Constraint': 'current_constraint',
  'Observations': 'observations',
  'Axes': 'axes'
});

const FRAME_STATUS = new Set(['valid', 'invalid', 'uncertain']);
const CONSTRAINT_KIND = new Set(['invariant', 'preference']);
const CURRENT_CONSTRAINT_KIND = new Set(['value_constraint', 'structural_excess']);
const CONSTRAINT_STATUS = new Set(['verified', 'hypothesized', 'unknown']);
const DECISION_EVIDENCE_STATUS = new Set(['sufficient', 'insufficient', 'unknown']);
const OPTION_ACTION = new Set(['build', 'fix', 'delete', 'consolidate', 'redesign', 'retire', 'measure', 'experiment']);
const RESIDUAL_RISK = new Set(['low', 'medium', 'high', 'unknown']);
const FRESHNESS = new Set(['current', 'stale', 'unknown']);
const ACTIVATION = new Set(['active', 'inactive']);
const EVIDENCE_RELATION = new Set(['supports', 'refutes', 'non_discriminating']);
const FIELD_PATTERN = /^- ([a-z][a-z0-9_]*):[ \t]*(.*)$/;
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

export function parseJudgmentStorySections(markdown) {
  const sections = collectSections(markdown);
  return {
    problem_frame: readProblemFrame(sections.get('problem_frame')),
    constraints: readNamedRecords(sections.get('constraints'), 'Constraints', readConstraint),
    options: readNamedRecords(sections.get('options'), 'Options', readOption),
    current_constraint: readCurrentConstraint(sections.get('current_constraint')),
    observations: readNamedRecords(sections.get('observations'), 'Observations', readObservation),
    axes: readAxes(sections.get('axes'))
  };
}

export function applyJudgmentStorySections(input, sections, standardAxes = STANDARD_JUDGMENT_AXES) {
  const next = input;
  if (sections.problem_frame) next.problem_frame = sections.problem_frame;
  if (sections.constraints) next.constraints = sections.constraints;
  if (sections.options) next.options = sections.options;
  if (sections.current_constraint) {
    next.development_cycle = {
      ...next.development_cycle,
      current_constraint: sections.current_constraint
    };
  }
  if (sections.observations) next.observations = sections.observations;
  if (sections.axes) next.axes = overlayAxes(next.axes, sections.axes, standardAxes);
  return next;
}

function collectSections(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const sections = new Map();
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{2,5})[ \t]+(.+?)[ \t]*$/);
    if (heading && heading[1].length === 2) {
      current = null;
      const title = heading[2];
      const key = SECTION_TITLES[title];
      if (!key) continue;
      if (sections.has(key)) {
        throw sectionError(title, `heading "## ${title}" is duplicated`, index + 1);
      }
      current = { key, title, lines: [] };
      sections.set(key, current);
      continue;
    }
    if (current) current.lines.push({ text: lines[index], number: index + 1 });
  }
  return sections;
}

function readProblemFrame(section) {
  const fields = readScalarSection(section, 'Problem Frame', ['status', 'statement', 'reason']);
  if (!fields) return null;
  return {
    status: enumValue(section.title, 'status', fields.status, FRAME_STATUS),
    statement: fields.statement,
    reason: fields.reason
  };
}

function readCurrentConstraint(section) {
  const fields = readScalarSection(section, 'Current Constraint', [
    'kind',
    'status',
    'statement',
    'source_refs',
    'decision_evidence_status',
    'decision_evidence_reason',
    'decision_evidence_source_refs'
  ]);
  if (!fields) return null;
  return {
    kind: enumValue(section.title, 'kind', fields.kind, CURRENT_CONSTRAINT_KIND),
    status: enumValue(section.title, 'status', fields.status, CONSTRAINT_STATUS),
    statement: fields.statement,
    source_refs: pathList(section.title, 'source_refs', fields.source_refs),
    decision_evidence: {
      status: enumValue(section.title, 'decision_evidence_status', fields.decision_evidence_status, DECISION_EVIDENCE_STATUS),
      reason: fields.decision_evidence_reason,
      source_refs: pathList(section.title, 'decision_evidence_source_refs', fields.decision_evidence_source_refs)
    }
  };
}

function readConstraint(sectionTitle, id, lines) {
  const fields = readFields(sectionTitle, id, lines, ['kind', 'statement'], 0);
  return {
    id,
    kind: enumValue(sectionTitle, 'kind', fields.kind, CONSTRAINT_KIND, id),
    statement: fields.statement
  };
}

function readOption(sectionTitle, id, lines) {
  const fields = readFields(sectionTitle, id, lines, ['summary', 'action', 'residual_risk'], 0, ['addresses', 'violates']);
  return {
    id,
    summary: fields.summary,
    action: enumValue(sectionTitle, 'action', fields.action, OPTION_ACTION, id),
    addresses: listValue(sectionTitle, 'addresses', fields.addresses ?? ''),
    violates: listValue(sectionTitle, 'violates', fields.violates ?? ''),
    residual_risk: enumValue(sectionTitle, 'residual_risk', fields.residual_risk, RESIDUAL_RISK, id)
  };
}

function readObservation(sectionTitle, id, lines) {
  const fields = readFields(sectionTitle, id, lines, ['statement', 'source_ref', 'freshness'], 0);
  return {
    id,
    statement: fields.statement,
    source_ref: fields.source_ref,
    freshness: enumValue(sectionTitle, 'freshness', fields.freshness, FRESHNESS, id)
  };
}

function readAxes(section) {
  if (!section || isBlank(section.lines)) return null;
  const records = readChildren(section.title, section.lines, 3);
  return records.map((record) => {
    if (!STANDARD_JUDGMENT_AXES.includes(record.id)) {
      throw sectionError(section.title, `axis "${record.id}" is not a standard judgment axis`, record.number);
    }
    const fields = {};
    const hypotheses = [];
    const fieldLines = [];
    let hypothesis = null;
    for (const line of record.lines) {
      if (!line.text.trim()) continue;
      const heading = headingAt(line);
      if (heading && heading.level === 4) {
        if (hypothesis) hypotheses.push(finishHypothesis(section.title, hypothesis));
        if (!ID_PATTERN.test(heading.title)) {
          throw sectionError(section.title, `hypothesis id "${heading.title}" is not a lowercase identifier`, line.number);
        }
        hypothesis = { id: heading.title, lines: [], number: line.number };
        continue;
      }
      if (heading) {
        if (!hypothesis) {
          throw sectionError(section.title, `unexpected heading "${line.text.trim()}" under axis ${record.id}`, line.number);
        }
        hypothesis.lines.push(line);
        continue;
      }
      if (hypothesis) {
        hypothesis.lines.push(line);
        continue;
      }
      fieldLines.push(line);
    }
    if (hypothesis) hypotheses.push(finishHypothesis(section.title, hypothesis));
    Object.assign(fields, readFields(section.title, record.id, fieldLines, ['activation', 'activation_reason'], 0));
    const activation = enumValue(section.title, 'activation', fields.activation, ACTIVATION, record.id);
    if (activation === 'active' && hypotheses.length === 0) {
      throw sectionError(section.title, `active axis ${record.id} must declare at least one hypothesis`, record.number);
    }
    return {
      id: record.id,
      activation,
      activation_reason: fields.activation_reason,
      hypotheses
    };
  });
}

function finishHypothesis(sectionTitle, hypothesis) {
  const predictions = [];
  const evidence = [];
  const fieldLines = [];
  let child = null;
  for (const line of hypothesis.lines) {
    if (!line.text.trim()) continue;
    const heading = headingAt(line);
    if (heading && heading.level === 5) {
      if (child) classifyEvidenceChild(sectionTitle, child, predictions, evidence);
      if (!ID_PATTERN.test(heading.title)) {
        throw sectionError(sectionTitle, `id "${heading.title}" is not a lowercase identifier`, line.number);
      }
      child = { id: heading.title, lines: [], number: line.number };
      continue;
    }
    if (heading) {
      throw sectionError(sectionTitle, `unexpected heading "${line.text.trim()}" under hypothesis ${hypothesis.id}`, line.number);
    }
    if (child) child.lines.push(line);
    else fieldLines.push(line);
  }
  if (child) classifyEvidenceChild(sectionTitle, child, predictions, evidence);
  const fields = readFields(sectionTitle, hypothesis.id, fieldLines, ['claim'], 0);
  if (predictions.length === 0) {
    throw sectionError(sectionTitle, `hypothesis ${hypothesis.id} must declare at least one prediction`, hypothesis.number);
  }
  return {
    id: hypothesis.id,
    claim: fields.claim,
    predictions,
    evidence
  };
}

function classifyEvidenceChild(sectionTitle, child, predictions, evidence) {
  const raw = readFields(sectionTitle, child.id, child.lines, [], 0, [
    'statement',
    'prediction_id',
    'relation',
    'freshness',
    'source_ref',
    'summary'
  ]);
  const keys = Object.keys(raw);
  const isPrediction = keys.length === 1 && keys[0] === 'statement';
  const isEvidence = ['prediction_id', 'relation', 'freshness', 'source_ref', 'summary'].every((key) => keys.includes(key))
    && keys.length === 5;
  if (isPrediction) {
    if (!String(raw.statement).trim()) {
      throw sectionError(sectionTitle, `prediction ${child.id} statement is empty`, child.number);
    }
    predictions.push({ id: child.id, statement: raw.statement });
    return;
  }
  if (isEvidence) {
    evidence.push({
      id: child.id,
      prediction_id: raw.prediction_id,
      relation: enumValue(sectionTitle, 'relation', raw.relation, EVIDENCE_RELATION, child.id),
      freshness: enumValue(sectionTitle, 'freshness', raw.freshness, FRESHNESS, child.id),
      source_ref: raw.source_ref,
      summary: raw.summary
    });
    return;
  }
  throw sectionError(
    sectionTitle,
    `"${child.id}" must be a prediction with statement, or evidence with prediction_id, relation, freshness, source_ref, and summary`,
    child.number
  );
}

function readNamedRecords(section, title, readOne) {
  if (!section || isBlank(section.lines)) return null;
  return readChildren(title, section.lines, 3).map((child) => readOne(title, child.id, child.lines));
}

function readScalarSection(section, title, required) {
  if (!section || isBlank(section.lines)) return null;
  return readFields(title, null, section.lines, required, 0);
}

function readChildren(sectionTitle, lines, level) {
  const children = [];
  let child = null;
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const heading = headingAt(line);
    if (heading && heading.level === level) {
      if (child) children.push(child);
      if (!ID_PATTERN.test(heading.title)) {
        throw sectionError(sectionTitle, `id "${heading.title}" is not a lowercase identifier`, line.number);
      }
      child = { id: heading.title, lines: [], number: line.number };
      continue;
    }
    if (!child) {
      throw sectionError(sectionTitle, `expected a "###" item before "${line.text.trim()}"`, line.number);
    }
    if (heading && heading.level <= level) {
      throw sectionError(sectionTitle, `unexpected heading "${line.text.trim()}"`, line.number);
    }
    child.lines.push(line);
  }
  if (child) children.push(child);
  if (children.length === 0) {
    throw sectionError(sectionTitle, 'section has text but no items', lines[0]?.number);
  }
  const ids = new Set();
  for (const item of children) {
    if (ids.has(item.id)) throw sectionError(sectionTitle, `id "${item.id}" is duplicated`, item.number);
    ids.add(item.id);
  }
  return children;
}

function readFields(sectionTitle, ownerId, lines, required, childLevel, optional = []) {
  const allowed = new Set([...required, ...optional]);
  const fields = {};
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const heading = headingAt(line);
    if (heading) {
      if (childLevel && heading.level > childLevel) {
        throw sectionError(sectionTitle, `unexpected heading "${line.text.trim()}"`, line.number);
      }
      throw sectionError(sectionTitle, `unexpected heading "${line.text.trim()}"`, line.number);
    }
    const match = line.text.match(FIELD_PATTERN);
    if (!match) {
      throw sectionError(sectionTitle, `invalid line "${line.text.trim()}". Expected "- key: value"`, line.number);
    }
    const key = match[1];
    if (!allowed.has(key)) {
      throw sectionError(sectionTitle, `unknown field "${key}"${ownerId ? ` on ${ownerId}` : ''}`, line.number);
    }
    if (Object.hasOwn(fields, key)) {
      throw sectionError(sectionTitle, `field "${key}" is duplicated${ownerId ? ` on ${ownerId}` : ''}`, line.number);
    }
    fields[key] = match[2].trim();
  }
  for (const key of required) {
    if (!String(fields[key] ?? '').trim()) {
      throw sectionError(sectionTitle, `field "${key}" is required${ownerId ? ` on ${ownerId}` : ''}`, lines[0]?.number);
    }
  }
  return fields;
}

function overlayAxes(existing, declared, standardAxes) {
  const byId = new Map(declared.map((axis) => [axis.id, axis]));
  const base = Array.isArray(existing) && existing.length === standardAxes.length
    ? existing
    : standardAxes.map((id) => ({
      id,
      activation: 'inactive',
      activation_reason: 'Prepared as inactive until the problem frame and relevant risk surface are explicitly reviewed.',
      hypotheses: []
    }));
  return base.map((axis) => byId.get(axis.id) ?? axis);
}

function headingAt(line) {
  const match = line.text.match(/^(#{2,5})[ \t]+(.+?)[ \t]*$/);
  if (!match) return null;
  return { level: match[1].length, title: match[2] };
}

function isBlank(lines) {
  return lines.every((line) => !line.text.trim());
}

function enumValue(sectionTitle, field, value, allowed, ownerId) {
  if (!allowed.has(value)) {
    throw sectionError(
      sectionTitle,
      `${field}${ownerId ? ` on ${ownerId}` : ''} must be one of ${[...allowed].join(', ')}. Received "${value}"`,
      null
    );
  }
  return value;
}

function listValue(sectionTitle, field, value) {
  const items = splitList(value);
  for (const item of items) {
    if (!ID_PATTERN.test(item)) {
      throw sectionError(sectionTitle, `${field} item "${item}" is not a lowercase identifier`, null);
    }
  }
  return items;
}

function pathList(sectionTitle, field, value) {
  const items = splitList(value);
  if (items.length === 0) {
    throw sectionError(sectionTitle, `field "${field}" is required`, null);
  }
  return items;
}

function splitList(value) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function sectionError(title, message, line) {
  const where = line ? ` at line ${line}` : '';
  return new Error(`Judgment story section "## ${title}"${where}: ${message}.`);
}
