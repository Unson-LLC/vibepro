import { open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  extractGraphNodeSourceFile,
  getEdgeEndpoint,
  normalizeGraphPath
} from './graph-context.js';

export const JUDGMENT_GRAPH_INPUT_MAX_BYTES = 32 * 1024 * 1024;
export const JUDGMENT_GRAPH_MAX_NODES = 60;
export const JUDGMENT_GRAPH_MAX_EDGES = 120;
export const JUDGMENT_GRAPH_OUTPUT_MAX_BYTES = 256 * 1024;
export const JUDGMENT_SOURCE_INPUT_MAX_BYTES = 1024 * 1024;
export const JUDGMENT_SOURCE_MAX_LINES = 200;
export const JUDGMENT_SOURCE_OUTPUT_MAX_BYTES = 32 * 1024;

const PROVIDERS = new Set(['graphify', 'source', 'external']);
const SOURCE_PATH_ERROR = 'source query.path must be a non-empty repository-relative path without traversal';
const STATIC_GRAPH_LIMITATION = [
  'Graphify is a static artifact; graph freshness is unknown.',
  'Graph relations, including inferred relations, are not confirmed against runtime behavior.'
];
const STATIC_SOURCE_LIMITATION = 'This is a bounded static source excerpt; runtime behavior is not established.';

/**
 * Collect bounded evidence for one expert-judgment investigation step.
 *
 * This function is intentionally read-only. Graphify is treated as an explicit
 * artifact supplied by the operator; it is never generated or imported here.
 * Source evidence is confined to the repository after resolving symlinks.
 */
export async function collectJudgmentEvidence(repoRoot, request, options = {}) {
  const provider = request?.provider;
  if (!PROVIDERS.has(provider)) {
    throw new TypeError('judgment investigation provider must be one of: graphify, source, external');
  }

  if (provider === 'graphify') {
    return collectGraphifyEvidence(repoRoot, request, options);
  }
  if (provider === 'source') {
    return collectSourceEvidence(repoRoot, request);
  }
  return collectExternalEvidence(request);
}

