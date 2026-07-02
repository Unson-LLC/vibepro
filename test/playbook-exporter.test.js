import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCli } from '../src/cli.js';
import {
  exportStoryEngineeringPlaybook,
  PLAYBOOK_CATALOG_ID,
  PLAYBOOK_CATALOG_REPO_PATH
} from '../src/playbook-exporter.js';
import { writeInferredSpec } from '../src/spec-store.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-playbook-'));
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-playbook-export',
    '--title',
    'StoryごとのPlaybook出力',
    '--view',
    'dev',
    '--period',
    '2026-W27'
  ]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-playbook-export.md'), `---
story_id: story-playbook-export
title: StoryごとのPlaybook出力
architecture_docs:
  - docs/architecture/playbook-export.md
---

# StoryごとのPlaybook出力

## 背景
CLI出力形式とJSON契約をStory単位で確認できる必要がある。

## 受け入れ基準
- playbook export はStory Engineering Playbookを出力する。
- テンプレ選択の根拠にEngineering Judgment / Gate DAGを使う。

## Scope
- CLI command

## Non-goals
- 全体設計図の自動更新
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'playbook-export.md'), `# Playbook export architecture

Story、Spec、Architecture、Gate DAGを読み、Story単位の開発ブリーフを生成する。
`);
  await writeInferredSpec(repo, 'story-playbook-export', {
    schema_version: '0.1.0',
    story_id: 'story-playbook-export',
    generated_at: '2026-07-01T00:00:00.000Z',
    clauses: [{
      id: 'C-001',
      type: 'contract',
      statement: 'playbook export はmarkdownとjsonの成果物を生成する。',
      origin: {
        story_refs: [{ kind: 'acceptance_criteria', index: 0 }]
      }
    }]
  });
  await mkdir(path.join(repo, '.vibepro', 'pr', 'story-playbook-export'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'pr', 'story-playbook-export', 'pr-prepare.json'), `${JSON.stringify({
    pr_context: {
      engineering_judgment: {
        route_type: 'agent_workflow',
        active_axes: ['public_contract']
      },
      gate_dag: {
        overall_status: 'needs_verification',
        nodes: [
          { id: 'gate:judgment_axis_public_contract', status: 'needs_evidence', required: true },
          { id: 'gate:unit', status: 'needs_evidence', required: true }
        ],
        summary: { needs_evidence_count: 2 }
      }
    },
    git: {
      changed_files: ['src/cli.js', 'src/playbook-exporter.js']
    }
  }, null, 2)}\n`);
  return repo;
}

test('exportStoryEngineeringPlaybook writes story-scoped markdown and json from Story/Spec/Architecture/Gate DAG', async () => {
  const repo = await makeRepo();
  const result = await exportStoryEngineeringPlaybook(repo, { storyId: 'story-playbook-export' });

  assert.equal(result.playbook.catalog.id, PLAYBOOK_CATALOG_ID);
  assert.equal(result.playbook.catalog.path, PLAYBOOK_CATALOG_REPO_PATH);
  assert.equal(result.playbook.output.language, 'ja');
  assert.equal(result.selected_templates.includes('contract.surface'), true);
  assert.equal(result.playbook.engineering_judgment.active_axes.includes('public_contract'), true);
  assert.equal(
    result.playbook.template_decisions
      .find((item) => item.template_id === 'contract.surface')
      .template_paths
      .includes('docs/playbooks/story-engineering-playbook/architecture/03_api_design.md'),
    true
  );
  assert.equal(await pathExists(path.join(repo, result.artifacts.markdown)), true);
  assert.equal(await pathExists(path.join(repo, result.artifacts.json)), true);

  const markdown = await readFile(path.join(repo, result.artifacts.markdown), 'utf8');
  assert.match(markdown, /Story Engineering Playbook/);
  assert.match(markdown, /Catalog path/);
  assert.match(markdown, /Template Decisions/);
  assert.match(markdown, /contract\.surface/);
  assert.match(markdown, /docs\/playbooks\/story-engineering-playbook\/architecture\/03_api_design\.md/);
  assert.doesNotMatch(markdown, /kuramoto/i);
});

test('bundled playbook catalog includes only local readable template files', async () => {
  const catalog = JSON.parse(await readFile(path.join(PACKAGE_ROOT, PLAYBOOK_CATALOG_REPO_PATH), 'utf8'));

  assert.equal(catalog.id, PLAYBOOK_CATALOG_ID);
  assert.equal(catalog.source, 'bundled');
  assert.equal(catalog.included_roots.includes('design'), false);
  assert.equal(catalog.included_roots.includes('discovery'), false);
  assert.equal(catalog.excluded_roots.includes('design'), true);
  assert.equal(catalog.excluded_roots.includes('discovery'), true);

  for (const [templateId, template] of Object.entries(catalog.templates)) {
    assert.equal(template.template_paths.length > 0, true, templateId);
    for (const templatePath of template.template_paths) {
      assert.equal(path.isAbsolute(templatePath), false, templatePath);
      assert.equal(templatePath.startsWith(`${catalog.template_root}/`), true, templatePath);
      const content = await readFile(path.join(PACKAGE_ROOT, templatePath), 'utf8');
      assert.doesNotMatch(content, /Tech Knight|倉本|kuramoto|github\.com\/Tech-Knight|tech-knight/i);
    }
  }
});

test('playbook export CLI returns artifact paths as JSON', async () => {
  const repo = await makeRepo();
  const result = await runCli(['playbook', 'export', repo, '--id', 'story-playbook-export', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.playbook.catalog.id, PLAYBOOK_CATALOG_ID);
  assert.equal(result.result.artifacts.markdown.endsWith('story-engineering-playbook.md'), true);
});

test('fallback surface selection stays conservative before Engineering Judgment DAG exists', async () => {
  const repo = await makeRepo();
  await rm(path.join(repo, '.vibepro', 'pr', 'story-playbook-export'), { recursive: true, force: true });

  const result = await exportStoryEngineeringPlaybook(repo, { storyId: 'story-playbook-export' });

  assert.equal(result.selected_templates.includes('contract.surface'), true);
  assert.equal(result.selected_templates.includes('data.state'), false);
  assert.equal(result.selected_templates.includes('ux.workflow'), false);
  assert.equal(result.selected_templates.includes('release.ops'), false);
  assert.equal(
    result.playbook.template_decisions.find((item) => item.template_id === 'contract.surface').source,
    'fallback_surface_signal'
  );
});
