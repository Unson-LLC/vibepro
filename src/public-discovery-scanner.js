import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { buildScanCoverage, resolveScanConclusiveness } from './scan-status.js';

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
const LIVE_LIMITS = Object.freeze({ max_pages: 40, max_response_bytes: 2 * 1024 * 1024, timeout_ms: 10_000 });
const BUILT_LIMITS = Object.freeze({ max_pages: 400, max_response_bytes: null, timeout_ms: null });
const SOURCE_LIMITS = Object.freeze({ max_pages: 400, max_response_bytes: null, timeout_ms: null });
const OMISSION_SAMPLE_LIMIT = 25;

export async function scanPublicDiscovery(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const collected = await collectDiscoveryTargets(root, options);
  const files = collected.pages;
  const metadataContext = collected.mode === 'source'
    ? await buildAppRouterMetadataContext(root)
    : { layouts: [] };
  const suppressionConfig = await readPublicDiscoverySuppressions(root);
  const { robots, llms, headerConfig } = collected;
  const result = {
    schema_version: '0.2.0',
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
    scan_coverage: null,
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

  let scannedCount = 0;
  for (const file of files) {
    let content = file.content;
    if (content === undefined) {
      try {
        content = await readFile(file.absolutePath, 'utf8');
      } catch (error) {
        collected.errors.push({ target: file.relativePath, reason: `公開ページを読み込めない / failed to read public page: ${error.message}` });
        continue;
      }
    }
    const target = classifyPublicDiscoveryTarget(file.relativePath, content);
    result.route_targets.push(target);
    if (target.scan_mode === 'skip') continue;
    scannedCount += 1;
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
  const findingStatus = Object.values(result.risk_summary).some((summary) => summary.block > 0)
    ? 'fail'
    : Object.values(result.risk_summary).some((summary) => summary.review > 0)
      ? 'needs_review'
      : 'pass';
  const coverageVerdict = resolveScanConclusiveness({ scannedCount, applicable: true });
  result.scan_coverage = {
    mode: collected.mode,
    ...buildScanCoverage({ scannedCount, roots: collected.roots }),
    discovered_count: collected.discoveredCount,
    eligible_count: collected.eligibleCount,
    selected_count: collected.selectedCount,
    omitted_count: collected.omittedCount,
    omission_summary: collected.omissionSummary,
    omissions: collected.omissions,
    omission_samples_truncated: collected.omittedCount > collected.omissions.length,
    failed_count: collected.errors.length,
    errors: collected.errors,
    limits: collected.limits,
    status: coverageVerdict.status ?? (findingStatus === 'pass' ? 'pass' : findingStatus),
    reason: coverageVerdict.reason
      ? `${coverageVerdict.reason} ${coverageRecoveryHint(collected.mode)}`
      : null
  };
  result.summary.scanned_files = scannedCount;
  result.summary.discovered_files = collected.discoveredCount;
  result.summary.failed_targets = collected.errors.length;
  result.status = findingStatus === 'pass' ? result.scan_coverage.status : findingStatus;
  if (result.status === 'inconclusive') result.reason = result.scan_coverage.reason;
  return result;
}

async function collectDiscoveryTargets(root, options) {
  if (options.baseUrl) return collectLiveTargets(options.baseUrl, options.fetchImpl ?? globalThis.fetch, options.liveLimits ?? LIVE_LIMITS);
  if (options.publicDir) return collectBuiltTargets(root, options.publicDir);
  const discoveredPages = await collectPublicFiles(root);
  const pages = discoveredPages.slice(0, SOURCE_LIMITS.max_pages);
  const omittedCandidates = discoveredPages.slice(SOURCE_LIMITS.max_pages).map((file) => ({
    target: file.relativePath,
    reason_code: 'page_limit',
    reason: `source page omitted by max_pages=${SOURCE_LIMITS.max_pages}`
  }));
  return {
    mode: 'source',
    roots: ['index.html', 'public/**/*.html', 'app/**/page.*', 'pages/**/*', 'content/**/*'],
    pages,
    discoveredCount: discoveredPages.length,
    eligibleCount: discoveredPages.length,
    selectedCount: pages.length,
    ...summarizeOmissions(omittedCandidates),
    errors: [],
    limits: SOURCE_LIMITS,
    robots: await readFirstExisting(root, ['robots.txt', 'public/robots.txt']),
    llms: await readFirstExisting(root, ['llms.txt', 'public/llms.txt']),
    headerConfig: await inspectHeaderConfig(root)
  };
}

async function collectBuiltTargets(root, publicDir) {
  const publicRoot = path.resolve(root, publicDir);
  const repoRelativeRoot = path.relative(root, publicRoot).replaceAll(path.sep, '/') || '.';
  const errors = [];
  if (repoRelativeRoot === '..' || repoRelativeRoot.startsWith('../') || path.isAbsolute(repoRelativeRoot)) {
    errors.push({ target: String(publicDir), reason: '公開ディレクトリはrepository内でなければならない / public directory must stay inside the repository' });
    return emptyCollected('built', [String(publicDir)], errors, BUILT_LIMITS);
  }
  try {
    const details = await stat(publicRoot);
    if (!details.isDirectory()) {
      errors.push({ target: repoRelativeRoot, reason: '指定した公開パスはdirectoryではない / explicit public path is not a directory' });
      return emptyCollected('built', [repoRelativeRoot], errors, BUILT_LIMITS);
    }
    const [realRoot, realPublicRoot] = await Promise.all([realpath(root), realpath(publicRoot)]);
    const realRelative = path.relative(realRoot, realPublicRoot);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      errors.push({ target: repoRelativeRoot, reason: '公開ディレクトリのsymlinkはrepository外を指せない / public directory symlink must not escape the repository' });
      return emptyCollected('built', [repoRelativeRoot], errors, BUILT_LIMITS);
    }
  } catch (error) {
    errors.push({ target: repoRelativeRoot, reason: `指定した公開ディレクトリが存在しない / explicit public directory does not exist: ${error.message}` });
    return emptyCollected('built', [repoRelativeRoot], errors, BUILT_LIMITS);
  }
  const discoveredCandidates = (await walk(publicRoot, publicRoot, { ignoredDirs: null }))
    .filter((file) => ['.html', '.htm'].includes(path.extname(file.relativePath).toLowerCase()));
  const omittedCandidates = discoveredCandidates.slice(BUILT_LIMITS.max_pages).map((file) => ({
    target: path.posix.join(repoRelativeRoot, file.relativePath),
    reason_code: 'page_limit',
    reason: `built page omitted by max_pages=${BUILT_LIMITS.max_pages}`
  }));
  const candidates = discoveredCandidates
    .slice(0, BUILT_LIMITS.max_pages)
    .map((file) => ({
      ...file,
      relativePath: path.posix.join(repoRelativeRoot, file.relativePath)
    }));
  const prefixEvidence = (entry) => entry
    ? { ...entry, relativePath: path.posix.join(repoRelativeRoot, entry.relativePath) }
    : null;
  return {
    mode: 'built',
    roots: [repoRelativeRoot],
    pages: candidates,
    discoveredCount: discoveredCandidates.length,
    eligibleCount: discoveredCandidates.length,
    selectedCount: candidates.length,
    ...summarizeOmissions(omittedCandidates),
    errors,
    limits: BUILT_LIMITS,
    robots: prefixEvidence(await readFirstExisting(publicRoot, ['robots.txt'])),
    llms: prefixEvidence(await readFirstExisting(publicRoot, ['llms.txt'])),
    headerConfig: await inspectHeaderConfig(publicRoot)
  };
}

async function collectLiveTargets(baseUrl, fetchImpl, limits = LIVE_LIMITS) {
  const errors = [];
  let base;
  try {
    base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('only HTTP(S) URLs are supported');
  } catch (error) {
    errors.push({ target: String(baseUrl), reason: `base URLは有効なHTTP(S) URLでなければならない / base URL must be a valid HTTP(S) URL: ${error.message}` });
    return emptyCollected('live', [String(baseUrl)], errors, limits);
  }
  if (typeof fetchImpl !== 'function') {
    errors.push({ target: base.href, reason: 'HTTP fetch implementation is unavailable; provide a runtime with global fetch' });
    return emptyCollected('live', [base.href], errors, limits);
  }

  const rootResult = await fetchBounded(fetchImpl, base, limits, 'page');
  if (rootResult.error) errors.push(rootResult.error);
  const robotsUrl = new URL('/robots.txt', base);
  const llmsUrl = new URL('/llms.txt', base);
  const sitemapUrl = new URL('/sitemap.xml', base);
  const [robotsResult, llmsResult, sitemapResult] = await Promise.all([
    fetchBounded(fetchImpl, robotsUrl, limits, 'support'),
    fetchBounded(fetchImpl, llmsUrl, limits, 'support'),
    fetchBounded(fetchImpl, sitemapUrl, limits, 'sitemap')
  ]);
  for (const response of [robotsResult, llmsResult, sitemapResult]) {
    if (response.error) errors.push(response.error);
  }

  const pageUrls = [base];
  const eligibleUrls = new Set([base.href]);
  const omissions = [];
  let sitemapLocations = [];
  if (sitemapResult.content) {
    const parsedSitemap = parseSitemapLocations(sitemapResult.content);
    sitemapLocations = parsedSitemap.locations;
    if (parsedSitemap.error) errors.push({ target: sitemapUrl.href, reason: parsedSitemap.error });
    for (const location of sitemapLocations) {
      try {
        const candidate = new URL(location, base);
        if (!['http:', 'https:'].includes(candidate.protocol)) {
          omissions.push({ target: location, reason_code: 'non_http', reason: 'sitemap location is not HTTP(S)' });
          continue;
        }
        if (candidate.origin !== base.origin) {
          omissions.push({ target: candidate.href, reason_code: 'cross_origin', reason: 'sitemap location is outside the base origin' });
          continue;
        }
        if (eligibleUrls.has(candidate.href)) {
          omissions.push({ target: candidate.href, reason_code: 'duplicate', reason: 'duplicate sitemap location' });
          continue;
        }
        eligibleUrls.add(candidate.href);
        if (pageUrls.length < limits.max_pages) {
          pageUrls.push(candidate);
        } else {
          omissions.push({ target: candidate.href, reason_code: 'page_limit', reason: `live page omitted by max_pages=${limits.max_pages}` });
        }
      } catch {
        errors.push({ target: location, reason: 'sitemap locをURLとして解釈できない / sitemap loc is not a valid URL' });
        omissions.push({ target: location, reason_code: 'invalid_url', reason: 'sitemap location is not a valid URL' });
      }
    }
  }

  const pages = [];
  for (const pageUrl of pageUrls) {
    const fetched = pageUrl.href === base.href ? rootResult : await fetchBounded(fetchImpl, pageUrl, limits, 'page');
    if (fetched.error) {
      if (pageUrl.href !== base.href) errors.push(fetched.error);
      continue;
    }
    if (!looksLikeHtml(fetched.content, fetched.contentType)) {
      errors.push({ target: pageUrl.href, reason: '公開ページ応答がHTMLではない / public page response is not HTML' });
      continue;
    }
    pages.push({
      relativePath: `${pageUrl.pathname || '/'}${pageUrl.search}`,
      content: fetched.content
    });
  }
  const rootHeaders = rootResult.headers ?? [];
  return {
    mode: 'live',
    roots: [base.href],
    pages,
    discoveredCount: 1 + sitemapLocations.length,
    eligibleCount: eligibleUrls.size,
    selectedCount: pageUrls.length,
    ...summarizeOmissions(omissions),
    errors,
    limits,
    robots: robotsResult.content ? { relativePath: robotsUrl.href, content: robotsResult.content } : null,
    llms: llmsResult.content ? { relativePath: llmsUrl.href, content: llmsResult.content } : null,
    headerConfig: { has_config: rootHeaders.length > 0, files: [base.href], headers: rootHeaders }
  };
}

function emptyCollected(mode, roots, errors, limits) {
  return {
    mode,
    roots,
    pages: [],
    discoveredCount: 0,
    eligibleCount: 0,
    selectedCount: 0,
    omittedCount: 0,
    omissionSummary: {},
    omissions: [],
    errors,
    limits,
    robots: null,
    llms: null,
    headerConfig: { has_config: false, files: [], headers: [] }
  };
}

async function fetchBounded(fetchImpl, url, limits, kind) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeout_ms);
  try {
    const response = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', signal: controller.signal });
    if (!response?.ok) {
      return { error: { target: url.href, reason: `${kind} GET returned HTTP ${response?.status ?? 'unknown'}` } };
    }
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > limits.max_response_bytes) {
      return { error: { target: url.href, reason: `${kind} response exceeds ${limits.max_response_bytes} bytes` } };
    }
    const bytes = await readBoundedResponseBody(response, limits.max_response_bytes);
    if (bytes === null) {
      return { error: { target: url.href, reason: `${kind} response exceeds ${limits.max_response_bytes} bytes` } };
    }
    return {
      content: bytes.toString('utf8'),
      contentType: response.headers?.get?.('content-type') ?? null,
      headers: response.headers ? [...response.headers.keys()].map((name) => name.toLowerCase()) : []
    };
  } catch (error) {
    return { error: { target: url.href, reason: `${kind} GET failed: ${error.message}` } };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponseBody(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= maxBytes ? bytes : null;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel('response size limit exceeded');
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function parseSitemapLocations(content) {
  const rootMatch = content.match(/<(urlset|sitemapindex)\b/i);
  const rootName = rootMatch?.[1]?.toLowerCase() ?? null;
  const rootClosed = rootName ? new RegExp(`</${rootName}\\s*>`, 'i').test(content) : false;
  const openLocCount = [...content.matchAll(/<loc\b/gi)].length;
  const closeLocCount = [...content.matchAll(/<\/loc\s*>/gi)].length;
  if (!rootName || !rootClosed || openLocCount !== closeLocCount) {
    return {
      locations: [],
      error: 'sitemap XMLを解釈できない / sitemap XML is malformed or has an unsupported root'
    };
  }
  return {
    locations: [...content.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].trim().replaceAll('&amp;', '&'))
    .filter(Boolean),
    error: null
  };
}

function summarizeOmissions(items) {
  const omissionSummary = {};
  for (const item of items) {
    omissionSummary[item.reason_code] = (omissionSummary[item.reason_code] ?? 0) + 1;
  }
  return {
    omittedCount: items.length,
    omissionSummary,
    omissions: items.slice(0, OMISSION_SAMPLE_LIMIT)
  };
}

function looksLikeHtml(content, contentType) {
  if (contentType && !/^\s*(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) return false;
  return /<!doctype\s+html|<html\b|<head\b|<body\b|<main\b/i.test(content);
}

function coverageRecoveryHint(mode) {
  if (mode === 'live') return '到達可能な公開URLを --base-url で指定する / provide a reachable public URL with --base-url.';
  if (mode === 'built') return 'HTMLを含むbuild出力directoryを --public-dir で指定する / provide a build output directory containing HTML with --public-dir.';
  return '公開ページsourceを追加するか、--public-dir / --base-url で実ターゲットを指定する / add public page sources or provide real targets with --public-dir / --base-url.';
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
    .filter((file) => isPublicPageFile(file.relativePath));
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

async function walk(root, dir = root, { ignoredDirs = IGNORED_DIRS } = {}) {
  const entries = await safeReaddir(dir);
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs?.has(entry.name)) continue;
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
    if (entry.isDirectory()) {
      files.push(...await walk(root, absolutePath, { ignoredDirs }));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

async function inspectHeaderConfig(root) {
  const candidates = ['vercel.json', 'next.config.js', 'next.config.mjs', 'next.config.ts', '_headers', 'public/_headers', 'netlify.toml'];
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
    return (await readdir(dir, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
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
