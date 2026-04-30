import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { normalizeActiveStories } from './story-manager.js';
import { DEFAULT_BRAINBASE_STORIES, getWorkspaceDir, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_REVIEWABLE_FILES = 30;

export async function preparePullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const git = await collectGitState(root, options);
  const workspace = await readWorkspaceState(root);
  const story = resolveStory(workspace.config, options.storyId, {
    allowTransient: !workspace.initialized
  });
  const manifest = workspace.initialized
    ? await readManifest(root)
    : createTransientManifest();
  const fileGroups = groupChangedFiles(git.changed_files);
  const scope = assessScope({
    changedFiles: git.changed_files,
    fileGroups,
    dirtyFiles: git.dirty_files,
    commits: git.commits,
    maxReviewableFiles: options.maxReviewableFiles ?? DEFAULT_MAX_REVIEWABLE_FILES
  });
  const latestStoryRun = findLatestStoryRun(manifest, story.story_id);
  const prContext = await buildPrContext(root, {
    story,
    git,
    fileGroups,
    latestStoryRun
  });
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
    scope,
    prContext
  });
  const preparation = {
    schema_version: '0.1.0',
    story,
    created_at: new Date().toISOString(),
    workspace: {
      initialized: workspace.initialized,
      artifact_location: workspace.initialized ? 'repo' : 'temporary'
    },
    git,
    file_groups: fileGroups,
    scope,
    pr_context: prContext,
    latest_story_run: latestStoryRun,
    suggested_branch: suggestedBranch,
    next_commands: nextCommands
  };

  const prRoot = workspace.initialized
    ? getWorkspaceDir(root)
    : await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-prepare-'));
  const prDir = path.join(prRoot, 'pr', story.story_id);
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

  if (workspace.initialized) {
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
  }

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
| Workspace | ${preparation.workspace.initialized ? 'initialized' : 'temporary artifacts'} |

## Artifacts

- report: ${toDisplayPath(result.artifacts.report)}
- pr_body: ${toDisplayPath(result.artifacts.pr_body)}
- json: ${toDisplayPath(result.artifacts.json)}
`;
}

async function readWorkspaceState(repoRoot) {
  try {
    const config = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
    return {
      initialized: true,
      config
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      initialized: false,
      config: {
        brainbase: {
          stories: DEFAULT_BRAINBASE_STORIES
        }
      }
    };
  }
}

function createTransientManifest() {
  return {
    runs: [],
    latest_run_by_story: {}
  };
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
    else if (target.startsWith('test/') || target.startsWith('tests/') || target.includes('/__tests__/') || /\.(test|spec)\.[jt]sx?$/.test(target)) groups.tests.push(file);
    else if (target.startsWith('src/')) groups.source.push(file);
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
| Workspace | ${preparation.workspace.initialized ? 'initialized' : 'temporary artifacts'} |

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

function renderPrBody({ story, git, fileGroups, latestStoryRun, scope, prContext }) {
  const source = prContext.story_source;
  const changeSummary = prContext.change_summary.length === 0
    ? '- 差分なし'
    : prContext.change_summary.map((item) => `- ${item}`).join('\n');
  const acceptance = source.acceptance_criteria.length === 0
    ? '- Story文書から受け入れ基準を抽出できませんでした'
    : source.acceptance_criteria.map((item) => `- ${item}`).join('\n');
  const verification = prContext.verification_commands.length === 0
    ? '- [ ] 手動確認または対象テストを追記する'
    : prContext.verification_commands.map((item) => `- [ ] \`${item.command}\` - ${item.reason}`).join('\n');
  const reviewPoints = prContext.review_points.map((item) => `- ${item}`).join('\n');
  const risks = prContext.risks.length === 0
    ? '- 特記事項なし'
    : prContext.risks.map((item) => `- ${item}`).join('\n');

  return `## 概要
- Story: ${story.story_id} ${story.title}
- VibePro scope: ${scope.status}
- PR strategy: ${scope.recommended_strategy}
- 変更ファイル: ${git.changed_files.length} files

## 背景・要求
- 正本: ${source.path ?? 'Story未検出'}
- 要求: ${source.requirement_title ?? source.title ?? story.title}
${source.requirement_id ? `- 要求ID: ${source.requirement_id}` : ''}
${source.requirement_url ? `- 要求URL: ${source.requirement_url}` : ''}
${source.background ? `- 背景: ${source.background}` : '- 背景: Story文書から抽出できませんでした'}

## 実装判断
- ADR: ${prContext.architecture_decision}
- Scope: ${scope.status}
${scope.reasons.length === 0 ? '- Scope理由: current branchのままPR化可能' : scope.reasons.map((reason) => `- Scope理由: ${reason}`).join('\n')}

## 変更内容
${changeSummary}

## 差分分類
${Object.entries(fileGroups)
    .filter(([, value]) => value.count > 0)
    .map(([key, value]) => `- ${key}: ${value.count}`)
    .join('\n') || '- なし'}

## 受け入れ基準
${acceptance}

## 検証
${verification}

## レビュー観点
${reviewPoints || '- Story / ADR / Spec と実装差分が対応しているか'}

## リスク・確認事項
${risks}

## VibePro
- latest story run: ${latestStoryRun?.run_id ?? '-'}
- gate: ${latestStoryRun?.gate_status ?? '-'}
- PR strategy: ${scope.recommended_strategy}
`;
}

