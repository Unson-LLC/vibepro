import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { normalizeActiveStories } from './story-manager.js';
import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_REVIEWABLE_FILES = 30;

export async function preparePullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  await initWorkspace(root);

  const config = JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'config.json'), 'utf8'));
  const manifest = await readManifest(root);
  const story = resolveStory(config, options.storyId);
  const git = await collectGitState(root, options);
  const fileGroups = groupChangedFiles(git.changed_files);
  const scope = assessScope({
    changedFiles: git.changed_files,
    fileGroups,
    dirtyFiles: git.dirty_files,
    commits: git.commits,
    maxReviewableFiles: options.maxReviewableFiles ?? DEFAULT_MAX_REVIEWABLE_FILES
  });
  const latestStoryRun = findLatestStoryRun(manifest, story.story_id);
  const suggestedBranch = options.branchName ?? buildBranchName(story);
  const nextCommands = buildNextCommands({
    baseRef: git.base_ref,
    currentBranch: git.current_branch,
    suggestedBranch,
    commits: git.commits,
    scope
  });
  const prBody = renderPrBody({
    story,
    git,
    fileGroups,
    latestStoryRun,
    scope
  });
  const preparation = {
    schema_version: '0.1.0',
    story,
    created_at: new Date().toISOString(),
    git,
    file_groups: fileGroups,
    scope,
    latest_story_run: latestStoryRun,
    suggested_branch: suggestedBranch,
    next_commands: nextCommands
  };

  const prDir = path.join(getWorkspaceDir(root), 'pr', story.story_id);
  await mkdir(prDir, { recursive: true });
  const jsonPath = path.join(prDir, 'pr-prepare.json');
  const reportPath = path.join(prDir, 'pr-prepare.md');
  const bodyPath = path.join(prDir, 'pr-body.md');
  await writeFile(jsonPath, `${JSON.stringify(preparation, null, 2)}\n`);
  await writeFile(bodyPath, prBody);
  await writeFile(reportPath, renderPrepareReport({
    preparation,
    bodyPath: toWorkspaceRelative(root, bodyPath)
  }));

  manifest.pr_preparations = {
    ...(manifest.pr_preparations ?? {}),
    [story.story_id]: {
      latest_prepare: toWorkspaceRelative(root, jsonPath),
      latest_report: toWorkspaceRelative(root, reportPath),
      latest_pr_body: toWorkspaceRelative(root, bodyPath),
      latest_prepare_generated_at: preparation.created_at
    }
  };
  await writeManifest(root, manifest);

  return {
    story,
    preparation,
    artifacts: {
      json: jsonPath,
      report: reportPath,
      pr_body: bodyPath
    }
  };
}

export function renderPrPrepareSummary(result) {
  const { preparation } = result;
  return `# PR Prepare

| 項目 | 内容 |
|------|------|
| Story | ${preparation.story.story_id} |
| Base | ${preparation.git.base_ref} |
| Head | ${preparation.git.head_ref} |
| Current branch | ${preparation.git.current_branch ?? '-'} |
| Changed files | ${preparation.git.changed_files.length} |
| Commits | ${preparation.git.commits.length} |
| Scope | ${preparation.scope.status} |
| Recommended strategy | ${preparation.scope.recommended_strategy} |

## Artifacts

- report: ${toDisplayPath(result.artifacts.report)}
- pr_body: ${toDisplayPath(result.artifacts.pr_body)}
- json: ${toDisplayPath(result.artifacts.json)}
`;
}

async function collectGitState(repoRoot, options) {
  const currentBranch = await gitOptional(repoRoot, ['branch', '--show-current']);
  const baseRef = options.baseRef ?? await resolveBaseRef(repoRoot);
  const headRef = options.headRef ?? 'HEAD';
  const changedFiles = await getChangedFiles(repoRoot, baseRef, headRef);
  const commits = await getCommits(repoRoot, baseRef, headRef);
  const dirtyFiles = parseStatus(await gitOptional(repoRoot, ['status', '--porcelain']));
  return {
    current_branch: currentBranch || null,
    base_ref: baseRef,
    head_ref: headRef,
    changed_files: changedFiles,
    dirty_files: dirtyFiles,
    commits
  };
}

