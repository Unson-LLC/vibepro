import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { profileArchitecture } from './architecture-profiler.js';
import { getPreset, resolvePresetId } from './presets.js';
import { generateStoryCandidates } from './story-candidate-generator.js';
import { getWorkspaceDir } from './workspace.js';

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vibepro',
  '.venv',
  'coverage',
  'dist',
  'graphify-out',
  'node_modules',
  'venv'
]);

const CODE_SURFACE_SIGNATURES = [
  {
    id: 'story-product-auth-account-access',
    title: '認証とアカウント利用開始を成立させる',
    category: 'product',
    patterns: [
      /^src\/app\/\(auth\)\//,
      /^src\/app\/auth\//,
      /^src\/app\/login\//,
      /^src\/app\/api\/auth\//,
      /^src\/app\/api\/sso-logout\//,
      /^src\/components\/auth\//,
      /^src\/lib\/auth/,
      /^src\/lib\/services\/user\//,
      /^src\/lib\/actions\/user_actions\.ts$/
    ]
  },
  {
    id: 'story-product-profile-personalization',
    title: 'プロフィール情報で体験を個人化する',
    category: 'product',
    patterns: [
      /^src\/app\/\(app\)\/profile\//,
      /^src\/app\/profile\//,
      /^src\/components\/profile\//,
      /^src\/lib\/services\/profile\//,
      /^src\/lib\/actions\/profile_action\.ts$/,
      /^src\/lib\/constants\/profile-errors\.ts$/
    ]
  },
  {
    id: 'story-product-content-cms',
    title: '記事とCMS運用を整理する',
    category: 'product',
    patterns: [
      /^src\/app\/\(public\)\/articles\//,
      /^src\/app\/articles\//,
      /^src\/app\/api\/articles\//,
      /^src\/app\/admin\/content\//,
      /^src\/lib\/article/,
      /^src\/lib\/article-utils\.ts$/
    ]
  },
  {
    id: 'story-product-premium-billing',
    title: 'プレミアム課金導線を安定化する',
    category: 'product',
    patterns: [
      /^src\/app\/\(public\)\/premium\//,
      /^src\/app\/api\/stripe\//,
      /^src\/app\/api\/webhook\/stripe\/route\.ts$/,
      /^src\/components\/ui\/button\/ButtonCheckout\.tsx$/,
      /^src\/components\/ui\/modal\/PremiumRequiredModal\.tsx$/,
      /^src\/lib\/constants\/stripe\.ts$/,
      /^src\/lib\/services\/stripe\//
    ]
  },
  {
    id: 'story-product-notification',
    title: '通知体験を安定化する',
    category: 'product',
    patterns: [
      /^src\/app\/\(app\)\/notification\//,
      /^src\/app\/notification\//,
      /^src\/components\/notification\//,
      /^src\/components\/ui\/UpdateNotification\.tsx$/,
      /^src\/lib\/services\/notification\//
    ]
  },
  {
    id: 'story-product-public-discovery-seo',
    title: '公開検索とSEO導線で新規流入を受け止める',
    category: 'product',
    patterns: [
      /^src\/app\/\(public\)\/articles\//,
      /^src\/app\/\(public\)\/sitemap/,
      /^src\/app\/robots\.ts$/,
      /^src\/app\/sitemap\.ts$/,
      /^src\/lib\/services\/analytics\//,
      /^src\/components\/common\/StructuredData\.tsx$/
    ]
  },
  {
    id: 'story-product-waiting-list-contact',
    title: '問い合わせと待機リストで利用意向を受け取る',
    category: 'product',
    patterns: [
      /^src\/app\/\(public\)\/contact\//,
      /^src\/app\/\(public\)\/waiting-list\//,
      /^src\/lib\/constants\/contact\.ts$/
    ]
  },
  {
    id: 'story-product-qr-offline-access',
    title: 'QRとオフライン状態でも利用接点を維持する',
    category: 'product',
    patterns: [
      /^src\/app\/\(app\)\/_components\/QRCodeScanner\.tsx$/,
      /^src\/app\/\(public\)\/offline\//,
      /^src\/components\/common\/ModernServiceWorkerManager\.tsx$/,
      /^src\/components\/ui\/UpdateNotification\.tsx$/
    ]
  },
  {
    id: 'story-product-app-navigation-shell',
    title: 'アプリの起点とナビゲーションを成立させる',
    category: 'product',
    patterns: [
      /^src\/app\/\(app\)\/home\//,
      /^src\/components\/layout\//
    ]
  },
  {
    id: 'story-ops-observability-health',
    title: '稼働状態と運用確認を見える化する',
    category: 'ops',
    patterns: [
      /^src\/app\/api\/health\/route\.ts$/,
      /^src\/app\/api\/heartbeat\/route\.ts$/,
      /^src\/app\/api\/vercel\/route\.ts$/,
      /^src\/app\/log_viewer\//,
      /^src\/components\/common\/ConsoleLogger\.tsx$/
    ]
  },
  {
    id: 'story-product-legal-trust-pages',
    title: '公開ページで利用前の信頼と規約確認を支える',
    category: 'product',
    patterns: [
      /^src\/app\/\(public\)\/privacy/,
      /^src\/app\/\(public\)\/terms\//,
      /^src\/app\/\(public\)\/tos\//,
      /^src\/app\/\(public\)\/tokusho\//,
      /^src\/app\/\(public\)\/guidelines\//
    ]
  }
];

export async function generateStoryCatalog(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const files = await collectRepoFiles(root);
  const fileSet = new Set(files.map((file) => file.relativePath));
  const evidenceResult = await readEvidence(root, options.manifest, options.fromRunId);
  const evidence = evidenceResult.evidence;
  const architectureProfile = evidence?.architecture_profile ?? await profileArchitecture(root);
  const repoProfile = detectStoryRepoProfile(fileSet, architectureProfile, files);
  const explicitPresetId = options.preset ?? options.config?.story_catalog?.preset ?? null;
  const activePreset = getPreset(resolvePresetId(options.config, options.preset));
  const presetResolution = {
    mode: explicitPresetId ? 'explicit' : 'auto',
    requested: explicitPresetId,
    selected: activePreset.id,
    repo_profile: repoProfile.id,
    reason: explicitPresetId
      ? 'Preset was explicitly selected by CLI or repo config.'
      : 'Preset was selected by VibePro default with repo profile applicability gates.'
  };
  const currentStory = findCurrentStory(options.config);
  const defaults = buildDefaultStoryFields(currentStory, activePreset, {
    repoProfile,
    presetExplicit: Boolean(explicitPresetId)
  });
  const graph = await readGraph(root);
  const graphSummary = summarizeGraph(graph);
  const documentSignals = await collectDocumentSignals(root, files, activePreset);
  const productSurfaceResult = deriveProductSurfaceStories(fileSet, defaults, documentSignals, activePreset, {
    repoProfile,
    presetExplicit: Boolean(explicitPresetId)
  });
  const codeSurfaceResult = deriveCodeSurfaceStories(fileSet, defaults, documentSignals, activePreset, {
    repoProfile,
    presetExplicit: Boolean(explicitPresetId)
  });

  const derivedStories = attachLinkedDocumentSignals([
    ...productSurfaceResult.stories,
    ...codeSurfaceResult.stories,
    ...deriveArchitectureStories(architectureProfile, evidence, defaults, documentSignals),
    ...deriveDocumentationStories(fileSet, documentSignals, defaults)
  ], documentSignals);
  const stories = dedupeStories([
    ...derivedStories,
    ...deriveConfiguredStories(options.config, documentSignals, defaults)
  ]);
  const coverage = buildGraphStoryCoverage(graph, stories, activePreset);
  const openQuestions = collectOpenQuestions(stories);
  const storyCandidates = generateStoryCandidates(coverage);

  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    source: {
      tool: 'vibepro',
      repo: '.',
      run_id: evidence?.run_id ?? null,
      evidence: evidence ? evidencePathForRun(options.manifest, evidence.run_id) : null,
      preset: activePreset.id,
      preset_resolution: presetResolution,
      repo_profile: repoProfile,
      graphify: graphSummary,
      warnings: [...evidenceResult.warnings, ...mergeDomainConfirmationWarnings([
        ...productSurfaceResult.warnings,
        ...codeSurfaceResult.warnings
      ])]
    },
    story_count: stories.length,
    coverage,
    open_questions: openQuestions,
    stories,
    story_candidates: storyCandidates
  };
}

export function renderStoryCatalogMap(catalog) {
  const stories = Array.isArray(catalog?.stories) ? catalog.stories : [];
  const portfolio = renderStoryPortfolio(stories);
  const storyCards = stories.map((story) => renderStoryCard(story)).join('\n\n');

  return `# Story Map

## サマリー

${renderExecutiveSummary(catalog, stories)}

## まず確認すること

${renderReviewQueue(catalog, stories)}

## Story構造

${portfolio}

## Storyカード

${storyCards || '-'}

## Story候補（uncovered cluster）

${renderStoryCandidatesAppendix(catalog.story_candidates ?? [])}

## 付録: Graph Coverage

${renderCoverageAppendix(catalog.coverage)}

## 付録: 不明点

${renderOpenQuestionsAppendix(catalog.open_questions ?? [])}
`;
}

function renderStoryCandidatesAppendix(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return 'uncovered cluster は検出されませんでした。';
  }
  return candidates.map((candidate) => {
    const evidence = (candidate.evidence ?? []).map((line) => `  - ${line}`).join('\n') || '  - -';
    const questions = (candidate.open_questions ?? []).map((line) => `  - ${line}`).join('\n') || '  - -';
    const title = candidate.suggested_story_titles?.[0] ?? candidate.candidate_id;
    return `### ${title}

- 候補ID: \`${candidate.candidate_id}\`
- Role: ${candidate.role}
- 共通パス: ${candidate.common_path}
- ファイル数: ${candidate.file_count}
- 確度: ${candidate.confidence}
- 主な根拠:
${evidence}
- 未決事項:
${questions}`;
  }).join('\n\n');
}

function deriveArchitectureStories(profile, evidence, defaults, documentSignals) {
  const stories = [];
  const views = profile?.views ?? {};
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
  const actionCandidates = Array.isArray(evidence?.action_candidates) ? evidence.action_candidates : [];
  const architectureDocs = documentSignals.architecture ?? [];
  const architecturePaths = docPaths(documentSignals, 'architecture');

  if (profile?.has_api_routes || views.runtime?.entrypoints?.length > 0) {
    stories.push(buildDerivedStory({
      id: 'story-architecture-api-surface',
      title: 'API公開面と実行境界を整理する',
      category: 'architecture',
      sourceType: 'architecture_profile',
      paths: architecturePaths.slice(0, 5),
      evidence: [
        `${views.runtime?.entrypoints?.length ?? 0} entrypoints`,
        ...(views.runtime?.server_boundaries ?? []),
        ...architecturePaths.slice(0, 2)
      ],
      storyDefinition: storyDefinitionFor('story-architecture-api-surface', selectDocs(documentSignals, 'architecture')),
      relatedFindings: findings
        .filter((finding) => String(finding.id).startsWith('VP-API-'))
        .map((finding) => finding.id),
      docs: selectDocs(documentSignals, 'architecture'),
      defaults
    }));
  }

  if (profile?.has_database || views.data?.stores?.length > 0 || views.data?.access_patterns?.length > 0) {
    stories.push(buildDerivedStory({
      id: 'story-architecture-data-access',
      title: 'データアクセスと永続化境界を整理する',
      category: 'architecture',
      sourceType: 'architecture_profile',
      paths: architecturePaths.slice(0, 5),
      evidence: [...(views.data?.stores ?? []), ...(views.data?.access_patterns ?? []), ...architecturePaths.slice(0, 2)],
      storyDefinition: storyDefinitionFor('story-architecture-data-access', selectDocs(documentSignals, 'architecture')),
      docs: selectDocs(documentSignals, 'architecture'),
      defaults
    }));
  }

  if (profile?.has_auth || views.security?.auth_boundaries?.length > 0) {
    stories.push(buildDerivedStory({
      id: 'story-security-auth-boundary',
      title: '認証とユーザー境界を固める',
      category: 'security',
      sourceType: 'architecture_profile',
      evidence: profile.auth ?? views.security?.auth_mechanisms ?? [],
      storyDefinition: storyDefinitionFor('story-security-auth-boundary'),
      defaults
    }));
  }

  if (findings.some((finding) => ['VP-API-002', 'VP-API-003', 'VP-STATIC-002', 'VP-STATIC-003'].includes(finding.id))) {
    stories.push(buildDerivedStory({
      id: 'story-security-api-trust-boundary',
      title: 'APIと外部連携の信頼境界を固める',
      category: 'security',
      sourceType: 'diagnosis',
      evidence: actionCandidates.map((candidate) => candidate.title).filter(Boolean),
      storyDefinition: storyDefinitionFor('story-security-api-trust-boundary'),
      relatedFindings: findings
        .filter((finding) => ['VP-API-002', 'VP-API-003', 'VP-STATIC-002', 'VP-STATIC-003'].includes(finding.id))
        .map((finding) => finding.id),
      diagnosisBased: true,
      defaults
    }));
  }

  if (views.deployment?.targets?.length > 0 || profile?.deployment?.length > 0) {
    stories.push(buildDerivedStory({
      id: 'story-ops-deployment-runtime',
      title: 'デプロイと実行基盤を運用可能にする',
      category: 'ops',
      sourceType: 'architecture_profile',
      evidence: views.deployment?.targets ?? profile.deployment ?? [],
      storyDefinition: storyDefinitionFor('story-ops-deployment-runtime'),
      defaults
    }));
  }

  if (views.quality?.test_tools?.length > 0 || views.quality?.ci?.length > 0) {
    stories.push(buildDerivedStory({
      id: 'story-quality-test-ci-readiness',
      title: 'テストとCIを開発ゲートとして整える',
      category: 'quality',
      sourceType: 'architecture_profile',
      evidence: [...(views.quality?.test_tools ?? []), ...(views.quality?.ci ?? []).slice(0, 3)],
      storyDefinition: storyDefinitionFor('story-quality-test-ci-readiness'),
      defaults
    }));
  }

  return stories;
}

