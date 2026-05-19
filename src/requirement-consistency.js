import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_SCAN_FILES = 80;
export const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
export const DEFAULT_STORY_DIRS = [
  path.join('docs', 'user_stories', 'active'),
  path.join('docs', 'user_stories'),
  path.join('docs', 'management', 'stories', 'active'),
  path.join('docs', 'management', 'stories'),
  path.join('docs', 'stories')
];
export const STORY_DIR_PREFIXES = DEFAULT_STORY_DIRS.map((dir) => dir.split(path.sep).join('/'));
const REQUIREMENT_SOURCE_DIRS = [
  { kind: 'spec', dir: path.join('docs', 'specs') },
  { kind: 'spec', dir: path.join('docs', 'features', 'specifications') },
  { kind: 'architecture', dir: path.join('docs', 'architecture') },
  { kind: 'architecture', dir: path.join('docs', 'management', 'architecture') },
  { kind: 'policy', dir: path.join('docs', 'management', 'policies') },
  { kind: 'policy', dir: path.join('docs', 'frames') },
  { kind: 'policy', dir: path.join('docs', '00-glossary') }
];
export const INVARIANT_PATTERNS = [
  /\bmust\b/i,
  /\bshall\b/i,
  /\bnever\b/i,
  /\bkeep\b/i,
  /\buntil\b/i,
  /必ず/,
  /維持/,
  /保持/,
  /禁止/,
  /してはいけない/,
  /変えない/,
  /一致/,
  /同じ/,
  /期間終了/,
  /認可/,
  /署名/,
  /重複/,
  /正規化/,
  /1件/,
  /一意/,
  /分離/,
  /境界/,
  /責務/,
  /扱う/,
  /premium|プレミアム/i,
  /subscription|サブスクリプション/i
];

export const DOMAIN_KEYWORDS = [
  'auth',
  '認証',
  '認可',
  'session',
  'user',
  'identity',
  'billing',
  'stripe',
  'subscription',
  'premium',
  'webhook',
  '署名',
  'onboarding',
  'profile'
];

const GENERIC_CONDITION_TOKENS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'return',
  'status',
  'state',
  'error',
  'result',
  'value',
  'data',
  'body',
  'function'
]);

const INHERITED_BEHAVIOR_PATTERNS = [
  /\binherited\b/i,
  /\bexisting\b/i,
  /\bunchanged\b/i,
  /\bremain(?:s|ed)?\b/i,
  /\bcontinue(?:s|d)?\b/i,
  /\bas before\b/i,
  /\bdo not change\b/i,
  /\bnot changed\b/i,
  /既存/,
  /維持/,
  /変更しない/,
  /従来/,
  /そのまま/
];

export async function buildRequirementConsistency(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const codeFiles = await resolveCodeFiles(root, options);
  const storySource = await resolveStorySource(root, options);
  const requirementSources = await collectRequirementSources(root, {
    story: options.story,
    storySource,
    codeFiles
  });
  const policyRefs = requirementSources.filter((source) => source.kind === 'policy');
  const invariants = options.inferredSpec
    ? extractInvariantsFromInferredSpec(options.inferredSpec, storySource)
    : extractInvariants(storySource, requirementSources);
  const codeScenarios = await collectCodeScenarios(root, codeFiles);
  const scenarioGaps = buildScenarioGaps({
    invariants,
    codeScenarios,
    storySource,
    requirementSources,
    inferredSpec: options.inferredSpec
  });
  const contradictions = buildContradictions({ invariants, codeScenarios, storySource });
  const status = contradictions.length > 0
    ? 'contradicted'
    : scenarioGaps.length > 0
      ? 'needs_review'
      : invariants.length > 0
        ? 'pass'
        : 'not_applicable';

  return {
    schema_version: '0.1.0',
    status,
    story_source: {
      path: storySource?.path ?? null,
      title: storySource?.title ?? null
    },
    summary: {
      invariant_count: invariants.length,
      scenario_gap_count: scenarioGaps.length,
      contradiction_count: contradictions.length,
      scanned_code_files: codeScenarios.length,
      requirement_source_count: requirementSources.length,
      spec_ref_count: requirementSources.filter((source) => source.kind === 'spec').length,
      architecture_ref_count: requirementSources.filter((source) => source.kind === 'architecture').length,
      policy_ref_count: policyRefs.length
    },
    invariants,
    scenario_gaps: scenarioGaps,
    contradictions,
    requirement_sources: requirementSources.map(toRequirementSourceRef),
    policy_refs: policyRefs.map(toRequirementSourceRef),
    code_scenarios: codeScenarios
  };
}