async function collectGraphifyEvidence(repoRoot, request, { graphPath } = {}) {
  if (typeof graphPath !== 'string' || graphPath.trim() === '') {
    return unavailableEvidence(
      'graphify',
      'An explicit graphPath is required; no Graphify artifact was read.'
    );
  }

  const resolvedGraphPath = resolveExplicitPath(repoRoot, graphPath);
  const sourceRef = displayGraphPath(repoRoot, resolvedGraphPath, graphPath);
  let fileInfo;
  try {
    fileInfo = await stat(resolvedGraphPath);
  } catch (error) {
    return unavailableEvidence('graphify', graphReadFailure(error, 'Graphify artifact'));
  }
  if (!fileInfo.isFile()) {
    return unavailableEvidence('graphify', 'The explicit Graphify artifact is not a regular file.');
  }

  if (fileInfo.size > JUDGMENT_GRAPH_INPUT_MAX_BYTES) {
    const limitation = [
      `The Graphify artifact exceeds the ${JUDGMENT_GRAPH_INPUT_MAX_BYTES} byte input cap and was not parsed.`,
      ...STATIC_GRAPH_LIMITATION
    ].join(' ');
    return {
      provider: 'graphify',
      status: 'partial',
      content: JSON.stringify({
        provider: 'graphify',
        status: 'partial',
        graph_path: sourceRef,
        input_truncated: true,
        node_count: null,
        edge_count: null,
        nodes: [],
        edges: [],
        requested_files: boundedStringList(normalizeGraphQueryFiles(request)).value,
        matched_files: [],
        unmatched_files: [],
        limitations: limitation
      }, null, 2),
      source_refs: [sourceRef],
      limitation
    };
  }

  let graph;
  try {
    graph = JSON.parse(await readFile(resolvedGraphPath, 'utf8'));
  } catch (error) {
    return unavailableEvidence('graphify', graphReadFailure(error, 'Graphify artifact JSON'));
  }

  const structure = validateGraphShape(graph);
  if (!structure.valid) {
    return unavailableEvidence('graphify', structure.limitation);
  }

  const query = normalizeGraphQuery(request);
  if (!query.valid) {
    return unavailableEvidence('graphify', query.limitation);
  }

  const analysis = analyzeGraph({
    graph,
    edgeSourceKey: structure.edgeSourceKey,
    requestedFiles: query.files
  });
  const limitations = [...STATIC_GRAPH_LIMITATION, ...analysis.limitations];
  const requestedFiles = boundedStringList(analysis.requestedFiles);
  const matchedFiles = boundedStringList(analysis.matchedFiles);
  const unmatchedFiles = boundedStringList(analysis.unmatchedFiles);
  const nodeRecords = analysis.selectedNodes.map(boundedGraphRecord);
  const edgeRecords = analysis.selectedEdges.map(boundedGraphRecord);
  const duplicateNodeIds = boundedStringList(analysis.duplicateNodeIds);
  const duplicateEdges = boundedStringList(analysis.duplicateEdges);
  const danglingEdges = boundedStringList(analysis.danglingEdges);
  const boundedContent = [
    requestedFiles,
    matchedFiles,
    unmatchedFiles,
    ...nodeRecords,
    ...edgeRecords,
    duplicateNodeIds,
    duplicateEdges,
    danglingEdges
  ];
  if (boundedContent.some((item) => item.truncated)) {
    limitations.push('Graph evidence records or metadata were clipped to bounded values; the full graph content is unavailable.');
  }
  const status = limitations.length > STATIC_GRAPH_LIMITATION.length ? 'partial' : 'available';
  const payload = {
    provider: 'graphify',
    status,
    graph_path: sourceRef,
    selection: analysis.selection,
    edge_source_key: structure.edgeSourceKey,
    node_count: analysis.nodeCount,
    edge_count: analysis.edgeCount,
    selected_node_count: analysis.selectedNodeCount,
    selected_edge_count: analysis.selectedEdgeCount,
    counts: {
      nodes: analysis.nodeCount,
      edges: analysis.edgeCount,
      valid_nodes: analysis.validNodeCount,
      valid_edges: analysis.validEdgeCount,
      selected_nodes: analysis.selectedNodeCount,
      selected_edges: analysis.selectedEdgeCount
    },
    requested_files: requestedFiles.value,
    matched_files: matchedFiles.value,
    unmatched_files: unmatchedFiles.value,
    nodes: nodeRecords.map((item) => item.value),
    edges: edgeRecords.map((item) => item.value),
    graph_integrity: {
      malformed_nodes: analysis.malformedNodeCount,
      malformed_edges: analysis.malformedEdgeCount,
      duplicate_node_ids: duplicateNodeIds.value,
      duplicate_edges: duplicateEdges.value,
      dangling_edges: danglingEdges.value,
      output_truncated: analysis.outputTruncated
    },
    freshness: 'unknown',
    runtime_confirmation: 'not_confirmed',
    limitations
  };
  const content = stringifyGraphPayload(payload);
  if (content.truncated) {
    payload.status = 'partial';
    payload.graph_integrity.output_truncated = true;
    const outputLimit = `Graph evidence output is capped at ${JUDGMENT_GRAPH_OUTPUT_MAX_BYTES} bytes.`;
    if (!payload.limitations.includes(outputLimit)) payload.limitations.push(outputLimit);
  }

  return {
    provider: 'graphify',
    status: payload.limitations.length > STATIC_GRAPH_LIMITATION.length ? 'partial' : 'available',
    content: content.text,
    source_refs: [sourceRef],
    limitation: payload.limitations.join(' ')
  };
}

