import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace } from './workspace.js';

const DEFAULT_BASE_ID = 'pfgza5aei6wboaq';
const DEFAULT_TABLE_ID = 'mjpg80jobkjo8lz';
const STORY_FIELD_TITLES = [
  'Story ID',
  '名前',
  'ステータス',
  'Horizon',
  'View',
  'Period',
  '開始日',
  '期限日'
];

export async function syncStoriesFromNocoDB(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const configPath = path.join(getWorkspaceDir(root), 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const source = resolveNocoDBSource(config, options.env ?? process.env);
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (!fetchFn) throw new Error('fetch is not available in this Node.js runtime');

  const schema = await fetchTableSchema(source, fetchFn);
  validateStorySchema(schema);
  const records = await fetchStoryRecords(source, fetchFn);
  const stories = records
    .filter((record) => !isArchived(record))
    .map(normalizeStoryRecord)
    .filter((story) => story.story_id);

  config.brainbase = {
    ...(config.brainbase ?? {}),
    story_source: {
      type: 'nocodb',
      base_id: source.baseId,
      table_id: source.tableId,
      synced_at: new Date().toISOString()
    },
    stories
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return { stories, storySource: config.brainbase.story_source };
}

function resolveNocoDBSource(config, env) {
  const storySource = config.brainbase?.story_source ?? {};
  const url = env.NOCODB_URL ?? storySource.url;
  const token = env.NOCODB_TOKEN ?? storySource.token;
  if (!url) throw new Error('NOCODB_URL is required to sync Brainbase stories');
  if (!token) throw new Error('NOCODB_TOKEN is required to sync Brainbase stories');
  return {
    url: url.replace(/\/$/, ''),
    token,
    baseId: env.NOCODB_STORY_BASE_ID ?? storySource.base_id ?? DEFAULT_BASE_ID,
    tableId: env.NOCODB_STORY_TABLE_ID ?? storySource.table_id ?? DEFAULT_TABLE_ID
  };
}

async function fetchTableSchema(source, fetchFn) {
  const response = await fetchFn(`${source.url}/api/v1/db/meta/tables/${source.tableId}`, {
    headers: { 'xc-token': source.token }
  });
  return readResponseJson(response, 'NocoDB Story table schema fetch failed');
}

async function fetchStoryRecords(source, fetchFn) {
  const records = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const response = await fetchFn(`${source.url}/api/v1/db/data/noco/${source.baseId}/${source.tableId}?${query}`, {
      headers: { 'xc-token': source.token }
    });
    const body = await readResponseJson(response, 'NocoDB Story record fetch failed');
    records.push(...(Array.isArray(body.list) ? body.list : []));
    if (body.pageInfo?.isLastPage !== false && records.length >= (body.pageInfo?.totalRows ?? records.length)) break;
    if (!Array.isArray(body.list) || body.list.length === 0) break;
    offset += body.list.length;
  }

  return records;
}

async function readResponseJson(response, message) {
  if (!response.ok) {
    throw new Error(`${message}: HTTP ${response.status}`);
  }
  return response.json();
}

function validateStorySchema(schema) {
  const titles = new Set((schema.columns ?? []).map((column) => column.title));
  const missing = STORY_FIELD_TITLES.filter((title) => !titles.has(title));
  if (missing.length > 0) {
    throw new Error(`NocoDB Story table schema is missing columns: ${missing.join(', ')}`);
  }
}

function normalizeStoryRecord(record) {
  return {
    story_id: pick(record, 'Story ID', 'story_id'),
    title: pick(record, '名前', 'name'),
    ssot: 'NocoDB',
    horizon: pick(record, 'Horizon', 'horizon'),
    view: pick(record, 'View', 'view'),
    period: pick(record, 'Period', 'period'),
    started_at: pick(record, '開始日', 'started_at'),
    due_at: pick(record, '期限日', 'due_at')
  };
}

function isArchived(record) {
  const status = pick(record, 'ステータス', 'status');
  return status === 'archived' || status === 'アーカイブ';
}

function pick(record, titleKey, columnKey) {
  const value = record[titleKey] ?? record[columnKey] ?? null;
  return value === '' ? null : value;
}
