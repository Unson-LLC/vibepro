import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { verifyCodexInstructions } from './codex-manager.js';
import { verifyBundledSkills } from './skills-manager.js';

const GENERATED_IGNORE_PATTERNS = [
  '.vibepro/',
  'node_modules/',
  '.next/',
  'dist/',
  'build/',
  'coverage/'
];

const HOOK_SETTINGS_FILES = new Set([
  'settings.json',
  'settings.local.json'
]);

export async function scanAgentHarness(repoRoot) {
  const root = path.resolve(repoRoot);
  const codex = await verifyCodexInstructions(root);
  const skills = await verifyBundledSkills(root);
  const claude = await inspectClaudeHarness(root);
  const hooks = await inspectClaudeHooks(root);
  const ignoreNoise = await inspectIgnoreNoise(root);
  const findings = [
    ...codexFindings(codex),
    ...skillsFindings(skills),
    ...claudeFindings(claude),
    ...hooksFindings(hooks),
    ...ignoreNoiseFindings(ignoreNoise)
  ];
  const riskSummary = summarizeFindings(findings);
  return {
    schema_version: '0.1.0',
    status: riskSummary.block > 0 ? 'fail' : riskSummary.review > 0 ? 'needs_review' : 'pass',
    summary: {
      findings: findings.length,
      codex_status: codex.status,
      claude_status: claude.status,
      skills_status: skills.overall_status,
      hook_findings: hooks.findings.length,
      ignore_noise_status: ignoreNoise.status
    },
    codex,
    claude,
    skills,
    hooks,
    ignore_noise: ignoreNoise,
    findings,
    risk_summary: {
      findings: riskSummary
    },
    next_actions: buildNextActions({ codex, claude, skills, hooks, ignoreNoise })
  };
}

export function renderAgentHarnessStatus(result) {
  const lines = [
    '# VibePro Agent Harness Status',
    '',
    `Status: ${result.status}`,
    '',
    '| Area | Status | Detail |',
    '| ---- | ------ | ------ |',
    `| Codex instructions | ${normalizeHarnessStatus(result.codex?.status)} | ${result.codex?.target_path ?? 'AGENTS.md'} |`,
    `| Claude Code instructions | ${normalizeHarnessStatus(result.claude?.has_claude_file ? 'ok' : 'missing')} | ${result.claude?.target_path ?? 'CLAUDE.md'} |`,
    `| Claude Code skills dir | ${normalizeHarnessStatus(result.claude?.has_skills_dir ? 'ok' : 'missing')} | ${result.claude?.skills_dir ?? '.claude/skills'} |`,
    `| VibePro bundled skills | ${normalizeHarnessStatus(result.skills?.overall_status)} | ${formatSkillSummary(result.skills?.summary)} |`,
    `| Hooks | ${normalizeHarnessStatus(result.hooks?.status)} | ${(result.hooks?.settings_files ?? []).join(', ') || 'no hook settings'} |`,
    `| Ignore noise | ${normalizeHarnessStatus(result.ignore_noise?.status)} | missing: ${(result.ignore_noise?.missing_patterns ?? []).join(', ') || '-'} |`,
    ''
  ];
  if ((result.findings ?? []).length > 0) {
    lines.push('## Findings', '');
    for (const finding of result.findings) {
      const detail = finding.skill ?? finding.file ?? finding.target ?? finding.area ?? finding.kind;
      lines.push(`- [${finding.gate_effect ?? 'info'}] ${finding.kind}: ${detail}`);
    }
    lines.push('');
  }
  lines.push('## Next Actions', '');
  if ((result.next_actions ?? []).length === 0) {
    lines.push('- none');
  } else {
    for (const action of result.next_actions) lines.push(`- ${action}`);
  }
  return `${lines.join('\n')}\n`;
}

function normalizeHarnessStatus(status) {
  if (['ok', 'pass'].includes(status)) return 'installed';
  if (status === 'needs_install') return 'missing_or_outdated';
  return status ?? 'unknown';
}

function formatSkillSummary(summary = {}) {
  const entries = Object.entries(summary);
  if (entries.length === 0) return '-';
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
}

async function inspectClaudeHarness(root) {
  const claudePath = path.join(root, 'CLAUDE.md');
  const skillsDir = path.join(root, '.claude', 'skills');
  const hasClaudeFile = await pathExists(claudePath);
  const hasSkillsDir = await pathExists(skillsDir);
  const installedSkillCount = hasSkillsDir ? (await listDirectories(skillsDir)).length : 0;
  return {
    status: hasClaudeFile && hasSkillsDir ? 'ok' : 'needs_install',
    target_path: 'CLAUDE.md',
    skills_dir: '.claude/skills',
    has_claude_file: hasClaudeFile,
    has_skills_dir: hasSkillsDir,
    installed_skill_count: installedSkillCount
  };
}

async function inspectClaudeHooks(root) {
  const claudeDir = path.join(root, '.claude');
  const files = await listHookSettingsFiles(claudeDir);
  const findings = [];
  for (const file of files) {
    const relativeFile = path.relative(root, file);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      findings.push({
        kind: 'invalid_hook_settings_json',
        file: relativeFile,
        message: error.message,
        gate_effect: 'review'
      });
      continue;
    }
    for (const command of collectCommandStrings(parsed)) {
      const target = extractLocalCommandTarget(command);
      if (!target) continue;
      const targetPath = path.resolve(root, target);
      if (!(await pathExists(targetPath))) {
        findings.push({
          kind: 'hook_command_target_missing',
          file: relativeFile,
          command,
          target,
          gate_effect: 'review'
        });
      }
    }
  }
  return {
    status: findings.some((finding) => finding.gate_effect === 'review') ? 'needs_review' : 'pass',
    settings_files: files.map((file) => path.relative(root, file)),
    findings
  };
}

