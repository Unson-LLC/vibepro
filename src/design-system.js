import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildDerivedDesignSystem,
  buildDesignSystemGate,
  buildProductSemanticModel,
  collectScreens,
  resolveDesignRoutes,
  normalizeDesignSystemBundle
} from './design-modernize.js';
import { importGraphifyArtifacts } from './graphify-adapter.js';
import { localizedText } from './language.js';

const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORED_DIRS = new Set(['.git', '.next', '.vibepro', 'coverage', 'dist', 'node_modules']);

export async function deriveNativeDesignSystem(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const product = options.product ?? inferProductName(root);
  const designSystemId = sanitizeId(options.designSystemId ?? options.id ?? product);
  const routes = await resolveDesignRoutes(root, options.routes);
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
    output: { language: options.language ?? 'ja' },
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

export async function initDesignSystem(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  if (!options.designSystemId && !options.id) {
    throw new Error('design-system init requires --id <ds-id>');
  }
  const designSystemId = sanitizeId(options.designSystemId ?? options.id);
  const product = options.product ?? designSystemId;
  const designSystem = createEmptyDesignSystem({
    designSystemId,
    product,
    language: options.language ?? 'ja'
  });
  const outDir = path.join(root, '.vibepro', 'design-system', designSystemId);
  await mkdir(outDir, { recursive: true });
  await writeDesignSystemArtifacts(outDir, designSystem);
  return { outDir, result: designSystem };
}

export async function exportDesignSystem(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  if (!options.designSystemId && !options.id) {
    throw new Error('design-system export requires --id <ds-id>');
  }
  const designSystemId = sanitizeId(options.designSystemId ?? options.id);
  const format = String(options.format ?? 'json').toLowerCase();
  const outDir = path.join(root, '.vibepro', 'design-system', designSystemId);
  const designSystemPath = path.join(outDir, 'design-system.json');
  const designSystem = await readJsonIfExists(designSystemPath);
  if (!designSystem) {
    throw new Error(`Design System not found: ${path.relative(root, designSystemPath).split(path.sep).join('/')}. Run design-system init or derive first.`);
  }
  if (format === 'json') {
    return {
      outDir,
      result: {
        schema_version: '0.1.0',
        workflow: 'design-system-export',
        design_system_id: designSystemId,
        format,
        status: 'pass',
        content_type: 'application/json',
        content: `${JSON.stringify(designSystem, null, 2)}\n`
      }
    };
  }
  if (format === 'markdown') {
    return {
      outDir,
      result: {
        schema_version: '0.1.0',
        workflow: 'design-system-export',
        design_system_id: designSystemId,
        format,
        status: 'pass',
        content_type: 'text/markdown',
        content: renderNativeDesignSystemSummary(designSystem, options.language ?? designSystem.output?.language ?? 'ja')
      }
    };
  }
  if (format === 'css') {
    return {
      outDir,
      result: buildCssExport(designSystem, designSystemId)
    };
  }
  throw new Error('design-system export requires --format json|markdown|css');
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
    output: { language: options.language ?? designSystem.output?.language ?? 'ja' },
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

export async function ingestExternalDesignSystemBundle(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  if (!options.designSystemId && !options.id) {
    throw new Error('design-system ingest requires --id <ds-id>');
  }
  if (!options.bundleFile) {
    throw new Error('design-system ingest requires --bundle <file>');
  }
  const designSystemId = sanitizeId(options.designSystemId ?? options.id);
  const bundlePath = path.isAbsolute(options.bundleFile) ? options.bundleFile : path.join(root, options.bundleFile);
  const bundleText = await readFile(bundlePath, 'utf8');
  const parsedBundle = JSON.parse(bundleText);
  const sanitized = sanitizeExternalBundle(parsedBundle);
  const bundleSummary = normalizeDesignSystemBundle(sanitized.value, {
    designSystemId,
    title: options.product ?? designSystemId
  });
  const externalBundle = buildExternalBundleReference({
    root,
    bundlePath,
    designSystemId,
    sanitized,
    bundleSummary
  });
  const outDir = path.join(root, '.vibepro', 'design-system', designSystemId);
  const designSystemPath = path.join(outDir, 'design-system.json');
  const existingDesignSystem = await readJsonIfExists(designSystemPath);
  const product = options.product
    ?? existingDesignSystem?.product
    ?? parsedBundle.product
    ?? parsedBundle.title
    ?? parsedBundle.name
    ?? designSystemId;
  const base = existingDesignSystem ?? createBundleIngestBaseDesignSystem({ designSystemId, product });
  const normalizedPayload = extractBundlePayload(sanitized.value);
  const tokenEvidence = collectBundleTokenEvidence(normalizedPayload.tokens);
  const componentEvidence = collectBundleComponentEvidence(normalizedPayload.components);
  const guidelineEvidence = collectBundleGuidelineEvidence(normalizedPayload.guidelines);
  const nextDesignSystem = {
    ...base,
    workflow: base.workflow ?? 'native-design-system-derivation',
    design_system_id: designSystemId,
    product,
    generated_at: new Date().toISOString(),
    output: { language: options.language ?? base.output?.language ?? 'ja' },
    authority: 'vibepro_native_design_system',
    external_generator_required: false,
    source_evidence: {
      ...(base.source_evidence ?? {}),
      routes: base.source_evidence?.routes ?? [],
      graphify: base.source_evidence?.graphify ?? emptyGraphifyEvidence(),
      current_ui_code: base.source_evidence?.current_ui_code ?? [],
      style_files: base.source_evidence?.style_files ?? [],
      external_bundle: {
        source: externalBundle.source,
        artifact: `.vibepro/design-system/${designSystemId}/external-bundle.json`,
        authority: externalBundle.authority,
        redacted_value_count: externalBundle.redacted_value_count
      }
    },
    external_bundle: externalBundle,
    theme_tokens: mergeThemeTokens(base.theme_tokens, tokenEvidence),
    semantic_tokens: mergeSemanticTokens(base.semantic_tokens, tokenEvidence, guidelineEvidence),
    component_roles: mergeComponentRoles(base.component_roles, componentEvidence),
    component_states: mergeComponentStates(base.component_states, guidelineEvidence),
    cta_policy: mergeCtaPolicy(base.cta_policy, guidelineEvidence, componentEvidence),
    density_policy: mergeDensityPolicy(base.density_policy, guidelineEvidence, tokenEvidence),
    navigation_policy: mergeNavigationPolicy(base.navigation_policy, guidelineEvidence),
    anti_patterns: mergeAntiPatterns(base.anti_patterns, guidelineEvidence),
    evidence_coverage: mergeBundleEvidenceCoverage(base.evidence_coverage, { tokenEvidence, componentEvidence, guidelineEvidence }),
    ds_gate: mergeExternalBundleGate(base.ds_gate, externalBundle)
  };
  await mkdir(outDir, { recursive: true });
  await writeDesignSystemArtifacts(outDir, nextDesignSystem);
  await writeFile(path.join(outDir, 'external-bundle.json'), `${JSON.stringify(externalBundle, null, 2)}\n`);
  return { outDir, result: nextDesignSystem };
}

export async function validateDesignSystem(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  if (!options.designSystemId && !options.id) {
    throw new Error('design-system validate requires --id <ds-id>');
  }
  if (!options.storyId) {
    throw new Error('design-system validate requires --story-id <story-id>');
  }
  const designSystemId = sanitizeId(options.designSystemId ?? options.id);
  const storyId = sanitizeStoryId(options.storyId);
  const outDir = path.join(root, '.vibepro', 'design-system', designSystemId);
  const designSystemPath = path.join(outDir, 'design-system.json');
  let designSystem;
  try {
    designSystem = JSON.parse(await readFile(designSystemPath, 'utf8'));
  } catch {
    throw new Error(`Design System not found: ${path.relative(root, designSystemPath).split(path.sep).join('/')}. Run design-system derive first.`);
  }

  const storyContext = await collectDesignValidationStoryContext(root, storyId);
  const artifactTexts = await readDesignSystemArtifactTexts(outDir);
  const findings = [
    ...validateDesignSystemShape(designSystem),
    ...validateDesignSystemStoryDrift({ designSystem, storyContext }),
    ...validateSecretLeakage(artifactTexts)
  ];
  const result = {
    schema_version: '0.1.0',
    workflow: 'design-system-validation',
    design_system_id: designSystemId,
    story_id: storyId,
    generated_at: new Date().toISOString(),
    output: { language: options.language ?? designSystem.output?.language ?? 'ja' },
    authority: {
      design_system: designSystem.authority ?? 'unknown',
      implementation: 'current code, Story, Spec, Architecture, and VibePro gates remain authoritative',
      generated_visuals: 'reference_only'
    },
    story_context: storyContext,
    summary: summarizeValidationStatus(findings),
    findings
  };
  const validationDir = path.join(outDir, 'validation');
  await mkdir(validationDir, { recursive: true });
  await writeFile(path.join(validationDir, `${storyId}.json`), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(validationDir, `${storyId}.md`), renderDesignSystemValidationSummary(result, result.output.language));
  return { outDir: validationDir, result };
}

export function renderNativeDesignSystemSummary(result, language = result.output?.language ?? 'ja') {
  return [
    localizedText(language, { ja: `# Design System: ${result.product}`, en: `# Design System: ${result.product}` }),
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
    localizedText(language, { ja: '## プロダクト意味論', en: '## Product Semantics' }),
    '',
    `- domain: ${result.product_semantics.primary_domain}`,
    `- language: ${result.product_semantics.language_policy}`,
    `- interaction: ${result.product_semantics.interaction_model}`,
    `- concepts: ${result.product_semantics.domain_concepts.join(', ') || '-'}`,
    '',
    localizedText(language, { ja: '## 証跡カバレッジ', en: '## Evidence Coverage' }),
    '',
    `- status: ${result.evidence_coverage.status}`,
    ...result.evidence_coverage.findings.map((finding) => `- ${finding.status}: ${finding.id} - ${finding.summary}`),
    ''
  ].join('\n');
}

export function renderDesignSystemValidationSummary(result, language = result.output?.language ?? 'ja') {
  return `${localizedText(language, { ja: `# Design System検証: ${result.design_system_id}`, en: `# Design System Validation: ${result.design_system_id}` })}

- story: ${result.story_id}
- workflow: ${result.workflow}
- status: ${result.summary.status}
- pass: ${result.summary.pass}
- needs_review: ${result.summary.needs_review}
- needs_evidence: ${result.summary.needs_evidence}
- block: ${result.summary.block}

## ${localizedText(language, { ja: '正本境界', en: 'Authority' })}

- design_system: ${result.authority.design_system}
- implementation: ${result.authority.implementation}
- generated_visuals: ${result.authority.generated_visuals}

## ${localizedText(language, { ja: 'Story文脈', en: 'Story Context' })}

- sources: ${result.story_context.sources.map((source) => source.path).join(', ') || 'not_found'}
- ui_signal: ${result.story_context.ui_signal ? 'yes' : 'no'}
- ds_signal: ${result.story_context.design_system_signal ? 'yes' : 'no'}

## ${localizedText(language, { ja: '検出事項', en: 'Findings' })}

${result.findings.map((finding) => `- ${finding.status}: ${finding.id} - ${finding.summary}`).join('\n')}
`;
}

function createEmptyDesignSystem({ designSystemId, product, language }) {
  const generatedAt = new Date().toISOString();
  return {
    schema_version: '0.1.0',
    workflow: 'native-design-system-init',
    design_system_id: designSystemId,
    product_id: designSystemId,
    product,
    generated_at: generatedAt,
    output: { language },
    authority: 'vibepro_native_design_system',
    authority_boundary: [
      'this artifact is the VibePro-native Design System scaffold',
      'Story, Spec, Architecture, current code, and VibePro gates remain implementation authority',
      'empty sections require evidence before the DS can be treated as complete'
    ],
    external_generator_required: false,
    source_evidence: {
      routes: [],
      graphify: emptyGraphifyEvidence(),
      current_ui_code: [],
      style_files: []
    },
    product_semantics: {
      schema_version: '0.1.0',
      product,
      primary_domain: 'needs_evidence',
      language_policy: 'needs_evidence',
      interaction_model: 'needs_evidence',
      domain_concepts: []
    },
    theme_tokens: {
      schema_version: '0.1.0',
      css_variables: [],
      class_hints: [],
      color_values: [],
      spacing_values: []
    },
    semantic_tokens: {
      schema_version: '0.1.0',
      color_roles: [],
      state_semantics: [],
      cta_priority: [],
      domain_semantics: [],
      raw_token_coverage: {
        css_variable_count: 0,
        color_value_count: 0,
        spacing_value_count: 0
      }
    },
    component_roles: {
      schema_version: '0.1.0',
      roles: []
    },
    component_states: {
      schema_version: '0.1.0',
      required_states: [],
      discovered_states: [],
      state_policy: []
    },
    screen_patterns: {
      schema_version: '0.1.0',
      graphify_status: 'not_available',
      patterns: []
    },
    cta_policy: {
      schema_version: '0.1.0',
      hierarchy: [],
      discovered_ctas: [],
      rules: []
    },
    density_policy: {
      schema_version: '0.1.0',
      policy: 'needs_evidence',
      evidence: {
        spacing_values: [],
        compact_class_hints: []
      },
      rules: []
    },
    navigation_policy: {
      schema_version: '0.1.0',
      policy: 'needs_evidence',
      navigation_targets: [],
      rules: []
    },
    anti_patterns: {
      schema_version: '0.1.0',
      global_rules: []
    },
    implementation_mapping: {
      schema_version: '0.1.0',
      mapping_source: 'needs_evidence',
      screen_mappings: [],
      source_file_sample: [],
      shared_component_candidates: []
    },
    evidence_coverage: {
      schema_version: '0.1.0',
      status: 'needs_evidence',
      findings: [
        {
          id: 'DS-EVIDENCE-SCAFFOLD',
          status: 'needs_evidence',
          summary: 'Design System scaffold exists, but route, code, token, component, state, CTA, density, and navigation evidence have not been attached.'
        }
      ]
    },
    ds_gate: {
      schema_version: '0.1.0',
      status: 'needs_evidence',
      fallback_allowed: false,
      checks: [
        {
          id: 'DS-GATE-SCAFFOLD-EVIDENCE',
          status: 'needs_evidence',
          statement: 'A scaffolded Design System must collect product evidence before it can pass DS gate review.'
        },
        {
          id: 'DS-GATE-AUTHORITY-BOUNDARY',
          status: 'pass',
          statement: 'The scaffold is VibePro-native and does not make external/generated visuals authoritative.'
        }
      ]
    }
  };
}

function buildCssExport(designSystem, designSystemId) {
  const themeTokens = designSystem.theme_tokens ?? {};
  const semanticTokens = designSystem.semantic_tokens ?? {};
  const cssVariables = unique(themeTokens.css_variables ?? []);
  const colorValues = unique(themeTokens.color_values ?? []);
  const spacingValues = unique(themeTokens.spacing_values ?? []);
  const colorRoles = Array.isArray(semanticTokens.color_roles) ? semanticTokens.color_roles : [];
  const semanticAliases = colorRoles.flatMap((role) => {
    const name = sanitizeId(role.name ?? role.role ?? 'color');
    const candidates = Array.isArray(role.candidate_tokens) ? role.candidate_tokens : [];
    if (candidates.length > 0) return [`  --vibepro-${name}: var(${candidates[0]});`];
    return [];
  });
  const themeAliases = cssVariables.map((token) => `  --vibepro-theme-${sanitizeId(token.replace(/^--/, ''))}: var(${token});`);
  const colorValueTokens = colorValues.map((value, index) => `  --vibepro-color-${index + 1}: ${value};`);
  const spacingValueTokens = spacingValues.map((value, index) => `  --vibepro-space-${index + 1}: ${value};`);
  const declarations = unique([
    ...themeAliases,
    ...semanticAliases,
    ...colorValueTokens,
    ...spacingValueTokens
  ]);
  if (declarations.length === 0) {
    return {
      schema_version: '0.1.0',
      workflow: 'design-system-export',
      design_system_id: designSystemId,
      format: 'css',
      status: 'needs_tokens',
      content_type: 'text/css',
      content: `/* VibePro Design System ${designSystemId}: needs_tokens - no semantic or theme tokens are available. */\n`
    };
  }
  return {
    schema_version: '0.1.0',
    workflow: 'design-system-export',
    design_system_id: designSystemId,
    format: 'css',
    status: 'pass',
    content_type: 'text/css',
    content: [
      `/* VibePro Design System export: ${designSystemId} */`,
      ':root {',
      ...declarations,
      '}',
      ''
    ].join('\n')
  };
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
  if (designSystem.external_bundle) {
    artifacts['external-bundle.json'] = designSystem.external_bundle;
  }
  await Promise.all(Object.entries(artifacts).map(([fileName, content]) => (
    writeFile(path.join(outDir, fileName), `${JSON.stringify(content, null, 2)}\n`)
  )));
  if (designSystem.visual_foundations) {
    await writeFile(path.join(outDir, 'visual-foundations.md'), renderVisualFoundationsSummary(designSystem.visual_foundations, designSystem.output?.language ?? 'ja'));
  }
  await writeFile(path.join(outDir, 'design-system.md'), renderNativeDesignSystemSummary(designSystem, designSystem.output?.language ?? 'ja'));
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

function renderVisualFoundationsSummary(foundations, language = 'ja') {
  return `${localizedText(language, { ja: `# Visual Foundations: ${foundations.product}`, en: `# Visual Foundations: ${foundations.product}` })}

- source: ${foundations.source}
- authority: ${foundations.authority}

## ${localizedText(language, { ja: '正本境界', en: 'Authority Boundary' })}

${foundations.authority_boundary.map((item) => `- ${item}`).join('\n')}

## ${localizedText(language, { ja: 'デザイン言語', en: 'Design Language' })}

${formatList(foundations.design_language)}

## ${localizedText(language, { ja: '色の役割', en: 'Color Roles' })}

${formatList(foundations.semantic_color_roles)}

## ${localizedText(language, { ja: 'Typography / Density / Motion', en: 'Typography / Density / Motion' })}

${formatList([
  ...foundations.typography,
  ...foundations.platform_density,
  ...foundations.spacing_radius_motion_shadow
])}

## ${localizedText(language, { ja: 'Components / Composition / CTA', en: 'Components / Composition / CTA' })}

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

function createBundleIngestBaseDesignSystem({ designSystemId, product }) {
  return {
    schema_version: '0.1.0',
    workflow: 'native-design-system-bundle-ingest',
    design_system_id: designSystemId,
    product,
    authority: 'vibepro_native_design_system',
    external_generator_required: false,
    source_evidence: {
      routes: [],
      graphify: emptyGraphifyEvidence(),
      current_ui_code: [],
      style_files: []
    },
    product_semantics: {
      schema_version: '0.1.0',
      product,
      primary_domain: 'product_ui',
      language_policy: 'preserve_current_product_language',
      interaction_model: 'existing_product_workflow',
      domain_concepts: []
    },
    screen_patterns: {
      schema_version: '0.1.0',
      graphify_status: 'not_available',
      patterns: []
    },
    implementation_mapping: {
      schema_version: '0.1.0',
      mapping_source: 'external_bundle_reference_only',
      screen_mappings: [],
      source_file_sample: [],
      shared_component_candidates: []
    }
  };
}

function emptyGraphifyEvidence() {
  return {
    status: 'not_available',
    graphify_executed: false,
    artifact_dir: null,
    route_count: 0,
    component_count: 0,
    edge_count: 0
  };
}

function extractBundlePayload(bundle) {
  const source = bundle && typeof bundle === 'object' ? bundle : {};
  const payload = source.bundle && typeof source.bundle === 'object' ? source.bundle : source;
  return {
    tokens: payload.tokens
      ?? payload.designTokens
      ?? payload.files?.tokens
      ?? source.semantic_tokens
      ?? source.theme_tokens
      ?? [payload.theme, payload.styles].filter(Boolean).join('\n')
      ?? {},
    components: payload.components
      ?? source.files?.components
      ?? source.component_roles?.roles
      ?? source.component_roles
      ?? [payload.componentsCss, payload.componentsJs].filter(Boolean).join('\n')
      ?? [],
    guidelines: payload.guidelines
      ?? source.files?.guidelines
      ?? source.overview
      ?? payload.documentation
      ?? []
  };
}

function buildExternalBundleReference({ root, bundlePath, designSystemId, sanitized, bundleSummary }) {
  return {
    schema_version: '0.1.0',
    design_system_id: designSystemId,
    source: path.relative(root, bundlePath).split(path.sep).join('/'),
    authority: 'external_bundle_reference_only_current_code_and_vibepro_gates_remain_authoritative',
    imported_at: new Date().toISOString(),
    redacted_value_count: sanitized.redactedCount,
    token_summary: bundleSummary.token_summary,
    component_summary: bundleSummary.component_summary,
    guideline_summary: bundleSummary.guideline_summary,
    constraints: bundleSummary.constraints,
    boundary: [
      'external bundle content may inform DS tokens, component roles, state semantics, CTA policy, density, and navigation constraints',
      'external bundle content must not override current code, Story, Spec, Architecture, or VibePro gates',
      'raw external CSS/JS exports are not persisted as implementation authority'
    ]
  };
}

function collectBundleTokenEvidence(tokens) {
  const text = flattenText(tokens);
  return {
    schema_version: '0.1.0',
    css_variables: unique([
      ...collectCssVariables(text),
      ...flattenKeys(tokens).filter((key) => /color|surface|text|space|font|radius|shadow|motion|state|semantic/i.test(key))
    ]).slice(0, 160),
    class_hints: unique(collectClassHints(text)).slice(0, 80),
    color_values: unique(collectColorValues(text)).slice(0, 80),
    spacing_values: unique(collectSpacingValues(text)).slice(0, 80),
    token_keys: unique(flattenKeys(tokens)).slice(0, 200)
  };
}

function collectBundleComponentEvidence(components) {
  const text = flattenText(components);
  const customElements = [...text.matchAll(/\b([a-z][a-z0-9]*-[a-z0-9-]+)\b/g)].map((match) => match[1]);
  const names = Array.isArray(components)
    ? components.map((item) => typeof item === 'string' ? item : item?.name ?? item?.title ?? item?.role).filter(Boolean)
    : flattenKeys(components);
  return {
    schema_version: '0.1.0',
    names: unique([...names.map(String), ...customElements, ...collectClassHints(text)]).slice(0, 120)
  };
}

function collectBundleGuidelineEvidence(guidelines) {
  const text = flattenText(guidelines);
  const topics = typeof guidelines === 'string'
    ? guidelines.split(/\n+/).map((line) => line.replace(/^[-*#\s]+/, '').trim()).filter(Boolean)
    : flattenKeys(guidelines);
  return {
    schema_version: '0.1.0',
    text,
    topics: unique(topics.map(String)).slice(0, 120)
  };
}

function mergeThemeTokens(existing, tokenEvidence) {
  return {
    ...(existing ?? {}),
    schema_version: existing?.schema_version ?? '0.1.0',
    css_variables: unique([...(existing?.css_variables ?? []), ...tokenEvidence.css_variables]).slice(0, 200),
    class_hints: unique([...(existing?.class_hints ?? []), ...tokenEvidence.class_hints]).slice(0, 200),
    color_values: unique([...(existing?.color_values ?? []), ...tokenEvidence.color_values]).slice(0, 120),
    spacing_values: unique([...(existing?.spacing_values ?? []), ...tokenEvidence.spacing_values]).slice(0, 120),
    external_bundle_token_keys: unique([...(existing?.external_bundle_token_keys ?? []), ...tokenEvidence.token_keys]).slice(0, 200)
  };
}

function mergeSemanticTokens(existing, tokenEvidence, guidelineEvidence) {
  const existingRoles = existing?.color_roles ?? [];
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    ...(existing ?? {}),
    color_roles: mergeNamedItems(existingRoles, inferExternalColorRoles(tokenEvidence, guidelineEvidence)).slice(0, 80),
    state_semantics: unique([...(existing?.state_semantics ?? []), ...inferExternalStates(guidelineEvidence)]).slice(0, 40),
    cta_priority: unique([...(existing?.cta_priority ?? []), 'primary', 'secondary', 'tertiary']).slice(0, 20),
    domain_semantics: unique([...(existing?.domain_semantics ?? []), ...inferExternalDomainSemantics(guidelineEvidence)]).slice(0, 60)
  };
}

function mergeComponentRoles(existing, componentEvidence) {
  const inferred = componentEvidence.names.map((name) => ({
    name: normalizeRoleName(name),
    source: 'external_bundle_reference',
    responsibility: inferComponentResponsibility(name)
  }));
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    roles: mergeNamedItems(existing?.roles ?? [], inferred).slice(0, 120)
  };
}

function mergeComponentStates(existing, guidelineEvidence) {
  const states = inferExternalStates(guidelineEvidence);
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    required_states: unique([...(existing?.required_states ?? []), ...states]).slice(0, 40),
    discovered_states: unique([...(existing?.discovered_states ?? []), ...states]).slice(0, 40),
    state_policy: unique([
      ...(existing?.state_policy ?? []),
      'external bundle states are reference constraints and must be verified against current implementation',
      'loading, disabled, error, empty, selected, success, available, limited, and unavailable states must stay visually distinguishable when present'
    ]).slice(0, 40)
  };
}

function mergeCtaPolicy(existing, guidelineEvidence, componentEvidence) {
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    hierarchy: existing?.hierarchy?.length > 0 ? existing.hierarchy : [
      { priority: 'primary', role: 'main product action', source: 'external_bundle_reference' },
      { priority: 'secondary', role: 'supporting navigation or refinement action', source: 'external_bundle_reference' },
      { priority: 'tertiary', role: 'low-emphasis utility action', source: 'external_bundle_reference' }
    ],
    discovered_ctas: unique([...(existing?.discovered_ctas ?? []), ...inferExternalCtas(guidelineEvidence, componentEvidence)]).slice(0, 80),
    rules: unique([
      ...(existing?.rules ?? []),
      'external CTA labels are candidates only; preserve current product-native wording unless Story/Spec changes it',
      'do not promote external secondary actions above the current primary product action'
    ]).slice(0, 40)
  };
}

function mergeDensityPolicy(existing, guidelineEvidence, tokenEvidence) {
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    policy: existing?.policy ?? inferDensityFromText(guidelineEvidence.text),
    evidence: {
      ...(existing?.evidence ?? {}),
      external_bundle_spacing_values: tokenEvidence.spacing_values.slice(0, 40),
      external_bundle_topics: guidelineEvidence.topics.filter((topic) => /density|compact|spacing|layout|scan|grid|余白|密度/i.test(topic)).slice(0, 40)
    },
    rules: unique([
      ...(existing?.rules ?? []),
      'external density guidance must not drop current required information',
      'spacing and layout guidance remain subject to current screen invariants'
    ]).slice(0, 40)
  };
}

function mergeNavigationPolicy(existing, guidelineEvidence) {
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    policy: existing?.policy ?? 'preserve_current_navigation_model',
    discovered_targets: existing?.discovered_targets ?? [],
    composition_rules: existing?.composition_rules ?? [],
    rules: unique([
      ...(existing?.rules ?? []),
      ...guidelineEvidence.topics.filter((topic) => /nav|route|tab|back|menu|sheet|navigation|遷移|ナビ/i.test(topic)).slice(0, 12),
      'external navigation guidance must not rewrite current route purpose or existing navigation anchors'
    ]).slice(0, 40)
  };
}

