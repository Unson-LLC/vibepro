import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveGateArtifactFile, resolvePrArtifactFile } from './artifact-routing.js';

const execFileAsync = promisify(execFile);
const READINESS_SCHEMA_VERSION = '0.1.0';
const ALLOWED_STATUSES = new Set([
  'ready',
  'needs_evidence',
  'needs_intake',
  'needs_journey',
  'needs_design_system',
  'blocked'
]);

export async function prepareUiuxCockpit(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options);
  const designSystemId = sanitizeId(options.designSystemId ?? options.designSystem ?? storyId);
  const outDir = path.join(root, '.vibepro', 'uiux', storyId);
  const context = await collectReadinessContext(root, { storyId, designSystemId });
  const git = await collectGitContext(root);
  const readiness = buildReadiness({
    storyId,
    designSystemId,
    baseRef: options.baseRef ?? options.base ?? null,
    context,
    git
  });
  const readinessPath = path.join(outDir, 'uiux-readiness.json');
  const cockpitPath = path.join(outDir, 'uiux-cockpit.html');

  await mkdir(outDir, { recursive: true });
  await writeFile(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`);
  await writeFile(cockpitPath, renderUiuxCockpitHtml(readiness));

  return {
    outDir,
    readiness,
    artifacts: {
      readiness: toRepoPath(root, readinessPath),
      cockpit: toRepoPath(root, cockpitPath)
    }
  };
}

export function renderUiuxPrepareSummary({ outDir, readiness, artifacts }) {
  return `# UI/UX Readiness Cockpit

| Item | Value |
|------|-------|
| Story | ${readiness.story_id} |
| Status | ${readiness.status} |
| Reasons | ${readiness.reasons.length} |
| Blocking gates | ${readiness.blocking_gates.count} |
| Readiness | ${artifacts.readiness} |
| Cockpit | ${artifacts.cockpit} |
| Output | ${outDir} |

## Reasons

${readiness.reasons.length === 0 ? '- ready' : readiness.reasons.map((reason) => `- ${reason}`).join('\n')}

## Next Commands

${readiness.next_commands.length === 0 ? '- none' : readiness.next_commands.map((command) => `- \`${command}\``).join('\n')}
`;
}

async function collectReadinessContext(root, { storyId, designSystemId }) {
  const story = await readTextArtifact(root, [
    path.join('docs', 'management', 'stories', 'active', `${storyId}.md`),
    path.join('docs', 'stories', `${storyId}.md`)
  ], 'story');
  const intakeCoverage = await readJsonArtifact(root, [
    path.join('.vibepro', 'uiux', storyId, 'uiux-intake-coverage.json'),
    path.join('.vibepro', 'design-modernize', storyId, 'uiux-intake-coverage.json')
  ], 'intake_coverage');
  const intake = await readJsonArtifact(root, [
    path.join('.vibepro', 'uiux', storyId, 'uiux-intake.json')
  ], 'intake');
  const iaFlowMap = await readJsonArtifact(root, [
    path.join('.vibepro', 'uiux', storyId, 'ia-flow-map.json'),
    path.join('.vibepro', 'design-modernize', storyId, 'ia-flow-map.json')
  ], 'ia_flow_map');
  const journey = await readJsonArtifact(root, [
    path.join('.vibepro', 'design-modernize', storyId, 'journey-context.json'),
    path.join('.vibepro', 'journey', 'latest-journey.json')
  ], 'journey_context');
  const designSystem = await readJsonArtifact(root, [
    path.join('.vibepro', 'design-system', designSystemId, 'design-system.json'),
    path.join('.vibepro', 'design-modernize', storyId, 'derived-design-system.json')
  ], 'design_system');
  const designSystemCoverage = await readJsonArtifact(root, [
    path.join('.vibepro', 'design-system', designSystemId, 'evidence-coverage.json')
  ], 'design_system_coverage');
  const designSystemValidation = await readJsonArtifact(root, [
    path.join('.vibepro', 'design-system', designSystemId, 'validation', `${storyId}.json`)
  ], 'design_system_validation');
  const stylePreset = await readJsonArtifact(root, [
    path.join('.vibepro', 'design-system', designSystemId, 'style-preset.json'),
    path.join('.vibepro', 'design-modernize', storyId, 'style-preset.json')
  ], 'style_preset');
  const responsiveA11y = await readJsonArtifact(root, [
    path.join('.vibepro', 'uiux', storyId, 'responsive-a11y-matrix.json')
  ], 'responsive_a11y_matrix');
  const designModernizePlan = await readJsonArtifact(root, [
    path.join('.vibepro', 'design-modernize', storyId, 'design-modernize.json')
  ], 'design_modernize_plan');
  const visualHypothesis = await readTextArtifact(root, [
    path.join('.vibepro', 'design-modernize', storyId, 'visual-hypothesis-prompts.md')
  ], 'visual_hypothesis_prompts');
  const prPreparePath = await resolvePrArtifactFile(root, storyId, 'pr-prepare.json');
  const prPrepare = await readJsonArtifact(root, [
    path.relative(root, prPreparePath)
  ], 'pr_prepare');
  const gateDag = await resolveGateDagArtifact(root, storyId, prPrepare);
  const verificationEvidence = await readJsonArtifact(root, [
    path.relative(root, await resolvePrArtifactFile(root, storyId, 'verification-evidence.json'))
  ], 'verification_evidence');
  const flowVerification = await resolveFlowVerificationArtifact(root, storyId, verificationEvidence);
  const visualQa = await findLatestManifestRun(root, 'visual_qa_runs', 'visual_residual_json');

  return {
    story,
    intakeCoverage,
    intake,
    iaFlowMap,
    journey,
    designSystem,
    designSystemCoverage,
    designSystemValidation,
    stylePreset,
    responsiveA11y,
    designModernizePlan,
    visualHypothesis,
    flowVerification,
    verificationEvidence,
    visualQa,
    gateDag,
    prPrepare
  };
}

function buildReadiness({ storyId, designSystemId, baseRef, context, git }) {
  const sections = {
    intake_coverage: summarizeIntake(context.intakeCoverage, context.intake),
    ia_flow_map: summarizeIaFlowMap(context.iaFlowMap),
    design_system: summarizeDesignSystem(context.designSystem, context.designSystemCoverage, context.designSystemValidation),
    style_preset: summarizeStylePreset(context.stylePreset, context.intakeCoverage, context.designModernizePlan),
    journey: summarizeJourney(context.journey),
    responsive_a11y_matrix: summarizeResponsiveA11y(context.responsiveA11y),
    visual_hypotheses: summarizeVisualHypotheses(context.designModernizePlan, context.visualHypothesis, context.visualQa),
    verification_evidence: summarizeVerification(context.flowVerification, context.visualQa),
    source_story: summarizeStory(context.story)
  };
  const invalidArtifacts = Object.values(context).filter((item) => item?.status === 'invalid');
  const blockingGates = summarizeBlockingGates(context.gateDag);
  const reasons = [];
  if (invalidArtifacts.length > 0) {
    reasons.push(...invalidArtifacts.map((artifact) => `Invalid ${artifact.kind}: ${artifact.error}`));
  }
  if (sections.source_story.status === 'missing') reasons.push('Story document is missing.');
  if (sections.intake_coverage.status !== 'ready') reasons.push('Structured UI/UX intake coverage is not ready.');
  if (sections.journey.status !== 'ready') reasons.push('Journey context is missing or still needs curation.');
  if (sections.design_system.status !== 'ready') reasons.push('Native or derived Design System evidence is missing or not validated.');
  if (sections.responsive_a11y_matrix.status !== 'ready') reasons.push('Responsive/accessibility matrix evidence is missing.');
  if (sections.visual_hypotheses.status !== 'ready') reasons.push('Visual hypothesis or visual QA evidence is missing.');
  if (sections.ia_flow_map.status !== 'ready') reasons.push('IA flow map is missing or still lacks route evidence.');
  if (blockingGates.count > 0) reasons.push(`${blockingGates.count} blocking PR gate(s) remain unresolved.`);

  const status = determineReadinessStatus({
    invalidArtifacts,
    sections,
    blockingGates
  });
  return {
    schema_version: READINESS_SCHEMA_VERSION,
    workflow: 'uiux-one-command-readiness',
    story_id: storyId,
    design_system_id: designSystemId,
    generated_at: new Date().toISOString(),
    status,
    allowed_statuses: [...ALLOWED_STATUSES],
    base_ref: baseRef,
    source_policy: {
      cockpit: 'human_navigation_surface_only',
      source_of_truth: 'Story, Spec, Architecture, current code, design-system artifacts, and VibePro gate artifacts remain authoritative'
    },
    git,
    sections,
    blocking_gates: blockingGates,
    reasons,
    artifact_links: buildArtifactLinks(context, storyId, designSystemId),
    next_commands: buildNextCommands({ storyId, designSystemId, baseRef, sections, blockingGates })
  };
}

function determineReadinessStatus({ invalidArtifacts, sections, blockingGates }) {
  if (invalidArtifacts.length > 0 || sections.source_story.status === 'missing' || blockingGates.count > 0) return 'blocked';
  if (sections.intake_coverage.status !== 'ready') return 'needs_intake';
  if (sections.journey.status !== 'ready') return 'needs_journey';
  if (sections.design_system.status !== 'ready') return 'needs_design_system';
  if (
    sections.ia_flow_map.status !== 'ready' ||
    sections.responsive_a11y_matrix.status !== 'ready' ||
    sections.visual_hypotheses.status !== 'ready' ||
    sections.verification_evidence.status !== 'ready'
  ) {
    return 'needs_evidence';
  }
  return 'ready';
}

function summarizeStory(story) {
  if (story.status !== 'available') return { status: 'missing', artifact: story.path, title: null };
  const title = (story.text.match(/^#\s+(.+)$/m)?.[1] ?? story.text.match(/^title:\s*(.+)$/m)?.[1] ?? null);
  return { status: 'ready', artifact: story.path, title };
}

function summarizeIntake(coverage, intake) {
  if (coverage.status === 'invalid') return { status: 'blocked', artifact: coverage.path, reason: coverage.error };
  if (coverage.status !== 'available') {
    return {
      status: 'missing',
      artifact: '.vibepro/uiux/<story-id>/uiux-intake-coverage.json',
      intake_artifact: intake.path,
      missing_required_fields: []
    };
  }
  const data = coverage.data;
  const missing = data.missing_required_fields ?? [];
  return {
    status: data.status === 'ready_for_design' && missing.length === 0 ? 'ready' : 'needs_intake',
    artifact: coverage.path,
    coverage_status: data.status,
    explicit: data.summary?.explicit ?? 0,
    inferred: data.summary?.inferred ?? 0,
    missing: data.summary?.missing ?? 0,
    not_applicable: data.summary?.not_applicable ?? 0,
    missing_required_fields: missing,
    style_preset: data.style_preset?.selected_preset?.id ?? data.style_preset?.selection?.status ?? null
  };
}

function summarizeIaFlowMap(map) {
  if (map.status === 'invalid') return { status: 'blocked', artifact: map.path, reason: map.error };
  if (map.status !== 'available') {
    return { status: 'missing', artifact: '.vibepro/uiux/<story-id>/ia-flow-map.json', route_evidence: 'missing' };
  }
  const data = map.data;
  return {
    status: data.status === 'ready_for_design_flow' ? 'ready' : 'needs_evidence',
    artifact: map.path,
    map_status: data.status,
    flow_archetype: data.flow_archetype ?? null,
    flow_structure: data.flow_structure ?? null,
    route_evidence: data.route_evidence?.status ?? 'unknown',
    screen_count: Array.isArray(data.screens) ? data.screens.length : 0
  };
}

function summarizeDesignSystem(designSystem, coverage, validation) {
  if ([designSystem, coverage, validation].some((item) => item.status === 'invalid')) {
    const invalid = [designSystem, coverage, validation].find((item) => item.status === 'invalid');
    return { status: 'blocked', artifact: invalid.path, reason: invalid.error };
  }
  if (designSystem.status !== 'available') {
    return {
      status: 'missing',
      artifact: '.vibepro/design-system/<design-system-id>/design-system.json',
      validation_artifact: validation.path
    };
  }
  const validationStatus = validation.data?.summary?.status ?? validation.data?.status ?? null;
  return {
    status: !validationStatus || ['pass', 'ready'].includes(String(validationStatus).toLowerCase()) ? 'ready' : 'needs_design_system',
    artifact: designSystem.path,
    coverage_artifact: coverage.status === 'available' ? coverage.path : null,
    validation_artifact: validation.status === 'available' ? validation.path : null,
    design_system_id: designSystem.data?.design_system_id ?? designSystem.data?.id ?? null,
    authority: designSystem.data?.authority ?? null,
    validation_status: validationStatus,
    token_count: countObjectKeys(designSystem.data?.semantic_tokens) + countObjectKeys(designSystem.data?.theme_tokens)
  };
}

function summarizeStylePreset(stylePreset, intakeCoverage, plan) {
  const candidates = [
    stylePreset.data,
    intakeCoverage.data?.style_preset,
    plan.data?.uiux_style_preset,
    plan.data?.derived_design_system?.style_preset
  ].filter(Boolean);
  if (stylePreset.status === 'invalid') return { status: 'blocked', artifact: stylePreset.path, reason: stylePreset.error };
  if (candidates.length === 0) return { status: 'missing', artifact: '.vibepro/design-system/<design-system-id>/style-preset.json' };
  const selected = candidates[0]?.selected_preset ?? candidates[0]?.selection?.selected_preset ?? candidates[0];
  return {
    status: 'ready',
    artifact: stylePreset.status === 'available' ? stylePreset.path : intakeCoverage.path ?? plan.path,
    selected_preset: selected?.id ?? candidates[0]?.preset_id ?? null,
    confidence: candidates[0]?.selection?.confidence ?? candidates[0]?.confidence ?? null,
    authority: candidates[0]?.authority_boundary?.preset_role ?? 'reference_guidance'
  };
}

function summarizeJourney(journey) {
  if (journey.status === 'invalid') return { status: 'blocked', artifact: journey.path, reason: journey.error };
  if (journey.status !== 'available') return { status: 'missing', artifact: '.vibepro/design-modernize/<story-id>/journey-context.json' };
  const data = journey.data;
  const curated = data.curated === true || data.authoritative === true || data.curation_status === 'curated';
  return {
    status: curated ? 'ready' : 'needs_journey',
    artifact: journey.path,
    curation_status: data.curation_status ?? (curated ? 'curated' : 'needs_curated_journey'),
    curated,
    handoff_available: Boolean(data.handoff_available ?? data.handoff)
  };
}

function summarizeResponsiveA11y(matrix) {
  if (matrix.status === 'invalid') return { status: 'blocked', artifact: matrix.path, reason: matrix.error };
  if (matrix.status !== 'available') return { status: 'missing', artifact: '.vibepro/uiux/<story-id>/responsive-a11y-matrix.json' };
  const data = matrix.data;
  const missing = Array.isArray(data.missing_evidence) ? data.missing_evidence.length : 0;
  return {
    status: missing === 0 && ['ready', 'pass'].includes(String(data.status ?? 'ready').toLowerCase()) ? 'ready' : 'needs_evidence',
    artifact: matrix.path,
    matrix_status: data.status ?? null,
    viewport_count: Array.isArray(data.viewports) ? data.viewports.length : 0,
    accessibility_check_count: Array.isArray(data.accessibility_checks) ? data.accessibility_checks.length : 0,
    missing_evidence_count: missing
  };
}

function summarizeVisualHypotheses(plan, prompts, visualQa) {
  if ([plan, prompts, visualQa].some((item) => item.status === 'invalid')) {
    const invalid = [plan, prompts, visualQa].find((item) => item.status === 'invalid');
    return { status: 'blocked', artifact: invalid.path, reason: invalid.error };
  }
  const hasHypothesis = prompts.status === 'available' || Boolean(plan.data?.visual_hypothesis);
  const visualStatus = visualQa.data?.status ?? visualQa.data?.summary?.status ?? null;
  return {
    status: hasHypothesis && ['pass', 'ready', 'ready_for_review'].includes(String(visualStatus ?? 'ready').toLowerCase()) ? 'ready' : 'needs_evidence',
    hypothesis_artifact: prompts.status === 'available' ? prompts.path : plan.path,
    visual_qa_artifact: visualQa.path,
    visual_qa_status: visualStatus,
    prompt_available: hasHypothesis
  };
}

function summarizeVerification(flowVerification, visualQa) {
  if ([flowVerification, visualQa].some((item) => item.status === 'invalid')) {
    const invalid = [flowVerification, visualQa].find((item) => item.status === 'invalid');
    return { status: 'blocked', artifact: invalid.path, reason: invalid.error };
  }
  const flowReady = ['pass', 'ready', 'ready_for_review'].includes(String(flowVerification.data?.status ?? '').toLowerCase());
  const visualReady = ['pass', 'ready', 'ready_for_review'].includes(String(visualQa.data?.status ?? '').toLowerCase());
  return {
    status: flowReady || visualReady ? 'ready' : 'needs_evidence',
    flow_artifact: flowVerification.path,
    flow_status: flowVerification.data?.status ?? null,
    flow_source: flowVerification.data?.source ?? flowVerification.kind ?? null,
    visual_artifact: visualQa.path,
    visual_status: visualQa.data?.status ?? null
  };
}

function summarizeBlockingGates(gateDag) {
  if (gateDag.status === 'invalid') {
    return {
      status: 'blocked',
      count: 1,
      artifact: gateDag.path,
      gates: [{ id: 'gate_dag_invalid', status: 'blocked', reason: gateDag.error }]
    };
  }
  if (gateDag.status !== 'available') {
    return { status: 'not_recorded', count: 0, artifact: '.vibepro/pr/<story-id>/gate-dag.json', gates: [] };
  }
  const gates = (gateDag.data?.nodes ?? [])
    .filter((node) => ['block', 'needs_evidence', 'needs_review', 'failed'].includes(String(node?.status ?? '').toLowerCase()))
    .map((node) => ({
      id: node.id,
      label: node.label ?? node.id,
      status: node.status,
      required: node.required ?? null,
      reason: node.reason ?? null,
      command: node.command ?? null
    }));
  return {
    status: gates.length === 0 ? 'ready' : 'blocked',
    count: gates.length,
    artifact: gateDag.path,
    overall_status: gateDag.data?.overall_status ?? null,
    gates
  };
}

function buildArtifactLinks(context, storyId, designSystemId) {
  return {
    story: artifactRef(context.story, `docs/management/stories/active/${storyId}.md`),
    intake_coverage: artifactRef(context.intakeCoverage, `.vibepro/uiux/${storyId}/uiux-intake-coverage.json`),
    ia_flow_map: artifactRef(context.iaFlowMap, `.vibepro/uiux/${storyId}/ia-flow-map.json`),
    journey_context: artifactRef(context.journey, `.vibepro/design-modernize/${storyId}/journey-context.json`),
    design_system: artifactRef(context.designSystem, `.vibepro/design-system/${designSystemId}/design-system.json`),
    design_system_validation: artifactRef(context.designSystemValidation, `.vibepro/design-system/${designSystemId}/validation/${storyId}.json`),
    style_preset: artifactRef(context.stylePreset, `.vibepro/design-system/${designSystemId}/style-preset.json`),
    responsive_a11y_matrix: artifactRef(context.responsiveA11y, `.vibepro/uiux/${storyId}/responsive-a11y-matrix.json`),
    visual_hypotheses: artifactRef(context.visualHypothesis, `.vibepro/design-modernize/${storyId}/visual-hypothesis-prompts.md`),
    flow_verification: artifactRef(context.flowVerification, '.vibepro/verification/<run-id>/flow-verification.json'),
    verification_evidence: artifactRef(context.verificationEvidence, `.vibepro/pr/${storyId}/verification-evidence.json`),
    visual_qa: artifactRef(context.visualQa, '.vibepro/qa/<qa-id>/visual-residual.json'),
    gate_dag: artifactRef(context.gateDag, `.vibepro/pr/${storyId}/gate-dag.json`),
    pr_prepare: artifactRef(context.prPrepare, `.vibepro/pr/${storyId}/pr-prepare.json`)
  };
}

function buildNextCommands({ storyId, designSystemId, baseRef, sections, blockingGates }) {
  const base = baseRef ?? 'origin/main';
  const commands = [];
  if (sections.intake_coverage.status !== 'ready') {
    commands.push(`vibepro uiux intake template . --id ${storyId}`);
    commands.push(`vibepro uiux intake validate . --id ${storyId} --json`);
  }
  if (sections.ia_flow_map.status !== 'ready') {
    commands.push(`vibepro uiux map . --id ${storyId} --route <path>`);
  }
  if (sections.journey.status !== 'ready') {
    commands.push(`vibepro journey handoff . --id ${storyId}`);
  }
  if (sections.design_system.status !== 'ready') {
    commands.push(`vibepro design-system derive . --id ${designSystemId} --route <path>`);
    commands.push(`vibepro design-system validate . --id ${designSystemId} --story-id ${storyId} --base ${base}`);
  }
  if (sections.responsive_a11y_matrix.status !== 'ready') {
    commands.push(`vibepro uiux evidence . --id ${storyId} --route <path>`);
  }
  if (sections.visual_hypotheses.status !== 'ready' || sections.verification_evidence.status !== 'ready') {
    commands.push(`vibepro design-modernize plan . --id ${storyId} --route <path>`);
    commands.push(`vibepro verify visual . --id ${storyId} --current-dir <dir>`);
  }
  if (blockingGates.count > 0) {
    commands.push(`vibepro pr prepare . --story-id ${storyId} --base ${base} --view blocking-gates --json`);
  } else {
    commands.push(`vibepro pr prepare . --story-id ${storyId} --base ${base} --view design-ssot --json`);
  }
  return [...new Set(commands)];
}

function renderUiuxCockpitHtml(readiness) {
  const sectionRows = Object.entries(readiness.sections)
    .map(([id, section]) => `<tr><th>${escapeHtml(id)}</th><td><span class="status ${escapeHtml(section.status)}">${escapeHtml(section.status)}</span></td><td>${renderSectionDetail(section)}</td></tr>`)
    .join('\n');
  const artifactItems = Object.entries(readiness.artifact_links)
    .map(([id, artifact]) => `<li><span>${escapeHtml(id)}</span> ${renderArtifactLink(artifact, readiness.story_id)}</li>`)
    .join('\n');
  const gateItems = readiness.blocking_gates.gates.length === 0
    ? '<li>No blocking gates recorded.</li>'
    : readiness.blocking_gates.gates.map((gate) => `<li><strong>${escapeHtml(gate.label ?? gate.id)}</strong>: ${escapeHtml(gate.status)}${gate.reason ? ` - ${escapeHtml(gate.reason)}` : ''}</li>`).join('\n');
  const commandItems = readiness.next_commands.map((command) => `<li><code>${escapeHtml(command)}</code></li>`).join('\n');
  const reasonItems = readiness.reasons.length === 0
    ? '<li>Ready.</li>'
    : readiness.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(readiness.story_id)} UI/UX Cockpit</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; color: #17202a; background: #f7f8fa; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; letter-spacing: 0; }
    h2 { margin: 28px 0 12px; font-size: 18px; line-height: 1.3; letter-spacing: 0; }
    p { margin: 0; color: #5d6673; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d9dee7; }
    th, td { padding: 12px; border-bottom: 1px solid #e5e9f0; text-align: left; vertical-align: top; }
    th { width: 220px; color: #374151; background: #fbfcfe; }
    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 13px; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 6px 0; }
    a { color: #0f6cbd; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0; }
    .metric { background: #fff; border: 1px solid #d9dee7; padding: 14px; border-radius: 8px; }
    .metric span { display: block; color: #5d6673; font-size: 12px; }
    .metric strong { display: block; margin-top: 6px; font-size: 16px; }
    .status { display: inline-block; min-width: 92px; padding: 3px 8px; border-radius: 999px; background: #eef2f7; color: #374151; font-size: 12px; text-align: center; }
    .ready, .pass { background: #e7f5ec; color: #166534; }
    .blocked, .needs_evidence, .needs_intake, .needs_journey, .needs_design_system, .missing, .needs_review { background: #fff4d6; color: #92400e; }
    .artifact-list span { display: inline-block; min-width: 210px; color: #374151; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(readiness.story_id)} UI/UX Cockpit</h1>
      <p>This cockpit links to source artifacts. It is not the source of truth.</p>
    </header>
    <section class="summary" aria-label="readiness summary">
      <div class="metric"><span>Status</span><strong>${escapeHtml(readiness.status)}</strong></div>
      <div class="metric"><span>Design system</span><strong>${escapeHtml(readiness.design_system_id)}</strong></div>
      <div class="metric"><span>Blocking gates</span><strong>${readiness.blocking_gates.count}</strong></div>
      <div class="metric"><span>Git dirty</span><strong>${readiness.git.dirty ? 'yes' : 'no'}</strong></div>
    </section>
    <h2>Reasons</h2>
    <ul>${reasonItems}</ul>
    <h2>Readiness Sections</h2>
    <table>
      <tbody>
${sectionRows}
      </tbody>
    </table>
    <h2>Artifact Links</h2>
    <ul class="artifact-list">
${artifactItems}
    </ul>
    <h2>Blocking Gates</h2>
    <ul>${gateItems}</ul>
    <h2>Next Commands</h2>
    <ul>${commandItems}</ul>
  </main>
</body>
</html>
`;
}