async function buildPrContext(repoRoot, { story, git, fileGroups, latestStoryRun }) {
  const storyDocs = await readStoryDocs(repoRoot, fileGroups.story_docs.files);
  const primaryStory = pickPrimaryStory(storyDocs, story);
  const architectureDecision = resolveArchitectureDecision(primaryStory, fileGroups);
  return {
    story_source: primaryStory,
    architecture_decision: architectureDecision,
    change_summary: buildChangeSummary(fileGroups),
    verification_commands: buildVerificationCommands(fileGroups),
    review_points: buildReviewPoints(fileGroups),
    risks: buildRisks({ git, fileGroups, latestStoryRun })
  };
}

async function readStoryDocs(repoRoot, files) {
  const docs = [];
  for (const file of files) {
    try {
      const content = await readFile(path.join(repoRoot, file), 'utf8');
      docs.push(parseStoryDoc(file, content));
    } catch {
      docs.push({ path: file, title: null, background: null, acceptance_criteria: [] });
    }
  }
  return docs;
}

function parseStoryDoc(file, content) {
  const frontmatter = parseFrontmatter(content);
  const title = frontmatter.title ?? findMarkdownTitle(content);
  return {
    path: file,
    title,
    requirement_id: frontmatter.id ?? frontmatter.requirement_id ?? null,
    requirement_title: frontmatter.requirement_title ?? frontmatter.title ?? title,
    requirement_url: frontmatter.url ?? null,
    background: extractSectionText(content, ['背景', '現状', '課題']),
    policy: extractSectionText(content, ['方針', '実装方針', '実装戦略']),
    acceptance_criteria: extractAcceptanceCriteria(content),
    architecture_reason: frontmatter.reason ?? extractFrontmatterBlockReason(content, 'architecture_docs')
  };
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const item = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
    if (!item) continue;
    result[item[1]] = item[2].replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function findMarkdownTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function extractSectionText(content, headings) {
  for (const heading of headings) {
    const escaped = escapeRegExp(heading);
    const match = content.match(new RegExp(`^##+\\s+.*${escaped}.*\\n([\\s\\S]*?)(?=^##+\\s+|(?![\\s\\S]))`, 'm'));
    if (!match) continue;
    const paragraph = match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('|') && !line.startsWith('---'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 320);
    if (paragraph) return paragraph;
  }
  return null;
}

function extractAcceptanceCriteria(content) {
  const section = extractRawSection(content, ['受け入れ基準', '完了定義', 'Acceptance Criteria']);
  const source = section ?? content;
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s+\[[ xX]\]\s+/.test(line))
    .map((line) => line.replace(/^-\s+\[[ xX]\]\s+/, '').trim())
    .slice(0, 8);
}

function extractRawSection(content, headings) {
  for (const heading of headings) {
    const escaped = escapeRegExp(heading);
    const match = content.match(new RegExp(`^##+\\s+.*${escaped}.*\\n([\\s\\S]*?)(?=^##+\\s+|(?![\\s\\S]))`, 'm'));
    if (match) return match[1];
  }
  return null;
}

