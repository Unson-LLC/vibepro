#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REF = 'refs/heads/vibepro-npm-release-lock';
const REMOTE_REF = 'refs/remotes/origin/vibepro-npm-release-lock';
const MARKER = 'vibepro-npm-release-lock:';

export function parseLease(message = '') {
  const line = String(message).split('\n').find((value) => value.startsWith(MARKER));
  return line ? JSON.parse(line.slice(MARKER.length)) : { state: 'free', expires_at: 0 };
}

export async function acquireLease({ readRemote, tryWrite, sleep, now = Date.now, ttlMs = 2 * 60 * 60_000, maxAttempts = 900 }) {
  const owner = randomUUID();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remote = await readRemote();
    const lease = parseLease(remote?.message);
    if (remote && lease.state === 'locked' && Number(lease.expires_at) > now()) {
      await sleep(10_000);
      continue;
    }
    const token = await tryWrite(remote?.sha ?? null, { state: 'locked', owner, expires_at: now() + ttlMs });
    if (token) return { token, owner };
    await sleep(1_000);
  }
  throw new Error('Timed out acquiring the npm release lease');
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function commitLease(parent, value) {
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  const env = { ...process.env, GIT_AUTHOR_NAME: 'github-actions[bot]', GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com', GIT_COMMITTER_NAME: 'github-actions[bot]', GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com' };
  return git(['commit-tree', tree, '-p', parent || 'HEAD', '-m', `${MARKER}${JSON.stringify(value)}`], { env });
}

async function readRemote() {
  try { git(['fetch', 'origin', `+${REF}:${REMOTE_REF}`]); } catch {}
  try {
    const sha = git(['rev-parse', '--verify', REMOTE_REF]);
    return { sha, message: git(['show', '-s', '--format=%B', sha]) };
  } catch { return null; }
}

async function tryWrite(expected, value) {
  const token = commitLease(expected, value);
  const lease = expected === null ? `--force-with-lease=${REF}:` : `--force-with-lease=${REF}:${expected}`;
  try { git(['push', lease, 'origin', `${token}:${REF}`]); return token; } catch { return null; }
}

async function release(token) {
  const remote = await readRemote();
  if (!remote || remote.sha !== token) return;
  const free = commitLease(token, { state: 'free', owner: null, expires_at: 0 });
  git(['push', `--force-with-lease=${REF}:${token}`, 'origin', `${free}:${REF}`]);
}

async function main() {
  if (process.argv[2] === 'acquire') {
    const result = await acquireLease({ readRemote, tryWrite, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
    process.stdout.write(`${result.token}\n`);
  } else if (process.argv[2] === 'release' && process.argv[3]) await release(process.argv[3]);
  else throw new Error('Usage: npm-release-lock.mjs <acquire|release> [token]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
