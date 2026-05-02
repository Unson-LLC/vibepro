import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROUTE_FILE_PATTERN = /^(?:src\/)?app\/api\/(.+)\/route\.(js|jsx|ts|tsx)$/;
const MIDDLEWARE_FILES = ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js'];

export async function scanApiBoundary(repoRoot, architectureProfile) {
  const root = path.resolve(repoRoot);
  const entrypoints = architectureProfile?.views?.runtime?.entrypoints ?? [];
  const apiRouteFiles = entrypoints.filter((file) => ROUTE_FILE_PATTERN.test(file));
  const middleware = await readMiddlewareMatchers(root, architectureProfile);
  const routes = [];

  for (const file of apiRouteFiles) {
    const routePath = routePathFromFile(file);
    const content = await readTextIfExists(path.join(root, file));
    const classification = classifyRoute(routePath);
    const protection = await classifyProtection({ repoRoot: root, file, routePath, classification, middleware, content });
    const riskHints = collectRiskHints({ routePath, classification, protection, content });
    routes.push({
      file,
      route_path: routePath,
      classification,
      methods: detectMethods(content),
      protection,
      risk_hints: riskHints
    });
  }

  return {
    route_count: routes.length,
    middleware,
    routes,
    summary: summarizeRoutes(routes),
    protection_summary: summarizeProtection(routes)
  };
}

function routePathFromFile(file) {
  const match = ROUTE_FILE_PATTERN.exec(file);
  if (!match) return null;
  return `/api/${match[1]}`;
}

function classifyRoute(routePath) {
  const normalized = routePath.toLowerCase();
  if (normalized.includes('/admin')) return 'admin';
  if (normalized.includes('/internal')) return 'internal';
  if (normalized.includes('/webhook')) return 'webhook';
  if (normalized.includes('/debug') || normalized.includes('/test')) return 'debug';
  if (normalized.includes('/cron') || normalized.includes('/batch') || normalized.includes('/queue')) {
    return 'cron_batch_queue';
  }
  if (normalized.includes('/auth')) return 'auth';
  return 'public';
}

async function classifyProtection({ repoRoot, file, routePath, classification, middleware, content }) {
  const evidence = [];
  const code = stripComments(content);
  if (middleware.matchers.some((matcher) => routeMatchesMatcher(routePath, matcher))) {
    evidence.push('middleware_matcher');
  }
  if (hasRouteAuthReference(code)) {
    evidence.push('route_auth_reference');
  }
  if (await hasImportedAuthHelperReference({ repoRoot, file, code })) {
    evidence.push('route_auth_reference');
    evidence.push('imported_auth_helper');
  }
  if (classification === 'debug' && hasDebugAccessGate(code)) {
    evidence.push('debug_access_gate');
  }
  if (classification === 'debug' && await hasImportedDebugAccessGateHelperReference({ repoRoot, file, code })) {
    evidence.push('debug_access_gate');
    evidence.push('imported_debug_gate_helper');
  }
  if (classification === 'webhook' && hasWebhookSignatureCheck(code)) {
    evidence.push('webhook_signature_check');
  }
  if (classification === 'webhook' && await hasImportedWebhookSignatureHelperReference({ repoRoot, file, code })) {
    evidence.push('webhook_signature_check');
    evidence.push('imported_signature_helper');
  }
  if (middleware.matchers.some((matcher) => matcherExcludesApi(matcher))) {
    evidence.push('middleware_excludes_api');
  }
  const uniqueEvidence = [...new Set(evidence)];
  return {
    status: resolveProtectionStatus(uniqueEvidence, middleware),
    evidence: uniqueEvidence
  };
}

function collectRiskHints({ classification, protection, content }) {
  const hints = [];
  if (['admin', 'internal', 'cron_batch_queue'].includes(classification) && !isProtectedStatus(protection.status)) {
    hints.push('privileged_route_unprotected');
  }
  if (classification === 'debug' && !isProtectedStatus(protection.status)) {
    hints.push('debug_route_exposed');
  }
  if (classification === 'webhook' && !protection.evidence.includes('webhook_signature_check')) {
    hints.push('webhook_signature_not_detected');
  }
  return hints;
}

