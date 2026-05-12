import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function collectRuntimeInfo(options = {}) {
  const packageRoot = options.packageRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const packageJson = await readPackageJson(packageRoot);
  const git = await collectRuntimeGitInfo(packageRoot);
  return {
    schema_version: '0.1.0',
    collected_at: new Date().toISOString(),
    package: {
      name: packageJson?.name ?? 'vibepro',
      version: packageJson?.version ?? 'unknown',
      root: packageRoot
    },
    cli: {
      entrypoint: process.argv[1] ? path.resolve(process.argv[1]) : null,
      runtime_module: fileURLToPath(import.meta.url)
    },
    source_git: git
  };
}

export function buildRuntimeDoctorCheck(runtime) {
  const git = runtime.source_git;
  if (!git?.is_git_repo) {
    return {
      id: 'VP-DOCTOR-CLI-RUNTIME',
      severity: 'info',
      status: 'info',
      fixable: false,
      detail: `VibePro runtime: ${runtime.package.name}@${runtime.package.version} (${runtime.package.root})`,
      recommendation: 'package環境のため、git commit比較は実行しない。',
      items: [runtime],
      next_actions: []
    };
  }

  const stale = Boolean(git.origin_main_commit && git.commit && git.origin_main_commit !== git.commit);
  return {
    id: 'VP-DOCTOR-CLI-RUNTIME',
    severity: stale ? 'warning' : 'info',
    status: stale ? 'manual' : 'info',
    fixable: false,
    detail: stale
      ? `VibePro runtime HEAD ${shortSha(git.commit)} が origin/main ${shortSha(git.origin_main_commit)} と一致しない。`
      : `VibePro runtime HEAD ${shortSha(git.commit)} を使用中。`,
    recommendation: stale
      ? 'CLI実体のcheckoutを最新のorigin/mainへ合わせるか、意図したcommitであることを確認する。'
      : 'VibePro CLI実体はorigin/mainと一致している。',
    items: [runtime],
    next_actions: stale ? [{
      command: `git -C ${runtime.package.root} switch --detach origin/main`,
      reason: 'VibePro CLI実体をorigin/mainへ合わせる。',
      expected_after: 'VP-DOCTOR-CLI-RUNTIME が stale warning を出さない。',
      safe_to_run: false
    }] : []
  };
}

function shortSha(value) {
  return value ? String(value).slice(0, 12) : 'unknown';
}

async function readPackageJson(packageRoot) {
  try {
    return JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function collectRuntimeGitInfo(packageRoot) {
  const inside = await gitOptional(packageRoot, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') {
    return {
      is_git_repo: false,
      commit: null,
      branch: null,
      origin_url: null,
      origin_main_commit: null,
      dirty: null
    };
  }
  const commit = await gitOptional(packageRoot, ['rev-parse', 'HEAD']);
  const branch = await gitOptional(packageRoot, ['branch', '--show-current']);
  const originUrl = await gitOptional(packageRoot, ['config', '--get', 'remote.origin.url']);
  const originMainCommit = await gitOptional(packageRoot, ['rev-parse', 'origin/main']);
  const porcelain = await gitOptional(packageRoot, ['status', '--porcelain']);
  return {
    is_git_repo: true,
    commit: commit || null,
    branch: branch || null,
    origin_url: originUrl || null,
    origin_main_commit: originMainCommit || null,
    dirty: Boolean(porcelain),
    dirty_summary: porcelain ? porcelain.split('\n').filter(Boolean).slice(0, 20) : []
  };
}

async function gitOptional(cwd, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}