async function collectSourceEvidence(repoRoot, request) {
  const query = normalizeSourceQuery(request);
  if (!query.valid) return unavailableEvidence('source', query.limitation);

  const root = path.resolve(String(repoRoot ?? ''));
  let canonicalRoot;
  let canonicalSource;
  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    return unavailableEvidence('source', sourceReadFailure(error, 'repository root'));
  }

  const requestedPath = path.resolve(root, query.path);
  if (!pathRemainsWithin(root, requestedPath)) {
    return unavailableEvidence('source', SOURCE_PATH_ERROR);
  }
  try {
    canonicalSource = await realpath(requestedPath);
  } catch (error) {
    return unavailableEvidence('source', sourceReadFailure(error, 'source file'));
  }
  if (!pathRemainsWithin(canonicalRoot, canonicalSource)) {
    return unavailableEvidence('source', 'The source path resolves outside the repository.');
  }

  let fileInfo;
  try {
    fileInfo = await stat(canonicalSource);
  } catch (error) {
    return unavailableEvidence('source', sourceReadFailure(error, 'source file'));
  }
  // stat() is deliberately checked before opening the path. This prevents a
  // FIFO, socket, or device path from blocking the evidence collector.
  if (!fileInfo.isFile()) {
    return unavailableEvidence('source', 'The source path is not a regular file.');
  }

  let text;
  let inputTruncated = fileInfo.size > JUDGMENT_SOURCE_INPUT_MAX_BYTES;
  try {
    text = await readSourcePrefix(canonicalSource, JUDGMENT_SOURCE_INPUT_MAX_BYTES);
  } catch (error) {
    return unavailableEvidence('source', sourceReadFailure(error, 'source file'));
  }

  const lines = splitSourceLines(text);
  const totalKnownLines = lines.length;
  const requestedEnd = query.endLine ?? totalKnownLines;
  const requestedStart = query.startLine ?? 1;
  if (!inputTruncated && (requestedStart > totalKnownLines || requestedEnd > totalKnownLines)) {
    return unavailableEvidence('source', 'The requested source line range is out of bounds.');
  }
  if (requestedStart > totalKnownLines) {
    const limitation = [
      'The requested source line range lies beyond the captured prefix.',
      `The source file is capped at ${JUDGMENT_SOURCE_INPUT_MAX_BYTES} bytes.`
    ].join(' ');
    return {
      provider: 'source',
      status: 'partial',
      content: '',
      source_refs: [],
      limitation
    };
  }

  const end = Math.min(requestedEnd, totalKnownLines);
  const rendered = renderSourceExcerpt(lines, requestedStart, end);
  const limitations = [STATIC_SOURCE_LIMITATION];
  if (inputTruncated) {
    limitations.push(`The source file was clipped at ${JUDGMENT_SOURCE_INPUT_MAX_BYTES} bytes.`);
  }
  if (requestedEnd > end) {
    limitations.push('The requested range extends beyond the captured prefix.');
  }
  if (rendered.truncated) {
    limitations.push(`The source excerpt is capped at ${JUDGMENT_SOURCE_MAX_LINES} lines and ${JUDGMENT_SOURCE_OUTPUT_MAX_BYTES} bytes.`);
  }

  const status = limitations.length === 1 ? 'available' : 'partial';
  const relativePath = normalizeGraphPath(query.path);
  const sourceRef = `${relativePath}#L${rendered.startLine}-L${rendered.endLine}`;
  return {
    provider: 'source',
    status,
    content: rendered.content,
    source_refs: [sourceRef],
    limitation: limitations.join(' ')
  };
}

function collectExternalEvidence() {
  const limitation = 'External evidence is unavailable; collection requires an authorized host or connector.';
  return {
    provider: 'external',
    status: 'unavailable',
    content: limitation,
    source_refs: [],
    limitation
  };
}

function unavailableEvidence(provider, limitation) {
  return {
    provider,
    status: 'unavailable',
    content: '',
    source_refs: [],
    limitation: String(limitation)
  };
}

