import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildDerivedDesignSystem,
  buildDesignSystemGate,
  buildProductSemanticModel,
  collectScreens
} from './design-modernize.js';
import { importGraphifyArtifacts } from './graphify-adapter.js';

const DEFAULT_ROUTES = ['/home', '/map', '/detail', '/hotel/[hotel_id]'];
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORED_DIRS = new Set(['.git', '.next', '.vibepro', 'coverage', 'dist', 'node_modules']);

export async function deriveNativeDesignSystem(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const product = options.product ?? inferProductName(root);
  const designSystemId = sanitizeId(options.designSystemId ?? options.id ?? product);
  const routes = options.routes?.length > 0 ? options.routes : DEFAULT_ROUTES;
  const visualFoundations = await readVisualFoundations(root, {
    designSystemId,
    product,
    briefFile: options.briefFile
  });
  const graphify = await collectGraphifyEvidence(root, options);
  const screens = await collectScreens(root, routes, {
    product,
    designSystem: { status: 'not_provided', title: product },
    baseUrl: options.baseUrl
  });
  const productSemantics = buildProductSemanticModel({
    product,
    brief: options.brief,
    routes,
    screens
  });
  const derivedDesignSystem = buildDerivedDesignSystem({
    product,
    semanticModel: productSemantics,
    screens,
    referenceDesignSystem: { status: 'not_provided', title: product }
  });
  const styleEvidence = await collectStyleEvidence(root);
  const sourceEvidence = await collectSourceEvidence(root);
  const routePatterns = buildRoutePatterns({ screens, graphify });
  const implementationMapping = buildImplementationMapping({ screens, sourceEvidence, graphify });
  const semanticTokens = buildSemanticTokens({ derivedDesignSystem, styleEvidence });
  const stateSemantics = buildStateSemantics({ derivedDesignSystem, screens });
  const ctaPolicy = buildCtaPolicy({ derivedDesignSystem, screens });
  const densityPolicy = buildDensityPolicy({ derivedDesignSystem, styleEvidence });
  const navigationPolicy = buildNavigationPolicy({ derivedDesignSystem, screens });
  const antiPatterns = buildAntiPatterns(derivedDesignSystem);
  const evidenceCoverage = buildEvidenceCoverage({
    screens,
    styleEvidence,
    sourceEvidence,
    graphify,
    semanticTokens,
    implementationMapping
  });
  const dsGate = buildDesignSystemGate({
    storyId: designSystemId,
    derivedDesignSystem
  });
  const designSystem = {
    schema_version: '0.1.0',
    workflow: 'native-design-system-derivation',
    design_system_id: designSystemId,
    product,
    generated_at: new Date().toISOString(),
    authority: 'vibepro_native_design_system',
    external_generator_required: false,
    source_evidence: {
      routes,
      graphify,
      current_ui_code: summarizeScreenEvidence(screens),
      style_files: styleEvidence.files.map((file) => file.path),
      visual_foundations: visualFoundations ? {
        source: visualFoundations.source,
        artifact: `.vibepro/design-system/${designSystemId}/visual-foundations.json`,
        authority: visualFoundations.authority
      } : null
    },
    visual_foundations: visualFoundations,
    product_semantics: productSemantics,
    theme_tokens: styleEvidence.theme_tokens,
    semantic_tokens: semanticTokens,
    component_roles: derivedDesignSystem.component_role_map,
    component_states: stateSemantics,
    screen_patterns: routePatterns,
    cta_policy: ctaPolicy,
    density_policy: densityPolicy,
    navigation_policy: navigationPolicy,
    anti_patterns: antiPatterns,
    implementation_mapping: implementationMapping,
    evidence_coverage: evidenceCoverage,
    ds_gate: mergeVisualFoundationsGate(dsGate, visualFoundations)
  };

  const outDir = path.join(root, '.vibepro', 'design-system', designSystemId);
  await mkdir(outDir, { recursive: true });
  await writeDesignSystemArtifacts(outDir, designSystem);
  return { outDir, result: designSystem };
}