function mergeAntiPatterns(existing, guidelineEvidence) {
  const forbidden = guidelineEvidence.topics.filter((topic) => /avoid|forbid|do not|never|禁止|避ける|anti/i.test(topic));
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    items: uniqueItemsByStatement([...(existing?.items ?? []), ...forbidden.map((statement) => ({ statement, source: 'external_bundle_reference' }))]).slice(0, 80),
    global_rules: unique([
      ...(existing?.global_rules ?? []),
      'do not treat external bundle visuals as implementation authority',
      'do not persist external secret values or service tokens',
      'do not override current UX invariants with external bundle defaults'
    ]).slice(0, 40)
  };
}

function mergeBundleEvidenceCoverage(existing, { tokenEvidence, componentEvidence, guidelineEvidence }) {
  const findings = mergeFindings(existing?.findings ?? [], [
    {
      id: 'DS-EVIDENCE-EXTERNAL-BUNDLE-TOKENS',
      status: tokenEvidence.css_variables.length > 0 || tokenEvidence.token_keys.length > 0 ? 'pass' : 'warn',
      summary: `${tokenEvidence.css_variables.length + tokenEvidence.token_keys.length} external token signal(s) extracted`
    },
    {
      id: 'DS-EVIDENCE-EXTERNAL-BUNDLE-COMPONENTS',
      status: componentEvidence.names.length > 0 ? 'pass' : 'warn',
      summary: `${componentEvidence.names.length} external component signal(s) extracted`
    },
    {
      id: 'DS-EVIDENCE-EXTERNAL-BUNDLE-GUIDELINES',
      status: guidelineEvidence.topics.length > 0 ? 'pass' : 'warn',
      summary: `${guidelineEvidence.topics.length} external guideline topic(s) extracted`
    }
  ]);
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    status: findings.some((finding) => finding.status === 'fail')
      ? 'fail'
      : findings.some((finding) => finding.status === 'warn')
        ? 'needs_review'
        : 'pass',
    findings
  };
}

