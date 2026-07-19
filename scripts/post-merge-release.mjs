import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDefault = path.resolve(path.dirname(scriptPath), '..');
const NONE = 'なし';
const REPOSITORY_SOURCE_ROOT = 'https://github.com/Unson-LLC/vibepro/blob/main/';
const REPOSITORY_RAW_ROOT = 'https://raw.githubusercontent.com/Unson-LLC/vibepro/main/';

export function extractReleaseSections(body = '') {
  const release = section(body, ['Release Notes', 'リリースノート']) || body;
  return {
    changeSummary: normalizeContent(subsection(release, ['Change Summary', '変更概要', '解決'])) || NONE,
    compatibility: normalizeContent(subsection(release, ['Compatibility', '互換性・破壊的変更', '互換性'])) || NONE,
    userAction: normalizeContent(subsection(release, ['User Action', '利用者に必要な操作', '利用者操作'])) || NONE
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
  return `${match?.[1] ?? ''}`.trim().replace(/\n{3,}/g, '\n\n');
}

function normalizeContent(value) {
  return sanitizeReleaseContent(normalizeReleaseDocumentationLinks(`${value ?? ''}`));
}

export function normalizeReleaseDocumentationLinks(value) {
  const source = `${value ?? ''}`;
  const protectedRanges = findProtectedCodeRanges(source);
  const replacements = findMarkdownLinkReplacements(source, protectedRanges);
  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce((output, replacement) => (
      output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
    ), source);
}

function findProtectedCodeRanges(source) {
  const fenced = findFencedCodeRanges(source);
  return [...fenced, ...findInlineCodeRanges(source, fenced)]
    .sort((left, right) => left.start - right.start);
}

function findFencedCodeRanges(source) {
  const ranges = [];
  const lines = source.split('\n');
  let offset = 0;
  let fence = null;
  for (const line of lines) {
    const lineEnd = offset + line.length + (offset + line.length < source.length ? 1 : 0);
    const container = fence ? inspectFenceContainer(line, fence) : null;
    let closedFence = false;
    if (fence) {
      if (!container.continues) {
        ranges.push({ start: fence.start, end: offset });
        fence = null;
      } else if (container.marker) {
        const run = container.marker[1];
        if (run[0] === fence.character && run.length >= fence.length && container.marker[2].trim() === '') {
          ranges.push({ start: fence.start, end: lineEnd });
          fence = null;
          closedFence = true;
        }
      }
    }
    if (!fence && !closedFence) {
      const opener = inspectFenceOpener(line);
      if (opener && (opener.marker[1][0] === '~' || !opener.marker[2].includes('`'))) {
        fence = {
          start: offset,
          character: opener.marker[1][0],
          length: opener.marker[1].length,
          quoteDepth: opener.quoteDepth,
          listIndent: opener.listIndent
        };
      }
    }
    offset = lineEnd;
  }
  if (fence) ranges.push({ start: fence.start, end: source.length });
  return ranges;
}

function inspectFenceOpener(line) {
  const quote = consumeBlockquotePrefix(line);
  let index = quote.index;
  let listIndent = 0;
  for (;;) {
    const list = line.slice(index).match(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/u);
    if (!list) break;
    index += list[0].length;
    listIndent += list[0].length;
  }
  const marker = line.slice(index).match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
  return marker ? { marker, quoteDepth: quote.depth, listIndent } : null;
}

function inspectFenceContainer(line, fence) {
  const quote = consumeBlockquotePrefix(line);
  if (quote.depth < fence.quoteDepth) return { continues: false, marker: null };
  let content = line.slice(quote.index);
  if (fence.listIndent > 0) {
    if (content.trim() === '') return { continues: true, marker: null };
    const indentation = content.match(/^[ \t]*/u)?.[0].length ?? 0;
    if (indentation < fence.listIndent) return { continues: false, marker: null };
    content = content.slice(fence.listIndent);
  }
  return { continues: true, marker: content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u) };
}

function consumeBlockquotePrefix(line) {
  let index = 0;
  let depth = 0;
  for (;;) {
    const marker = line.slice(index).match(/^ {0,3}>[ \t]?/u);
    if (!marker) break;
    index += marker[0].length;
    depth += 1;
  }
  return { index, depth };
}

function findInlineCodeRanges(source, fencedRanges) {
  const ranges = [];
  for (let index = 0; index < source.length;) {
    const fenced = rangeContaining(fencedRanges, index);
    if (fenced) {
      index = fenced.end;
      continue;
    }
    if (source[index] !== '`' || isEscaped(source, index)) {
      index += 1;
      continue;
    }
    const openingStart = index;
    while (source[index] === '`') index += 1;
    const delimiterLength = index - openingStart;
    let closingEnd = -1;
    for (let candidate = index; candidate < source.length;) {
      const protectedFence = rangeContaining(fencedRanges, candidate);
      if (protectedFence) {
        candidate = protectedFence.end;
        continue;
      }
      if (source[candidate] !== '`' || isEscaped(source, candidate)) {
        candidate += 1;
        continue;
      }
      const runStart = candidate;
      while (source[candidate] === '`') candidate += 1;
      if (candidate - runStart === delimiterLength) {
        closingEnd = candidate;
        break;
      }
    }
    if (closingEnd >= 0) {
      ranges.push({ start: openingStart, end: closingEnd });
      index = closingEnd;
    }
  }
  return ranges;
}

