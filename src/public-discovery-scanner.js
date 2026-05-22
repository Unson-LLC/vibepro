import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vibepro',
  'coverage',
  'dist',
  'node_modules',
  'graphify-out'
]);

const PAGE_EXTENSIONS = new Set(['.html', '.htm', '.jsx', '.tsx', '.md', '.mdx']);
const AI_BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot'];

export async function scanPublicDiscovery(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = await collectPublicFiles(root);
  const metadataContext = await buildAppRouterMetadataContext(root);
  const suppressionConfig = await readPublicDiscoverySuppressions(root);
  const robots = await readFirstExisting(root, ['robots.txt', 'public/robots.txt']);
  const llms = await readFirstExisting(root, ['llms.txt', 'public/llms.txt']);
  const headerConfig = await inspectHeaderConfig(root);
  const result = {
    schema_version: '0.1.0',
    status: 'pass',
    summary: {
      scanned_files: files.length,
      finding_count: 0,
      structured_data_findings: 0,
      metadata_findings: 0,
      eeat_findings: 0,
      image_findings: 0,
      content_findings: 0,
      ai_bot_findings: 0,
      response_header_findings: 0
    },
    route_targets: [],
    structured_data_findings: [],
    metadata_findings: [],
    eeat_findings: [],
    image_findings: [],
    content_findings: [],
    ai_bot_findings: [],
    response_header_findings: [],
    risk_summary: {
      structured_data_findings: { block: 0, review: 0, info: 0 },
      metadata_findings: { block: 0, review: 0, info: 0 },
      eeat_findings: { block: 0, review: 0, info: 0 },
      image_findings: { block: 0, review: 0, info: 0 },
      content_findings: { block: 0, review: 0, info: 0 },
      ai_bot_findings: { block: 0, review: 0, info: 0 },
      response_header_findings: { block: 0, review: 0, info: 0 }
    },
    robots: {
      path: robots?.relativePath ?? null,
      ai_bot_policy: robots ? inspectAiBotPolicy(robots.content) : {}
    },
    llms: {
      path: llms?.relativePath ?? null,
      present: Boolean(llms)
    },
    header_config: headerConfig,
    suppressions: {
      path: suppressionConfig.path,
      entries: suppressionConfig.entries,
      suppressed_findings: [],
      warnings: suppressionConfig.warnings
    }
  };

  for (const file of files) {
    const content = await readFile(file.absolutePath, 'utf8');
    const target = classifyPublicDiscoveryTarget(file.relativePath, content);
    result.route_targets.push(target);
    if (target.scan_mode === 'skip') continue;
    inspectPage(result, file.relativePath, content, {
      target,
      metadata: resolvePageMetadataContext(file.relativePath, content, metadataContext)
    });
  }
  inspectRepositoryPublicDiscovery(result, { robots, llms, headerConfig });
  applySuppressions(result, suppressionConfig);

  for (const key of Object.keys(result.risk_summary)) {
    result.risk_summary[key] = summarizeGateEffects(result[key]);
    result.summary[key] = result[key].length;
  }
  result.summary.route_targets = summarizeRouteTargets(result.route_targets);
  result.summary.suppressed_findings = result.suppressions.suppressed_findings.length;
  result.summary.suppression_warnings = result.suppressions.warnings.length;
  result.summary.finding_count = Object.keys(result.risk_summary)
    .reduce((total, key) => total + result[key].length, 0);
  result.status = Object.values(result.risk_summary).some((summary) => summary.block > 0)
    ? 'fail'
    : Object.values(result.risk_summary).some((summary) => summary.review > 0)
      ? 'needs_review'
      : 'pass';
  return result;
}