function mergeExternalBundleGate(dsGate, externalBundle) {
  const base = dsGate ?? {
    schema_version: '0.1.0',
    fallback_allowed: false,
    checks: []
  };
  return {
    ...base,
    fallback_allowed: false,
    checks: [
      ...(base.checks ?? []).filter((check) => check.id !== 'DS-GATE-EXTERNAL-BUNDLE-AUTHORITY'),
      {
        id: 'DS-GATE-EXTERNAL-BUNDLE-AUTHORITY',
        statement: `External bundle ${externalBundle.source} is reference evidence only; VibePro-native DS, current code, Story/Spec/Architecture, and gates remain implementation authority. Redacted values: ${externalBundle.redacted_value_count}.`
      }
    ]
  };
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

async function collectDesignValidationStoryContext(root, storyId) {
  const files = (await listFiles(root))
    .filter((file) => /\.(md|mdx|json)$/.test(file))
    .filter((file) => !file.startsWith('.vibepro/'))
    .filter((file) => file.includes(storyId) || /docs\/(management\/stories|specs|architecture)\//.test(file))
    .slice(0, 120);
  const sources = [];
  for (const file of files) {
    const absolutePath = path.join(root, file);
    const text = await readFile(absolutePath, 'utf8').catch(() => '');
    if (!text.includes(storyId) && !file.includes(storyId)) continue;
    sources.push({
      path: file,
      kind: inferDesignValidationSourceKind(file),
      excerpt: text.slice(0, 4000)
    });
  }
  const combined = sources.map((source) => source.excerpt).join('\n');
  return {
    story_id: storyId,
    sources: sources.map(({ path: sourcePath, kind }) => ({ path: sourcePath, kind })),
    ui_signal: /ui|ux|screen|visual|design|cta|component|navigation|density|画面|導線|見た目|コンポーネント/.test(combined),
    design_system_signal: /design system|design-system|ds|token|component role|state semantic|デザインシステム/.test(combined),
    cta_signal: /cta|button|action|primary|secondary|ボタン|導線/.test(combined),
    state_signal: /state|loading|disabled|error|empty|selected|状態|読込|エラー/.test(combined),
    navigation_signal: /navigation|route|tab|back|link|遷移|ナビ|導線/.test(combined),
    density_signal: /density|compact|scan|spacing|dense|情報密度|余白/.test(combined)
  };
}

function inferDesignValidationSourceKind(file) {
  if (file.includes('/management/stories/')) return 'story';
  if (file.includes('/specs/')) return 'spec';
  if (file.includes('/architecture/')) return 'architecture';
  return 'context';
}

async function readDesignSystemArtifactTexts(outDir) {
  const entries = await readdir(outDir, { withFileTypes: true }).catch(() => []);
  const texts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(json|md|css|js|txt)$/.test(entry.name)) continue;
    const filePath = path.join(outDir, entry.name);
    texts.push({
      path: entry.name,
      text: await readFile(filePath, 'utf8').catch(() => '')
    });
  }
  return texts;
}