function resolveProtectionStatus(evidence, middleware) {
  if (evidence.includes('webhook_signature_check')) return 'protected_by_route';
  if (evidence.includes('debug_access_gate')) return 'protected_by_route';
  if (evidence.includes('route_auth_reference')) return 'protected_by_route';
  if (evidence.includes('middleware_matcher')) return 'protected_by_middleware';
  if (evidence.includes('middleware_excludes_api')) return 'excluded_by_middleware';
  if (middleware.matchers.some((matcher) => isComplexMatcher(matcher))) return 'unknown';
  return 'unprotected';
}

function isProtectedStatus(status) {
  return status === 'protected'
    || status === 'protected_by_route'
    || status === 'protected_by_middleware';
}

function detectMethods(content) {
  const methods = [];
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    if (new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(content)
      || new RegExp(`export\\s+function\\s+${method}\\b`).test(content)) {
      methods.push(method);
    }
  }
  return methods;
}

async function readMiddlewareMatchers(root, architectureProfile) {
  const middlewareFiles = architectureProfile?.views?.security?.auth_boundaries
    ?.filter((boundary) => boundary.type === 'middleware')
    .map((boundary) => boundary.file)
    ?? [];
  const files = middlewareFiles.length > 0 ? middlewareFiles : MIDDLEWARE_FILES;
  const matchers = [];
  const evidence = [];
  for (const file of files) {
    const content = await readTextIfExists(path.join(root, file));
    if (!content) continue;
    const fileMatchers = extractMatchers(content);
    matchers.push(...fileMatchers);
    evidence.push({ file, matchers: fileMatchers });
  }
  return {
    matchers: [...new Set(matchers)],
    evidence
  };
}

