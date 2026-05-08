import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function scanLocalDev(repoRoot) {
  const packageJson = await readPackageJson(repoRoot);
  const scripts = packageJson?.scripts ?? {};
  const heavyDevScripts = Object.entries(scripts)
    .filter(([name]) => name === 'dev' || name.startsWith('dev:'))
    .map(([name, command]) => analyzeDevScript(name, command, scripts))
    .filter(Boolean);

  return {
    package_json_found: Boolean(packageJson),
    scanned_scripts: Object.keys(scripts).filter((name) => name === 'dev' || name.startsWith('dev:')).length,
    heavy_dev_scripts: heavyDevScripts,
    runtime_probe_plan: buildRuntimeProbePlan(scripts, heavyDevScripts),
    risk_summary: {
      heavy_dev_scripts: summarizeGateEffects(heavyDevScripts)
    }
  };
}

async function readPackageJson(repoRoot) {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function analyzeDevScript(name, command, scripts) {
  if (typeof command !== 'string' || command.trim() === '') return null;
  const concurrentlyCommands = extractConcurrentlyCommands(command);
  const workerScriptRefs = countWorkerScriptRefs(command, scripts);
  const hasNextDev = /\bnext\s+dev\b/.test(command);
  const preDevCommands = countPreDevCommands(command);
  const processCount = concurrentlyCommands.length > 0
    ? concurrentlyCommands.length
    : 1 + workerScriptRefs;

  if (processCount < 4 && workerScriptRefs < 3 && preDevCommands < 2) return null;

  return {
    file: 'package.json',
    script_name: name,
    command,
    kind: 'heavy_local_dev_script',
    process_count: processCount,
    worker_script_refs: workerScriptRefs,
    pre_dev_command_count: preDevCommands,
    has_next_dev: hasNextDev,
    has_concurrently: concurrentlyCommands.length > 0,
    gate_effect: 'review',
    confidence: concurrentlyCommands.length > 0 && workerScriptRefs > 0 ? 'high' : 'medium',
    recommendation: 'UI確認用のweb-only dev scriptとworker起動scriptを分離し、必要なworkerだけを明示起動できるようにする。'
  };
}

function extractConcurrentlyCommands(command) {
  if (!/\bconcurrently\b/.test(command)) return [];
  return [...command.matchAll(/"([^"]+)"|'([^']+)'/g)]
    .map((match) => match[1] ?? match[2])
    .filter(Boolean);
}

function countWorkerScriptRefs(command, scripts) {
  const directRefs = (command.match(/\bnpm:worker[\w:-]*/g) ?? []).length;
  const npmRunRefs = [...command.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)]
    .map((match) => match[1])
    .filter((scriptName) => scriptName.includes('worker') || /worker/i.test(scripts[scriptName] ?? ''))
    .length;
  return directRefs + npmRunRefs;
}

function countPreDevCommands(command) {
  const nextDevIndex = command.search(/\bnext\s+dev\b/);
  if (nextDevIndex === -1) return 0;
  const beforeNextDev = command.slice(0, nextDevIndex);
  return (beforeNextDev.match(/&&|\|\|/g) ?? []).length;
}

function buildRuntimeProbePlan(scripts, heavyDevScripts) {
  const webScript = resolveWebDevScript(scripts);
  const fullScript = resolveFullDevScript(scripts, heavyDevScripts);
  const commands = [
    webScript ? {
      id: 'web-dev-startup',
      command: `npm run ${webScript}`,
      metrics: ['startup_seconds', 'next_ready_log_time', 'process_rss_mb', 'process_cpu_percent'],
      purpose: 'UI確認だけに必要なNext.js dev serverの起動時間と常駐メモリを測る。'
    } : null,
    fullScript ? {
      id: 'full-local-startup',
      command: `npm run ${fullScript}`,
      metrics: ['startup_seconds', 'process_count', 'total_rss_mb', 'worker_rss_mb'],
      purpose: 'worker込みのフルローカル起動が必要な時の上限コストを測る。'
    } : null,
    {
      id: 'api-latency-projects',
      command: 'curl -w "time_total=%{time_total}\\n" -o /dev/null -s http://localhost:${PORT:-3000}/api/projects',
      metrics: ['api_latency_ms', 'http_status'],
      purpose: 'ローカル初期表示に近いAPI latencyを測る。認証が必要な場合はブラウザ計測に置き換える。'
    }
  ].filter(Boolean);

  return {
    status: commands.length > 0 ? 'available' : 'unavailable',
    auto_run: false,
    reason: '診断は対象リポジトリのserverやworkerを自動起動しない。計測はtask実行時の明示操作として残す。',
    commands
  };
}

function resolveWebDevScript(scripts) {
  if (scripts['dev:web']) return 'dev:web';
  if (scripts.dev && /\bnext\s+dev\b/.test(scripts.dev) && !/\bconcurrently\b/.test(scripts.dev)) return 'dev';
  if (scripts['dev:turbo'] && /\bnext\s+dev\b/.test(scripts['dev:turbo']) && !/\bconcurrently\b/.test(scripts['dev:turbo'])) return 'dev:turbo';
  return null;
}

function resolveFullDevScript(scripts, heavyDevScripts) {
  if (scripts['local:full']) return 'local:full';
  if (scripts['dev:full']) return 'dev:full';
  if (scripts['workers:dev']) return 'workers:dev';
  return heavyDevScripts[0]?.script_name ?? null;
}

function summarizeGateEffects(hits) {
  return {
    block: hits.filter((hit) => hit.gate_effect === 'block').length,
    review: hits.filter((hit) => hit.gate_effect === 'review').length,
    info: hits.filter((hit) => hit.gate_effect === 'info').length
  };
}