function deriveProductSurfaceStories(fileSet, defaults, documentSignals, preset, context = {}) {
  const signals = preset?.productSurfaceSignals ?? [];
  if (signals.length === 0) return { stories: [], warnings: [] };
  const files = [...fileSet];
  const stories = [];
  const suppressed = [];
  const hasDocs = (key) => key && (documentSignals[key] ?? []).length > 0;

  for (const signal of signals) {
    const codePaths = signal.codePattern
      ? files.filter((file) => signal.codePattern.test(file)).sort().slice(0, 8)
      : [];
    const codeMatch = codePaths.length > 0;
    const docMatch = hasDocs(signal.docKey);
    if (!codeMatch && !docMatch) continue;
    const applicability = evaluateProductSurfaceApplicability({ signal, codePaths, docMatch, preset, context });
    if (!applicability.allowed) {
      suppressed.push({
        story_id: signal.id,
        reason: applicability.reason,
        evidence_paths: codePaths,
        required_profile: applicability.required_profile
      });
      continue;
    }
    const docs = signal.docKey ? selectDocs(documentSignals, signal.docKey) : [];
    const effectiveCodePaths = isProductSurfaceCodeEvidenceApplicable(context) ? codePaths : [];
    const paths = uniqueList([...(signal.docKey ? docPaths(documentSignals, signal.docKey) : []), ...effectiveCodePaths]);
    if (paths.length === 0) continue;
    stories.push(buildDerivedStory({
      id: signal.id,
      title: signal.title,
      category: signal.category ?? 'product',
      sourceType: signal.sourceType ?? 'story_cluster',
      paths,
      evidence: [...(signal.evidenceTokens ?? []), ...paths.slice(0, 3)],
      storyDefinition: storyDefinitionFor(signal.id, docs, preset),
      docs,
      defaults
    }));
  }

  return {
    stories,
    warnings: suppressed.length === 0 ? [] : [{
      severity: 'warning',
      code: 'needs_domain_confirmation',
      message: 'story derive suppressed template product stories because repo profile does not provide matching Web/SaaS evidence. Use --preset or story_catalog.preset to opt in explicitly.',
      repo_profile: context.repoProfile?.id ?? 'unknown',
      preset: preset?.id ?? null,
      suppressed_story_ids: suppressed.map((item) => item.story_id),
      suppressed
    }]
  };
}

function evaluateProductSurfaceApplicability({ signal, codePaths, docMatch, preset, context }) {
  if (context.presetExplicit) return { allowed: true, reason: 'explicit_preset' };
  if (docMatch) return { allowed: true, reason: 'document_signal' };
  if (preset?.id !== 'next-app') return { allowed: true, reason: 'non_next_app_preset' };
  const repoProfile = context.repoProfile;
  if (repoProfile?.product_surface_applicable === true) return { allowed: true, reason: 'repo_profile' };
  return {
    allowed: false,
    reason: 'repo_profile_not_web_product',
    required_profile: ['next-app', 'web'],
    evidence_paths: codePaths
  };
}

function isProductSurfaceCodeEvidenceApplicable(context = {}) {
  if (context.presetExplicit) return true;
  return context.repoProfile?.product_surface_applicable === true;
}

function deriveCodeSurfaceStories(fileSet, defaults, documentSignals, preset, context = {}) {
  const files = [...fileSet];
  const signatures = preset.codeSurfaceSignatures ?? CODE_SURFACE_SIGNATURES;
  const suppressed = [];
  const stories = signatures
    .map((signature) => {
      const codePaths = files
        .filter((file) => signature.patterns.some((pattern) => pattern.test(file)))
        .sort((a, b) => rankStoryCodePath(signature.id, a) - rankStoryCodePath(signature.id, b) || a.localeCompare(b))
        .slice(0, 8);
      const docs = selectDocsForStory(documentSignals, signature.id);
      const codePathsAllowed = isCodeSurfaceStoryApplicable(signature, context);
      const effectiveCodePaths = codePathsAllowed ? codePaths : [];
      if (codePaths.length === 0 && docs.length === 0) return null;
      if (!codePathsAllowed && codePaths.length > 0 && docs.length === 0) {
        suppressed.push({
          story_id: signature.id,
          reason: 'repo_profile_not_web_product',
          evidence_paths: codePaths,
          required_profile: ['next-app', 'web']
        });
      }
      if (effectiveCodePaths.length === 0 && docs.length === 0) return null;
      const paths = uniqueList([...docs.map((doc) => doc.path), ...effectiveCodePaths]);
      return buildDerivedStory({
        id: signature.id,
        title: signature.title,
        category: signature.category,
        sourceType: 'code_surface',
        paths,
        evidence: paths,
        storyDefinition: codeStoryDefinitionFor(signature.id, effectiveCodePaths, docs, preset),
        docs,
        codeDerived: true,
        defaults
      });
    })
    .filter(Boolean);
  return {
    stories,
    warnings: suppressed.length === 0 ? [] : [buildDomainConfirmationWarning({ suppressed, preset, repoProfile: context.repoProfile })]
  };
}

function isCodeSurfaceStoryApplicable(signature, context = {}) {
  if (signature.category !== 'product') return true;
  if (context.presetExplicit) return true;
  return context.repoProfile?.product_surface_applicable === true;
}

function buildDomainConfirmationWarning({ suppressed, preset, repoProfile }) {
  return {
    severity: 'warning',
    code: 'needs_domain_confirmation',
    message: 'story derive suppressed template product stories because repo profile does not provide matching Web/SaaS evidence. Use --preset or story_catalog.preset to opt in explicitly.',
    repo_profile: repoProfile?.id ?? 'unknown',
    preset: preset?.id ?? null,
    suppressed_story_ids: uniqueList(suppressed.map((item) => item.story_id)),
    suppressed
  };
}

function mergeDomainConfirmationWarnings(warnings) {
  const domainWarnings = warnings.filter((warning) => warning.code === 'needs_domain_confirmation');
  const otherWarnings = warnings.filter((warning) => warning.code !== 'needs_domain_confirmation');
  if (domainWarnings.length <= 1) return warnings;
  const suppressedByStory = new Map();
  for (const warning of domainWarnings) {
    for (const item of warning.suppressed ?? []) {
      if (!suppressedByStory.has(item.story_id)) suppressedByStory.set(item.story_id, item);
    }
  }
  return [
    ...otherWarnings,
    buildDomainConfirmationWarning({
      suppressed: [...suppressedByStory.values()],
      preset: { id: domainWarnings[0].preset },
      repoProfile: { id: domainWarnings[0].repo_profile }
    })
  ];
}

function deriveDocumentationStories(fileSet, documentSignals, defaults) {
  const hasDocs = [...fileSet].some((file) => file.startsWith('docs/'));
  if (!hasDocs) return [];
  return [buildDerivedStory({
    id: 'story-docs-story-ssot-recovery',
    title: '要求とStoryの正本を復元する',
    category: 'docs',
    sourceType: 'repo_surface',
    paths: [
      ...docPaths(documentSignals, 'requirements').slice(0, 3),
      ...docPaths(documentSignals, 'userStories').slice(0, 3),
      ...docPaths(documentSignals, 'features').slice(0, 3)
    ],
    evidence: [
      `${documentSignals.requirements?.length ?? 0} requirement docs`,
      `${documentSignals.userStories?.length ?? 0} user story docs`,
      `${documentSignals.features?.length ?? 0} feature docs`
    ],
    storyDefinition: storyDefinitionFor('story-docs-story-ssot-recovery', [
      ...selectDocs(documentSignals, 'requirements'),
      ...selectDocs(documentSignals, 'userStories'),
      ...selectDocs(documentSignals, 'features')
    ], defaults.preset),
    docs: [
      ...selectDocs(documentSignals, 'requirements'),
      ...selectDocs(documentSignals, 'userStories'),
      ...selectDocs(documentSignals, 'features')
    ],
    defaults
  })];
}

function deriveConfiguredStories(config, documentSignals, defaults) {
  const stories = Array.isArray(config?.brainbase?.stories) ? config.brainbase.stories : [];
  return stories
    .filter((story) => story?.story_id && !['archived', 'アーカイブ'].includes(story.status))
    .filter((story) => !isLikelyObsoleteConfiguredStory(story))
    .map((story) => buildConfiguredStory(story, documentSignals, defaults));
}

function buildConfiguredStory(story, documentSignals, defaults) {
  const docs = documentSignals?._byStoryId?.[story.story_id] ?? [];
  const category = story.category ?? inferConfiguredStoryCategory(story);
  const derivedStory = buildDerivedStory({
    id: story.story_id,
    title: story.title ?? story.story_id,
    category,
    sourceType: 'config_story',
    paths: docs.map((doc) => doc.path),
    evidence: docs.map((doc) => doc.path),
    docs,
    storyDefinition: docs.find((doc) => doc.story_definition)?.story_definition ?? null,
    defaults
  });

  derivedStory.ssot = story.ssot ?? derivedStory.ssot;
  derivedStory.status = story.status ?? derivedStory.status;
  derivedStory.horizon = story.horizon ?? derivedStory.horizon;
  derivedStory.view = story.view ?? derivedStory.view;
  derivedStory.period = story.period ?? derivedStory.period;
  derivedStory.started_at = story.started_at ?? derivedStory.started_at;
  derivedStory.due_at = story.due_at ?? derivedStory.due_at;
  if (story.period) {
    derivedStory.derived.open_questions = (derivedStory.derived.open_questions ?? [])
      .filter((item) => item.field !== 'period');
    const meaning = derivedStory.derived.meaning ?? {};
    meaning.evidence_by_type = {
      ...(meaning.evidence_by_type ?? {}),
      missing_evidence: (meaning.evidence_by_type?.missing_evidence ?? [])
        .filter((item) => item.field !== 'period')
    };
    meaning.counter_evidence = (meaning.counter_evidence ?? [])
      .filter((item) => !/period|実行期|計画期間/i.test(item));
  }
  derivedStory.derived.config_story = {
    story_id: story.story_id,
    ssot: story.ssot ?? null,
    status: story.status ?? null
  };
  return derivedStory;
}

function inferConfiguredStoryCategory(story) {
  if (story.view === 'business') return 'product';
  if (story.view === 'dev') return 'ops';
  if (/arch|architecture|設計|adr/i.test(story.story_id) || /設計|アーキテクチャ|ADR/i.test(story.title ?? '')) return 'architecture';
  return 'product';
}

function isLikelyObsoleteConfiguredStory(story) {
  if (!/^story-(product|architecture)-/.test(story.story_id)) return false;
  return /(仕様|要件|REQ-\d+|US-\d+|アーキテクチャ|設計|ガイド|ロードマップ|システムドキュメント|現在の実装|セットアップチェックリスト|インターフェース|テクノロジースタック|シーケンス図|sequence diagram|関係図|バージョン情報|フロー|構造)/i.test(story.title ?? '');
}

function buildDerivedStory({
  id,
  title,
  category,
  sourceType,
  paths = [],
  evidence = [],
  relatedFindings = [],
  docs = [],
  storyDefinition = null,
  diagnosisBased = false,
  codeDerived = false,
  defaults
}) {
  const preset = defaults.preset;
  const planning = inferPlanning({ category, docs, defaults, diagnosisBased, codeDerived });
  const normalizedDefinition = normalizeStoryDefinition(storyDefinition, docs);
  const businessContext = summarizeBusinessContext(docs, codeDerived);
  const storyContract = buildStoryContract({
    id,
    title,
    category,
    sourceType,
    paths,
    evidence,
    docs,
    definition: normalizedDefinition,
    businessContext,
    planning,
    diagnosisBased,
    codeDerived,
    defaults
  });
  const openQuestions = [
    ...planning.open_questions,
    ...storyContract.open_questions
  ];
  const meaning = buildStoryMeaning({
    id,
    category,
    sourceType,
    paths,
    evidence,
    docs,
    relatedFindings,
    definition: normalizedDefinition,
    planning,
    businessContext,
    openQuestions,
    diagnosisBased,
    codeDerived,
    preset
  });
  return {
    story_id: id,
    title,
    ssot: 'local',
    status: 'active',
    horizon: planning.horizon,
    view: planning.view,
    period: planning.period,
    started_at: planning.started_at,
    due_at: planning.due_at,
    category,
    source: {
      type: sourceType,
      paths
    },
    derived: {
      evidence: evidence.filter(Boolean),
      related_findings: relatedFindings,
      confidence: paths.length > 0 || evidence.length > 0 ? 'medium' : 'low',
      story_definition: normalizedDefinition,
      story_contract: storyContract,
      meaning,
      predictions: planning.predictions,
      business_context: businessContext,
      open_questions: openQuestions
    }
  };
}

function buildStoryContract({
  id,
  title,
  category,
  sourceType,
  paths = [],
  evidence = [],
  docs = [],
  definition,
  businessContext,
  planning,
  diagnosisBased,
  codeDerived,
  defaults
}) {
  const preset = defaults.preset;
  const storyType = inferStoryContractType({ id, title, category, sourceType, diagnosisBased, codeDerived });
  const codePaths = paths.filter((item) => isCodePath(item, preset));
  const docPathsList = docs.map((doc) => doc.path);
  const sourceRole = evaluateStorySourceRoleIntegrity({
    id,
    category,
    sourceType,
    paths,
    docs,
    codePaths,
    defaults
  });
  const intentStatus = hasStoryIntent(definition) ? 'passed' : 'needs_clarification';
  const boundaryStatus = codePaths.length > 0 || docPathsList.length > 0
    ? 'passed'
    : evidence.length > 0 || sourceType === 'architecture_profile' || sourceType === 'config_story' || diagnosisBased
      ? 'inferred'
      : 'needs_clarification';
  const acceptanceStatus = (definition.acceptance_focus ?? []).length > 0 ? 'passed' : 'needs_clarification';
  const verification = inferStoryContractVerification({ storyType, category, definition, codePaths, docs });
  const checks = [
    buildStoryContractCheck('story_type_fit', storyType === 'story_contract_review' ? 'inferred' : 'passed', `Story typeを ${storyType} と推定した。`, { story_type: storyType }),
    buildStoryContractCheck('source_role_integrity', sourceRole.status, sourceRole.reason, sourceRole.evidence),
    buildStoryContractCheck('business_intent', intentStatus, intentStatus === 'passed'
      ? 'who/problem/outcome が実装判断の枠組みとして利用できる。'
      : 'who/problem/outcome が十分に分離されていない。', summarizeStoryIntentEvidence(definition)),
    buildStoryContractCheck('developer_boundary', boundaryStatus, boundaryStatus === 'needs_clarification'
      ? 'コード、Spec、Architecture、診断、文書のいずれからも開発境界を置けない。'
      : inferDeveloperBoundaryReason({ sourceType, codePaths, docs, evidence }), {
      code_paths: codePaths.slice(0, 8),
      docs: docPathsList.slice(0, 8),
      inferred_evidence: evidence.filter((item) => typeof item === 'string').slice(0, 8)
    }),
    buildStoryContractCheck('acceptance_examples', acceptanceStatus, acceptanceStatus === 'passed'
      ? '受け入れ観点が利用できる。'
      : '受け入れ例が不足している。', {
      acceptance_focus: (definition.acceptance_focus ?? []).slice(0, 8)
    }),
    buildStoryContractCheck('verification_strategy', verification.status, verification.reason, {
      approach: verification.approach,
      required_evidence: verification.required_evidence
    })
  ];
  const openQuestions = checks
    .filter((check) => check.status === 'needs_clarification')
    .map((check) => storyContractQuestionForCheck(check, { id, title, category, storyType, repoProfile: defaults.repoProfile }));
  const status = checks.some((check) => check.status === 'needs_clarification') ? 'needs_clarification' : 'ready';
  return {
    schema_version: '0.1.0',
    story_type: storyType,
    status,
    checks,
    open_questions: dedupeStoryContractQuestions(openQuestions),
    developer_boundary_hypothesis: inferDeveloperBoundaryHypothesis({ codePaths, docs, evidence, sourceType }),
    risk_surface_hypothesis: inferStoryContractRiskSurface({
      category,
      storyType,
      businessContext,
      planning,
      sourceRole,
      codePaths
    }),
    verification_strategy: {
      status: verification.status,
      approach: verification.approach,
      required_evidence: verification.required_evidence
    }
  };
}