async function resolveBaseRef(repoRoot) {
  const originHead = await gitOptional(repoRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead) return originHead.replace(/^origin\//, 'origin/');
  for (const ref of ['origin/develop', 'origin/main', 'develop', 'main', 'master']) {
    if (await gitRefExists(repoRoot, ref)) return ref;
  }
  return 'HEAD~1';
}

async function getChangedFiles(repoRoot, baseRef, headRef) {
  const output = await gitOptional(repoRoot, ['diff', '--name-status', `${baseRef}...${headRef}`])
    || await git(repoRoot, ['diff', '--name-status', baseRef, headRef]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseNameStatus);
}

async function getCommits(repoRoot, baseRef, headRef) {
  const output = await gitOptional(repoRoot, ['log', '--oneline', `${baseRef}..${headRef}`]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ...messageParts] = line.split(' ');
      return { sha, message: messageParts.join(' ') };
    });
}

function parseNameStatus(line) {
  const parts = line.split('\t');
  const status = parts[0];
  return {
    status,
    path: parts[parts.length - 1]
  };
}

function parseStatus(output) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3)
    }));
}

function groupChangedFiles(files) {
  const groups = {
    story_docs: [],
    architecture_docs: [],
    specifications: [],
    source: [],
    tests: [],
    repo_control: [],
    vibepro_artifacts: [],
    other: []
  };

  for (const file of files) {
    const target = file.path;
    if (target.startsWith('docs/management/stories/')) groups.story_docs.push(file);
    else if (target.startsWith('docs/management/architecture/')) groups.architecture_docs.push(file);
    else if (target.startsWith('docs/features/specifications/')) groups.specifications.push(file);
    else if (target.startsWith('src/') && !target.includes('/__tests__/')) groups.source.push(file);
    else if (target.startsWith('test/') || target.startsWith('tests/') || target.includes('/__tests__/') || /\.(test|spec)\.[jt]sx?$/.test(target)) groups.tests.push(file);
    else if (target.startsWith('.vibepro/')) groups.vibepro_artifacts.push(file);
    else if (target.startsWith('.claude/') || ['AGENTS.md', 'CLAUDE.md', '.github/', 'package.json', 'package-lock.json'].some((prefix) => target === prefix || target.startsWith(prefix))) groups.repo_control.push(file);
    else groups.other.push(file);
  }

  return Object.fromEntries(
    Object.entries(groups).map(([key, value]) => [key, {
      count: value.length,
      files: value.map((file) => file.path)
    }])
  );
}

function assessScope({ changedFiles, fileGroups, dirtyFiles, commits, maxReviewableFiles }) {
  const reasons = [];
  if (changedFiles.length > maxReviewableFiles) {
    reasons.push(`差分が ${changedFiles.length} files あり、レビュー可能な目安 ${maxReviewableFiles} files を超えている`);
  }
  if (fileGroups.repo_control.count > 0) {
    reasons.push('repo制御ファイルやagent設定が差分に含まれている');
  }
  const nonWorkspaceDirty = dirtyFiles.filter((file) => !file.path.startsWith('.vibepro/'));
  if (nonWorkspaceDirty.length > 0) {
    reasons.push(`未コミット差分が ${nonWorkspaceDirty.length} files 残っている`);
  }
  if (commits.length > 1) {
    reasons.push(`baseからのcommitが ${commits.length} 件あり、Story外の変更混入を確認する必要がある`);
  }

  const needsCleanBranch = reasons.length > 0;
  return {
    status: needsCleanBranch ? 'needs_clean_branch' : 'reviewable',
    recommended_strategy: needsCleanBranch ? 'clean_branch_or_split_pr' : 'current_branch_pr',
    reasons,
    reviewable_file_limit: maxReviewableFiles,
    changed_file_count: changedFiles.length
  };
}

function buildNextCommands({ baseRef, currentBranch, suggestedBranch, commits, scope }) {
  if (scope.recommended_strategy === 'current_branch_pr') {
    return [
      `gh pr create --base ${stripRemote(baseRef)} --head ${currentBranch ?? '<current-branch>'} --fill`
    ];
  }

  const firstCommit = commits[0]?.sha ?? '<commit-sha>';
  return [
    `git switch -c ${suggestedBranch} ${baseRef}`,
    commits.length === 1
      ? `git cherry-pick ${firstCommit}`
      : `git cherry-pick <story-related-commit-sha>`,
    `gh pr create --base ${stripRemote(baseRef)} --head ${suggestedBranch} --body-file .vibepro/pr/<story-id>/pr-body.md`
  ];
}