function renderSectionDetail(section) {
  const entries = Object.entries(section)
    .filter(([key, value]) => key !== 'status' && value !== null && value !== undefined)
    .slice(0, 5);
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${escapeHtml(key)}=${escapeHtml(formatValue(value))}`).join('<br>');
}

function renderArtifactLink(artifact, storyId) {
  const ref = artifact.ref ?? artifact;
  const status = artifact.status ?? 'expected';
  if (!ref) return '<span class="status missing">missing</span>';
  return `<a href="${escapeHtml(toHtmlHref(ref, storyId))}">${escapeHtml(ref)}</a> <span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

async function readJsonArtifact(root, candidates, kind) {
  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    try {
      return {
        kind,
        status: 'available',
        path: toRepoPath(root, absolute),
        data: JSON.parse(await readFile(absolute, 'utf8'))
      };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      return {
        kind,
        status: 'invalid',
        path: toRepoPath(root, absolute),
        error: error.message
      };
    }
  }
  return {
    kind,
    status: 'missing',
    path: candidates[0].split(path.sep).join('/'),
    data: null
  };
}

async function readTextArtifact(root, candidates, kind) {
  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    try {
      return {
        kind,
        status: 'available',
        path: toRepoPath(root, absolute),
        text: await readFile(absolute, 'utf8')
      };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      return {
        kind,
        status: 'invalid',
        path: toRepoPath(root, absolute),
        error: error.message
      };
    }
  }
  return {
    kind,
    status: 'missing',
    path: candidates[0].split(path.sep).join('/'),
    text: null
  };
}

