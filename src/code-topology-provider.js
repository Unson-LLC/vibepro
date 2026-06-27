import { spawn } from 'node:child_process';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 5000;
const PROVIDER = 'codebase-memory-mcp';

export async function buildCodeTopologyContext(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const changedFiles = normalizeChangedFiles(options.changedFiles ?? []);
  if (changedFiles.length === 0) {
    return emptyContext({
      reason: 'no changed files to map',
      changedFiles,
      headSha: options.headSha ?? null
    });
  }

  let result;
  try {
    result = await runProvider(root, {
      env: options.env ?? process.env,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });
  } catch (error) {
    return emptyContext({
      reason: error.code === 'ENOENT'
        ? 'codebase-memory-mcp command was not found on PATH'
        : `codebase-memory-mcp detect_changes unavailable: ${error.message}`,
      changedFiles,
      headSha: options.headSha ?? null
    });
  }

  let payload;
  try {
    payload = parseProviderOutput(result.stdout);
  } catch (error) {
    return emptyContext({
      reason: `codebase-memory-mcp detect_changes returned non-JSON output: ${error.message}`,
      changedFiles,
      headSha: options.headSha ?? null,
      command: result.command
    });
  }

  return normalizeProviderPayload(payload, {
    changedFiles,
    headSha: options.headSha ?? null,
    command: result.command
  });
}

function emptyContext({ reason, changedFiles = [], headSha = null, command = null }) {
  return {
    schema_version: '0.1.0',
    available: false,
    provider: PROVIDER,
    reason,
    command,
    head_sha: headSha,
    changed_file_count: changedFiles.length,
    matched_file_count: 0,
    related_file_count: 0,
    symbol_count: 0,
    route_count: 0,
    call_path_count: 0,
    risk_count: 0,
    investigation_files: [],
    impact_by_file: [],
    signals: []
  };
}

async function runProvider(repoRoot, { env, timeoutMs }) {
  const input = JSON.stringify({ repo_path: repoRoot });
  const args = ['cli', 'detect_changes', input];
  const command = `${PROVIDER} ${args.join(' ')}`;
  const result = await runProcess(PROVIDER, args, {
    cwd: repoRoot,
    env,
    timeoutMs
  });
  if (result.exitCode !== 0) {
    throw new Error(`exit code ${result.exitCode}: ${result.stderr.trim() || 'no stderr'}`);
  }
  return { ...result, command };
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function parseProviderOutput(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) throw new Error('empty stdout');
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error('no JSON object found');
  }
}

