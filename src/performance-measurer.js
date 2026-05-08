import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const execFileAsync = promisify(execFile);

export async function runPerformanceMeasurement(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const runId = options.runId ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
  const runDir = path.join(getWorkspaceDir(root), 'performance', runId);
  await mkdir(runDir, { recursive: true });

  const packageJson = await readPackageJson(root);
  const packageScripts = packageJson?.scripts ?? {};
  const samples = normalizeSampleCount(options.samples);
  const startedAt = new Date().toISOString();

  const commandMeasurements = [];
  if (options.typecheck !== false && packageScripts.typecheck) {
    commandMeasurements.push(await measureCommand(root, {
      id: 'typecheck',
      command: ['npm', ['run', 'typecheck']]
    }));
  }
  if (options.build === true && packageScripts.build) {
    commandMeasurements.push(await measureCommand(root, {
      id: 'build',
      command: ['npm', ['run', 'build']]
    }));
  }
  for (const customCommand of options.commands ?? []) {
    commandMeasurements.push(await measureShellCommand(root, customCommand));
  }

  const httpMeasurements = options.baseUrl
    ? await measureHttpTargets({
      baseUrl: options.baseUrl,
      pages: options.pages ?? [],
      apis: options.apis ?? [],
      samples,
      headers: options.headers ?? {}
    })
    : [];

  const startupMeasurements = [];
  for (const startup of options.startups ?? []) {
    startupMeasurements.push(await measureStartup(root, startup));
  }

  const prismaLog = options.prismaLog
    ? await analyzePrismaLog(path.resolve(root, options.prismaLog))
    : null;

  const measurement = {
    schema_version: '0.1.0',
    run_id: runId,
    created_at: startedAt,
    repo: {
      root: '.',
      package_name: packageJson?.name ?? null
    },
    options: {
      samples,
      base_url: options.baseUrl ?? null,
      pages: options.pages ?? [],
      apis: options.apis ?? [],
      typecheck: options.typecheck !== false && Boolean(packageScripts.typecheck),
      build: options.build === true && Boolean(packageScripts.build),
      startup_count: startupMeasurements.length,
      prisma_log: options.prismaLog ?? null
    },
    commands: commandMeasurements,
    http: httpMeasurements,
    prisma_log: prismaLog,
    summary: buildMeasurementSummary({ commandMeasurements, httpMeasurements, startupMeasurements, prismaLog })
  };
  if (startupMeasurements.length > 0) measurement.startup = startupMeasurements;

  const jsonPath = path.join(runDir, 'performance.json');
  const markdownPath = path.join(runDir, 'performance.md');
  await writeFile(jsonPath, `${JSON.stringify(measurement, null, 2)}\n`);
  await writeFile(markdownPath, renderPerformanceReport(measurement));

  const manifest = await readManifest(root);
  manifest.latest_performance_run = runId;
  manifest.performance_runs = [
    {
      run_id: runId,
      created_at: measurement.created_at,
      artifacts: {
        performance_json: toWorkspaceRelative(root, jsonPath),
        performance_report: toWorkspaceRelative(root, markdownPath)
      },
      summary: measurement.summary
    },
    ...(manifest.performance_runs ?? []).filter((run) => run.run_id !== runId)
  ];
  await writeManifest(root, manifest);

  return {
    runDir,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath)
    },
    measurement
  };
}

export async function comparePerformanceMeasurements(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const before = await readMeasurement(root, options.before);
  const after = await readMeasurement(root, options.after);
  const comparison = {
    schema_version: '0.1.0',
    created_at: new Date().toISOString(),
    before: {
      run_id: before.run_id,
      created_at: before.created_at
    },
    after: {
      run_id: after.run_id,
      created_at: after.created_at
    },
    commands: compareById(before.commands ?? [], after.commands ?? [], compareCommand),
    http: compareById(before.http ?? [], after.http ?? [], compareHttp),
    startup: compareById(before.startup ?? [], after.startup ?? [], compareStartup),
    prisma_log: comparePrisma(before.prisma_log, after.prisma_log)
  };
  return { comparison, markdown: renderPerformanceComparison(comparison) };
}

export function renderPerformanceSummary(result) {
  const lines = [
    '# VibePro Performance Measurement',
    '',
    `Run ID: ${result.measurement.run_id}`,
    `Report: ${result.artifacts.markdown}`,
    '',
    '## Summary'
  ];
  for (const item of result.measurement.summary.items) {
    lines.push(`- ${item.label}: ${item.value}`);
  }
  if (result.measurement.summary.items.length === 0) {
    lines.push('- No measurement targets were selected.');
  }
  return `${lines.join('\n')}\n`;
}

