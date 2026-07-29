import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  buildDerivedDesignSystem,
  buildDesignSystemGate,
  buildProductSemanticModel,
  collectScreens,
  resolveDesignRoutes,
  normalizeDesignSystemBundle
} from './design-modernize.js';
import { importGraphifyArtifacts } from './graphify-adapter.js';
import { resolveGraphifyArtifactFile } from './artifact-routing.js';
import { localizedText } from './language.js';
import { resolveUiuxStylePreset } from './uiux-style-presets.js';

const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORED_DIRS = new Set(['.git', '.next', '.vibepro', 'coverage', 'dist', 'node_modules']);
const execFileAsync = promisify(execFile);

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
  const stylePreset = resolveUiuxStylePreset({
    brief: options.brief,
    routes,
    product,
    semanticModel: productSemantics
  });
  const derivedDesignSystem = buildDerivedDesignSystem({
    product,
    semanticModel: productSemantics,
    screens,
    referenceDesignSystem: { status: 'not_provided', title: product },
    stylePreset
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
    style_preset: stylePreset,
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
  if (format === 'design-md' || format === 'designmd') {
    const content = await readFile(path.join(outDir, 'DESIGN.md'), 'utf8')
      .catch(() => renderDesignMarkdownFromDesignSystem(designSystem));
    return {
      outDir,
      result: {
        schema_version: '0.1.0',
        workflow: 'design-system-export',
        design_system_id: designSystemId,
        product: designSystem.product,
        format: 'design-md',
        status: 'pass',
        content_type: 'text/markdown',
        content
      }
    };
  }
  throw new Error('design-system export requires --format json|markdown|css|design-md');
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

export async function ingestDesignMarkdown(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  if (!options.designSystemId && !options.id) {
    throw new Error('design-system ingest-design-md requires --id <ds-id>');
  }
  if (!options.file) {
    throw new Error('design-system ingest-design-md requires --file <file>');
  }
  const designSystemId = sanitizeId(options.designSystemId ?? options.id);
  const designMdPath = path.isAbsolute(options.file) ? options.file : path.join(root, options.file);
  const originalText = await readFile(designMdPath, 'utf8');
  const redacted = redactLikelySecretText(originalText);
  const source = path.relative(root, designMdPath).split(path.sep).join('/');
  const designMd = parseDesignMarkdown({
    designSystemId,
    product: options.product ?? designSystemId,
    source,
    text: redacted.text,
    redactedValueCount: redacted.count
  });
  const outDir = path.join(root, '.vibepro', 'design-system', designSystemId);
  const designSystemPath = path.join(outDir, 'design-system.json');
  const existingDesignSystem = await readJsonIfExists(designSystemPath);
  const product = options.product
    ?? existingDesignSystem?.product
    ?? designMd.tokens.name
    ?? designSystemId;
  const base = existingDesignSystem ?? createBundleIngestBaseDesignSystem({ designSystemId, product });
  const nextDesignSystem = mergeDesignMarkdownIntoDesignSystem(base, {
    designSystemId,
    product,
    source,
    designMd,
    language: options.language ?? base.output?.language ?? 'ja'
  });

  await mkdir(outDir, { recursive: true });
  await writeDesignSystemArtifacts(outDir, nextDesignSystem);
  await writeFile(path.join(outDir, 'DESIGN.md'), designMd.markdown);
  await writeFile(path.join(outDir, 'design-md.json'), `${JSON.stringify(nextDesignSystem.design_md, null, 2)}\n`);
  return { outDir, result: nextDesignSystem };
}

export async function exportDesignMarkdown(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  if (!options.designSystemId && !options.id) {
    throw new Error('design-system export-design-md requires --id <ds-id>');
  }
  const designSystemId = sanitizeId(options.designSystemId ?? options.id);
  const exported = await exportDesignSystem(root, {
    ...options,
    designSystemId,
    id: designSystemId,
    format: 'design-md'
  });
  const outDir = exported.outDir;
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'DESIGN.md'), exported.result.content);
  const designMd = parseDesignMarkdown({
    designSystemId,
    product: exported.result.product ?? designSystemId,
    source: `.vibepro/design-system/${designSystemId}/DESIGN.md`,
    text: exported.result.content
  });
  await writeFile(path.join(outDir, 'design-md.json'), `${JSON.stringify(toPersistedDesignMarkdown(designMd), null, 2)}\n`);
  return {
    outDir,
    result: {
      ...exported.result,
      artifact: `.vibepro/design-system/${designSystemId}/DESIGN.md`,
      lint_summary: designMd.lint.summary
    }
  };
}

export async function lintDesignMarkdown(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const designSystemId = options.designSystemId || options.id
    ? sanitizeId(options.designSystemId ?? options.id)
    : null;
  const sourceFile = options.file
    ? (path.isAbsolute(options.file) ? options.file : path.join(root, options.file))
    : designSystemId
      ? path.join(root, '.vibepro', 'design-system', designSystemId, 'DESIGN.md')
      : null;
  if (!sourceFile) {
    throw new Error('design-system lint requires --id <ds-id> or --file <file>');
  }
  const text = await readFile(sourceFile, 'utf8');
  const designMd = parseDesignMarkdown({
    designSystemId: designSystemId ?? 'design-md',
    product: options.product ?? designSystemId ?? 'design-md',
    source: path.relative(root, sourceFile).split(path.sep).join('/'),
    text
  });
  const result = {
    schema_version: '0.1.0',
    workflow: 'design-md-lint',
    design_system_id: designSystemId,
    source: designMd.source,
    generated_at: new Date().toISOString(),
    status: designMd.lint.summary.errors > 0 ? 'fail' : designMd.lint.summary.warnings > 0 ? 'needs_review' : 'pass',
    authority: 'design_md_reference_only_current_code_and_vibepro_gates_remain_authoritative',
    summary: designMd.lint.summary,
    findings: designMd.lint.findings,
    token_summary: designMd.token_summary,
    section_summary: designMd.section_summary
  };
  if (designSystemId) {
    const outDir = path.join(root, '.vibepro', 'design-system', designSystemId);
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'design-md-lint.json'), `${JSON.stringify(result, null, 2)}\n`);
    return { outDir, result };
  }
  return { outDir: path.dirname(sourceFile), result };
}