function validateDesignSystemShape(designSystem) {
  const findings = [];
  findings.push(validationFinding({
    id: 'DS-VALIDATE-DRIFT',
    status: designSystem.authority === 'vibepro_native_design_system' ? 'pass' : 'block',
    summary: designSystem.authority === 'vibepro_native_design_system'
      ? 'Design System authority is VibePro-native.'
      : `Design System authority is ${designSystem.authority ?? 'missing'}; implementation must not trust external/generated DS as authoritative.`
  }));
  const ctaHierarchy = designSystem.cta_policy?.hierarchy;
  findings.push(validationFinding({
    id: 'DS-VALIDATE-CTA-PRIORITY',
    status: Array.isArray(ctaHierarchy) && ctaHierarchy.length > 0 ? 'pass' : 'needs_evidence',
    summary: Array.isArray(ctaHierarchy) && ctaHierarchy.length > 0
      ? `${ctaHierarchy.length} CTA hierarchy item(s) are defined.`
      : 'CTA priority hierarchy is missing.'
  }));
  const requiredStates = designSystem.component_states?.required_states;
  findings.push(validationFinding({
    id: 'DS-VALIDATE-STATE-SEMANTICS',
    status: Array.isArray(requiredStates) && requiredStates.length > 0 ? 'pass' : 'needs_evidence',
    summary: Array.isArray(requiredStates) && requiredStates.length > 0
      ? `${requiredStates.length} state semantic rule(s) are defined.`
      : 'State semantics are missing.'
  }));
  const componentRoles = designSystem.component_roles?.roles;
  findings.push(validationFinding({
    id: 'DS-VALIDATE-COMPONENT-ROLES',
    status: Array.isArray(componentRoles) && componentRoles.length > 0 ? 'pass' : 'needs_evidence',
    summary: Array.isArray(componentRoles) && componentRoles.length > 0
      ? `${componentRoles.length} component role(s) are defined.`
      : 'Component roles are missing.'
  }));
  const navigationRules = designSystem.navigation_policy?.rules;
  const densityRules = designSystem.density_policy?.rules;
  findings.push(validationFinding({
    id: 'DS-VALIDATE-NAV-DENSITY',
    status: Array.isArray(navigationRules) && navigationRules.length > 0 && Array.isArray(densityRules) && densityRules.length > 0 ? 'pass' : 'needs_evidence',
    summary: Array.isArray(navigationRules) && navigationRules.length > 0 && Array.isArray(densityRules) && densityRules.length > 0
      ? 'Navigation and density policies are both defined.'
      : 'Navigation or density policy is missing.'
  }));
  return findings;
}

