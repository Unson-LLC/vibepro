const MIN_CLUSTER_SIZE = 2;
const HIGH_CONFIDENCE_THRESHOLD = 8;
const MEDIUM_CONFIDENCE_THRESHOLD = 4;
const CLUSTER_DEPTH_LEVELS = [4, 2];

export function generateStoryCandidates(coverage) {
  const uncovered = Array.isArray(coverage?.uncovered) ? coverage.uncovered : [];
  if (uncovered.length === 0) return [];

  const byRole = groupBy(uncovered, (item) => item.role || 'unknown');
  const candidates = [];
  const seenIds = new Set();

  for (const [role, items] of Object.entries(byRole)) {
    for (const depth of CLUSTER_DEPTH_LEVELS) {
      const clusters = clusterByCommonPath(items, depth);
      for (const cluster of clusters) {
        if (cluster.paths.length < MIN_CLUSTER_SIZE) continue;
        const candidate = buildCandidate(role, cluster);
        if (seenIds.has(candidate.candidate_id)) continue;
        seenIds.add(candidate.candidate_id);
        candidates.push(candidate);
      }
    }
  }

  return candidates.sort((a, b) => b.file_count - a.file_count || a.candidate_id.localeCompare(b.candidate_id));
}

function clusterByCommonPath(items, depth) {
  const buckets = new Map();
  for (const item of items) {
    const segments = item.path.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    const dirSegments = segments.slice(0, -1);
    const prefix = dirSegments.length === 0
      ? segments[0]
      : dirSegments.slice(0, depth).join('/');
    if (!buckets.has(prefix)) buckets.set(prefix, { common_path: prefix, paths: [] });
    buckets.get(prefix).paths.push(item.path);
  }
  return [...buckets.values()];
}

function buildCandidate(role, cluster) {
  const slug = slugifyPath(cluster.common_path);
  const fileCount = cluster.paths.length;
  const confidence = inferConfidence(fileCount);
  return {
    candidate_id: `candidate-${role}-${slug}`,
    role,
    common_path: cluster.common_path,
    paths: cluster.paths.slice(0, 12),
    file_count: fileCount,
    confidence,
    evidence: cluster.paths.slice(0, 5),
    open_questions: [
      '対応する Story / Spec が既に存在するか確認',
      'この粒度で新規 Story 化するか、既存 Story へ吸収するか判断'
    ],
    suggested_story_titles: [
      `${cluster.common_path} の責務を Story 化する`
    ]
  };
}

function inferConfidence(fileCount) {
  if (fileCount >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  if (fileCount >= MEDIUM_CONFIDENCE_THRESHOLD) return 'medium';
  return 'low';
}

function slugifyPath(commonPath) {
  return commonPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function groupBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}
