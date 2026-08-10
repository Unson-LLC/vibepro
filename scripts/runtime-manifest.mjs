import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'runtime-manifest.json');
const command = process.argv[2];

if (command === 'generate') {
  await generate();
} else if (command === 'clean') {
  await unlink(manifestPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
} else {
  throw new Error('Usage: runtime-manifest.mjs <generate|clean>');
}

async function generate() {
  const packageJsonText = await readFile(path.join(root, 'package.json'), 'utf8');
  const packageJson = JSON.parse(packageJsonText);
  const [commit, originUrl, originMainCommit, porcelain] = await Promise.all([
    git(['rev-parse', 'HEAD']),
    git(['config', '--get', 'remote.origin.url']),
    git(['rev-parse', 'origin/main']),
    git(['status', '--porcelain'])
  ]);
  const originMainRelation = await relation(commit, originMainCommit);
  const dryRun = process.env.npm_config_dry_run === 'true';
  if (porcelain && !dryRun) throw new Error('Refusing to pack VibePro from a dirty Git checkout');
  if (!['same', 'ahead'].includes(originMainRelation)) {
    throw new Error(`Refusing to pack VibePro from a ${originMainRelation ?? 'unknown'} Git runtime`);
  }
  const manifest = {
    schema_version: '0.1.0',
    package: {
      name: packageJson.name,
      version: packageJson.version,
      package_json_sha256: createHash('sha256').update(packageJsonText).digest('hex'),
      entrypoint: packageJson.bin?.vibepro ?? 'bin/vibepro.js'
    },
    source_git: {
      commit,
      origin_url: originUrl,
      origin_main_commit: originMainCommit,
      origin_main_relation: originMainRelation,
      dirty: Boolean(porcelain)
    }
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}

async function relation(commit, originMainCommit) {
  if (!commit || !originMainCommit) return null;
  if (commit === originMainCommit) return 'same';
  if (await gitExit(['merge-base', '--is-ancestor', originMainCommit, commit]) === 0) return 'ahead';
  if (await gitExit(['merge-base', '--is-ancestor', commit, originMainCommit]) === 0) return 'behind';
  return 'diverged';
}

async function git(args) {
  const { stdout } = await execFileAsync('git', args, { cwd: root });
  return stdout.trim();
}

async function gitExit(args) {
  try {
    await execFileAsync('git', args, { cwd: root });
    return 0;
  } catch (error) {
    return typeof error.code === 'number' ? error.code : 1;
  }
}