function validateDesignSystemStoryDrift({ designSystem, storyContext }) {
  const findings = [];
  findings.push(validationFinding({
    id: 'DS-VALIDATE-STORY-CONTEXT',
    status: storyContext.sources.length > 0 ? 'pass' : 'needs_evidence',
    summary: storyContext.sources.length > 0
      ? `${storyContext.sources.length} Story/Spec/Architecture source(s) found.`
      : 'No Story/Spec/Architecture context found for this story.'
  }));
  const hasUiSignal = storyContext.ui_signal || storyContext.design_system_signal;
  findings.push(validationFinding({
    id: 'DS-VALIDATE-STORY-UI-SIGNAL',
    status: hasUiSignal ? 'pass' : 'needs_review',
    summary: hasUiSignal
      ? 'Story context contains UI/Design System signals.'
      : 'Story context does not clearly say this is a UI/Design System change.'
  }));
  const missing = [];
  if (storyContext.cta_signal && !(designSystem.cta_policy?.hierarchy?.length > 0)) missing.push('cta_policy.hierarchy');
  if (storyContext.state_signal && !(designSystem.component_states?.required_states?.length > 0)) missing.push('component_states.required_states');
  if (storyContext.navigation_signal && !(designSystem.navigation_policy?.rules?.length > 0)) missing.push('navigation_policy.rules');
  if (storyContext.density_signal && !(designSystem.density_policy?.rules?.length > 0)) missing.push('density_policy.rules');
  findings.push(validationFinding({
    id: 'DS-VALIDATE-STORY-DS-ALIGNMENT',
    status: missing.length === 0 ? 'pass' : 'needs_review',
    summary: missing.length === 0
      ? 'Story signals are covered by Design System sections.'
      : `Story signals require missing DS sections: ${missing.join(', ')}.`
  }));
  return findings;
}