async function inspectIgnoreNoise(root) {
  const gitignore = await readOptional(path.join(root, '.gitignore'));
  const configured_patterns = gitignore === null
    ? []
    : GENERATED_IGNORE_PATTERNS.filter((pattern) => gitignore.includes(pattern));
  const missing_patterns = GENERATED_IGNORE_PATTERNS.filter((pattern) => !configured_patterns.includes(pattern));
  return {
    status: missing_patterns.includes('.vibepro/') ? 'needs_review' : 'pass',
    target_path: '.gitignore',
    configured_patterns,
    missing_patterns
  };
}

function codexFindings(codex) {
  if (codex.overall_status === 'ok') return [];
  return [{
    kind: codex.status === 'outdated' ? 'codex_instructions_outdated' : 'codex_instructions_missing',
    area: 'codex',
    file: codex.target_path,
    status: codex.status,
    gate_effect: 'review'
  }];
}

function skillsFindings(skills) {
  return (skills.skills ?? [])
    .filter((skill) => skill.status !== 'ok')
    .map((skill) => ({
      kind: skill.status === 'outdated' ? 'vibepro_skill_outdated' : 'vibepro_skill_missing',
      area: 'skills',
      skill: skill.name,
      file: skill.target_path,
      status: skill.status,
      gate_effect: 'review'
    }));
}

function claudeFindings(claude) {
  const findings = [];
  if (!claude.has_claude_file) {
    findings.push({
      kind: 'claude_instructions_missing',
      area: 'claude_code',
      file: claude.target_path,
      gate_effect: 'review'
    });
  }
  if (!claude.has_skills_dir) {
    findings.push({
      kind: 'claude_skills_dir_missing',
      area: 'claude_code',
      file: claude.skills_dir,
      gate_effect: 'review'
    });
  }
  return findings;
}

function hooksFindings(hooks) {
  return hooks.findings.map((finding) => ({
    ...finding,
    area: 'hooks'
  }));
}

function ignoreNoiseFindings(ignoreNoise) {
  if (ignoreNoise.missing_patterns.length === 0) return [];
  return [{
    kind: 'ai_exploration_noise_ignores_incomplete',
    area: 'ignore_noise',
    file: ignoreNoise.target_path,
    missing_patterns: ignoreNoise.missing_patterns,
    gate_effect: ignoreNoise.missing_patterns.includes('.vibepro/') ? 'review' : 'info'
  }];
}

function buildNextActions({ codex, claude, skills, hooks, ignoreNoise }) {
  const actions = [];
  if (codex.overall_status !== 'ok') actions.push('vibepro codex install <repo>');
  if (skills.overall_status !== 'ok') actions.push('vibepro skills install <repo>');
  if (claude.status !== 'ok') actions.push('Add or refresh CLAUDE.md and .claude/skills for Claude Code users.');
  if (hooks.status !== 'pass') actions.push('Fix missing hook script targets before relying on automated hooks.');
  if (ignoreNoise.status !== 'pass') actions.push('Add .vibepro/ to .gitignore so VibePro evidence stays out of product diffs.');
  return actions;
}

async function listHookSettingsFiles(dir) {
  const files = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (HOOK_SETTINGS_FILES.has(entry.name) || /^settings\..+\.json$/.test(entry.name)) {
        files.push(path.join(dir, entry.name));
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return files;
}

function collectCommandStrings(value) {
  const commands = [];
  const visit = (item, key = '') => {
    if (typeof item === 'string') {
      if (key === 'command' || looksLikeCommand(item)) commands.push(item);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child, key);
      return;
    }
    if (item && typeof item === 'object') {
      for (const [childKey, child] of Object.entries(item)) visit(child, childKey);
    }
  };
  visit(value);
  return [...new Set(commands)];
}

function looksLikeCommand(value) {
  return /(?:^|\s)(?:node|npx|pnpm|npm|yarn|bash|sh|tsx)\s+/.test(value)
    || /(?:^|\s)\.\/[^\s]+/.test(value);
}

function extractLocalCommandTarget(command) {
  const patterns = [
    /(?:^|\s)(?:node|bash|sh|tsx)\s+((?:\.\/)?(?:scripts|bin|tools)\/[^\s'"]+)/,
    /(?:^|\s)npx\s+tsx\s+((?:\.\/)?(?:scripts|bin|tools)\/[^\s'"]+)/,
    /(?:^|\s)(?:pnpm|npm|yarn)\s+(?:exec\s+)?tsx\s+((?:\.\/)?(?:scripts|bin|tools)\/[^\s'"]+)/,
    /(?:^|\s)(\.\/(?:scripts|bin|tools)\/[^\s'"]+)/
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) return match[1].replace(/^\.\//, '');
  }
  return null;
}

async function listDirectories(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function summarizeFindings(findings) {
  return findings.reduce((summary, finding) => {
    const effect = ['block', 'review', 'info'].includes(finding.gate_effect) ? finding.gate_effect : 'info';
    summary[effect] += 1;
    return summary;
  }, { block: 0, review: 0, info: 0 });
}