function extractMatchers(content) {
  const matchers = [];
  const matcherBlock = /matcher\s*:\s*\[([\s\S]*?)\]/m.exec(content);
  if (matcherBlock) {
    for (const match of matcherBlock[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
      matchers.push(match[1]);
    }
  }
  const singleMatcher = /matcher\s*:\s*['"`]([^'"`]+)['"`]/m.exec(content);
  if (singleMatcher) matchers.push(singleMatcher[1]);
  return matchers;
}

function routeMatchesMatcher(routePath, matcher) {
  if (isComplexMatcher(matcher)) return false;
  const normalized = matcher
    .replace(/\/:path\*$/, '')
    .replace(/\/$/, '');
  if (!normalized) return false;
  return routePath === normalized || routePath.startsWith(`${normalized}/`);
}

function hasWebhookSignatureCheck(content) {
  const readsSignatureHeader = /headers\s*\(\s*\)\.get\s*\(\s*['"`][^'"`]*signature[^'"`]*['"`]\s*\)/i.test(content)
    || /\.headers\.get\s*\(\s*['"`][^'"`]*signature[^'"`]*['"`]\s*\)/i.test(content)
    || /\bstripe-signature\b/i.test(content);
  const verifiesSignature = /\b(constructEvent|webhooks\.verify|verifyWebhook|verifySignature|verify)\s*\(/i.test(content);
  const readsWebhookTokenHeader = /\.headers\.get\s*\([^)]*(webhookHeaderName|authorization|token|signature)[^)]*\)/i.test(content)
    || /\bheaders\s*\(\s*\)\.get\s*\([^)]*(webhookHeaderName|authorization|token|signature)[^)]*\)/i.test(content);
  const hasWebhookTokenSecret = /\b(expectedWebhookToken|webhookAuthToken|webhookSecret|WEBHOOK[A-Z0-9_]*(TOKEN|SECRET|AUTH)|resolve[A-Za-z0-9_]*Webhook[A-Za-z0-9_]*Token)\b/.test(content);
  const verifiesWebhookToken = /\b(verify[A-Za-z0-9_]*(Webhook|Signature|Token)[A-Za-z0-9_]*|timingSafeEqual|safeSignatureEquals)\s*\(/.test(content);
  const hasProviderWebhookVerification = /\b(validateRequest|validateRequestWithBody|constructEvent|unwrap|verifySignature|verifyWebhook|verifyWebhookSignature|verify[A-Za-z0-9_]*Webhook[A-Za-z0-9_]*)\s*\(/i.test(content)
    || /\bwebhooks\.(constructEvent|unwrap|verifySignature|verify)\s*\(/i.test(content);
  const hasSignatureCrypto = /\b(createHmac|timingSafeEqual)\s*\(/i.test(content);
  const hasSignatureSecret = /\bprocess\.env\.[A-Z0-9_]*(WEBHOOK|SIGNATURE|SECRET|TOKEN|AUTH)[A-Z0-9_]*\b/i.test(content)
    || /\b[A-Za-z0-9_]*(webhook|signature)[A-Za-z0-9_]*(Secret|Token|Key)\b/i.test(content);
  return (readsSignatureHeader && verifiesSignature)
    || (readsWebhookTokenHeader && hasWebhookTokenSecret && verifiesWebhookToken)
    || (hasSignatureSecret && (hasProviderWebhookVerification || hasSignatureCrypto));
}

function hasRouteAuthReference(content) {
  return /\b(getServerSession|requireAuth|currentUser|getSession|auth\.api\.getSession|validateSession)\s*\(/i.test(content)
    || /\bcookies\s*\(\s*\)\.get\s*\(\s*['"`][^'"`]*(session|token)[^'"`]*['"`]\s*\)/i.test(content)
    || /\.cookies\.get\s*\(\s*['"`][^'"`]*(session|token)[^'"`]*['"`]\s*\)/i.test(content)
    || hasAuthorizationHeaderGuard(content);
}

function hasDebugAccessGate(content) {
  const hasDebugEnvGate = /\bprocess\.env\.[A-Z0-9_]*(DEBUG|TEST|INTERNAL)[A-Z0-9_]*(ENABLED|TOKEN|SECRET|KEY)?\b/i.test(content)
    || /\b(NODE_ENV|VERCEL_ENV)\b[\s\S]{0,80}\bproduction\b/i.test(content);
  if (!hasDebugEnvGate) return false;

  const hasDenyPath = /\b(status\s*:\s*(401|403|404)|notFound\s*\(|Unauthorized|Forbidden|disabled|forbidden|unauthorized)\b/i.test(content);
  const hasCallerBoundary = /\b(auth|getServerSession|currentUser|getSession|validateSession)\s*\(/i.test(content)
    || /\bsession\?\.user\b|\bsession\.user\b|\buserType\b|\brole\b|\badmin\b/i.test(content)
    || /\bNODE_ENV\b|\bVERCEL_ENV\b/i.test(content);
  return hasDenyPath && hasCallerBoundary;
}

function hasAuthorizationHeaderGuard(content) {
  const readsAuthorizationHeader = /\.headers\.get\s*\(\s*['"`]authorization['"`]\s*\)/i.test(content)
    || /\bheaders\s*\(\s*\)\.get\s*\(\s*['"`]authorization['"`]\s*\)/i.test(content);
  if (!readsAuthorizationHeader) return false;
  const hasSecretSource = /\bprocess\.env\.[A-Z0-9_]*(API_KEY|TOKEN|SECRET|AUTH)[A-Z0-9_]*\b/.test(content);
  const checksBearer = /\bBearer\b/i.test(content);
  return hasSecretSource || checksBearer;
}

async function hasImportedAuthHelperReference({ repoRoot, file, code }) {
  return hasImportedAuthHelperReferenceRecursive({
    repoRoot,
    file,
    code,
    visited: new Set([normalizeRelativeFile(file)]),
    depth: 0
  });
}

async function hasImportedWebhookSignatureHelperReference({ repoRoot, file, code }) {
  return hasImportedWebhookSignatureHelperReferenceRecursive({
    repoRoot,
    file,
    code,
    visited: new Set([normalizeRelativeFile(file)]),
    depth: 0
  });
}

async function hasImportedDebugAccessGateHelperReference({ repoRoot, file, code }) {
  return hasImportedDebugAccessGateHelperReferenceRecursive({
    repoRoot,
    file,
    code,
    visited: new Set([normalizeRelativeFile(file)]),
    depth: 0
  });
}

async function hasImportedDebugAccessGateHelperReferenceRecursive({ repoRoot, file, code, visited, depth }) {
  if (depth >= 4) return false;
  const imports = extractLocalImports(code);
  for (const item of imports) {
    if (!item.specifiers.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(code))) {
      continue;
    }
    const importedModule = await readImportedModule(repoRoot, file, item.source);
    if (!importedModule.content) continue;
    if (visited.has(importedModule.file)) continue;
    visited.add(importedModule.file);

    const importedCode = stripComments(importedModule.content);
    if (hasDebugAccessGate(importedCode)) return true;
    if (await hasImportedDebugAccessGateHelperReferenceRecursive({
      repoRoot,
      file: importedModule.file,
      code: importedCode,
      visited,
      depth: depth + 1
    })) {
      return true;
    }
  }
  return false;
}

async function hasImportedWebhookSignatureHelperReferenceRecursive({ repoRoot, file, code, visited, depth }) {
  if (depth >= 4) return false;
  const imports = extractLocalImports(code);
  for (const item of imports) {
    if (!item.specifiers.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(code))) {
      continue;
    }
    const importedModule = await readImportedModule(repoRoot, file, item.source);
    if (!importedModule.content) continue;
    if (visited.has(importedModule.file)) continue;
    visited.add(importedModule.file);

    const importedCode = stripComments(importedModule.content);
    if (hasWebhookSignatureCheck(importedCode)) return true;
    if (await hasImportedWebhookSignatureHelperReferenceRecursive({
      repoRoot,
      file: importedModule.file,
      code: importedCode,
      visited,
      depth: depth + 1
    })) {
      return true;
    }
  }
  return false;
}

async function hasImportedAuthHelperReferenceRecursive({ repoRoot, file, code, visited, depth }) {
  if (depth >= 4) return false;
  const imports = extractLocalImports(code);
  for (const item of imports) {
    if (!item.specifiers.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(code))) {
      continue;
    }
    const importedModule = await readImportedModule(repoRoot, file, item.source);
    if (!importedModule.content) continue;
    if (visited.has(importedModule.file)) continue;
    visited.add(importedModule.file);

    const importedCode = stripComments(importedModule.content);
    if (hasRouteAuthReference(importedCode)) return true;
    if (await hasImportedAuthHelperReferenceRecursive({
      repoRoot,
      file: importedModule.file,
      code: importedCode,
      visited,
      depth: depth + 1
    })) {
      return true;
    }
  }
  return false;
}

function extractLocalImports(content) {
  const imports = [];
  const namedImportPattern = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(namedImportPattern)) {
    imports.push({
      specifiers: match[1]
        .split(',')
        .map((item) => item.trim().split(/\s+as\s+/i).pop())
        .filter(Boolean),
      source: match[2]
    });
  }
  return imports.filter((item) => item.source.startsWith('@/') || item.source.startsWith('.'));
}