function resolveExplicitPath(repoRoot, candidate) {
  if (path.isAbsolute(candidate)) return path.resolve(candidate);
  return path.resolve(String(repoRoot ?? ''), candidate);
}

function displayGraphPath(repoRoot, resolvedPath, originalPath) {
  const root = path.resolve(String(repoRoot ?? ''));
  const relative = path.relative(root, resolvedPath);
  if (relative && pathRemainsWithin(root, resolvedPath)) {
    return relative.split(path.sep).join('/');
  }
  return String(originalPath);
}

function validateGraphShape(graph) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    return { valid: false, limitation: 'The Graphify artifact is not a JSON object.' };
  }
  if (!Array.isArray(graph.nodes)) {
    return { valid: false, limitation: 'The Graphify artifact has no valid nodes array.' };
  }
  const edgeSourceKey = Array.isArray(graph.edges)
    ? 'edges'
    : Array.isArray(graph.links)
      ? 'links'
      : null;
  if (!edgeSourceKey) {
    return { valid: false, limitation: 'The Graphify artifact has neither a valid edges array nor a valid links array.' };
  }
  return { valid: true, edgeSourceKey };
}

function normalizeGraphQuery(request) {
  const query = request?.query ?? {};
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { valid: false, limitation: 'Graphify query must be an object.' };
  }
  if (query.files === undefined) return { valid: true, files: [] };
  if (!Array.isArray(query.files) || query.files.some((file) => typeof file !== 'string' || file.trim() === '')) {
    return { valid: false, limitation: 'Graphify query.files must contain non-empty strings.' };
  }
  return {
    valid: true,
    files: uniqueNormalizedFiles(query.files)
  };
}

function normalizeGraphQueryFiles(request) {
  const query = request?.query;
  if (!query || typeof query !== 'object' || !Array.isArray(query.files)) return [];
  return uniqueNormalizedFiles(query.files.filter((file) => typeof file === 'string' && file.trim() !== ''));
}

function normalizeSourceQuery(request) {
  const query = request?.query ?? {};
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { valid: false, limitation: 'Source query must be an object.' };
  }
  if (typeof query.path !== 'string' || query.path.trim() === '') {
    return { valid: false, limitation: SOURCE_PATH_ERROR };
  }
  const rawPath = query.path.replace(/\\/g, '/');
  if (rawPath.includes('\u0000') || rawPath.startsWith('/') || /^[A-Za-z]:\//u.test(rawPath)) {
    return { valid: false, limitation: SOURCE_PATH_ERROR };
  }
  const parts = rawPath.split('/');
  if (parts.includes('..')) return { valid: false, limitation: SOURCE_PATH_ERROR };
  const normalizedPath = path.posix.normalize(rawPath);
  if (normalizedPath === '.' || normalizedPath === '..' || normalizedPath.startsWith('../')) {
    return { valid: false, limitation: SOURCE_PATH_ERROR };
  }

  const startLine = normalizeLineNumber(query.start_line);
  const endLine = normalizeLineNumber(query.end_line);
  if (startLine.error || endLine.error || (startLine.value && endLine.value && endLine.value < startLine.value)) {
    return { valid: false, limitation: 'Source query line range must use positive integers with end_line >= start_line.' };
  }
  return {
    valid: true,
    path: normalizedPath,
    startLine: startLine.value,
    endLine: endLine.value
  };
}

function normalizeLineNumber(value) {
  if (value === undefined || value === null) return { value: null, error: false };
  if (!Number.isSafeInteger(value) || value < 1) return { value: null, error: true };
  return { value, error: false };
}

