import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const RUNTIME_MANIFEST_FILE = 'runtime-manifest.json';
const EXPECTED_PACKAGE_NAME = 'vibepro';
const EXPECTED_ORIGIN = 'https://github.com/Unson-LLC/vibepro.git';
const EVIDENCE_PURPOSES = new Set(['evidence_generation', 'pr_judgment']);

export class RuntimeIntegrityError extends Error {
  constructor(verdict, runtimeIdentity) {
    super(`${verdict.code}: ${verdict.reasons.join('; ')}`);
    this.name = 'RuntimeIntegrityError';
    this.code = verdict.code;
    this.verdict = verdict;
    this.runtime_identity = runtimeIdentity;
  }
}

export async function collectRuntimeInfo(options = {}) {
  const packageRoot = path.resolve(options.packageRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const packageJson = await readPackageJson(packageRoot);
  const git = await collectRuntimeGitInfo(packageRoot);
  const releaseManifest = await readAndValidateRuntimeManifest(packageRoot, packageJson);
  const mode = resolveRuntimeMode(options);
  const sourceKind = git.is_git_repo
    ? 'git_checkout'
    : releaseManifest.status === 'valid'
      ? 'npm_package'
      : 'unverified_package';
  const invokedAs = options.entrypoint ?? process.argv[1] ?? null;
  const entrypoint = await resolveRealPath(invokedAs);
  const manifestGit = releaseManifest.manifest?.source_git ?? null;
  const sourceGit = git.is_git_repo
    ? git
    : manifestGit
      ? {
          is_git_repo: false,
          commit: manifestGit.commit ?? null,
          branch: null,
          origin_url: manifestGit.origin_url ?? null,
          origin_main_commit: manifestGit.origin_main_commit ?? manifestGit.commit ?? null,
          origin_main_relation: 'published',
          dirty: false,
          dirty_summary: []
        }
      : git;
  const runtime = {
    schema_version: '0.2.0',
    collected_at: new Date().toISOString(),
    mode,
    source_kind: sourceKind,
    package: {
      name: packageJson?.name ?? EXPECTED_PACKAGE_NAME,
      version: packageJson?.version ?? 'unknown',
      exact_version: packageJson?.version ?? 'unknown',
      root: packageRoot
    },
    cli: {
      entrypoint,
      invoked_as: invokedAs ? path.resolve(invokedAs) : null,
      runtime_module: fileURLToPath(import.meta.url)
    },
    release_manifest: releaseManifest,
    source_git: sourceGit
  };
  runtime.identity_digest = buildRuntimeIdentityDigest(runtime);
  runtime.integrity = evaluateRuntimeIntegrity(runtime, { purpose: options.purpose ?? 'observation' });
  return runtime;
}

export async function assertRuntimeIntegrity(options = {}) {
  const purpose = options.purpose ?? 'observation';
  const runtime = await collectRuntimeInfo({ ...options, purpose });
  if (runtime.integrity.status !== 'trusted') {
    throw new RuntimeIntegrityError(runtime.integrity, runtime);
  }
  return runtime;
}

export function evaluateRuntimeIntegrity(runtime, options = {}) {
  const purpose = options.purpose ?? 'observation';
  const reasons = [];
  const relation = runtime.source_git?.origin_main_relation;

  if (runtime.source_git?.is_git_repo && ['behind', 'diverged'].includes(relation)) {
    reasons.push(`Git runtime is ${relation} relative to origin/main`);
    if (runtime.source_git.dirty) reasons.push('Git runtime is dirty');
    return blocked('stale_runtime', reasons, purpose);
  }

  if (runtime.mode === 'test') {
    if (!runtime.source_git?.is_git_repo || !['same', 'ahead'].includes(relation)) {
      return blocked('runtime_mismatch', ['internal test runtime must be a current Git checkout'], purpose);
    }
    return trusted(purpose, ['internal Node test runtime']);
  }

  if (runtime.mode === 'development') {
    if (!runtime.source_git?.is_git_repo) {
      return blocked('runtime_mismatch', ['development mode requires a Git checkout'], purpose);
    }
    if (!['same', 'ahead'].includes(relation)) {
      return blocked('runtime_mismatch', ['development runtime must be current with origin/main'], purpose);
    }
    if (EVIDENCE_PURPOSES.has(purpose)) {
      return blocked('runtime_mismatch', ['development runtime cannot generate evidence or PR judgment'], purpose);
    }
    return trusted(purpose, [runtime.source_git.dirty ? 'explicit dirty development runtime (observation only)' : 'explicit development runtime (observation only)']);
  }

  if (runtime.mode !== 'normal') {
    return blocked('runtime_mismatch', [`unsupported runtime mode: ${runtime.mode}`], purpose);
  }
  if (runtime.source_kind !== 'npm_package' || runtime.release_manifest?.status !== 'valid') {
    reasons.push('normal mode requires an immutable npm package with a valid runtime manifest');
    reasons.push(...(runtime.release_manifest?.errors ?? []));
    return blocked('runtime_mismatch', reasons, purpose);
  }
  if (runtime.package?.name !== EXPECTED_PACKAGE_NAME) {
    return blocked('runtime_mismatch', [`unexpected package name: ${runtime.package?.name ?? 'unknown'}`], purpose);
  }
  const manifestedPackage = runtime.release_manifest?.manifest?.package;
  const manifestedSource = runtime.release_manifest?.manifest?.source_git;
  if (manifestedPackage?.name !== runtime.package?.name || manifestedPackage?.version !== runtime.package?.exact_version) {
    return blocked('runtime_mismatch', ['recorded runtime manifest does not match the package identity'], purpose);
  }
  if (manifestedSource?.commit !== runtime.source_git?.commit || normalizeOrigin(manifestedSource?.origin_url) !== normalizeOrigin(EXPECTED_ORIGIN)) {
    return blocked('runtime_mismatch', ['recorded runtime source identity does not match the release manifest'], purpose);
  }
  if (!isEntrypointForPackage(runtime)) {
    return blocked('runtime_mismatch', ['resolved CLI entrypoint does not belong to the package root'], purpose);
  }
  if (!runtime.identity_digest || runtime.identity_digest !== buildRuntimeIdentityDigest(runtime)) {
    return blocked('runtime_mismatch', ['runtime identity digest is missing or inconsistent'], purpose);
  }
  return trusted(purpose, ['manifested immutable npm runtime']);
}

export function buildRuntimeIdentityDigest(runtime) {
  const stableIdentity = {
    schema_version: runtime.schema_version,
    mode: runtime.mode,
    source_kind: runtime.source_kind,
    package: {
      name: runtime.package?.name ?? null,
      version: runtime.package?.exact_version ?? runtime.package?.version ?? null,
      root: runtime.package?.root ?? null
    },
    cli: {
      entrypoint: runtime.cli?.entrypoint ?? null,
      runtime_module: runtime.cli?.runtime_module ?? null
    },
    release_manifest: runtime.release_manifest?.manifest ?? null,
    source_git: runtime.source_git ?? null
  };
  return createHash('sha256').update(JSON.stringify(stableIdentity)).digest('hex');
}

export function buildRuntimeDoctorCheck(runtime) {
  const integrity = evaluateRuntimeIntegrity(runtime, { purpose: 'observation' });
  const item = { ...runtime, integrity };
  const blockedRuntime = integrity.status !== 'trusted';
  return {
    id: 'VP-DOCTOR-CLI-RUNTIME',
    severity: blockedRuntime ? 'error' : 'info',
    status: blockedRuntime ? 'manual' : 'info',
    fixable: false,
    detail: blockedRuntime
      ? `${integrity.code}: ${integrity.reasons.join('; ')}`
      : `VibePro runtime: ${runtime.package.name}@${runtime.package.exact_version ?? runtime.package.version} (${runtime.package.root})`,
    recommendation: blockedRuntime
      ? integrity.code === 'stale_runtime'
        ? 'dirty差分を保全したまま、このcheckoutを通常利用から外し、公開済みのcanonical npm runtimeへ切り替える。'
        : '通常利用では公開済みexact versionのnpm runtimeをcanonical launcherから実行する。Git checkoutは明示的development観測に限る。'
      : 'このruntime identityを証跡へ記録して利用する。',
    items: [item],
    next_actions: []
  };
}

function blocked(code, reasons, purpose) {
  return { status: 'blocked', code, purpose, reasons };
}

function trusted(purpose, reasons) {
  return { status: 'trusted', code: null, purpose, reasons };
}

function resolveRuntimeMode(options) {
  if (options.mode) return options.mode;
  const env = options.env ?? process.env;
  if (env.VIBEPRO_RUNTIME_MODE) return env.VIBEPRO_RUNTIME_MODE;
  // Node's test runner owns this variable. It keeps repository tests independent
  // from the distributable runtime contract without making development mode an
  // evidence bypass in ordinary CLI processes.
  if (env.NODE_TEST_CONTEXT) return 'test';
  return 'normal';
}

function isEntrypointForPackage(runtime) {
  if (!runtime.cli?.entrypoint || !runtime.package?.root) return false;
  const expected = path.resolve(runtime.package.root, 'bin', 'vibepro.js');
  return path.resolve(runtime.cli.entrypoint) === expected;
}

async function readAndValidateRuntimeManifest(packageRoot, packageJson) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(packageRoot, RUNTIME_MANIFEST_FILE), 'utf8'));
  } catch (error) {
    return {
      status: error?.code === 'ENOENT' ? 'missing' : 'invalid',
      manifest: null,
      errors: [error?.code === 'ENOENT' ? `${RUNTIME_MANIFEST_FILE} is missing` : `${RUNTIME_MANIFEST_FILE} is not valid JSON`]
    };
  }
  const errors = [];
  if (manifest.schema_version !== '0.1.0') errors.push('unsupported runtime manifest schema');
  if (manifest.package?.name !== packageJson?.name) errors.push('manifest package name does not match package.json');
  if (manifest.package?.version !== packageJson?.version) errors.push('manifest package version does not match package.json');
  if (manifest.package?.entrypoint !== packageJson?.bin?.vibepro) errors.push('manifest CLI entrypoint does not match package.json');
  try {
    const packageJsonText = await readFile(path.join(packageRoot, 'package.json'), 'utf8');
    const digest = createHash('sha256').update(packageJsonText).digest('hex');
    if (manifest.package?.package_json_sha256 !== digest) errors.push('manifest package.json digest does not match');
  } catch {
    errors.push('package.json could not be hashed');
  }
  if (!/^[0-9a-f]{40}$/i.test(manifest.source_git?.commit ?? '')) errors.push('manifest source Git commit is invalid');
  if (normalizeOrigin(manifest.source_git?.origin_url) !== normalizeOrigin(EXPECTED_ORIGIN)) errors.push('manifest Git origin is unexpected');
  if (manifest.source_git?.dirty !== false) errors.push('manifest source Git checkout was dirty');
  if (!['same', 'ahead'].includes(manifest.source_git?.origin_main_relation)) errors.push('manifest source Git relation is not publishable');
  return { status: errors.length === 0 ? 'valid' : 'invalid', manifest, errors };
}