export function renderRequirementConsistencyReport(requirement) {
  if (!requirement) return '# Requirement Consistency\n\n- 未生成\n';
  return `# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | ${requirement.status} |
| Invariants | ${requirement.summary?.invariant_count ?? 0} |
| Scenario Gaps | ${requirement.summary?.scenario_gap_count ?? 0} |
| Contradictions | ${requirement.summary?.contradiction_count ?? 0} |
| Scanned Code Files | ${requirement.summary?.scanned_code_files ?? 0} |
| Requirement Sources | ${requirement.summary?.requirement_source_count ?? 0} |
| Spec Refs | ${requirement.summary?.spec_ref_count ?? 0} |
| Architecture Refs | ${requirement.summary?.architecture_ref_count ?? 0} |
| Policy Refs | ${requirement.summary?.policy_ref_count ?? 0} |

## Invariants

${formatItems(requirement.invariants, (item) => `- ${item.id}: ${item.text} (${formatSourceRef(item.source)})`)}

## Scenario Gaps

${formatItems(requirement.scenario_gaps, (item) => `- ${item.id}: ${item.title} - ${item.detail}`)}

## Potential Contradictions

${formatItems(requirement.contradictions, (item) => `- ${item.id}: ${item.title} - ${item.detail}`)}

## Requirement Sources

${formatItems(requirement.requirement_sources, (item) => `- ${item.kind}: ${item.path}: ${item.title ?? '-'}`)}
`;
}

export function renderRequirementGateSummary(requirement) {
  if (!requirement) return '- Requirement Gate: not_generated';
  const detail = [
    `${requirement.summary?.invariant_count ?? 0} invariants`,
    `${requirement.summary?.scenario_gap_count ?? 0} scenario gaps`,
    `${requirement.summary?.contradiction_count ?? 0} contradictions`
  ].join(', ');
  return `- Requirement Gate: ${requirement.status} - ${detail}`;
}

export async function resolveStoryDirs(repoRoot) {
  try {
    const { getWorkspaceDir } = await import('./workspace.js');
    const configPath = path.join(getWorkspaceDir(repoRoot), 'config.json');
    const raw = await readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    const override = config?.doc_paths?.stories;
    if (Array.isArray(override) && override.length > 0) {
      return override.map((entry) => String(entry));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // fall through to defaults
    }
  }
  return [...DEFAULT_STORY_DIRS];
}

export async function findStorySource(repoRoot, story) {
  const storyId = story?.story_id ?? null;
  const storyDirs = await resolveStoryDirs(repoRoot);
  const candidates = [];
  for (const dir of storyDirs) {
    const files = await listFiles(path.join(repoRoot, dir));
    candidates.push(...files.filter((file) => /\.(md|mdx)$/i.test(file)));
  }
  if (candidates.length === 0) {
    return {
      path: null,
      title: story?.title ?? null,
      content: '',
      acceptance_criteria: [],
      background: null,
      policy: null
    };
  }
  if (storyId) {
    const byFrontmatter = await findCandidateByFrontmatter(repoRoot, candidates, storyId);
    if (byFrontmatter) return parseStoryLikeDocument(repoRoot, byFrontmatter, 'story');
    const bySubstring = candidates.find((file) => normalizePath(file).includes(storyId));
    if (bySubstring) return parseStoryLikeDocument(repoRoot, bySubstring, 'story');
    return {
      path: null,
      title: story?.title ?? null,
      content: '',
      acceptance_criteria: [],
      background: null,
      policy: null
    };
  }
  return parseStoryLikeDocument(repoRoot, candidates[0], 'story');
}

async function findCandidateByFrontmatter(repoRoot, candidates, storyId) {
  for (const file of candidates) {
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const frontmatter = parseFrontmatter(content);
    const candidateIds = [
      frontmatter.story_id,
      frontmatter.vibepro_story_id,
      frontmatter.story_ref,
      frontmatter.story,
      frontmatter.requirement_id
    ].filter(Boolean).map((value) => String(value));
    if (candidateIds.includes(storyId)) return file;
  }
  return null;
}

export async function resolveStorySource(repoRoot, options) {
  if (options.storySource?.path) {
    try {
      const parsed = await parseStoryLikeDocument(repoRoot, options.storySource.path, 'story');
      return {
        ...parsed,
        ...Object.fromEntries(Object.entries(options.storySource).filter(([, value]) => value !== null && value !== undefined)),
        content: parsed.content
      };
    } catch {
      return { ...options.storySource, kind: 'story', content: options.storySource.content ?? '' };
    }
  }
  return options.storySource
    ? { ...options.storySource, kind: 'story', content: options.storySource.content ?? '' }
    : findStorySource(repoRoot, options.story);
}