async function readImportedModule(repoRoot, importerFile, source) {
  const candidates = resolveImportCandidates(repoRoot, importerFile, source);
  return readModuleFromCandidates(repoRoot, candidates);
}

function resolveImportCandidates(repoRoot, importerFile, source) {
  const base = source.startsWith('@/')
    ? path.join(repoRoot, 'src', source.slice(2))
    : path.resolve(path.dirname(path.join(repoRoot, importerFile)), source);
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx')
  ];
}

async function readModuleFromCandidates(repoRoot, candidates) {
  for (const candidate of candidates) {
    const content = await readTextIfExists(candidate);
    if (content) {
      return {
        file: normalizeRelativeFile(path.relative(repoRoot, candidate)),
        content
      };
    }
  }
  return { file: '', content: '' };
}

function normalizeRelativeFile(file) {
  return file.split(path.sep).join('/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function isComplexMatcher(matcher) {
  return matcher.includes('(?')
    || matcher.includes('.*')
    || matcher.includes('[')
    || matcher.includes(']')
    || matcher.includes('|');
}

function matcherExcludesApi(matcher) {
  return matcher.includes('(?!api') || matcher.includes('(?!/api');
}

function summarizeRoutes(routes) {
  const summary = {};
  for (const route of routes) {
    summary[route.classification] = (summary[route.classification] ?? 0) + 1;
  }
  return summary;
}

function summarizeProtection(routes) {
  const summary = {};
  for (const route of routes) {
    const status = route.protection?.status ?? 'unknown';
    summary[status] = (summary[status] ?? 0) + 1;
  }
  return summary;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return '';
    throw error;
  }
}
