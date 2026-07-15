import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

export function resolveCleanSourceCommit(root) {
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim();
  if (dirty) {
    throw new Error('Public manual deployment requires a clean git worktree.');
  }
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim();
}

export function wranglerPagesArguments(commitHash) {
  return [
    'wrangler',
    'pages',
    'deploy',
    'docs/.vitepress/dist',
    '--project-name',
    'vibepro',
    '--branch',
    'main',
    '--commit-hash',
    commitHash,
    '--commit-dirty=false'
  ];
}

export function deployPublicManual(root = repositoryRoot) {
  const commitHash = resolveCleanSourceCommit(root);
  run('npm', ['run', 'docs:build'], root);
  const postBuildCommit = resolveCleanSourceCommit(root);
  if (postBuildCommit !== commitHash) {
    throw new Error('Git HEAD changed while building the public manual.');
  }
  run('npx', wranglerPagesArguments(commitHash), root);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  deployPublicManual();
}