function analyzeGraph({ graph, edgeSourceKey, requestedFiles }) {
  const rawNodes = graph.nodes;
  const rawEdges = edgeSourceKey === 'edges' ? graph.edges : graph.links;
  const validNodes = rawNodes.filter(isObjectRecord);
  const nodeRecords = validNodes.filter((node) => validIdentifier(node.id));
  const malformedNodeCount = rawNodes.length - nodeRecords.length;
  const nodeIds = new Map();
  const duplicateNodeIds = [];
  for (const node of nodeRecords) {
    const key = identifierKey(node.id);
    if (nodeIds.has(key)) {
      if (!duplicateNodeIds.includes(key)) duplicateNodeIds.push(key);
      continue;
    }
    nodeIds.set(key, node);
  }

  const validEdges = rawEdges.filter(isObjectRecord);
  const edgeRecords = validEdges.filter((edge) => validIdentifier(getEdgeEndpoint(edge, 'source'))
    && validIdentifier(getEdgeEndpoint(edge, 'target')));
  const malformedEdgeCount = rawEdges.length - edgeRecords.length;
  const duplicateEdges = [];
  const seenEdgeKeys = new Set();
  const danglingEdges = [];
  for (const edge of edgeRecords) {
    const source = identifierKey(getEdgeEndpoint(edge, 'source'));
    const target = identifierKey(getEdgeEndpoint(edge, 'target'));
    const relation = String(edge.relation ?? edge.type ?? edge.kind ?? '');
    const edgeKey = `${source}\u0000${target}\u0000${relation}`;
    if (seenEdgeKeys.has(edgeKey) && !duplicateEdges.includes(edgeKey)) duplicateEdges.push(edgeKey);
    seenEdgeKeys.add(edgeKey);
    if (!nodeIds.has(source) || !nodeIds.has(target)) danglingEdges.push(edgeKey);
  }

  const requestedSet = new Set(requestedFiles);
  const matchedFiles = new Set();
  const matchedNodeIds = new Set();
  if (requestedFiles.length > 0) {
    for (const node of nodeRecords) {
      const nodeFile = extractGraphNodeSourceFile(node);
      const candidates = [nodeFile, node.id]
        .filter((value) => typeof value === 'string' && value.trim() !== '')
        .map(normalizeGraphPath);
      for (const requested of requestedSet) {
        if (candidates.includes(requested)) {
          matchedFiles.add(requested);
          matchedNodeIds.add(identifierKey(node.id));
        }
      }
    }
  }

  const selectedEdges = requestedFiles.length === 0
    ? rawEdges
    : rawEdges.filter((edge) => {
        if (!isObjectRecord(edge)) return false;
        const source = getEdgeEndpoint(edge, 'source');
        const target = getEdgeEndpoint(edge, 'target');
        return (validIdentifier(source) && matchedNodeIds.has(identifierKey(source)))
          || (validIdentifier(target) && matchedNodeIds.has(identifierKey(target)));
      });
  const selectedNodeIds = requestedFiles.length === 0
    ? new Set(nodeRecords.map((node) => identifierKey(node.id)))
    : collectFocusedNodeIds(selectedEdges, matchedNodeIds);
  const selectedNodes = requestedFiles.length === 0
    ? rawNodes
    : nodeRecords.filter((node) => selectedNodeIds.has(identifierKey(node.id)));
  const unmatchedFiles = requestedFiles.filter((file) => !matchedFiles.has(file));

  // A focused query is allowed to inspect a small neighborhood even when the
  // overall graph is larger than the output cap. Only the selected evidence
  // being clipped makes this particular response partial.
  const selectedNodeCount = selectedNodes.length;
  const selectedEdgeCount = selectedEdges.length;
  const outputTruncated = selectedNodeCount > JUDGMENT_GRAPH_MAX_NODES
    || selectedEdgeCount > JUDGMENT_GRAPH_MAX_EDGES;
  const limitations = [];
  if (malformedNodeCount > 0) limitations.push(`${malformedNodeCount} malformed graph node record(s) were excluded from focused matching.`);
  if (malformedEdgeCount > 0) limitations.push(`${malformedEdgeCount} malformed graph edge record(s) were excluded from focused matching.`);
  if (duplicateNodeIds.length > 0) limitations.push('Duplicate graph node IDs were found; the graph cannot establish a unique structure.');
  if (duplicateEdges.length > 0) limitations.push('Duplicate graph edges were found; edge completeness is uncertain.');
  if (danglingEdges.length > 0) limitations.push(`${danglingEdges.length} graph edge(s) reference a missing node.`);
  if (requestedFiles.length > 0 && unmatchedFiles.length > 0) {
    limitations.push('No matching graph node was found for one or more requested files; an empty match does not establish absence or no impact.');
  }
  if (requestedFiles.length > 0 && matchedFiles.size === 0) {
    limitations.push('The focused query matched no graph node; broader graph evidence or source/runtime checks are required.');
  }
  if (rawNodes.length === 0 && rawEdges.length === 0) {
    limitations.push('The graph contains no node or edge records; empty coverage does not establish absence.');
  }
  if (outputTruncated) {
    limitations.push(`Graph records are bounded to ${JUDGMENT_GRAPH_MAX_NODES} nodes and ${JUDGMENT_GRAPH_MAX_EDGES} edges.`);
  }

  return {
    selection: requestedFiles.length === 0 ? 'overview' : 'focused_neighbors',
    requestedFiles,
    matchedFiles: [...matchedFiles].sort(),
    unmatchedFiles,
    nodeCount: rawNodes.length,
    edgeCount: rawEdges.length,
    validNodeCount: nodeRecords.length,
    validEdgeCount: edgeRecords.length,
    malformedNodeCount,
    malformedEdgeCount,
    duplicateNodeIds,
    duplicateEdges,
    danglingEdges,
    selectedNodeCount,
    selectedEdgeCount,
    selectedNodes: selectedNodes.slice(0, JUDGMENT_GRAPH_MAX_NODES),
    selectedEdges: selectedEdges.slice(0, JUDGMENT_GRAPH_MAX_EDGES),
    outputTruncated,
    limitations
  };
}