async function findLatestManifestRun(root, runKey, artifactKey) {
  const manifest = await readJsonArtifact(root, [
    path.join('.vibepro', 'manifest.json'),
    path.join('.vibepro', 'vibepro-manifest.json')
  ], 'manifest');
  if (manifest.status !== 'available') {
    return { kind: runKey, status: 'missing', path: `.vibepro/vibepro-manifest.json:${runKey}`, data: null };
  }
  const runs = Array.isArray(manifest.data?.[runKey]) ? manifest.data[runKey] : [];
  const latestIdKey = runKey === 'flow_verification_runs' ? 'latest_flow_verification_run' : 'latest_visual_qa_run';
  const latestId = manifest.data?.[latestIdKey];
  const selected = runs.find((run) => run.run_id === latestId || run.qa_id === latestId) ?? runs[0];
  const artifactPath = selected?.artifacts?.[artifactKey] ?? selected?.[artifactKey];
  if (!artifactPath) {
    return { kind: runKey, status: 'missing', path: `${manifest.path}:${runKey}`, data: null };
  }
  return readJsonArtifact(root, [artifactPath], runKey);
}

async function resolveGateDagArtifact(root, storyId, prPrepare) {
  const gatePath = await resolveGateArtifactFile(root, storyId);
  const direct = await readJsonArtifact(root, [path.relative(root, gatePath)], 'gate_dag');
  if (direct.status !== 'missing') return direct;
  const embeddedGateDag = prPrepare.data?.pr_context?.gate_dag ?? prPrepare.data?.gate_dag ?? null;
  if (embeddedGateDag && typeof embeddedGateDag === 'object') {
    return {
      kind: 'gate_dag',
      status: 'available',
      path: prPrepare.path,
      data: {
        ...embeddedGateDag,
        source: 'pr_prepare_embedded_gate_dag'
      }
    };
  }
  return direct;
}