export async function ingestVisualDesignBrief(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  if (!options.designSystemId && !options.id) {
    throw new Error('design-system ingest-brief requires --id <ds-id>');
  }
  const designSystemId = sanitizeId(options.designSystemId ?? options.id);
  if (!options.briefFile) {
    throw new Error('design-system ingest-brief requires --brief-file <path>');
  }
  const outDir = path.join(root, '.vibepro', 'design-system', designSystemId);
  const designSystemPath = path.join(outDir, 'design-system.json');
  let designSystem;
  try {
    designSystem = JSON.parse(await readFile(designSystemPath, 'utf8'));
  } catch {
    throw new Error(`Design System not found: ${path.relative(root, designSystemPath).split(path.sep).join('/')}. Run design-system derive first.`);
  }
  const visualFoundations = await readVisualFoundations(root, {
    designSystemId,
    product: designSystem.product ?? options.product ?? designSystemId,
    briefFile: options.briefFile
  });
  const nextDesignSystem = {
    ...designSystem,
    visual_foundations: visualFoundations,
    source_evidence: {
      ...(designSystem.source_evidence ?? {}),
      visual_foundations: {
        source: visualFoundations.source,
        artifact: `.vibepro/design-system/${designSystemId}/visual-foundations.json`,
        authority: visualFoundations.authority
      }
    },
    ds_gate: mergeVisualFoundationsGate(designSystem.ds_gate, visualFoundations)
  };
  await writeDesignSystemArtifacts(outDir, nextDesignSystem);
  return { outDir, result: nextDesignSystem };
}

export function renderNativeDesignSystemSummary(result) {
  return [
    `# Design System: ${result.product}`,
    '',
    `- id: ${result.design_system_id}`,
    `- workflow: ${result.workflow}`,
    `- authority: ${result.authority}`,
    `- routes: ${result.source_evidence.routes.join(', ')}`,
    `- graphify: ${result.source_evidence.graphify.status}`,
    `- style files: ${result.source_evidence.style_files.length}`,
    `- component roles: ${result.component_roles.roles.length}`,
    `- screen patterns: ${result.screen_patterns.patterns.length}`,
    `- visual foundations: ${result.visual_foundations ? result.visual_foundations.source : 'not_provided'}`,
    `- gate fallback allowed: ${result.ds_gate.fallback_allowed}`,
    '',
    '## Product Semantics',
    '',
    `- domain: ${result.product_semantics.primary_domain}`,
    `- language: ${result.product_semantics.language_policy}`,
    `- interaction: ${result.product_semantics.interaction_model}`,
    `- concepts: ${result.product_semantics.domain_concepts.join(', ') || '-'}`,
    '',
    '## Evidence Coverage',
    '',
    `- status: ${result.evidence_coverage.status}`,
    ...result.evidence_coverage.findings.map((finding) => `- ${finding.status}: ${finding.id} - ${finding.summary}`),
    ''
  ].join('\n');
}

async function writeDesignSystemArtifacts(outDir, designSystem) {
  const artifacts = {
    'design-system.json': designSystem,
    'product-semantics.json': designSystem.product_semantics,
    'theme-tokens.json': designSystem.theme_tokens,
    'semantic-tokens.json': designSystem.semantic_tokens,
    'component-roles.json': designSystem.component_roles,
    'component-states.json': designSystem.component_states,
    'screen-patterns.json': designSystem.screen_patterns,
    'cta-policy.json': designSystem.cta_policy,
    'density-policy.json': designSystem.density_policy,
    'navigation-policy.json': designSystem.navigation_policy,
    'anti-patterns.json': designSystem.anti_patterns,
    'implementation-mapping.json': designSystem.implementation_mapping,
    'evidence-coverage.json': designSystem.evidence_coverage,
    'ds-gate.json': designSystem.ds_gate
  };
  if (designSystem.visual_foundations) {
    artifacts['visual-foundations.json'] = designSystem.visual_foundations;
  }
  await Promise.all(Object.entries(artifacts).map(([fileName, content]) => (
    writeFile(path.join(outDir, fileName), `${JSON.stringify(content, null, 2)}\n`)
  )));
  if (designSystem.visual_foundations) {
    await writeFile(path.join(outDir, 'visual-foundations.md'), renderVisualFoundationsSummary(designSystem.visual_foundations));
  }
  await writeFile(path.join(outDir, 'design-system.md'), renderNativeDesignSystemSummary(designSystem));
}