export function renderPerformanceComparison(comparison) {
  const lines = [
    '# VibePro Performance Comparison',
    '',
    `Before: ${comparison.before.run_id}`,
    `After: ${comparison.after.run_id}`,
    '',
    '## Commands',
    '',
    '| ID | Before | After | Delta |',
    '| -- | ------ | ----- | ----- |'
  ];
  for (const item of comparison.commands) {
    lines.push(`| ${item.id} | ${formatMs(item.before_ms)} | ${formatMs(item.after_ms)} | ${formatDeltaMs(item.delta_ms)} |`);
  }
  if (comparison.commands.length === 0) lines.push('| - | - | - | - |');

  lines.push('', '## HTTP', '', '| ID | Metric | Before | After | Delta |', '| -- | ------ | ------ | ----- | ----- |');
  for (const item of comparison.http) {
    lines.push(`| ${item.id} | p95 total | ${formatMs(item.before_p95_ms)} | ${formatMs(item.after_p95_ms)} | ${formatDeltaMs(item.delta_p95_ms)} |`);
    lines.push(`| ${item.id} | p95 TTFB | ${formatMs(item.before_ttfb_p95_ms)} | ${formatMs(item.after_ttfb_p95_ms)} | ${formatDeltaMs(item.delta_ttfb_p95_ms)} |`);
  }
  if (comparison.http.length === 0) lines.push('| - | - | - | - | - |');

  lines.push('', '## Startup', '', '| ID | Before | After | Delta |', '| -- | ------ | ----- | ----- |');
  for (const item of comparison.startup) {
    lines.push(`| ${item.id} | ${formatMs(item.before_ready_ms)} | ${formatMs(item.after_ready_ms)} | ${formatDeltaMs(item.delta_ready_ms)} |`);
  }
  if (comparison.startup.length === 0) lines.push('| - | - | - | - |');

  if (comparison.prisma_log) {
    lines.push('', '## Prisma Query Log', '');
    lines.push(`- query count: ${comparison.prisma_log.before_query_count} -> ${comparison.prisma_log.after_query_count} (${formatSignedNumber(comparison.prisma_log.delta_query_count)})`);
    lines.push(`- unique query shapes: ${comparison.prisma_log.before_unique_query_shape_count} -> ${comparison.prisma_log.after_unique_query_shape_count} (${formatSignedNumber(comparison.prisma_log.delta_unique_query_shape_count)})`);
  }
  return `${lines.join('\n')}\n`;
}

function renderPerformanceReport(measurement) {
  const lines = [
    '# VibePro Performance Measurement',
    '',
    `Run ID: ${measurement.run_id}`,
    `Created: ${measurement.created_at}`,
    '',
    '## Summary'
  ];
  for (const item of measurement.summary.items) {
    lines.push(`- ${item.label}: ${item.value}`);
  }
  if (measurement.summary.items.length === 0) lines.push('- No measurement targets were selected.');

  lines.push('', '## Commands', '', '| ID | Status | Duration | Exit |', '| -- | ------ | -------- | ---- |');
  for (const command of measurement.commands) {
    lines.push(`| ${command.id} | ${command.status} | ${formatMs(command.duration_ms)} | ${command.exit_code ?? '-'} |`);
  }
  if (measurement.commands.length === 0) lines.push('| - | - | - | - |');

  lines.push('', '## HTTP', '', '| ID | Kind | Path | p50 total | p95 total | p95 TTFB | Errors |', '| -- | ---- | ---- | --------- | --------- | -------- | ------ |');
  for (const target of measurement.http) {
    lines.push(`| ${target.id} | ${target.kind} | ${target.path} | ${formatMs(target.summary.total_ms.p50)} | ${formatMs(target.summary.total_ms.p95)} | ${formatMs(target.summary.ttfb_ms.p95)} | ${target.summary.error_count} |`);
  }
  if (measurement.http.length === 0) lines.push('| - | - | - | - | - | - | - |');

  lines.push('', '## Startup', '', '| ID | Status | Ready | Timeout |', '| -- | ------ | ----- | ------- |');
  for (const startup of measurement.startup ?? []) {
    lines.push(`| ${startup.id} | ${startup.status} | ${formatMs(startup.ready_ms)} | ${startup.timeout_ms}ms |`);
  }
  if ((measurement.startup ?? []).length === 0) lines.push('| - | - | - | - |');

  if (measurement.prisma_log) {
    lines.push('', '## Prisma Query Log', '');
    lines.push(`- query count: ${measurement.prisma_log.query_count}`);
    lines.push(`- unique query shapes: ${measurement.prisma_log.unique_query_shape_count}`);
    lines.push(`- repeated query shapes: ${measurement.prisma_log.repeated_query_shapes.length}`);
  }

  return `${lines.join('\n')}\n`;
}

