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
    const protection = classifyProtection({ routePath, classification, middleware, content });
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

function classifyProtection({ routePath, classification, middleware, content }) {
  const evidence = [];
  const code = stripComments(content);
  if (middleware.matchers.some((matcher) => routeMatchesMatcher(routePath, matcher))) {
    evidence.push('middleware_matcher');
  }
  if (hasRouteAuthReference(code)) {
    evidence.push('route_auth_reference');
  }
  if (classification === 'webhook' && hasWebhookSignatureCheck(code)) {
    evidence.push('webhook_signature_check');
  }
  if (middleware.matchers.some((matcher) => matcherExcludesApi(matcher))) {
    evidence.push('middleware_excludes_api');
  }
  return {
    status: resolveProtectionStatus(evidence, middleware),
    evidence
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
  if (classification === 'webhook' && !hasWebhookSignatureCheck(stripComments(content))) {
    hints.push('webhook_signature_not_detected');
  }
  return hints;
}

function resolveProtectionStatus(evidence, middleware) {
  if (evidence.includes('webhook_signature_check')) return 'protected_by_route';
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
  return readsSignatureHeader && verifiesSignature;
}

function hasRouteAuthReference(content) {
  return /\b(getServerSession|requireAuth|currentUser|getSession|auth\.api\.getSession|validateSession)\s*\(/i.test(content)
    || /\bcookies\s*\(\s*\)\.get\s*\(\s*['"`][^'"`]*(session|token)[^'"`]*['"`]\s*\)/i.test(content)
    || /\.cookies\.get\s*\(\s*['"`][^'"`]*(session|token)[^'"`]*['"`]\s*\)/i.test(content);
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
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}