async function readVisualFoundations(root, { designSystemId, product, briefFile }) {
  if (!briefFile) return null;
  const absolutePath = path.isAbsolute(briefFile) ? briefFile : path.join(root, briefFile);
  const text = await readFile(absolutePath, 'utf8');
  return extractVisualFoundations({
    designSystemId,
    product,
    source: path.relative(root, absolutePath).split(path.sep).join('/'),
    text
  });
}

function extractVisualFoundations({ designSystemId, product, source, text }) {
  const normalized = String(text ?? '');
  return {
    schema_version: '0.1.0',
    design_system_id: designSystemId,
    product,
    source,
    authority: 'visual_reference_only_current_code_and_gates_remain_authoritative',
    design_language: extractLines(normalized, /(design language|tone|brand|らしさ|トーン|世界観)/i),
    platform_density: extractLines(normalized, /(platform|mobile|desktop|density|compact|dense|scan|密度|モバイル)/i),
    semantic_color_roles: extractLines(normalized, /(color|colour|semantic|surface|text|brand|success|warning|色|カラー)/i),
    typography: extractLines(normalized, /(typography|font|type|line-height|文字|フォント|タイポ)/i),
    spacing_radius_motion_shadow: extractLines(normalized, /(spacing|space|radius|radii|motion|shadow|elevation|余白|角丸|影|モーション)/i),
    component_visual_requirements: extractLines(normalized, /(component|button|card|chip|sheet|navigation|cta|コンポーネント|カード|ボタン)/i),
    composition_requirements: extractLines(normalized, /(composition|layout|screen|hierarchy|section|画面|構成|レイアウト|階層)/i),
    native_cta_language: extractLines(normalized, /(cta|action|button|call to action|電話|確認|探す|予約|文言)/i),
    forbidden_generic_ctas: extractForbiddenCtas(normalized),
    authority_boundary: [
      'current code, route evidence, implementation mapping, and VibePro gates remain implementation authority',
      'visual foundations may guide tone, component feel, density, and composition but must not override preserved UX invariants'
    ]
  };
}

