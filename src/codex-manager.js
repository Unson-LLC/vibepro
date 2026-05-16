import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = path.join(PACKAGE_ROOT, 'agent-instructions', 'codex', 'AGENTS.vibepro.md');
const TARGET_FILE = 'AGENTS.md';
const START_MARKER = '<!-- VIBEPRO_CODEX_START -->';
const END_MARKER = '<!-- VIBEPRO_CODEX_END -->';

export async function installCodexInstructions(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const target = path.join(root, TARGET_FILE);
  const block = await readBundledBlock();
  const existing = await readOptional(target);
  const inspection = inspectContent(existing, block);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  let status = 'up_to_date';
  let nextContent = existing;

  if (existing === null) {
    status = dryRun ? 'would_install' : 'installed';
    nextContent = `${block}\n`;
  } else if (!inspection.has_block) {
    status = dryRun ? 'would_append' : 'appended';
    nextContent = appendBlock(existing, block);
  } else if (!inspection.matches_bundled) {
    status = force
      ? (dryRun ? 'would_overwrite' : 'overwritten')
      : 'skipped';
    if (force) nextContent = replaceBlock(existing, block);
  }

  if (!dryRun && ['installed', 'appended', 'overwritten'].includes(status)) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, nextContent);
  }

  return {
    mode: 'install',
    dry_run: dryRun,
    force,
    target_root: root,
    target_path: TARGET_FILE,
    status,
    has_existing_file: existing !== null,
    has_managed_block: inspection.has_block,
    matches_bundled: inspection.matches_bundled
  };
}

export async function verifyCodexInstructions(repoRoot) {
  const root = path.resolve(repoRoot);
  const target = path.join(root, TARGET_FILE);
  const block = await readBundledBlock();
  const existing = await readOptional(target);
  const inspection = inspectContent(existing, block);
  let status = 'ok';
  if (existing === null || !inspection.has_block) status = 'missing';
  else if (!inspection.matches_bundled) status = 'outdated';

  return {
    mode: 'verify',
    target_root: root,
    target_path: TARGET_FILE,
    overall_status: status === 'ok' ? 'ok' : 'needs_install',
    status,
    has_existing_file: existing !== null,
    has_managed_block: inspection.has_block,
    matches_bundled: inspection.matches_bundled
  };
}

export function renderCodexInstall(result) {
  return renderCodexResult('VibePro Codex Install', result);
}

export function renderCodexVerify(result) {
  return renderCodexResult('VibePro Codex Verify', result);
}

async function readBundledBlock() {
  const template = (await readFile(TEMPLATE_PATH, 'utf8')).trim();
  return `${START_MARKER}\n${template}\n${END_MARKER}`;
}

function inspectContent(content, bundledBlock) {
  if (content === null) {
    return {
      has_block: false,
      matches_bundled: false
    };
  }
  const currentBlock = extractBlock(content);
  return {
    has_block: currentBlock !== null,
    matches_bundled: currentBlock === bundledBlock
  };
}

function appendBlock(content, block) {
  const trimmed = content.trimEnd();
  if (!trimmed) return `${block}\n`;
  return `${trimmed}\n\n${block}\n`;
}

function replaceBlock(content, block) {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER, start);
  if (start === -1 || end === -1) return appendBlock(content, block);
  return `${content.slice(0, start)}${block}${content.slice(end + END_MARKER.length)}`;
}

function extractBlock(content) {
  const start = content.indexOf(START_MARKER);
  if (start === -1) return null;
  const end = content.indexOf(END_MARKER, start);
  if (end === -1) return null;
  return content.slice(start, end + END_MARKER.length).trim();
}

async function readOptional(filePath) {
  try {
    await stat(filePath);
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function renderCodexResult(title, result) {
  const lines = [
    title,
    '',
    `Target: ${path.join(result.target_root, result.target_path)}`,
    `Status: ${result.status}`
  ];
  if (result.overall_status) lines.push(`Overall: ${result.overall_status}`);
  if (result.status === 'skipped') lines.push('Hint: rerun with --force to replace the managed VibePro block.');
  return `${lines.join('\n')}\n`;
}