export async function diffDesignMarkdown(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  if (!options.designSystemId && !options.id) {
    throw new Error('design-system diff requires --id <ds-id>');
  }
  if (!options.base) {
    throw new Error('design-system diff requires --base <base-ref>');
  }
  const designSystemId = sanitizeId(options.designSystemId ?? options.id);
  const artifact = `.vibepro/design-system/${designSystemId}/DESIGN.md`;
  const currentPath = path.join(root, artifact);
  const currentText = await readFile(currentPath, 'utf8');
  const current = parseDesignMarkdown({
    designSystemId,
    product: designSystemId,
    source: artifact,
    text: currentText
  });
  const beforeText = await readGitFile(root, options.base, artifact);
  const before = beforeText == null
    ? null
    : parseDesignMarkdown({
      designSystemId,
      product: designSystemId,
      source: `${options.base}:${artifact}`,
      text: beforeText
    });
  const result = buildDesignMarkdownDiff({
    designSystemId,
    base: options.base,
    artifact,
    before,
    current
  });
  const outDir = path.join(root, '.vibepro', 'design-system', designSystemId);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'design-md-diff.json'), `${JSON.stringify(result, null, 2)}\n`);
  return { outDir, result };
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
  const styleTokenDrift = await validateStylePresetTokenDrift(root, {
    designSystem,
    base: options.base
  });
  const findings = [
    ...validateDesignSystemShape(designSystem),
    ...validateDesignSystemStoryDrift({ designSystem, storyContext }),
    ...styleTokenDrift.findings,
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
    style_token_drift: styleTokenDrift,
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

export function renderDesignMarkdownLintSummary(result, language = 'ja') {
  return `${localizedText(language, { ja: `# DESIGN.md lint: ${result.design_system_id ?? result.source}`, en: `# DESIGN.md lint: ${result.design_system_id ?? result.source}` })}

- source: ${result.source}
- status: ${result.status}
- errors: ${result.summary.errors}
- warnings: ${result.summary.warnings}
- info: ${result.summary.info}
- tokens: ${result.token_summary.token_count}
- sections: ${result.section_summary.section_count}
- do_dont: ${result.section_summary.do_dont_count}

## ${localizedText(language, { ja: 'Findings', en: 'Findings' })}

${result.findings.map((finding) => `- ${finding.severity}: ${finding.rule} ${finding.path} - ${finding.message}`).join('\n')}
`;
}

export function renderDesignMarkdownDiffSummary(result, language = 'ja') {
  return `${localizedText(language, { ja: `# DESIGN.md diff: ${result.design_system_id}`, en: `# DESIGN.md diff: ${result.design_system_id}` })}

- base: ${result.base}
- artifact: ${result.artifact}
- status: ${result.status}
- baseline: ${result.baseline_status}
- regression: ${result.regression}
- tokens added: ${result.tokens.added.length}
- tokens removed: ${result.tokens.removed.length}
- tokens modified: ${result.tokens.modified.length}
- sections added: ${result.sections.added.join(', ') || '-'}
- sections removed: ${result.sections.removed.join(', ') || '-'}

## ${localizedText(language, { ja: 'Findings', en: 'Findings' })}

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
    style_preset: resolveUiuxStylePreset({
      product,
      brief: 'VibePro scaffold defaults to operator/developer cockpit until evidence marks another product archetype or not_applicable.'
    }),
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
    'style-preset.json': designSystem.style_preset,
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

function parseDesignMarkdown({ designSystemId, product, source, text, redactedValueCount = 0 }) {
  const markdown = ensureTrailingNewline(String(text ?? '').replace(/\r\n/g, '\n'));
  const frontmatter = splitDesignMarkdownFrontmatter(markdown);
  const tokens = frontmatter.text ? parseYamlSubset(frontmatter.text) : {};
  const sections = parseDesignMarkdownSections(frontmatter.body);
  const tokenSummary = summarizeDesignMarkdownTokens(tokens);
  const sectionSummary = summarizeDesignMarkdownSections(sections, frontmatter.body);
  const lint = lintParsedDesignMarkdown({ tokens, sections, body: frontmatter.body, source, redactedValueCount });
  return {
    schema_version: '0.1.0',
    design_system_id: designSystemId,
    product,
    source,
    imported_at: new Date().toISOString(),
    authority: 'design_md_reference_only_current_code_and_vibepro_gates_remain_authoritative',
    parser: {
      frontmatter: frontmatter.text ? 'present' : 'absent',
      token_group_count: Object.keys(tokens).length,
      section_count: sections.length,
      unknown_section_count: sections.filter((section) => !section.canonical_key).length
    },
    tokens,
    token_summary: tokenSummary,
    sections: sections.map((section) => ({
      title: section.title,
      canonical_key: section.canonical_key,
      order: section.order,
      token_refs: section.token_refs,
      text: section.text
    })),
    section_summary: sectionSummary,
    lint,
    redacted_value_count: redactedValueCount,
    authority_boundary: [
      'DESIGN.md may guide design intent, token naming, component feel, and review focus',
      'DESIGN.md must not override current code, Story, Spec, Architecture, screenshots, Graphify/Codex evidence, or VibePro gates',
      'VibePro-native Design System artifacts remain the implementation-facing DS authority'
    ],
    markdown
  };
}

function splitDesignMarkdownFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { text: '', body: markdown };
  }
  return {
    text: match[1],
    body: markdown.slice(match[0].length)
  };
}

function parseYamlSubset(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const rawLine of String(text ?? '').split('\n')) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('- ')) {
      const parent = stack[stack.length - 1].value;
      if (!Array.isArray(parent.__items)) parent.__items = [];
      parent.__items.push(parseYamlScalar(trimmed.slice(2)));
      continue;
    }
    const match = trimmed.match(/^([^:]+):(?:\s*(.*))?$/);
    if (!match) continue;
    const key = stripYamlQuote(match[1].trim());
    let rawValue = match[2] ?? '';
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    if (!rawValue.trim()) {
      const child = {};
      parent[key] = child;
      stack.push({ indent, value: child });
      continue;
    }
    rawValue = rawValue.replace(/\s+#.*$/, '').trim();
    parent[key] = parseYamlScalar(rawValue);
  }
  return normalizeYamlLists(root);
}

function normalizeYamlLists(value) {
  if (Array.isArray(value)) return value.map(normalizeYamlLists);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value.__items) && Object.keys(value).length === 1) {
    return value.__items.map(normalizeYamlLists);
  }
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__items') continue;
    next[key] = normalizeYamlLists(item);
  }
  if (Array.isArray(value.__items)) next.items = value.__items.map(normalizeYamlLists);
  return next;
}