function validateSecretLeakage(artifactTexts) {
  const patterns = [
    /sk_live_[A-Za-z0-9_]{16,}/,
    /ghp_[A-Za-z0-9_]{24,}/,
    /xox[baprs]-[A-Za-z0-9-]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /(?:password|secret|token|api[_-]?key)["']?\s*[:=]\s*["'][^"']{12,}["']/i
  ];
  const matches = [];
  for (const artifact of artifactTexts) {
    if (patterns.some((pattern) => pattern.test(artifact.text))) matches.push(artifact.path);
  }
  return [validationFinding({
    id: 'DS-VALIDATE-SECRET-SCAN',
    status: matches.length > 0 ? 'block' : 'pass',
    summary: matches.length > 0
      ? `Potential secret material found in DS artifacts: ${matches.join(', ')}.`
      : 'No likely secret material detected in DS artifacts.'
  })];
}

function validationFinding({ id, status, summary }) {
  return {
    id,
    status,
    summary,
    release_blocking: status === 'block'
  };
}

function summarizeValidationStatus(findings) {
  const block = findings.filter((finding) => finding.status === 'block').length;
  const needsEvidence = findings.filter((finding) => finding.status === 'needs_evidence').length;
  const needsReview = findings.filter((finding) => finding.status === 'needs_review').length;
  return {
    status: block > 0 ? 'block' : needsEvidence > 0 ? 'needs_evidence' : needsReview > 0 ? 'needs_review' : 'pass',
    pass: findings.filter((finding) => finding.status === 'pass').length,
    needs_review: needsReview,
    needs_evidence: needsEvidence,
    block
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sanitizeExternalBundle(value) {
  let redactedCount = 0;
  const sanitize = (item, key = '') => {
    if (typeof item === 'string') {
      if (isLikelySecretValue(item) || isSecretKey(key)) {
        redactedCount += 1;
        return undefined;
      }
      return item;
    }
    if (Array.isArray(item)) {
      return item.map((entry) => sanitize(entry, key)).filter((entry) => entry !== undefined);
    }
    if (item && typeof item === 'object') {
      const next = {};
      for (const [entryKey, entryValue] of Object.entries(item)) {
        if (isSecretKey(entryKey) && typeof entryValue === 'string') {
          redactedCount += 1;
          continue;
        }
        const sanitized = sanitize(entryValue, entryKey);
        if (sanitized !== undefined) next[entryKey] = sanitized;
      }
      return next;
    }
    return item;
  };
  return {
    value: sanitize(value),
    redactedCount
  };
}

function isSecretKey(key) {
  return /secret|password|passwd|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|bearer|credential/i.test(String(key ?? ''));
}

function isLikelySecretValue(value) {
  const text = String(value ?? '');
  return /sk_live_[A-Za-z0-9_]{16,}/.test(text)
    || /ghp_[A-Za-z0-9_]{24,}/.test(text)
    || /xox[baprs]-[A-Za-z0-9-]{20,}/.test(text)
    || /AKIA[0-9A-Z]{16}/.test(text)
    || /Bearer\s+[A-Za-z0-9._-]{24,}/i.test(text)
    || /(?:password|secret|token|api[_-]?key)["']?\s*[:=]\s*["'][^"']{12,}["']/i.test(text);
}

function flattenText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenText).join('\n');
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => `${key}\n${flattenText(item)}`).join('\n');
  }
  return '';
}

