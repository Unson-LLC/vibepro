import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const DEFAULT_SCREEN_ROUTES = ['/home', '/map', '/detail', '/hotel/[hotel_id]'];
const UI_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORED_DIRS = new Set(['.git', '.next', '.vibepro', 'coverage', 'dist', 'node_modules']);

export async function createDesignModernizePlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId ?? 'design-modernize';
  const product = options.product ?? inferProductName(root);
  const routes = options.routes?.length > 0 ? options.routes : DEFAULT_SCREEN_ROUTES;
  const bundle = await readDesignSystemBundle(root, options.designSystemBundle);
  const designSystem = normalizeDesignSystemBundle(bundle, {
    designSystemId: options.designSystemId,
    title: options.designSystemTitle ?? product
  });
  const screens = [];

  for (const route of routes) {
    const evidence = await collectScreenEvidence(root, route);
    screens.push(buildScreenSpec({
      product,
      route,
      evidence,
      designSystem,
      baseUrl: options.baseUrl
    }));
  }

  const designConstraintGraph = buildDesignConstraintGraph(designSystem, screens);
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
    reference_design_system: designSystem,
    design_constraint_graph: designConstraintGraph,
    visual_hypothesis: visualHypothesis,
    design_quality_dag: buildDesignQualityDag({ storyId, product, screens }),
    screens,
    implementation_plan: buildImplementationPlan(screens),
    spec_gate: buildSpecGate(screens),
    artifacts: {
      current_screen_capture: '.vibepro/design-modernize/<story-id>/screenshots/',
      design_constraint_graph: '.vibepro/design-modernize/<story-id>/design-constraint-graph.json',
      visual_hypothesis_prompts: '.vibepro/design-modernize/<story-id>/visual-hypothesis-prompts.md',
      visual_hypothesis_candidates: '.vibepro/design-modernize/<story-id>/visual-hypotheses/',
      design_system_bundle: '.vibepro/design-modernize/<story-id>/design-system-bundle.json',
      screen_specs: '.vibepro/design-modernize/<story-id>/design-modernize.json',
      design_briefs: '.vibepro/design-modernize/<story-id>/design-briefs.md',
      implementation_spec: '.vibepro/design-modernize/<story-id>/implementation-spec.md'
    }
  };

  const outDir = path.join(root, '.vibepro', 'design-modernize', storyId);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'design-modernize.json'), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(outDir, 'design-modernize.md'), renderDesignModernizePlan(plan));
  await writeFile(path.join(outDir, 'design-briefs.md'), renderDesignBriefs(plan));
  await writeFile(path.join(outDir, 'implementation-spec.md'), renderImplementationSpec(plan));
  await writeFile(path.join(outDir, 'design-constraint-graph.json'), `${JSON.stringify(designConstraintGraph, null, 2)}\n`);
  await writeFile(path.join(outDir, 'visual-hypothesis-prompts.md'), renderVisualHypothesisPrompts(plan));
  if (bundle) {
    await writeFile(path.join(outDir, 'design-system-bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  }

  return { outDir, plan };
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
    : plan?.screens?.map((screen) => screen.route) ?? DEFAULT_SCREEN_ROUTES;
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

export function normalizeDesignSystemBundle(bundle, options = {}) {
  const source = bundle && typeof bundle === 'object' ? bundle : {};
  const payload = source.bundle && typeof source.bundle === 'object' ? source.bundle : source;
  const tokens = payload.tokens
    ?? payload.designTokens
    ?? payload.files?.tokens
    ?? [payload.theme, payload.styles].filter(Boolean).join('\n')
    ?? {};
  const components = payload.components
    ?? source.files?.components
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
    constraints: buildDesignConstraints({ tokens, components, guidelines })
  };
}

export function renderDesignModernizePlan(plan) {
  return `# Design Modernize Plan

| Item | Value |
|------|-------|
| Story | ${plan.story_id} |
| Product | ${plan.product} |
| Design Intelligence | ${plan.design_intelligence.model} |
| External generator required | ${plan.design_intelligence.external_generator_required} |
| Reference Design System | ${plan.reference_design_system.title ?? '-'} (${plan.reference_design_system.id ?? '-'}) |

## Workflow

1. Graphify/Codex extract routes, components, state, CTA, data dependency, and preserved UX from current code.
2. Capture current browser screenshots for each route before asking for visual redesign.
3. Convert optional brand/design-system material into VibePro design constraints.
4. Generate one screen-level design brief per route with invariants, allowed visual changes, anti-patterns, rubric, and Codex acceptance criteria.
5. Use VibePro's Design Quality DAG to review hierarchy, density, CTA priority, state clarity, accessibility, interaction continuity, and implementation fit.
6. Implement with Codex using this spec, Graphify evidence, current screenshots, and current code as the source of truth.

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
  return `# ${plan.story_id} Implementation Spec

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

function buildDesignQualityDag({ storyId, product, screens }) {
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
      { from: 'design:current_ui_evidence', to: 'design:invariant_lock' },
      ...screenNodes.map((node) => ({ from: 'design:invariant_lock', to: node.id })),
      ...screenNodes.map((node) => ({ from: node.id, to: 'design:implementation_acceptance' }))
    ]
  };
}

function buildDesignConstraintGraph(designSystem, screens) {
  const tokenSample = designSystem.token_summary?.sample ?? [];
  const componentNames = designSystem.component_summary?.names ?? [];
  const guidelineTopics = designSystem.guideline_summary?.topics ?? [];
  return {
    schema_version: '0.1.0',
    source_design_system: {
      id: designSystem.id ?? null,
      title: designSystem.title ?? null,
      version: designSystem.version ?? null,
      status: designSystem.status
    },
    color_roles: inferRoles({
      samples: tokenSample,
      defaults: ['brand', 'surface', 'text', 'success', 'warning', 'location', 'urgency', 'disabled']
    }),
    component_roles: inferRoles({
      samples: componentNames,
      defaults: ['primary_cta', 'result_card', 'status_badge', 'filter_chip', 'bottom_sheet', 'bottom_navigation']
    }),
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
  return unique(labels.filter((label) => label.length > 0 && label.length < 80)).slice(0, 40);
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
