import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_STYLE_PRESET_ID,
  listUiuxStylePresets,
  renderStylePresetMarkdown,
  resolveUiuxStylePreset
} from './uiux-style-presets.js';

const INTAKE_SCHEMA_VERSION = '0.1.0';
const STATUS_EXPLICIT = 'explicit';
const STATUS_INFERRED = 'inferred';
const STATUS_MISSING = 'missing';
const STATUS_NOT_APPLICABLE = 'not_applicable';

export const UIUX_INTAKE_FIELDS = [
  ['product_service', 'Product or service', 'What product, service, or workflow this UI/UX work represents.'],
  ['target_users', 'Target users', 'Primary user segments, usage context, and constraints.'],
  ['jobs_to_be_done', 'Jobs to be done', 'User jobs, success moments, and expected outcomes.'],
  ['business_purpose', 'Business purpose', 'The measurable product or business reason for the UI/UX work.'],
  ['route_scope', 'Route scope', 'Routes, screens, and workflow boundaries in scope.'],
  ['current_authority', 'Current-code authority', 'Current routes, code, and data contracts that remain authoritative.'],
  ['desired_impression', 'Desired impression', 'Words or qualities the experience should communicate.'],
  ['avoided_impression', 'Avoided impression', 'Words, visuals, or UX moves to avoid.'],
  ['visual_style', 'Visual style', 'Reference style direction, with concrete constraints.'],
  ['tone_manner', 'Tone and manner', 'Copy, voice, and interaction tone.'],
  ['color_policy', 'Color policy', 'Color roles, brand constraints, and semantic usage.'],
  ['typography_policy', 'Typography policy', 'Readable type scale, language handling, and hierarchy.'],
  ['component_policy', 'Component policy', 'Component roles, variants, reuse, and allowed changes.'],
  ['ui_state_policy', 'UI state policy', 'Loading, empty, error, disabled, selected, and success states.'],
  ['spacing_depth_policy', 'Spacing and depth policy', 'Density, grouping, elevation, radii, and hierarchy constraints.'],
  ['responsive_policy', 'Responsive policy', 'Mobile, tablet, desktop, and viewport-specific behavior.'],
  ['accessibility_policy', 'Accessibility policy', 'Keyboard, contrast, reduced motion, labels, and assistive tech constraints.'],
  ['design_token_policy', 'Design token policy', 'Token source, naming, fallback, and implementation boundaries.']
].map(([id, label, prompt]) => ({ id, label, prompt, required: true }));

const VAGUE_BRIEF_PATTERNS = [
  /いい感じ/,
  /おしゃれ/,
  /かっこよく/,
  /ブラッシュアップ/,
  /改善/,
  /moderni[sz]e/i,
  /make (it|this) better/i,
  /improve (the )?(ui|ux|design)/i,
  /polish/i,
  /refine/i,
  /better ux/i
];

export async function createUiuxIntakeTemplate(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options);
  const outDir = path.join(root, '.vibepro', 'uiux', storyId);
  const intakePath = path.join(outDir, 'uiux-intake.json');
  const intake = buildTemplateIntake({ storyId, routes: normalizeRoutes(options.routes) });
  const coverage = buildUiuxIntakeCoverage({
    storyId,
    intake,
    routes: options.routes,
    sourcePath: path.relative(root, intakePath).split(path.sep).join('/')
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(intakePath, `${JSON.stringify(intake, null, 2)}\n`);
  await writeFile(path.join(outDir, 'uiux-intake.md'), renderUiuxIntakeTemplate(intake));
  await writeFile(path.join(outDir, 'uiux-intake-coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);

  return { outDir, intake, coverage };
}

export async function validateUiuxIntake(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options);
  const intakeResult = await readUiuxIntake(root, { storyId, intakeFile: options.intakeFile });
  const coverage = buildUiuxIntakeCoverage({
    storyId,
    intake: intakeResult.intake,
    brief: options.brief,
    routes: options.routes,
    sourcePath: intakeResult.sourcePath,
    missingArtifact: intakeResult.missingArtifact
  });
  const outDir = path.join(root, '.vibepro', 'uiux', storyId);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'uiux-intake-coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
  return { outDir, intake: intakeResult.intake, coverage };
}

export async function resolveUiuxIntakeForPlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options);
  const intakeResult = await readUiuxIntake(root, { storyId, intakeFile: options.intakeFile });
  const coverage = buildUiuxIntakeCoverage({
    storyId,
    intake: intakeResult.intake,
    brief: options.brief,
    routes: options.routes,
    sourcePath: intakeResult.sourcePath,
    missingArtifact: intakeResult.missingArtifact
  });
  return { intake: intakeResult.intake, coverage, sourcePath: intakeResult.sourcePath };
}