async function collectRequirementSources(repoRoot, { story, storySource, codeFiles }) {
  const docs = [];
  for (const sourceDir of REQUIREMENT_SOURCE_DIRS) {
    const files = await listFiles(path.join(repoRoot, sourceDir.dir));
    docs.push(...files
      .filter((file) => /\.(md|mdx)$/i.test(file))
      .map((file) => ({ file, kind: sourceDir.kind })));
  }

  const linkedPaths = new Set(extractLinkedDocPaths(storySource?.content ?? ''));
  const storyId = story?.story_id ?? storySource?.story_id ?? null;
  const sourceText = [
    storyId,
    storySource?.title,
    storySource?.background,
    storySource?.policy,
    ...(storySource?.acceptance_criteria ?? []),
    ...codeFiles
  ].filter(Boolean).join(' ').toLowerCase();
  const sourceKeywords = DOMAIN_KEYWORDS.filter((keyword) => sourceText.includes(keyword.toLowerCase()));
  const refs = [];
  const seen = new Set();
  for (const { file, kind } of docs.slice(0, 240)) {
    const parsed = await parseStoryLikeDocument(repoRoot, file, kind);
    if (seen.has(parsed.path) || parsed.path === storySource?.path) continue;
    const linked = linkedPaths.has(parsed.path) || linkedPaths.has(`./${parsed.path}`);
    const storyMatched = storyId && parsed.frontmatter?.story_id === storyId;
    const refMatched = storyId && [
      parsed.frontmatter?.story_ref,
      parsed.frontmatter?.story,
      parsed.frontmatter?.requirement_id
    ].filter(Boolean).some((value) => String(value) === storyId);
    const haystack = [parsed.path, parsed.title, parsed.content.slice(0, 1600)].filter(Boolean).join(' ').toLowerCase();
    const invariantHints = extractInvariantTexts(parsed).slice(0, 6);
    const keywordHits = sourceKeywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
    const keywordMatched = sourceKeywords.length > 0
      && keywordHits.length >= 2
      && invariantHints.length > 0;
    if (!linked && !storyMatched && !refMatched && !keywordMatched) continue;
    seen.add(parsed.path);
    refs.push({
      ...parsed,
      linked_from_story: linked,
      matched_by_story_id: Boolean(storyMatched || refMatched),
      invariant_hints: invariantHints
    });
  }
  return refs.sort(compareRequirementSources).slice(0, 20);
}

function toRequirementSourceRef(source) {
  return {
    kind: source.kind ?? inferSourceKind(source.path),
    path: source.path ?? null,
    title: source.title ?? null,
    linked_from_story: source.linked_from_story === true,
    matched_by_story_id: source.matched_by_story_id === true,
    invariant_count: source.invariant_hints?.length ?? 0
  };
}

function formatSourceRef(source) {
  if (!source) return 'source:unknown';
  const kind = source.kind ?? inferSourceKind(source.path);
  return `${kind}:${source.path ?? '-'}`;
}

export function inferSourceKind(filePath) {
  const normalized = normalizePath(filePath ?? '');
  if (
    normalized.includes('/stories/')
    || normalized.includes('/user_stories/')
    || normalized.startsWith('user_stories/')
    || normalized.startsWith('docs/management/stories/')
  ) {
    return 'story';
  }
  if (normalized.startsWith('docs/specs/') || normalized.startsWith('docs/features/specifications/')) return 'spec';
  if (
    normalized.startsWith('docs/architecture/')
    || normalized.startsWith('docs/management/architecture/')
    || /^docs\/.+\/ADR-[^/]+\.md$/i.test(normalized)
  ) {
    return 'architecture';
  }
  if (
    normalized.startsWith('docs/management/policies/')
    || normalized.startsWith('docs/frames/')
    || normalized.startsWith('docs/00-glossary/')
  ) {
    return 'policy';
  }
  return 'requirement';
}

export function isStoryDocPath(filePath) {
  const normalized = normalizePath(filePath ?? '');
  if (!normalized) return false;
  for (const prefix of STORY_DIR_PREFIXES) {
    if (normalized.startsWith(`${prefix}/`)) return true;
  }
  return /^docs\/.+\/stories\//.test(normalized);
}

