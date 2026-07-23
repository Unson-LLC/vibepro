import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const CONTENT_BINDING_MODEL = 'vibepro-content-scoped-evidence-freshness-v1';

export async function buildContentBinding(repoRoot, options = {}) {
  const mode = options.strictHead === true ? 'strict_head' : 'content_surface';
  const excludedPaths = new Set(arrayOf(options.excludeSurfacePaths)
    .map((ref) => normalizeSurfacePath(ref))
    .filter(Boolean));
  const refs = collectSurfaceRefs(options);
  const surfaceFiles = [];
  const missingFiles = [];
  for (const ref of refs) {
    const filePath = normalizeSurfacePath(ref);
    if (!filePath) continue;
    if (isInternalWorkspacePath(filePath)) continue;
    // A current rendered projection is a deterministic view, not an independent
    // review surface.  Its canonical source and renderer are already the
    // authority; binding its transient bytes would make a review stale when
    // recording or PR preparation deterministically re-renders that same view.
    if (excludedPaths.has(filePath)) continue;
    const snapshot = await snapshotFile(repoRoot, filePath);
    if (snapshot.missing) {
      missingFiles.push(filePath);
      continue;
    }
    if (!snapshot.file) continue;
    surfaceFiles.push(snapshot.file);
  }
  const dedupedFiles = dedupeSurfaceFiles(surfaceFiles);
  const dedupedMissing = [...new Set(missingFiles)].sort();
  if (mode === 'strict_head') {
    return {
      schema_version: '0.1.0',
      model: CONTENT_BINDING_MODEL,
      mode,
      status: 'strict_head',
      reason: 'strict HEAD binding was requested for this evidence',
      recorded_head_sha: options.gitContext?.head_sha ?? null,
      surface_files: dedupedFiles,
      missing_files: dedupedMissing,
      surface_hash: dedupedFiles.length > 0 ? hashSurface(dedupedFiles) : null
    };
  }
  return {
    schema_version: '0.1.0',
    model: CONTENT_BINDING_MODEL,
    mode,
    status: dedupedFiles.length > 0 ? 'recorded' : 'unbound',
    reason: dedupedFiles.length > 0
      ? `content surface recorded for ${dedupedFiles.length} file(s)`
      : 'no content surface file could be derived from evidence targets, artifacts, or inspection inputs',
    recorded_head_sha: options.gitContext?.head_sha ?? null,
    surface_files: dedupedFiles,
    missing_files: dedupedMissing,
    surface_hash: dedupedFiles.length > 0 ? hashSurface(dedupedFiles) : null
  };
}

export async function evaluateContentBinding(repoRoot, binding, currentGitContext = {}) {
  if (!binding || binding.model !== CONTENT_BINDING_MODEL) return null;
  if (binding.mode === 'strict_head') {
    return {
      status: 'strict_head',
      reason: 'strict HEAD binding requires the recorded git head to match the current git head',
      content_binding: summarizeContentBinding(binding, null, currentGitContext)
    };
  }
  const recordedFiles = Array.isArray(binding.surface_files) ? binding.surface_files : [];
  if (recordedFiles.length === 0 || !binding.surface_hash) {
    return {
      status: 'unbound',
      reason: binding.reason ?? 'content binding has no recorded surface files',
      content_binding: summarizeContentBinding(binding, null, currentGitContext)
    };
  }
  const currentFiles = [];
  const missingFiles = [];
  for (const file of recordedFiles) {
    const filePath = normalizeSurfacePath(file?.path);
    if (!filePath) continue;
    const snapshot = await snapshotFile(repoRoot, filePath);
    if (snapshot.missing) {
      missingFiles.push(filePath);
      continue;
    }
    if (snapshot.file) currentFiles.push(snapshot.file);
  }
  const currentHash = currentFiles.length > 0 ? hashSurface(dedupeSurfaceFiles(currentFiles)) : null;
  const changedFiles = compareSurfaceFiles(recordedFiles, currentFiles, missingFiles);
  const summary = summarizeContentBinding(binding, {
    current_hash: currentHash,
    changed_files: changedFiles,
    missing_files: missingFiles
  }, currentGitContext);
  if (missingFiles.length > 0) {
    return {
      status: 'stale',
      reason: `content-bound evidence surface is stale because file(s) are missing: ${missingFiles.slice(0, 6).join(', ')}`,
      content_binding: summary
    };
  }
  if (binding.surface_hash !== currentHash) {
    const suffix = changedFiles.length > 0 ? `: ${changedFiles.slice(0, 6).join(', ')}` : '';
    return {
      status: 'stale',
      reason: `content-bound evidence surface changed${suffix}`,
      content_binding: summary
    };
  }
  return {
    status: 'current',
    reason: `content-bound evidence surface is current for ${recordedFiles.length} file(s)`,
    content_binding: summary
  };
}