export function buildUiuxIntakeCoverage({ storyId, intake, brief, routes = [], sourcePath = null, missingArtifact = false }) {
  const normalized = normalizeIntakeFields(intake);
  const stylePreset = resolveUiuxStylePreset({ intake, brief, routes });
  const fields = UIUX_INTAKE_FIELDS.map((definition) => {
    const field = normalized.get(definition.id);
    const status = normalizeFieldStatus(field, { missingArtifact });
    return {
      id: definition.id,
      label: definition.label,
      required: definition.required,
      status,
      value_present: hasFieldValue(field),
      source: field?.source ?? sourcePath ?? null,
      rationale: field?.rationale ?? null,
      evidence: Array.isArray(field?.evidence) ? field.evidence : []
    };
  });
  const summary = summarizeCoverage(fields);
  const vagueBrief = detectVagueBrief(brief);
  const missingRequiredFields = fields
    .filter((field) => field.required && field.status === STATUS_MISSING)
    .map((field) => field.id);
  const status = determineCoverageStatus({ missingRequiredFields, missingArtifact, vagueBrief });
  const guidance = status === 'ready_for_design'
    ? []
    : [
        'Run `vibepro uiux intake template <repo> --id <story-id>` and fill explicit or not_applicable values.',
        'Run `vibepro uiux intake validate <repo> --id <story-id> --json` before treating UI/UX direction as complete.',
        'Keep current route code, screenshots, data contracts, and VibePro specs authoritative when intake conflicts.'
      ];

  return {
    schema_version: INTAKE_SCHEMA_VERSION,
    workflow: 'uiux-intake-coverage',
    story_id: storyId,
    generated_at: new Date().toISOString(),
    status,
    source: {
      artifact: sourcePath,
      missing: missingArtifact,
      authority: intake ? 'operator_structured_reference' : 'missing_structured_intake'
    },
    authority_boundary: buildAuthorityBoundary(),
    summary,
    style_preset: stylePreset,
    brief: brief ? {
      status: vagueBrief.detected ? 'vague_only' : 'available',
      needs_intake_detail: vagueBrief.detected,
      excerpt: brief.slice(0, 240),
      reason: vagueBrief.reason
    } : null,
    routes: normalizeRoutes(routes),
    missing_required_fields: missingRequiredFields,
    fields,
    guidance
  };
}

export function renderUiuxIntakeCoverageSummary({ outDir, coverage }) {
  return `# UI/UX Intake Coverage

| Item | Value |
|------|-------|
| Story | ${coverage.story_id} |
| Status | ${coverage.status} |
| Explicit | ${coverage.summary.explicit} |
| Inferred | ${coverage.summary.inferred} |
| Missing | ${coverage.summary.missing} |
| Not applicable | ${coverage.summary.not_applicable} |
| Style preset | ${coverage.style_preset?.selected_preset?.id ?? coverage.style_preset?.selection?.status ?? 'missing'} |
| Style preset confidence | ${coverage.style_preset?.selection?.confidence ?? '-'} |
| Output | ${outDir} |

## Missing Required Fields

${coverage.missing_required_fields.length === 0 ? '- none' : coverage.missing_required_fields.map((field) => `- ${field}`).join('\n')}

## Style Preset

${renderStylePresetMarkdown(coverage.style_preset)}

## Guidance

${coverage.guidance.length === 0 ? '- ready' : coverage.guidance.map((item) => `- ${item}`).join('\n')}
`;
}

export function renderUiuxIntakeTemplateSummary({ outDir, intake, coverage }) {
  return `# UI/UX Intake Template

| Item | Value |
|------|-------|
| Story | ${intake.story_id} |
| Fields | ${Object.keys(intake.fields).length} |
| Default style preset | ${intake.style_preset?.preset_id ?? '-'} |
| Coverage status | ${coverage.status} |
| Output | ${outDir} |

Edit ${path.join(outDir, 'uiux-intake.json')} and rerun validate.
`;
}