function inspectPage(result, file, content, context = {}) {
  const plainText = stripMarkup(content);
  const metadata = context.metadata ?? resolvePageMetadataContext(file, content, { layouts: [] });
  if (metadata.title === 'absent') {
    result.metadata_findings.push(finding('missing_title', file, firstLine(content), 'review', '公開ページには検索結果とAI要約の基準になるtitleを明示する。', { evidence: 'absent', target_type: context.target?.target_type }));
  }
  if (metadata.description === 'absent') {
    result.metadata_findings.push(finding('missing_meta_description', file, firstLine(content), 'review', '公開ページには内容を説明するmeta descriptionを明示する。', { evidence: 'absent', target_type: context.target?.target_type }));
  }
  if (!/rel=["']canonical["']|alternates\s*:/i.test(content)) {
    result.metadata_findings.push(finding('missing_canonical_hint', file, firstLine(content), 'info', 'canonical URLまたはNext metadata alternatesを明示すると、引用元URLの揺れを減らせる。', { target_type: context.target?.target_type }));
  }
  if (metadata.social === 'absent') {
    result.metadata_findings.push(finding('missing_social_metadata', file, firstLine(content), 'info', 'OGP/Twitter metadataがないため、共有時の文脈が弱くなる可能性がある。', { evidence: 'absent', target_type: context.target?.target_type }));
  }
  if (metadata.structured_data === 'absent') {
    result.structured_data_findings.push(finding('missing_structured_data_hint', file, firstLine(content), 'review', 'Organization、Article、FAQPage、Productなど、ページ目的に合うschema.org構造化データを検討する。', { evidence: 'absent', target_type: context.target?.target_type }));
  }
  if (!/\b(author|著者|監修|editor|published|datePublished|updated|dateModified)\b/i.test(content)) {
    result.eeat_findings.push(finding('missing_author_or_date_signal', file, firstLine(content), 'review', '著者、公開日、更新日、監修者などのE-E-A-Tシグナルが静的に確認できない。', { target_type: context.target?.target_type }));
  }
  if (!/\b(company|about|contact|privacy|terms|運営会社|会社概要|問い合わせ|プライバシー|利用規約)\b/i.test(content)) {
    result.eeat_findings.push(finding('missing_operator_trust_signal', file, firstLine(content), 'info', '運営者、問い合わせ、ポリシー導線などの信頼シグナルを確認する。', { target_type: context.target?.target_type }));
  }
  inspectImages(result, file, content);
  if (plainText.length > 0 && plainText.length < 600) {
    result.content_findings.push(finding('thin_public_content', file, firstLine(content), 'info', '本文量が少ないため、AI検索で引用できる説明文脈が不足する可能性がある。'));
  }
  if (!/href=["'][^"']+["']|<Link\b|router\.push/i.test(content)) {
    result.content_findings.push(finding('missing_internal_or_external_links', file, firstLine(content), 'info', '関連ページ、根拠資料、問い合わせなどへのリンク導線が静的に確認できない。'));
  }
  if (!/\b(FAQ|よくある質問|Q&A|Question|Answer)\b/i.test(content)) {
    result.content_findings.push(finding('missing_faq_structure_hint', file, firstLine(content), 'info', 'FAQ形式の疑問回答があると、AI検索の質問応答に拾われやすくなる。'));
  }
}

function inspectImages(result, file, content) {
  const imagePattern = /<img\b[^>]*>|<Image\b[^>]*>/gi;
  let match;
  while ((match = imagePattern.exec(content)) !== null) {
    const tag = match[0];
    const line = lineNumberAt(content, match.index);
    if (!/\balt\s*=/.test(tag)) {
      result.image_findings.push(finding('image_missing_alt', file, line, 'review', '画像にはAI/検索/アクセシビリティ向けにaltを明示する。'));
    }
    if (!/\b(width|height)\s*=/.test(tag)) {
      result.image_findings.push(finding('image_missing_dimensions', file, line, 'info', '画像のwidth/heightを明示するとCLSと読み込み品質を安定させやすい。'));
    }
    if (!/\bloading=["']lazy["']|priority\s*=|fetchPriority\s*=/i.test(tag)) {
      result.image_findings.push(finding('image_loading_policy_unspecified', file, line, 'info', '画像のlazy/priority方針が静的に確認できない。'));
    }
  }
}

function inspectRepositoryPublicDiscovery(result, { robots, llms, headerConfig }) {
  if (!robots) {
    result.ai_bot_findings.push(finding('robots_txt_missing', 'robots.txt', 1, 'review', 'AIボットと検索クローラーの許可/拒否方針をrobots.txtで明示する。'));
  } else {
    for (const bot of AI_BOTS) {
      if (!new RegExp(`User-agent:\\s*${escapeRegExp(bot)}\\b`, 'i').test(robots.content)) {
        result.ai_bot_findings.push(finding('ai_bot_policy_missing', robots.relativePath, 1, 'info', `${bot}へのクロール方針が明示されていない。`));
      }
    }
  }
  if (!llms) {
    result.ai_bot_findings.push(finding('llms_txt_missing', 'llms.txt', 1, 'info', 'llms.txtや同等のAI向けサイト説明がないため、任意で追加を検討する。'));
  }
  if (!headerConfig.has_config) {
    result.response_header_findings.push(finding('response_header_config_not_detected', 'headers config', 1, 'info', 'Cache-Control、Content-Encoding、HSTS、X-Content-Type-Options、CSP/frame-ancestorsなどの公開レスポンスヘッダー設定を確認する。'));
    return;
  }
  for (const header of ['cache-control', 'x-content-type-options', 'strict-transport-security']) {
    if (!headerConfig.headers.some((candidate) => candidate.toLowerCase() === header)) {
      result.response_header_findings.push(finding('response_header_not_detected', headerConfig.files.join(', '), 1, 'info', `${header} が静的設定から確認できない。`));
    }
  }
}

async function collectPublicFiles(root) {
  const candidates = await walk(root);
  return candidates
    .filter((file) => PAGE_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase()))
    .filter((file) => isPublicPageFile(file.relativePath))
    .slice(0, 400);
}

function isPublicPageFile(relativePath) {
  if (relativePath === 'index.html') return true;
  if (/^public\/.*\.html?$/i.test(relativePath)) return true;
  if (/^(src\/)?app\/.*\/page\.(jsx|tsx|mdx)$/i.test(relativePath)) return true;
  if (/^(src\/)?pages\/.*\.(jsx|tsx|mdx|md|html?)$/i.test(relativePath)) return true;
  if (/^content\/.*\.(md|mdx|html?)$/i.test(relativePath)) return true;
  return false;
}

function classifyPublicDiscoveryTarget(relativePath, content) {
  const segments = relativePath.split('/');
  const route = routePathForFile(relativePath);
  if (isVerificationHtml(relativePath, content)) {
    return target(relativePath, route, 'verification_file', 'skip', 'site_verification_file');
  }
  if (segments.some((segment) => /^(demo|test|sandbox|playground)$/i.test(segment))) {
    return target(relativePath, route, 'internal_dev_route', 'skip', 'demo_or_dev_segment');
  }
  if (segments.includes('(auth)') || /(^|\/)api\/auth(\/|$)|(^|\/)auth(\/|$)|sign[_-]?in|sign[_-]?up|login/i.test(relativePath)) {
    return target(relativePath, route, 'auth_flow', 'skip', 'auth_route');
  }
  if (segments.includes('(app)') || /(^|\/)(profile|manager|admin|dashboard|mypage)(\/|$)/i.test(relativePath)) {
    return target(relativePath, route, 'private_app_route', 'skip', 'private_app_route');
  }
  if (/log[_-]?viewer|shadow-call|internal|debug|legacy/i.test(relativePath)) {
    return target(relativePath, route, 'internal_dev_route', 'skip', 'internal_route');
  }
  if (/robots\s*:\s*{[^}]*noIndex\s*:\s*true|noindex/i.test(content)) {
    return target(relativePath, route, 'private_app_route', 'skip', 'noindex');
  }
  if (/support|help|faq|contact/i.test(relativePath)) {
    return target(relativePath, route, 'public_utility', 'scan', 'public_utility_route');
  }
  return target(relativePath, route, 'public_seo_target', 'scan', 'public_page');
}

function target(file, route, targetType, scanMode, reason) {
  return { file, route, target_type: targetType, scan_mode: scanMode, reason };
}

function isVerificationHtml(relativePath, content) {
  if (!/^public\/.*\.html?$/i.test(relativePath)) return false;
  const basename = path.basename(relativePath).toLowerCase();
  if (/^google[a-z0-9_-]*\.html$/i.test(basename) && /google-site-verification|google site verification/i.test(content)) return true;
  return /verification/i.test(basename);
}

function routePathForFile(relativePath) {
  let route = relativePath
    .replace(/^src\/app\//, '/')
    .replace(/^app\//, '/')
    .replace(/^src\/pages\//, '/')
    .replace(/^pages\//, '/')
    .replace(/^public\//, '/')
    .replace(/\/page\.(jsx|tsx|mdx)$/i, '')
    .replace(/\.(jsx|tsx|mdx|md|html?)$/i, '')
    .replace(/\/index$/i, '/')
    .replace(/\/\([^/)]+\)/g, '');
  if (!route.startsWith('/')) route = `/${route}`;
  return route.replace(/\/+/g, '/');
}

async function buildAppRouterMetadataContext(root) {
  const files = await walk(root);
  const layouts = [];
  for (const file of files) {
    if (!/^(src\/)?app\/.*\/layout\.(jsx|tsx|mdx)$/i.test(file.relativePath) && !/^(src\/)?app\/layout\.(jsx|tsx|mdx)$/i.test(file.relativePath)) continue;
    const content = await readFile(file.absolutePath, 'utf8');
    layouts.push({
      file: file.relativePath,
      dir: file.relativePath.replace(/\/layout\.(jsx|tsx|mdx)$/i, ''),
      metadata: extractMetadataSignals(content)
    });
  }
  return { layouts };
}

function resolvePageMetadataContext(relativePath, content, context) {
  const local = extractMetadataSignals(content);
  const inherited = matchingLayouts(relativePath, context.layouts ?? [])
    .map((layout) => layout.metadata)
    .reduce((merged, signals) => mergeMetadataSignals(merged, signals), emptyMetadataSignals());
  return {
    title: local.title ? 'local' : inherited.title ? 'inherited' : 'absent',
    description: local.description ? 'local' : inherited.description ? 'inherited' : 'absent',
    social: local.social ? 'local' : inherited.social ? 'inherited' : 'absent',
    structured_data: local.structured_data ? 'local' : inherited.structured_data ? 'inherited' : 'absent'
  };
}

function matchingLayouts(relativePath, layouts) {
  const pageDir = relativePath.replace(/\/page\.(jsx|tsx|mdx)$/i, '');
  return layouts.filter((layout) => pageDir === layout.dir || pageDir.startsWith(`${layout.dir}/`));
}

function extractMetadataSignals(content) {
  return {
    title: hasTitle(content),
    description: hasMetaDescription(content),
    social: /property=["']og:|twitter:|openGraph\s*:|twitter\s*:/i.test(content),
    structured_data: /application\/ld\+json|schema\.org|jsonLd|structuredData/i.test(content)
  };
}

function emptyMetadataSignals() {
  return { title: false, description: false, social: false, structured_data: false };
}

function mergeMetadataSignals(a, b) {
  return {
    title: a.title || b.title,
    description: a.description || b.description,
    social: a.social || b.social,
    structured_data: a.structured_data || b.structured_data
  };
}

async function walk(root, dir = root) {
  const entries = await safeReaddir(dir);
  const files = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
    if (entry.isDirectory()) {
      files.push(...await walk(root, absolutePath));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

async function inspectHeaderConfig(root) {
  const candidates = ['vercel.json', 'next.config.js', 'next.config.mjs', 'next.config.ts', 'public/_headers', 'netlify.toml'];
  const files = [];
  const headers = new Set();
  for (const relativePath of candidates) {
    const content = await readOptional(path.join(root, relativePath));
    if (content === null) continue;
    files.push(relativePath);
    for (const header of ['Cache-Control', 'Content-Encoding', 'X-Content-Type-Options', 'X-Frame-Options', 'Strict-Transport-Security', 'Content-Security-Policy']) {
      if (new RegExp(header, 'i').test(content)) headers.add(header.toLowerCase());
    }
  }
  return { has_config: files.length > 0, files, headers: [...headers] };
}

async function readFirstExisting(root, relativePaths) {
  for (const relativePath of relativePaths) {
    const content = await readOptional(path.join(root, relativePath));
    if (content !== null) return { relativePath, content };
  }
  return null;
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readPublicDiscoverySuppressions(root) {
  const relativePath = '.vibepro/public-discovery-suppressions.json';
  const content = await readOptional(path.join(root, relativePath));
  if (content === null) return { path: null, entries: [], warnings: [] };
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      path: relativePath,
      entries: [],
      warnings: [suppressionWarning('invalid_json', relativePath, `Suppression file is not valid JSON: ${error.message}`)]
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      path: relativePath,
      entries: [],
      warnings: [suppressionWarning('invalid_shape', relativePath, 'Suppression file must be an array')]
    };
  }
  const entries = [];
  const warnings = [];
  for (const [index, entry] of parsed.entries()) {
    if (!entry?.file || !Array.isArray(entry.finding_kinds) || !entry.reason) {
      warnings.push(suppressionWarning('invalid_entry', relativePath, `Suppression entry ${index} requires file, finding_kinds, and reason`));
      continue;
    }
    entries.push({
      file: entry.file,
      finding_kinds: entry.finding_kinds,
      reason: entry.reason,
      expires_at: entry.expires_at ?? null
    });
  }
  return { path: relativePath, entries, warnings };
}

function applySuppressions(result, suppressionConfig) {
  if (suppressionConfig.entries.length === 0) return;
  const knownKinds = new Set();
  const matchedEntries = new Set();
  for (const group of findingGroups()) {
    const kept = [];
    for (const item of result[group]) {
      knownKinds.add(item.kind);
      const suppression = suppressionConfig.entries.find((entry, index) => {
        const matched = globMatches(entry.file, item.file) && entry.finding_kinds.includes(item.kind);
        if (matched) matchedEntries.add(index);
        return matched;
      });
      if (suppression) {
        result.suppressions.suppressed_findings.push({
          ...item,
          suppression: {
            file: suppression.file,
            reason: suppression.reason,
            expires_at: suppression.expires_at
          }
        });
      } else {
        kept.push(item);
      }
    }
    result[group] = kept;
  }
  for (const [index, entry] of suppressionConfig.entries.entries()) {
    for (const kind of entry.finding_kinds) {
      if (!knownKinds.has(kind)) {
        result.suppressions.warnings.push(suppressionWarning('unknown_finding_kind', entry.file, `Suppression entry ${index} references unknown finding kind: ${kind}`));
      }
    }
    if (!matchedEntries.has(index)) {
      result.suppressions.warnings.push(suppressionWarning('unmatched_suppression', entry.file, `Suppression entry ${index} did not match any finding`));
    }
  }
}

function findingGroups() {
  return [
    'structured_data_findings',
    'metadata_findings',
    'eeat_findings',
    'image_findings',
    'content_findings',
    'ai_bot_findings',
    'response_header_findings'
  ];
}

function suppressionWarning(kind, file, message) {
  return { kind, file, message };
}

function globMatches(pattern, value) {
  const escaped = pattern
    .split('*')
    .map((part) => escapeRegExp(part))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function summarizeRouteTargets(routeTargets) {
  const summary = {};
  for (const item of routeTargets) {
    summary[item.target_type] = (summary[item.target_type] ?? 0) + 1;
  }
  return summary;
}

async function safeReaddir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
}

function inspectAiBotPolicy(content) {
  return Object.fromEntries(AI_BOTS.map((bot) => [bot, new RegExp(`User-agent:\\s*${escapeRegExp(bot)}\\b`, 'i').test(content) ? 'explicit' : 'not_detected']));
}

function finding(kind, file, line, gateEffect, recommendation, extra = {}) {
  return { kind, file, line, gate_effect: gateEffect, recommendation, ...extra };
}

function summarizeGateEffects(hits) {
  const summary = { block: 0, review: 0, info: 0 };
  for (const hit of hits) {
    const effect = ['block', 'review', 'info'].includes(hit.gate_effect) ? hit.gate_effect : 'info';
    summary[effect] += 1;
  }
  return summary;
}

function hasTitle(content) {
  return /<title>[^<]+<\/title>/i.test(content) || /\btitle\s*[:=]\s*['"`][^'"`]+['"`]/i.test(content);
}

function hasMetaDescription(content) {
  return /<meta\s+[^>]*name=["']description["'][^>]*content=["'][^"']+["']/i.test(content)
    || /\bdescription\s*[:=]\s*['"`][^'"`]+['"`]/i.test(content);
}

function stripMarkup(content) {
  return content
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstLine(_content) {
  return 1;
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