function extractLinkedDocPaths(content) {
  const refs = new Set();
  const source = String(content ?? '');
  const patterns = [
    /\[[^\]]+\]\(([^)\s]+\.mdx?)(?:#[^)]+)?\)/gi,
    /\b(?:path|doc|file|adr|specification|architecture)\s*:\s*['"]?([^'"\n]+\.mdx?)(?:#[^\s'"]*)?['"]?/gi,
    /\b(docs\/[^\s)'"]+\.mdx?)(?:#[^\s)'"]*)?/gi
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const cleaned = cleanupLinkedPath(match[1]);
      if (cleaned) refs.add(cleaned);
    }
  }
  return [...refs];
}

function cleanupLinkedPath(value) {
  const cleaned = normalizePath(String(value ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[),.。]$/g, '')
    .split('#')[0]
    .split('?')[0]);
  if (!cleaned || /^n\/?a$/i.test(cleaned) || cleaned === '-') return null;
  return cleaned;
}

function compareRequirementSources(a, b) {
  if (a.linked_from_story !== b.linked_from_story) return a.linked_from_story ? -1 : 1;
  const kindOrder = { spec: 0, architecture: 1, policy: 2, requirement: 3 };
  const kindDelta = (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9);
  if (kindDelta !== 0) return kindDelta;
  return String(a.path ?? '').localeCompare(String(b.path ?? ''));
}

function extractInvariantsFromInferredSpec(spec, storySource) {
  if (!spec || !Array.isArray(spec.clauses)) return [];
  return spec.clauses
    .filter((clause) => clause && typeof clause.statement === 'string')
    .map((clause) => ({
      id: clause.id,
      text: clause.statement.slice(0, 240),
      source: {
        kind: 'inferred_spec',
        path: storySource?.path ?? null,
        clause_type: clause.type ?? 'invariant'
      }
    }))
    .slice(0, 32);
}

function extractInvariants(storySource, requirementSources) {
  const storyInvariants = extractInvariantTexts(storySource).map((text, index) => ({
    id: `REQ-INV-${String(index + 1).padStart(3, '0')}`,
    text,
    source: { kind: 'story', path: storySource?.path ?? null }
  }));
  const sourceInvariants = requirementSources
    .flatMap((source) => (source.invariant_hints ?? []).map((text) => ({
      text,
      source: { kind: source.kind, path: source.path }
    })))
    .filter((item) => !storyInvariants.some((invariant) => normalizeText(invariant.text) === normalizeText(item.text)))
    .map((item, index) => ({
      id: `REQ-SRC-${String(index + 1).padStart(3, '0')}`,
      ...item
    }));
  return [...storyInvariants, ...sourceInvariants].slice(0, 24);
}

export function extractInvariantTexts(doc) {
  const sourceKind = doc?.kind ?? inferSourceKind(doc?.path);
  const content = [
    doc?.policy,
    ...(doc?.acceptance_criteria ?? []),
    ...(sourceKind === 'architecture' && doc?.content ? extractDecisionLines(doc.content) : []),
    ...(doc?.content ? extractImportantLines(doc.content) : [])
  ].filter(Boolean);
  const values = [];
  for (const text of content) {
    for (const sentence of splitSentences(text)) {
      const clean = cleanupLine(sentence);
      if (!clean || clean.length < 8) continue;
      if (isDiagnosticNarrative(clean)) continue;
      if (INVARIANT_PATTERNS.some((pattern) => pattern.test(clean))) {
        values.push(clean);
      }
    }
  }
  return [...new Set(values.map((item) => item.slice(0, 240)))].slice(0, 12);
}

function extractDecisionLines(content) {
  return [
    extractRawSection(content, ['Decision', '判断', '決定']),
    extractRawSection(content, ['Consequences', '影響', '結果', '制約'])
  ]
    .filter(Boolean)
    .flatMap((section) => section.split('\n'))
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ''))
    .slice(0, 24);
}

function isDiagnosticNarrative(text) {
  return /^--/.test(text)
    || /npm\s+(?:run\s+)?(?:test|type-?check)|vibepro|graphify|diagnostic|diagnose|hotspot|refactor|runtime file|責務混在|診断|候補|スコア|出現|差分/.test(String(text).toLowerCase());
}

function extractImportantLines(content) {
  return stripFrontmatter(content)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ''))
    .slice(0, 80);
}

export async function resolveCodeFiles(repoRoot, options) {
  const files = options.files?.length > 0
    ? options.files
    : options.fileGroups
      ? [...(options.fileGroups.source?.files ?? [])]
      : await listLikelyRuntimeFiles(repoRoot);
  return [...new Set(files.map(normalizePath))]
    .filter((file) => CODE_EXTENSIONS.has(path.extname(file)))
    .filter((file) => !file.includes('/node_modules/') && !file.startsWith('.vibepro/'))
    .slice(0, MAX_SCAN_FILES);
}

