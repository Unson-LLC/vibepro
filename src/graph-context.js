export function normalizeGraphEdges(graph) {
  if (Array.isArray(graph?.edges)) return { edges: graph.edges, sourceKey: 'edges' };
  if (Array.isArray(graph?.links)) return { edges: graph.links, sourceKey: 'links' };
  return { edges: [], sourceKey: null };
}

export function buildGraphIndex({ nodes = [], edges = [] } = {}) {
  const nodesById = new Map();
  const nodesBySourceFile = new Map();
  const degreeByNodeId = new Map();
  const edgesByNodeId = new Map();

  for (const node of nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string') continue;
    nodesById.set(node.id, node);
    const sourceFile = extractGraphNodeSourceFile(node);
    if (sourceFile) {
      const key = normalizeGraphPath(sourceFile);
      if (!nodesBySourceFile.has(key)) nodesBySourceFile.set(key, []);
      nodesBySourceFile.get(key).push(node);
    }
  }

  for (const edge of edges) {
    const source = getEdgeEndpoint(edge, 'source');
    const target = getEdgeEndpoint(edge, 'target');
    if (!source || !target) continue;
    degreeByNodeId.set(source, (degreeByNodeId.get(source) ?? 0) + 1);
    degreeByNodeId.set(target, (degreeByNodeId.get(target) ?? 0) + 1);
    if (!edgesByNodeId.has(source)) edgesByNodeId.set(source, []);
    if (!edgesByNodeId.has(target)) edgesByNodeId.set(target, []);
    edgesByNodeId.get(source).push(edge);
    edgesByNodeId.get(target).push(edge);
  }

  return {
    nodesById,
    nodesBySourceFile,
    degreeByNodeId,
    edgesByNodeId,
    edgeCount: edges.length
  };
}

export function buildGraphContextForRoutes(routes, graphIndex) {
  const context = buildGraphContextForFiles(routes.map((route) => route.file), graphIndex);
  return {
    ...context,
    matched_route_count: context.matched_file_count,
    affected_communities: context.affected_communities.map((community) => ({
      ...community,
      route_count: community.file_count ?? community.route_count ?? 0
    }))
  };
}

export function buildGraphContextForFiles(files, graphIndex) {
  const normalizedFiles = uniqueNormalizedGraphFiles(files);
  const empty = {
    ...emptyGraphContext(),
    target_file_count: normalizedFiles.length,
    matched_file_count: 0,
    matched_files: [],
    unmatched_files: normalizedFiles,
    related_files: [],
    community_span: 0,
    cross_community: false
  };
  if (!graphIndex || normalizedFiles.length === 0) return empty;

  const targetFiles = new Set(normalizedFiles);
  const matchedFiles = new Set();
  const matchedNodesById = new Map();
  const relatedEdges = new Set();

  for (const file of normalizedFiles) {
    const matchedNodes = graphIndex.nodesBySourceFile.get(file) ?? [];
    if (matchedNodes.length === 0) continue;
    matchedFiles.add(file);
    for (const node of matchedNodes) {
      matchedNodesById.set(node.id, node);
      for (const edge of graphIndex.edgesByNodeId.get(node.id) ?? []) {
        relatedEdges.add(edge);
      }
    }
  }

  if (matchedNodesById.size === 0) return empty;

  const touchedNodeIds = new Set(matchedNodesById.keys());
  for (const edge of relatedEdges) {
    const source = getEdgeEndpoint(edge, 'source');
    const target = getEdgeEndpoint(edge, 'target');
    if (source) touchedNodeIds.add(source);
    if (target) touchedNodeIds.add(target);
  }

  const affectedCommunities = buildAffectedCommunities({
    matchedNodes: [...matchedNodesById.values()],
    matchedRouteFiles: new Set(),
    matchedFiles,
    relatedEdges: [...relatedEdges],
    graphIndex
  });
  const affectedCommunityIds = new Set(affectedCommunities.map((community) => community.id));

  return {
    matched_route_count: 0,
    target_file_count: normalizedFiles.length,
    matched_file_count: matchedFiles.size,
    matched_files: [...matchedFiles].sort(),
    unmatched_files: normalizedFiles.filter((file) => !matchedFiles.has(file)),
    matched_node_count: matchedNodesById.size,
    affected_communities: affectedCommunities,
    hub_nodes: buildHubNodes({
      touchedNodeIds,
      matchedNodeIds: new Set(matchedNodesById.keys()),
      affectedCommunityIds,
      graphIndex
    }),
    related_files: buildRelatedGraphFiles({ touchedNodeIds, targetFiles, graphIndex }),
    related_edge_count: relatedEdges.size,
    impact_score: calculateImpactScore(relatedEdges.size, graphIndex.edgeCount),
    community_span: affectedCommunities.length,
    cross_community: affectedCommunities.length > 1
  };
}