function parseYamlScalar(value) {
  const text = String(value ?? '').trim();
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (/^(['"]).*\1$/.test(text)) return text.slice(1, -1);
  if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function stripYamlQuote(value) {
  return String(value ?? '').replace(/^['"]|['"]$/g, '').trim();
}

function parseDesignMarkdownSections(body) {
  const lines = String(body ?? '').split('\n');
  const sections = [];
  let current = null;
  let order = 0;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (current) sections.push(finalizeDesignMarkdownSection(current));
      const title = heading[1].trim();
      current = {
        title,
        canonical_key: normalizeDesignMarkdownSectionTitle(title),
        order,
        lines: []
      };
      order += 1;
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(finalizeDesignMarkdownSection(current));
  return sections;
}

function finalizeDesignMarkdownSection(section) {
  const text = section.lines.join('\n').trim();
  return {
    ...section,
    text,
    token_refs: collectDesignMarkdownRefs(text)
  };
}

function normalizeDesignMarkdownSectionTitle(title) {
  const normalized = String(title ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (normalized === 'overview' || normalized === 'brand style' || normalized === 'brand and style') return 'overview';
  if (normalized === 'colors' || normalized === 'colours') return 'colors';
  if (normalized === 'typography') return 'typography';
  if (normalized === 'layout' || normalized === 'layout spacing' || normalized === 'layout and spacing') return 'layout';
  if (normalized === 'elevation depth' || normalized === 'elevation and depth' || normalized === 'elevation') return 'elevation_depth';
  if (normalized === 'shapes') return 'shapes';
  if (normalized === 'components') return 'components';
  if (/^(dos? and donts?|do and dont|do dont|donts?)$/.test(normalized)) return 'do_dont';
  return null;
}

function summarizeDesignMarkdownTokens(tokens) {
  const tokenPaths = flattenLeafPaths(tokens)
    .filter((item) => !['version', 'name', 'description'].includes(item.path));
  return {
    schema_version: '0.1.0',
    name: typeof tokens.name === 'string' ? tokens.name : null,
    version: typeof tokens.version === 'string' ? tokens.version : null,
    groups: Object.keys(tokens).filter((key) => !['version', 'name', 'description'].includes(key)),
    token_count: tokenPaths.length,
    color_count: Object.keys(objectValue(tokens.colors)).length,
    typography_count: Object.keys(objectValue(tokens.typography)).length,
    rounded_count: Object.keys(objectValue(tokens.rounded)).length,
    spacing_count: Object.keys(objectValue(tokens.spacing)).length,
    component_count: Object.keys(objectValue(tokens.components)).length,
    token_paths: tokenPaths.map((item) => item.path).slice(0, 240)
  };
}

function summarizeDesignMarkdownSections(sections, body) {
  const doDontStatements = extractDesignMarkdownDoDontStatements(sections);
  return {
    schema_version: '0.1.0',
    section_count: sections.length,
    canonical_sections: unique(sections.map((section) => section.canonical_key)).filter(Boolean),
    unknown_sections: sections.filter((section) => !section.canonical_key).map((section) => section.title),
    has_prose_intent: hasMeaningfulDesignMarkdownProse(body),
    do_dont_count: doDontStatements.length,
    do_dont_statements: doDontStatements.slice(0, 80)
  };
}

function lintParsedDesignMarkdown({ tokens, sections, body, source, redactedValueCount }) {
  const findings = [];
  const refs = unique([
    ...collectDesignMarkdownRefs(flattenText(tokens)),
    ...sections.flatMap((section) => section.token_refs)
  ]);
  for (const ref of refs) {
    if (!resolveDesignTokenPath(tokens, ref)) {
      findings.push(designMarkdownFinding({
        rule: 'DS-DESIGN-MD-BROKEN-REF',
        severity: 'error',
        path: ref,
        message: `Token reference {${ref}} does not resolve.`
      }));
    }
  }

  const canonicalKeys = sections.map((section) => section.canonical_key).filter(Boolean);
  for (const key of unique(canonicalKeys)) {
    const count = canonicalKeys.filter((item) => item === key).length;
    if (count > 1) {
      findings.push(designMarkdownFinding({
        rule: 'DS-DESIGN-MD-DUPLICATE-SECTION',
        severity: 'error',
        path: `sections.${key}`,
        message: `Canonical section ${key} appears ${count} times.`
      }));
    }
  }

  if (!isDesignMarkdownSectionOrderValid(canonicalKeys)) {
    findings.push(designMarkdownFinding({
      rule: 'DS-DESIGN-MD-SECTION-ORDER',
      severity: 'warning',
      path: 'sections',
      message: 'Canonical sections are not in DESIGN.md order.'
    }));
  }

  if (Object.keys(objectValue(tokens.colors)).length > 0 && !objectValue(tokens.colors).primary) {
    findings.push(designMarkdownFinding({
      rule: 'DS-DESIGN-MD-MISSING-PRIMARY',
      severity: 'warning',
      path: 'tokens.colors',
      message: 'Colors are defined but colors.primary is missing.'
    }));
  }

  if (Object.keys(objectValue(tokens.colors)).length > 0 && Object.keys(objectValue(tokens.typography)).length === 0) {
    findings.push(designMarkdownFinding({
      rule: 'DS-DESIGN-MD-MISSING-TYPOGRAPHY',
      severity: 'warning',
      path: 'tokens.typography',
      message: 'Colors are defined but typography tokens are missing.'
    }));
  }

  if (!hasMeaningfulDesignMarkdownProse(body)) {
    findings.push(designMarkdownFinding({
      rule: 'DS-DESIGN-MD-MISSING-PROSE-INTENT',
      severity: 'warning',
      path: 'body',
      message: 'Markdown body does not contain enough design rationale for agents.'
    }));
  }

  if (extractDesignMarkdownDoDontStatements(sections).length === 0) {
    findings.push(designMarkdownFinding({
      rule: 'DS-DESIGN-MD-MISSING-DO-DONT',
      severity: 'warning',
      path: 'sections.do_dont',
      message: 'Do/Don\'t guidance is missing.'
    }));
  }

  findings.push(...lintDesignMarkdownContrast(tokens));
  if (redactedValueCount > 0) {
    findings.push(designMarkdownFinding({
      rule: 'DS-DESIGN-MD-SECRET-REDACTION',
      severity: 'warning',
      path: source,
      message: `${redactedValueCount} likely secret value(s) were redacted before persisting DESIGN.md.`
    }));
  }

  const tokenSummary = summarizeDesignMarkdownTokens(tokens);
  findings.push(designMarkdownFinding({
    rule: 'DS-DESIGN-MD-TOKEN-SUMMARY',
    severity: 'info',
    path: 'tokens',
    message: `${tokenSummary.token_count} token(s), ${sections.length} section(s), ${tokenSummary.component_count} component token group(s).`
  }));

  return {
    schema_version: '0.1.0',
    status: findings.some((finding) => finding.severity === 'error')
      ? 'fail'
      : findings.some((finding) => finding.severity === 'warning')
        ? 'needs_review'
        : 'pass',
    findings,
    summary: {
      errors: findings.filter((finding) => finding.severity === 'error').length,
      warnings: findings.filter((finding) => finding.severity === 'warning').length,
      info: findings.filter((finding) => finding.severity === 'info').length
    }
  };
}

function designMarkdownFinding({ rule, severity, path: findingPath, message }) {
  return {
    rule,
    severity,
    path: findingPath,
    message
  };
}

function isDesignMarkdownSectionOrderValid(keys) {
  const order = ['overview', 'colors', 'typography', 'layout', 'elevation_depth', 'shapes', 'components', 'do_dont'];
  const positions = keys.map((key) => order.indexOf(key)).filter((index) => index >= 0);
  return positions.every((position, index) => index === 0 || position >= positions[index - 1]);
}

function lintDesignMarkdownContrast(tokens) {
  const findings = [];
  const components = objectValue(tokens.components);
  for (const [name, rawComponent] of Object.entries(components)) {
    const component = objectValue(rawComponent);
    const background = resolveDesignTokenValue(tokens, component.backgroundColor);
    const text = resolveDesignTokenValue(tokens, component.textColor);
    const backgroundRgb = parseHexColor(background);
    const textRgb = parseHexColor(text);
    if (!background || !text || !backgroundRgb || !textRgb) continue;
    const ratio = contrastRatio(backgroundRgb, textRgb);
    if (ratio < 4.5) {
      findings.push(designMarkdownFinding({
        rule: 'DS-DESIGN-MD-CONTRAST',
        severity: 'warning',
        path: `components.${name}`,
        message: `textColor ${text} on backgroundColor ${background} has contrast ratio ${ratio.toFixed(2)}:1, below WCAG AA 4.5:1.`
      }));
    }
  }
  return findings;
}

function mergeDesignMarkdownIntoDesignSystem(base, { designSystemId, product, source, designMd, language }) {
  const persistedDesignMd = toPersistedDesignMarkdown(designMd);
  const tokenEvidence = collectDesignMarkdownTokenEvidence(designMd);
  const componentEvidence = collectDesignMarkdownComponentEvidence(designMd);
  const guidelineEvidence = collectDesignMarkdownGuidelineEvidence(designMd);
  return {
    ...base,
    workflow: base.workflow ?? 'native-design-system-design-md-ingest',
    design_system_id: designSystemId,
    product,
    generated_at: new Date().toISOString(),
    output: { language },
    authority: 'vibepro_native_design_system',
    external_generator_required: false,
    source_evidence: {
      ...(base.source_evidence ?? {}),
      routes: base.source_evidence?.routes ?? [],
      graphify: base.source_evidence?.graphify ?? emptyGraphifyEvidence(),
      current_ui_code: base.source_evidence?.current_ui_code ?? [],
      style_files: base.source_evidence?.style_files ?? [],
      design_md: {
        source,
        artifact: `.vibepro/design-system/${designSystemId}/DESIGN.md`,
        normalized_artifact: `.vibepro/design-system/${designSystemId}/design-md.json`,
        authority: persistedDesignMd.authority,
        lint_status: persistedDesignMd.lint.status,
        redacted_value_count: persistedDesignMd.redacted_value_count
      }
    },
    design_md: persistedDesignMd,
    theme_tokens: mergeDesignMarkdownThemeTokens(base.theme_tokens, tokenEvidence),
    semantic_tokens: mergeDesignMarkdownSemanticTokens(base.semantic_tokens, tokenEvidence, guidelineEvidence),
    component_roles: mergeComponentRoles(base.component_roles, componentEvidence),
    component_states: mergeDesignMarkdownComponentStates(base.component_states, componentEvidence),
    cta_policy: mergeDesignMarkdownCtaPolicy(base.cta_policy, guidelineEvidence, componentEvidence),
    density_policy: mergeDesignMarkdownDensityPolicy(base.density_policy, tokenEvidence, guidelineEvidence),
    navigation_policy: base.navigation_policy ?? {
      schema_version: '0.1.0',
      policy: 'preserve_current_navigation_model',
      navigation_targets: [],
      rules: []
    },
    anti_patterns: mergeDesignMarkdownAntiPatterns(base.anti_patterns, guidelineEvidence),
    evidence_coverage: mergeDesignMarkdownEvidenceCoverage(base.evidence_coverage, designMd),
    ds_gate: mergeDesignMarkdownGate(base.ds_gate, designMd)
  };
}

function toPersistedDesignMarkdown(designMd) {
  const { markdown, ...persisted } = designMd;
  return persisted;
}

function collectDesignMarkdownTokenEvidence(designMd) {
  const tokenText = flattenText(designMd.tokens);
  return {
    schema_version: '0.1.0',
    token_paths: designMd.token_summary.token_paths,
    css_variables: collectCssVariables(tokenText),
    class_hints: [],
    color_values: collectColorValues(tokenText),
    spacing_values: collectSpacingValues(tokenText),
    color_roles: Object.keys(objectValue(designMd.tokens.colors)).map((name) => ({
      name: sanitizeId(name),
      purpose: `DESIGN.md color token: ${name}`,
      source: 'design_md_reference',
      candidate_tokens: [`design-md:colors.${name}`]
    })),
    typography_roles: Object.keys(objectValue(designMd.tokens.typography)).map((name) => ({
      name,
      source: 'design_md_reference'
    }))
  };
}

function collectDesignMarkdownComponentEvidence(designMd) {
  const componentNames = Object.keys(objectValue(designMd.tokens.components));
  return {
    schema_version: '0.1.0',
    names: componentNames,
    states: unique(componentNames.flatMap((name) => {
      const text = name.toLowerCase();
      return ['hover', 'active', 'pressed', 'disabled', 'selected', 'focus', 'loading', 'error']
        .filter((state) => text.includes(state));
    }))
  };
}

function collectDesignMarkdownGuidelineEvidence(designMd) {
  const sectionText = designMd.sections.map((section) => `${section.title}\n${section.text}`).join('\n\n');
  return {
    schema_version: '0.1.0',
    text: sectionText,
    topics: unique([
      ...designMd.sections.map((section) => section.title),
      ...designMd.section_summary.do_dont_statements
    ]).slice(0, 120)
  };
}

function mergeDesignMarkdownThemeTokens(existing, tokenEvidence) {
  return {
    ...(existing ?? {}),
    schema_version: existing?.schema_version ?? '0.1.0',
    css_variables: unique([...(existing?.css_variables ?? []), ...tokenEvidence.css_variables]).slice(0, 200),
    class_hints: existing?.class_hints ?? [],
    color_values: unique([...(existing?.color_values ?? []), ...tokenEvidence.color_values]).slice(0, 120),
    spacing_values: unique([...(existing?.spacing_values ?? []), ...tokenEvidence.spacing_values]).slice(0, 120),
    design_md_token_paths: unique([...(existing?.design_md_token_paths ?? []), ...tokenEvidence.token_paths]).slice(0, 240)
  };
}

function mergeDesignMarkdownSemanticTokens(existing, tokenEvidence, guidelineEvidence) {
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    ...(existing ?? {}),
    color_roles: mergeNamedItems(existing?.color_roles ?? [], tokenEvidence.color_roles).slice(0, 100),
    state_semantics: unique([...(existing?.state_semantics ?? []), ...inferExternalStates(guidelineEvidence)]).slice(0, 60),
    cta_priority: unique([...(existing?.cta_priority ?? []), ...inferCtaPriorityFromDesignMarkdown(guidelineEvidence)]).slice(0, 40),
    domain_semantics: unique([...(existing?.domain_semantics ?? []), ...inferExternalDomainSemantics(guidelineEvidence)]).slice(0, 80),
    typography_roles: unique([...(existing?.typography_roles ?? []), ...tokenEvidence.typography_roles.map((role) => role.name)]).slice(0, 80)
  };
}

function mergeDesignMarkdownComponentStates(existing, componentEvidence) {
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    required_states: unique([...(existing?.required_states ?? []), ...componentEvidence.states]).slice(0, 60),
    discovered_states: unique([...(existing?.discovered_states ?? []), ...componentEvidence.states]).slice(0, 60),
    state_policy: unique([
      ...(existing?.state_policy ?? []),
      'DESIGN.md component variants are reference constraints and must be verified against current implementation'
    ]).slice(0, 60)
  };
}

function mergeDesignMarkdownCtaPolicy(existing, guidelineEvidence, componentEvidence) {
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    hierarchy: existing?.hierarchy?.length > 0 ? existing.hierarchy : inferDesignMarkdownCtaHierarchy(guidelineEvidence),
    discovered_ctas: unique([...(existing?.discovered_ctas ?? []), ...inferExternalCtas(guidelineEvidence, componentEvidence)]).slice(0, 80),
    rules: unique([
      ...(existing?.rules ?? []),
      'DESIGN.md CTA guidance is reference evidence; preserve current product-native primary actions unless Story/Spec changes them',
      'DESIGN.md must not promote aesthetic preference above route-level CTA evidence'
    ]).slice(0, 60)
  };
}

function mergeDesignMarkdownDensityPolicy(existing, tokenEvidence, guidelineEvidence) {
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    policy: existing?.policy ?? inferDensityFromText(guidelineEvidence.text),
    evidence: {
      ...(existing?.evidence ?? {}),
      design_md_spacing_values: tokenEvidence.spacing_values.slice(0, 40),
      design_md_layout_topics: guidelineEvidence.topics.filter((topic) => /layout|spacing|density|grid|compact|scan|余白|密度/i.test(topic)).slice(0, 40)
    },
    rules: unique([
      ...(existing?.rules ?? []),
      'DESIGN.md layout and density guidance must preserve current information requirements'
    ]).slice(0, 60)
  };
}

function mergeDesignMarkdownAntiPatterns(existing, guidelineEvidence) {
  const forbidden = guidelineEvidence.topics.filter((topic) => /don'?t|dont|avoid|forbid|never|禁止|避ける|anti/i.test(topic));
  return {
    schema_version: existing?.schema_version ?? '0.1.0',
    items: uniqueItemsByStatement([...(existing?.items ?? []), ...forbidden.map((statement) => ({ statement, source: 'design_md_reference' }))]).slice(0, 100),
    global_rules: unique([
      ...(existing?.global_rules ?? []),
      'do not treat DESIGN.md as implementation authority',
      'do not override current UX invariants with DESIGN.md token defaults'
    ]).slice(0, 60)
  };
}

function mergeDesignMarkdownEvidenceCoverage(existing, designMd) {
  const findings = mergeFindings(existing?.findings ?? [], [
    {
      id: 'DS-EVIDENCE-DESIGN-MD',
      status: designMd.lint.summary.errors > 0 ? 'fail' : designMd.lint.summary.warnings > 0 ? 'warn' : 'pass',
      summary: `${designMd.token_summary.token_count} DESIGN.md token(s), ${designMd.section_summary.section_count} section(s), lint=${designMd.lint.status}`
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

function mergeDesignMarkdownGate(dsGate, designMd) {
  const base = dsGate ?? {
    schema_version: '0.1.0',
    fallback_allowed: false,
    checks: []
  };
  const lintRules = new Set(designMd.lint.findings.map((finding) => finding.rule));
  const checks = [
    ...(base.checks ?? []).filter((check) => !String(check.id ?? '').startsWith('DS-GATE-DESIGN-MD')),
    {
      id: 'DS-GATE-DESIGN-MD-AUTHORITY',
      status: 'pass',
      statement: 'DESIGN.md is reference evidence only; VibePro-native DS, current code, Story/Spec/Architecture, and gates remain implementation authority.'
    },
    {
      id: 'DS-GATE-DESIGN-MD-PARSE',
      status: designMd.lint.summary.errors > 0 ? 'fail' : 'pass',
      statement: `DESIGN.md parser extracted ${designMd.token_summary.token_count} token(s) and ${designMd.section_summary.section_count} section(s).`
    },
    {
      id: 'DS-GATE-DESIGN-MD-TOKEN-REFERENCES',
      status: lintRules.has('DS-DESIGN-MD-BROKEN-REF') ? 'fail' : 'pass',
      statement: 'All DESIGN.md token references must resolve before the DS can be treated as coherent evidence.'
    },
    {
      id: 'DS-GATE-DESIGN-MD-PROSE-INTENT',
      status: designMd.section_summary.has_prose_intent ? 'pass' : 'needs_review',
      statement: 'DESIGN.md must include prose rationale that helps human reviewers and coding agents apply tokens correctly.'
    },
    {
      id: 'DS-GATE-DESIGN-MD-DO-DONT-COVERAGE',
      status: designMd.section_summary.do_dont_count > 0 ? 'pass' : 'needs_review',
      statement: 'DESIGN.md should include Do/Don\'t guardrails so negative design constraints are reviewable.'
    },
    {
      id: 'DS-GATE-DESIGN-MD-CONTRAST',
      status: lintRules.has('DS-DESIGN-MD-CONTRAST') ? 'needs_review' : 'pass',
      statement: 'Component background/text token pairs that can be checked must not fall below WCAG AA contrast without review.'
    },
    {
      id: 'DS-GATE-DESIGN-MD-DRIFT',
      status: 'needs_evidence',
      statement: 'Run design-system diff against the PR base to confirm DESIGN.md changes do not regress token or prose intent.'
    }
  ];
  return {
    ...base,
    fallback_allowed: false,
    checks
  };
}

function inferCtaPriorityFromDesignMarkdown(guidelineEvidence) {
  const text = guidelineEvidence.text;
  const priorities = [];
  if (/primary|main|cta|call to action|主|主要/i.test(text)) priorities.push('primary_design_intent_action');
  if (/secondary|support|sub|補助/i.test(text)) priorities.push('secondary_design_intent_action');
  if (/tertiary|utility|low-emphasis|低/i.test(text)) priorities.push('tertiary_design_intent_action');
  return priorities.length > 0 ? priorities : ['preserve_current_cta_priority'];
}

function inferDesignMarkdownCtaHierarchy(guidelineEvidence) {
  return inferCtaPriorityFromDesignMarkdown(guidelineEvidence).map((priority) => ({
    priority,
    role: 'DESIGN.md reference CTA guidance',
    source: 'design_md_reference'
  }));
}

function renderDesignMarkdownFromDesignSystem(designSystem) {
  const product = designSystem.product ?? designSystem.design_system_id ?? 'Design System';
  const colors = designSystem.theme_tokens?.color_values ?? [];
  const spacing = designSystem.theme_tokens?.spacing_values ?? [];
  const colorRoles = designSystem.semantic_tokens?.color_roles ?? [];
  const roles = designSystem.component_roles?.roles ?? [];
  const antiPatterns = [
    ...(designSystem.anti_patterns?.global_rules ?? []),
    ...(designSystem.anti_patterns?.items ?? []).map((item) => item.statement ?? item).filter(Boolean)
  ];
  const lines = [
    '---',
    'version: alpha',
    `name: ${yamlQuote(product)}`,
    'colors:',
    ...colors.slice(0, 16).map((value, index) => `  color-${index + 1}: ${yamlQuote(value)}`),
    'spacing:',
    ...spacing.slice(0, 16).map((value, index) => `  space-${index + 1}: ${yamlQuote(value)}`),
    'components:',
    ...roles.slice(0, 24).flatMap((role) => [
      `  ${sanitizeId(role.name ?? 'component')}:`,
      `    purpose: ${yamlQuote(role.responsibility ?? role.purpose ?? 'component role')}`
    ]),
    '---',
    '',
    `# ${product} DESIGN.md`,
    '',
    '## Overview',
    '',
    'VibePro-generated DESIGN.md reference for human reviewers and coding agents. This file carries design intent as reference evidence; current code, Story, Spec, Architecture, and VibePro gates remain authoritative.',
    '',
    '## Colors',
    '',
    ...formatDesignMarkdownBullets(colorRoles.map((role) => `${role.name}: ${role.purpose ?? 'semantic color role'}`)),
    '',
    '## Typography',
    '',
    '- Preserve the current product readability scale unless Story or Spec changes it.',
    '',
    '## Layout',
    '',
    ...formatDesignMarkdownBullets(designSystem.density_policy?.rules ?? ['Preserve current information density and route hierarchy.']),
    '',
    '## Components',
    '',
    ...formatDesignMarkdownBullets(roles.slice(0, 24).map((role) => `${role.name}: ${role.responsibility ?? 'component role'}`)),
    '',
    '## Do\'s and Don\'ts',
    '',
    ...formatDesignMarkdownBullets(antiPatterns.length > 0 ? antiPatterns.map((item) => `Don\'t ${String(item).replace(/^do not\s+/i, '')}`) : ['Do keep DESIGN.md reference-only.', 'Don\'t override VibePro gates with visual preference.']),
    ''
  ];
  return ensureTrailingNewline(lines.join('\n'));
}

function buildDesignMarkdownDiff({ designSystemId, base, artifact, before, current }) {
  if (!before) {
    return {
      schema_version: '0.1.0',
      workflow: 'design-md-diff',
      design_system_id: designSystemId,
      base,
      artifact,
      generated_at: new Date().toISOString(),
      status: 'needs_baseline',
      baseline_status: 'not_found',
      regression: false,
      tokens: { added: [], removed: [], modified: [] },
      sections: { added: current.section_summary.canonical_sections, removed: [] },
      lint: { before: null, after: current.lint.summary },
      findings: [
        {
          id: 'DS-DESIGN-MD-DIFF-BASELINE',
          status: 'needs_evidence',
          summary: `No DESIGN.md artifact found at ${base}:${artifact}.`
        }
      ]
    };
  }
  const beforeTokens = flattenTokenMap(before.tokens);
  const currentTokens = flattenTokenMap(current.tokens);
  const tokenDiff = diffFlatMaps(beforeTokens, currentTokens);
  const beforeSections = before.section_summary.canonical_sections;
  const currentSections = current.section_summary.canonical_sections;
  const sections = {
    added: currentSections.filter((section) => !beforeSections.includes(section)),
    removed: beforeSections.filter((section) => !currentSections.includes(section))
  };
  const regression = current.lint.summary.errors > before.lint.summary.errors
    || current.lint.summary.warnings > before.lint.summary.warnings
    || (before.section_summary.has_prose_intent && !current.section_summary.has_prose_intent)
    || (before.section_summary.do_dont_count > 0 && current.section_summary.do_dont_count === 0);
  return {
    schema_version: '0.1.0',
    workflow: 'design-md-diff',
    design_system_id: designSystemId,
    base,
    artifact,
    generated_at: new Date().toISOString(),
    status: regression ? 'needs_review' : 'pass',
    baseline_status: 'found',
    regression,
    tokens: tokenDiff,
    sections,
    lint: {
      before: before.lint.summary,
      after: current.lint.summary
    },
    findings: [
      {
        id: 'DS-DESIGN-MD-DIFF-TOKENS',
        status: tokenDiff.removed.length > 0 || tokenDiff.modified.length > 0 ? 'needs_review' : 'pass',
        summary: `${tokenDiff.added.length} added, ${tokenDiff.removed.length} removed, ${tokenDiff.modified.length} modified token path(s).`
      },
      {
        id: 'DS-DESIGN-MD-DIFF-SECTIONS',
        status: sections.removed.length > 0 ? 'needs_review' : 'pass',
        summary: `${sections.added.length} added, ${sections.removed.length} removed canonical section(s).`
      },
      {
        id: 'DS-DESIGN-MD-DIFF-REGRESSION',
        status: regression ? 'needs_review' : 'pass',
        summary: regression ? 'Current DESIGN.md has more lint findings or lost prose guardrails.' : 'No DESIGN.md lint or prose regression detected.'
      }
    ]
  };
}

async function readGitFile(root, ref, file) {
  try {
    const result = await execFileAsync('git', ['show', `${ref}:${file}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 8
    });
    return result.stdout;
  } catch {
    return null;
  }
}

function collectDesignMarkdownRefs(text) {
  return [...String(text ?? '').matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map((match) => match[1]);
}

function resolveDesignTokenPath(tokens, ref) {
  const parts = String(ref ?? '').split('.').filter(Boolean);
  let current = tokens;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) return null;
    current = current[part];
  }
  return current == null ? null : current;
}

function resolveDesignTokenValue(tokens, value) {
  if (typeof value !== 'string') return value;
  const ref = value.match(/^\{([A-Za-z0-9_.-]+)\}$/);
  if (!ref) return value;
  return resolveDesignTokenPath(tokens, ref[1]);
}

function flattenLeafPaths(value, prefix = '') {
  if (!value || typeof value !== 'object') return prefix ? [{ path: prefix, value }] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenLeafPaths(item, prefix ? `${prefix}.${index}` : String(index)));
  }
  return Object.entries(value).flatMap(([key, item]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object') return flattenLeafPaths(item, nextPrefix);
    return [{ path: nextPrefix, value: item }];
  });
}

function flattenTokenMap(tokens) {
  const map = new Map();
  for (const item of flattenLeafPaths(tokens)) {
    if (['version', 'name', 'description'].includes(item.path)) continue;
    map.set(item.path, JSON.stringify(item.value));
  }
  return map;
}

function diffFlatMaps(before, after) {
  const beforeKeys = [...before.keys()];
  const afterKeys = [...after.keys()];
  return {
    added: afterKeys.filter((key) => !before.has(key)).sort(),
    removed: beforeKeys.filter((key) => !after.has(key)).sort(),
    modified: afterKeys.filter((key) => before.has(key) && before.get(key) !== after.get(key)).sort()
  };
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function extractDesignMarkdownDoDontStatements(sections) {
  const targetSections = sections.filter((section) => section.canonical_key === 'do_dont');
  const sourceSections = targetSections.length > 0 ? targetSections : sections;
  return unique(sourceSections.flatMap((section) => (
    section.text
      .split('\n')
      .map((line) => line.replace(/^[-*#\s]+/, '').trim())
      .filter((line) => /^(do|don'?t|dont|avoid|never|forbid|禁止|避ける|必ず)\b/i.test(line))
  ))).slice(0, 120);
}

function hasMeaningfulDesignMarkdownProse(body) {
  const prose = String(body ?? '')
    .replace(/^#+\s+.*$/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\{[A-Za-z0-9_.-]+\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return prose.length >= 80;
}

function parseHexColor(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return null;
  const hex = match[1].length === 3
    ? match[1].split('').map((char) => `${char}${char}`).join('')
    : match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

function relativeLuminance({ r, g, b }) {
  const channels = [r, g, b].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function yamlQuote(value) {
  return JSON.stringify(String(value ?? ''));
}

function formatDesignMarkdownBullets(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ['- not provided'];
}

function ensureTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`;
}

async function collectGraphifyEvidence(root, options) {
  const storyId = options.storyId ?? 'story-default';
  if (options.runGraphify) {
    const imported = await importGraphifyArtifacts(root, {
      runGraphify: true,
      sourceDir: options.graphifyOut ?? 'graphify-out',
      storyId
    });
    return {
      status: 'imported',
      graphify_executed: imported.graphifyExecuted,
      artifact_dir: path.relative(root, imported.graphifyDir).split(path.sep).join('/')
    };
  }
  const graphPath = await resolveGraphifyArtifactFile(root, storyId, 'graph.json');
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

async function validateStylePresetTokenDrift(root, { designSystem, base }) {
  const stylePreset = designSystem.style_preset ?? resolveUiuxStylePreset({ designSystem });
  if (stylePreset?.selection?.status === 'not_applicable') {
    const evidence = stylePreset.selection.evidence ?? [];
    const hasRationale = Boolean(stylePreset.selection.rationale);
    return {
      schema_version: '0.1.0',
      base: base ?? null,
      status: hasRationale && evidence.length > 0 ? 'not_applicable' : 'needs_evidence',
      changed_files: [],
      drift_count: 0,
      findings: [
        validationFinding({
          id: 'DS-VALIDATE-STYLE-PRESET-COVERAGE',
          status: hasRationale && evidence.length > 0 ? 'pass' : 'needs_evidence',
          summary: hasRationale && evidence.length > 0
            ? 'Style preset coverage is explicitly not_applicable with rationale and evidence.'
            : 'Style preset not_applicable requires explicit rationale and evidence.'
        })
      ],
      drift: []
    };
  }

  const changedFiles = await collectChangedUiStyleFiles(root, base);
  const allowed = collectAllowedStyleLiterals(designSystem);
  const drift = [];
  for (const file of changedFiles.files) {
    const content = await readFile(path.join(root, file), 'utf8').catch(() => '');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const item of collectLineStyleDrift(line, allowed)) {
        drift.push({
          file,
          line: index + 1,
          category: item.category,
          value: item.value,
          property: item.property
        });
      }
    });
  }
  const presetStatus = stylePreset?.selected_preset?.id ? 'pass' : 'needs_evidence';
  const driftStatus = drift.length > 0 ? 'needs_review' : 'pass';
  return {
    schema_version: '0.1.0',
    base: base ?? null,
    status: presetStatus === 'needs_evidence' ? 'needs_evidence' : driftStatus,
    changed_files: changedFiles.files,
    changed_file_source: changedFiles.source,
    drift_count: drift.length,
    drift: drift.slice(0, 120),
    findings: [
      validationFinding({
        id: 'DS-VALIDATE-STYLE-PRESET-COVERAGE',
        status: presetStatus,
        summary: stylePreset?.selected_preset?.id
          ? `Style preset ${stylePreset.selected_preset.id} is recorded as ${stylePreset.selection.status}.`
          : 'Style preset coverage is missing.'
      }),
      validationFinding({
        id: 'DS-VALIDATE-STYLE-TOKEN-DRIFT',
        status: driftStatus,
        summary: drift.length > 0
          ? `${drift.length} changed one-off style value(s) bypass native token policy.`
          : changedFiles.files.length > 0
            ? `${changedFiles.files.length} changed UI/style file(s) checked with no one-off style drift.`
            : `No changed UI/style files found${base ? ` from ${base}` : ''}.`,
        drift: drift.slice(0, 20)
      })
    ]
  };
}

async function collectChangedUiStyleFiles(root, base) {
  if (!base) {
    return { source: 'base_not_provided', files: [] };
  }
  const args = ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`];
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' }));
  } catch {
    try {
      ({ stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=ACMR', base], { cwd: root, encoding: 'utf8' }));
    } catch {
      return { source: 'git_diff_unavailable', files: [] };
    }
  }
  const files = stdout.split('\n')
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => isUiOrStyleFile(file));
  return { source: `git_diff:${base}`, files: unique(files) };
}

function isUiOrStyleFile(file) {
  const ext = path.extname(file);
  if (STYLE_EXTENSIONS.has(ext)) return true;
  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  return /(^|\/)(app|pages|components|ui|src|screens|layouts?)(\/|$)|component|screen|layout|page|route/i.test(file);
}

function collectAllowedStyleLiterals(designSystem) {
  return new Set([
    ...(designSystem.theme_tokens?.color_values ?? []),
    ...(designSystem.theme_tokens?.spacing_values ?? []),
    ...(designSystem.theme_tokens?.css_variables ?? []).map((token) => `var(${token})`)
  ].map((value) => String(value).trim()).filter(Boolean));
}

function collectLineStyleDrift(line, allowed) {
  const text = String(line ?? '');
  if (/^\s*(\/\/|\/\*|\*)/.test(text)) return [];
  if (!text.trim() || /var\(|token|theme|cssVar|className=/.test(text)) return [];
  const findings = [];
  for (const value of collectColorValues(text)) {
    if (!allowed.has(value)) findings.push({ category: 'color', value, property: inferStyleProperty(text) });
  }
  const spacingValues = collectSpacingValues(text).filter((value) => value !== '0px' && value !== '0rem' && value !== '0em');
  const property = inferStyleProperty(text);
  for (const value of spacingValues) {
    if (allowed.has(value)) continue;
    if (/font-?size|fontSize|line-?height|lineHeight|letter-?spacing|letterSpacing/i.test(text)) {
      findings.push({ category: 'typography', value, property });
    } else if (/border-?radius|borderRadius|radius/i.test(text)) {
      findings.push({ category: 'radius', value, property });
    } else if (/(margin|padding|gap|inset|top|right|bottom|left|width|height|minHeight|maxHeight|minWidth|maxWidth)/i.test(text)) {
      findings.push({ category: 'spacing', value, property });
    }
  }
  if (/box-?shadow|boxShadow/i.test(text) && !/none|null|undefined/.test(text)) {
    findings.push({ category: 'shadow', value: text.trim().slice(0, 120), property });
  }
  return findings;
}

function inferStyleProperty(line) {
  const match = String(line ?? '').match(/([A-Za-z-]+)\s*[:=]/);
  return match?.[1] ?? null;
}

function validateSecretLeakage(artifactTexts) {
  const matches = [];
  for (const artifact of artifactTexts) {
    if (hasLikelySecretMaterial(artifact.text)) matches.push(artifact.path);
  }
  return [validationFinding({
    id: 'DS-VALIDATE-SECRET-SCAN',
    status: matches.length > 0 ? 'block' : 'pass',
    summary: matches.length > 0
      ? `Potential secret material found in DS artifacts: ${matches.join(', ')}.`
      : 'No likely secret material detected in DS artifacts.'
  })];
}

function validationFinding({ id, status, summary, ...details }) {
  return {
    id,
    status,
    summary,
    ...details,
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
      if (isSecretKey(key)) {
        redactedCount += 1;
        return undefined;
      }
      const redacted = redactLikelySecretText(item);
      redactedCount += redacted.count;
      return redacted.text;
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
  const text = String(key ?? '');
  return /secret|password|passwd|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|api[_-]?token|bearer|credential|^token$/i.test(text);
}

function hasLikelySecretMaterial(value) {
  return secretMaterialPatterns().some((pattern) => pattern.test(String(value ?? '')));
}

function redactLikelySecretText(value) {
  const text = String(value ?? '');
  let count = 0;
  let redacted = text;
  for (const pattern of secretMaterialPatterns()) {
    redacted = redacted.replace(pattern, (...args) => {
      count += 1;
      const prefix = typeof args[1] === 'string' && pattern.source.startsWith('((?:') ? args[1] : null;
      return prefix ? `${prefix}[REDACTED:secret]` : '[REDACTED:secret]';
    });
  }
  return { text: redacted, count };
}

function secretMaterialPatterns() {
  return [
    /sk_live_[A-Za-z0-9_]{16,}/g,
    /ghp_[A-Za-z0-9_]{24,}/g,
    /xox[baprs]-[A-Za-z0-9-]{20,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /Bearer\s+[A-Za-z0-9._-]{24,}/gi,
    /((?:password|passwd|secret|credential|api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|auth[_-]?token|private[_-]?key)["']?\s*[:=]\s*["']?)([^"'\s,;)}\]]{4,})/gi
  ];
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