function buildStoryContractCheck(id, status, reason, evidence = {}) {
  return {
    id,
    status,
    reason,
    evidence
  };
}

function inferStoryContractType({ id, title, category, sourceType, diagnosisBased, codeDerived }) {
  const text = [id, title, category, sourceType].join(' ').toLowerCase();
  if (/regression|回帰|再発/.test(text)) return 'regression_fix';
  if (/bug|fix|failure|error|不具合|障害|失敗|修正/.test(text) || diagnosisBased) return 'bug_fix';
  if (/refactor|cleanup|整理|リファクタ/.test(text)) return 'refactor';
  if (category === 'architecture') return 'architecture_decision';
  if (category === 'docs') return 'docs_policy_change';
  if (category === 'security' || category === 'quality') return 'quality_hardening';
  if (category === 'ops') return 'operational_change';
  if (category === 'product' && codeDerived) return 'enhancement';
  if (category === 'product') return 'new_capability';
  return 'story_contract_review';
}

function evaluateStorySourceRoleIntegrity({ id, category, sourceType, paths, docs, codePaths, defaults }) {
  const repoProfile = defaults.repoProfile;
  const docOnly = docs.length > 0 && codePaths.length === 0;
  const productTemplate = category === 'product' && id.startsWith('story-product-');
  const productSurfaceApplicable = repoProfile?.product_surface_applicable === true;
  const presetExplicit = defaults.presetExplicit === true;
  const explicitProductEvidence = hasExplicitProductStoryEvidence(id, docs);
  if (productTemplate && docOnly && !productSurfaceApplicable && !presetExplicit && !explicitProductEvidence) {
    return {
      status: 'needs_clarification',
      reason: 'product surfaceではないrepoのdocument-only根拠は、ユーザー向けproduct storyではなく内部ツール仕様を指している可能性がある。',
      evidence: {
        repo_profile: repoProfile?.id ?? 'unknown',
        product_surface_applicable: productSurfaceApplicable,
        preset_explicit: presetExplicit,
        source_type: sourceType,
        paths: paths.slice(0, 8),
        doc_story_ids: uniqueList(docs.map((doc) => doc.story_id)).slice(0, 8)
      }
    };
  }
  if (productTemplate && docOnly && !productSurfaceApplicable) {
    return {
      status: 'inferred',
      reason: 'product surfaceではないrepoだが、文書の役割が明示されているためStory仮説として保持する。',
      evidence: {
        repo_profile: repoProfile?.id ?? 'unknown',
        product_surface_applicable: productSurfaceApplicable,
        preset_explicit: presetExplicit,
        explicit_product_evidence: explicitProductEvidence,
        paths: paths.slice(0, 8)
      }
    };
  }
  return {
    status: 'passed',
    reason: 'repo profile、明示preset、またはコード根拠とsource roleが整合している。',
    evidence: {
      repo_profile: repoProfile?.id ?? 'unknown',
      product_surface_applicable: productSurfaceApplicable,
      preset_explicit: presetExplicit,
      code_paths: codePaths.slice(0, 8),
      docs: docs.map((doc) => doc.path).slice(0, 8)
    }
  };
}

function hasExplicitProductStoryEvidence(storyId, docs) {
  return docs.some((doc) => {
    if (doc.story_id === storyId) return true;
    if (typeof doc.story_id === 'string' && doc.story_id.startsWith('story-product-')) return true;
    if (doc.path.startsWith('docs/user_stories/')) return true;
    if (doc.path.startsWith('docs/features/')) return true;
    if (doc.path.startsWith('docs/requirements/')) return true;
    return false;
  });
}

function hasStoryIntent(definition) {
  return [definition.who, definition.problem, definition.outcome]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .length >= 2;
}

function summarizeStoryIntentEvidence(definition) {
  return {
    has_who: Boolean(definition.who),
    has_problem: Boolean(definition.problem),
    has_want: Boolean(definition.want),
    has_outcome: Boolean(definition.outcome),
    has_business_value: Boolean(definition.business_value)
  };
}

function inferDeveloperBoundaryReason({ sourceType, codePaths, docs, evidence }) {
  if (codePaths.length > 0) return 'コードパスから実装境界を置ける。';
  if (docs.some((doc) => doc.path.startsWith('docs/specs/'))) return 'Spec文書から実装境界を置ける。';
  if (docs.some((doc) => doc.path.startsWith('docs/architecture/'))) return 'Architecture文書から実装境界を置ける。';
  if (docs.length > 0) return '関連文書から暫定的な境界を置ける。';
  if (evidence.length > 0) return 'Architecture profileまたは診断根拠から暫定的な境界を置ける。';
  return `${sourceType} から暫定的な境界を置く。`;
}

function inferDeveloperBoundaryHypothesis({ codePaths, docs, evidence, sourceType }) {
  if (codePaths.length > 0) {
    return {
      status: 'code_backed',
      summary: `実装境界は ${codePaths.slice(0, 3).join(', ')} から開始する。`,
      evidence_paths: codePaths.slice(0, 8)
    };
  }
  const specOrArchitecture = docs
    .filter((doc) => doc.path.startsWith('docs/specs/') || doc.path.startsWith('docs/architecture/'))
    .map((doc) => doc.path);
  if (specOrArchitecture.length > 0) {
    return {
      status: 'document_backed',
      summary: `境界は ${specOrArchitecture.slice(0, 3).join(', ')} から推定する。`,
      evidence_paths: specOrArchitecture.slice(0, 8)
    };
  }
  if (docs.length > 0) {
    return {
      status: 'story_or_feature_doc_backed',
      summary: `境界は ${docs.slice(0, 3).map((doc) => doc.path).join(', ')} から暫定推定する。`,
      evidence_paths: docs.map((doc) => doc.path).slice(0, 8)
    };
  }
  return {
    status: evidence.length > 0 ? 'inferred' : 'unknown',
    summary: evidence.length > 0
      ? `${sourceType} の根拠から境界を推定する。`
      : '開発境界はまだ置けない。',
    evidence_paths: evidence.filter((item) => typeof item === 'string').slice(0, 8)
  };
}

function inferStoryContractRiskSurface({ category, storyType, businessContext, planning, sourceRole, codePaths }) {
  if (sourceRole.status === 'needs_clarification') {
    return {
      level: 'high',
      summary: 'source roleの不一致により、内部ツール文書を誤ったproduct実装タスクへ変換する可能性がある。',
      drivers: ['source_role_integrity']
    };
  }
  if (category === 'security') {
    return {
      level: 'high',
      summary: 'Security境界Storyは前提が誤ると本番露出リスクにつながる。',
      drivers: ['security_boundary']
    };
  }
  if (storyType === 'bug_fix' || storyType === 'regression_fix') {
    return {
      level: 'medium',
      summary: '修正Storyには明確な失敗モードと回帰証跡が必要である。',
      drivers: [storyType]
    };
  }
  const businessGap = (planning.open_questions ?? []).some((item) => item.field === 'business_metric' || item.field === 'business_context');
  if (category === 'product' && businessGap) {
    return {
      level: 'medium',
      summary: 'product価値はあり得るが、成功指標またはビジネス文脈が明示されていない。',
      drivers: ['business_context', 'business_metric'].filter((field) => (planning.open_questions ?? []).some((item) => item.field === field))
    };
  }
  if (codePaths.length > 5) {
    return {
      level: 'medium',
      summary: '実装境界が複数ファイルに広がっており、分割可能性の確認が必要である。',
      drivers: ['code_scope']
    };
  }
  return {
    level: businessContext.signals?.length > 0 ? 'low' : 'medium',
    summary: businessContext.signals?.length > 0
      ? 'business signalとsource roleは計画に使える程度に整合している。'
      : 'business signalが薄いため、明示的な仮説として扱う。',
    drivers: businessContext.signals ?? []
  };
}

function inferStoryContractVerification({ storyType, category, definition, codePaths, docs }) {
  const acceptance = definition.acceptance_focus ?? [];
  if (acceptance.length === 0) {
    return {
      status: 'needs_clarification',
      reason: '受け入れ例がないため検証方法を選べない。',
      approach: '実装前に受け入れ例を定義する。',
      required_evidence: ['acceptance_examples']
    };
  }
  if (storyType === 'docs_policy_change') {
    return {
      status: 'inferred',
      reason: 'Documentation Storyはsource linkとreview evidenceで検証できる。',
      approach: 'Story/Spec/Architectureリンクを確認し、story map/planを再生成する。',
      required_evidence: ['story-map.md', 'story-plan.json']
    };
  }
  if (storyType === 'architecture_decision') {
    return {
      status: 'inferred',
      reason: 'Architecture StoryはUI実行よりもgraph/context reviewが重要である。',
      approach: 'graph/story planを実行し、影響境界をADRまたはArchitecture文書と照合する。',
      required_evidence: ['graphify', 'architecture_doc_or_adr']
    };
  }
  if (storyType === 'bug_fix' || storyType === 'regression_fix') {
    return {
      status: 'inferred',
      reason: '修正Storyには回帰観点の検証経路が必要である。',
      approach: '最小の回帰テストまたは再現確認と、影響ファイルの重点inspectionを行う。',
      required_evidence: ['regression_test_or_manual_repro', ...codePaths.slice(0, 3)]
    };
  }
  const hasSpec = docs.some((doc) => doc.path.startsWith('docs/specs/'));
  return {
    status: 'inferred',
    reason: hasSpec
      ? 'Specに紐づく受け入れ観点から検証を組み立てられる。'
      : '受け入れ観点はあるため、task planning時に検証方法を選べる。',
    approach: category === 'product'
      ? 'PR前に受け入れ観点をunit/integration/E2Eまたは明示的な手動証跡へ対応づける。'
      : 'PR前に受け入れ観点をCLI/test/inspection証跡へ対応づける。',
    required_evidence: hasSpec ? ['spec_acceptance_trace'] : ['acceptance_trace']
  };
}

function storyContractQuestionForCheck(check, context) {
  const field = {
    story_type_fit: 'story_contract_story_type',
    source_role_integrity: 'story_contract_source_role',
    business_intent: 'story_contract_business_intent',
    developer_boundary: 'story_contract_developer_boundary',
    acceptance_examples: 'story_contract_acceptance_examples',
    verification_strategy: 'story_contract_verification_strategy'
  }[check.id] ?? `story_contract_${check.id}`;
  const question = check.id === 'source_role_integrity'
    ? `このStoryの根拠は本当に ${context.storyType} として実装すべき要求か。repo profile:${context.repoProfile?.id ?? 'unknown'} で、内部ツール文書の語彙一致ではないことを確認する。`
    : `${context.title} のStory Contract check '${check.id}' が未解決: ${check.reason}`;
  return {
    field,
    question
  };
}