function flattenKeys(value, prefix = '') {
  if (typeof value === 'string') return value ? [prefix || value] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenKeys(item, prefix ? `${prefix}.${index}` : String(index)));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (item && typeof item === 'object') return flattenKeys(item, nextPrefix);
      return [nextPrefix];
    });
  }
  return prefix ? [prefix] : [];
}

function inferExternalColorRoles(tokenEvidence, guidelineEvidence) {
  const text = `${tokenEvidence.css_variables.join(' ')} ${tokenEvidence.token_keys.join(' ')} ${guidelineEvidence.text}`.toLowerCase();
  const roleSpecs = [
    ['brand', /brand|primary|interactive|accent/],
    ['surface', /surface|background|card|sheet/],
    ['text', /text|foreground|muted|label/],
    ['success', /success|available|positive/],
    ['warning', /warning|caution|limited|urgency/],
    ['error', /error|danger|negative/],
    ['disabled', /disabled|inactive/],
    ['selected', /selected|active/]
  ];
  return roleSpecs
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => ({
      name,
      purpose: `External bundle candidate role: ${name}`,
      source: 'external_bundle_reference',
      candidate_tokens: tokenEvidence.css_variables.filter((token) => token.toLowerCase().includes(name)).slice(0, 12)
    }));
}

