import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const TARGET_SKILLS_DIR = path.join('.claude', 'skills');

export async function listBundledSkills() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    const content = await readFile(skillPath, 'utf8');
    const metadata = parseSkillFrontmatter(content);
    skills.push({
      name: metadata.name ?? entry.name,
      description: metadata.description ?? '',
      source_path: skillPath,
      relative_path: path.join('skills', entry.name, 'SKILL.md')
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function installBundledSkills(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const skills = await listBundledSkills();
  const results = [];
  for (const skill of skills) {
    const source = skill.source_path;
    const target = path.join(root, TARGET_SKILLS_DIR, skill.name, 'SKILL.md');
    const sourceContent = await readFile(source, 'utf8');
    const targetContent = await readOptional(target);
    const exists = targetContent !== null;
    const same = exists && targetContent === sourceContent;
    let status = 'up_to_date';
    if (!same) {
      if (!exists) status = options.dryRun ? 'would_install' : 'installed';
      else if (options.force) status = options.dryRun ? 'would_overwrite' : 'overwritten';
      else status = 'skipped';
    }
    if (!options.dryRun && ['installed', 'overwritten'].includes(status)) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, sourceContent);
    }
    results.push({
      name: skill.name,
      description: skill.description,
      status,
      target_path: toDisplayPath(root, target),
      source_path: skill.relative_path
    });
  }
  return {
    mode: 'install',
    dry_run: Boolean(options.dryRun),
    force: Boolean(options.force),
    target_root: root,
    target_dir: path.join(root, TARGET_SKILLS_DIR),
    skills: results,
    summary: summarizeSkillResults(results)
  };
}

export async function verifyBundledSkills(repoRoot) {
  const root = path.resolve(repoRoot);
  const skills = await listBundledSkills();
  const results = [];
  for (const skill of skills) {
    const sourceContent = await readFile(skill.source_path, 'utf8');
    const target = path.join(root, TARGET_SKILLS_DIR, skill.name, 'SKILL.md');
    const targetContent = await readOptional(target);
    let status = 'ok';
    if (targetContent === null) status = 'missing';
    else if (targetContent !== sourceContent) status = 'outdated';
    results.push({
      name: skill.name,
      description: skill.description,
      status,
      target_path: toDisplayPath(root, target),
      source_path: skill.relative_path
    });
  }
  const summary = summarizeSkillResults(results);
  return {
    mode: 'verify',
    target_root: root,
    target_dir: path.join(root, TARGET_SKILLS_DIR),
    overall_status: results.every((item) => item.status === 'ok') ? 'ok' : 'needs_install',
    skills: results,
    summary
  };
}

export function renderSkillsList(skills) {
  return [
    '# VibePro Skills',
    '',
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`)
  ].join('\n') + '\n';
}

export function renderSkillsInstall(result) {
  return renderSkillResult('VibePro Skills Install', result);
}

export function renderSkillsVerify(result) {
  return renderSkillResult('VibePro Skills Verify', result);
}

function renderSkillResult(title, result) {
  return `${title}

Target: ${result.target_dir}

${result.skills.map((skill) => `- ${skill.name}: ${skill.status} (${skill.target_path})`).join('\n')}

Summary: ${Object.entries(result.summary).map(([key, value]) => `${key}=${value}`).join(', ')}
`;
}

function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const metadata = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    metadata[key] = value;
  }
  return metadata;
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

function summarizeSkillResults(results) {
  return results.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] ?? 0) + 1;
    return summary;
  }, {});
}

function toDisplayPath(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative.startsWith('..') ? filePath : relative;
}
