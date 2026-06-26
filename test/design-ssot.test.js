import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { preparePullRequest } from '../src/pr-manager.js';

const execFileAsync = promisify(execFile);

test('design-ssot init link status and reconcile create a committed registry plus local artifacts', async () => {
  const repo = await makeRepo();
  await writeDesignDocs(repo);

  const init = await runCli([
    'design-ssot',
    'init',
    repo,
    '--id',
    'central-control-plane',
    '--root-doc',
    'docs/architecture/central-control-plane.md',
    '--title',
    'Central Control Plane',
    '--required-child-kinds',
    'story,spec',
    '--json'
  ]);
  assert.equal(init.exitCode, 0);
  assert.equal(init.result.status, 'passed');

  const linkStory = await runCli([
    'design-ssot',
    'link',
    repo,
    '--id',
    'central-control-plane',
    '--kind',
    'story',
    '--path',
    'docs/management/stories/active/story-central-control-plane.md',
    '--json'
  ]);
  assert.equal(linkStory.exitCode, 0);

  const linkSpec = await runCli([
    'design-ssot',
    'link',
    repo,
    '--id',
    'central-control-plane',
    '--kind',
    'spec',
    '--path',
    'docs/specs/central-control-plane.md',
    '--json'
  ]);
  assert.equal(linkSpec.exitCode, 0);

  const status = await runCli(['design-ssot', 'status', repo, '--id', 'central-control-plane', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.summary.design_root_count, 1);
  assert.equal(status.result.summary.child_link_count, 2);

  const reconcile = await runCli(['design-ssot', 'reconcile', repo, '--id', 'central-control-plane', '--json']);
  assert.equal(reconcile.exitCode, 0);
  assert.equal(reconcile.result.result.status, 'passed');
  assert.equal(reconcile.result.result.summary.action_item_count, 0);

  const registry = JSON.parse(await readFile(path.join(repo, 'design-ssot.json'), 'utf8'));
  assert.equal(registry.design_roots[0].root_doc, 'docs/architecture/central-control-plane.md');
  assert.equal(registry.design_roots[0].children.story[0].path, 'docs/management/stories/active/story-central-control-plane.md');
  assert.ok(await readJson(path.join(repo, '.vibepro', 'design-ssot', 'central-control-plane', 'registry.json')));
});

test('design-ssot status ignores local .vibepro registry as authority', async () => {
  const repo = await makeRepo();
  await writeDesignDocs(repo);
  await mkdir(path.join(repo, '.vibepro', 'design-ssot'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'design-ssot', 'registry.json'), `${JSON.stringify(baseDesignSsotRegistry(), null, 2)}\n`);

  const status = await runCli(['design-ssot', 'status', repo, '--id', 'central-control-plane', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.status, 'not_applicable');
  assert.deepEqual(status.result.registry_sources, []);
  assert.equal(status.result.summary.design_root_count, 0);
});

test('design-ssot reconcile reports root-only changes as review action items', async () => {
  const repo = await makeRepo();
  await writeDesignDocs(repo);
  await writeDesignSsotRegistry(repo);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'docs: add design ssot baseline']);
  await git(repo, ['switch', '-c', 'feature/root-only-design-change']);
  await writeFile(path.join(repo, 'docs', 'architecture', 'central-control-plane.md'), `---
title: Central Control Plane
status: active
---

# Central Control Plane

The owner boundary changed without touching the child docs.
`);
  await git(repo, ['add', 'docs/architecture/central-control-plane.md']);
  await git(repo, ['commit', '-m', 'docs: update central design root only']);

  const reconcile = await runCli([
    'design-ssot',
    'reconcile',
    repo,
    '--id',
    'central-control-plane',
    '--base',
    'main',
    '--json'
  ]);
  assert.equal(reconcile.exitCode, 0);
  assert.equal(reconcile.result.result.status, 'needs_review');
  assert.equal(reconcile.result.result.action_items.some((item) => item.kind === 'root_only_change'), true);
});

test('design-ssot reconcile blocks when required child links are missing', async () => {
  const repo = await makeRepo();
  await writeDesignDocs(repo);
  const registry = baseDesignSsotRegistry();
  delete registry.design_roots[0].children.spec;
  await writeDesignSsotRegistry(repo, registry);

  const reconcile = await runCli(['design-ssot', 'reconcile', repo, '--id', 'central-control-plane', '--json']);
  assert.equal(reconcile.exitCode, 2);
  assert.equal(reconcile.result.result.status, 'block');
  assert.equal(reconcile.result.result.action_items.some((item) => item.kind === 'missing_required_child' && item.child_kind === 'spec'), true);
});

