import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const APP_ROUTE_PATTERN = /^(?:src\/)?app\/api\/(.+)\/route\.(js|jsx|ts|tsx)$/;
const PAGES_ROUTE_PATTERN = /^(?:src\/)?pages\/api\/(.+)\.(js|jsx|ts|tsx)$/;
const API_STRING_PATTERN = /(['"`])([^'"`]*\/api\/[^'"`]*)\1/g;
const DIRECT_CALL_PATTERN = /\b([A-Za-z_$][\w$]*)\s*\(/g;
const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'await',
  'fetch',
  'axios',
  'console',
  'setTimeout',
  'setInterval'
]);

export async function scanNetworkContracts(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const files = await listRepoFiles(root);
  const routes = collectApiRoutes(files);
  const changedFiles = normalizeChangedFiles(options.changedFiles);
  const scanFiles = changedFiles.length > 0
    ? changedFiles.filter((file) => isSourceFile(file.path)).map((file) => file.path)
    : files.filter(isSourceFile);
  const apiClientCalls = [];
  const serverActionReplacements = [];

  for (const file of unique(scanFiles)) {
    const currentContent = await readContentForRef(root, file, options.headRef) ?? await readTextIfExists(path.join(root, file));
    if (!currentContent) continue;
    const oldContent = options.baseRef ? await readContentForRef(root, file, options.baseRef) : null;
    const currentCalls = extractApiClientCalls(currentContent, file);
    const oldCalls = oldContent ? extractApiClientCalls(oldContent, file) : [];
    const oldCallKeys = new Set(oldCalls.map(callKey));
    const introducedCalls = currentCalls.map((call) => ({
      ...call,
      introduced_in_diff: changedFiles.length > 0 && !oldCallKeys.has(callKey(call))
    }));
    apiClientCalls.push(...introducedCalls);

    if (oldContent && introducedCalls.some((call) => call.introduced_in_diff)) {
      const removedServerCalls = detectRemovedServerFunctionCalls(oldContent, currentContent);
      if (removedServerCalls.length > 0) {
        serverActionReplacements.push({
          file,
          removed_calls: removedServerCalls,
          introduced_api_calls: introducedCalls.filter((call) => call.introduced_in_diff),
          risk: 'server_function_replaced_by_http_api'
        });
      }
    }
  }

  const analyzedCalls = [];
  for (const call of apiClientCalls) {
    const match = matchApiRoute(call.api_path, routes);
    analyzedCalls.push({
      ...call,
      route_status: match.status,
      route_file: match.route?.file ?? null,
      route_path_pattern: match.route?.route_path ?? null,
      cause_candidates: call.introduced_in_diff ? await findCauseCandidates(root, call) : []
    });
  }

  const missingRoutes = analyzedCalls
    .filter((call) => call.route_status === 'missing')
    .map(toRouteFindingItem);
  const dynamicCalls = analyzedCalls
    .filter((call) => call.route_status === 'dynamic_unresolved')
    .map(toRouteFindingItem);
  const highRiskReplacements = serverActionReplacements
    .filter((item) => item.introduced_api_calls.some((call) => {
      const key = callKey(call);
      return analyzedCalls.some((analyzed) => callKey(analyzed) === key && analyzed.route_status !== 'present');
    }));

  return {
    schema_version: '0.1.0',
    status: missingRoutes.length > 0 ? 'block' : highRiskReplacements.length > 0 || dynamicCalls.length > 0 ? 'needs_review' : 'pass',
    route_count: routes.length,
    api_client_call_count: analyzedCalls.length,
    introduced_api_client_call_count: analyzedCalls.filter((call) => call.introduced_in_diff).length,
    routes,
    api_client_calls: analyzedCalls,
    missing_routes: missingRoutes,
    dynamic_calls: dynamicCalls,
    server_action_replacements: serverActionReplacements,
    high_risk_replacements: highRiskReplacements,
    risk_summary: {
      missing_routes: summarizeGateEffects(missingRoutes),
      dynamic_calls: summarizeGateEffects(dynamicCalls),
      server_action_replacements: summarizeGateEffects(highRiskReplacements)
    }
  };
}

function collectApiRoutes(files) {
  return files
    .map((file) => {
      const appMatch = APP_ROUTE_PATTERN.exec(file);
      if (appMatch) {
        return {
          router: 'app',
          file,
          route_path: `/api/${appMatch[1]}`,
          matcher: routeMatcherFromSegments(appMatch[1].split('/'))
        };
      }
      const pagesMatch = PAGES_ROUTE_PATTERN.exec(file);
      if (pagesMatch && !pagesMatch[1].startsWith('_')) {
        return {
          router: 'pages',
          file,
          route_path: `/api/${pagesMatch[1].replace(/\/index$/, '')}`,
          matcher: routeMatcherFromSegments(pagesMatch[1].replace(/\/index$/, '').split('/'))
        };
      }
      return null;
    })
    .filter(Boolean);
}

function matchApiRoute(apiPath, routes) {
  if (!apiPath || apiPath.dynamic) return { status: 'dynamic_unresolved', route: null };
  const normalized = normalizeApiPath(apiPath.value);
  const match = routes.find((route) => route.matcher.test(normalized));
  return match ? { status: 'present', route: match } : { status: 'missing', route: null };
}

function routeMatcherFromSegments(segments) {
  const pattern = segments
    .filter(Boolean)
    .map((segment) => {
      if (/^\[\[\.\.\.[^\]]+\]\]$/.test(segment)) return '(?:/.*)?';
      if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return '/.+';
      if (/^\[[^\]]+\]$/.test(segment)) return '/[^/]+';
      return `/${escapeRegExp(segment)}`;
    })
    .join('');
  return new RegExp(`^/api${pattern}/?$`);
}

function extractApiClientCalls(content, file) {
  const calls = [];
  const lineStarts = buildLineStarts(content);
  const stripped = stripComments(content);
  for (const match of stripped.matchAll(API_STRING_PATTERN)) {
    const before = stripped.slice(Math.max(0, match.index - 90), match.index);
    const detector = detectClientCall(before);
    if (!detector) continue;
    const rawPath = match[2];
    const apiPath = parseApiPath(rawPath);
    calls.push({
      file,
      line: lineNumberForIndex(lineStarts, match.index),
      callee: detector.callee,
      method: detector.method ?? inferHttpMethod(stripped, match.index, detector),
      api_path: apiPath,
      raw_argument: rawPath,
      static_analysis: apiPath.dynamic ? 'dynamic_path_warning' : 'static_path'
    });
  }
  return calls;
}

function detectClientCall(before) {
  if (/\bfetch\s*\(\s*$/.test(before)) return { callee: 'fetch' };
  const methodCall = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.\s*(get|post|put|patch|delete|request)\s*\(\s*$/i.exec(before);
  if (methodCall) return { callee: `${methodCall[1]}.${methodCall[2]}`, method: methodCall[2].toUpperCase() };
  const directCall = /\b(fetchJson|requestJson|apiFetch|apiRequest|get|post|put|patch|delete)\s*\(\s*$/i.exec(before);
  if (directCall) {
    const method = ['get', 'post', 'put', 'patch', 'delete'].includes(directCall[1].toLowerCase())
      ? directCall[1].toUpperCase()
      : null;
    return { callee: directCall[1], method };
  }
  const axiosDirect = /\baxios\s*\(\s*$/.exec(before);
  if (axiosDirect) return { callee: 'axios' };
  return null;
}

function inferHttpMethod(content, matchIndex, detector) {
  if (detector.method) return detector.method;
  const nearby = content.slice(matchIndex, Math.min(content.length, matchIndex + 260));
  const methodMatch = /method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i.exec(nearby);
  return methodMatch ? methodMatch[1].toUpperCase() : null;
}

function parseApiPath(rawPath) {
  const apiIndex = rawPath.indexOf('/api/');
  const value = apiIndex >= 0 ? rawPath.slice(apiIndex) : rawPath;
  return {
    value: normalizeApiPath(value),
    dynamic: value.includes('${') || value.includes('*') || /\[[^\]]+\]/.test(value)
  };
}

function normalizeApiPath(value) {
  const withoutOrigin = String(value ?? '').replace(/^https?:\/\/[^/]+/, '');
  const withoutQuery = withoutOrigin.split(/[?#]/)[0];
  return withoutQuery.replace(/\/+$/, '') || '/api';
}

function detectRemovedServerFunctionCalls(oldContent, currentContent) {
  const oldCalls = extractDirectCalls(oldContent);
  const currentCalls = new Set(extractDirectCalls(currentContent));
  return oldCalls
    .filter((name) => !currentCalls.has(name))
    .filter((name) => /Action$|Detail|Search|Create|Update|Delete|Load|Fetch|Query|Mutation|submit|save|load|search/.test(name))
    .slice(0, 10);
}

function extractDirectCalls(content) {
  const names = [];
  const stripped = stripComments(content);
  for (const match of stripped.matchAll(DIRECT_CALL_PATTERN)) {
    const name = match[1];
    if (KEYWORDS.has(name)) continue;
    const before = stripped.slice(Math.max(0, match.index - 2), match.index);
    if (before.endsWith('.') || before.endsWith('function ')) continue;
    names.push(name);
  }
  return unique(names);
}

function toRouteFindingItem(call) {
  return {
    file: call.file,
    line: call.line,
    api_path: call.api_path.value,
    method: call.method,
    callee: call.callee,
    route_status: call.route_status,
    introduced_in_diff: call.introduced_in_diff,
    cause_candidates: call.cause_candidates,
    gate_effect: call.route_status === 'missing' ? 'block' : 'review'
  };
}

async function findCauseCandidates(root, call) {
  const candidates = [];
  const needles = [call.api_path.value, call.raw_argument].filter(Boolean);
  for (const needle of unique(needles)) {
    const output = await gitOptional(root, ['log', '--oneline', '-S', needle, '--', call.file]);
    if (!output) continue;
    candidates.push(...output.split('\n').filter(Boolean).slice(0, 3).map((line) => ({
      query: needle,
      commit: line
    })));
  }
  return candidates.slice(0, 5);
}

async function readContentForRef(root, file, ref) {
  if (!ref || ref === 'WORKTREE') return null;
  return gitOptional(root, ['show', `${ref}:${file}`]);
}

async function listRepoFiles(root) {
  const output = await gitOptional(root, ['ls-files']);
  const filesystemFiles = await listFilesRecursive(root);
  if (output) return unique([...output.split('\n').filter(Boolean).map(normalizePath), ...filesystemFiles]);
  return filesystemFiles;
}

async function listFilesRecursive(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vibepro') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursive(root, fullPath));
    else files.push(normalizePath(path.relative(root, fullPath)));
  }
  return files;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function gitOptional(cwd, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return stdout.trimEnd();
  } catch {
    return null;
  }
}

function normalizeChangedFiles(files) {
  return (files ?? [])
    .map((file) => typeof file === 'string' ? { path: normalizePath(file), status: 'M' } : { ...file, path: normalizePath(file.path) })
    .filter((file) => file.path);
}

function isSourceFile(file) {
  const normalized = normalizePath(file);
  if (!SOURCE_EXTENSIONS.has(path.extname(normalized))) return false;
  return /^(src|app|pages|components|features|lib|server)\//.test(normalized);
}

function callKey(call) {
  return `${call.file}:${call.api_path.value}:${call.callee}:${call.method ?? ''}`;
}

function summarizeGateEffects(hits) {
  const summary = { block: 0, review: 0, info: 0 };
  for (const hit of hits) {
    const effect = ['block', 'review', 'info'].includes(hit.gate_effect) ? hit.gate_effect : 'info';
    summary[effect] += 1;
  }
  return summary;
}

function buildLineStarts(content) {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function lineNumberForIndex(lineStarts, index) {
  let line = 0;
  while (line + 1 < lineStarts.length && lineStarts[line + 1] <= index) line += 1;
  return line + 1;
}

function stripComments(content) {
  return String(content)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function normalizePath(filePath) {
  return String(filePath ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unique(items) {
  return [...new Set(items)];
}
