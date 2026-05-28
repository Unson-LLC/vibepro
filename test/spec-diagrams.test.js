import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateSpec, evaluateDesignDiagramsGate } from '../src/spec-validator.js';

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'vibepro-spec-diagrams-'));
}

function baseSpec(overrides = {}) {
  return {
    schema_version: '0.1.0',
    story_id: 'story-x',
    clauses: [
      {
        id: 'INV-1',
        type: 'invariant',
        statement: 'USER and SUBSCRIPTION must keep referential integrity',
        rationale: 'derived from schema',
        origin: { story_refs: [{ kind: 'acceptance_criteria', index: 0 }] }
      }
    ],
    ...overrides
  };
}

test('spec without diagrams remains backward compatible', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec());
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test('spec with valid er diagram passes', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec({
    diagrams: [
      {
        kind: 'er',
        mermaid: 'erDiagram\n  USER ||--o{ SUBSCRIPTION : has',
        entities: ['USER', 'SUBSCRIPTION']
      }
    ]
  }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('diagram with unknown kind is rejected', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec({
    diagrams: [{ kind: 'bogus', mermaid: 'erDiagram\n  USER' }]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'diagram_kind'));
});

test('diagram with empty mermaid is rejected', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec({
    diagrams: [{ kind: 'er', mermaid: '' }]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'diagram_mermaid_missing'));
});

test('mermaid prefix mismatch is rejected', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec({
    diagrams: [
      {
        kind: 'er',
        mermaid: 'sequenceDiagram\n  A->>B: x',
        entities: ['USER']
      }
    ]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'diagram_mermaid_prefix'));
});

test('entities required for er kind', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec({
    diagrams: [{ kind: 'er', mermaid: 'erDiagram\n  X' }]
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'diagram_entities_required'));
});

test('entity-clause cross-check produces warning when entity not in any clause', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec({
    diagrams: [
      {
        kind: 'er',
        mermaid: 'erDiagram\n  GHOST',
        entities: ['GHOST_ENTITY_NOT_IN_CLAUSES']
      }
    ]
  }));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.code === 'diagram_entity_clause_mismatch'));
});

test('flow diagram accepts flowchart prefix', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec({
    diagrams: [{ kind: 'flow', mermaid: 'flowchart TD\n  A --> B' }]
  }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('threat_model accepts flowchart prefix', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec({
    diagrams: [{ kind: 'threat_model', mermaid: 'flowchart LR\n  Attacker --> Asset' }]
  }));
  assert.equal(result.ok, true);
});

test('c4_context requires entities and accepts C4Context prefix', async () => {
  const root = await tempRoot();
  const result = await validateSpec(root, baseSpec({
    diagrams: [
      {
        kind: 'c4_context',
        mermaid: 'C4Context\n  Person(USER, "user")',
        entities: ['USER']
      }
    ]
  }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('evaluateDesignDiagramsGate returns not_applicable when no triggers', () => {
  const gate = evaluateDesignDiagramsGate({ required_diagrams: [], reasons: [], spec: baseSpec() });
  assert.equal(gate.status, 'not_applicable');
  assert.equal(gate.blocking, true);
  assert.deepEqual(gate.missing, []);
});

test('evaluateDesignDiagramsGate blocks when required diagrams missing', () => {
  const gate = evaluateDesignDiagramsGate({
    required_diagrams: ['er', 'sequence'],
    reasons: [{ kind: 'er', signal: 'schema' }, { kind: 'sequence', signal: 'webhook' }],
    spec: baseSpec()
  });
  assert.equal(gate.status, 'blocked');
  assert.deepEqual(gate.missing.sort(), ['er', 'sequence']);
});

test('evaluateDesignDiagramsGate passes when all required diagrams provided', () => {
  const gate = evaluateDesignDiagramsGate({
    required_diagrams: ['er'],
    reasons: [{ kind: 'er', signal: 'schema' }],
    spec: baseSpec({
      diagrams: [{ kind: 'er', mermaid: 'erDiagram\n  USER', entities: ['USER'] }]
    })
  });
  assert.equal(gate.status, 'pass');
  assert.deepEqual(gate.missing, []);
});