function dedupeStoryContractQuestions(questions) {
  const seen = new Set();
  const result = [];
  for (const question of questions) {
    const key = `${question.field}:${question.question}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(question);
  }
  return result;
}

function codeStoryDefinitionFor(storyId, paths, docs = [], preset = null) {
  const sourceSynthesis = [
    ...synthesizeSources(docs),
    ...synthesizeCodeSources(paths)
  ];
  const presetDefinition = preset?.storyDefinitions?.[storyId];
  if (presetDefinition) {
    return applyStoryDocDefinition({ ...presetDefinition, source_synthesis: sourceSynthesis }, docs, sourceSynthesis);
  }
  const definitions = {
    'story-product-auth-account-access': {
      who: 'サービスを継続利用したいユーザー',
      problem: '認証、アカウント切替、退会、OAuth連携が不安定だと、個人化や有料機能の前提が崩れる。',
      want: '安全にログインし、必要に応じてアカウント操作ができ、利用開始後の状態が保たれてほしい。',
      outcome: 'ユーザーが安心してアカウントを作成し、継続利用できる。',
      business_value: '継続利用、個人化、有料機能の土台。認証完了率や離脱率は未確認。',
      acceptance_focus: ['主要OAuthログインが動く', 'セッション同期とユーザー情報更新が一貫する', 'エラー、退会、アカウント切替の扱いが明確である'],
      source_synthesis: sourceSynthesis
    },
    'story-product-profile-personalization': {
      who: '自分向けの設定や体験を保ちたいユーザー',
      problem: 'プロフィールや設定が体験に反映されないと、表示、提案、通知が汎用的になり、自分向けの価値が弱くなる。',
      want: 'プロフィール、設定、利用目的が体験全体に反映されてほしい。',
      outcome: '主要画面や通知の文脈がユーザーごとに近づく。',
      business_value: '個人化による活性化と再訪向上が期待できる。具体KPIは未確認。',
      acceptance_focus: ['プロフィール編集が保存される', '保存情報が関連画面で使われる', '未入力やエラー時の体験が決まる'],
      source_synthesis: sourceSynthesis
    },
    'story-product-content-cms': {
      who: '公開コンテンツを運用したい担当者と、検索流入から来るユーザー',
      problem: 'コンテンツ運用と主要導線がつながっていないと、SEO流入を獲得しても登録、問い合わせ、購入などの行動へ接続できない。',
      want: '非エンジニアでも記事、特集、CTAを作成し、公開ページからプロダクト利用へ誘導したい。',
      outcome: '記事コンテンツが主要導線へ接続され、運用者が継続的に改善できる。',
      business_value: 'SEO流入、コンバージョン、コンテンツ運用効率の改善が期待できる。優先KPIは未確定。',
      acceptance_focus: ['記事内に主要CTAを配置できる', '非エンジニアがCMSで作成、編集、公開できる', 'SEOに必要なメタ情報と構造を持つ'],
      source_synthesis: sourceSynthesis
    },
    'story-product-public-discovery-seo': {
      who: '検索エンジンや公開ページから初めて訪れるユーザー',
      problem: '公開検索、記事、サイトマップ、構造化データが弱いと、アプリの価値がログイン前に伝わらず新規流入も取りこぼす。',
      want: '検索結果や公開ページから価値を理解し、自然に登録、問い合わせ、購入などの導線へ進みたい。',
      outcome: '未ログインユーザーがサービスの価値を理解し、次の行動へ進める。',
      business_value: 'SEO流入と新規獲得の土台。流入数、登録率、主要導線到達率は未確認。',
      acceptance_focus: ['公開ページが成立する', 'sitemapとrobotsが意図通り出る', '構造化データと記事導線が壊れない'],
      source_synthesis: sourceSynthesis
    },
    'story-product-waiting-list-contact': {
      who: '問い合わせや利用希望を伝えたいユーザーまたは事業者',
      problem: '問い合わせや待機リストの受け皿が弱いと、利用意向や連絡機会を失う。',
      want: '公開ページから迷わず問い合わせ、待機リスト登録、連絡ができてほしい。',
      outcome: 'プロダクト外部からの関心を運営が拾える。',
      business_value: 'リード獲得と顧客接点の維持。登録後の運用フローは未確認。',
      acceptance_focus: ['フォーム入力と送信が成立する', '送信後の状態が明確である', '運営側の受け取り先が定義される'],
      source_synthesis: sourceSynthesis
    },
    'story-product-qr-offline-access': {
      who: 'QRや通信状態が不安定な場面でもサービスにアクセスしたいユーザー',
      problem: 'QR読み取りやオフライン時の案内が弱いと、外部接点や再訪のタイミングで利用が途切れる。',
      want: 'QRから必要な情報へ進み、通信が不安定でも状態が分かる案内を受けたい。',
      outcome: 'オンライン外の接点でもサービス利用を継続しやすくなる。',
      business_value: '外部接点、再訪、PWA的利用の下支え。利用場面とKPIは未確認。',
      acceptance_focus: ['QR読み取りの成功・失敗状態がある', 'オフライン時の導線がある', '更新通知がユーザー操作を妨げない'],
      source_synthesis: sourceSynthesis
    },
    'story-product-app-navigation-shell': {
      who: 'サービスの主要機能を行き来するユーザー',
      problem: 'ホーム、ナビゲーション、共通レイアウトがStoryに紐づかないと、ユーザーがどこから主要機能へ進むのかを引き継げない。',
      want: 'アプリの起点と主要導線が一貫し、画面間を迷わず移動できてほしい。',
      outcome: 'ユーザーがログイン後に目的の機能へ自然に進める。',
      business_value: '初回活性化、再訪、主要機能への到達率を支える。具体KPIは未確認。',
      acceptance_focus: ['ホームから主要機能へ到達できる', '下部ナビとレイアウトが画面状態に応じて破綻しない', 'ログイン状態やプラン状態と導線が矛盾しない'],
      source_synthesis: sourceSynthesis
    },
    'story-ops-observability-health': {
      who: '本番稼働を確認する運用者と開発チーム',
      problem: 'health、heartbeat、ログ確認の入口があっても運用Storyがないと、障害時に何を見るべきか分からない。',
      want: '稼働確認とログ確認の入口を運用手順に接続したい。',
      outcome: '本番状態の確認と初動判断がしやすくなる。',
      business_value: '障害検知と復旧時間短縮につながる。監視基準は未確認。',
      acceptance_focus: ['health/heartbeatの意味が定義される', 'ログ確認権限が整理される', '異常時の次アクションが残る'],
      source_synthesis: sourceSynthesis
    },
    'story-product-legal-trust-pages': {
      who: '利用前にサービスの条件や安全性を確認したいユーザー',
      problem: '規約、プライバシー、特商法、ガイドラインが整っていないと、公開サービスとしての信頼や法務確認が弱くなる。',
      want: '利用前に必要な条件、個人情報の扱い、禁止事項を確認したい。',
      outcome: 'ユーザーと運営の前提が明確になり、公開利用に耐えやすくなる。',
      business_value: '公開サービスとしての信頼とリスク低減。法務レビュー状態は未確認。',
      acceptance_focus: ['各公開ページが到達可能である', '内容の正本と更新責任が決まる', '主要導線から確認できる'],
      source_synthesis: sourceSynthesis
    }
  };
  return applyStoryDocDefinition(definitions[storyId] ?? storyDefinitionFor('unknown', docs, preset), docs, sourceSynthesis);
}

function storyDefinitionFor(storyId, docs = [], preset = null) {
  const sourceSynthesis = synthesizeSources(docs);
  const presetDefinition = preset?.storyDefinitions?.[storyId];
  if (presetDefinition) {
    return applyStoryDocDefinition({ ...presetDefinition, source_synthesis: sourceSynthesis }, docs, sourceSynthesis);
  }
  const definitions = {
    'story-product-auth-account-access': {
      who: 'サービスを継続利用したいユーザー',
      problem: '認証、アカウント切替、退会、OAuth連携が不安定だと、個人化や有料機能の前提が崩れる。',
      want: '安全にログインし、必要に応じてアカウント操作ができ、利用開始後の状態が保たれてほしい。',
      outcome: 'ユーザーが安心してアカウントを作成し、継続利用できる。',
      business_value: '継続利用、個人化、有料機能の土台。認証完了率や離脱率は未確認。',
      acceptance_focus: [
        '主要ログイン導線が動く',
        'セッション同期とユーザー情報更新が一貫する',
        'エラー、退会、アカウント切替の扱いが明確である'
      ],
      source_synthesis: sourceSynthesis
    },
    'story-product-profile-personalization': {
      who: '自分向けの設定や体験を保ちたいユーザー',
      problem: 'プロフィールや設定が体験に反映されないと、表示、提案、通知が汎用的になり、自分向けの価値が弱くなる。',
      want: 'プロフィール、設定、利用目的が体験全体に反映されてほしい。',
      outcome: '主要画面や通知の文脈がユーザーごとに近づく。',
      business_value: '個人化による活性化と再訪向上が期待できる。具体KPIは未確認。',
      acceptance_focus: [
        'プロフィール編集が保存される',
        '保存情報が関連画面で使われる',
        '未入力やエラー時の体験が決まる'
      ],
      source_synthesis: sourceSynthesis
    },
    'story-product-premium-billing': {
      who: 'プレミアム機能を利用したいユーザーと運営者',
      problem: '課金、プラン変更、webhook反映が不安定だと、使えるはずの機能が使えない、または使えてはいけない機能が使える状態になる。',
      want: 'Stripeを通じて加入、解約、ダウングレードが正しく反映され、機能権限と請求状態が一致してほしい。',
      outcome: '有料機能の提供状態と請求状態が同期し、ユーザーと運営の双方が安心して運用できる。',
      business_value: 'プレミアム収益の土台。MRR、解約率、決済失敗率は別途定義が必要。',
      acceptance_focus: [
        'Checkout完了後にプレミアム権限が付与される',
        'webhookで加入、解約、ダウングレードが反映される',
        '権限と請求状態の不整合が検知できる',
        '決済失敗時のユーザー体験が定義される'
      ],
      source_synthesis: sourceSynthesis
    },
    'story-product-content-cms': {
      who: '公開コンテンツを運用したい担当者と、検索流入から来るユーザー',
      problem: 'コンテンツ運用と主要導線がつながっていないと、SEO流入を獲得しても登録、問い合わせ、購入などの行動へ接続できない。',
      want: '非エンジニアでも記事、特集、CTAを作成し、公開ページからプロダクト利用へ誘導したい。',
      outcome: '記事コンテンツが主要導線へ接続され、運用者が継続的に改善できる。',
      business_value: 'SEO流入、コンバージョン、コンテンツ運用効率の改善が期待できる。優先KPIは未確定。',
      acceptance_focus: [
        '記事内に主要CTAを配置できる',
        '非エンジニアがCMSで作成、編集、公開できる',
        'SEOに必要なメタ情報と構造を持つ',
        '記事から主要導線へ遷移できる'
      ],
      source_synthesis: sourceSynthesis
    },
    'story-product-onboarding': {
      who: '初めてサービスを使うユーザー',
      problem: '利用目的や初期設定が分からないままだと、初回体験で自分向けの価値を感じにくい。',
      want: '初回利用時に必要な情報を短く入力し、次に使うべき機能へ進めてほしい。',
      outcome: 'ユーザーが最初から価値のある導線へ近づけ、継続利用の理由が生まれる。',
      business_value: '初回活性化と個人化精度の改善が期待できる。オンボーディング完了率と初回主要導線到達率は確認が必要。',
      acceptance_focus: [
        '目的や初期設定など必要最小限の情報を取得する',
        '取得した情報が主要導線に反映される',
        '途中離脱しても再開できる',
        '入力負荷が高すぎない'
      ],
      source_synthesis: sourceSynthesis
    },
    'story-product-notification': {
      who: '重要な更新を逃したくないユーザー',
      problem: '重要な更新、問い合わせ、ステータス変化が分散すると、ユーザーが必要なタイミングで戻ってこられない。',
      want: '必要な通知をアプリ、メール、Pushなど適切な経路で受け取り、設定も管理したい。',
      outcome: '重要な更新が届き、ユーザーが利用を再開しやすくなる。',
      business_value: '再訪、継続利用、主要導線への復帰が期待できる。通知許諾率と再訪率は確認が必要。',
      acceptance_focus: [
        '通知対象イベントが整理されている',
        'ユーザーが通知設定を管理できる',
        '未読、既読、再通知の扱いが定義されている',
        '過剰通知を避ける制御がある'
      ],
      source_synthesis: sourceSynthesis
    },
    'story-architecture-api-surface': {
      who: '開発チームとレビュアー',
      problem: 'API公開面と実行境界が曖昧だと、どのrouteが外部入力を受け、どこで保護されるべきか判断しづらい。',
      want: 'entrypoint、server boundary、公開APIを把握し、実装とレビューの単位を揃えたい。',
      outcome: 'API変更の影響範囲と保護責務が追跡できる。',
      business_value: '機能追加速度を落とさず、本番事故やレビュー漏れを減らす。',
      acceptance_focus: ['公開API一覧が把握できる', 'routeごとの責務と保護境界が説明できる', '診断Findingと修正タスクがつながる'],
      source_synthesis: sourceSynthesis
    },
    'story-architecture-data-access': {
      who: '開発チーム',
      problem: 'データモデルとアクセス経路が散らばると、機能追加時に整合性や権限の見落としが起きやすい。',
      want: '永続化境界、主要モデル、アクセスパターンをStory単位で見える化したい。',
      outcome: 'データ変更の影響範囲を判断しやすくなる。',
      business_value: '機能追加時の手戻りとデータ不整合リスクを減らす。',
      acceptance_focus: ['主要storeとaccess patternが整理される', '重要モデルの利用箇所が追跡できる', '権限とデータアクセスの接点が見える'],
      source_synthesis: sourceSynthesis
    },
    'story-security-auth-boundary': {
      who: 'ユーザー情報や有料機能を扱う開発チーム',
      problem: '認証境界が曖昧だと、本人だけが見られるべき情報や有料機能の保護が崩れる。',
      want: '認証方式、保護対象、例外を明確にしたい。',
      outcome: 'ユーザー境界を前提に実装とレビューができる。',
      business_value: '信頼性と課金機能の正当性を守る。',
      acceptance_focus: ['保護対象routeが識別される', '認証なしで触れるrouteの理由が説明できる', '権限チェックの根拠が残る'],
      source_synthesis: sourceSynthesis
    },
    'story-security-api-trust-boundary': {
      who: '外部連携や管理APIを扱う開発チーム',
      problem: 'webhook、debug、test、admin系APIの信頼境界が弱いと、本番で不正実行や情報漏えいが起きうる。',
      want: 'APIごとの信頼境界、認証、実行可否を診断結果から修正可能な形にしたい。',
      outcome: '本番に出してよいAPIと修正が必要なAPIを区別できる。',
      business_value: '外部連携を使う機能の安全性を上げ、公開前のリスクを減らす。',
      acceptance_focus: ['未保護APIの分類がある', 'webhook検証の有無が分かる', 'debug/test routeの公開可否が判断できる'],
      source_synthesis: sourceSynthesis
    },
    'story-ops-deployment-runtime': {
      who: '運用担当と開発チーム',
      problem: 'デプロイ先、環境変数、実行プロセスが不明確だと、機能は作れても安定運用に移れない。',
      want: '実行基盤とデプロイ条件をStoryとして管理したい。',
      outcome: 'リリース前に運用上の不足を確認できる。',
      business_value: '本番反映の失敗と復旧コストを減らす。',
      acceptance_focus: ['デプロイ対象が分かる', '環境変数とsecretの扱いが整理される', '運用時の確認手順が残る'],
      source_synthesis: sourceSynthesis
    },
    'story-quality-test-ci-readiness': {
      who: '開発チームとレビュアー',
      problem: 'テストとCIがStoryの受け入れ基準に接続していないと、PRで何を担保したか説明できない。',
      want: 'Unit、Integration、E2EのGateをStoryの受け入れ基準から追跡したい。',
      outcome: '実装完了の判断がテスト証跡と結びつく。',
      business_value: 'レビュー品質を上げ、回帰バグを減らす。',
      acceptance_focus: ['受け入れ基準とテストGateが対応する', 'Playwrightが必要な箇所を判定できる', 'CIで見るべきコマンドが分かる'],
      source_synthesis: sourceSynthesis
    },
    'story-docs-story-ssot-recovery': {
      who: 'プロダクト判断を引き継ぐメンバー',
      problem: '仕様書、要求、User Storyが分散し、Storyの正本構造が見えないと、次に何を作るべきか判断できない。',
      want: '仕様書をそのままStoryにせず、Story、根拠文書、不明点を分けて管理したい。',
      outcome: 'Story Mapから全体の開発意図と不足情報が読める。',
      business_value: '引き継ぎ、優先順位付け、NocoDB同期の品質を上げる。',
      acceptance_focus: ['Storyと仕様書が1対1になっていない', '複数文書がStoryの根拠として紐づく', 'periodやKPIの不明点が明示される'],
      source_synthesis: sourceSynthesis
    }
  };
  const fallback = {
    who: '関係者',
    problem: '対象Storyの課題が文書から十分に特定できていない。',
    want: '根拠文書を読み直して、利用者、課題、成果を分けて定義したい。',
    outcome: '実装対象が仕様書名ではなく価値単位で判断できる。',
    business_value: '価値と検証観点の不明確さを減らす。',
    acceptance_focus: ['利用者が明確である', '成果が明確である', '根拠文書と不明点が分かれている'],
    source_synthesis: sourceSynthesis
  };
  return applyStoryDocDefinition(definitions[storyId] ?? fallback, docs, sourceSynthesis);
}

function normalizeStoryDefinition(definition, docs) {
  const fallback = storyDefinitionFor('unknown', docs);
  const normalized = definition ?? fallback;
  return {
    who: normalized.who ?? fallback.who,
    problem: normalized.problem ?? fallback.problem,
    want: normalized.want ?? fallback.want,
    outcome: normalized.outcome ?? fallback.outcome,
    business_value: normalized.business_value ?? fallback.business_value,
    acceptance_focus: Array.isArray(normalized.acceptance_focus) ? normalized.acceptance_focus : fallback.acceptance_focus,
    source_synthesis: Array.isArray(normalized.source_synthesis) ? normalized.source_synthesis : synthesizeSources(docs)
  };
}

function applyStoryDocDefinition(baseDefinition, docs, sourceSynthesis) {
  const storyDocDefinition = docs
    .map((doc) => doc.story_definition)
    .find((definition) => definition && Object.values(definition).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)));
  if (!storyDocDefinition) return baseDefinition;
  return {
    ...baseDefinition,
    ...Object.fromEntries(Object.entries(storyDocDefinition)
      .filter(([, value]) => !Array.isArray(value) && Boolean(value))),
    acceptance_focus: storyDocDefinition.acceptance_focus?.length > 0
      ? storyDocDefinition.acceptance_focus
      : baseDefinition.acceptance_focus,
    source_synthesis: sourceSynthesis
  };
}

function buildStoryMeaning({
  id,
  category,
  sourceType,
  paths,
  evidence,
  docs,
  relatedFindings,
  definition,
  planning,
  businessContext,
  openQuestions,
  diagnosisBased,
  codeDerived,
  preset
}) {
  const confidence = inferMeaningConfidence({ docs, paths, businessContext, openQuestions, diagnosisBased });
  const workflow = workflowPositionFor(id, preset);
  const codePaths = paths.filter((item) => isCodePath(item, preset));
  return {
    value_hypothesis: `${definition.outcome} ${definition.business_value}`,
    user_actor: {
      value: definition.who,
      confidence: docs.length > 0 ? 'high' : codeDerived ? 'medium' : 'low',
      evidence: meaningEvidencePaths({ docs, paths, relatedFindings }).slice(0, 5)
    },
    business_goal: {
      value: definition.business_value,
      confidence: businessContext.signals.length > 0 ? 'high' : category === 'product' ? 'low' : 'medium',
      evidence: businessContext.evidence_paths,
      missing: openQuestions.find((item) => item.field === 'business_metric')?.question ?? null
    },
    code_scope: {
      value: summarizeCodeScope(paths, sourceType, preset),
      confidence: codePaths.length > 0 ? 'high' : sourceType === 'architecture_profile' ? 'medium' : 'low',
      evidence: codePaths.slice(0, 8)
    },
    workflow_position: workflow,
    evidence_by_type: {
      docs_evidence: docs.map((doc) => doc.path),
      code_evidence: paths.filter((item) => isCodePath(item, preset)),
      diagnosis_evidence: relatedFindings,
      inferred_evidence: evidence.filter((item) => typeof item === 'string' && !isCodePath(item, preset) && !item.startsWith('docs/')).slice(0, 8),
      missing_evidence: openQuestions.map((item) => ({ field: item.field, question: item.question }))
    },
    counter_evidence: buildCounterEvidence({ docs, paths, openQuestions, planning, codeDerived }),
    confidence
  };
}

function inferMeaningConfidence({ docs, paths, businessContext, openQuestions, diagnosisBased }) {
  const hasMissingSpec = openQuestions.some((item) => item.field === 'missing_spec');
  const hasBusinessGap = openQuestions.some((item) => item.field === 'business_context' || item.field === 'business_metric');
  if (diagnosisBased) return 'medium';
  if (docs.length > 0 && businessContext.signals.length > 0 && !hasBusinessGap) return 'high';
  if (docs.length > 0 || paths.length > 0) return hasMissingSpec || hasBusinessGap ? 'medium' : 'high';
  return 'low';
}

function meaningEvidencePaths({ docs, paths, relatedFindings }) {
  return [
    ...docs.map((doc) => doc.path),
    ...paths,
    ...relatedFindings.map((id) => `finding:${id}`)
  ].filter(Boolean);
}

function summarizeCodeScope(paths, sourceType, preset) {
  if (paths.length === 0) return sourceType === 'architecture_profile' ? 'architecture profileから推定' : '直接のコード根拠なし';
  const roles = [...new Set(paths.filter((item) => isCodePath(item, preset)).map(inferCodeRole))];
  return roles.length > 0 ? roles.join('、') : '直接のコード根拠なし';
}

function buildCounterEvidence({ docs, paths, openQuestions, planning, codeDerived }) {
  const items = [];
  if (codeDerived && docs.length === 0) {
    items.push('仕様書、要求、既存Storyではなくコードからの逆算である。');
  }
  if (paths.length === 0) {
    items.push('Storyに直接紐づくコード根拠がまだ少ない。');
  }
  if (openQuestions.some((item) => item.field === 'business_metric')) {
    items.push('KPIまたは効果測定指標が未確認である。');
  }
  if (!planning.period) {
    items.push('NocoDB Periodとして確定できる実行期が未確認である。');
  }
  return items;
}

function workflowPositionFor(storyId, preset = null) {
  if (preset?.workflowPositions?.[storyId]) return preset.workflowPositions[storyId];
  const positions = {
    'story-product-app-navigation-shell': {
      stage: 'entry',
      before: [],
      after: ['story-product-auth-account-access', 'story-product-onboarding', 'story-product-profile-personalization'],
      confidence: 'medium',
      rationale: 'ホームと共通ナビはログイン後の主要機能への入口になるため'
    },
    'story-product-public-discovery-seo': {
      stage: 'acquisition',
      before: [],
      after: ['story-product-content-cms', 'story-product-auth-account-access'],
      confidence: 'medium',
      rationale: '公開検索、記事、SEOは未ログイン流入からアプリ利用へ接続するため'
    },
    'story-product-content-cms': {
      stage: 'acquisition',
      before: ['story-product-public-discovery-seo'],
      after: ['story-product-auth-account-access'],
      confidence: 'medium',
      rationale: '記事とCMSは公開流入を主要な利用開始導線へ送るため'
    },
    'story-product-auth-account-access': {
      stage: 'activation',
      before: ['story-product-public-discovery-seo', 'story-product-app-navigation-shell'],
      after: ['story-product-onboarding', 'story-product-premium-billing', 'story-product-profile-personalization'],
      confidence: 'medium',
      rationale: '認証は個人化、課金、継続利用の前提になるため'
    },
    'story-product-onboarding': {
      stage: 'activation',
      before: ['story-product-auth-account-access'],
      after: ['story-product-profile-personalization'],
      confidence: 'medium',
      rationale: '初回入力はプロフィールと主要導線の材料になるため'
    },
    'story-product-profile-personalization': {
      stage: 'personalization',
      before: ['story-product-auth-account-access', 'story-product-onboarding'],
      after: ['story-product-notification'],
      confidence: 'medium',
      rationale: '保存された設定は表示や通知の文脈になるため'
    },
    'story-product-premium-billing': {
      stage: 'monetization',
      before: ['story-product-auth-account-access'],
      after: ['story-product-notification'],
      confidence: 'medium',
      rationale: '課金状態は有料機能の利用可否を決めるため'
    },
    'story-product-notification': {
      stage: 'retention',
      before: ['story-product-profile-personalization', 'story-product-premium-billing'],
      after: [],
      confidence: 'medium',
      rationale: '通知は重要な更新確認や再訪を促すため'
    }
  };
  return positions[storyId] ?? {
    stage: defaultWorkflowStage(storyId),
    before: [],
    after: [],
    confidence: 'low',
    rationale: 'Story間の前後関係はコードと文書だけでは十分に確定できないため'
  };
}

function defaultWorkflowStage(storyId) {
  if (storyId.startsWith('story-architecture-')) return 'architecture';
  if (storyId.startsWith('story-security-')) return 'risk_control';
  if (storyId.startsWith('story-ops-')) return 'operations';
  if (storyId.startsWith('story-quality-')) return 'quality_gate';
  if (storyId.startsWith('story-docs-')) return 'knowledge_recovery';
  return 'unknown';
}

function synthesizeSources(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return [];
  return docs.slice(0, 6).map((doc) => ({
    path: doc.path,
    role: inferDocumentRole(doc),
    title: doc.title
  }));
}

function inferDocumentRole(doc) {
  if (doc.path.startsWith('docs/management/stories/')) return 'Story正本';
  if (doc.path.startsWith('docs/user_stories/')) return 'ユーザー課題と受け入れ観点';
  if (doc.path.startsWith('docs/requirements/')) return '機能要求と制約';
  if (doc.path.startsWith('docs/features/')) return '機能構想とビジネス背景';
  if (doc.path.startsWith('docs/architecture/')) return '設計判断と構造';
  return '補助根拠';
}

function synthesizeCodeSources(paths) {
  return [...paths]
    .sort((a, b) => rankCodePath(a) - rankCodePath(b) || a.localeCompare(b))
    .slice(0, 8)
    .map((filePath) => ({
    path: filePath,
    role: inferCodeRole(filePath),
    title: humanizeFileName(filePath)
  }));
}

function rankStoryCodePath(storyId, filePath) {
  const storySpecificRank = {
    'story-product-auth-account-access': [
      [/^src\/lib\/auth\//, -10],
      [/^src\/app\/api\/auth\//, -9],
      [/sign-in|nextauth|session|userSync|providers/, -8],
      [/account-deleted|error\/page|layout\.tsx$/, 20]
    ],
    'story-product-profile-personalization': [
      [/profileService|profile_action|profile\/page|ProfileHeader|ProfileInfo/, -10]
    ],
    'story-product-content-cms': [
      [/article|cms|sanity|content/, -10]
    ],
    'story-product-premium-billing': [
      [/stripe|checkout|premium|subscription|billing/, -10]
    ],
    'story-product-notification': [
      [/notification|push|email/, -10]
    ],
    'story-product-onboarding': [
      [/onboarding|profile-step|preferences-step/, -10]
    ],
    'story-product-public-discovery-seo': [
      [/articles\/\[slug\]\/page|sitemap|robots|StructuredData|analytics/, -10],
      [/landing/, -6]
    ]
  };
  const adjustment = (storySpecificRank[storyId] ?? [])
    .filter(([pattern]) => pattern.test(filePath))
    .reduce((min, [, value]) => Math.min(min, value), 0);
  return rankCodePath(filePath) + adjustment;
}

function rankCodePath(filePath) {
  if (/\.(test|spec)\.[jt]sx?$/.test(filePath)) return 200;
  if (/\/types\/|\.types\.|\/index\.[jt]s$|\/constants\//.test(filePath)) return 80;
  if (/\/(error|loading|not-found|layout)\.[jt]sx?$/.test(filePath)) return 70;
  if (/^src\/lib\/services\//.test(filePath)) return 0;
  if (/^src\/lib\/auth/.test(filePath)) return 2;
  if (/^src\/lib\/actions\//.test(filePath)) return 4;
  if (/^src\/app\/api\/.+\/route\.[jt]s$/.test(filePath)) return 6;
  if (/^src\/app\/.+\/page\.[jt]sx?$/.test(filePath)) return 8;
  if (/^src\/app\/.+\/client\.[jt]sx?$/.test(filePath)) return 10;
  if (/^src\/app\/.+\/_components\//.test(filePath)) return 12;
  if (/^src\/components\//.test(filePath)) return 14;
  if (/^src\/lib\/crawlers\//.test(filePath)) return 16;
  if (/^src\/lib\/api\//.test(filePath)) return 18;
  if (/^src\/lib\//.test(filePath)) return 20;
  return 50;
}

function inferCodeRole(filePath) {
  if (filePath.startsWith('src/app/') && filePath.includes('/api/')) return 'API route';
  if (filePath.startsWith('src/app/')) return '画面・ルーティング';
  if (filePath.startsWith('src/components/')) return 'UIコンポーネント';
  if (filePath.startsWith('src/lib/actions/')) return 'ユーザー操作・サーバーアクション';
  if (filePath.startsWith('src/lib/crawlers/')) return 'データ収集処理';
  if (filePath.startsWith('src/lib/auth')) return '認証・セッション処理';
  if (filePath.startsWith('src/lib/')) return 'ドメインロジック';
  return 'コード根拠';
}

async function collectRepoFiles(repoRoot) {
  const pending = [''];
  const files = [];
  while (pending.length > 0) {
    const currentRelative = pending.pop();
    const dir = path.join(repoRoot, currentRelative);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const relativePath = path.posix.join(currentRelative.split(path.sep).join('/'), entry.name);
      const fullPath = path.join(repoRoot, relativePath);
      if (entry.isDirectory()) {
        pending.push(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const fileStat = await stat(fullPath);
      files.push({ relativePath, size: fileStat.size });
    }
  }
  return files;
}

async function collectDocumentSignals(repoRoot, files, preset) {
  const groups = preset?.documentSignalGroups ?? [];
  const signals = {};
  const byStoryId = {};
  const docFiles = files
    .map((file) => file.relativePath)
    .filter((file) => file.endsWith('.md') && file.startsWith('docs/') && !/dummy|template/i.test(file));
  for (const filePath of docFiles) {
    const doc = await analyzeDocument(repoRoot, filePath);
    if (doc.story_id) {
      byStoryId[doc.story_id] = [...(byStoryId[doc.story_id] ?? []), doc];
    }
    for (const group of groups) {
      if (!group.pattern.test(filePath)) continue;
      signals[group.key] = [...(signals[group.key] ?? []), doc];
    }
  }
  const normalized = Object.fromEntries(Object.entries(signals).map(([key, values]) => [key, dedupeDocs(values)]));
  normalized._byStoryId = Object.fromEntries(Object.entries(byStoryId).map(([storyId, values]) => [storyId, dedupeDocs(values)]));
  return normalized;
}

async function analyzeDocument(repoRoot, relativePath) {
  const content = await readFile(path.join(repoRoot, relativePath), 'utf8');
  const frontMatter = parseFrontMatter(content);
  const title = frontMatter.title ?? extractMarkdownTitle(content) ?? humanizeFileName(relativePath);
  return {
    path: relativePath,
    story_id: frontMatter.story_id ?? null,
    title,
    status: frontMatter.status ?? null,
    view: frontMatter.view ?? null,
    horizon: frontMatter.horizon ?? null,
    period: frontMatter.period ?? null,
    has_period: Object.prototype.hasOwnProperty.call(frontMatter, 'period'),
    priority: frontMatter.priority ?? null,
    points: frontMatter.points ?? null,
    created_at: frontMatter.created_at ?? null,
    updated_at: frontMatter.updated_at ?? null,
    story_definition: relativePath.startsWith('docs/management/stories/')
      ? parseStoryDocumentDefinition(content)
      : null,
    business_signals: extractBusinessSignals(content),
    timeline_signals: extractTimelineSignals(content),
    has_acceptance_criteria: /受け入れ基準|Acceptance Criteria/i.test(content),
    has_kpi: /KPI|成功指標|期待効果|効果|コンバージョン|SEO|収益|売上/.test(content)
  };
}

function inferPlanning({ category, docs, defaults, diagnosisBased, codeDerived }) {
  const businessContext = summarizeBusinessContext(docs, codeDerived);
  const storyDocPlanning = findStoryDocPlanning(docs);
  const viewPrediction = inferView(category, businessContext, storyDocPlanning);
  const horizonPrediction = inferHorizon(category, diagnosisBased, storyDocPlanning);
  const periodPrediction = inferPeriod({ horizon: horizonPrediction.value, docs, defaults, diagnosisBased, storyDocPlanning });
  const openQuestions = [];

  if (!periodPrediction.value) {
    openQuestions.push({
      field: 'period',
      question: codeDerived
        ? `NocoDB Period に置く実行期がコードから確定できない。候補は ${periodPrediction.candidate ?? '-'}。`
        : `NocoDB Period に置く実行期が仕様書から確定できない。候補は ${periodPrediction.candidate ?? '-'}。`
    });
  }
  if (codeDerived && docs.length === 0) {
    openQuestions.push({
      field: 'missing_spec',
      question: 'コード上は機能面が確認できるが、対応するStory、要求、仕様書が見つからない。'
    });
  }
  if (category === 'product' && businessContext.signals.length === 0) {
    openQuestions.push({
      field: 'business_context',
      question: codeDerived
        ? 'biz視点の成功指標、顧客価値、優先順位がコードからは十分に読めない。'
        : 'biz視点の成功指標、顧客価値、優先順位が仕様書本文から十分に読めない。'
    });
  }
  if (category === 'product' && !docs.some((doc) => doc.has_kpi)) {
    openQuestions.push({
      field: 'business_metric',
      question: codeDerived
        ? 'KPIまたは効果測定指標がコードからは確定できない。'
        : 'KPIまたは効果測定指標が仕様書から確定できない。'
    });
  }

  return {
    view: viewPrediction.value,
    horizon: horizonPrediction.value,
    period: periodPrediction.value,
    started_at: periodPrediction.value ? defaults.started_at : null,
    due_at: null,
    predictions: {
      view: viewPrediction,
      horizon: horizonPrediction,
      period: periodPrediction
    },
    open_questions: openQuestions
  };
}

function inferView(category, businessContext, storyDocPlanning = {}) {
  if (storyDocPlanning.view) {
    return {
      value: storyDocPlanning.view,
      confidence: 'high',
      rationale: 'Story正本frontmatterのviewを優先するため'
    };
  }
  if (category === 'product') {
    return {
      value: 'business',
      confidence: businessContext.signals.length > 0 ? 'high' : 'medium',
      rationale: businessContext.signals.length > 0
        ? `仕様書から ${businessContext.signals.slice(0, 3).join(', ')} が読めるため`
        : 'ユーザー体験Storyだがbiz効果は未確定のため'
    };
  }
  return {
    value: 'dev',
    confidence: 'high',
    rationale: `${category} は開発・運用品質の管理ビューで扱うため`
  };
}

function inferHorizon(category, diagnosisBased, storyDocPlanning = {}) {
  if (storyDocPlanning.horizon) {
    return {
      value: storyDocPlanning.horizon,
      confidence: 'high',
      rationale: 'Story正本frontmatterのhorizonを優先するため'
    };
  }
  if (diagnosisBased) {
    return { value: 'sprint', confidence: 'medium', rationale: '診断Finding由来で短期修正候補のため' };
  }
  if (category === 'product') {
    return { value: 'quarter', confidence: 'medium', rationale: '仕様書本文は機能価値の塊で、週次タスクではなく四半期テーマに近いため' };
  }
  return { value: 'month', confidence: 'medium', rationale: '開発基盤・設計整理のStoryとして月次管理が妥当なため' };
}

function inferPeriod({ horizon, docs, defaults, diagnosisBased, storyDocPlanning = {} }) {
  if (storyDocPlanning.hasPeriod && storyDocPlanning.period) {
    return {
      value: storyDocPlanning.period,
      candidate: storyDocPlanning.period,
      confidence: 'high',
      rationale: 'Story正本frontmatterのperiodを優先するため'
    };
  }
  if (storyDocPlanning.hasPeriod && !storyDocPlanning.period) {
    return {
      value: null,
      candidate: null,
      confidence: 'unknown',
      rationale: 'Story正本frontmatterでperiodが未定義のため'
    };
  }
  if (diagnosisBased && defaults.period) {
    return {
      value: defaults.period,
      candidate: defaults.period,
      confidence: 'medium',
      rationale: '診断runに紐づく現在のStory periodを引き継ぐため'
    };
  }
  const explicitPeriod = findExplicitManagementPeriod(docs);
  if (explicitPeriod) {
    return {
      value: explicitPeriod,
      candidate: explicitPeriod,
      confidence: 'high',
      rationale: '仕様書本文に管理期間らしき記述があるため'
    };
  }
  return {
    value: null,
    candidate: horizon === 'quarter' ? currentQuarter() : horizon === 'month' ? currentMonth() : defaults.period,
    confidence: 'unknown',
    rationale: '作成日・実装完了日は読めるが、NocoDB Periodとして確定できる計画期間は仕様書から読めないため'
  };
}

function summarizeBusinessContext(docs, codeDerived = false) {
  const signals = [...new Set(docs.flatMap((doc) => doc.business_signals ?? []))];
  return {
    signals,
    source: codeDerived ? 'code_surface' : 'documents',
    evidence_paths: docs
      .filter((doc) => (doc.business_signals ?? []).length > 0)
      .map((doc) => doc.path)
      .slice(0, 5)
  };
}

function extractBusinessSignals(content) {
  const signals = [];
  const checks = [
    [/SEO|オーガニック検索|検索流入/, 'SEO流入'],
    [/コンバージョン|CVR/i, 'コンバージョン'],
    [/収益|月額|課金|サブスクリプション|プレミアム|売上/, '収益化'],
    [/効率|効率化|意思決定|選択できる|視覚的に把握/, 'ユーザー効率'],
    [/パーソナライズ|嗜好|マッチング|個人化/, '個人化'],
    [/通知|再訪|既読|メール|Push|プッシュ/, '継続利用'],
    [/非エンジニア|運用効率|コンテンツ作成/, '運用効率']
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(content)) signals.push(label);
  }
  return signals;
}

function parseStoryDocumentDefinition(content) {
  const body = stripFrontMatter(content);
  const sections = extractMarkdownSections(body);
  const labeled = extractLabeledStoryFields(body);
  const userStory = extractUserStoryFields(body);
  const sectionValue = (...keys) => firstText(keys.map((key) => sections[key]));
  const acceptanceSection = sectionValue('acceptance', 'completion');
  return {
    who: labeled.who ?? userStory.who ?? sectionValue('who'),
    problem: labeled.problem ?? sectionValue('problem', 'background'),
    want: labeled.want ?? userStory.want ?? sectionValue('want'),
    outcome: labeled.outcome ?? userStory.outcome ?? sectionValue('outcome'),
    business_value: labeled.business_value ?? userStory.business_value ?? sectionValue('business_value'),
    acceptance_focus: labeled.acceptance_focus?.length > 0
      ? labeled.acceptance_focus
      : extractBulletItems(acceptanceSection)
  };
}

function extractUserStoryFields(content) {
  const asA = matchStoryLine(content, /(?:\*\*)?As a(?:\*\*)?\s+(.+)/i);
  const want = matchStoryLine(content, /(?:\*\*)?I want to(?:\*\*)?\s+(.+)/i);
  const soThat = matchStoryLine(content, /(?:\*\*)?So that(?:\*\*)?\s+(.+)/i);
  return {
    who: asA,
    want,
    outcome: soThat,
    business_value: soThat
  };
}

function matchStoryLine(content, pattern) {
  for (const line of content.split(/\r?\n/)) {
    const normalized = line
      .replace(/^\s*[-*]\s*/, '')
      .replace(/\s{2,}$/, '')
      .trim();
    const match = normalized.match(pattern);
    if (!match) continue;
    return cleanMarkdownInline(match[1]);
  }
  return null;
}

function cleanMarkdownInline(value) {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

function stripFrontMatter(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function extractMarkdownSections(content) {
  const sections = {};
  let currentKey = null;
  let currentLines = [];
  const flush = () => {
    if (!currentKey) return;
    sections[currentKey] = [...(sections[currentKey] ? [sections[currentKey]] : []), currentLines.join('\n').trim()]
      .filter(Boolean)
      .join('\n\n');
  };
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      currentKey = normalizeStoryHeading(heading[1]);
      currentLines = [];
      continue;
    }
    if (currentKey) currentLines.push(line);
  }
  flush();
  return sections;
}

function normalizeStoryHeading(heading) {
  const normalized = heading.trim().toLowerCase();
  if (/誰のため|だれのため|対象ユーザー|利用者|who|actor|user/.test(normalized)) return 'who';
  if (/課題|問題|現状|背景|problem|pain|background/.test(normalized)) return 'problem';
  if (/望む変化|やりたいこと|したいこと|want|need/.test(normalized)) return 'want';
  if (/成果|成功状態|outcome|goal/.test(normalized)) return 'outcome';
  if (/事業価値|価値|効果|kpi|business/.test(normalized)) return 'business_value';
  if (/受け入れ基準|受入基準|acceptance/.test(normalized)) return 'acceptance';
  if (/完了条件|completion|done/.test(normalized)) return 'completion';
  return null;
}

function extractLabeledStoryFields(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*]\s*)?(who|problem|want|outcome|business[_ ]value|acceptance|誰のため|課題|望む変化|成果|事業価値|受け入れ基準)\s*[:：]\s*(.+)$/i);
    if (!match) continue;
    const key = normalizeStoryHeading(match[1]);
    if (!key) continue;
    if (key === 'acceptance') {
      result.acceptance_focus = [...(result.acceptance_focus ?? []), match[2].trim()];
      continue;
    }
    result[key] = match[2].trim();
  }
  return result;
}

function firstText(items) {
  const value = items.find((item) => typeof item === 'string' && item.trim().length > 0);
  if (!value) return null;
  return value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith('- ') && !block.startsWith('* '))
    ?? value.trim();
}

function extractBulletItems(text) {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean);
}

function extractTimelineSignals(content) {
  const signals = [];
  const dateMatches = content.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日/g) ?? [];
  const durationMatches = content.match(/\d+(?:\.\d+)?\s*(?:日|週間|ヶ月|か月|月)/g) ?? [];
  signals.push(...dateMatches.slice(0, 5), ...durationMatches.slice(0, 5));
  return [...new Set(signals)];
}

function findExplicitManagementPeriod(docs) {
  const text = docs.flatMap((doc) => doc.timeline_signals ?? []).join(' ');
  const quarter = text.match(/\d{4}Q[1-4]/);
  if (quarter) return quarter[0];
  const month = text.match(/\d{4}-\d{2}(?!-\d{2})/);
  if (month) return month[0];
  return null;
}

function findStoryDocPlanning(docs) {
  const storyDoc = docs.find((doc) => doc.path?.startsWith('docs/management/stories/'));
  if (!storyDoc) return {};
  return {
    view: storyDoc.view,
    horizon: storyDoc.horizon,
    period: storyDoc.period,
    hasPeriod: storyDoc.has_period
  };
}

function collectOpenQuestions(stories) {
  return stories.flatMap((story) => (story.derived?.open_questions ?? []).map((item) => ({
    story_id: story.story_id,
    field: item.field,
    question: item.question
  })));
}

function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/))
    .filter(Boolean)
    .map((matchLine) => [matchLine[1], normalizeFrontMatterValue(matchLine[2])]));
}

function normalizeFrontMatterValue(value) {
  const trimmed = value.trim();
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^["']|["']$/g, '');
}

function dedupeDocs(docs) {
  const seen = new Set();
  const result = [];
  for (const doc of docs) {
    if (seen.has(doc.path)) continue;
    seen.add(doc.path);
    result.push(doc);
  }
  return result.sort((a, b) => documentRank(a.path) - documentRank(b.path) || a.path.localeCompare(b.path));
}

function documentRank(filePath) {
  if (filePath.startsWith('docs/user_stories/')) return 0;
  if (filePath.startsWith('docs/management/stories/')) return 0;
  if (filePath.startsWith('docs/requirements/')) return 1;
  if (filePath.startsWith('docs/features/')) return 2;
  if (filePath.startsWith('docs/architecture/')) return 4;
  if (filePath.startsWith('docs/cms/')) return 5;
  if (filePath.startsWith('docs/dev/')) return 6;
  return 9;
}

function selectDocs(documentSignals, key) {
  return documentSignals[key] ?? [];
}

function selectDocsForStory(documentSignals, storyId) {
  return documentSignals._byStoryId?.[storyId] ?? [];
}

function attachLinkedDocumentSignals(stories, documentSignals) {
  return stories.map((story) => {
    const docs = selectDocsForStory(documentSignals, story.story_id);
    if (docs.length === 0) return story;
    const docPathsForStory = docs.map((doc) => doc.path);
    const docsEvidence = uniqueList([
      ...(story.derived?.meaning?.evidence_by_type?.docs_evidence ?? []),
      ...docPathsForStory
    ]);
    const sourcePaths = uniqueList([
      ...(story.source?.paths ?? []),
      ...docPathsForStory
    ]);
    const openQuestions = linkedDocsSatisfySpec(docs)
      ? (story.derived?.open_questions ?? []).filter((item) => item.field !== 'missing_spec')
      : story.derived?.open_questions ?? [];
    const meaning = story.derived?.meaning ?? {};
    const evidenceByType = {
      ...(meaning.evidence_by_type ?? {}),
      docs_evidence: docsEvidence,
      missing_evidence: (meaning.evidence_by_type?.missing_evidence ?? [])
        .filter((item) => !(linkedDocsSatisfySpec(docs) && item.field === 'missing_spec'))
    };
    return {
      ...story,
      source: {
        ...(story.source ?? {}),
        paths: sourcePaths
      },
      derived: {
        ...(story.derived ?? {}),
        open_questions: openQuestions,
        story_definition: appendLinkedDocsToStoryDefinition(story.derived?.story_definition, docs),
        meaning: {
          ...meaning,
          evidence_by_type: evidenceByType
        }
      }
    };
  });
}

function linkedDocsSatisfySpec(docs) {
  return docs.some((doc) => /docs\/(specs|requirements|features|user_stories)\//.test(doc.path));
}

function appendLinkedDocsToStoryDefinition(definition = {}, docs = []) {
  return {
    ...definition,
    source_synthesis: [
      ...(definition?.source_synthesis ?? []),
      ...docs.map((doc) => ({
        path: doc.path,
        role: classifyDocumentRole(doc),
        title: doc.title
      }))
    ].filter((item, index, items) => items.findIndex((candidate) => candidate.path === item.path) === index)
  };
}

function classifyDocumentRole(doc) {
  if (doc.path.startsWith('docs/specs/')) return 'Spec正本';
  if (doc.path.startsWith('docs/architecture/')) return 'Architecture正本';
  if (doc.path.startsWith('docs/requirements/')) return 'Requirement正本';
  if (doc.path.startsWith('docs/user_stories/')) return 'User Story正本';
  if (doc.path.startsWith('docs/management/stories/')) return 'Story正本';
  return 'linked document';
}

function docPaths(documentSignals, key) {
  return selectDocs(documentSignals, key).map((doc) => doc.path);
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean))];
}

async function readEvidence(repoRoot, manifest, fromRunId) {
  const warnings = [];
  const runs = Array.isArray(manifest?.runs) ? manifest.runs : [];
  const targetRun = fromRunId
    ? runs.find((run) => run.run_id === fromRunId)
    : runs.find((run) => run.run_id === manifest?.latest_run) ?? runs[0];
  if (!targetRun?.artifacts?.evidence) return { evidence: null, warnings };
  try {
    return {
      evidence: JSON.parse(await readFile(path.resolve(repoRoot, targetRun.artifacts.evidence), 'utf8')),
      warnings
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    warnings.push({
      code: 'missing_evidence',
      run_id: targetRun.run_id,
      path: targetRun.artifacts.evidence,
      message: `manifestが参照する診断evidenceが見つからないため、診断runなしでStory Mapを生成した: ${targetRun.artifacts.evidence}`
    });
    return { evidence: null, warnings };
  }
}

async function readGraph(repoRoot) {
  try {
    return JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'graphify', 'graph.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function summarizeGraph(graph) {
  const edges = Array.isArray(graph?.edges) ? graph.edges : Array.isArray(graph?.links) ? graph.links : [];
  return {
    node_count: Array.isArray(graph?.nodes) ? graph.nodes.length : 0,
    edge_count: edges.length
  };
}

function buildGraphStoryCoverage(graph, stories, preset) {
  if (!Array.isArray(graph?.nodes)) {
    return {
      model: 'graphify-story-coverage-v1',
      status: 'unavailable',
      reason: 'graphify graph.json が見つからないためCoverage Gateを実行できない。',
      totals: {
        graph_story_relevant_files: 0,
        covered_files: 0,
        uncovered_files: 0,
        coverage_ratio: null
      },
      by_role: [],
      uncovered: []
    };
  }

  const graphFiles = summarizeGraphFiles(graph.nodes);
  const relevantFiles = graphFiles.filter((item) => isStoryRelevantGraphFile(item.path, preset));
  const coverageMatchers = buildStoryCoverageMatchers(stories, preset);
  const uncovered = relevantFiles
    .filter((item) => !isCoveredByStory(item.path, coverageMatchers))
    .map((item) => ({
      path: item.path,
      role: classifyStoryRelevantFile(item.path, preset),
      node_count: item.node_count,
      reason: 'graphify上は主要な画面/API/ドメインコードだが、Story根拠に紐づいていない。'
    }))
    .sort((a, b) => b.node_count - a.node_count || a.path.localeCompare(b.path));
  const coveredCount = relevantFiles.length - uncovered.length;
  const byRole = summarizeCoverageByRole(relevantFiles, uncovered, preset);

  return {
    model: 'graphify-story-coverage-v1',
    status: uncovered.length > 0 ? 'warn' : 'pass',
    totals: {
      graph_story_relevant_files: relevantFiles.length,
      covered_files: coveredCount,
      uncovered_files: uncovered.length,
      coverage_ratio: relevantFiles.length === 0 ? null : Number((coveredCount / relevantFiles.length).toFixed(4))
    },
    by_role: byRole,
    uncovered
  };
}

function summarizeGraphFiles(nodes) {
  const counts = new Map();
  for (const node of nodes) {
    const sourceFile = normalizeGraphSourceFile(node.source_file);
    if (!sourceFile) continue;
    counts.set(sourceFile, (counts.get(sourceFile) ?? 0) + 1);
  }
  return [...counts.entries()].map(([pathName, nodeCount]) => ({
    path: pathName,
    node_count: nodeCount
  }));
}

function buildStoryCoverageMatchers(stories, preset) {
  const paths = new Set();
  const patterns = [];
  for (const story of stories) {
    for (const pathName of story.source?.paths ?? []) {
      if (isCodePath(pathName, preset)) paths.add(normalizeGraphSourceFile(pathName));
    }
    for (const item of story.derived?.story_definition?.source_synthesis ?? []) {
      if (isCodePath(item.path, preset)) paths.add(normalizeGraphSourceFile(item.path));
    }
    patterns.push(...(preset?.coveragePatterns?.[story.story_id] ?? []));
  }
  return { paths, patterns };
}

function isCoveredByStory(pathName, coverageMatchers) {
  if (coverageMatchers.paths.has(pathName)) return true;
  if ([...coverageMatchers.paths].some((coveredPath) => pathName.startsWith(`${coveredPath}/`) || coveredPath.startsWith(`${pathName}/`))) return true;
  return coverageMatchers.patterns.some((pattern) => pattern.test(pathName));
}

function summarizeCoverageByRole(relevantFiles, uncovered, preset) {
  const uncoveredByPath = new Set(uncovered.map((item) => item.path));
  const groups = groupBy(relevantFiles, (item) => classifyStoryRelevantFile(item.path, preset));
  return Object.entries(groups)
    .map(([role, items]) => {
      const uncoveredCount = items.filter((item) => uncoveredByPath.has(item.path)).length;
      return {
        role,
        total: items.length,
        covered: items.length - uncoveredCount,
        uncovered: uncoveredCount
      };
    })
    .sort((a, b) => b.uncovered - a.uncovered || a.role.localeCompare(b.role));
}

function isStoryRelevantGraphFile(filePath, preset) {
  if (!isCodePath(filePath, preset)) return false;
  if (/\.(test|spec)\.[jt]sx?$/.test(filePath)) return false;
  if (/\/(__tests__|test|tests)\//.test(filePath)) return false;
  if (/\/(ui|magicui)\//.test(filePath)) return false;
  if (/\/fonts\//.test(filePath)) return false;
  if (/\.types\.[jt]s$/.test(filePath)) return false;
  if (/(^|\/)(index|types|styles|constants)\.[jt]sx?$/.test(filePath)) return false;
  return preset.storyRelevantPatterns.some((pattern) => pattern.test(filePath));
}

function classifyStoryRelevantFile(filePath, preset) {
  return preset.classifyRole(filePath);
}

function isCodePath(filePath, preset) {
  return preset.isCodePath(filePath);
}

function normalizeGraphSourceFile(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function findCurrentStory(config) {
  const stories = Array.isArray(config?.brainbase?.stories) ? config.brainbase.stories : [];
  return stories.find((story) => story.story_id === config?.brainbase?.current_story_id)
    ?? stories.find((story) => !['archived', 'アーカイブ'].includes(story.status))
    ?? null;
}

function buildDefaultStoryFields(currentStory, preset, context = {}) {
  const today = new Date();
  return {
    view: currentStory?.view ?? 'dev',
    period: currentStory?.period ?? formatIsoWeek(today),
    started_at: currentStory?.started_at ?? formatLocalDate(today),
    due_at: null,
    preset,
    repoProfile: context.repoProfile ?? null,
    presetExplicit: context.presetExplicit === true
  };
}

function dedupeStories(stories) {
  const seen = new Set();
  const result = [];
  for (const story of stories) {
    if (seen.has(story.story_id)) continue;
    seen.add(story.story_id);
    result.push(story);
  }
  return result.sort((a, b) => {
    const categoryOrder = ['product', 'architecture', 'security', 'ops', 'quality', 'docs'];
    return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || a.story_id.localeCompare(b.story_id);
  });
}

function formatIsoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function currentQuarter(date = new Date()) {
  return `${date.getFullYear()}Q${Math.floor(date.getMonth() / 3) + 1}`;
}

function detectStoryRepoProfile(fileSet, architectureProfile = {}, files = []) {
  const paths = [...fileSet];
  const languageCounts = countFileLanguages(files);
  const evidence = [];
  const has = (pattern) => paths.some((file) => pattern.test(file));
  const addEvidence = (label, pattern) => {
    const matches = paths.filter((file) => pattern.test(file)).slice(0, 8);
    if (matches.length > 0) evidence.push({ label, paths: matches });
    return matches.length > 0;
  };

  const hasNextEvidence = architectureProfile.rendering === 'nextjs'
    || addEvidence('next_app_router', /^(src\/)?app\/.+\/(page|route)\.[jt]sx?$/)
    || addEvidence('next_config', /^next\.config\.[cm]?[jt]s$/);
  if (hasNextEvidence) {
    return buildRepoProfile({
      id: 'next-app',
      confidence: 'high',
      productSurfaceApplicable: true,
      evidence,
      languageCounts,
      architectureProfile
    });
  }

  const pythonFiles = languageCounts.python ?? 0;
  const jsTsFiles = (languageCounts.javascript ?? 0) + (languageCounts.typescript ?? 0);
  const hasPythonCliEvidence = pythonFiles > 0
    && (pythonFiles >= Math.max(3, jsTsFiles * 2) || has(/^scripts\/.+\.py$/) || has(/^src\/.+\.py$/) || has(/^pyproject\.toml$/));
  if (hasPythonCliEvidence) {
    addEvidence('python_source', /^(src|scripts|pkg)\/.+\.py$|^pyproject\.toml$/);
    return buildRepoProfile({
      id: has(/^scripts\/.+\.py$/) ? 'data-pipeline' : 'python-cli',
      confidence: 'medium',
      productSurfaceApplicable: false,
      evidence,
      languageCounts,
      architectureProfile
    });
  }

  const hasWebEvidence = architectureProfile.app_type === 'web_app'
    || architectureProfile.app_type === 'static_site'
    || addEvidence('web_component', /^(src\/)?components\/.+\.[jt]sx$/)
    || addEvidence('web_entry', /^(src\/)?(main|App)\.[jt]sx?$|^index\.html$/);
  if (hasWebEvidence) {
    return buildRepoProfile({
      id: 'web',
      confidence: architectureProfile.app_type === 'web_app' ? 'high' : 'medium',
      productSurfaceApplicable: true,
      evidence,
      languageCounts,
      architectureProfile
    });
  }

  const hasApiEvidence = architectureProfile.has_api_routes === true
    || addEvidence('api_route', /^(src\/)?(server|api|routes)\//);
  if (hasApiEvidence) {
    return buildRepoProfile({
      id: 'api-service',
      confidence: 'medium',
      productSurfaceApplicable: false,
      evidence,
      languageCounts,
      architectureProfile
    });
  }

  const hasLibraryEvidence = has(/^src\/.+\.(js|ts|py|go|rs)$/) || has(/^lib\/.+\.(js|ts|py|go|rs)$/);
  if (hasLibraryEvidence) {
    addEvidence('library_source', /^(src|lib)\/.+\.(js|ts|py|go|rs)$/);
    return buildRepoProfile({
      id: 'library',
      confidence: 'low',
      productSurfaceApplicable: false,
      evidence,
      languageCounts,
      architectureProfile
    });
  }

  return buildRepoProfile({
    id: 'unknown',
    confidence: 'low',
    productSurfaceApplicable: false,
    evidence,
    languageCounts,
    architectureProfile
  });
}

function countFileLanguages(files) {
  const counts = {};
  for (const file of files) {
    const ext = path.extname(file.relativePath).toLowerCase();
    const language = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php'
    }[ext];
    if (!language) continue;
    counts[language] = (counts[language] ?? 0) + 1;
  }
  return counts;
}

function buildRepoProfile({ id, confidence, productSurfaceApplicable, evidence, languageCounts, architectureProfile }) {
  return {
    id,
    confidence,
    product_surface_applicable: productSurfaceApplicable,
    app_type: architectureProfile.app_type ?? 'unknown',
    rendering: architectureProfile.rendering ?? null,
    frameworks: architectureProfile.frameworks ?? [],
    languages: architectureProfile.languages ?? Object.keys(languageCounts).sort(),
    language_counts: languageCounts,
    evidence
  };
}

function evidencePathForRun(manifest, runId) {
  const run = (manifest?.runs ?? []).find((item) => item.run_id === runId);
  return run?.artifacts?.evidence ?? null;
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {});
}

function renderExecutiveSummary(catalog, stories) {
  const viewCounts = countBy(stories, (story) => story.view ?? 'unknown');
  const categoryCounts = countBy(stories, (story) => story.category ?? 'unknown');
  const sourceCounts = countBy(stories, (story) => story.source?.type ?? 'unknown');
  const contractCounts = countBy(stories, (story) => story.derived?.story_contract?.status ?? 'unknown');
  const questionCounts = countBy(catalog.open_questions ?? [], (item) => item.field ?? 'unknown');
  const coverage = catalog.coverage;
  const warnings = catalog.source?.warnings ?? [];

  return [
    `- 生成日時: ${catalog.generated_at ?? '-'}`,
    `- 診断run: ${catalog.source?.run_id ?? '-'}`,
    `- Repo profile: ${catalog.source?.repo_profile?.id ?? 'unknown'} (${catalog.source?.repo_profile?.confidence ?? 'unknown'})`,
    `- Preset: ${catalog.source?.preset ?? '-'} / ${catalog.source?.preset_resolution?.mode ?? 'unknown'}`,
    `- 警告: ${warnings.length > 0 ? warnings.map((warning) => warning.code).join(', ') : '-'}`,
    `- Story数: ${stories.length}`,
    `- View: ${formatCounts(viewCounts)}`,
    `- Category: ${formatCounts(categoryCounts)}`,
    `- Source: ${formatCounts(sourceCounts)}`,
    `- Story Contract: ${formatCounts(contractCounts) || '-'}`,
    `- Graph: nodes ${catalog.source?.graphify?.node_count ?? 0}, edges ${catalog.source?.graphify?.edge_count ?? 0}`,
    `- Coverage Gate: ${coverage?.status ?? 'unavailable'} (${formatCoverageRatio(coverage?.totals?.coverage_ratio)})`,
    `- 主な不明点: ${formatCounts(questionCounts) || '-'}`
  ].join('\n');
}

function renderReviewQueue(catalog, stories) {
  const items = [];
  const coverage = catalog.coverage;
  if (coverage?.status === 'warn') {
    items.push(`- Graph Coverage が warn。未カバー ${coverage.totals?.uncovered_files ?? 0} / ${coverage.totals?.graph_story_relevant_files ?? 0} files。まず未カバー上位を既存Storyへ吸収するか、新Storyにするか判断する。`);
  } else if (coverage?.status === 'pass') {
    items.push('- Graph Coverage は pass。コード面の主要ファイルはStory根拠に紐づいている。');
  } else {
    items.push('- Graph Coverage は unavailable。graphify成果物を取り込んでから再生成する。');
  }

  const missingSpecStories = stories.filter((story) => hasOpenQuestion(story, 'missing_spec'));
  if (missingSpecStories.length > 0) {
    items.push(`- 仕様/Storyがないコード由来Storyが ${missingSpecStories.length} 件ある。優先確認: ${missingSpecStories.slice(0, 5).map((story) => story.story_id).join(', ')}`);
  }

  const periodUnknownCount = (catalog.open_questions ?? []).filter((item) => item.field === 'period').length;
  if (periodUnknownCount > 0) {
    items.push(`- Period未確定が ${periodUnknownCount} 件ある。NocoDB同期前に実行期を確定するか、未定として扱う方針を決める。`);
  }

  const contractUnknown = stories.filter((story) => story.derived?.story_contract?.status === 'needs_clarification');
  if (contractUnknown.length > 0) {
    items.push(`- Story Contract未解決が ${contractUnknown.length} 件ある。優先確認: ${contractUnknown.slice(0, 5).map((story) => story.story_id).join(', ')}`);
  }

  const topUncovered = (coverage?.uncovered ?? []).slice(0, 8);
  if (topUncovered.length > 0) {
    items.push('- Coverage未カバー上位:');
    items.push(...topUncovered.map((item) => `  - ${item.path} (${item.role}, nodes:${item.node_count})`));
  }

  return items.join('\n');
}

function renderStoryPortfolio(stories) {
  const groups = groupBy(stories, (story) => story.category ?? 'unknown');
  return Object.entries(groups)
    .sort(([a], [b]) => {
      const order = ['product', 'architecture', 'security', 'ops', 'quality', 'docs'];
      return order.indexOf(a) - order.indexOf(b) || a.localeCompare(b);
    })
    .map(([category, items]) => {
      const rows = items.map((story) => {
        const flags = storyFlags(story);
        const source = story.source?.type ?? '-';
        const period = story.period ?? '-';
        return `- \`${story.story_id}\` ${story.title} — ${story.view ?? '-'} / ${story.horizon ?? '-'} / period:${period} / source:${source}${flags ? ` / ${flags}` : ''}`;
      }).join('\n');
      return `### ${category} (${items.length})\n\n${rows}`;
    })
    .join('\n\n');
}

