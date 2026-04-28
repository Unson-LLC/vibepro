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
const PUBLISH_FIELD_TITLES = ['Story ID', '説明'];
const DIAGNOSIS_START = '<!-- vibepro:diagnosis-sync:start -->';
const DIAGNOSIS_END = '<!-- vibepro:diagnosis-sync:end -->';

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

export async function publishStatusToNocoDB(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const configPath = path.join(getWorkspaceDir(root), 'config.json');
  const importStatePath = path.join(getWorkspaceDir(root), 'brainbase', 'import-state.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const importState = JSON.parse(await readFile(importStatePath, 'utf8'));
  const source = resolveNocoDBSource(config, options.env ?? process.env);
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (!fetchFn) throw new Error('fetch is not available in this Node.js runtime');

  const schema = await fetchTableSchema(source, fetchFn);
  validatePublishSchema(schema);
  const story = importState.story ?? importState.stories?.[0];
  if (!story?.story_id) throw new Error('Brainbase import state does not contain a publishable story');
  const record = await findStoryRecord(source, fetchFn, story.story_id);
  const existingDescription = pick(record, '説明', 'description') ?? '';
  const nextDescription = replaceDiagnosisSection(existingDescription, renderDiagnosisSection(importState));

  await patchStoryDescription(source, fetchFn, record, nextDescription);
  return { storyId: story.story_id, recordId: getRecordId(record) };
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

function validatePublishSchema(schema) {
  const titles = new Set((schema.columns ?? []).map((column) => column.title));
  const missing = PUBLISH_FIELD_TITLES.filter((title) => !titles.has(title));
  if (missing.length > 0) {
    throw new Error(`NocoDB Story table schema is missing columns: ${missing.join(', ')}`);
  }
}

async function findStoryRecord(source, fetchFn, storyId) {
  const query = new URLSearchParams({ where: `(Story ID,eq,${storyId})`, limit: '1' });
  const response = await fetchFn(`${source.url}/api/v1/db/data/noco/${source.baseId}/${source.tableId}?${query}`, {
    headers: { 'xc-token': source.token }
  });
  const body = await readResponseJson(response, 'NocoDB Story record lookup failed');
  const record = Array.isArray(body.list) ? body.list[0] : null;
  if (!record) throw new Error(`NocoDB Story record not found: ${storyId}`);
  return record;
}

async function patchStoryDescription(source, fetchFn, record, description) {
  const recordId = getRecordId(record);
  if (!recordId) throw new Error('NocoDB Story record does not contain an Id');
  const response = await fetchFn(`${source.url}/api/v1/db/data/noco/${source.baseId}/${source.tableId}/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'xc-token': source.token
    },
    body: JSON.stringify({ 説明: description })
  });
  await readResponseJson(response, 'NocoDB Story description update failed');
}

function getRecordId(record) {
  return record.Id ?? record.id ?? record.ID ?? null;
}

function replaceDiagnosisSection(description, section) {
  const blockPattern = new RegExp(`${escapeRegExp(DIAGNOSIS_START)}[\\s\\S]*?${escapeRegExp(DIAGNOSIS_END)}`);
  const nextBlock = `${DIAGNOSIS_START}\n${section}\n${DIAGNOSIS_END}`;
  if (blockPattern.test(description)) {
    return description.replace(blockPattern, nextBlock);
  }
  const prefix = description.trimEnd();
  return `${prefix}${prefix ? '\n\n' : ''}${nextBlock}\n`;
}

function renderDiagnosisSection(importState) {
  const findings = importState.findings ?? [];
  return [
    '## VibePro診断同期',
    '',
    `- Run ID: ${importState.latest_run.run_id}`,
    `- Gate: ${importState.latest_run.gate_status}`,
    `- graphify nodes: ${importState.signals.graphify.node_count}`,
    `- graphify edges: ${importState.signals.graphify.edge_count}`,
    `- 検出事項: ${findings.length}件`,
    findings.length === 0
      ? '- 主な検出事項: なし'
      : `- 主な検出事項: ${findings.map((finding) => `${finding.id} ${finding.title}`).join(', ')}`
  ].join('\n');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