function inferExternalStates(guidelineEvidence) {
  const text = `${guidelineEvidence.text} ${guidelineEvidence.topics.join(' ')}`;
  const states = ['loading', 'empty', 'error', 'selected', 'disabled', 'success', 'available', 'limited', 'unavailable'];
  return states.filter((state) => new RegExp(state, 'i').test(text));
}

function inferExternalDomainSemantics(guidelineEvidence) {
  return guidelineEvidence.topics
    .filter((topic) => /search|map|hotel|booking|inventory|availability|filter|detail|result|domain|concept/i.test(topic))
    .slice(0, 40);
}

function inferExternalCtas(guidelineEvidence, componentEvidence) {
  const text = `${guidelineEvidence.text}\n${componentEvidence.names.join('\n')}`;
  return unique([
    ...[...text.matchAll(/(?:CTA|Action|Button|ボタン|導線)[:\s-]+([^\n.。]+)/gi)].map((match) => match[1].trim()),
    ...componentEvidence.names.filter((name) => /cta|button|action|submit|confirm|reserve|search|電話/i.test(name))
  ]).slice(0, 40);
}

function inferDensityFromText(text) {
  if (/dense|compact|scan|密度|一覧|comparison/i.test(text)) return 'preserve_dense_scannable_product_layout';
  return 'preserve_current_information_density';
}

function normalizeRoleName(value) {
  const raw = String(value ?? 'component').trim();
  const parts = raw
    .replace(/^ds[-_]/i, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const pascal = parts.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('');
  return pascal || raw;
}

function inferComponentResponsibility(name) {
  const text = String(name ?? '').toLowerCase();
  if (/cta|button|action|confirm|電話/.test(text)) return 'primary or secondary action surface';
  if (/card|result|hotel|item/.test(text)) return 'structured result or entity display';
  if (/sheet|modal|drawer/.test(text)) return 'layered navigation or detail surface';
  if (/nav|tab|menu/.test(text)) return 'navigation surface';
  if (/chip|filter|search/.test(text)) return 'search and refinement control';
  return 'external bundle component role candidate';
}

function mergeNamedItems(existing, incoming) {
  const byName = new Map();
  for (const item of [...existing, ...incoming]) {
    const name = item?.name ?? item;
    if (!name) continue;
    byName.set(String(name), typeof item === 'object' ? item : { name: String(name) });
  }
  return [...byName.values()];
}

function uniqueItemsByStatement(items) {
  const byStatement = new Map();
  for (const item of items) {
    const statement = typeof item === 'string' ? item : item?.statement;
    if (!statement) continue;
    byStatement.set(String(statement), typeof item === 'object' ? item : { statement });
  }
  return [...byStatement.values()];
}

function mergeFindings(existing, incoming) {
  const byId = new Map();
  for (const finding of [...existing, ...incoming]) {
    if (!finding?.id) continue;
    byId.set(finding.id, finding);
  }
  return [...byId.values()];
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

function sanitizeStoryId(value) {
  return String(value ?? 'story')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '') || 'story';
}

function inferProductName(repoRoot) {
  return path.basename(repoRoot).replace(/^session-\d+-/i, '').replace(/^g\d+-/i, '') || 'product';
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