function renderStoryCard(story) {
  const definition = story.derived?.story_definition ?? {};
  const meaning = story.derived?.meaning ?? {};
  const storyContract = story.derived?.story_contract ?? {};
  const evidence = sourceSynthesisLines(definition.source_synthesis ?? [], 4);
  const questions = story.derived?.open_questions ?? [];
  const importantQuestions = questions
    .filter((item) => item.field !== 'period')
    .slice(0, 4);
  const periodQuestion = questions.find((item) => item.field === 'period');
  const questionLines = importantQuestions.length > 0
    ? importantQuestions.map((item) => `  - ${item.field}: ${item.question}`).join('\n')
    : '  - -';
  const acceptance = Array.isArray(definition.acceptance_focus) && definition.acceptance_focus.length > 0
    ? definition.acceptance_focus.slice(0, 4).map((item) => `  - ${item}`).join('\n')
    : '  - -';
  const meaningLines = renderMeaningLines(meaning);
  const contractLines = renderStoryContractLines(storyContract);

  return `### ${story.title}

- Story ID: \`${story.story_id}\`
- 管理: view:${story.view ?? '-'} / category:${story.category ?? '-'} / horizon:${story.horizon ?? '-'} / period:${story.period ?? '-'}
- 根拠: ${story.source?.type ?? '-'}${story.source?.paths?.length ? ` (${story.source.paths.length} paths)` : ''}
- Story Contract:
${contractLines}
- 誰のため: ${definition.who ?? '-'}
- 課題: ${definition.problem ?? '-'}
- 望む変化: ${definition.want ?? '-'}
- 成果: ${definition.outcome ?? '-'}
- 事業価値: ${definition.business_value ?? '-'}
- 意味づけ:
${meaningLines}
- 受け入れ観点:
${acceptance}
- 主要根拠:
${evidence}
- 未決事項:
${questionLines}
${periodQuestion ? `- Period: ${periodQuestion.question}` : '- Period: -'}`;
}

