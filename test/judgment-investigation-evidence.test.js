import './support/scratch-tmpdir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  collectJudgmentEvidence,
  JUDGMENT_GRAPH_MAX_NODES,
  JUDGMENT_GRAPH_OUTPUT_MAX_BYTES,
  JUDGMENT_SOURCE_INPUT_MAX_BYTES,
  JUDGMENT_SOURCE_MAX_LINES,
  JUDGMENT_SOURCE_OUTPUT_MAX_BYTES
} from '../src/judgment-investigation-evidence.js';

async function withTempRepo(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-judgment-evidence-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function graphRequest(query = {}) {
  return {
    id: 'investigation-1',
    question_id: 'existing-mechanism',
    provider: 'graphify',
    purpose: 'find the existing path',
    query
  };
}

function sourceRequest(query) {
  return {
    id: 'investigation-2',
    question_id: 'source-contract',
    provider: 'source',
    purpose: 'inspect the implementation excerpt',
    query
  };
}

test('Graphify evidence preserves edge direction and supports edges and links', async () => {
  await withTempRepo(async (root) => {
    const graphPath = path.join(root, 'graph.json');
    await writeFile(graphPath, JSON.stringify({
      nodes: [
        { id: 'screen', source_file: 'src/screen.js', label: 'Screen' },
        { id: 'service', source_file: 'src/service.js', label: 'Service' }
      ],
      edges: [{ source: 'screen', target: 'service', relation: 'calls', confidence: 'EXTRACTED' }]
    }));

    const edgesResult = await collectJudgmentEvidence(root, graphRequest({ files: ['src/screen.js'] }), { graphPath });
    assert.equal(edgesResult.status, 'available');
    assert.deepEqual(edgesResult.source_refs, ['graph.json']);
    const edgesPayload = JSON.parse(edgesResult.content);
    assert.equal(edgesPayload.edge_source_key, 'edges');
    assert.equal(edgesPayload.selection, 'focused_neighbors');
    assert.deepEqual(edgesPayload.matched_files, ['src/screen.js']);
    assert.equal(edgesPayload.edges[0].source, 'screen');
    assert.equal(edgesPayload.edges[0].target, 'service');
    assert.equal(edgesPayload.edges[0].relation, 'calls');
    assert.match(edgesResult.limitation, /freshness is unknown/);
    assert.match(edgesResult.limitation, /not confirmed against runtime/);

    await writeFile(graphPath, JSON.stringify({
      nodes: [
        { id: 'screen', source_file: 'src/screen.js' },
        { id: 'service', source_file: 'src/service.js' }
      ],
      links: [{ source: 'screen', target: 'service', relation: 'calls' }]
    }));
    const linksResult = await collectJudgmentEvidence(root, graphRequest({ files: ['src/screen.js'] }), { graphPath });
    assert.equal(linksResult.status, 'available');
    assert.equal(JSON.parse(linksResult.content).edge_source_key, 'links');
  });
});

test('Graphify overview is bounded while focused queries include neighboring nodes', async () => {
  await withTempRepo(async (root) => {
    const graphPath = path.join(root, 'graph.json');
    const nodes = Array.from({ length: JUDGMENT_GRAPH_MAX_NODES + 5 }, (_, index) => ({
      id: `node-${index}`,
      source_file: `src/node-${index}.js`
    }));
    const edges = [
      { source: 'node-0', target: 'node-1', relation: 'calls' },
      { source: 'node-1', target: 'node-2', relation: 'calls' }
    ];
    await writeFile(graphPath, JSON.stringify({ nodes, edges }));

    const overview = await collectJudgmentEvidence(root, graphRequest({ files: [] }), { graphPath });
    const overviewPayload = JSON.parse(overview.content);
    assert.equal(overviewPayload.selection, 'overview');
    assert.equal(overviewPayload.nodes.length, JUDGMENT_GRAPH_MAX_NODES);
    assert.equal(overview.status, 'partial');
    assert.match(overview.limitation, /bounded to/);

    const focused = await collectJudgmentEvidence(root, graphRequest({ files: ['src/node-0.js'] }), { graphPath });
    const focusedPayload = JSON.parse(focused.content);
    assert.equal(focused.status, 'available');
    assert.equal(focusedPayload.selection, 'focused_neighbors');
    assert.deepEqual(focusedPayload.nodes.map((node) => node.id), ['node-0', 'node-1']);
    assert.equal(focusedPayload.edges[0].source, 'node-0');
    assert.equal(focusedPayload.edges[0].target, 'node-1');
  });
});

test('missing, malformed, empty, and unmatched Graphify evidence stay non-conclusive', async () => {
  await withTempRepo(async (root) => {
    const missing = await collectJudgmentEvidence(root, graphRequest(), { graphPath: path.join(root, 'missing.json') });
    assert.equal(missing.status, 'unavailable');
    assert.deepEqual(missing.source_refs, []);

    const malformedPath = path.join(root, 'malformed.json');
    await writeFile(malformedPath, '{not-json');
    const malformed = await collectJudgmentEvidence(root, graphRequest(), { graphPath: malformedPath });
    assert.equal(malformed.status, 'unavailable');
    assert.match(malformed.limitation, /malformed JSON/);

    const invalidShapePath = path.join(root, 'invalid-shape.json');
    await writeFile(invalidShapePath, JSON.stringify({ nodes: [] }));
    const invalidShape = await collectJudgmentEvidence(root, graphRequest(), { graphPath: invalidShapePath });
    assert.equal(invalidShape.status, 'unavailable');

    const emptyPath = path.join(root, 'empty.json');
    await writeFile(emptyPath, JSON.stringify({ nodes: [], edges: [] }));
    const empty = await collectJudgmentEvidence(root, graphRequest(), { graphPath: emptyPath });
    assert.equal(empty.status, 'partial');
    assert.match(empty.limitation, /empty coverage does not establish absence/);

    const graphPath = path.join(root, 'unmatched.json');
    await writeFile(graphPath, JSON.stringify({
      nodes: [{ id: 'known', source_file: 'src/known.js' }],
      edges: []
    }));
    const unmatched = await collectJudgmentEvidence(root, graphRequest({ files: ['src/missing.js'] }), { graphPath });
    const unmatchedPayload = JSON.parse(unmatched.content);
    assert.equal(unmatched.status, 'partial');
    assert.deepEqual(unmatchedPayload.unmatched_files, ['src/missing.js']);
    assert.match(unmatched.limitation, /does not establish absence/);
  });
});

test('duplicate, dangling, and malformed Graphify records cannot certify a healthy graph', async () => {
  await withTempRepo(async (root) => {
    const graphPath = path.join(root, 'integrity.json');
    await writeFile(graphPath, JSON.stringify({
      nodes: [
        { id: 'a', source_file: 'src/a.js' },
        { id: 'a', source_file: 'src/a-copy.js' },
        null
      ],
      edges: [
        { source: 'a', target: 'missing', relation: 'calls' },
        { source: 'a', target: 'missing', relation: 'calls' },
        { source: 'a' },
        'malformed'
      ]
    }));
    const result = await collectJudgmentEvidence(root, graphRequest({ files: ['src/a.js'] }), { graphPath });
    const payload = JSON.parse(result.content);
    assert.equal(result.status, 'partial');
    assert.equal(payload.graph_integrity.malformed_nodes, 1);
    assert.equal(payload.graph_integrity.malformed_edges, 2);
    assert.equal(payload.graph_integrity.duplicate_node_ids.length, 1);
    assert.equal(payload.graph_integrity.duplicate_edges.length, 1);
    assert.equal(payload.graph_integrity.dangling_edges.length, 2);

    const overview = await collectJudgmentEvidence(root, graphRequest({ files: [] }), { graphPath });
    assert.equal(overview.status, 'partial');
    assert.equal(JSON.parse(overview.content).graph_integrity.malformed_nodes, 1);
  });
});

test('Graphify bounds oversized invalid metadata and keeps JSON output within its cap', async () => {
  await withTempRepo(async (root) => {
    const graphPath = path.join(root, 'giant-integrity.json');
    const longMissingIds = Array.from({ length: 140 }, (_, index) => `${'missing-node-'.repeat(320)}-${index}`);
    await writeFile(graphPath, JSON.stringify({
      nodes: [{ id: 'root', source_file: 'src/root.js' }],
      edges: longMissingIds.map((target) => ({ source: 'root', target, relation: 'calls' }))
    }));

    const result = await collectJudgmentEvidence(root, graphRequest({ files: [] }), { graphPath });
    assert.equal(result.status, 'partial');
    assert.ok(Buffer.byteLength(result.content, 'utf8') <= JUDGMENT_GRAPH_OUTPUT_MAX_BYTES);
    const payload = JSON.parse(result.content);
    assert.equal(payload.graph_integrity.output_truncated, true);
    assert.ok(payload.graph_integrity.dangling_edges.length <= 61);
  });
});

test('Graphify marks clipped Unicode record values as partial', async () => {
  await withTempRepo(async (root) => {
    const graphPath = path.join(root, 'unicode-record.json');
    await writeFile(graphPath, JSON.stringify({
      nodes: [{
        id: 'root',
        source_file: 'src/root.js',
        label: '判断'.repeat(1600),
        metadata: { nested: { deeper: { value: '省略される' } } }
      }],
      edges: []
    }));

    const result = await collectJudgmentEvidence(root, graphRequest({ files: [] }), { graphPath });
    assert.equal(result.status, 'partial');
    assert.match(result.limitation, /records or metadata were clipped/);
    assert.ok(Buffer.byteLength(result.content, 'utf8') <= JUDGMENT_GRAPH_OUTPUT_MAX_BYTES);
  });
});

test('Graphify bounds Unicode metadata within the byte cap and stays partial', async () => {
  await withTempRepo(async (root) => {
    const graphPath = path.join(root, 'unicode-metadata.json');
    await writeFile(graphPath, JSON.stringify({
      nodes: [{ id: 'root', source_file: 'src/root.js' }],
      edges: Array.from({ length: 140 }, (_, index) => ({
        source: 'root',
        target: `missing-${index}`,
        relation: '関係'.repeat(1800)
      }))
    }));

    const result = await collectJudgmentEvidence(root, graphRequest({ files: [] }), { graphPath });
    assert.equal(result.status, 'partial');
    assert.ok(Buffer.byteLength(result.content, 'utf8') <= JUDGMENT_GRAPH_OUTPUT_MAX_BYTES);
    const payload = JSON.parse(result.content);
    assert.equal(payload.status, 'partial');
    assert.equal(payload.graph_integrity.output_truncated, true);
    assert.match(result.limitation, /records or metadata were clipped/);
  });
});

test('source evidence returns numbered bounded line ranges and does not write', async () => {
  await withTempRepo(async (root) => {
    await mkdir(path.join(root, 'src'));
    const sourcePath = path.join(root, 'src', 'example.js');
    const original = 'one\ntwo\nthree\nfour\n';
    await writeFile(sourcePath, original);
    const beforeEntries = await readdir(root);
    const result = await collectJudgmentEvidence(root, sourceRequest({
      path: 'src/example.js',
      start_line: 2,
      end_line: 3
    }));
    assert.equal(result.status, 'available');
    assert.equal(result.content, '2: two\n3: three');
    assert.deepEqual(result.source_refs, ['src/example.js#L2-L3']);
    assert.match(result.limitation, /static source excerpt/);
    assert.deepEqual(await readdir(root), beforeEntries);
    assert.equal(await readFile(sourcePath, 'utf8'), original);
  });
});

test('source evidence marks input and line output clipping as partial', async () => {
  await withTempRepo(async (root) => {
    const largePath = path.join(root, 'large.txt');
    await writeFile(largePath, 'x'.repeat(JUDGMENT_SOURCE_INPUT_MAX_BYTES + 100));
    const large = await collectJudgmentEvidence(root, sourceRequest({ path: 'large.txt', start_line: 1, end_line: 1 }));
    assert.equal(large.status, 'partial');
    assert.match(large.limitation, /clipped/);
    assert.match(large.content, /^1: /);
    assert.deepEqual(large.source_refs, ['large.txt#L1-L1']);

    const manyLinesPath = path.join(root, 'many-lines.txt');
    await writeFile(manyLinesPath, Array.from({ length: JUDGMENT_SOURCE_MAX_LINES + 10 }, (_, index) => `line-${index + 1}`).join('\n'));
    const manyLines = await collectJudgmentEvidence(root, sourceRequest({
      path: 'many-lines.txt',
      start_line: 1,
      end_line: JUDGMENT_SOURCE_MAX_LINES + 10
    }));
    assert.equal(manyLines.status, 'partial');
    assert.match(manyLines.limitation, /capped at 200 lines/);
    assert.match(manyLines.content, /^1: line-1/);
    assert.doesNotMatch(manyLines.content, /201: line-201/);

    const unicodeLinesPath = path.join(root, 'unicode-lines.txt');
    await writeFile(unicodeLinesPath, `${'判'.repeat(10920)}\n終`);
    const unicodeLines = await collectJudgmentEvidence(root, sourceRequest({
      path: 'unicode-lines.txt',
      start_line: 1,
      end_line: 2
    }));
    assert.equal(unicodeLines.status, 'partial');
    assert.ok(Buffer.byteLength(unicodeLines.content, 'utf8') <= JUDGMENT_SOURCE_OUTPUT_MAX_BYTES);
    assert.match(unicodeLines.limitation, /excerpt is capped/);
  });
});

test('source evidence rejects traversal, absolute, null, out-of-bounds, symlink, and non-file paths', async () => {
  await withTempRepo(async (root) => {
    await writeFile(path.join(root, 'safe.txt'), 'safe\n');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-judgment-outside-'));
    try {
      const outsideFile = path.join(outside, 'secret.txt');
      await writeFile(outsideFile, 'secret\n');
      await symlink(outsideFile, path.join(root, 'outside-link.txt'));
      await mkdir(path.join(root, 'directory'));

      for (const query of [
        { path: '../secret.txt' },
        { path: '/etc/passwd' },
        { path: 'safe\u0000.txt' },
        { path: 'safe.txt', start_line: 2, end_line: 2 },
        { path: 'outside-link.txt' },
        { path: 'directory' }
      ]) {
        const result = await collectJudgmentEvidence(root, sourceRequest(query));
        assert.equal(result.status, 'unavailable', JSON.stringify(query));
        assert.deepEqual(result.source_refs, []);
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('external evidence stays unavailable and unknown providers are rejected', async () => {
  const external = await collectJudgmentEvidence('/tmp/repo', {
    id: 'external-1',
    question_id: 'runtime',
    provider: 'external',
    purpose: 'confirm runtime behavior',
    query: {}
  });
  assert.equal(external.status, 'unavailable');
  assert.deepEqual(external.source_refs, []);
  assert.match(external.limitation, /authorized host/);

  await assert.rejects(
    collectJudgmentEvidence('/tmp/repo', { provider: 'unknown', query: {} }),
    /one of: graphify, source, external/
  );
});