function collectFocusedNodeIds(edges, matchedNodeIds) {
  const selected = new Set(matchedNodeIds);
  for (const edge of edges) {
    for (const endpoint of ['source', 'target']) {
      const value = getEdgeEndpoint(edge, endpoint);
      if (validIdentifier(value)) selected.add(identifierKey(value));
    }
  }
  return selected;
}

function boundedGraphRecord(record) {
  if (!isObjectRecord(record)) {
    const bounded = boundValue(record);
    return { value: { malformed: true, value: bounded.value }, truncated: true };
  }
  const keys = Object.keys(record);
  const priority = [
    'id', 'source', 'target', 'from', 'to', '_src', '_dst', 'source_id', 'target_id',
    'relation', 'type', 'kind', 'source_file', 'sourceFile', 'file', 'path',
    'label', 'name', 'community', 'confidence'
  ];
  const allOrderedKeys = [...new Set([
    ...priority.filter((key) => keys.includes(key)),
    ...keys
  ])];
  const orderedKeys = allOrderedKeys.slice(0, 64);
  let truncated = allOrderedKeys.length > orderedKeys.length;
  const boundedRecord = Object.fromEntries(orderedKeys.map((key) => {
    const boundedName = boundedKey(key);
    const boundedValueResult = boundValue(record[key]);
    truncated ||= boundedName.truncated || boundedValueResult.truncated;
    return [boundedName.value, boundedValueResult.value];
  }));
  return { value: boundedRecord, truncated };
}

function boundedStringList(values, maxItems = 60) {
  let truncated = values.length > maxItems;
  const bounded = values.slice(0, maxItems).map((value) => {
    const boundedValue = boundText(String(value), 512);
    truncated ||= boundedValue.truncated;
    return boundedValue.value;
  });
  if (values.length > maxItems) {
    bounded.push(`[${values.length - maxItems} additional values omitted]`);
  }
  return { value: bounded, truncated };
}

function boundValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return { value, truncated: false };
  }
  if (typeof value === 'string') {
    return boundText(value, 2048);
  }
  if (depth >= 2) return { value: '[nested value omitted]', truncated: true };
  if (Array.isArray(value)) {
    const items = value.slice(0, 16).map((item) => boundValue(item, depth + 1));
    return {
      value: items.map((item) => item.value),
      truncated: value.length > 16 || items.some((item) => item.truncated)
    };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 32);
    let truncated = Object.keys(value).length > 32;
    const boundedObject = Object.fromEntries(entries.map(([key, item]) => {
      const boundedName = boundedKey(key);
      const boundedItem = boundValue(item, depth + 1);
      truncated ||= boundedName.truncated || boundedItem.truncated;
      return [boundedName.value, boundedItem.value];
    }));
    return { value: boundedObject, truncated };
  }
  return { value: String(value), truncated: false };
}

function boundedKey(key) {
  const text = String(key);
  return { value: text.length <= 128 ? text : `${text.slice(0, 128)}...[truncated]`, truncated: text.length > 128 };
}

function boundText(value, maxCharacters) {
  if (value.length <= maxCharacters) return { value, truncated: false };
  return { value: `${value.slice(0, maxCharacters)}...[truncated]`, truncated: true };
}

function stringifyGraphPayload(payload) {
  let candidate = payload;
  let text = JSON.stringify(candidate, null, 2);
  if (Buffer.byteLength(text, 'utf8') <= JUDGMENT_GRAPH_OUTPUT_MAX_BYTES) {
    return { text, truncated: false };
  }

  candidate = {
    ...payload,
    status: 'partial',
    nodes: payload.nodes.slice(0, Math.min(20, payload.nodes.length)),
    edges: payload.edges.slice(0, Math.min(40, payload.edges.length)),
    graph_integrity: compactGraphIntegrity(payload.graph_integrity, true),
    limitations: [...payload.limitations, `Graph evidence output is capped at ${JUDGMENT_GRAPH_OUTPUT_MAX_BYTES} bytes.`]
  };
  text = JSON.stringify(candidate, null, 2);
  if (Buffer.byteLength(text, 'utf8') <= JUDGMENT_GRAPH_OUTPUT_MAX_BYTES) {
    return { text, truncated: true };
  }

  candidate = minimalGraphPayload(payload);
  text = JSON.stringify(candidate);
  if (Buffer.byteLength(text, 'utf8') <= JUDGMENT_GRAPH_OUTPUT_MAX_BYTES) {
    return { text, truncated: true };
  }

  // This emergency shape contains only fixed strings and scalar counts, so it
  // remains within the cap even if an untrusted graph path or metadata is huge.
  const emergency = {
    provider: 'graphify',
    status: 'partial',
    node_count: Number(payload.node_count) || 0,
    edge_count: Number(payload.edge_count) || 0,
    omitted: true
  };
  return { text: JSON.stringify(emergency), truncated: true };
}

function compactGraphIntegrity(integrity, outputTruncated) {
  return {
    malformed_nodes: Number(integrity?.malformed_nodes) || 0,
    malformed_edges: Number(integrity?.malformed_edges) || 0,
    duplicate_node_ids: compactList(integrity?.duplicate_node_ids),
    duplicate_edges: compactList(integrity?.duplicate_edges),
    dangling_edges: compactList(integrity?.dangling_edges),
    output_truncated: Boolean(outputTruncated || integrity?.output_truncated)
  };
}

function compactList(value, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  const result = value.slice(0, maxItems).map((item) => trimUtf8(String(item), 256));
  if (value.length > maxItems) result.push(`[${value.length - maxItems} additional values omitted]`);
  return result;
}

