import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

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
  const story = selectPublishStory(importState, options.storyId);
  const record = await findStoryRecord(source, fetchFn, story.story_id);
  const existingDescription = pick(record, '説明', 'description') ?? '';
  const nextDescription = replaceDiagnosisSection(existingDescription, renderDiagnosisSection(importState));

  if (options.dryRun) {
    const preview = await writePublishPreview(root, {
      importState,
      story,
      record,
      existingDescription,
      nextDescription
    });
    await recordPublishPreview(root, preview, importState);
    return {
      storyId: story.story_id,
      recordId: getRecordId(record),
      dryRun: true,
      preview
    };
  }

  const backup = await writePublishBackup(root, {
    importState,
    story,
    record,
    existingDescription,
    nextDescription
  });
  await patchStoryDescription(source, fetchFn, record, nextDescription);
  const verifiedRecord = await findStoryRecord(source, fetchFn, story.story_id);
  const verifiedDescription = pick(verifiedRecord, '説明', 'description') ?? '';
  const publishResult = await writePublishResult(root, {
    importState,
    story,
    record: verifiedRecord,
    backup,
    nextDescription,
    verifiedDescription
  });
  await recordPublishResult(root, backup, publishResult, importState);
  return {
    storyId: story.story_id,
    recordId: getRecordId(record),
    backup,
    publishResult
  };
}

function selectPublishStory(importState, storyId) {
  const stories = Array.isArray(importState.stories) ? importState.stories : [];
  if (storyId) {
    const story = stories.find((item) => item.story_id === storyId);
    if (!story) throw new Error(`Story ID is not included in portfolio dashboard import state: ${storyId}`);
    return story;
  }
  const story = importState.story ?? stories[0];
  if (!story?.story_id) throw new Error('portfolio dashboard import state does not contain a publishable story');
  return story;
}

function resolveNocoDBSource(config, env) {
  const storySource = config.brainbase?.story_source ?? {};
  const url = env.NOCODB_URL ?? storySource.url;
  const token = env.NOCODB_TOKEN ?? storySource.token;
  if (!url) throw new Error('NOCODB_URL is required to sync portfolio dashboard stories');
  if (!token) throw new Error('NOCODB_TOKEN is required to sync portfolio dashboard stories');
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
  return record.Id ?? record.id ?? record.ID ?? record['番号'] ?? null;
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

async function writePublishBackup(repoRoot, { importState, story, record, existingDescription, nextDescription }) {
  const brainbaseDir = path.join(getWorkspaceDir(repoRoot), 'brainbase');
  await mkdir(brainbaseDir, { recursive: true });
  const backup = {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    story_id: story.story_id,
    record_id: getRecordId(record),
    latest_run_id: importState.latest_run.run_id,
    existing_description: existingDescription,
    next_description: nextDescription
  };
  const backupJsonPath = path.join(brainbaseDir, 'publish-backup.json');
  await writeFile(backupJsonPath, `${JSON.stringify(backup, null, 2)}\n`);
  return { ...backup, backupJsonPath };
}

async function writePublishResult(repoRoot, { importState, story, record, backup, nextDescription, verifiedDescription }) {
  const brainbaseDir = path.join(getWorkspaceDir(repoRoot), 'brainbase');
  await mkdir(brainbaseDir, { recursive: true });
  const descriptionMatchesExpected = verifiedDescription === nextDescription;
  if (!descriptionMatchesExpected) {
    throw new Error(`NocoDB Story description verification failed: ${story.story_id}`);
  }
  const publishResult = {
    schema_version: '0.1.0',
    published_at: new Date().toISOString(),
    story_id: story.story_id,
    record_id: getRecordId(record),
    latest_run_id: importState.latest_run.run_id,
    gate_status: importState.latest_run.gate_status,
    verified: true,
    description_matches_expected: descriptionMatchesExpected,
    updated_fields: ['説明'],
    status_changed: false,
    backup_json: toWorkspaceRelative(repoRoot, backup.backupJsonPath)
  };
  const resultJsonPath = path.join(brainbaseDir, 'publish-result.json');
  await writeFile(resultJsonPath, `${JSON.stringify(publishResult, null, 2)}\n`);
  return { ...publishResult, resultJsonPath };
}

async function recordPublishResult(repoRoot, backup, publishResult, importState) {
  const manifest = await readManifest(repoRoot);
  manifest.brainbase = {
    ...(manifest.brainbase ?? {}),
    last_publish_result: {
      published_at: publishResult.published_at,
      latest_run_id: importState.latest_run.run_id,
      story_id: publishResult.story_id,
      verified: publishResult.verified,
      backup_json: toWorkspaceRelative(repoRoot, backup.backupJsonPath),
      result_json: toWorkspaceRelative(repoRoot, publishResult.resultJsonPath)
    }
  };
  await writeManifest(repoRoot, manifest);
}

async function writePublishPreview(repoRoot, { importState, story, record, existingDescription, nextDescription }) {
  const brainbaseDir = path.join(getWorkspaceDir(repoRoot), 'brainbase');
  await mkdir(brainbaseDir, { recursive: true });
  const preview = {
    schema_version: '0.1.0',
    dry_run: true,
    generated_at: new Date().toISOString(),
    story_id: story.story_id,
    record_id: getRecordId(record),
    latest_run_id: importState.latest_run.run_id,
    gate_status: importState.latest_run.gate_status,
    existing_description: existingDescription,
    next_description: nextDescription
  };
  const previewJsonPath = path.join(brainbaseDir, 'publish-preview.json');
  const previewMarkdownPath = path.join(brainbaseDir, 'publish-preview.md');
  await writeFile(previewJsonPath, `${JSON.stringify(preview, null, 2)}\n`);
  await writeFile(previewMarkdownPath, renderPublishPreview(preview));
  return { ...preview, previewJsonPath, previewMarkdownPath };
}

async function recordPublishPreview(repoRoot, preview, importState) {
  const manifest = await readManifest(repoRoot);
  manifest.brainbase = {
    ...(manifest.brainbase ?? {}),
    last_publish_preview: {
      generated_at: preview.generated_at,
      latest_run_id: importState.latest_run.run_id,
      story_id: preview.story_id,
      preview_json: toWorkspaceRelative(repoRoot, preview.previewJsonPath),
      preview_markdown: toWorkspaceRelative(repoRoot, preview.previewMarkdownPath)
    }
  };
  await writeManifest(repoRoot, manifest);
}

function renderPublishPreview(preview) {
  return `# VibePro診断同期プレビュー

| 項目 | 内容 |
|------|------|
| Story ID | ${preview.story_id} |
| Record ID | ${preview.record_id} |
| Gate | ${preview.gate_status} |
| Dry Run | true |

PATCHは実行していない。

## 更新後の説明

\`\`\`md
${preview.next_description}
\`\`\`
`;
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
