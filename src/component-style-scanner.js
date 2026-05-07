import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vibepro',
  'coverage',
  'dist',
  'node_modules',
  'graphify-out'
]);
const TEXT_EXTENSIONS = new Set(['.css', '.htm', '.html', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const UI_ROOT_PATTERN = /^(app|components|pages|public|src|styles)\//;
const COMPONENT_PATTERNS = [
  { kind: 'button', pattern: /\b(button|btn|primary-button|secondary-button|action-button|terminal-action)\b/i },
  { kind: 'tab', pattern: /\b(tab|tabs|segmented|toggle-group)\b/i },
  { kind: 'card', pattern: /\b(card|panel|tile|item-card)\b/i },
  { kind: 'list_item', pattern: /\b(row|list-item|task-item|session-item|item-row)\b/i },
  { kind: 'filter', pattern: /\b(filter|search|query|sort|select)\b/i },
  { kind: 'badge', pattern: /\b(badge|pill|chip|tag|status)\b/i },
  { kind: 'input', pattern: /\b(input|textarea|select|field)\b/i },
  { kind: 'modal', pattern: /\b(modal|dialog|popover|drawer|sheet)\b/i },
  { kind: 'sidebar', pattern: /\b(sidebar|nav|navigation|activity-bar)\b/i }
];
const LEGACY_STYLE_TOKENS = [
  { token: '#0f172a', kind: 'tailwind_slate_background' },
  { token: '#1e293b', kind: 'tailwind_slate_surface' },
  { token: '#334155', kind: 'tailwind_slate_border' },
  { token: '#475569', kind: 'tailwind_slate_muted' },
  { token: '#64748b', kind: 'tailwind_slate_muted' },
  { token: '#ef4444', kind: 'default_red_accent' },
  { token: 'rgb(239, 68, 68)', kind: 'default_red_accent' },
  { token: 'rgba(239, 68, 68', kind: 'default_red_accent' },
  { token: 'border-radius: 16px', kind: 'large_rounded_card' },
  { token: 'border-radius: 20px', kind: 'large_rounded_card' },
  { token: 'border-radius: 24px', kind: 'large_rounded_card' },
  { token: 'box-shadow: 0 20px', kind: 'heavy_drop_shadow' },
  { token: 'box-shadow: 0 24px', kind: 'heavy_drop_shadow' },
  { token: 'box-shadow: 0 32px', kind: 'heavy_drop_shadow' }
];
const DESIGN_SYSTEM_MARKERS = [
  '--bb-',
  '--vibepro-component',
  'data-component',
  'component-style',
  'design-token'
];

export async function scanComponentStyle(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = await collectFiles(root);
  const result = {
    schema_version: '0.1.0',
    scanned_files: files.length,
    component_inventory: [],
    component_kinds: [],
    legacy_style_hits: [],
    design_system_markers: [],
    risk_summary: {
      legacy_style_hits: { block: 0, review: 0, info: 0 }
    },
    coverage: {
      observed_component_kinds: [],
      missing_component_kinds: [],
      replacement_observable: false
    }
  };

  for (const file of files) {
    const content = await readFile(file.absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      collectComponentInventory(result.component_inventory, file.relativePath, index + 1, line);
      collectLegacyStyleHits(result.legacy_style_hits, file.relativePath, index + 1, line);
      collectDesignSystemMarkers(result.design_system_markers, file.relativePath, index + 1, line);
    }
  }

  result.component_kinds = [...new Set(result.component_inventory.map((item) => item.kind))].sort();
  result.coverage.observed_component_kinds = result.component_kinds;
  result.coverage.replacement_observable = result.design_system_markers.length > 0;
  result.coverage.missing_component_kinds = inferMissingComponentKinds(result.component_kinds);
  result.risk_summary.legacy_style_hits = summarizeGateEffects(result.legacy_style_hits);
  return result;
}

async function collectFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, absolutePath));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!shouldScanFile(relativePath)) continue;
    const fileStat = await stat(absolutePath);
    if (fileStat.size > 1024 * 1024) continue;
    files.push({ absolutePath, relativePath });
  }

  return files;
}

function shouldScanFile(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return false;
  if (!UI_ROOT_PATTERN.test(relativePath) && relativePath.includes('/')) return false;
  return !relativePath.endsWith('.test.js')
    && !relativePath.endsWith('.test.jsx')
    && !relativePath.endsWith('.test.ts')
    && !relativePath.endsWith('.test.tsx');
}

function collectComponentInventory(inventory, file, lineNumber, line) {
  const excerpt = line.trim();
  if (!excerpt) return;
  for (const { kind, pattern } of COMPONENT_PATTERNS) {
    if (!pattern.test(line)) continue;
    inventory.push({
      file,
      line: lineNumber,
      kind,
      excerpt: excerpt.slice(0, 160)
    });
    return;
  }
}

function collectLegacyStyleHits(hits, file, lineNumber, line) {
  const normalized = line.toLowerCase();
  for (const { token, kind } of LEGACY_STYLE_TOKENS) {
    if (!normalized.includes(token.toLowerCase())) continue;
    hits.push({
      file,
      line: lineNumber,
      kind,
      token,
      excerpt: line.trim().slice(0, 160),
      confidence: classifyLegacyConfidence(file, line),
      gate_effect: 'review'
    });
    return;
  }
}

function collectDesignSystemMarkers(markers, file, lineNumber, line) {
  const marker = DESIGN_SYSTEM_MARKERS.find((candidate) => line.includes(candidate));
  if (!marker) return;
  markers.push({
    file,
    line: lineNumber,
    marker,
    excerpt: line.trim().slice(0, 160)
  });
}

function classifyLegacyConfidence(file, line) {
  if (/\/\*|\/\/|example|sample/i.test(line) || file.includes('/fixtures/')) return 'low';
  if (path.extname(file).toLowerCase() === '.css') return 'high';
  return 'medium';
}

function inferMissingComponentKinds(componentKinds) {
  const observed = new Set(componentKinds);
  const requiredWhenUiExists = ['button', 'card', 'input'];
  if (observed.size === 0) return [];
  return requiredWhenUiExists.filter((kind) => !observed.has(kind));
}

function summarizeGateEffects(hits) {
  const summary = { block: 0, review: 0, info: 0 };
  for (const hit of hits) {
    if (hit.gate_effect === 'block') summary.block += 1;
    else if (hit.gate_effect === 'review') summary.review += 1;
    else summary.info += 1;
  }
  return summary;
}