function minimalGraphPayload(payload) {
  return {
    provider: 'graphify',
    status: 'partial',
    graph_path: trimUtf8(String(payload.graph_path ?? ''), 512),
    selection: String(payload.selection ?? 'unknown'),
    node_count: Number(payload.node_count) || 0,
    edge_count: Number(payload.edge_count) || 0,
    selected_node_count: Number(payload.selected_node_count) || 0,
    selected_edge_count: Number(payload.selected_edge_count) || 0,
    counts: {
      nodes: Number(payload.counts?.nodes) || 0,
      edges: Number(payload.counts?.edges) || 0,
      valid_nodes: Number(payload.counts?.valid_nodes) || 0,
      valid_edges: Number(payload.counts?.valid_edges) || 0,
      selected_nodes: Number(payload.counts?.selected_nodes) || 0,
      selected_edges: Number(payload.counts?.selected_edges) || 0
    },
    graph_integrity: compactGraphIntegrity(payload.graph_integrity, true),
    freshness: 'unknown',
    runtime_confirmation: 'not_confirmed',
    omitted: {
      nodes: true,
      edges: true,
      metadata: true
    },
    limitations: [
      `Graph evidence output is capped at ${JUDGMENT_GRAPH_OUTPUT_MAX_BYTES} bytes.`,
      'Graph records and metadata were omitted after the bounded output cap was reached.'
    ]
  };
}

async function readSourcePrefix(filePath, maxBytes) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    let offset = 0;
    while (offset < maxBytes) {
      const result = await handle.read(buffer, offset, maxBytes - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}

function splitSourceLines(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

function renderSourceExcerpt(lines, startLine, endLine) {
  let content = '';
  let includedStart = null;
  let includedEnd = null;
  let truncated = false;
  let lineCount = 0;
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    if (lineCount >= JUDGMENT_SOURCE_MAX_LINES) {
      truncated = true;
      break;
    }
    const line = `${lineNumber}: ${lines[lineNumber - 1]}`;
    const separator = content === '' ? '' : '\n';
    const remaining = JUDGMENT_SOURCE_OUTPUT_MAX_BYTES - Buffer.byteLength(content, 'utf8')
      - Buffer.byteLength(separator, 'utf8');
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const boundedLine = trimUtf8(line, remaining);
    content += `${separator}${boundedLine}`;
    includedStart ??= lineNumber;
    includedEnd = lineNumber;
    lineCount += 1;
    if (boundedLine !== line) {
      truncated = true;
      break;
    }
  }
  return {
    content,
    startLine: includedStart ?? startLine,
    endLine: includedEnd ?? startLine,
    truncated
  };
}

function trimUtf8(value, maxBytes) {
  if (maxBytes <= 0) return '';
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const marker = '...[truncated]';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  if (maxBytes <= markerBytes) {
    // The marker is ASCII, so slicing the string cannot create a partial
    // multibyte code point or exceed the byte budget.
    return marker.slice(0, maxBytes);
  }
  const prefixBytes = maxBytes - markerBytes;
  const encoded = Buffer.from(value, 'utf8');
  let prefix = encoded.subarray(0, prefixBytes).toString('utf8');
  while (Buffer.byteLength(prefix, 'utf8') > prefixBytes && prefix.length > 0) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix}${marker}`;
}

function uniqueNormalizedFiles(files) {
  return [...new Set(files.map((file) => normalizeGraphPath(file.trim())).filter(Boolean))].sort();
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validIdentifier(value) {
  return (typeof value === 'string' && value.trim() !== '') || typeof value === 'number';
}

function identifierKey(value) {
  return String(value);
}

function pathRemainsWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function graphReadFailure(error, subject) {
  if (error?.code === 'ENOENT') return `${subject} was not found.`;
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return `${subject} could not be read due to permissions.`;
  if (error instanceof SyntaxError) return `${subject} is malformed JSON.`;
  return `${subject} could not be read.`;
}

function sourceReadFailure(error, subject) {
  if (error?.code === 'ENOENT') return `${subject} was not found.`;
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return `${subject} could not be read due to permissions.`;
  return `${subject} could not be read.`;
}