function extractFrontmatterBlockReason(content, blockName) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${blockName}:`);
  if (start === -1) return null;
  for (let index = start + 1; index < Math.min(lines.length, start + 12); index += 1) {
    const match = lines[index].match(/^\s+reason:\s*(.+?)\s*$/);
    if (match) return match[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

function pickPrimaryStory(storyDocs, story) {
  return storyDocs.find((doc) => doc.path.includes(story.story_id))
    ?? storyDocs[0]
    ?? {
      path: null,
      title: story.title,
      requirement_id: null,
      requirement_title: story.title,
      requirement_url: null,
      background: null,
      policy: null,
      acceptance_criteria: [],
      architecture_reason: null
    };
}

function resolveArchitectureDecision(storyDoc, fileGroups) {
  if (fileGroups.architecture_docs.count > 0) {
    return `ADRあり (${fileGroups.architecture_docs.files.join(', ')})`;
  }
  if (storyDoc.architecture_reason) {
    return `ADR不要: ${storyDoc.architecture_reason}`;
  }
  return 'ADR差分なし。既存アーキテクチャ内の変更として扱う';
}

function buildChangeSummary(fileGroups) {
  const items = [];
  if (fileGroups.story_docs.count > 0) {
    items.push(`Story文書を更新: ${formatFileList(fileGroups.story_docs.files)}`);
  }
  if (fileGroups.architecture_docs.count > 0) {
    items.push(`アーキテクチャ判断を追加: ${formatFileList(fileGroups.architecture_docs.files)}`);
  }
  if (fileGroups.specifications.count > 0) {
    items.push(`仕様文書を更新: ${formatFileList(fileGroups.specifications.files)}`);
  }
  if (fileGroups.source.count > 0) {
    items.push(`実装を変更: ${formatFileList(fileGroups.source.files)}`);
  }
  if (fileGroups.tests.count > 0) {
    items.push(`テストを追加・更新: ${formatFileList(fileGroups.tests.files)}`);
  }
  if (fileGroups.repo_control.count > 0) {
    items.push(`repo制御ファイルを変更: ${formatFileList(fileGroups.repo_control.files)}`);
  }
  if (fileGroups.other.count > 0) {
    items.push(`その他の差分: ${formatFileList(fileGroups.other.files)}`);
  }
  return items;
}

function buildVerificationCommands(fileGroups) {
  const commands = [];
  if (fileGroups.tests.count > 0) {
    const testFiles = fileGroups.tests.files
      .filter((file) => /\.(test|spec)\.[jt]sx?$/.test(file))
      .slice(0, 6);
    if (testFiles.length > 0) {
      commands.push({
        command: `npm test -- --runTestsByPath ${testFiles.join(' ')} --runInBand`,
        reason: '変更に対応する対象テスト'
      });
    } else {
      commands.push({
        command: 'npm test',
        reason: 'テスト差分があるため'
      });
    }
  }
  if (fileGroups.source.count > 0) {
    commands.push({
      command: 'npm run typecheck',
      reason: 'TypeScript/型境界の確認'
    });
  }
  return commands;
}

function buildReviewPoints(fileGroups) {
  const points = [];
  if (fileGroups.story_docs.count > 0) points.push('Storyの受け入れ基準と実装差分が対応しているか');
  if (fileGroups.architecture_docs.count === 0) points.push('ADRなしで既存設計の範囲に収まっているか');
  if (fileGroups.source.count > 0) points.push(`主要ソース差分: ${formatFileList(fileGroups.source.files)}`);
  if (fileGroups.tests.count > 0) points.push(`テスト差分: ${formatFileList(fileGroups.tests.files)}`);
  return points;
}

function buildRisks({ git, fileGroups, latestStoryRun }) {
  const risks = [];
  if (fileGroups.tests.count === 0 && fileGroups.source.count > 0) {
    risks.push('ソース差分に対するテスト差分がない');
  }
  if (git.dirty_files.length > 0) {
    risks.push(`未コミット差分が ${git.dirty_files.length} files ある`);
  }
  if (fileGroups.repo_control.count > 0) {
    risks.push('repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする');
  }
  if (latestStoryRun?.gate_status && !['pass', 'ok'].includes(latestStoryRun.gate_status)) {
    risks.push(`最新診断gateが ${latestStoryRun.gate_status}`);
  }
  return risks;
}

function formatFileList(files) {
  const visible = files.slice(0, 4).join(', ');
  return files.length > 4 ? `${visible}, ...` : visible;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveStory(config, storyId, options = {}) {
  const stories = normalizeActiveStories(config.brainbase?.stories);
  const targetStoryId = storyId ?? config.brainbase?.current_story_id ?? null;
  const story = targetStoryId
    ? stories.find((item) => item.story_id === targetStoryId)
    : stories[0];
  if (!story && options.allowTransient && targetStoryId) {
    return {
      story_id: targetStoryId,
      title: targetStoryId,
      ssot: 'transient',
      status: 'active',
      horizon: null,
      view: null,
      period: null,
      started_at: null,
      due_at: null
    };
  }
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