async function listLikelyRuntimeFiles(repoRoot) {
  const roots = [
    path.join(repoRoot, 'src', 'app', 'api'),
    path.join(repoRoot, 'src', 'lib', 'services'),
    path.join(repoRoot, 'src', 'lib', 'actions')
  ];
  const files = [];
  for (const root of roots) {
    files.push(...await listFiles(root));
  }
  return files
    .filter((file) => CODE_EXTENSIONS.has(path.extname(file)))
    .map((file) => normalizePath(path.relative(repoRoot, file)))
    .slice(0, MAX_SCAN_FILES);
}

export async function collectCodeScenarios(repoRoot, files) {
  const scenarios = [];
  for (const file of files) {
    const absolute = path.join(repoRoot, file);
    let content = '';
    try {
      content = await readFile(absolute, 'utf8');
    } catch {
      continue;
    }
    const code = stripBlockComments(content);
    scenarios.push({
      file,
      branches: extractBranches(code),
      state_transitions: extractStateTransitions(code),
      external_effects: extractExternalEffects(code),
      response_messages: extractResponseMessages(code),
      domain_keywords: DOMAIN_KEYWORDS.filter((keyword) => code.toLowerCase().includes(keyword.toLowerCase()))
    });
  }
  return scenarios.filter((scenario) => (
    scenario.branches.length > 0
    || scenario.state_transitions.length > 0
    || scenario.external_effects.length > 0
    || scenario.response_messages.length > 0
  ));
}

function extractBranches(content) {
  const branches = [];
  for (const match of content.matchAll(/\bif\s*\(([^)]{1,180})\)/g)) {
    branches.push({ kind: 'if', condition: cleanupLine(match[1]) });
  }
  for (const match of content.matchAll(/\bcase\s+([^:]{1,120}):/g)) {
    branches.push({ kind: 'case', condition: cleanupLine(match[1]) });
  }
  return branches.slice(0, 30);
}

function extractStateTransitions(content) {
  const transitions = [];
  const patterns = [
    { key: 'userType', pattern: /\bUserType\s*:\s*([0-9]+)/g },
    { key: 'userType', pattern: /\buserType\s*:\s*([0-9]+)/g },
    { key: 'cancelAtPeriodEnd', pattern: /\bcancel(?:_|A)tPeriodEnd\s*:\s*(true|false)/gi },
    { key: 'subscriptionCancelAtPeriodEnd', pattern: /\bSubscriptionCancelAtPeriodEnd\s*:\s*(true|false)/g },
    { key: 'status', pattern: /\bstatus\s*:\s*['"]([^'"]+)['"]/g }
  ];
  for (const { key, pattern } of patterns) {
    for (const match of content.matchAll(pattern)) {
      transitions.push({ key, value: match[1] });
    }
  }
  return transitions.slice(0, 30);
}