export function renderUiuxIntakeTemplate(intake) {
  return `# ${intake.story_id} UI/UX Intake

This artifact captures structured UI/UX direction. It is reference input only; current code, route evidence, screenshots, and VibePro specs remain authoritative when conflicts appear.

## Style Preset

- Field: \`style_preset\`
- Status: ${intake.style_preset.status}
- Preset: ${intake.style_preset.preset_id}
- Confidence: ${intake.style_preset.confidence}
- Rationale: ${intake.style_preset.rationale}
- Evidence: ${(intake.style_preset.evidence ?? []).join(', ')}
- Supported presets: ${listUiuxStylePresets().map((preset) => preset.id).join(', ')}
- Note: preset guidance is bounded by native Design System tokens and component roles.

${UIUX_INTAKE_FIELDS.map((field) => {
  const value = intake.fields[field.id];
  return `## ${field.label}

- Field: \`${field.id}\`
- Status: ${value.status}
- Prompt: ${field.prompt}
- Value: ${value.value ?? ''}
- Rationale: ${value.rationale ?? ''}
- Evidence: ${(value.evidence ?? []).join(', ')}
`;
}).join('\n')}
`;
}

function buildTemplateIntake({ storyId, routes }) {
  return {
    schema_version: INTAKE_SCHEMA_VERSION,
    workflow: 'uiux-intake',
    story_id: storyId,
    generated_at: new Date().toISOString(),
    authority: 'reference_only_uiux_intake',
    authority_boundary: buildAuthorityBoundary(),
    routes,
    style_preset: {
      status: STATUS_INFERRED,
      preset_id: DEFAULT_STYLE_PRESET_ID,
      confidence: 0.55,
      rationale: 'Default VibePro archetype is operator/developer cockpit unless structured product evidence selects another preset.',
      evidence: ['default_archetype_policy'],
      supported_presets: listUiuxStylePresets().map((preset) => preset.id)
    },
    fields: Object.fromEntries(UIUX_INTAKE_FIELDS.map((field) => [
      field.id,
      {
        label: field.label,
        status: STATUS_MISSING,
        value: null,
        rationale: '',
        evidence: []
      }
    ]))
  };
}

function buildAuthorityBoundary() {
  return {
    intake_role: 'structured_product_and_design_context',
    authoritative_sources: [
      'current_route_code',
      'existing_data_contracts',
      'VibePro story/spec/architecture artifacts',
      'captured runtime evidence'
    ],
    conflict_policy: 'current_route_code_and_verified_contracts_win_over_intake_text'
  };
}

async function readUiuxIntake(repoRoot, { storyId, intakeFile }) {
  const defaultPath = path.join(repoRoot, '.vibepro', 'uiux', storyId, 'uiux-intake.json');
  const absolutePath = intakeFile
    ? path.isAbsolute(intakeFile) ? intakeFile : path.join(repoRoot, intakeFile)
    : defaultPath;
  try {
    const intake = JSON.parse(await readFile(absolutePath, 'utf8'));
    return {
      intake,
      sourcePath: path.relative(repoRoot, absolutePath).split(path.sep).join('/'),
      missingArtifact: false
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      intake: null,
      sourcePath: path.relative(repoRoot, absolutePath).split(path.sep).join('/'),
      missingArtifact: true
    };
  }
}

function normalizeIntakeFields(intake) {
  const result = new Map();
  if (!intake || typeof intake !== 'object') return result;
  const source = intake.fields && typeof intake.fields === 'object' ? intake.fields : intake;
  for (const definition of UIUX_INTAKE_FIELDS) {
    const raw = source[definition.id];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      result.set(definition.id, raw);
    } else if (raw !== undefined && raw !== null && raw !== '') {
      result.set(definition.id, {
        status: STATUS_EXPLICIT,
        value: raw,
        source: 'top_level_field'
      });
    }
  }
  return result;
}

function normalizeFieldStatus(field, { missingArtifact }) {
  if (missingArtifact || !field) return STATUS_MISSING;
  if (field.status === STATUS_EXPLICIT || field.status === STATUS_INFERRED || field.status === STATUS_NOT_APPLICABLE) {
    return field.status;
  }
  if (field.status === STATUS_MISSING) return STATUS_MISSING;
  return hasFieldValue(field) ? STATUS_EXPLICIT : STATUS_MISSING;
}

function hasFieldValue(field) {
  if (!field || field.status === STATUS_NOT_APPLICABLE) return field?.status === STATUS_NOT_APPLICABLE;
  const value = field.value ?? field.text ?? field.answer ?? null;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function summarizeCoverage(fields) {
  const initial = {
    total: fields.length,
    required_total: fields.filter((field) => field.required).length,
    explicit: 0,
    inferred: 0,
    missing: 0,
    not_applicable: 0
  };
  return fields.reduce((summary, field) => {
    if (field.status === STATUS_EXPLICIT) summary.explicit += 1;
    if (field.status === STATUS_INFERRED) summary.inferred += 1;
    if (field.status === STATUS_MISSING) summary.missing += 1;
    if (field.status === STATUS_NOT_APPLICABLE) summary.not_applicable += 1;
    return summary;
  }, initial);
}

function determineCoverageStatus({ missingRequiredFields, missingArtifact, vagueBrief }) {
  if (missingArtifact && vagueBrief.detected) return 'needs_intake_detail';
  if (missingArtifact) return 'needs_intake';
  if (missingRequiredFields.length > 0) return 'needs_intake_detail';
  return 'ready_for_design';
}

function detectVagueBrief(brief) {
  const text = String(brief ?? '').trim();
  if (!text) return { detected: false, reason: null };
  const vaguePattern = VAGUE_BRIEF_PATTERNS.find((pattern) => pattern.test(text));
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const structuredSignals = UIUX_INTAKE_FIELDS.filter((field) => {
    const needle = field.id.replace(/_/g, ' ');
    return text.toLowerCase().includes(needle);
  }).length;
  const detected = Boolean(vaguePattern) && (wordCount <= 24 || structuredSignals < 2);
  return {
    detected,
    reason: detected
      ? `Brief matched vague UI/UX wording (${vaguePattern}). Structured intake detail is required.`
      : null
  };
}

function normalizeRoutes(routes = []) {
  if (!Array.isArray(routes)) return [];
  return routes.map((route) => String(route).trim()).filter(Boolean);
}

function requireStoryId(options) {
  const storyId = options.storyId ?? options.id;
  if (!storyId) throw new Error('UI/UX intake requires --id <story-id>.');
  return storyId;
}