async function readPackageJson(repoRoot) {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function measureCommand(repoRoot, { id, command }) {
  const [file, args] = command;
  const start = performance.now();
  try {
    const result = await execFileAsync(file, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      id,
      command: [file, ...args].join(' '),
      status: 'pass',
      duration_ms: Math.round(performance.now() - start),
      exit_code: 0,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr)
    };
  } catch (error) {
    return {
      id,
      command: [file, ...args].join(' '),
      status: 'fail',
      duration_ms: Math.round(performance.now() - start),
      exit_code: error.code ?? 1,
      stdout_tail: tail(error.stdout ?? ''),
      stderr_tail: tail(error.stderr ?? error.message)
    };
  }
}

async function measureShellCommand(repoRoot, rawCommand) {
  const [id, command] = rawCommand.includes('=')
    ? rawCommand.split(/=(.*)/s, 2)
    : [`custom-${rawCommand.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`, rawCommand];
  return measureCommand(repoRoot, {
    id,
    command: process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', command]]
      : ['sh', ['-lc', command]]
  });
}

async function measureHttpTargets({ baseUrl, pages, apis, samples, headers }) {
  const targets = [
    ...pages.map((route) => ({ kind: 'page', route })),
    ...apis.map((route) => ({ kind: 'api', route }))
  ];
  const measurements = [];
  for (const target of targets) {
    const samplesResult = [];
    for (let index = 0; index < samples; index += 1) {
      samplesResult.push(await measureHttpRequest(new URL(target.route, baseUrl), headers));
    }
    measurements.push({
      id: `${target.kind}:${target.route}`,
      kind: target.kind,
      path: target.route,
      samples: samplesResult,
      summary: summarizeHttpSamples(samplesResult)
    });
  }
  return measurements;
}

function measureHttpRequest(url, headers = {}) {
  return new Promise((resolve) => {
    const client = url.protocol === 'https:' ? https : http;
    const start = performance.now();
    let firstByteAt = null;
    let bytes = 0;
    const request = client.request(url, {
      method: 'GET',
      headers
    }, (response) => {
      response.on('data', (chunk) => {
        if (firstByteAt === null) firstByteAt = performance.now();
        bytes += chunk.length;
      });
      response.on('end', () => {
        const end = performance.now();
        resolve({
          status: 'pass',
          status_code: response.statusCode ?? null,
          ok: response.statusCode ? response.statusCode < 500 : false,
          total_ms: Math.round(end - start),
          ttfb_ms: firstByteAt === null ? Math.round(end - start) : Math.round(firstByteAt - start),
          bytes,
          content_type: response.headers['content-type'] ?? null
        });
      });
    });
    request.on('error', (error) => {
      resolve({
        status: 'fail',
        status_code: null,
        ok: false,
        total_ms: Math.round(performance.now() - start),
        ttfb_ms: null,
        bytes,
        error: error.message
      });
    });
    request.end();
  });
}

async function measureStartup(repoRoot, startup) {
  const timeoutMs = startup.timeoutMs ?? 30000;
  const readyPattern = new RegExp(startup.readyPattern ?? 'ready|started server|local:', 'i');
  const script = startup.script;
  const command = startup.command ?? `npm run ${script}`;
  const childArgs = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', command]]
    : ['sh', ['-lc', command]];
  const start = performance.now();
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const child = spawn(childArgs[0], childArgs[1], {
      cwd: repoRoot,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const finish = (status, extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      terminateProcess(child);
      resolve({
        id: startup.id ?? `startup:${script ?? command}`,
        command,
        status,
        ready_ms: extra.readyMs ?? null,
        timeout_ms: timeoutMs,
        output_tail: tail(output)
      });
    };
    const onData = (chunk) => {
      output += chunk.toString();
      if (readyPattern.test(output)) {
        finish('pass', { readyMs: Math.round(performance.now() - start) });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => {
      output += error.message;
      finish('fail');
    });
    child.on('exit', (code) => {
      if (!settled) {
        output += `\nprocess exited before ready pattern; code=${code}`;
        finish('fail');
      }
    });
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
  });
}

function terminateProcess(child) {
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // Process may already have exited.
  }
}

async function analyzePrismaLog(filePath) {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const queryLines = lines.filter((line) => /prisma:query|\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(line));
  const shapes = new Map();
  for (const line of queryLines) {
    const shape = normalizeQueryShape(line);
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }
  const repeatedQueryShapes = [...shapes.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([shape, count]) => ({ shape, count }));
  return {
    file: filePath,
    line_count: lines.length,
    query_count: queryLines.length,
    unique_query_shape_count: shapes.size,
    repeated_query_shapes: repeatedQueryShapes
  };
}