async function resolveFlowVerificationArtifact(root, storyId, verificationEvidence) {
  const manifestRun = await findLatestManifestRun(root, 'flow_verification_runs', 'flow_verification_json');
  if (manifestRun.status !== 'missing') return manifestRun;
  if (verificationEvidence.status !== 'available') return manifestRun;
  const commands = Array.isArray(verificationEvidence.data?.commands) ? verificationEvidence.data.commands : [];
  const passingCommands = commands.filter((command) => String(command?.status ?? '').toLowerCase() === 'pass');
  const workflowReplay = passingCommands.find((command) => {
    const observed = command?.observed ?? {};
    return command?.kind === 'e2e' ||
      observed.flow_replay === 'pass' ||
      observed.artifact_replay === 'pass' ||
      String(command?.command ?? '').includes(`uiux prepare . --id ${storyId}`);
  }) ?? passingCommands[0];
  return {
    kind: 'flow_verification_runs',
    status: 'available',
    path: verificationEvidence.path,
    data: {
      status: workflowReplay ? 'pass' : 'needs_evidence',
      source: 'verification_evidence',
      command_count: commands.length,
      passing_command_count: passingCommands.length,
      workflow_replay_artifact: workflowReplay?.artifact ?? null,
      workflow_replay_command: workflowReplay?.command ?? null
    }
  };
}