function extractExternalEffects(content) {
  const effects = [];
  const patterns = [
    { type: 'db_update', pattern: /\bprisma\.[A-Za-z0-9_$.]+\.update(?:Many)?\s*\(/g },
    { type: 'db_delete', pattern: /\bprisma\.[A-Za-z0-9_$.]+\.delete(?:Many)?\s*\(/g },
    { type: 'stripe_subscription_update', pattern: /\bstripe\.subscriptions\.update\s*\(/g },
    { type: 'webhook_signature', pattern: /\bconstructEvent|verify(?:Webhook|Signature)?\b/g },
    { type: 'notification', pattern: /\b(send|notify|notification|email|resend)\b/gi }
  ];
  for (const { type, pattern } of patterns) {
    for (const match of content.matchAll(pattern)) {
      effects.push({ type, evidence: match[0] });
    }
  }
  return effects.slice(0, 30);
}

function extractResponseMessages(content) {
  return [...content.matchAll(/message\s*:\s*['"`]([^'"`]{4,120})['"`]/g)]
    .map((match) => match[1])
    .slice(0, 20);
}

function buildScenarioGaps({ invariants, codeScenarios, storySource, requirementSources, inferredSpec = null }) {
  if (invariants.length === 0) return [];
  const gaps = [];
  const inferredSpecContext = buildInferredSpecContext(inferredSpec);
  const scopeContext = buildRequirementScopeContext({ storySource, requirementSources, inferredSpecContext });
  const acceptanceText = [
    ...(storySource?.acceptance_criteria ?? []),
    storySource?.policy,
    ...requirementSources.flatMap((source) => [
      ...(source.acceptance_criteria ?? []),
      source.policy
    ]),
    ...inferredSpecContext.texts
  ].filter(Boolean).join('\n').toLowerCase();
  for (const scenario of codeScenarios) {
    for (const branch of scenario.branches) {
      const condition = branch.condition.toLowerCase();
      if (!isDomainBranch(condition)) continue;
      if (isImplementationGuardBranch(branch.condition)) continue;
      if (acceptanceText && acceptanceText.includes(condition.slice(0, 24))) continue;
      if (isBranchCoveredByRequirementScope({ branch, scopeContext })) continue;
      if (isBranchCoveredByInferredSpec({
        branch,
        scenario,
        invariants,
        inferredSpecContext
      })) continue;
      gaps.push({
        id: `REQ-GAP-${String(gaps.length + 1).padStart(3, '0')}`,
        title: 'Requirement Sourcesに明示されていない重要分岐がある',
        detail: `${scenario.file} の \`${branch.condition}\` 分岐が、Story/Spec/Architecture/Policyの受け入れ基準または方針で明示されているか確認が必要。`,
        file: scenario.file,
        evidence: branch,
        related_invariants: relatedInvariantIds(invariants, branch.condition)
      });
      if (gaps.length >= 12) return gaps;
    }
  }
  return gaps;
}

function buildRequirementScopeContext({ storySource, requirementSources, inferredSpecContext }) {
  const texts = [
    storySource?.background,
    storySource?.policy,
    storySource?.content,
    ...(storySource?.acceptance_criteria ?? []),
    ...requirementSources.flatMap((source) => [
      source.background,
      source.policy,
      source.content,
      ...(source.acceptance_criteria ?? [])
    ]),
    ...inferredSpecContext.texts
  ].filter(Boolean);
  return {
    texts: texts.map((text) => ({
      raw: String(text),
      normalized: normalizeComparableText(text),
      inherited_behavior: INHERITED_BEHAVIOR_PATTERNS.some((pattern) => pattern.test(String(text)))
    }))
  };
}

function isBranchCoveredByRequirementScope({ branch, scopeContext }) {
  const conditionTokens = meaningfulConditionTokens(branch.condition);
  if (conditionTokens.length === 0) return false;
  return scopeContext.texts.some((entry) => (
    entry.inherited_behavior && tokensCoveredByText(conditionTokens, entry.normalized)
  ));
}

function buildInferredSpecContext(spec) {
  if (!spec || !Array.isArray(spec.clauses)) {
    return { clauses: [], texts: [] };
  }
  const clauses = spec.clauses
    .filter((clause) => clause && typeof clause.statement === 'string')
    .map((clause) => {
      const codeRefs = Array.isArray(clause.origin?.code_refs) ? clause.origin.code_refs : [];
      const codePatterns = Array.isArray(clause.verifiable_by?.code_pattern) ? clause.verifiable_by.code_pattern : [];
      const files = [
        ...codeRefs.map((ref) => ref?.file),
        ...codePatterns.map((pattern) => pattern?.file_glob)
      ].filter(Boolean).map((file) => normalizePath(file));
      const fragments = [
        ...codeRefs.map((ref) => ref?.anchor),
        ...codePatterns.map((pattern) => pattern?.must_contain)
      ].filter(Boolean).map((value) => String(value));
      const text = [
        clause.id,
        clause.type,
        clause.statement,
        ...files,
        ...fragments
      ].filter(Boolean).join('\n');
      return {
        id: clause.id,
        type: clause.type ?? 'invariant',
        statement: clause.statement,
        files,
        fragments,
        text,
        normalized_text: normalizeComparableText(text)
      };
    });
  return {
    clauses,
    texts: clauses.map((clause) => clause.text)
  };
}

function isBranchCoveredByInferredSpec({ branch, scenario, invariants, inferredSpecContext }) {
  if (!inferredSpecContext?.clauses?.length) return false;
  const inferredInvariants = invariants.filter((invariant) => invariant.source?.kind === 'inferred_spec');
  const relatedIds = new Set(relatedInvariantIds(inferredInvariants, branch.condition));
  const condition = normalizeComparableCode(branch.condition);
  const conditionTokens = meaningfulConditionTokens(branch.condition);

  for (const clause of inferredSpecContext.clauses) {
    const appliesToFile = clauseAppliesToScenario(clause, scenario.file);
    if (appliesToFile && clause.fragments.some((fragment) => codeFragmentCoversCondition(fragment, condition))) {
      return true;
    }
    if (tokensCoveredByText(conditionTokens, clause.normalized_text)) {
      return true;
    }
    if (appliesToFile && relatedIds.has(clause.id) && conditionTokens.some((token) => textIncludesToken(clause.normalized_text, token))) {
      return true;
    }
  }
  return false;
}

function clauseAppliesToScenario(clause, scenarioFile) {
  if (!clause.files.length) return true;
  return clause.files.some((filePattern) => pathPatternMatches(filePattern, scenarioFile));
}

function pathPatternMatches(pattern, filePath) {
  const normalizedPattern = normalizePath(pattern);
  const normalizedFile = normalizePath(filePath);
  if (!normalizedPattern) return false;
  if (normalizedPattern === normalizedFile) return true;
  if (!normalizedPattern.includes('*')) return normalizedFile.endsWith(normalizedPattern);
  const regex = new RegExp(`^${escapeRegExp(normalizedPattern)
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')}$`);
  return regex.test(normalizedFile);
}

function codeFragmentCoversCondition(fragment, normalizedCondition) {
  const normalizedFragment = normalizeComparableCode(fragment);
  if (!normalizedFragment || !normalizedCondition) return false;
  return normalizedCondition.includes(normalizedFragment) || normalizedFragment.includes(normalizedCondition);
}

function tokensCoveredByText(tokens, normalizedText) {
  if (tokens.length === 0 || !normalizedText) return false;
  const matches = tokens.filter((token) => textIncludesToken(normalizedText, token));
  if (matches.some((token) => token.length >= 8)) return true;
  return matches.length >= Math.min(2, tokens.length);
}

function textIncludesToken(normalizedText, token) {
  if (normalizedText.includes(token)) return true;
  return tokenVariants(token).some((variant) => variant.length >= 5 && normalizedText.includes(variant));
}

function tokenVariants(token) {
  const variants = new Set();
  variants.add(token);
  for (const suffix of ['ing', 'ed', 'ion', 'ions', 'ive', 'ives', 'ed']) {
    if (token.length > suffix.length + 4 && token.endsWith(suffix)) {
      variants.add(token.slice(0, -suffix.length));
    }
  }
  if (token.endsWith('ation') && token.length > 9) variants.add(token.slice(0, -5));
  if (token.endsWith('ating') && token.length > 9) variants.add(token.slice(0, -3));
  if (token.endsWith('archive') && token.length > 9) variants.add(token.slice(0, -1));
  return [...variants];
}

function meaningfulConditionTokens(value) {
  return normalizeComparableText(value)
    .split(' ')
    .filter((token) => token.length >= 4 || DOMAIN_KEYWORDS.includes(token))
    .filter((token) => !GENERIC_CONDITION_TOKENS.has(token))
    .slice(0, 8);
}

function normalizeComparableCode(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[?!]/g, '')
    .replace(/\s+/g, '')
    .replace(/['"`]/g, '');
}

function normalizeComparableText(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isImplementationGuardBranch(condition) {
  const normalized = String(condition ?? '').trim();
  const compact = normalized.replace(/\s+/g, ' ');
  const lower = compact.toLowerCase();
  return /^typeof\s+[\w$.[\]?()]+(?:\?\.[\w$.[\]?()]+)*\s*(?:!==|===)\s*['"]function['"]$/.test(lower)
    || /^(?:req|request)\.body\.[\w$.[\]?]+\s*!==\s*undefined$/.test(lower)
    || /^this\.[\w$.[\]?]+\.has\([^)]{1,80}\)?$/.test(lower)
    || /^typeof\s+this\.[\w$.[\]?]+\s*(?:!==|===)\s*['"]function['"]$/.test(lower)
    || /^([a-z_$][\w$]*)\.id\s*!==\s*\1id$/.test(lower);
}

function buildContradictions({ invariants, codeScenarios }) {
  const contradictions = [];
  const premiumUntilEndInvariants = invariants.filter(isPremiumUntilEndInvariant);
  if (premiumUntilEndInvariants.length > 0) {
    for (const scenario of codeScenarios) {
      const userTypes = new Set(
        scenario.state_transitions
          .filter((item) => item.key === 'userType')
          .map((item) => String(item.value))
      );
      if (userTypes.has('1') && userTypes.has('2')) {
        contradictions.push({
          id: `REQ-CON-${String(contradictions.length + 1).padStart(3, '0')}`,
          title: 'premium維持要件と状態遷移が分岐している可能性',
          detail: `${scenario.file} は同じ変更範囲で userType=1 と userType=2 の両方を返す/更新する。期間終了までpremium維持する要件と矛盾しないか確認が必要。`,
          file: scenario.file,
          related_invariants: premiumUntilEndInvariants.map((invariant) => invariant.id).slice(0, 5)
        });
      }
    }
  }
  return contradictions.slice(0, 8);
}

function isPremiumUntilEndInvariant(invariant) {
  const text = normalizeText(invariant?.text ?? '');
  if (/shape|レスポンスshape|response\s*shape/.test(text)) return false;
  return /premium|プレミアム/.test(text)
    && /維持|keep|期間終了|current_period_end|until/.test(text);
}

function isDomainBranch(condition) {
  const normalized = String(condition ?? '').trim().toLowerCase();
  if (!normalized) return false;
  if (isGenericImplementationGuard(normalized)) return false;
  return /user|auth|session|subscription|premium|stripe|webhook|signature|customer|cancel/i.test(normalized);
}

function isGenericImplementationGuard(condition) {
  return /^error\s+instanceof\s+error\b/.test(condition)
    || /^!?found$/.test(condition)
    || /^!?session(?:id)?(?:\s*\|\|\s*![a-z0-9_.$]+)?$/.test(condition)
    || /^!?isinsecureheaderauthallowed\(/.test(condition)
    || /^session\.[a-z0-9_?.]+$/.test(condition)
    || /^sessions\[[^\]]+\]\.[a-z0-9_?.]+\s*!==/.test(condition)
    || /^!?normalizedsessionid$/.test(condition)
    || /^changesnotpushed\s*>/.test(condition)
    || /^result\.notfound\s*\|\|\s*!result\.success$/.test(condition)
    || /^message\.includes\(/.test(condition)
    || /^value\s*===\s*['"][a-z0-9_:-]+['"]$/.test(condition);
}

function relatedInvariantIds(invariants, text) {
  const haystack = text.toLowerCase();
  return invariants
    .filter((invariant) => DOMAIN_KEYWORDS.some((keyword) => (
      haystack.includes(keyword.toLowerCase()) && invariant.text.toLowerCase().includes(keyword.toLowerCase())
    )))
    .map((invariant) => invariant.id)
    .slice(0, 5);
}

export async function parseStoryLikeDocument(repoRoot, absoluteOrRelativeFile, kind = null) {
  const absolute = path.isAbsolute(absoluteOrRelativeFile)
    ? absoluteOrRelativeFile
    : path.join(repoRoot, absoluteOrRelativeFile);
  const content = await readFile(absolute, 'utf8');
  const relative = normalizePath(path.relative(repoRoot, absolute));
  const frontmatter = parseFrontmatter(content);
  return {
    kind: kind ?? inferSourceKind(relative),
    path: relative,
    frontmatter,
    story_id: frontmatter.story_id ?? null,
    title: findMarkdownTitle(content),
    content,
    background: extractSectionText(content, ['背景', '現状', '課題']),
    policy: extractSectionText(content, ['方針', '実装方針', '実装戦略', 'ポリシー']),
    acceptance_criteria: extractAcceptanceCriteria(content)
  };
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const item = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
    if (!item) continue;
    result[item[1]] = item[2].replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function findMarkdownTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function extractSectionText(content, headings) {
  for (const heading of headings) {
    const escaped = escapeRegExp(heading);
    const match = content.match(new RegExp(`^##+\\s+.*${escaped}.*\\n([\\s\\S]*?)(?=^##+\\s+|(?![\\s\\S]))`, 'm'));
    if (!match) continue;
    const paragraph = match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('|') && !line.startsWith('---'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 1200);
    if (paragraph) return paragraph;
  }
  return null;
}

function extractAcceptanceCriteria(content) {
  const section = extractRawSection(content, ['受け入れ基準', '完了定義', 'Acceptance Criteria']);
  const source = section ?? content;
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s+(?:\[[ xX]\]\s+)?/.test(line))
    .map((line) => line.replace(/^-\s+(?:\[[ xX]\]\s+)?/, '').trim())
    .filter(Boolean)
    .slice(0, 16);
}

function extractRawSection(content, headings) {
  for (const heading of headings) {
    const escaped = escapeRegExp(heading);
    const match = content.match(new RegExp(`^##+\\s+.*${escaped}.*\\n([\\s\\S]*?)(?=^##+\\s+|(?![\\s\\S]))`, 'm'));
    if (match) return match[1];
  }
  return null;
}

async function listFiles(root) {
  const result = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vibepro') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else result.push(fullPath);
    }
  }
  await walk(root);
  return result;
}

function splitSentences(text) {
  return String(text)
    .split(/(?<=[。.!?])\s+|\n+/)
    .flatMap((line) => line.split(/(?<=。)/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanupLine(value) {
  return String(value)
    .replace(/^[-*]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  return cleanupLine(value).toLowerCase();
}

function normalizePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function stripBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripFrontmatter(content) {
  return String(content).replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function formatItems(items, formatter) {
  if (!Array.isArray(items) || items.length === 0) return '- なし';
  return items.map(formatter).join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