function renderStoryContractLines(storyContract) {
  if (!storyContract || Object.keys(storyContract).length === 0) return '  - -';
  const unresolved = (storyContract.checks ?? [])
    .filter((check) => check.status === 'needs_clarification')
    .map((check) => check.id);
  return [
    `  - status:${storyContract.status ?? '-'} / type:${storyContract.story_type ?? '-'}`,
    `  - boundary:${storyContract.developer_boundary_hypothesis?.status ?? '-'} / risk:${storyContract.risk_surface_hypothesis?.level ?? '-'}`,
    `  - verification:${storyContract.verification_strategy?.approach ?? '-'}`,
    `  - unresolved:${unresolved.length > 0 ? unresolved.join(', ') : '-'}`
  ].join('\n');
}

function renderMeaningLines(meaning) {
  if (!meaning || Object.keys(meaning).length === 0) return '  - -';
  const workflow = meaning.workflow_position ?? {};
  const counterEvidence = Array.isArray(meaning.counter_evidence) && meaning.counter_evidence.length > 0
    ? meaning.counter_evidence.slice(0, 2).join(' / ')
    : '-';
  return [
    `  - 価値仮説: ${meaning.value_hypothesis ?? '-'}`,
    `  - 信頼度: actor:${meaning.user_actor?.confidence ?? '-'} / biz:${meaning.business_goal?.confidence ?? '-'} / code:${meaning.code_scope?.confidence ?? '-'} / overall:${meaning.confidence ?? '-'}`,
    `  - 位置づけ: ${workflow.stage ?? '-'} / before:${formatStoryRefs(workflow.before)} / after:${formatStoryRefs(workflow.after)}`,
    `  - 反証・不足: ${counterEvidence}`
  ].join('\n');
}