function extractLines(text, pattern) {
  return unique(String(text ?? '')
    .split(/\n+/)
    .map((line) => line.replace(/^[-*#\s]+/, '').trim())
    .filter((line) => line.length > 0 && line.length < 240)
    .filter((line) => pattern.test(line)))
    .slice(0, 24);
}

function extractForbiddenCtas(text) {
  const lines = extractLines(text, /(forbidden|avoid|do not|generic|禁止|避ける|汎用)/i);
  const known = [];
  if (/book now/i.test(text)) known.push('Book Now');
  if (/予約する/.test(text) && /禁止|avoid|generic|汎用/i.test(text)) known.push('予約する');
  return unique([...known, ...lines]).slice(0, 16);
}

function mergeVisualFoundationsGate(dsGate, visualFoundations) {
  if (!visualFoundations) return dsGate;
  const base = dsGate ?? {
    schema_version: '0.1.0',
    fallback_allowed: false,
    checks: []
  };
  const checks = [
    ...(base.checks ?? []).filter((check) => check.id !== 'DS-GATE-VISUAL-FOUNDATIONS-AUTHORITY'),
    {
      id: 'DS-GATE-VISUAL-FOUNDATIONS-AUTHORITY',
      statement: 'Visual foundations are reference material only; current code, graph evidence, implementation mapping, and VibePro gates remain authoritative.'
    }
  ];
  return {
    ...base,
    fallback_allowed: false,
    checks
  };
}

function renderVisualFoundationsSummary(foundations) {
  return `# Visual Foundations: ${foundations.product}

- source: ${foundations.source}
- authority: ${foundations.authority}

## Authority Boundary

${foundations.authority_boundary.map((item) => `- ${item}`).join('\n')}

## Design Language

${formatList(foundations.design_language)}

## Color Roles

${formatList(foundations.semantic_color_roles)}

## Typography / Density / Motion

${formatList([
  ...foundations.typography,
  ...foundations.platform_density,
  ...foundations.spacing_radius_motion_shadow
])}

## Components / Composition / CTA

${formatList([
  ...foundations.component_visual_requirements,
  ...foundations.composition_requirements,
  ...foundations.native_cta_language,
  ...foundations.forbidden_generic_ctas
])}
`;
}

function formatList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- not extracted';
}

async function collectGraphifyEvidence(root, options) {
  if (options.runGraphify) {
    const imported = await importGraphifyArtifacts(root, {
      runGraphify: true,
      sourceDir: options.graphifyOut ?? 'graphify-out'
    });
    return {
      status: 'imported',
      graphify_executed: imported.graphifyExecuted,
      artifact_dir: path.relative(root, imported.graphifyDir).split(path.sep).join('/')
    };
  }
  const graphPath = path.join(root, '.vibepro', 'graphify', 'graph.json');
  try {
    const graph = JSON.parse(await readFile(graphPath, 'utf8'));
    return summarizeGraphifyGraph(graph, path.relative(root, graphPath).split(path.sep).join('/'));
  } catch {
    return {
      status: 'not_available',
      graphify_executed: false,
      artifact_dir: null,
      route_count: 0,
      component_count: 0,
      edge_count: 0
    };
  }
}

function summarizeGraphifyGraph(graph, artifact) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodeText = nodes.map((node) => JSON.stringify(node)).join('\n');
  return {
    status: 'available',
    graphify_executed: false,
    artifact,
    route_count: countMatches(nodeText, /route|page|screen|\/api\//gi),
    component_count: countMatches(nodeText, /component|tsx|jsx/gi),
    edge_count: edges.length
  };
}

async function collectStyleEvidence(root) {
  const files = (await listFiles(root))
    .filter((file) => STYLE_EXTENSIONS.has(path.extname(file)) || /tailwind\.config|theme|tokens/i.test(file))
    .slice(0, 80);
  const reports = [];
  for (const file of files) {
    const content = await readFile(path.join(root, file), 'utf8').catch(() => '');
    reports.push({
      path: file,
      css_variables: collectCssVariables(content),
      class_hints: collectClassHints(content),
      color_values: collectColorValues(content),
      spacing_values: collectSpacingValues(content)
    });
  }
  return {
    files: reports,
    theme_tokens: {
      css_variables: unique(reports.flatMap((file) => file.css_variables)).slice(0, 160),
      class_hints: unique(reports.flatMap((file) => file.class_hints)).slice(0, 160),
      color_values: unique(reports.flatMap((file) => file.color_values)).slice(0, 80),
      spacing_values: unique(reports.flatMap((file) => file.spacing_values)).slice(0, 80)
    }
  };
}

async function collectSourceEvidence(root) {
  const files = (await listFiles(root))
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
    .filter((file) => /component|app|pages|ui|screen|layout|route/i.test(file))
    .slice(0, 160);
  return {
    file_count: files.length,
    files: files.map((file) => ({ path: file }))
  };
}

function buildRoutePatterns({ screens, graphify }) {
  return {
    schema_version: '0.1.0',
    graphify_status: graphify.status,
    patterns: screens.map((screen) => ({
      route: screen.route,
      intent: inferIntentFromScreen(screen),
      files: screen.evidence.files.map((file) => file.path),
      component_names: unique(screen.evidence.files.flatMap((file) => file.components)).slice(0, 24),
      current_ctas: unique(screen.evidence.files.flatMap((file) => file.ctas)).slice(0, 16),
      state_names: unique(screen.evidence.files.flatMap((file) => file.states)).slice(0, 16),
      data_dependencies: unique(screen.evidence.files.flatMap((file) => file.data_dependencies)).slice(0, 16),
      navigation_targets: unique(screen.evidence.files.flatMap((file) => file.navigation)).slice(0, 16),
      ux_invariants: [
        'preserve route purpose',
        'preserve CTA order unless Story or Spec changes it',
        'preserve data dependency shape unless implementation evidence changes it'
      ]
    }))
  };
}

function buildImplementationMapping({ screens, sourceEvidence, graphify }) {
  const screenMappings = screens.map((screen) => ({
    route: screen.route,
    files: screen.evidence.files.map((file) => file.path),
    components: unique(screen.evidence.files.flatMap((file) => file.components)).slice(0, 32),
    states: unique(screen.evidence.files.flatMap((file) => file.states)).slice(0, 32),
    data_dependencies: unique(screen.evidence.files.flatMap((file) => file.data_dependencies)).slice(0, 32)
  }));
  return {
    schema_version: '0.1.0',
    mapping_source: graphify.status === 'available' || graphify.status === 'imported'
      ? 'current_code_and_graphify'
      : 'current_code',
    screen_mappings: screenMappings,
    source_file_sample: sourceEvidence.files.slice(0, 60),
    shared_component_candidates: unique(screenMappings.flatMap((mapping) => mapping.components)).slice(0, 80)
  };
}

function buildSemanticTokens({ derivedDesignSystem, styleEvidence }) {
  const cssVars = styleEvidence.theme_tokens.css_variables;
  return {
    schema_version: '0.1.0',
    color_roles: derivedDesignSystem.semantic_tokens.color_roles.map((role) => ({
      ...role,
      candidate_tokens: cssVars.filter((token) => tokenMatchesRole(token, role.name, role.purpose)).slice(0, 12)
    })),
    state_semantics: derivedDesignSystem.semantic_tokens.state_semantics,
    cta_priority: derivedDesignSystem.semantic_tokens.cta_priority,
    domain_semantics: derivedDesignSystem.semantic_tokens.domain_semantics,
    raw_token_coverage: {
      css_variable_count: cssVars.length,
      color_value_count: styleEvidence.theme_tokens.color_values.length,
      spacing_value_count: styleEvidence.theme_tokens.spacing_values.length
    }
  };
}

function buildStateSemantics({ derivedDesignSystem, screens }) {
  const discoveredStates = unique(screens.flatMap((screen) => (
    screen.evidence.files.flatMap((file) => file.states)
  )));
  return {
    schema_version: '0.1.0',
    required_states: derivedDesignSystem.semantic_tokens.state_semantics,
    discovered_states: discoveredStates,
    state_policy: [
      'states must be visually distinguishable',
      'disabled and loading states must not look actionable',
      'error and empty states need explicit copy or affordance evidence'
    ]
  };
}

function buildCtaPolicy({ derivedDesignSystem, screens }) {
  return {
    schema_version: '0.1.0',
    hierarchy: derivedDesignSystem.cta_hierarchy,
    discovered_ctas: unique(screens.flatMap((screen) => (
      screen.evidence.files.flatMap((file) => file.ctas)
    ))).slice(0, 60),
    rules: [
      'preserve product-native primary action wording unless Story or Spec changes it',
      'do not promote secondary navigation above the primary domain action',
      'route-level CTA changes require current route regression evidence'
    ]
  };
}

function buildDensityPolicy({ derivedDesignSystem, styleEvidence }) {
  return {
    schema_version: '0.1.0',
    policy: derivedDesignSystem.foundations.density_policy,
    evidence: {
      spacing_values: styleEvidence.theme_tokens.spacing_values.slice(0, 40),
      compact_class_hints: styleEvidence.theme_tokens.class_hints.filter((item) => /compact|dense|small|sm|xs|gap|space/i.test(item)).slice(0, 40)
    },
    rules: [
      'improve scanability without dropping required information',
      'keep repeated item dimensions stable across loading, hover, and selected states',
      'do not replace operational density with marketing composition'
    ]
  };
}

function buildNavigationPolicy({ derivedDesignSystem, screens }) {
  const targets = unique(screens.flatMap((screen) => (
    screen.evidence.files.flatMap((file) => file.navigation)
  )));
  return {
    schema_version: '0.1.0',
    policy: 'preserve_current_navigation_model',
    discovered_targets: targets.slice(0, 80),
    composition_rules: derivedDesignSystem.composition_guidelines.rules,
    rules: [
      'preserve route purpose and existing navigation anchors',
      'navigation model changes require Story or Spec evidence',
      'back, tab, and primary route transitions must stay reviewable'
    ]
  };
}

function buildAntiPatterns(derivedDesignSystem) {
  return {
    schema_version: '0.1.0',
    items: derivedDesignSystem.anti_patterns,
    global_rules: [
      'do not invent a new product concept',
      'do not invent backend data or unavailable states',
      'do not collapse product workflows into a landing page',
      'do not implement visual candidates without DS gate review'
    ]
  };
}

function buildEvidenceCoverage({ screens, styleEvidence, sourceEvidence, graphify, semanticTokens, implementationMapping }) {
  const findings = [
    {
      id: 'DS-EVIDENCE-ROUTES',
      status: screens.some((screen) => screen.evidence.files.length > 0) ? 'pass' : 'warn',
      summary: `${screens.filter((screen) => screen.evidence.files.length > 0).length}/${screens.length} routes have code evidence`
    },
    {
      id: 'DS-EVIDENCE-STYLES',
      status: styleEvidence.files.length > 0 ? 'pass' : 'warn',
      summary: `${styleEvidence.files.length} style or token files scanned`
    },
    {
      id: 'DS-EVIDENCE-GRAPH',
      status: graphify.status === 'available' || graphify.status === 'imported' ? 'pass' : 'warn',
      summary: graphify.status === 'not_available' ? 'graph evidence not available; derived from code only' : 'graph evidence available'
    },
    {
      id: 'DS-EVIDENCE-IMPLEMENTATION',
      status: implementationMapping.screen_mappings.some((mapping) => mapping.files.length > 0) ? 'pass' : 'warn',
      summary: `${sourceEvidence.file_count} source files sampled for implementation mapping`
    },
    {
      id: 'DS-EVIDENCE-SEMANTICS',
      status: semanticTokens.color_roles.length > 0 ? 'pass' : 'fail',
      summary: `${semanticTokens.color_roles.length} semantic color roles derived`
    }
  ];
  return {
    schema_version: '0.1.0',
    status: findings.some((finding) => finding.status === 'fail')
      ? 'fail'
      : findings.some((finding) => finding.status === 'warn')
        ? 'needs_review'
        : 'pass',
    findings
  };
}

function summarizeScreenEvidence(screens) {
  return screens.map((screen) => ({
    route: screen.route,
    file_count: screen.evidence.files.length,
    component_count: unique(screen.evidence.files.flatMap((file) => file.components)).length,
    cta_count: unique(screen.evidence.files.flatMap((file) => file.ctas)).length,
    state_count: unique(screen.evidence.files.flatMap((file) => file.states)).length
  }));
}

async function listFiles(root, dir = root) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, fullPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, fullPath).split(path.sep).join('/'));
    }
  }
  return files;
}