async function collectGitContext(root) {
  try {
    const [head, status] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }),
      execFileAsync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })
    ]);
    const dirtyFiles = status.stdout.split('\n').filter(Boolean);
    return {
      head_sha: head.stdout.trim(),
      dirty: dirtyFiles.length > 0,
      dirty_file_count: dirtyFiles.length,
      dirty_files_sample: dirtyFiles.slice(0, 20)
    };
  } catch {
    return {
      head_sha: null,
      dirty: null,
      dirty_file_count: null,
      dirty_files_sample: []
    };
  }
}

function artifactRef(artifact, fallback) {
  return {
    ref: artifact?.status === 'available' ? artifact.path : fallback,
    status: artifact?.status ?? 'expected'
  };
}

function countObjectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  return Object.keys(value).length;
}

function formatValue(value) {
  if (Array.isArray(value)) return value.length > 3 ? `${value.slice(0, 3).join(', ')}...` : value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function toRepoPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function toHtmlHref(ref, storyId) {
  if (!ref || ref.startsWith('http://') || ref.startsWith('https://')) return ref;
  const cleanRef = String(ref).split(':')[0];
  const cockpitDir = path.join('.vibepro', 'uiux', sanitizeId(storyId));
  return path.relative(cockpitDir, cleanRef).split(path.sep).join('/');
}

function sanitizeId(value) {
  return String(value ?? '').trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
}

function requireStoryId(options) {
  const storyId = sanitizeId(options.storyId ?? options.id);
  if (!storyId) throw new Error('uiux prepare requires --id <story-id>');
  return storyId;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
