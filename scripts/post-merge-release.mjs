import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDefault = path.resolve(path.dirname(scriptPath), '..');
const NONE = 'なし';

export function extractReleaseSections(body = '') {
  const release = section(body, ['Release Notes', 'リリースノート']) || body;
  return {
    changeSummary: subsection(release, ['Change Summary', '変更概要', '解決']) || NONE,
    compatibility: subsection(release, ['Compatibility', '互換性・破壊的変更', '互換性']) || NONE,
    userAction: subsection(release, ['User Action', '利用者に必要な操作', '利用者操作']) || NONE
  };
}

function section(markdown, names) {
  return captureSection(markdown, 2, names);
}

function subsection(markdown, names) {
  return captureSection(markdown, 3, names);
}

function captureSection(markdown, level, names) {
  const escaped = names.map(escapeRegExp).join('|');
  const pattern = new RegExp(`^#{${level}}\\s+(?:${escaped})\\s*$([\\s\\S]*?)(?=^#{1,${level}}\\s)`, 'imu');
  const source = `${markdown ?? ''}`.replace(/\r\n/g, '\n') + '\n# __VIBEPRO_END__\n';
  const match = source.match(pattern);
  return normalizeContent(match?.[1]);
}

function normalizeContent(value) {
  return sanitizeReleaseContent(`${value ?? ''}`.trim().replace(/\n{3,}/g, '\n\n'));
}

export function sanitizeReleaseContent(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{{', '&#123;&#123;')
    .replaceAll('}}', '&#125;&#125;');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function renderReleaseNote(event) {
  const pr = validateMergedPullRequest(event);
  const notes = extractReleaseSections(pr.body);
  const title = sanitizeReleaseContent(pr.title);
  return `## [#${pr.number}](${pr.html_url}) ${title}\n\n` +
    `- Author: @${pr.user.login}\n- Merged: ${pr.merged_at}\n- Commit: \`${pr.merge_commit_sha}\`\n\n` +
    `### Change Summary\n\n${notes.changeSummary}\n\n` +
    `### Compatibility\n\n${notes.compatibility}\n\n` +
    `### User Action\n\n${notes.userAction}\n`;
}

export async function projectReleaseNote(root, event) {
  const pr = validateMergedPullRequest(event);
  const date = new Date(pr.merged_at);
  if (Number.isNaN(date.valueOf())) throw new Error('pull_request.merged_at must be an ISO date');
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const note = renderReleaseNote(event);
  const block = releaseBlock(pr.number, note);
  const targets = [
    [`docs/releases/${month}.md`, `# ${date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}\n`],
    [`docs/ja/releases/${month}.md`, `# ${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月\n`]
  ];
  for (const [relative, heading] of targets) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await upsertBlock(target, block, pr.number, heading);
  }
  await upsertIndexEntry(root, pr, month);
  await upsertBlock(path.join(root, 'CHANGELOG.md'), block, pr.number, '# Changelog\n\n## Unreleased\n');
  return { month, number: pr.number, note };
}

async function upsertIndexEntry(root, pr, month) {
  const title = sanitizeReleaseContent(pr.title);
  const entries = [
    ['docs/releases/index.md', `- [PR #${pr.number}](${pr.html_url}) — [${month}](/releases/${month}): ${title}`],
    ['docs/ja/releases/index.md', `- [PR #${pr.number}](${pr.html_url}) — [${month}](/ja/releases/${month}): ${title}`]
  ];
  const start = `<!-- vibepro-release-index-pr:${pr.number}:start -->`;
  const end = `<!-- vibepro-release-index-pr:${pr.number}:end -->`;
  for (const [relative, entry] of entries) {
    const file = path.join(root, relative);
    const content = await readFile(file, 'utf8');
    const block = `${start}\n${entry}\n${end}`;
    const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'u');
    const next = pattern.test(content) ? content.replace(pattern, block) : `${content.trimEnd()}\n\n${block}\n`;
    await writeFile(file, next);
  }
}

export async function projectPublishedVersion(root, before, after, mergedAt) {
  if (!shouldReleaseVersion(before, after)) return false;
  for (const relative of [
    'docs/ja/reference/version-history.md', 'docs/reference/version-history.md',
    'docs/ja/guide/release-and-audit.md', 'docs/guide/release-and-audit.md'
  ]) {
    const file = path.join(root, relative);
    const content = await readFile(file, 'utf8');
    await writeFile(file, content.replaceAll(before, after));
  }
  const date = new Date(mergedAt).toISOString().slice(0, 10);
  const rows = [
    ['docs/ja/releases/index.md', `| ${date} | [\`${after}\`](https://www.npmjs.com/package/vibepro/v/${after}) | npm \`${npmDistTags(after).join('` / `')}\` | PRマージ後のcontinuous release |`],
    ['docs/releases/index.md', `| ${date} | [\`${after}\`](https://www.npmjs.com/package/vibepro/v/${after}) | npm \`${npmDistTags(after).join('` / `')}\` | Post-merge continuous release |`]
  ];
  for (const [relative, row] of rows) {
    const file = path.join(root, relative);
    const content = await readFile(file, 'utf8');
    if (!content.includes(`/v/${after})`)) {
      const separator = /^\| ---.*$/mu;
      await writeFile(file, content.replace(separator, (match) => `${match}\n${row}`));
    }
  }
  return true;
}

function releaseBlock(number, note) {
  return `<!-- vibepro-release-pr:${number}:start -->\n${note}\n<!-- vibepro-release-pr:${number}:end -->`;
}

async function upsertBlock(file, block, number, initial) {
  let content;
  try { content = await readFile(file, 'utf8'); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    content = initial;
  }
  const start = `<!-- vibepro-release-pr:${number}:start -->`;
  const end = `<!-- vibepro-release-pr:${number}:end -->`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'u');
  const next = pattern.test(content)
    ? content.replace(pattern, block)
    : `${content.trimEnd()}\n\n${block}\n`;
  await writeFile(file, next);
}

