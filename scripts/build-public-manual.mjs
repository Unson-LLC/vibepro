import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

export function resolveBuildSourceCommit(root, environment = process.env) {
  const explicitCommit = environment.VIBEPRO_SOURCE_COMMIT?.trim();
  if (explicitCommit) return explicitCommit.slice(0, 12);

  const cloudflareCommit = environment.CF_PAGES_COMMIT_SHA?.trim();
  if (cloudflareCommit) return cloudflareCommit.slice(0, 12);

  const head = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim();
  return dirty ? `${head}-dirty` : head;
}

export function buildPublicManual(root = repositoryRoot) {
  const sourceCommit = resolveBuildSourceCommit(root);
  const vitepressBin = path.join(root, 'node_modules', 'vitepress', 'bin', 'vitepress.js');
  const result = spawnSync(process.execPath, [vitepressBin, 'build', 'docs'], {
    cwd: root,
    env: { ...process.env, VIBEPRO_SOURCE_COMMIT: sourceCommit },
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  buildPublicManual();
}