function normalizeQueryShape(line) {
  return line
    .replace(/\b\d+\b/g, '?')
    .replace(/'[^']*'/g, '?')
    .replace(/"[^"]*"/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

async function readMeasurement(repoRoot, artifactPath) {
  if (!artifactPath) throw new Error('compare requires --before and --after');
  return JSON.parse(await readFile(path.resolve(repoRoot, artifactPath), 'utf8'));
}

function buildMeasurementSummary({ commandMeasurements, httpMeasurements, startupMeasurements, prismaLog }) {
  const items = [];
  for (const command of commandMeasurements) {
    items.push({ label: `${command.id} duration`, value: formatMs(command.duration_ms) });
  }
  for (const target of httpMeasurements) {
    items.push({ label: `${target.id} p95`, value: formatMs(target.summary.total_ms.p95) });
  }
  for (const startup of startupMeasurements) {
    items.push({ label: `${startup.id} ready`, value: formatMs(startup.ready_ms) });
  }
  if (prismaLog) {
    items.push({ label: 'Prisma query count', value: String(prismaLog.query_count) });
    items.push({ label: 'Prisma unique query shapes', value: String(prismaLog.unique_query_shape_count) });
  }
  return { items };
}

function summarizeHttpSamples(samples) {
  return {
    count: samples.length,
    error_count: samples.filter((sample) => sample.status !== 'pass' || !sample.ok).length,
    status_codes: countBy(samples.map((sample) => sample.status_code ?? 'error')),
    total_ms: summarizeNumbers(samples.map((sample) => sample.total_ms).filter((value) => value !== null)),
    ttfb_ms: summarizeNumbers(samples.map((sample) => sample.ttfb_ms).filter((value) => value !== null)),
    bytes: summarizeNumbers(samples.map((sample) => sample.bytes).filter((value) => value !== null))
  };
}

function summarizeNumbers(values) {
  if (values.length === 0) return { min: null, p50: null, p95: null, max: null, avg: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    avg: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length)
  };
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return null;
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function compareById(beforeItems, afterItems, mapper) {
  const beforeById = new Map(beforeItems.map((item) => [item.id, item]));
  return afterItems
    .filter((after) => beforeById.has(after.id))
    .map((after) => mapper(beforeById.get(after.id), after));
}

function compareCommand(before, after) {
  return {
    id: after.id,
    before_ms: before.duration_ms,
    after_ms: after.duration_ms,
    delta_ms: nullableDelta(after.duration_ms, before.duration_ms)
  };
}

function compareHttp(before, after) {
  return {
    id: after.id,
    before_p95_ms: before.summary?.total_ms?.p95 ?? null,
    after_p95_ms: after.summary?.total_ms?.p95 ?? null,
    delta_p95_ms: nullableDelta(after.summary?.total_ms?.p95, before.summary?.total_ms?.p95),
    before_ttfb_p95_ms: before.summary?.ttfb_ms?.p95 ?? null,
    after_ttfb_p95_ms: after.summary?.ttfb_ms?.p95 ?? null,
    delta_ttfb_p95_ms: nullableDelta(after.summary?.ttfb_ms?.p95, before.summary?.ttfb_ms?.p95)
  };
}

function compareStartup(before, after) {
  return {
    id: after.id,
    before_ready_ms: before.ready_ms,
    after_ready_ms: after.ready_ms,
    delta_ready_ms: nullableDelta(after.ready_ms, before.ready_ms)
  };
}

function comparePrisma(before, after) {
  if (!before || !after) return null;
  return {
    before_query_count: before.query_count,
    after_query_count: after.query_count,
    delta_query_count: nullableDelta(after.query_count, before.query_count),
    before_unique_query_shape_count: before.unique_query_shape_count,
    after_unique_query_shape_count: after.unique_query_shape_count,
    delta_unique_query_shape_count: nullableDelta(after.unique_query_shape_count, before.unique_query_shape_count)
  };
}

function nullableDelta(after, before) {
  if (after === null || after === undefined || before === null || before === undefined) return null;
  return after - before;
}

function normalizeSampleCount(value) {
  const samples = Number(value ?? 5);
  if (!Number.isFinite(samples) || samples < 1) throw new Error('--samples must be a positive number');
  return Math.floor(samples);
}

function tail(text, maxLength = 4000) {
  if (!text) return '';
  return text.length <= maxLength ? text : text.slice(-maxLength);
}

function formatMs(value) {
  if (value === null || value === undefined) return '-';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value}ms`;
}

function formatDeltaMs(value) {
  if (value === null || value === undefined) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatMs(value)}`;
}

function formatSignedNumber(value) {
  if (value === null || value === undefined) return '-';
  return value > 0 ? `+${value}` : String(value);
}