function normalizeProviderPayload(payload, { changedFiles, headSha, command }) {
  const changedSet = new Set(changedFiles);
  const relatedFiles = new Set();
  const symbols = new Set();
  const routes = new Set();
  const callPaths = [];
  const risks = [];
  const impactByFile = [];

  const entries = collectImpactEntries(payload);
  for (const entry of entries) {
    const file = normalizePath(entry.path ?? entry.file ?? entry.file_path ?? entry.changed_file ?? entry.changedFile);
    if (!file || !changedSet.has(file)) continue;

    const entryRelated = collectStrings(entry.related_files, entry.relatedFiles, entry.affected_files, entry.impacted_files);
    const entrySymbols = collectStrings(entry.symbols, entry.affected_symbols, entry.impacted_symbols, entry.functions, entry.classes);
    const entryRoutes = collectStrings(entry.routes, entry.http_routes, entry.endpoints);
    const entryCallPaths = collectArrayItems(entry.call_paths, entry.callPaths, entry.traces);
    const entryRisks = collectArrayItems(entry.risks, entry.risk_hints, entry.risk, entry.classification);

    for (const item of entryRelated.map(normalizePath).filter(Boolean)) {
      if (item !== file) relatedFiles.add(item);
    }
    for (const item of entrySymbols) symbols.add(item);
    for (const item of entryRoutes) routes.add(item);
    callPaths.push(...entryCallPaths);
    risks.push(...entryRisks);

    impactByFile.push({
      file,
      symbols: entrySymbols.slice(0, 12),
      related_files: entryRelated.map(normalizePath).filter(Boolean).filter((item) => item !== file).slice(0, 12),
      routes: entryRoutes.slice(0, 8),
      call_paths: entryCallPaths.slice(0, 5),
      risks: entryRisks.slice(0, 8)
    });
  }

  const topLevelRelated = collectStrings(payload.related_files, payload.relatedFiles, payload.affected_files, payload.impacted_files);
  for (const item of topLevelRelated.map(normalizePath).filter(Boolean)) {
    if (!changedSet.has(item)) relatedFiles.add(item);
  }
  for (const item of collectStrings(payload.symbols, payload.affected_symbols, payload.impacted_symbols)) symbols.add(item);
  for (const item of collectStrings(payload.routes, payload.http_routes, payload.endpoints)) routes.add(item);
  callPaths.push(...collectArrayItems(payload.call_paths, payload.callPaths, payload.traces));
  risks.push(...collectArrayItems(payload.risks, payload.risk_hints, payload.risk, payload.classification));

  const signals = buildSignals({ relatedFiles, routes, callPaths, risks, impactByFile });
  return {
    schema_version: '0.1.0',
    available: impactByFile.length > 0 || relatedFiles.size > 0 || routes.size > 0 || callPaths.length > 0 || risks.length > 0,
    provider: PROVIDER,
    reason: impactByFile.length > 0 ? 'codebase-memory-mcp detect_changes mapped current changed files' : 'codebase-memory-mcp returned no changed-file matches',
    command,
    head_sha: headSha,
    changed_file_count: changedFiles.length,
    matched_file_count: impactByFile.length,
    related_file_count: relatedFiles.size,
    symbol_count: symbols.size,
    route_count: routes.size,
    call_path_count: callPaths.length,
    risk_count: risks.length,
    investigation_files: [...relatedFiles].sort().slice(0, 30),
    impact_by_file: impactByFile.sort((a, b) => a.file.localeCompare(b.file)),
    signals
  };
}

function collectImpactEntries(payload) {
  const candidates = [
    payload?.changed_files,
    payload?.changedFiles,
    payload?.files,
    payload?.impacts,
    payload?.affected,
    payload?.changes
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  if (payload && typeof payload === 'object') {
    return Object.entries(payload)
      .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
      .map(([key, value]) => ({ path: key, ...value }));
  }
  return [];
}

function buildSignals({ relatedFiles, routes, callPaths, risks, impactByFile }) {
  const signals = new Set();
  if (relatedFiles.size > 0) signals.add('code_topology:related_files');
  if (routes.size > 0) signals.add('code_topology:routes');
  if (callPaths.length > 0) signals.add('code_topology:call_paths');
  const riskText = [
    ...risks.map((item) => JSON.stringify(item)),
    ...impactByFile.flatMap((item) => item.related_files),
    ...impactByFile.map((item) => item.file)
  ].join('\n').toLowerCase();
  if (/\b(auth|permission|security|secret|token|rbac|acl|middleware)\b/.test(riskText)) signals.add('code_topology:security');
  if (/\b(database|db|migration|schema|cache|query|orm|repository|model)\b/.test(riskText)) signals.add('code_topology:data_state');
  if (/\b(workflow|agent|queue|worker|retry|orchestration|gate|artifact)\b/.test(riskText)) signals.add('code_topology:call_paths');
  return [...signals].sort();
}

function normalizeChangedFiles(files) {
  return files
    .map((file) => normalizePath(typeof file === 'string' ? file : file?.path))
    .filter(Boolean);
}

function normalizePath(filePath) {
  if (!filePath) return null;
  return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
}

function collectStrings(...values) {
  return collectArrayItems(...values)
    .map((item) => typeof item === 'string' ? item : (item?.path ?? item?.file ?? item?.name ?? item?.id ?? null))
    .filter(Boolean)
    .map(String);
}

function collectArrayItems(...values) {
  const output = [];
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      output.push(...value);
    } else {
      output.push(value);
    }
  }
  return output;
}
