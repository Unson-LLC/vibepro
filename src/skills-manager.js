import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const TARGET_SKILLS_DIR = path.join('.claude', 'skills');
const REQUIRED_SKILL_SECTIONS = [
  'When to Use',
  'Common Rationalizations',
  'Red Flags',
  'Verification'
];
const PROCESS_SECTION_ALIASES = new Set([
  'Core Process',
  'Process',
  'Workflow',
  'Required Workflow',
  'Operating Order',
  'Diagnosis Packages',
  'Review Order'
].map(normalizeSectionName));

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

export async function lintBundledSkills(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const skills = await listBundledSkills();
  const results = [];
  for (const skill of skills) {
    const content = await readFile(skill.source_path, 'utf8');
    const lint = lintSkillContent(content, skill);
    results.push({
      name: skill.name,
      description: skill.description,
      status: lint.issues.some((issue) => issue.severity === 'error') ? 'fail' : 'pass',
      source_path: skill.relative_path,
      target_path: toDisplayPath(root, path.join(root, TARGET_SKILLS_DIR, skill.name, 'SKILL.md')),
      sections: lint.sections,
      issues: lint.issues
    });
  }
  const issueSummary = summarizeSkillIssues(results);
  return {
    mode: 'lint',
    target_root: root,
    target_dir: path.join(root, TARGET_SKILLS_DIR),
    overall_status: results.every((item) => item.status === 'pass') ? 'pass' : 'fail',
    required_sections: REQUIRED_SKILL_SECTIONS,
    process_section_aliases: [...PROCESS_SECTION_ALIASES],
    skills: results,
    summary: {
      ...summarizeSkillResults(results),
      ...issueSummary
    }
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

export function renderSkillsLint(result) {
  const lines = [
    'VibePro Skills Lint',
    '',
    `Target: ${result.target_dir}`,
    '',
    ...result.skills.map((skill) => {
      const issueText = skill.issues.length > 0
        ? skill.issues.map((issue) => `${issue.id}:${issue.severity}`).join(', ')
        : 'no issues';
      return `- ${skill.name}: ${skill.status} (${issueText})`;
    }),
    '',
    `Summary: ${Object.entries(result.summary).map(([key, value]) => `${key}=${value}`).join(', ')}`
  ];
  return `${lines.join('\n')}\n`;
}

function renderSkillResult(title, result) {
  return `${title}

Target: ${result.target_dir}

${result.skills.map((skill) => `- ${skill.name}: ${skill.status} (${skill.target_path})`).join('\n')}

Summary: ${Object.entries(result.summary).map(([key, value]) => `${key}=${value}`).join(', ')}
`;
}

function lintSkillContent(content, skill) {
  const metadata = parseSkillFrontmatter(content);
  const headingSet = new Set(extractSecondLevelHeadings(content).map(normalizeSectionName));
  const sections = {
    frontmatter_name: Boolean(metadata.name),
    frontmatter_description: Boolean(metadata.description),
    process: [...headingSet].some((heading) => PROCESS_SECTION_ALIASES.has(heading)),
    required: Object.fromEntries(REQUIRED_SKILL_SECTIONS.map((section) => [
      section,
      headingSet.has(normalizeSectionName(section))
    ]))
  };
  const issues = [];
  if (!metadata.name) {
    issues.push({
      id: 'SKILL-FRONTMATTER-NAME',
      severity: 'error',
      message: 'Skill frontmatter must include name.'
    });
  } else if (metadata.name !== skill.name) {
    issues.push({
      id: 'SKILL-FRONTMATTER-NAME-MISMATCH',
      severity: 'error',
      message: `Skill frontmatter name ${metadata.name} does not match bundled skill name ${skill.name}.`
    });
  }
  if (!metadata.description) {
    issues.push({
      id: 'SKILL-FRONTMATTER-DESCRIPTION',
      severity: 'error',
      message: 'Skill frontmatter must include description.'
    });
  }
  if (!sections.process) {
    issues.push({
      id: 'SKILL-PROCESS-SECTION',
      severity: 'error',
      message: 'Skill must include a workflow/process section such as Required Workflow, Operating Order, Diagnosis Packages, or Review Order.'
    });
  }
  for (const section of REQUIRED_SKILL_SECTIONS) {
    if (!sections.required[section]) {
      issues.push({
        id: `SKILL-MISSING-${section.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
        severity: 'error',
        message: `Skill must include ## ${section}.`
      });
    }
  }
  for (const section of ['Common Rationalizations', 'Red Flags', 'Verification']) {
    const body = extractSecondLevelSection(content, section);
    if (body !== null && body.trim().length < 40) {
      issues.push({
        id: `SKILL-THIN-${section.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
        severity: 'warning',
        message: `## ${section} should contain specific guidance, not a placeholder.`
      });
    }
  }
  return { sections, issues };
}

function extractSecondLevelHeadings(content) {
  const headings = [];
  const pattern = /^##\s+(.+?)\s*$/gm;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    headings.push(match[1].trim());
  }
  return headings;
}

function extractSecondLevelSection(content, sectionName) {
  const normalizedTarget = normalizeSectionName(sectionName);
  const pattern = /^##\s+(.+?)\s*$/gm;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    if (normalizeSectionName(match[1]) !== normalizedTarget) continue;
    const start = pattern.lastIndex;
    const nextPattern = /^##\s+(.+?)\s*$/gm;
    nextPattern.lastIndex = start;
    const next = nextPattern.exec(content);
    return content.slice(start, next ? next.index : content.length);
  }
  return null;
}

function normalizeSectionName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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

function summarizeSkillIssues(results) {
  const summary = {
    issue_count: 0,
    error_count: 0,
    warning_count: 0
  };
  for (const result of results) {
    for (const issue of result.issues ?? []) {
      summary.issue_count += 1;
      if (issue.severity === 'error') summary.error_count += 1;
      else if (issue.severity === 'warning') summary.warning_count += 1;
    }
  }
  return summary;
}

function toDisplayPath(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative.startsWith('..') ? filePath : relative;
}
