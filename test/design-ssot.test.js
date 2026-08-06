import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { preparePullRequest } from '../src/pr-manager.js';

const execFileAsync = promisify(execFile);

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
  assert.equal(gate.summary.coverage_gap_count, 0);
  assert.equal(gateDag.summary.design_ssot_reconciliation_status, 'passed');
  assert.ok(gateDag.edges.some((edge) => edge.from === 'gate:path_surface_matrix' && edge.to === 'gate:design_ssot_reconciliation'));
  assert.ok(gateDag.edges.some((edge) => edge.from === 'gate:design_ssot_reconciliation' && edge.to === 'gate:responsibility_authority'));
  const designSsotArtifact = await readJson(result.artifacts.design_ssot_reconciliation);
  assert.equal(designSsotArtifact.coverage.summary.changed_unregistered_design_doc_count, 0);
  assert.equal(designSsotArtifact.coverage.summary.registered_doc_count, 3);
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