export function normalizeSurfacePath(ref) {
  const text = String(ref ?? '').trim();
  if (!text || /^https?:\/\//i.test(text)) return null;
  if (/^(git|npm|node|pnpm|yarn|bun|npx)\s/.test(text)) return null;
  const first = text.split(/\s+/)[0].replace(/^['"`]|['"`]$/g, '');
  const normalized = first
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/:\d+(?::\d+)?$/, '');
  if (!normalized || normalized.includes('*') || normalized.includes('...')) return null;
  if (path.isAbsolute(normalized)) return null;
  return path.posix.normalize(normalized);
}

function collectSurfaceRefs(options) {
  return [
    ...arrayOf(options.targets),
    ...arrayOf(options.artifacts),
    ...arrayOf(options.inspectionInputs)
  ].filter(Boolean);
}

function arrayOf(value) {
  if (!Array.isArray(value)) return value ? [value] : [];
  return value;
}

async function snapshotFile(repoRoot, filePath) {
  const absolute = path.resolve(repoRoot, filePath);
  const relative = normalizeSurfacePath(path.relative(repoRoot, absolute));
  if (!relative || relative.startsWith('..')) return { missing: true, file: null };
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return { missing: false, file: null };
    const content = await readFile(absolute);
    return {
      missing: false,
      file: {
        path: relative,
        sha256: createHash('sha256').update(content).digest('hex'),
        size: info.size
      }
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { missing: true, file: null };
    const wrapped = new Error(`cannot read content binding surface: ${filePath}`);
    wrapped.code = 'CONTENT_BINDING_READ_FAILED';
    wrapped.cause_code = error.code ?? 'UNKNOWN';
    throw wrapped;
  }
}

function dedupeSurfaceFiles(files) {
  const byPath = new Map();
  for (const file of files) {
    if (!file?.path || !file.sha256) continue;
    byPath.set(file.path, file);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function hashSurface(files) {
  const lines = files.map((file) => `${file.path}\0${file.sha256}\0${file.size}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function compareSurfaceFiles(recordedFiles, currentFiles, missingFiles) {
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const changed = [];
  for (const recorded of recordedFiles) {
    const current = currentByPath.get(recorded.path);
    if (!current) continue;
    if (recorded.sha256 !== current.sha256 || recorded.size !== current.size) {
      changed.push(recorded.path);
    }
  }
  return [...new Set([...changed, ...missingFiles])].sort();
}

function summarizeContentBinding(binding, evaluation, currentGitContext) {
  return {
    model: binding.model,
    mode: binding.mode ?? null,
    status: binding.status ?? null,
    recorded_head_sha: binding.recorded_head_sha ?? null,
    current_head_sha: currentGitContext?.head_sha ?? null,
    recorded_surface_hash: binding.surface_hash ?? null,
    current_surface_hash: evaluation?.current_hash ?? null,
    surface_files: (binding.surface_files ?? []).map((file) => file.path).filter(Boolean),
    missing_files: evaluation?.missing_files ?? binding.missing_files ?? [],
    changed_files: evaluation?.changed_files ?? []
  };
}

function isInternalWorkspacePath(filePath) {
  const normalized = String(filePath ?? '');
  return normalized !== '.vibepro/config.json' && normalized.startsWith('.vibepro/');
}