function findMarkdownLinkReplacements(source, protectedRanges) {
  const replacements = [];
  const nonLabelRanges = [...protectedRanges];
  for (let index = 0; index < source.length; index += 1) {
    const protectedRange = rangeContaining(nonLabelRanges, index);
    if (protectedRange) {
      index = protectedRange.end - 1;
      continue;
    }
    if (source[index] !== '[' || isEscaped(source, index)) continue;
    const labelEnd = findClosingLabel(source, index, protectedRanges);
    if (labelEnd < 0 || source[labelEnd + 1] !== '(') continue;
    const destination = parseInlineDestination(source, labelEnd + 2);
    if (!destination) continue;
    nonLabelRanges.push({ start: labelEnd + 1, end: destination.linkEnd });
    if (!destination.value.startsWith('docs/')) continue;
    const imageMarker = index > 0 && source[index - 1] === '!' && !isEscaped(source, index - 1);
    const root = imageMarker ? REPOSITORY_RAW_ROOT : REPOSITORY_SOURCE_ROOT;
    let normalizedValue = `${root}${destination.value}`;
    if (destination.angleWrapped) {
      try {
        normalizedValue = encodeURI(normalizedValue);
      } catch (error) {
        if (error instanceof URIError) continue;
        throw error;
      }
    }
    replacements.push({
      start: destination.start,
      end: destination.end,
      value: normalizedValue
    });
  }
  return replacements;
}

function findClosingLabel(source, openingIndex, protectedRanges) {
  let depth = 1;
  for (let index = openingIndex + 1; index < source.length; index += 1) {
    const protectedRange = rangeContaining(protectedRanges, index);
    if (protectedRange) {
      index = protectedRange.end - 1;
      continue;
    }
    if (isEscaped(source, index)) continue;
    if (source[index] === '[') depth += 1;
    if (source[index] === ']') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function parseInlineDestination(source, openingIndex) {
  let index = openingIndex;
  while (/[ \t\n]/u.test(source[index] ?? '')) index += 1;
  const wrapperStart = index;
  const angleWrapped = source[index] === '<';
  if (angleWrapped) index += 1;
  const start = index;
  let depth = 0;
  while (index < source.length) {
    if (isEscaped(source, index)) {
      index += 2;
      continue;
    }
    const character = source[index];
    if (angleWrapped) {
      if (character === '>' || character === '\n') break;
    } else {
      if (character === '(') depth += 1;
      else if (character === ')' && depth > 0) depth -= 1;
      else if ((character === ')' || /[ \t\n]/u.test(character)) && depth === 0) break;
    }
    index += 1;
  }
  if (index === start || (angleWrapped && source[index] !== '>')) return null;
  const valueEnd = index;
  if (angleWrapped) index += 1;
  const linkEnd = findInlineLinkEnd(source, index);
  if (linkEnd < 0) return null;
  return {
    start: angleWrapped ? wrapperStart : start,
    end: angleWrapped ? index : valueEnd,
    value: source.slice(start, valueEnd),
    angleWrapped,
    linkEnd
  };
}

function findInlineLinkEnd(source, start) {
  let index = start;
  while (/[ \t\n]/u.test(source[index] ?? '')) index += 1;
  if (source[index] === ')') return index + 1;
  const delimiter = source[index];
  if (!['"', "'", '('].includes(delimiter)) return -1;
  const closing = delimiter === '(' ? ')' : delimiter;
  index += 1;
  for (; index < source.length; index += 1) {
    if (isEscaped(source, index)) {
      continue;
    }
    if (source[index] === closing) {
      index += 1;
      while (/[ \t\n]/u.test(source[index] ?? '')) index += 1;
      return source[index] === ')' ? index + 1 : -1;
    }
  }
  return -1;
}

function rangeContaining(ranges, index) {
  return ranges.find((range) => index >= range.start && index < range.end) ?? null;
}

function isEscaped(value, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
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
  versions = npmVersions,
  execute = run
}) {
  const existing = await readMetadataWithRetry(() => metadata(version), attempts, delay);
  if (existing) assertGitHead(existing, expectedSha, version);
  else execute('npm', ['publish', '--access', 'public', '--tag', npmDistTags(version)[0]], root);

  const published = await retry(() => metadata(version), attempts, delay);
  assertGitHead(published, expectedSha, version);
  await retry(async () => {
    const visibleVersions = await versions();
    const currentTags = JSON.parse(execute('npm', ['view', 'vibepro', 'dist-tags', '--json'], root));
    const desired = desiredDistTags(
      [...visibleVersions, version, ...Object.values(currentTags)],
      npmDistTags(version)
    );
    for (const [tag, desiredVersion] of Object.entries(desired)) {
      execute('npm', ['dist-tag', 'add', `vibepro@${desiredVersion}`, tag], root);
    }
    const tags = JSON.parse(execute('npm', ['view', 'vibepro', 'dist-tags', '--json'], root));
    return Object.entries(desired).every(([tag, desiredVersion]) => tags[tag] === desiredVersion) ? tags : null;
  }, attempts, delay);
  return published;
}

export function desiredDistTags(versions, tags) {
  const uniqueVersions = [...new Set(versions)].filter(Boolean);
  return Object.fromEntries(tags.map((tag) => {
    const candidates = uniqueVersions.filter((candidate) => npmDistTags(candidate).includes(tag));
    const desired = candidates.sort(compareSemver).at(-1);
    if (!desired) throw new Error(`No published version is eligible for npm dist-tag ${tag}`);
    return [tag, desired];
  }));
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

function npmVersions() {
  const result = spawnSync('npm', ['view', 'vibepro', 'versions', '--json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`npm versions lookup failed: ${(result.stderr ?? '').trim() || `exit ${result.status}`}`);
  try {
    const versions = JSON.parse(result.stdout);
    if (!Array.isArray(versions)) throw new Error('response is not an array');
    return versions;
  } catch (error) {
    throw new Error(`npm versions lookup returned invalid JSON: ${error.message}`);
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
      const value = await operation();
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
