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
    summary: summarizeRoutes(routes)
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
  if (middleware.matchers.some((matcher) => routeMatchesMatcher(routePath, matcher))) {
    evidence.push('middleware_matcher');
  }
  if (/\b(auth|session|currentUser|getServerSession|requireAuth)\b/i.test(content)) {
    evidence.push('route_auth_reference');
  }
  if (classification === 'webhook' && hasWebhookSignatureCheck(content)) {
    evidence.push('webhook_signature_check');
  }
  return {
    status: evidence.length > 0 ? 'protected' : 'unprotected',
    evidence
  };
}

function collectRiskHints({ classification, protection, content }) {
  const hints = [];
  if (['admin', 'internal', 'cron_batch_queue'].includes(classification) && protection.status === 'unprotected') {
    hints.push('privileged_route_unprotected');
  }
  if (classification === 'debug' && protection.status === 'unprotected') {
    hints.push('debug_route_exposed');
  }
  if (classification === 'webhook' && !hasWebhookSignatureCheck(content)) {
    hints.push('webhook_signature_not_detected');
  }
  return hints;
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
  const normalized = matcher
    .replace(/\/:path\*$/, '')
    .replace(/\(\.\*\)$/, '')
    .replace(/\/$/, '');
  if (!normalized) return false;
  return routePath === normalized || routePath.startsWith(`${normalized}/`);
}

function hasWebhookSignatureCheck(content) {
  return /\b(signature|svix|stripe-signature|webhookSecret|verify)\b/i.test(content);
}

function summarizeRoutes(routes) {
  const summary = {};
  for (const route of routes) {
    summary[route.classification] = (summary[route.classification] ?? 0) + 1;
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
