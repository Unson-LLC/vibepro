import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { deriveJourneyMap, getJourneyStatus } from './journey-map.js';
import { resolveUiuxIntakeForPlan } from './uiux-intake.js';
import {
  renderUiuxIaFlowMapMarkdown,
  resolveUiuxIaFlowMapForPlan
} from './uiux-flow-map.js';
import { renderStylePresetMarkdown, resolveUiuxStylePreset } from './uiux-style-presets.js';

const DEFAULT_SCREEN_ROUTES = ['/'];
const UI_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORED_DIRS = new Set(['.git', '.next', '.vibepro', 'coverage', 'dist', 'node_modules']);

export async function createDesignModernizePlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId ?? 'design-modernize';
  const product = options.product ?? inferProductName(root);
  const routes = await resolveDesignRoutes(root, options.routes);
  const uiuxIntake = await resolveUiuxIntakeForPlan(root, {
    storyId,
    intakeFile: options.uiuxIntake,
    brief: options.brief,
    routes
  });
  const bundle = await readDesignSystemBundle(root, options.designSystemBundle);
  const journeyContext = await ensureJourneyContextForDesignModernize(root, {
    journeyId: options.journeyId,
    ensure: options.ensureJourneyContext !== false
  });
  const uiuxIaFlowMap = await resolveUiuxIaFlowMapForPlan(root, {
    storyId,
    uiuxIntake: options.uiuxIntake,
    routes,
    brief: options.brief,
    journeyContext
  });
  const designSystem = normalizeDesignSystemBundle(bundle, {
    designSystemId: options.designSystemId,
    title: options.designSystemTitle ?? product
  });
  const screens = await collectScreens(root, routes, { product, designSystem, baseUrl: options.baseUrl });
  const productSemanticModel = buildProductSemanticModel({
    product,
    brief: options.brief,
    routes,
    screens
  });
  const uiuxStylePreset = resolveUiuxStylePreset({
    intake: uiuxIntake.intake,
    brief: options.brief,
    routes,
    product,
    semanticModel: productSemanticModel,
    designSystem
  });
  const derivedDesignSystem = buildDerivedDesignSystem({
    product,
    semanticModel: productSemanticModel,
    screens,
    referenceDesignSystem: designSystem,
    stylePreset: uiuxStylePreset
  });
  const designConstraintGraph = buildDesignConstraintGraph(designSystem, screens, derivedDesignSystem);
  const visualHypothesis = buildVisualHypothesisPlan({ storyId, product, screens, designConstraintGraph });
  const plan = {
    schema_version: '0.1.0',
    workflow: 'design-quality-dag',
    story_id: storyId,
    product,
    generated_at: new Date().toISOString(),
    design_intelligence: {
      model: 'vibepro_internal_design_quality_dag',
      reference_sources: [
        'current_ui_code',
        'current_screen_capture',
        'product_information_architecture',
        'ia_flow_map_before_screen_briefs',
        'structured_uiux_intake_when_present',
        'product_archetype_style_preset_guidance',
        'optional_brand_or_design_system_bundle'
      ],
      external_generator_required: false,
      optional_reference: {
        source: options.designSystemId || options.sceneId ? 'external_design_reference_export' : null,
        design_system_id: options.designSystemId ?? designSystem.id ?? null,
        scene_id: options.sceneId ?? null,
        status: options.optionalReferenceStatus ?? 'not_checked',
        note: options.optionalReferenceNote ?? null
      }
    },
    journey_context: journeyContext,
    uiux_intake: {
      status: uiuxIntake.coverage.status,
      artifact: uiuxIntake.sourcePath,
      authority: uiuxIntake.coverage.source.authority,
      conflict_policy: uiuxIntake.coverage.authority_boundary.conflict_policy
    },
    uiux_intake_coverage: uiuxIntake.coverage,
    uiux_style_preset: uiuxStylePreset,
    uiux_ia_flow_map: {
      status: uiuxIaFlowMap.map.status,
      artifact: uiuxIaFlowMap.sourcePath,
      markdown_artifact: uiuxIaFlowMap.markdownPath,
      flow_archetype: uiuxIaFlowMap.map.flow_archetype,
      flow_structure: uiuxIaFlowMap.map.flow_structure,
      generated_head_sha: uiuxIaFlowMap.map.generated_head_sha,
      current_ia_status: uiuxIaFlowMap.map.current_ia.status,
      target_ia_status: uiuxIaFlowMap.map.target_ia.status,
      target_evidence_status: uiuxIaFlowMap.map.target_ia.evidence_status
    },
    uiux_ia_flow_map_evidence: uiuxIaFlowMap.map,
    reference_design_system: designSystem,
    visual_foundations_reference: designSystem.visual_foundations ? {
      source: designSystem.visual_foundations.source,
      authority: designSystem.visual_foundations.authority,
      artifact: '.vibepro/design-modernize/<story-id>/visual-foundations-reference.json'
    } : null,
    product_semantic_model: productSemanticModel,
    derived_design_system: derivedDesignSystem,
    component_role_map: derivedDesignSystem.component_role_map,
    composition_guidelines: derivedDesignSystem.composition_guidelines,
    design_constraint_graph: designConstraintGraph,
    visual_hypothesis: visualHypothesis,
    design_quality_dag: buildDesignQualityDag({ storyId, product, screens, journeyContext }),
    screens,
    implementation_plan: buildImplementationPlan(screens),
    spec_gate: buildSpecGate(screens),
    artifacts: {
      current_screen_capture: '.vibepro/design-modernize/<story-id>/screenshots/',
      design_constraint_graph: '.vibepro/design-modernize/<story-id>/design-constraint-graph.json',
      visual_hypothesis_prompts: '.vibepro/design-modernize/<story-id>/visual-hypothesis-prompts.md',
      visual_hypothesis_candidates: '.vibepro/design-modernize/<story-id>/visual-hypotheses/',
      design_system_bundle: '.vibepro/design-modernize/<story-id>/design-system-bundle.json',
      visual_foundations_reference: '.vibepro/design-modernize/<story-id>/visual-foundations-reference.json',
      uiux_intake_coverage: '.vibepro/design-modernize/<story-id>/uiux-intake-coverage.json',
      uiux_style_preset: '.vibepro/design-modernize/<story-id>/style-preset.json',
      uiux_ia_flow_map: '.vibepro/design-modernize/<story-id>/ia-flow-map.json',
      derived_design_system: '.vibepro/design-modernize/<story-id>/derived-design-system.json',
      journey_context: '.vibepro/design-modernize/<story-id>/journey-context.json',
      product_semantic_model: '.vibepro/design-modernize/<story-id>/product-semantic-model.json',
      component_role_map: '.vibepro/design-modernize/<story-id>/component-role-map.json',
      composition_guidelines: '.vibepro/design-modernize/<story-id>/composition-guidelines.md',
      ds_gate: '.vibepro/design-modernize/<story-id>/ds-gate.json',
      screen_specs: '.vibepro/design-modernize/<story-id>/design-modernize.json',
      design_briefs: '.vibepro/design-modernize/<story-id>/design-briefs.md',
      implementation_spec: '.vibepro/design-modernize/<story-id>/implementation-spec.md'
    }
  };

  const outDir = path.join(root, '.vibepro', 'design-modernize', storyId);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'design-modernize.json'), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(outDir, 'design-modernize.md'), renderDesignModernizePlan(plan));
  await writeFile(path.join(outDir, 'uiux-intake-coverage.json'), `${JSON.stringify(uiuxIntake.coverage, null, 2)}\n`);
  await writeFile(path.join(outDir, 'style-preset.json'), `${JSON.stringify(uiuxStylePreset, null, 2)}\n`);
  await writeFile(path.join(outDir, 'ia-flow-map.json'), `${JSON.stringify(uiuxIaFlowMap.map, null, 2)}\n`);
  await writeFile(path.join(outDir, 'ia-flow-map.md'), renderUiuxIaFlowMapMarkdown(uiuxIaFlowMap.map));
  await writeFile(path.join(outDir, 'design-briefs.md'), renderDesignBriefs(plan));
  await writeFile(path.join(outDir, 'implementation-spec.md'), renderImplementationSpec(plan));
  await writeFile(path.join(outDir, 'design-constraint-graph.json'), `${JSON.stringify(designConstraintGraph, null, 2)}\n`);
  await writeFile(path.join(outDir, 'journey-context.json'), `${JSON.stringify(journeyContext, null, 2)}\n`);
  await writeFile(path.join(outDir, 'visual-hypothesis-prompts.md'), renderVisualHypothesisPrompts(plan));
  await writeDerivedDesignSystemArtifacts(outDir, {
    storyId,
    productSemanticModel,
    derivedDesignSystem
  });
  if (bundle) {
    await writeFile(path.join(outDir, 'design-system-bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  }
  if (designSystem.visual_foundations) {
    await writeFile(path.join(outDir, 'visual-foundations-reference.json'), `${JSON.stringify(designSystem.visual_foundations, null, 2)}\n`);
  }

  return { outDir, plan };
}

export async function deriveProductDesignSystem(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId ?? 'design-modernize';
  const product = options.product ?? inferProductName(root);
  const routes = await resolveDesignRoutes(root, options.routes);
  const bundle = await readDesignSystemBundle(root, options.designSystemBundle);
  const referenceDesignSystem = normalizeDesignSystemBundle(bundle, {
    designSystemId: options.designSystemId,
    title: options.designSystemTitle ?? product
  });
  const screens = await collectScreens(root, routes, {
    product,
    designSystem: referenceDesignSystem,
    baseUrl: options.baseUrl
  });
  const productSemanticModel = buildProductSemanticModel({
    product,
    brief: options.brief,
    routes,
    screens
  });
  const uiuxStylePreset = resolveUiuxStylePreset({
    brief: options.brief,
    routes,
    product,
    semanticModel: productSemanticModel,
    designSystem: referenceDesignSystem
  });
  const derivedDesignSystem = buildDerivedDesignSystem({
    product,
    semanticModel: productSemanticModel,
    screens,
    referenceDesignSystem,
    stylePreset: uiuxStylePreset
  });
  const result = {
    schema_version: '0.1.0',
    workflow: 'design-system-derivation',
    story_id: storyId,
    product,
    generated_at: new Date().toISOString(),
    external_generator_required: false,
    authority: 'vibepro_internal_design_constraints',
    product_semantic_model: productSemanticModel,
    uiux_style_preset: uiuxStylePreset,
    derived_design_system: derivedDesignSystem,
    component_role_map: derivedDesignSystem.component_role_map,
    composition_guidelines: derivedDesignSystem.composition_guidelines,
    ds_gate: buildDesignSystemGate({ storyId, derivedDesignSystem })
  };
  const outDir = path.join(root, '.vibepro', 'design-modernize', storyId);
  await mkdir(outDir, { recursive: true });
  await writeDerivedDesignSystemArtifacts(outDir, {
    storyId,
    productSemanticModel,
    derivedDesignSystem
  });
  await writeFile(path.join(outDir, 'design-system-derivation.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(outDir, 'design-system-derivation.md'), renderDerivedDesignSystemSummary(result));
  return { outDir, result };
}

export async function captureDesignModernizeScreens(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId ?? 'design-modernize';
  const outDir = path.join(root, '.vibepro', 'design-modernize', storyId);
  const screenshotDir = path.join(outDir, 'screenshots');
  await mkdir(screenshotDir, { recursive: true });
  const plan = await readPlan(outDir);
  const routes = options.routes?.length > 0
    ? options.routes
    : plan?.screens?.map((screen) => screen.route) ?? await resolveDesignRoutes(root, []);
  const plannedUrl = plan?.screens?.[0]?.capture?.url;
  const baseUrl = options.baseUrl ?? (/^https?:\/\//.test(plannedUrl ?? '') ? plannedUrl : null);
  const result = {
    schema_version: '0.1.0',
    workflow: 'design-modernize-capture',
    story_id: storyId,
    generated_at: new Date().toISOString(),
    status: 'needs_setup',
    base_url: baseUrl ?? null,
    screenshots: [],
    setup: {
      next_commands: []
    }
  };

  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    result.setup.next_commands.push('Run the target app and pass --base-url http://localhost:<port>');
    await writeCaptureResult(outDir, result);
    return { outDir, result };
  }

  const playwright = await loadPlaywright(root);
  if (!playwright) {
    result.setup.next_commands.push('npm install -D @playwright/test');
    result.setup.next_commands.push('npx playwright install chromium');
    await writeCaptureResult(outDir, result);
    return { outDir, result };
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true
    });
    const page = await context.newPage();
    result.status = 'pass';
    for (const route of routes) {
      const url = new URL(route.replace(/\[hotel_id\]/g, options.sampleHotelId ?? 'sample'), baseUrl).toString();
      const fileName = `${routeToKey(route).toLowerCase()}.png`;
      const filePath = path.join(screenshotDir, fileName);
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: options.timeoutMs ?? 30000 });
        await page.screenshot({ path: filePath, fullPage: true });
        result.screenshots.push({
          route,
          url,
          status: 'pass',
          artifact: path.relative(root, filePath).split(path.sep).join('/')
        });
      } catch (error) {
        result.status = 'fail';
        result.screenshots.push({
          route,
          url,
          status: 'fail',
          error: error.message
        });
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
  await writeCaptureResult(outDir, result);
  return { outDir, result };
}

async function ensureJourneyContextForDesignModernize(root, options = {}) {
  if (!options.ensure) {
    return buildDesignModernizeJourneyContext({
      status: 'skipped',
      artifact_kind: null,
      curation_status: 'skipped',
      curated: false,
      handoff_available: false,
      reason: 'Journey context resolution was skipped by caller.',
      generatedBy: 'caller_disabled'
    });
  }

  let status = await getJourneyStatus(root, { journeyId: options.journeyId });
  let generatedBy = 'existing_journey_context';
  if (status.status === 'missing') {
    const derived = await deriveJourneyMap(root, { journeyId: options.journeyId });
    status = await getJourneyStatus(root, { journeyId: derived.journey.journey_id });
    generatedBy = 'design-modernize_plan';
  }

  return buildDesignModernizeJourneyContext({ ...status, generatedBy });
}

function buildDesignModernizeJourneyContext(status = {}) {
  const curated = status.curated === true;
  const available = curated && status.status === 'available';
  const gateStatus = available
    ? 'passed'
    : status.status === 'skipped'
      ? 'skipped'
      : status.status === 'missing'
        ? 'needs_evidence'
        : 'needs_review';
  const reason = available
    ? 'Curated Journey is available for UI modernization decisions.'
    : status.reason ?? 'Journey context needs review before UI modernization is treated as settled.';
  return {
    schema_version: '0.1.0',
    model: 'vibepro-design-modernize-journey-context-v1',
    required_for_ui_modernize: true,
    status: status.status ?? 'unknown',
    generated_by: status.generatedBy ?? 'unknown',
    journey_id: status.journey_id ?? status.journey?.journey_id ?? null,
    artifact_kind: status.artifact_kind ?? null,
    curation_status: status.curation_status ?? null,
    curated,
    curated_journey_path: status.curated_journey_path ?? null,
    handoff_available: status.handoff_available === true,
    walking_skeleton_status: status.walking_skeleton_status ?? null,
    conflict_count: status.conflict_count ?? 0,
    open_question_count: status.open_question_count ?? 0,
    authority: curated
      ? 'curated_journey'
      : status.artifact_kind === 'journey_context_pack'
        ? 'handoff_context_only'
        : 'missing',
    reason,
    artifacts: {
      context_pack: status.context_pack || status.journey ? '.vibepro/journey/latest-journey.json' : null,
      handoff: status.handoff_available ? '.vibepro/journey/latest-handoff.md' : null,
      curated_journey: status.curated_journey_path ?? null
    },
    gate: {
      id: 'DM-JOURNEY-CONTEXT',
      status: gateStatus,
      required: true,
      reason,
      checks: [
        'journey_context_pack_exists_before_screen_plan',
        'curated_journey_status_is_visible',
        'ui_modernize_plan_does_not_treat_machine_handoff_as_authoritative'
      ]
    },
    next_commands: curated
      ? []
      : [
          `vibepro journey handoff <repo>${status.journey_id ? ` --id ${status.journey_id}` : ''}`,
          `Create or attach .vibepro/journeys/${status.journey_id ?? 'default-product-journey'}.json before treating the Journey as settled`
        ]
  };
}

export function normalizeDesignSystemBundle(bundle, options = {}) {
  const source = bundle && typeof bundle === 'object' ? bundle : {};
  const payload = source.bundle && typeof source.bundle === 'object' ? source.bundle : source;
  const tokens = payload.tokens
    ?? payload.designTokens
    ?? payload.files?.tokens
    ?? source.semantic_tokens
    ?? source.theme_tokens
    ?? [payload.theme, payload.styles].filter(Boolean).join('\n')
    ?? {};
  const components = payload.components
    ?? source.files?.components
    ?? source.component_roles?.roles
    ?? source.component_roles
    ?? [payload.componentsCss, payload.componentsJs].filter(Boolean).join('\n')
    ?? [];
  const guidelines = payload.guidelines
    ?? source.files?.guidelines
    ?? source.overview
    ?? payload.documentation
    ?? [];
  return {
    id: source.id ?? source.designSystemId ?? source.designSystem?.id ?? options.designSystemId ?? null,
    title: source.title ?? source.name ?? source.designSystem?.title ?? options.title ?? null,
    version: source.version?.versionNumber ?? source.version ?? source.latestVersion ?? source.publishedVersion ?? null,
    status: bundle ? 'available' : 'missing_bundle',
    token_summary: summarizeTokens(tokens),
    component_summary: summarizeComponents(components),
    guideline_summary: summarizeGuidelines(guidelines),
    visual_foundations: source.visual_foundations ?? payload.visual_foundations ?? null,
    constraints: buildDesignConstraints({ tokens, components, guidelines })
  };
}

export function renderDesignModernizePlan(plan) {
  const journey = plan.journey_context ?? {};
  return `# Design Modernize Plan

| Item | Value |
|------|-------|
| Story | ${plan.story_id} |
| Product | ${plan.product} |
| Design Intelligence | ${plan.design_intelligence.model} |
| Journey Context | ${journey.status ?? 'unknown'} (${journey.artifact_kind ?? '-'}) |
| UI/UX Intake | ${plan.uiux_intake_coverage?.status ?? 'unknown'} |
| Style Preset | ${plan.uiux_style_preset?.selected_preset?.id ?? plan.uiux_style_preset?.selection?.status ?? 'missing'} (${plan.uiux_style_preset?.selection?.status ?? '-'}) |
| IA Flow Map | ${plan.uiux_ia_flow_map?.status ?? 'unknown'} (${plan.uiux_ia_flow_map?.flow_archetype ?? '-'}) |
| Curated Journey | ${journey.curated ? 'yes' : 'no'} |
| External generator required | ${plan.design_intelligence.external_generator_required} |
| Reference Design System | ${plan.reference_design_system.title ?? '-'} (${plan.reference_design_system.id ?? '-'}) |
| Visual Foundations | ${plan.visual_foundations_reference?.source ?? '-'} |

## Journey Context

- Required for UI modernization: ${journey.required_for_ui_modernize ? 'yes' : 'no'}
- Authority: ${journey.authority ?? '-'}
- Curation status: ${journey.curation_status ?? '-'}
- Context pack: ${journey.artifacts?.context_pack ?? '-'}
- Handoff: ${journey.artifacts?.handoff ?? '-'}
- Curated Journey: ${journey.curated_journey_path ?? '-'}
- Gate: ${journey.gate?.status ?? '-'} - ${journey.gate?.reason ?? journey.reason ?? '-'}

${(journey.next_commands ?? []).map((command) => `- Next: \`${command}\``).join('\n') || '- Next: -'}

## UI/UX Intake

- Status: ${plan.uiux_intake_coverage?.status ?? 'unknown'}
- Artifact: ${plan.uiux_intake?.artifact ?? '-'}
- Explicit: ${plan.uiux_intake_coverage?.summary?.explicit ?? 0}
- Inferred: ${plan.uiux_intake_coverage?.summary?.inferred ?? 0}
- Missing: ${plan.uiux_intake_coverage?.summary?.missing ?? 0}
- Not applicable: ${plan.uiux_intake_coverage?.summary?.not_applicable ?? 0}
- Conflict policy: ${plan.uiux_intake?.conflict_policy ?? '-'}

${(plan.uiux_intake_coverage?.guidance ?? []).map((item) => `- Guidance: ${item}`).join('\n') || '- Guidance: ready'}

## Style Preset

${renderStylePresetMarkdown(plan.uiux_style_preset)}

## IA Flow Map

- Status: ${plan.uiux_ia_flow_map?.status ?? 'unknown'}
- Artifact: ${plan.uiux_ia_flow_map?.artifact ?? '-'}
- Flow archetype: ${plan.uiux_ia_flow_map?.flow_archetype ?? '-'}
- Flow structure: ${plan.uiux_ia_flow_map?.flow_structure ?? '-'}
- Generated HEAD: ${plan.uiux_ia_flow_map?.generated_head_sha ?? 'unavailable'}
- Current IA: ${plan.uiux_ia_flow_map?.current_ia_status ?? '-'}
- Target IA: ${plan.uiux_ia_flow_map?.target_ia_status ?? '-'}
- Target evidence status: ${plan.uiux_ia_flow_map?.target_evidence_status ?? '-'}

## Workflow

1. Graphify/Codex extract routes, components, state, CTA, data dependency, and preserved UX from current code.
2. Resolve Journey context before treating the UI route set as a safe modernization surface.
3. Read the IA flow map before creating screen-level design briefs, keeping current IA and proposed target IA separate.
4. Capture current browser screenshots for each route before asking for visual redesign.
5. Convert optional brand/design-system material into VibePro design constraints.
   - Visual foundations are reference material only; current code, graph evidence, implementation mapping, and gates remain authoritative.
6. Generate one screen-level design brief per route with invariants, allowed visual changes, anti-patterns, rubric, and Codex acceptance criteria.
7. Use VibePro's Design Quality DAG to review Journey continuity, hierarchy, density, CTA priority, state clarity, accessibility, interaction continuity, and implementation fit.
8. Implement with Codex using this spec, Journey context, Graphify evidence, current screenshots, and current code as the source of truth.

## Screens

${plan.screens.map((screen) => `### ${screen.route}

- Files: ${screen.evidence.files.map((file) => file.path).join(', ') || '-'}
- Preserve: ${screen.invariants.map((item) => item.id).join(', ')}
- Design brief: ${screen.design_brief.title}
`).join('\n')}

## Spec Gate

${plan.spec_gate.checks.map((check) => `- ${check.id}: ${check.statement}`).join('\n')}
`;
}

export function renderDesignBriefs(plan) {
  return plan.screens.map((screen) => `## ${screen.route}

${screen.design_brief.body}
`).join('\n');
}

export function renderImplementationSpec(plan) {
  const clauses = plan.spec_gate.checks.map((check) => `- ${check.id}: ${check.statement}`).join('\n');
  const journey = plan.journey_context ?? {};
  return `# ${plan.story_id} Implementation Spec

## Journey Context

- Status: ${journey.status ?? 'unknown'}
- Artifact kind: ${journey.artifact_kind ?? '-'}
- Curated: ${journey.curated ? 'yes' : 'no'}
- Curation status: ${journey.curation_status ?? '-'}
- Authority: ${journey.authority ?? '-'}
- Gate: ${journey.gate?.status ?? '-'} - ${journey.gate?.reason ?? journey.reason ?? '-'}
- Next commands: ${(journey.next_commands ?? []).length === 0 ? '-' : journey.next_commands.map((command) => `\`${command}\``).join(', ')}

## UI/UX Intake

- Status: ${plan.uiux_intake_coverage?.status ?? 'unknown'}
- Artifact: ${plan.uiux_intake?.artifact ?? '-'}
- Missing required fields: ${(plan.uiux_intake_coverage?.missing_required_fields ?? []).join(', ') || '-'}
- Conflict policy: ${plan.uiux_intake?.conflict_policy ?? '-'}

## Invariants

${plan.screens.flatMap((screen) => screen.invariants.map((item) => `- ${item.id}: ${item.statement}`)).join('\n')}

## Contracts

${plan.screens.flatMap((screen) => screen.contracts.map((item) => `- ${item.id}: ${item.statement}`)).join('\n')}

## Scenarios

${plan.screens.flatMap((screen) => screen.scenarios.map((item) => `- ${item.id}: ${item.statement}`)).join('\n')}

## Anti-patterns

${plan.screens.flatMap((screen) => screen.anti_patterns.map((item) => `- ${item.id}: ${item.statement}`)).join('\n')}

## Verification

${clauses}
`;
}

export function renderVisualHypothesisPrompts(plan) {
  return `# ${plan.story_id} Visual Hypothesis Prompts

Image generation is optional evidence for visual exploration. Generated images are not implementation authority.

${plan.visual_hypothesis.screens.map((screen) => `## ${screen.route}

${screen.prompt}

### Gate

${screen.gate_checks.map((check) => `- ${check}`).join('\n')}
`).join('\n')}`;
}

export function renderDerivedDesignSystemSummary(result) {
  const ds = result.derived_design_system;
  return `# ${result.story_id} Derived Design System

VibePro derived this design system from product brief, current UI evidence, and route-level invariants. It is an internal constraint model, not an external generator output.

## Identity

- Product: ${result.product}
- Design language: ${ds.identity.design_language}
- Interaction model: ${ds.identity.interaction_model}
- Authority: ${result.authority}

## Semantic Color Roles

${ds.semantic_tokens.color_roles.map((role) => `- ${role.name}: ${role.purpose}`).join('\n')}

## Component Roles

${ds.component_role_map.roles.map((role) => `- ${role.name}: ${role.responsibility}`).join('\n')}

## Composition Rules

${ds.composition_guidelines.rules.map((rule) => `- ${rule.id}: ${rule.statement}`).join('\n')}

## Anti-patterns

${ds.anti_patterns.map((item) => `- ${item.id}: ${item.statement}`).join('\n')}

## Gate

${buildDesignSystemGate({ storyId: result.story_id, derivedDesignSystem: ds }).checks.map((check) => `- ${check.id}: ${check.statement}`).join('\n')}
`;
}

export function renderCaptureSummary({ outDir, result }) {
  return `# Design Modernize Capture

| Item | Value |
|------|-------|
| Story | ${result.story_id} |
| Status | ${result.status} |
| Base URL | ${result.base_url ?? '-'} |
| Output | ${outDir} |

## Screenshots

${result.screenshots.length === 0 ? '- なし' : result.screenshots.map((item) => `- ${item.route}: ${item.status} ${item.artifact ?? item.error ?? ''}`.trim()).join('\n')}

## Setup

${result.setup.next_commands.length === 0 ? '- なし' : result.setup.next_commands.map((command) => `- ${command}`).join('\n')}
`;
}

async function readDesignSystemBundle(repoRoot, bundlePath) {
  if (!bundlePath) return null;
  const absolutePath = path.isAbsolute(bundlePath) ? bundlePath : path.join(repoRoot, bundlePath);
  return JSON.parse(await readFile(absolutePath, 'utf8'));
}

async function writeDerivedDesignSystemArtifacts(outDir, { storyId, productSemanticModel, derivedDesignSystem }) {
  await writeFile(path.join(outDir, 'product-semantic-model.json'), `${JSON.stringify(productSemanticModel, null, 2)}\n`);
  await writeFile(path.join(outDir, 'derived-design-system.json'), `${JSON.stringify(derivedDesignSystem, null, 2)}\n`);
  if (derivedDesignSystem.style_preset) {
    await writeFile(path.join(outDir, 'style-preset.json'), `${JSON.stringify(derivedDesignSystem.style_preset, null, 2)}\n`);
  }
  await writeFile(path.join(outDir, 'component-role-map.json'), `${JSON.stringify(derivedDesignSystem.component_role_map, null, 2)}\n`);
  await writeFile(path.join(outDir, 'ds-gate.json'), `${JSON.stringify(buildDesignSystemGate({ storyId, derivedDesignSystem }), null, 2)}\n`);
  await writeFile(path.join(outDir, 'composition-guidelines.md'), renderCompositionGuidelines(derivedDesignSystem));
}

function renderCompositionGuidelines(derivedDesignSystem) {
  return `# Composition Guidelines

${derivedDesignSystem.composition_guidelines.rules.map((rule) => `## ${rule.id}

${rule.statement}
`).join('\n')}
## Color Discipline

${derivedDesignSystem.semantic_tokens.color_roles.map((role) => `- ${role.name}: ${role.purpose}`).join('\n')}

## CTA Hierarchy

${derivedDesignSystem.cta_hierarchy.map((item, index) => `${index + 1}. ${item}`).join('\n')}
`;
}

async function readPlan(outDir) {
  try {
    return JSON.parse(await readFile(path.join(outDir, 'design-modernize.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function writeCaptureResult(outDir, result) {
  await writeFile(path.join(outDir, 'screen-capture.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(outDir, 'screen-capture.md'), renderCaptureSummary({ outDir, result }));
}

async function loadPlaywright(repoRoot) {
  try {
    const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'));
    return requireFromRepo('playwright');
  } catch {
    try {
      const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'));
      return requireFromRepo('@playwright/test');
    } catch {
      return null;
    }
  }
}

export async function collectScreens(repoRoot, routes, { product, designSystem, baseUrl }) {
  const screens = [];
  for (const route of routes) {
    const evidence = await collectScreenEvidence(repoRoot, route);
    screens.push(buildScreenSpec({
      product,
      route,
      evidence,
      designSystem,
      baseUrl
    }));
  }
  return screens;
}

export async function resolveDesignRoutes(repoRoot, routes = []) {
  if (Array.isArray(routes) && routes.length > 0) return routes;
  return discoverDesignRoutes(repoRoot);
}

export async function discoverDesignRoutes(repoRoot) {
  const roots = [
    { dir: path.join(repoRoot, 'src', 'app'), kind: 'app' },
    { dir: path.join(repoRoot, 'app'), kind: 'app' },
    { dir: path.join(repoRoot, 'src', 'pages'), kind: 'pages' },
    { dir: path.join(repoRoot, 'pages'), kind: 'pages' }
  ];
  const routes = [];
  for (const root of roots) {
    if (!await exists(root.dir)) continue;
    const files = await listUiFiles(repoRoot, root.dir);
    for (const file of files) {
      const route = root.kind === 'app'
        ? routeFromAppFile(file, root.dir, repoRoot)
        : routeFromPagesFile(file, root.dir, repoRoot);
      if (route) routes.push(route);
    }
  }
  const discovered = unique(routes).sort((a, b) => a.localeCompare(b));
  return discovered.length > 0 ? discovered.slice(0, 20) : DEFAULT_SCREEN_ROUTES;
}

export function buildProductSemanticModel({ product, brief, routes, screens }) {
  const rawText = [
    product,
    brief,
    routes.join(' '),
    ...screens.flatMap((screen) => [
      screen.route,
      ...screen.evidence.files.flatMap((file) => [
        ...file.components,
        ...file.ctas,
        ...file.states,
        ...file.navigation,
        ...file.data_dependencies
      ])
    ])
  ].join('\n');
  const text = rawText.toLowerCase();
  const positiveText = stripNegatedDomainEvidence(rawText).toLowerCase();
  const currentCtas = unique(screens.flatMap((screen) => screen.evidence.files.flatMap((file) => file.ctas))).slice(0, 20);
  const routeIntents = screens.map((screen) => ({
    route: screen.route,
    intent: inferScreenIntent(screen.route),
    current_ctas: unique(screen.evidence.files.flatMap((file) => file.ctas)).slice(0, 12),
    current_navigation: unique(screen.evidence.files.flatMap((file) => file.navigation)).slice(0, 12)
  }));
  const isJapanese = /日本|japanese|渋谷|新宿|休憩|宿泊|地図|検索|電話/.test(text);
  const hotelDiscovery = hasHotelDiscoveryEvidence(positiveText);
  const aiPhone = /ai電話|ai phone|phone confirmation|空室確認|電話/.test(positiveText);
  return {
    schema_version: '0.1.0',
    product,
    brief: brief ?? null,
    primary_domain: hotelDiscovery ? 'hotel_discovery' : 'product_workflow',
    language_policy: isJapanese ? 'japanese_ui_first' : 'preserve_current_product_language',
    interaction_model: aiPhone ? 'discovery_to_ai_phone_confirmation' : 'preserve_current_primary_action_model',
    domain_concepts: unique([
      ...(/current|現在地|location|map|地図/.test(positiveText) && hotelDiscovery ? ['location_search', 'map_exploration'] : []),
      ...(/condition|filter|条件|絞り/.test(text) ? ['condition_search', 'filter_refinement'] : []),
      ...(/休憩/.test(positiveText) ? ['plan_rest'] : []),
      ...(/宿泊|stay/.test(positiveText) && hotelDiscovery ? ['plan_stay'] : []),
      ...(/サービスタイム|service/.test(positiveText) && hotelDiscovery ? ['plan_service_time'] : []),
      ...(/今すぐ|now|空室/.test(positiveText) && hotelDiscovery ? ['plan_now', 'availability'] : []),
      ...(/price|価格|¥|円/.test(text) ? ['price'] : []),
      ...(/distance|距離|徒歩|km|m/.test(text) && hotelDiscovery ? ['distance'] : []),
      ...(/facility|設備|wi-fi|駐車場/.test(text) ? ['facility'] : []),
      ...(/user posts|投稿|口コミ/.test(text) ? ['user_posts'] : [])
    ]),
    route_intents: routeIntents,
    native_ctas: currentCtas,
    forbidden_patterns: unique([
      'net_new_app_concept',
      'navigation_rewrite_without_evidence',
      'invented_backend_data',
      'marketing_landing_page',
      ...(/book now|booking|予約/.test(text) || aiPhone ? ['generic_book_now_cta'] : [])
    ])
  };
}

export function buildDerivedDesignSystem({ product, semanticModel, screens, referenceDesignSystem, stylePreset = null }) {
  const routeIntents = semanticModel.route_intents.map((item) => item.intent);
  const componentSamples = unique([
    ...screens.flatMap((screen) => screen.evidence.files.flatMap((file) => file.components)),
    ...(referenceDesignSystem.component_summary?.names ?? [])
  ]);
  const colorRoles = buildSemanticColorRoles(semanticModel);
  const componentRoleMap = buildComponentRoleMap({ semanticModel, componentSamples, routeIntents });
  return {
    schema_version: '0.1.0',
    source: 'vibepro_derived_from_product_evidence',
    authority: 'internal_design_constraints',
    identity: {
      product,
      design_language: inferDesignLanguage(semanticModel),
      interaction_model: semanticModel.interaction_model,
      language_policy: semanticModel.language_policy
    },
    foundations: {
      theme_order: ['color_ramps', 'typography', 'spacing', 'radii', 'motion', 'shadows'],
      token_dependency_order: ['raw_theme', 'semantic_tokens', 'recipes', 'component_roles', 'composition_rules'],
      style_preset_id: stylePreset?.selected_preset?.id ?? null,
      density_policy: stylePreset?.selected_preset?.density
        ?? (semanticModel.primary_domain === 'hotel_discovery' ? 'mobile_dense_scannable' : 'preserve_current_density'),
      layout_posture: stylePreset?.selected_preset?.layout_posture ?? 'preserve_current_product_layout',
      color_posture: stylePreset?.selected_preset?.color_posture ?? 'semantic_tokens_first',
      typography_policy: semanticModel.language_policy === 'japanese_ui_first'
        ? 'compact_japanese_mobile_scale_with_tabular_numerals'
        : 'preserve_current_readability_scale',
      typography_posture: stylePreset?.selected_preset?.typography_posture ?? 'preserve_current_readability_scale',
      motion_policy: stylePreset?.selected_preset?.motion_posture
        ? [stylePreset.selected_preset.motion_posture, 'respect_reduced_motion']
        : ['snappy_utility_feedback', 'spatial_context_for_sheets_and_overlays', 'respect_reduced_motion']
    },
    style_preset: stylePreset,
    semantic_tokens: {
      color_roles: colorRoles,
      state_semantics: ['loading', 'empty', 'error', 'selected', 'disabled', 'success', 'available', 'limited', 'unavailable'],
      cta_priority: ['primary_domain_action', 'route_navigation', 'filter_refinement', 'secondary_reference'],
      domain_semantics: semanticModel.domain_concepts
    },
    component_role_map: componentRoleMap,
    composition_guidelines: buildCompositionGuidelines(semanticModel),
    cta_hierarchy: buildCtaHierarchy(semanticModel),
    anti_patterns: semanticModel.forbidden_patterns.map((pattern, index) => ({
      id: `DS-AP-${index + 1}`,
      statement: antiPatternStatement(pattern)
    })),
    visual_hypothesis_policy: {
      image_generation_role: 'explore_candidate_visual_directions_only',
      candidates_per_screen: { min: 2, max: 4 },
      required_candidate_notes: [
        'preserved UX',
        'design moves',
        'risky or rejected moves',
        'implementation notes',
        'DS drift risks'
      ],
      implementation_authority: 'VibePro spec, current code, screenshots, and gate evidence'
    }
  };
}

function buildSemanticColorRoles(semanticModel) {
  const roles = [
    { name: 'surface_base', purpose: 'primary app background and depth foundation' },
    { name: 'surface_raised', purpose: 'cards, sheets, and grouped controls' },
    { name: 'text_primary', purpose: 'primary readable content' },
    { name: 'text_muted', purpose: 'secondary metadata and disabled context' },
    { name: 'brand_interactive', purpose: 'primary interaction and selected state, not decoration' }
  ];
  if (semanticModel.primary_domain === 'hotel_discovery') {
    roles.push(
      { name: 'availability_positive', purpose: 'available or confirmed state' },
      { name: 'geo_distance', purpose: 'location, distance, and map exploration cues' },
      { name: 'urgency_caution', purpose: 'limited availability, now intent, price attention, and caution' },
      { name: 'plan_rest', purpose: '休憩 plan identity, consistent across selector badge card and pin' },
      { name: 'plan_stay', purpose: '宿泊 plan identity, consistent across selector badge card and pin' },
      { name: 'plan_service_time', purpose: 'サービスタイム plan identity, consistent across selector badge card and pin' },
      { name: 'plan_now', purpose: '今すぐ plan identity, consistent across selector badge card and pin' }
    );
  }
  return roles;
}

function buildComponentRoleMap({ semanticModel, componentSamples, routeIntents }) {
  const names = componentSamples.map(String);
  const defaults = semanticModel.primary_domain === 'hotel_discovery'
    ? [
        ['SearchBar', 'top-level discovery entry point; never buried inside cards'],
        ['SegmentedSearchMode', 'switches search approach without changing plan semantics'],
        ['PlanTypeSelector', 'selects domain plan views; not a generic filter substitute'],
        ['FilterChip', 'fast condition refinement in horizontal rows'],
        ['HotelCard', 'full result card for browsing feeds'],
        ['CompactHotelCard', 'dense result card for bottom sheets and long lists'],
        ['MapPricePin', 'only result marker on map surfaces'],
        ['BottomSheet', 'map result container and contextual mobile overlay'],
        ['BottomNavigation', 'primary mobile navigation anchor'],
        ['PageHeader', 'route title, back action, and scoped actions'],
        ['AIPhoneCTA', 'primary domain action after the user focuses on a hotel'],
        ['FacilityBadge', 'quiet amenity metadata'],
        ['AvailabilityBadge', 'semantic availability status'],
        ['PlanBadge', 'domain plan identity marker']
      ]
    : [
        ...inferGenericComponentRoleDefaults(names),
        ['PrimaryAction', 'highest-priority domain action'],
        ['FilterControl', 'condition refinement without route rewrite'],
        ['ResultCard', 'repeatable entity summary'],
        ['StatusBadge', 'state or status indicator'],
        ['NavigationShell', 'stable route navigation']
      ];
  const roles = uniqueRoleDefaults(defaults).map(([name, responsibility]) => ({
    name,
    responsibility,
    evidence: names.filter((sample) => sample.toLowerCase().includes(name.toLowerCase())).slice(0, 8),
    required_for_intents: routeIntents.filter(Boolean).slice(0, 8)
  }));
  return {
    schema_version: '0.1.0',
    roles,
    consistency_rules: [
      'same component role must carry the same semantic color meaning across screens',
      'dense and full-size variants must not be mixed in one homogeneous list',
      'primary domain action must not be replaced by generic conversion language',
      'component role changes require matching route-level regression evidence'
    ]
  };
}

function routeFromAppFile(file, appRoot, repoRoot) {
  if (!/(^|\/)page\.[cm]?[jt]sx?$/.test(file)) return null;
  const relativeRoot = path.relative(repoRoot, appRoot).split(path.sep).join('/');
  const relative = file.slice(relativeRoot.length).replace(/^\//, '');
  const segments = relative.split('/').slice(0, -1)
    .filter((segment) => segment && !segment.startsWith('(') && !segment.startsWith('@'));
  return `/${segments.join('/')}`.replace(/\/$/, '') || '/';
}

function routeFromPagesFile(file, pagesRoot, repoRoot) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) return null;
  const relativeRoot = path.relative(repoRoot, pagesRoot).split(path.sep).join('/');
  const relative = file.slice(relativeRoot.length).replace(/^\//, '');
  if (relative.startsWith('api/') || /^_(app|document|error)\./.test(relative)) return null;
  const withoutExt = relative.replace(/\.[cm]?[jt]sx?$/, '');
  const segments = withoutExt.split('/').filter(Boolean);
  if (segments.at(-1) === 'index') segments.pop();
  return `/${segments.join('/')}`.replace(/\/$/, '') || '/';
}

function stripNegatedDomainEvidence(text) {
  return String(text ?? '')
    .split(/[\n.。!?！？;；]+/)
    .filter((segment) => {
      const value = segment.toLowerCase();
      const hasDomainTerm = /hotel|ホテル|宿泊|休憩|stay|map|地図|空室|電話|booking|予約/.test(value);
      if (!hasDomainTerm) return true;
      return !/(do\s+not|don't|avoid|without|禁止|避け|使わない|使用しない|しない|ではない|not\s+a|not\s+an|no\s+)/i.test(segment);
    })
    .join('\n');
}

function hasHotelDiscoveryEvidence(text) {
  const value = String(text ?? '').toLowerCase();
  return /hotel|ホテル|宿泊|休憩|旅館|ラブホテル|空室|空室確認|ai電話|サービスタイム/.test(value);
}

function inferGenericComponentRoleDefaults(names) {
  return unique(names)
    .filter((name) => /^[A-Z][A-Za-z0-9_]*$/.test(name))
    .map((name) => [name, inferGenericComponentResponsibility(name)])
    .slice(0, 16);
}

function inferGenericComponentResponsibility(name) {
  const text = String(name ?? '').toLowerCase();
  if (/shell|layout|nav|sidebar|menu/.test(text)) return 'application navigation and layout surface';
  if (/header|toolbar|topbar/.test(text)) return 'page-level orientation and action grouping';
  if (/project|company|product|template|customer|account|user/.test(text) && /list|table|grid|card/.test(text)) return 'repeatable business entity summary';
  if (/list|table|grid/.test(text)) return 'repeatable information management surface';
  if (/form|editor|create|settings/.test(text)) return 'structured input and configuration workflow';
  if (/dialog|modal|drawer|sheet/.test(text)) return 'focused decision or detail surface';
  if (/badge|status|pill|tag/.test(text)) return 'state or classification indicator';
  if (/filter|search|segment|tab/.test(text)) return 'finding and narrowing control';
  if (/button|cta|action|submit/.test(text)) return 'explicit command surface';
  return 'product-local component role discovered from current code';
}

function uniqueRoleDefaults(defaults) {
  const byName = new Map();
  for (const item of defaults) {
    const [name, responsibility] = item;
    if (!name || byName.has(name)) continue;
    byName.set(name, [name, responsibility]);
  }
  return [...byName.values()];
}

function buildCompositionGuidelines(semanticModel) {
  const hotelRules = [
    {
      id: 'DS-COMP-1',
      statement: 'Search flows keep a stable vertical hierarchy: search entry, search mode, plan intent, filters, then results.'
    },
    {
      id: 'DS-COMP-2',
      statement: 'Map screens show results through map pins and a bottom sheet; avoid floating result cards directly on the map.'
    },
    {
      id: 'DS-COMP-3',
      statement: 'Plan identity appears before availability, and facility metadata stays visually quieter than plan or availability signals.'
    },
    {
      id: 'DS-COMP-4',
      statement: 'AI phone confirmation appears only after a user has focused on a hotel or result, not as a generic search CTA.'
    },
    {
      id: 'DS-COMP-5',
      statement: 'Prices use yen prefix and aligned numerals; avoid crossed-out discounts or deal-app patterns.'
    }
  ];
  const genericRules = [
    {
      id: 'DS-COMP-1',
      statement: 'Preserve current route purpose, CTA order, and navigation anchors while improving visual hierarchy.'
    },
    {
      id: 'DS-COMP-2',
      statement: 'Use repeated component roles consistently instead of one-off visual treatments.'
    },
    {
      id: 'DS-COMP-3',
      statement: 'State, status, and action colors must be semantic and stable across screens.'
    }
  ];
  return {
    schema_version: '0.1.0',
    rules: semanticModel.primary_domain === 'hotel_discovery' ? hotelRules : genericRules
  };
}

function buildCtaHierarchy(semanticModel) {
  if (semanticModel.interaction_model === 'discovery_to_ai_phone_confirmation') {
    return ['AI電話で空室確認', '現在地から探す', 'このエリアで検索', '条件で絞り込む', '地図で見る', '公式サイト', '行きたい'];
  }
  return unique(['primary domain action', ...semanticModel.native_ctas]).slice(0, 10);
}

function inferDesignLanguage(semanticModel) {
  if (semanticModel.primary_domain === 'hotel_discovery') return 'premium_utility_travel';
  return 'product_local_utility';
}

function antiPatternStatement(pattern) {
  const statements = {
    net_new_app_concept: 'Do not turn modernization into a new app concept or unrelated product direction.',
    navigation_rewrite_without_evidence: 'Do not rewrite navigation structure unless Graphify/Codex evidence proves the current route contract changed.',
    invented_backend_data: 'Do not invent backend data, domain entities, or unavailable states.',
    marketing_landing_page: 'Do not collapse operational product screens into marketing or landing-page composition.',
    generic_book_now_cta: 'Do not replace product-native confirmation actions with generic Book Now or booking-funnel CTAs.'
  };
  return statements[pattern] ?? `Avoid ${pattern}.`;
}

export function buildDesignSystemGate({ storyId, derivedDesignSystem }) {
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    mode: 'explicit',
    fallback_allowed: false,
    checks: [
      {
        id: 'DS-GATE-IDENTITY',
        statement: 'Derived design system includes product identity, interaction model, language policy, and forbidden patterns.'
      },
      {
        id: 'DS-GATE-SEMANTICS',
        statement: 'Semantic tokens cover surface, text, brand/interactive, state colors, CTA priority, density, motion, and domain semantics.'
      },
      {
        id: 'DS-GATE-COMPONENT-ROLES',
        statement: 'Component roles define responsibility and usage constraints, not only visual component names.'
      },
      {
        id: 'DS-GATE-COMPOSITION',
        statement: 'Composition guidelines preserve route hierarchy, navigation, card/list usage, badge order, and primary CTA placement.'
      },
      {
        id: 'DS-GATE-VISUAL-HYPOTHESIS',
        statement: 'Image generation is treated as candidate evidence with critique notes, never as implementation authority.'
      },
      {
        id: 'DS-GATE-STYLE-PRESET-TOKEN-AUTHORITY',
        statement: 'Product archetype style preset is guidance only; native tokens, component roles, Story, Spec, Architecture, route code, and gate evidence remain authoritative.'
      },
      {
        id: 'DS-GATE-ANTI-PATTERN',
        statement: `Anti-pattern coverage is explicit (${derivedDesignSystem.anti_patterns.map((item) => item.id).join(', ')}).`
      }
    ]
  };
}

async function collectScreenEvidence(repoRoot, route) {
  const files = await resolveRouteFiles(repoRoot, route);
  const fileReports = [];
  for (const file of files.slice(0, 24)) {
    const content = await readFile(path.join(repoRoot, file), 'utf8');
    fileReports.push({
      path: file,
      routes: [route],
      components: collectComponentNames(content),
      states: collectStateNames(content),
      ctas: collectCtas(content),
      data_dependencies: collectDataDependencies(content),
      navigation: collectNavigationTargets(content)
    });
  }
  return {
    route,
    files: fileReports,
    summary: {
      file_count: fileReports.length,
      component_count: unique(fileReports.flatMap((file) => file.components)).length,
      state_count: unique(fileReports.flatMap((file) => file.states)).length,
      cta_count: unique(fileReports.flatMap((file) => file.ctas)).length,
      data_dependency_count: unique(fileReports.flatMap((file) => file.data_dependencies)).length
    }
  };
}

async function resolveRouteFiles(repoRoot, route) {
  const routeParts = route.replace(/^\//, '').split('/').filter(Boolean);
  const candidates = [
    path.join('src', 'app', '(app)', ...routeParts),
    path.join('src', 'app', '(public)', ...routeParts),
    path.join('src', 'app', ...routeParts),
    path.join('app', ...routeParts),
    path.join('pages', ...routeParts)
  ];
  const files = [];
  for (const candidate of candidates) {
    const absolute = path.join(repoRoot, candidate);
    if (await exists(absolute)) {
      files.push(...await listUiFiles(repoRoot, absolute));
    }
  }
  return unique(files);
}

async function listUiFiles(repoRoot, current) {
  let stats;
  try {
    stats = await stat(current);
  } catch {
    return [];
  }
  if (stats.isFile()) {
    return UI_EXTENSIONS.has(path.extname(current)) ? [path.relative(repoRoot, current).split(path.sep).join('/')] : [];
  }
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listUiFiles(repoRoot, absolute));
      continue;
    }
    if (entry.isFile() && UI_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.relative(repoRoot, absolute).split(path.sep).join('/'));
    }
  }
  return files;
}

function buildScreenSpec({ product, route, evidence, designSystem, baseUrl }) {
  const key = routeToKey(route);
  const files = evidence.files.map((file) => file.path);
  return {
    route,
    capture: {
      url: baseUrl ? new URL(route.replace(/\[hotel_id\]/, 'sample'), baseUrl).toString() : route,
      required: true,
      viewport: { width: 390, height: 844, device_scale_factor: 2 },
      screenshot_name: `${key}.png`
    },
    evidence,
    invariants: [
      {
        id: `INV-${key}-1`,
        statement: `Keep the current ${route} route, primary user goal, and discovered data dependencies intact.`
      },
      {
        id: `INV-${key}-2`,
        statement: `Do not remove or rename existing CTAs without an explicit matching implementation change and regression test.`
      }
    ],
    contracts: [
      {
        id: `C-${key}-1`,
        statement: `Implementation must stay within the discovered files unless Graphify evidence identifies a required shared component.`
      },
      {
        id: `C-${key}-2`,
        statement: `Visual changes must use the ingested ${designSystem.title ?? 'Design System'} constraints for color roles, component roles, CTA priority, density, and state colors.`
      }
    ],
    scenarios: [
      {
        id: `S-${key}-1`,
        statement: `A user can complete the same route-level task after modernization as before modernization.`
      }
    ],
    anti_patterns: [
      {
        id: `AP-${key}-1`,
        statement: `Do not implement a net-new app concept, new navigation model, or simplified mock flow that bypasses the current information structure.`
      },
      {
        id: `AP-${key}-2`,
        statement: `Do not treat any generated design suggestion as source of truth when it conflicts with current code or VibePro invariants.`
      }
    ],
    design_brief: buildDesignBrief({ product, route, evidence, designSystem })
  };
}

function buildDesignBrief({ product, route, evidence, designSystem }) {
  const ctas = unique(evidence.files.flatMap((file) => file.ctas)).slice(0, 12);
  const states = unique(evidence.files.flatMap((file) => file.states)).slice(0, 12);
  const data = unique(evidence.files.flatMap((file) => file.data_dependencies)).slice(0, 12);
  return {
    title: `${route} design-quality modernization brief`,
    body: `Modernize the current ${product} screen for route ${route} using VibePro's Design Quality DAG.

Preserve the current information structure and UX constraints:
- Route: ${route}
- Current implementation files: ${evidence.files.map((file) => file.path).join(', ') || '(not discovered)'}
- Current CTAs: ${ctas.join(', ') || '(none discovered)'}
- Current state names: ${states.join(', ') || '(none discovered)'}
- Current data dependencies: ${data.join(', ') || '(none discovered)'}

Design quality target:
- Clear visual hierarchy: primary task, secondary task, and metadata are visually distinguishable.
- CTA priority: primary action is obvious; secondary actions do not compete with it.
- State clarity: loading, empty, error, selected, disabled, and success states have distinct visual treatment.
- Information density: keep operational/search density while improving scanability.
- Navigation continuity: preserve route purpose and existing transition paths.
- Component responsibility: repeated UI uses consistent roles and interaction affordances.
- Accessibility: text contrast, target size, focus, and labels are not regressed.

Optional reference system:
- ${designSystem.status === 'available'
    ? `Use ${designSystem.title ?? product} tokens/components/guidelines as brand constraints.`
    : 'No external design-system bundle is required; infer a coherent product-local system from current code and evidence.'}

Allowed changes:
- Improve layout polish, spacing, hierarchy, typography, icon usage, state color consistency, and component finish.
- Apply or infer product-local tokens and component roles.

Do not:
- Create a new app idea or replace the current flow.
- Remove existing CTAs or navigation paths.
- Invent backend data, onboarding, or route structure.
- Collapse dense operational information into marketing-style cards.

Return an implementation-ready screen direction with concrete component/layout changes and verification notes.`
  };
}

function buildDesignQualityDag({ storyId, product, screens, journeyContext = null }) {
  const screenNodes = screens.map((screen) => ({
    id: `design:screen:${routeToKey(screen.route).toLowerCase()}`,
    type: 'design_screen_gate',
    label: `${screen.route} Design Brief`,
    status: screen.evidence.files.length > 0 ? 'present' : 'needs_evidence',
    required: true,
    route: screen.route,
    files: screen.evidence.files.map((file) => file.path),
    checks: [
      'preserve_information_architecture',
      'preserve_cta_and_navigation_contracts',
      'improve_visual_hierarchy',
      'maintain_information_density',
      'clarify_interaction_states',
      'keep_implementation_scope_reviewable'
    ]
  }));
  const nodes = [
    {
      id: 'design:journey_context',
      type: 'design_journey_context_gate',
      label: 'Journey Context',
      status: journeyContext?.gate?.status ?? 'needs_evidence',
      required: true,
      artifact_kind: journeyContext?.artifact_kind ?? null,
      curated: journeyContext?.curated === true,
      curation_status: journeyContext?.curation_status ?? null,
      reason: journeyContext?.gate?.reason ?? journeyContext?.reason ?? null,
      next_commands: journeyContext?.next_commands ?? []
    },
    {
      id: 'design:current_ui_evidence',
      type: 'design_evidence_gate',
      label: 'Current UI Evidence',
      status: screens.some((screen) => screen.evidence.files.length > 0) ? 'present' : 'needs_evidence',
      required: true
    },
    {
      id: 'design:invariant_lock',
      type: 'design_invariant_gate',
      label: 'UX Invariant Lock',
      status: screens.every((screen) => screen.invariants.length > 0 && screen.anti_patterns.length > 0) ? 'present' : 'needs_evidence',
      required: true
    },
    ...screenNodes,
    {
      id: 'design:implementation_acceptance',
      type: 'design_acceptance_gate',
      label: 'Implementation Acceptance',
      status: 'needs_evidence',
      required: true,
      checks: [
        'before_after_screenshot_or_needs_setup_record',
        'typecheck_or_build_record',
        'route_level_ui_review',
        'no_design_drift_from_invariants'
      ]
    }
  ];
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    product,
    model: 'vibepro-design-quality-dag-v1',
    status: nodes.some((node) => node.status === 'needs_evidence') ? 'needs_evidence' : 'ready_for_review',
    nodes,
    edges: [
      { from: 'design:journey_context', to: 'design:current_ui_evidence' },
      { from: 'design:current_ui_evidence', to: 'design:invariant_lock' },
      ...screenNodes.map((node) => ({ from: 'design:invariant_lock', to: node.id })),
      ...screenNodes.map((node) => ({ from: node.id, to: 'design:implementation_acceptance' }))
    ]
  };
}

function buildDesignConstraintGraph(designSystem, screens, derivedDesignSystem = null) {
  const tokenSample = designSystem.token_summary?.sample ?? [];
  const componentNames = designSystem.component_summary?.names ?? [];
  const guidelineTopics = designSystem.guideline_summary?.topics ?? [];
  const derivedColorRoles = derivedDesignSystem?.semantic_tokens?.color_roles?.map((role) => role.name) ?? [];
  const derivedComponentRoles = derivedDesignSystem?.component_role_map?.roles?.map((role) => role.name) ?? [];
  return {
    schema_version: '0.1.0',
    source_design_system: {
      id: designSystem.id ?? null,
      title: designSystem.title ?? null,
      version: designSystem.version ?? null,
      status: designSystem.status
    },
    color_roles: unique([...derivedColorRoles, ...inferRoles({
      samples: tokenSample,
      defaults: ['brand', 'surface', 'text', 'success', 'warning', 'location', 'urgency', 'disabled']
    })]).slice(0, 24),
    component_roles: unique([...derivedComponentRoles, ...inferRoles({
      samples: componentNames,
      defaults: ['primary_cta', 'result_card', 'status_badge', 'filter_chip', 'bottom_sheet', 'bottom_navigation']
    })]).slice(0, 24),
    cta_priority: ['primary', 'secondary', 'tertiary'],
    state_semantics: ['loading', 'empty', 'error', 'selected', 'disabled', 'success', 'available', 'limited', 'unavailable'],
    density_policy: inferDensityPolicy(guidelineTopics),
    navigation_policy: ['preserve_route_purpose', 'preserve_existing_navigation_paths', 'preserve_back_and_bottom_nav_affordances'],
    motion_policy: ['snappy_state_transition', 'no_navigation_rewrite', 'respect_reduced_motion'],
    screen_intents: screens.map((screen) => ({
      route: screen.route,
      intent: inferScreenIntent(screen.route),
      current_ctas: unique(screen.evidence.files.flatMap((file) => file.ctas)).slice(0, 12),
      current_states: unique(screen.evidence.files.flatMap((file) => file.states)).slice(0, 12),
      data_dependencies: unique(screen.evidence.files.flatMap((file) => file.data_dependencies)).slice(0, 12)
    }))
  };
}

function buildVisualHypothesisPlan({ storyId, product, screens, designConstraintGraph }) {
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    status: 'needs_image_generation',
    provider_required: false,
    candidates_per_screen: { min: 2, max: 4 },
    authority: 'evidence_only',
    artifact_root: `.vibepro/design-modernize/${storyId}/visual-hypotheses/`,
    screens: screens.map((screen) => buildVisualHypothesisScreen({ product, screen, designConstraintGraph }))
  };
}

function buildVisualHypothesisScreen({ product, screen, designConstraintGraph }) {
  const key = routeToKey(screen.route);
  const intent = designConstraintGraph.screen_intents.find((item) => item.route === screen.route)?.intent ?? 'existing product screen';
  const invariants = screen.invariants.map((item) => `${item.id}: ${item.statement}`).join('\n');
  const antiPatterns = screen.anti_patterns.map((item) => `${item.id}: ${item.statement}`).join('\n');
  const constraints = [
    `color roles: ${designConstraintGraph.color_roles.join(', ')}`,
    `component roles: ${designConstraintGraph.component_roles.join(', ')}`,
    `CTA priority: ${designConstraintGraph.cta_priority.join(' > ')}`,
    `state semantics: ${designConstraintGraph.state_semantics.join(', ')}`,
    `density policy: ${designConstraintGraph.density_policy}`,
    `navigation policy: ${designConstraintGraph.navigation_policy.join(', ')}`
  ].join('\n');
  return {
    route: screen.route,
    screen_intent: intent,
    screenshot_required: true,
    output_dir: `visual-hypotheses/${key.toLowerCase()}/`,
    prompt: `Modernize the existing ${product} screen ${screen.route} using the current screenshot.

Screen intent: ${intent}

Keep the same information structure, CTAs, route purpose, navigation, state behavior, and data dependencies:
${invariants}

Apply these design constraints:
${constraints}

Generate 2-4 visual candidates for the same screen. Explore hierarchy, spacing, CTA prominence, state clarity, brand fit, and scanability. Do not create a new app concept, remove dense operational content, invent data, or change navigation.

Forbidden changes:
${antiPatterns}

For each candidate, return design moves, preserved UX, risky or rejected moves, and implementation notes suitable for Codex.`,
    gate_checks: [
      `VH-${key}-INV preserves route purpose, information structure, CTAs, navigation, and data dependencies`,
      `VH-${key}-CTA keeps primary, secondary, and tertiary CTA hierarchy aligned with the DesignConstraintGraph`,
      `VH-${key}-DENSITY improves scanability without reducing required information density`,
      `VH-${key}-STATE keeps semantic states visually distinct`,
      `VH-${key}-BRAND uses product-local visual vocabulary`,
      `VH-${key}-IMPL is implementable within discovered files or justified shared components`,
      `VH-${key}-AP rejects new app concepts, invented data, and navigation rewrites`
    ]
  };
}

function buildImplementationPlan(screens) {
  return screens.map((screen, index) => ({
    order: index + 1,
    route: screen.route,
    files: screen.evidence.files.map((file) => file.path),
    acceptance: [
      `All ${screen.route} invariants pass`,
      'Current screenshot and after screenshot are stored for review',
      'DS drift and UX regression gate checks have explicit pass/fail evidence'
    ]
  }));
}

function buildSpecGate(screens) {
  return {
    mode: 'explicit',
    fallback_allowed: false,
    checks: [
      {
        id: 'INV-GLOBAL-1',
        statement: 'Every screen spec has at least one explicit invariant and one explicit anti-pattern.'
      },
      {
        id: 'S-GLOBAL-1',
        statement: 'Every changed screen has before/after screenshot evidence or a needs_setup verification record.'
      },
      {
        id: 'AP-GLOBAL-1',
        statement: 'Generated or inferred design output must not introduce a new route, net-new navigation model, or remove discovered CTAs.'
      },
      {
        id: 'DQ-GLOBAL-1',
        statement: 'Design Quality DAG must preserve information architecture while improving hierarchy, CTA priority, state clarity, density, accessibility, and implementation fit.'
      },
      {
        id: 'JOURNEY-GLOBAL-1',
        statement: 'Design Modernize plans must resolve top-level Journey context and must not treat machine-derived handoff evidence as a curated product Journey.'
      },
      {
        id: 'V-GLOBAL-1',
        statement: 'Verification must include typecheck/build plus route-level visual review for all screens in this plan.'
      },
      ...screens.map((screen) => ({
        id: `INV-${routeToKey(screen.route)}-GATE`,
        statement: `${screen.route} keeps route, current files, CTAs, and data dependencies aligned with Graphify/Codex evidence.`
      }))
    ]
  };
}

function summarizeTokens(tokens) {
  if (typeof tokens === 'string') {
    const cssVariables = [...tokens.matchAll(/--([A-Za-z0-9_-]+)\s*:/g)].map((match) => match[1]);
    return {
      count: cssVariables.length,
      color_count: cssVariables.filter((key) => /color|background|foreground|border|surface|text|brand|semantic|state|success|warning|error/i.test(key)).length,
      spacing_count: cssVariables.filter((key) => /space|spacing|gap|padding|margin/i.test(key)).length,
      typography_count: cssVariables.filter((key) => /font|type|text|line-height|letter/i.test(key)).length,
      sample: unique(cssVariables).slice(0, 30)
    };
  }
  const flat = flattenKeys(tokens);
  return {
    count: flat.length,
    color_count: flat.filter((key) => /color|background|foreground|border|semantic|state/i.test(key)).length,
    spacing_count: flat.filter((key) => /space|spacing|gap|padding|margin/i.test(key)).length,
    typography_count: flat.filter((key) => /font|type|text|line-height|letter/i.test(key)).length,
    sample: flat.slice(0, 30)
  };
}

function summarizeComponents(components) {
  if (typeof components === 'string') {
    const customElements = [...components.matchAll(/\b(ds-[A-Za-z0-9-]+)\b/g)].map((match) => match[1]);
    const classNames = [...components.matchAll(/\.([A-Za-z][A-Za-z0-9_-]+)\b/g)].map((match) => match[1]);
    return {
      count: unique([...customElements, ...classNames]).length,
      names: unique([...customElements, ...classNames]).slice(0, 40)
    };
  }
  const names = Array.isArray(components)
    ? components.map((item) => item?.name ?? item?.title ?? item).filter(Boolean)
    : flattenKeys(components);
  return {
    count: names.length,
    names: unique(names.map(String)).slice(0, 40)
  };
}

function summarizeGuidelines(guidelines) {
  if (typeof guidelines === 'string') {
    const topics = guidelines
      .split(/\n+/)
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .filter(Boolean);
    return {
      count: topics.length,
      topics: unique(topics).slice(0, 30)
    };
  }
  const entries = Array.isArray(guidelines)
    ? guidelines.map((item) => typeof item === 'string' ? item : item?.title ?? item?.name ?? item?.summary).filter(Boolean)
    : flattenKeys(guidelines);
  return {
    count: entries.length,
    topics: unique(entries.map(String)).slice(0, 30)
  };
}

function buildDesignConstraints({ tokens, components, guidelines }) {
  return {
    token_roles: summarizeTokens(tokens),
    component_roles: summarizeComponents(components),
    guideline_roles: summarizeGuidelines(guidelines),
    required_dimensions: [
      'semantic color roles',
      'state colors',
      'CTA priority',
      'information density',
      'navigation structure',
      'motion guidance',
      'component responsibility'
    ]
  };
}

function inferRoles({ samples, defaults }) {
  const normalized = samples.map((sample) => String(sample).toLowerCase());
  const roles = defaults.filter((role) => normalized.some((sample) => sample.includes(role.replace('_', '-')) || sample.includes(role)));
  if (normalized.some((sample) => /brand|primary|purple/.test(sample))) roles.push('brand');
  if (normalized.some((sample) => /surface|background|base/.test(sample))) roles.push('surface');
  if (normalized.some((sample) => /text|foreground/.test(sample))) roles.push('text');
  if (normalized.some((sample) => /success|available|mint/.test(sample))) roles.push('success');
  if (normalized.some((sample) => /warning|limited|amber|urgency/.test(sample))) roles.push('warning');
  if (normalized.some((sample) => /location|distance|cyan/.test(sample))) roles.push('location');
  if (normalized.some((sample) => /cta|button|phone/.test(sample))) roles.push('primary_cta');
  if (normalized.some((sample) => /card|hotel/.test(sample))) roles.push('result_card');
  if (normalized.some((sample) => /badge|status|availability/.test(sample))) roles.push('status_badge');
  if (normalized.some((sample) => /filter|chip/.test(sample))) roles.push('filter_chip');
  if (normalized.some((sample) => /sheet/.test(sample))) roles.push('bottom_sheet');
  if (normalized.some((sample) => /navigation|nav/.test(sample))) roles.push('bottom_navigation');
  return unique([...roles, ...defaults]).slice(0, 16);
}

function inferDensityPolicy(guidelineTopics) {
  const text = guidelineTopics.join(' ').toLowerCase();
  if (/dense|compact|scan|検索|比較/.test(text)) return 'dense-operational';
  return 'preserve-current-density';
}

function inferScreenIntent(route) {
  if (route.includes('map')) return 'spatial exploration';
  if (route.includes('detail')) return 'filter refinement and result review';
  if (route.includes('hotel')) return 'hotel decision detail';
  if (route.includes('home')) return 'search entry';
  return 'existing product screen';
}

function collectComponentNames(content) {
  const names = [];
  for (const match of content.matchAll(/(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/g)) names.push(match[1]);
  for (const match of content.matchAll(/<([A-Z][A-Za-z0-9_.]*)\b/g)) names.push(match[1]);
  return unique(names).slice(0, 40);
}

function collectStateNames(content) {
  const names = [];
  for (const match of content.matchAll(/useState(?:<[^>]+>)?\(([^)]*)\)/g)) names.push(clean(match[1]));
  for (const match of content.matchAll(/\b(is[A-Z][A-Za-z0-9_]+|has[A-Z][A-Za-z0-9_]+|selected[A-Z][A-Za-z0-9_]+|loading|error)\b/g)) names.push(match[1]);
  return unique(names.filter(Boolean)).slice(0, 40);
}

function collectCtas(content) {
  const labels = [];
  for (const match of content.matchAll(/<button\b[^>]*>([\s\S]{0,160}?)<\/button>/g)) labels.push(clean(match[1]));
  for (const match of content.matchAll(/<Button\b[^>]*>([\s\S]{0,160}?)<\/Button>/g)) labels.push(clean(match[1]));
  for (const match of content.matchAll(/aria-label=["']([^"']+)["']/g)) labels.push(clean(match[1]));
  return unique(labels.filter(isLikelyHumanCtaLabel)).slice(0, 40);
}

function isLikelyHumanCtaLabel(label) {
  const value = String(label ?? '').trim();
  if (value.length === 0 || value.length >= 80) return false;
  if (/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(value)) return false;
  if (/^(true|false|null|undefined|loading|error)$/i.test(value)) return false;
  if (/[{}()[\]<>;]/.test(value)) return false;
  if (/\b(className|onClick|props|children|return|const|function|=>)\b/.test(value)) return false;
  return /[\p{L}\p{N}]/u.test(value);
}

function collectDataDependencies(content) {
  const items = [];
  for (const match of content.matchAll(/\b(fetch|useSWR|prisma|supabase|serverAction|searchParams|params|cookies|headers)\b/g)) items.push(match[1]);
  for (const match of content.matchAll(/\b(api\/[A-Za-z0-9_/-]+)\b/g)) items.push(match[1]);
  return unique(items).slice(0, 40);
}

function collectNavigationTargets(content) {
  const targets = [];
  for (const match of content.matchAll(/href=["']([^"']+)["']/g)) targets.push(match[1]);
  for (const match of content.matchAll(/router\.(push|replace)\(["']([^"']+)["']\)/g)) targets.push(match[2]);
  return unique(targets).slice(0, 40);
}

function routeToKey(route) {
  return route.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase() || 'ROOT';
}

function inferProductName(repoRoot) {
  return path.basename(repoRoot).replace(/^session-\d+-/i, '').replace(/^g\d+-/i, '') || 'product';
}

function flattenKeys(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  const keys = [];
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    keys.push(next);
    if (child && typeof child === 'object' && !Array.isArray(child)) keys.push(...flattenKeys(child, next));
  }
  return keys;
}

function clean(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function exists(absolutePath) {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
