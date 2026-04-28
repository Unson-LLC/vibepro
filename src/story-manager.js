import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace } from './workspace.js';

const STORY_FIELDS = [
  ['--id', 'story_id'],
  ['--title', 'title'],
  ['--horizon', 'horizon'],
  ['--view', 'view'],
  ['--period', 'period'],
  ['--started-at', 'started_at'],
  ['--due-at', 'due_at']
];

export async function addStory(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const story = buildStory(options);
  const stories = getStories(config);
  if (stories.some((item) => item.story_id === story.story_id)) {
    throw new Error(`Story already exists: ${story.story_id}`);
  }
  config.brainbase = {
    ...(config.brainbase ?? {}),
    stories: [...stories, story]
  };
  await writeConfig(root, config);
  return story;
}

export async function listStories(repoRoot, options = {}) {
  const config = await readConfig(path.resolve(repoRoot));
  const stories = getStories(config);
  const visibleStories = options.includeArchived ? stories : stories.filter((story) => !isArchived(story));
  return {
    current_story_id: config.brainbase?.current_story_id ?? null,
    stories: visibleStories
  };
}

export async function selectStory(repoRoot, storyId) {
  if (!storyId) throw new Error('--id is required');
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const story = getStories(config).find((item) => item.story_id === storyId);
  if (!story) throw new Error(`Story not found: ${storyId}`);
  if (isArchived(story)) throw new Error(`Archived story cannot be selected: ${storyId}`);
  config.brainbase = {
    ...(config.brainbase ?? {}),
    current_story_id: storyId
  };
  await writeConfig(root, config);
  return story;
}

export async function archiveStory(repoRoot, storyId) {
  if (!storyId) throw new Error('--id is required');
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const stories = getStories(config);
  const story = stories.find((item) => item.story_id === storyId);
  if (!story) throw new Error(`Story not found: ${storyId}`);
  story.status = 'archived';
  if (config.brainbase?.current_story_id === storyId) {
    config.brainbase.current_story_id = null;
  }
  await writeConfig(root, config);
  return story;
}

export function parseStoryOptions(args) {
  const options = {};
  for (const [flag, key] of STORY_FIELDS) {
    const value = getOption(args, flag);
    if (value !== null) options[key] = value;
  }
  return options;
}

export function renderStoryList(result) {
  if (result.stories.length === 0) return 'No active stories.\n';
  return `${result.stories.map((story) => {
    const marker = story.story_id === result.current_story_id ? '*' : '-';
    const status = story.status ?? 'active';
    const view = story.view ?? '-';
    const period = story.period ?? '-';
    return `${marker} ${story.story_id} | ${story.title} | ${status} | view:${view} | period:${period}`;
  }).join('\n')}\n`;
}

async function readConfig(repoRoot) {
  await initWorkspace(repoRoot);
  return JSON.parse(await readFile(getConfigPath(repoRoot), 'utf8'));
}

async function writeConfig(repoRoot, config) {
  await writeFile(getConfigPath(repoRoot), `${JSON.stringify(config, null, 2)}\n`);
}

function getConfigPath(repoRoot) {
  return path.join(getWorkspaceDir(repoRoot), 'config.json');
}

function getStories(config) {
  return Array.isArray(config.brainbase?.stories) ? config.brainbase.stories : [];
}

function buildStory(options) {
  if (!options.story_id) throw new Error('--id is required');
  if (!options.title) throw new Error('--title is required');
  return {
    story_id: options.story_id,
    title: options.title,
    ssot: 'local',
    status: 'active',
    horizon: options.horizon ?? null,
    view: options.view ?? null,
    period: options.period ?? null,
    started_at: options.started_at ?? null,
    due_at: options.due_at ?? null
  };
}

function getOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function isArchived(story) {
  return story.status === 'archived' || story.status === 'アーカイブ';
}