function validateMergedPullRequest(event) {
  const pr = event?.pull_request;
  for (const key of ['number', 'title', 'merged_at', 'merge_commit_sha', 'html_url']) {
    if (!pr?.[key]) throw new Error(`pull_request.${key} is required`);
  }
  if (!pr?.user?.login) throw new Error('pull_request.user.login is required');
  return { ...pr, body: pr.body ?? '' };
}

export function shouldReleaseVersion(before, after) {
  return compareSemver(after, before) > 0;
}

function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (!left.pre.length && right.pre.length) return 1;
  if (left.pre.length && !right.pre.length) return -1;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    if (left.pre[index] === undefined) return -1;
    if (right.pre[index] === undefined) return 1;
    if (left.pre[index] === right.pre[index]) continue;
    const ln = /^\d+$/.test(left.pre[index]);
    const rn = /^\d+$/.test(right.pre[index]);
    if (ln && rn) return Number(left.pre[index]) > Number(right.pre[index]) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return left.pre[index] > right.pre[index] ? 1 : -1;
  }
  return 0;
}

function parseSemver(value) {
  const match = `${value}`.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u);
  if (!match) throw new Error(`Invalid SemVer: ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4]?.split('.') ?? [] };
}

export function npmDistTags(version) {
  const { pre } = parseSemver(version);
  if (!pre.length) return ['latest'];
  if (pre[0] === 'alpha') return ['alpha'];
  if (pre[0] === 'beta') return ['beta', 'latest'];
  return [pre[0]];
}

export async function reconcileNpmRelease({
  root = rootDefault,
  version,
  expectedSha,
  attempts = 6,
  delay = wait,
  metadata = npmMetadata,
  execute = run
}) {
  const existing = await readMetadataWithRetry(() => metadata(version), attempts, delay);
  if (existing) assertGitHead(existing, expectedSha, version);
  else execute('npm', ['publish', '--access', 'public', '--tag', npmDistTags(version)[0]], root);

  const published = await retry(() => metadata(version), attempts, delay);
  assertGitHead(published, expectedSha, version);
  for (const tag of npmDistTags(version)) execute('npm', ['dist-tag', 'add', `vibepro@${version}`, tag], root);
  await retry(() => {
    const tags = JSON.parse(execute('npm', ['view', 'vibepro', 'dist-tags', '--json'], root));
    return npmDistTags(version).every((tag) => tags[tag] === version) ? tags : null;
  }, attempts, delay);
  return published;
}

function npmMetadata(version) {
  const result = spawnSync('npm', ['view', `vibepro@${version}`, 'version', 'gitHead', '--json'], { encoding: 'utf8' });
  if (result.status !== 0) {
    const diagnostic = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
    if (/E404|404 Not Found|is not in this registry/iu.test(diagnostic)) return null;
    throw new Error(`npm metadata lookup failed for vibepro@${version}: ${diagnostic.trim() || `exit ${result.status}`}`);
  }
  try { return JSON.parse(result.stdout); } catch (error) {
    throw new Error(`npm metadata lookup returned invalid JSON for vibepro@${version}: ${error.message}`);
  }
}

async function readMetadataWithRetry(operation, attempts, delay) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try { return operation(); } catch (error) {
      lastError = error;
      if (index < attempts - 1) await delay(2 ** index * 1000);
    }
  }
  throw lastError;
}

function assertGitHead(metadata, expectedSha, version) {
  if (!metadata || metadata.version !== version || metadata.gitHead !== expectedSha) {
    throw new Error(`npm vibepro@${version} does not match expected gitHead ${expectedSha}; published versions are immutable`);
  }
}

async function retry(operation, attempts, delay) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const value = operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    if (index < attempts - 1) await delay(2 ** index * 1000);
  }
  if (lastError) throw lastError;
  throw new Error(`npm registry did not converge after ${attempts} attempts`);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function versionAt(root, ref) {
  const content = run('git', ['show', `${ref}:package.json`], root);
  return JSON.parse(content).version;
}

async function writeOutput(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, lines);
  else process.stdout.write(lines);
}

async function main(args) {
  const [command, ...rest] = args;
  const option = (name) => rest[rest.indexOf(name) + 1];
  if (command === 'plan') {
    const event = JSON.parse(await readFile(option('--event'), 'utf8'));
    const before = versionAt(rootDefault, event.pull_request.base.sha);
    const after = versionAt(rootDefault, event.pull_request.merge_commit_sha);
    validateMergedPullRequest(event);
    await writeOutput({ release_required: shouldReleaseVersion(before, after), version: after });
    return;
  }
  if (command === 'project') {
    const event = JSON.parse(await readFile(option('--event'), 'utf8'));
    const before = versionAt(rootDefault, event.pull_request.base.sha);
    const after = versionAt(rootDefault, event.pull_request.merge_commit_sha);
    const result = await projectReleaseNote(rootDefault, event);
    await projectPublishedVersion(rootDefault, before, after, event.pull_request.merged_at);
    await writeOutput({ release_required: shouldReleaseVersion(before, after), version: after, month: result.month, pr_number: result.number });
    return;
  }
  if (command === 'release-body') {
    const event = JSON.parse(await readFile(option('--event'), 'utf8'));
    await writeFile(option('--output'), renderReleaseNote(event));
    return;
  }
  if (command === 'publish-npm') {
    await reconcileNpmRelease({ version: option('--version'), expectedSha: option('--sha') });
    return;
  }
  throw new Error('Usage: post-merge-release.mjs <plan|project|release-body|publish-npm>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