function renderCoverageAppendix(coverage) {
  const roleRows = (coverage?.by_role ?? [])
    .map((item) => `| ${item.role} | ${item.total} | ${item.covered} | ${item.uncovered} |`)
    .join('\n');
  const uncoveredRows = (coverage?.uncovered ?? [])
    .slice(0, 50)
    .map((item) => `| ${item.path} | ${item.role} | ${item.node_count} |`)
    .join('\n');

  return `| 項目 | 内容 |
|------|------|
| Status | ${coverage?.status ?? 'unavailable'} |
| 対象ファイル | ${coverage?.totals?.graph_story_relevant_files ?? 0} |
| Covered | ${coverage?.totals?.covered_files ?? 0} |
| Uncovered | ${coverage?.totals?.uncovered_files ?? 0} |
| Coverage | ${formatCoverageRatio(coverage?.totals?.coverage_ratio)} |

### Role別

| Role | Total | Covered | Uncovered |
|------|-------|---------|-----------|
${roleRows || '| - | 0 | 0 | 0 |'}

### 未カバー上位

| Path | Role | Nodes |
|------|------|-------|
${uncoveredRows || '| - | - | 0 |'}`;
}

function renderOpenQuestionsAppendix(openQuestions) {
  if (openQuestions.length === 0) return '-';
  const groups = groupBy(openQuestions, (item) => item.field ?? 'unknown');
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, items]) => {
      const rows = items
        .map((item) => `- \`${item.story_id}\`: ${item.question}`)
        .join('\n');
      return `### ${field} (${items.length})\n\n${rows}`;
    })
    .join('\n\n');
}