function normalizeOrigin(value) {
  return String(value ?? '').replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '').toLowerCase();
}

async function resolveRealPath(value) {
  if (!value) return null;
  const resolved = path.resolve(value);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
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
      origin_main_relation: null,
      dirty: null,
      dirty_summary: []
    };
  }
  const commit = await gitOptional(packageRoot, ['rev-parse', 'HEAD']);
  const branch = await gitOptional(packageRoot, ['branch', '--show-current']);
  const originUrl = await gitOptional(packageRoot, ['config', '--get', 'remote.origin.url']);
  const originMainCommit = await gitOptional(packageRoot, ['rev-parse', 'origin/main']);
  const originMainRelation = await resolveOriginMainRelation(packageRoot, commit, originMainCommit);
  const porcelain = await gitOptional(packageRoot, ['status', '--porcelain']);
  return {
    is_git_repo: true,
    commit: commit || null,
    branch: branch || null,
    origin_url: originUrl || null,
    origin_main_commit: originMainCommit || null,
    origin_main_relation: originMainRelation,
    dirty: Boolean(porcelain),
    dirty_summary: porcelain ? porcelain.split('\n').filter(Boolean).slice(0, 20) : []
  };
}

async function resolveOriginMainRelation(packageRoot, commit, originMainCommit) {
  if (!commit || !originMainCommit) return null;
  if (commit === originMainCommit) return 'same';
  const headBehindOriginMain = await gitExitCode(packageRoot, ['merge-base', '--is-ancestor', commit, originMainCommit]);
  if (headBehindOriginMain === 0) return 'behind';
  const originMainBehindHead = await gitExitCode(packageRoot, ['merge-base', '--is-ancestor', originMainCommit, commit]);
  if (originMainBehindHead === 0) return 'ahead';
  return 'diverged';
}

async function gitOptional(cwd, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function gitExitCode(cwd, args) {
  try {
    await execFileAsync('git', args, { cwd });
    return 0;
  } catch (error) {
    return typeof error.code === 'number' ? error.code : 1;
  }
}