test('design-ssot reconcile reports child frontmatter and stale hash gaps', async () => {
  const repo = await makeRepo();
  await writeDesignDocs(repo);
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-central-control-plane.md'), `---
story_id: story-central-control-plane
title: Central control plane design lineage
status: active
---

# Story

This child intentionally omits parent_design.
`);
  const registry = baseDesignSsotRegistry();
  registry.design_roots[0].children.story = [{
    path: 'docs/management/stories/active/story-central-control-plane.md',
    last_reviewed_root_hash: 'stale-root-hash'
  }];
  await writeDesignSsotRegistry(repo, registry);

  const reconcile = await runCli(['design-ssot', 'reconcile', repo, '--id', 'central-control-plane', '--json']);
  assert.equal(reconcile.exitCode, 0);
  assert.equal(reconcile.result.result.status, 'needs_review');
  assert.equal(reconcile.result.result.action_items.some((item) => item.kind === 'frontmatter_gap' && item.field === 'parent_design'), true);
  assert.equal(reconcile.result.result.action_items.some((item) => item.kind === 'stale_child_review'), true);
});

test('design-ssot reconcile blocks accepted ADR supersession conflicts', async () => {
  const repo = await makeRepo();
  await writeDesignDocs(repo);
  await writeFile(path.join(repo, 'docs', 'architecture', 'central-control-plane.md'), `---
title: Central Control Plane
status: active
supersedes:
  - docs/architecture/adr-old-control-plane.md
---

# Central Control Plane

The root replaces an accepted ADR.
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'adr-old-control-plane.md'), `---
title: Old Control Plane ADR
status: accepted
parent_design: central-control-plane
---

# Old Control Plane ADR
`);
  const registry = baseDesignSsotRegistry();
  registry.design_roots[0].children.adr = ['docs/architecture/adr-old-control-plane.md'];
  await writeDesignSsotRegistry(repo, registry);

  const reconcile = await runCli(['design-ssot', 'reconcile', repo, '--id', 'central-control-plane', '--json']);
  assert.equal(reconcile.exitCode, 2);
  assert.equal(reconcile.result.result.status, 'block');
  assert.equal(reconcile.result.result.action_items.some((item) => item.kind === 'accepted_adr_supersession_conflict'), true);
});

test('pr prepare projects design ssot reconciliation between path surface and responsibility gates', async () => {
  const repo = await makeRepo();
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  await git(repo, ['switch', '-c', 'feature/design-ssot-gate']);
  await writeDesignDocs(repo);
  await writeDesignSsotRegistry(repo);

  const result = await preparePullRequest(repo, {
    storyId: 'story-central-control-plane',
    baseRef: 'main',
    branchName: 'feature/design-ssot-gate',
    evidenceDepth: 'summary'
  });
  const gateDag = result.preparation.pr_context.gate_dag;
  const gate = gateDag.nodes.find((node) => node.id === 'gate:design_ssot_reconciliation');
  assert.ok(gate);
  assert.equal(gate.type, 'design_ssot_reconciliation_gate');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.required, true);
  assert.equal(gateDag.summary.design_ssot_reconciliation_status, 'passed');
  assert.ok(gateDag.edges.some((edge) => edge.from === 'gate:path_surface_matrix' && edge.to === 'gate:design_ssot_reconciliation'));
  assert.ok(gateDag.edges.some((edge) => edge.from === 'gate:design_ssot_reconciliation' && edge.to === 'gate:responsibility_authority'));
  assert.ok(await readJson(result.artifacts.design_ssot_reconciliation));
});

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-design-ssot-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, '.gitignore'), '.vibepro/\n');
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  return repo;
}

async function writeDesignDocs(repo) {
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'architecture', 'central-control-plane.md'), `---
title: Central Control Plane
status: active
---

# Central Control Plane

The central design root owns the business loop boundary.
`);
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-central-control-plane.md'), `---
story_id: story-central-control-plane
title: Central control plane design lineage
status: active
parent_design: central-control-plane
architecture_docs:
  - docs/architecture/central-control-plane.md
spec_docs:
  - docs/specs/central-control-plane.md
---

# Story

VibePro should reconcile central design roots with child docs before PR readiness.

## Acceptance Criteria

- pr prepare emits gate:design_ssot_reconciliation.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'central-control-plane.md'), `---
title: Central Control Plane Spec
status: active
parent_design: central-control-plane
---

# Spec

## Invariants

- DSSOT-INV-001: Design child docs declare parent_design.
`);
}

function baseDesignSsotRegistry() {
  return {
    schema_version: '0.1.0',
    model: 'vibepro-design-ssot-registry-v1',
    design_roots: [
      {
        id: 'central-control-plane',
        title: 'Central Control Plane',
        root_doc: 'docs/architecture/central-control-plane.md',
        required_child_kinds: ['story', 'spec'],
        children: {
          story: ['docs/management/stories/active/story-central-control-plane.md'],
          spec: ['docs/specs/central-control-plane.md']
        }
      }
    ]
  };
}

async function writeDesignSsotRegistry(repo, registry = baseDesignSsotRegistry()) {
  await writeFile(path.join(repo, 'design-ssot.json'), `${JSON.stringify(registry, null, 2)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}