function countBy(items, getKey) {
  return Object.entries(groupBy(items, getKey))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => ({ key, count: values.length }));
}

function formatCounts(counts) {
  return counts.map((item) => `${item.key}:${item.count}`).join(', ');
}

function storyFlags(story) {
  const fields = (story.derived?.open_questions ?? []).map((item) => item.field);
  const flags = [];
  if (fields.includes('missing_spec')) flags.push('missing_spec');
  if (fields.includes('business_metric')) flags.push('metric_unknown');
  if (fields.includes('period')) flags.push('period_unknown');
  if (story.derived?.story_contract?.status === 'needs_clarification') flags.push('contract_needs_clarification');
  return flags.join(', ');
}

function hasOpenQuestion(story, field) {
  return (story.derived?.open_questions ?? []).some((item) => item.field === field);
}

function sourceSynthesisLines(items, limit) {
  if (!Array.isArray(items) || items.length === 0) return '  - -';
  return items.slice(0, limit).map((item) => `  - ${item.path}: ${item.role}${item.title ? ` (${item.title})` : ''}`).join('\n');
}

function formatStoryRefs(items) {
  return Array.isArray(items) && items.length > 0 ? items.join(', ') : '-';
}

function formatSource(story) {
  const source = story.source ?? {};
  const paths = source.paths?.length ? `:${source.paths.slice(0, 2).join('<br>')}` : '';
  return `${source.type ?? '-'}${paths}`;
}

function formatPrediction(story) {
  const predictions = story.derived?.predictions ?? {};
  return [
    formatPredictionItem('view', predictions.view),
    formatPredictionItem('horizon', predictions.horizon),
    formatPredictionItem('period', predictions.period)
  ].filter(Boolean).join('<br>') || '-';
}

function formatPredictionItem(label, prediction) {
  if (!prediction) return null;
  const value = prediction.value ?? prediction.candidate ?? '-';
  return `${label}:${value}(${prediction.confidence ?? 'unknown'})`;
}

function formatOpenQuestions(story) {
  const questions = story.derived?.open_questions ?? [];
  if (questions.length === 0) return '-';
  return questions.map((item) => `${item.field}: ${item.question}`).join('<br>');
}

function formatCoverageRatio(value) {
  if (typeof value !== 'number') return '-';
  return `${Math.round(value * 1000) / 10}%`;
}

function renderStoryDetail(story) {
  const definition = story.derived?.story_definition ?? {};
  const meaning = story.derived?.meaning ?? {};
  const acceptance = Array.isArray(definition.acceptance_focus) && definition.acceptance_focus.length > 0
    ? definition.acceptance_focus.map((item) => `  - ${item}`).join('\n')
    : '  - -';
  const sources = Array.isArray(definition.source_synthesis) && definition.source_synthesis.length > 0
    ? definition.source_synthesis.map((item) => `  - ${item.path}: ${item.role}${item.title ? ` (${item.title})` : ''}`).join('\n')
    : '  - -';
  const openQuestions = (story.derived?.open_questions ?? []).length > 0
    ? story.derived.open_questions.map((item) => `  - ${item.field}: ${item.question}`).join('\n')
    : '  - -';

  return `### ${story.title} (${story.story_id})

- View: ${story.view ?? '-'}
- Category: ${story.category ?? '-'}
- Horizon: ${story.horizon ?? '-'}
- Period: ${story.period ?? '-'}
- Who: ${definition.who ?? '-'}
- Problem: ${definition.problem ?? '-'}
- Want: ${definition.want ?? '-'}
- Outcome: ${definition.outcome ?? '-'}
- Business value: ${definition.business_value ?? '-'}
- Meaning:
${renderMeaningLines(meaning)}
- Acceptance focus:
${acceptance}
- Evidence synthesis:
${sources}
- Open questions:
${openQuestions}`;
}

function extractMarkdownTitle(content) {
  const line = content.split(/\r?\n/).find((item) => item.startsWith('# '));
  return line ? line.replace(/^#\s+/, '').trim() : null;
}

function humanizeFileName(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