function renderPrepareReport({ preparation, bodyPath }) {
  const groups = Object.entries(preparation.file_groups)
    .filter(([, value]) => value.count > 0)
    .map(([key, value]) => `| ${key} | ${value.count} | ${value.files.slice(0, 8).join('<br>')}${value.files.length > 8 ? '<br>...' : ''} |`)
    .join('\n');
  const reasons = preparation.scope.reasons.length === 0
    ? '- なし'
    : preparation.scope.reasons.map((reason) => `- ${reason}`).join('\n');
  return `# VibePro PR Prepare

## Story

| 項目 | 内容 |
|------|------|
| Story ID | ${preparation.story.story_id} |
| Story | ${preparation.story.title} |
| View | ${preparation.story.view ?? '-'} |
| Period | ${preparation.story.period ?? '-'} |

## Git

| 項目 | 内容 |
|------|------|
| Base | ${preparation.git.base_ref} |
| Head | ${preparation.git.head_ref} |
| Current branch | ${preparation.git.current_branch ?? '-'} |
| Changed files | ${preparation.git.changed_files.length} |
| Commits | ${preparation.git.commits.length} |
| Dirty files | ${preparation.git.dirty_files.length} |

## Scope判定

| 項目 | 内容 |
|------|------|
| Status | ${preparation.scope.status} |
| Recommended strategy | ${preparation.scope.recommended_strategy} |

### 理由

${reasons}

## 差分グループ

| Group | Count | Files |
|-------|-------|-------|
${groups || '| - | 0 | - |'}

## Commit

${preparation.git.commits.length === 0 ? '- なし' : preparation.git.commits.map((commit) => `- ${commit.sha} ${commit.message}`).join('\n')}

## PR本文ドラフト

- ${bodyPath}

## 次コマンド

${preparation.next_commands.map((command) => `- \`${command}\``).join('\n')}
`;
}

function renderPrBody({ story, git, fileGroups, latestStoryRun, scope }) {
  return `## 概要
- Story: ${story.story_id} ${story.title}
- VibePro scope: ${scope.status}
- 変更ファイル: ${git.changed_files.length} files

## 変更範囲
${Object.entries(fileGroups)
    .filter(([, value]) => value.count > 0)
    .map(([key, value]) => `- ${key}: ${value.count}`)
    .join('\n') || '- なし'}

## VibePro
- latest story run: ${latestStoryRun?.run_id ?? '-'}
- gate: ${latestStoryRun?.gate_status ?? '-'}
- PR strategy: ${scope.recommended_strategy}

## 検証
- [ ] Story / ADR / Spec と実装差分が対応している
- [ ] 対象テストが成功している
- [ ] 型検査またはbuildが成功している
`;
}

function resolveStory(config, storyId) {
  const stories = normalizeActiveStories(config.brainbase?.stories);
  const targetStoryId = storyId ?? config.brainbase?.current_story_id ?? null;
  const story = targetStoryId
    ? stories.find((item) => item.story_id === targetStoryId)
    : stories[0];
  if (!story) throw new Error(`Story not found: ${targetStoryId}`);
  return story;
}

function findLatestStoryRun(manifest, storyId) {
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  const latestRunId = manifest.latest_run_by_story?.[storyId] ?? null;
  return runs.find((run) => run.run_id === latestRunId)
    ?? runs.find((run) => run.story_id === storyId)
    ?? null;
}

function buildBranchName(story) {
  const slug = story.story_id
    .replace(/^story-/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `feat/${slug || 'vibepro-story'}`;
}

function stripRemote(ref) {
  return ref.replace(/^origin\//, '');
}

function toDisplayPath(filePath) {
  return filePath.split(path.sep).join('/');
}

async function gitRefExists(repoRoot, ref) {
  try {
    await git(repoRoot, ['rev-parse', '--verify', ref]);
    return true;
  } catch {
    return false;
  }
}

async function gitOptional(repoRoot, args) {
  try {
    return await git(repoRoot, args);
  } catch {
    return '';
  }
}

async function git(repoRoot, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return stdout.trim();
}