function collectCssVariables(content) {
  const variables = [];
  for (const match of content.matchAll(/--([A-Za-z0-9_-]+)\s*:/g)) variables.push(`--${match[1]}`);
  return unique(variables);
}

function collectClassHints(content) {
  const hints = [];
  for (const match of content.matchAll(/\.([A-Za-z][A-Za-z0-9_-]+)/g)) hints.push(match[1]);
  return unique(hints);
}

function collectColorValues(content) {
  return unique([
    ...[...content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]),
    ...[...content.matchAll(/(?:rgb|hsl)a?\([^)]+\)/g)].map((match) => match[0])
  ]);
}

function collectSpacingValues(content) {
  return unique([...content.matchAll(/\b\d+(?:\.\d+)?(?:px|rem|em)\b/g)].map((match) => match[0]));
}

function tokenMatchesRole(token, name, purpose) {
  const text = `${token} ${name} ${purpose}`.toLowerCase();
  return /brand|primary|surface|text|success|available|geo|distance|urgency|warning|plan|cta|interactive/.test(text)
    && text.split(/[-_\s]+/).some((part) => token.toLowerCase().includes(part));
}

function inferIntentFromScreen(screen) {
  const route = screen.route.toLowerCase();
  if (route.includes('map')) return 'spatial exploration';
  if (route.includes('detail')) return 'filter refinement or detail review';
  if (route.includes('hotel')) return 'entity detail and decision support';
  if (route.includes('home')) return 'entry and discovery';
  return 'existing product route';
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function sanitizeId(value) {
  return String(value ?? 'design-system')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '') || 'design-system';
}

function inferProductName(repoRoot) {
  return path.basename(repoRoot).replace(/^session-\d+-/i, '').replace(/^g\d+-/i, '') || 'product';
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