export function emptyGraphContext() {
  return {
    matched_route_count: 0,
    target_file_count: 0,
    matched_file_count: 0,
    matched_files: [],
    unmatched_files: [],
    matched_node_count: 0,
    affected_communities: [],
    hub_nodes: [],
    related_files: [],
    related_edge_count: 0,
    impact_score: 0,
    community_span: 0,
    cross_community: false
  };
}

export function normalizeGraphPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniqueNormalizedGraphFiles(files) {
  return [...new Set((files ?? [])
    .map((file) => normalizeGraphPath(file ?? ''))
    .filter(Boolean))]
    .sort();
}

function buildAffectedCommunities({ matchedNodes, matchedRouteFiles, matchedFiles = matchedRouteFiles, relatedEdges, graphIndex }) {
  const communities = new Map();
  for (const node of matchedNodes) {
    const id = node.community ?? 'unknown';
    if (!communities.has(id)) {
      communities.set(id, {
        id,
        routeFiles: new Set(),
        files: new Set(),
        nodeIds: new Set(),
        edgeCount: 0
      });
    }
    const item = communities.get(id);
    const sourceFile = extractGraphNodeSourceFile(node);
    const normalizedSourceFile = sourceFile ? normalizeGraphPath(sourceFile) : null;
    if (normalizedSourceFile && matchedRouteFiles.has(normalizedSourceFile)) {
      item.routeFiles.add(normalizedSourceFile);
    }
    if (normalizedSourceFile && matchedFiles.has(normalizedSourceFile)) {
      item.files.add(normalizedSourceFile);
    }
    item.nodeIds.add(node.id);
  }

  for (const edge of relatedEdges) {
    const communityIds = new Set([
      graphIndex.nodesById.get(getEdgeEndpoint(edge, 'source'))?.community ?? null,
      graphIndex.nodesById.get(getEdgeEndpoint(edge, 'target'))?.community ?? null
    ].filter((id) => id !== null));
    for (const id of communityIds) {
      if (communities.has(id)) communities.get(id).edgeCount += 1;
    }
  }

  return [...communities.values()]
    .map((item) => ({
      id: item.id,
      route_count: item.routeFiles.size,
      file_count: item.files.size,
      node_count: item.nodeIds.size,
      edge_count: item.edgeCount
    }))
    .sort((a, b) => b.route_count - a.route_count || b.file_count - a.file_count || b.node_count - a.node_count || String(a.id).localeCompare(String(b.id)));
}

function buildHubNodes({ touchedNodeIds, matchedNodeIds, affectedCommunityIds, graphIndex }) {
  return [...touchedNodeIds]
    .map((id) => graphIndex.nodesById.get(id))
    .filter(Boolean)
    .filter((node) => isRelevantHubNode({ node, matchedNodeIds, affectedCommunityIds }))
    .map((node) => ({
      id: node.id,
      label: node.label ?? node.name ?? node.id,
      source_file: extractGraphNodeSourceFile(node) ?? null,
      community: node.community ?? null,
      degree: graphIndex.degreeByNodeId.get(node.id) ?? 0
    }))
    .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
    .slice(0, 5);
}

function isRelevantHubNode({ node, matchedNodeIds, affectedCommunityIds }) {
  if (matchedNodeIds.has(node.id)) return true;
  if (!affectedCommunityIds.has(node.community ?? 'unknown')) return false;
  const sourceFile = extractGraphNodeSourceFile(node);
  if (!sourceFile) return false;
  return normalizeGraphPath(sourceFile).startsWith('src/');
}

function buildRelatedGraphFiles({ touchedNodeIds, targetFiles, graphIndex }) {
  const related = new Map();
  for (const nodeId of touchedNodeIds) {
    const node = graphIndex.nodesById.get(nodeId);
    const sourceFile = node ? extractGraphNodeSourceFile(node) : null;
    const file = sourceFile ? normalizeGraphPath(sourceFile) : null;
    if (!file || targetFiles.has(file)) continue;
    const degree = graphIndex.degreeByNodeId.get(nodeId) ?? 0;
    related.set(file, Math.max(related.get(file) ?? 0, degree));
  }
  return [...related.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([file]) => file);
}

function calculateImpactScore(relatedEdgeCount, totalEdgeCount) {
  if (!totalEdgeCount) return 0;
  return Number(Math.min(1, relatedEdgeCount / totalEdgeCount).toFixed(4));
}

export function extractGraphNodeSourceFile(node) {
  return node.source_file
    ?? node.sourceFile
    ?? node.file
    ?? node.path
    ?? node.payload?.source_file
    ?? node.payload?.sourceFile
    ?? null;
}

export function getEdgeEndpoint(edge, endpoint) {
  if (!edge || typeof edge !== 'object') return null;
  if (endpoint === 'source') return edge.source ?? edge.from ?? edge._src ?? edge.source_id ?? edge.sourceId ?? null;
  return edge.target ?? edge.to ?? edge._dst ?? edge._tgt ?? edge.target_id ?? edge.targetId ?? null;
}
