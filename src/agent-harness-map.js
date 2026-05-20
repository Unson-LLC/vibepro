import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace, toWorkspaceRelative } from './workspace.js';

const ENTRY_FILES = [
  'README.md',
  'README.ja.md',
  'AGENTS.md',
  'CLAUDE.md',
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'next.config.js',
  'next.config.mjs',
  'vite.config.ts',
  'tsconfig.json'
];

const SOURCE_DIRS = [
  'src',
  'app',
  'pages',
  'components',
  'lib',
  'server',
  'api',
  'tests',
  'test',
  'e2e',
  'docs',
  'scripts'
];

export async function generateAgentHarnessMap(repoRoot) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const harnessDir = path.join(getWorkspaceDir(root), 'harness');
  await mkdir(harnessDir, { recursive: true });

  const packageInfo = await readPackageInfo(root);
  const entryFiles = await existingPaths(root, ENTRY_FILES);
  const sourceDirs = await existingPaths(root, SOURCE_DIRS);
  const testCommandMap = buildTestCommandMap(packageInfo);
  const codebaseMap = renderCodebaseMap({ entryFiles, sourceDirs, packageInfo, testCommandMap });
  const agentEntrypoints = renderAgentEntrypoints({ entryFiles, sourceDirs, testCommandMap });

  const codebaseMapPath = path.join(harnessDir, 'codebase-map.md');
  const agentEntrypointsPath = path.join(harnessDir, 'agent-entrypoints.md');
  const testCommandMapPath = path.join(harnessDir, 'test-command-map.json');
  await writeFile(codebaseMapPath, codebaseMap);
  await writeFile(agentEntrypointsPath, agentEntrypoints);
  await writeFile(testCommandMapPath, `${JSON.stringify(testCommandMap, null, 2)}\n`);

  return {
    schema_version: '0.1.0',
    status: 'created',
    repo: { root: '.' },
    summary: {
      entry_file_count: entryFiles.length,
      source_dir_count: sourceDirs.length,
      command_count: testCommandMap.commands.length
    },
    artifacts: {
      codebase_map: toWorkspaceRelative(root, codebaseMapPath),
      agent_entrypoints: toWorkspaceRelative(root, agentEntrypointsPath),
      test_command_map: toWorkspaceRelative(root, testCommandMapPath)
    },
    entry_files: entryFiles,
    source_dirs: sourceDirs,
    test_command_map: testCommandMap
  };
}

export function renderAgentHarnessMapSummary(result) {
  return [
    '# VibePro Agent Harness Map',
    '',
    `Status: ${result.status}`,
    `Codebase map: ${result.artifacts.codebase_map}`,
    `Agent entrypoints: ${result.artifacts.agent_entrypoints}`,
    `Test command map: ${result.artifacts.test_command_map}`,
    '',
    `Entry files: ${result.summary.entry_file_count}`,
    `Source dirs: ${result.summary.source_dir_count}`,
    `Commands: ${result.summary.command_count}`
  ].join('\n') + '\n';
}

async function readPackageInfo(root) {
  const packagePath = path.join(root, 'package.json');
  const content = await readOptional(packagePath);
  if (content === null) return { exists: false, scripts: {}, workspaces: [] };
  try {
    const parsed = JSON.parse(content);
    return {
      exists: true,
      name: parsed.name ?? null,
      scripts: parsed.scripts ?? {},
      workspaces: parsed.workspaces ?? []
    };
  } catch (error) {
    return {
      exists: true,
      invalid: true,
      error: error.message,
      scripts: {},
      workspaces: []
    };
  }
}

function buildTestCommandMap(packageInfo) {
  const commands = Object.entries(packageInfo.scripts ?? {}).map(([name, command]) => ({
    id: name,
    command: `npm run ${name}`,
    raw_script: command,
    category: classifyScript(name, command)
  }));
  return {
    schema_version: '0.1.0',
    package_manager_hint: 'npm',
    commands,
    by_category: commands.reduce((groups, command) => {
      const items = groups[command.category] ?? [];
      items.push(command.id);
      groups[command.category] = items;
      return groups;
    }, {})
  };
}

function classifyScript(name, command) {
  const text = `${name} ${command}`.toLowerCase();
  if (/type(check)?|tsc/.test(text)) return 'typecheck';
  if (/e2e|playwright|cypress/.test(text)) return 'e2e';
  if (/test|vitest|jest|node --test/.test(text)) return 'unit';
  if (/lint|eslint/.test(text)) return 'lint';
  if (/build|next build|vite build/.test(text)) return 'build';
  if (/dev|start/.test(text)) return 'runtime';
  return 'other';
}

function renderCodebaseMap({ entryFiles, sourceDirs, packageInfo, testCommandMap }) {
  const lines = [
    '# Codebase Map',
    '',
    '## Entry Files',
    '',
    ...formatList(entryFiles),
    '',
    '## Source Directories',
    '',
    ...formatList(sourceDirs),
    '',
    '## Package Scripts',
    '',
    ...formatScripts(packageInfo.scripts ?? {}),
    '',
    '## Verification Commands',
    '',
    ...testCommandMap.commands.map((command) => `- ${command.category}: \`${command.command}\` (${command.raw_script})`)
  ];
  return `${lines.join('\n')}\n`;
}

function renderAgentEntrypoints({ entryFiles, sourceDirs, testCommandMap }) {
  const lines = [
    '# Agent Entrypoints',
    '',
    '## Read First',
    '',
    ...formatList(entryFiles.filter((file) => /README|AGENTS|CLAUDE|package\.json/.test(file))),
    '',
    '## Explore Next',
    '',
    ...formatList(sourceDirs),
    '',
    '## Avoid By Default',
    '',
    '- `.vibepro/` generated evidence',
    '- `node_modules/` dependencies',
    '- build outputs such as `.next/`, `dist/`, `build/`, and `coverage/`',
    '',
    '## Before Changing Code',
    '',
    ...testCommandMap.commands
      .filter((command) => ['typecheck', 'unit', 'e2e', 'lint'].includes(command.category))
      .map((command) => `- ${command.category}: \`${command.command}\``)
  ];
  return `${lines.join('\n')}\n`;
}

function formatList(items) {
  return items.length === 0 ? ['- none detected'] : items.map((item) => `- ${item}`);
}

function formatScripts(scripts) {
  const entries = Object.entries(scripts);
  return entries.length === 0
    ? ['- none detected']
    : entries.map(([name, command]) => `- \`${name}\`: ${command}`);
}

async function existingPaths(root, candidates) {
  const existing = [];
  for (const candidate of candidates) {
    if (await pathExists(path.join(root, candidate))) existing.push(candidate);
  }
  return existing;
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
