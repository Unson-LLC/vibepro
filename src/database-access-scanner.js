import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vibepro',
  'coverage',
  'node_modules',
  'graphify-out'
]);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const GATE_EFFECTS = ['block', 'review', 'info'];

export async function scanDatabaseAccess(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = await collectFiles(root);
  const result = {
    scanned_files: files.length,
    unbounded_find_many: []
  };

  for (const file of files) {
    const content = await readFile(file.absolutePath, 'utf8');
    collectUnboundedFindMany(result.unbounded_find_many, file.relativePath, content);
  }

  result.risk_summary = {
    unbounded_find_many: summarizeGateEffects(result.unbounded_find_many)
  };
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
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const fileStat = await stat(absolutePath);
    if (fileStat.size > 1024 * 1024) continue;
    files.push({ absolutePath, relativePath });
  }

  return files;
}

function collectUnboundedFindMany(hits, file, content) {
  const code = stripComments(content);
  const pattern = /\b(?:prisma|db|client|prismaAny)\.[A-Za-z_$][\w$]*\.findMany\s*\(/g;
  let match = pattern.exec(code);
  while (match) {
    const call = extractCall(code, match.index);
    if (call && !hasResultBound(call.text)) {
      hits.push({
        file,
        line: lineNumberAt(code, match.index),
        kind: 'prisma_find_many_without_bound',
        excerpt: firstLine(call.text).slice(0, 160),
        ...classifyDatabaseRisk(file)
      });
    }
    pattern.lastIndex = call ? call.end : match.index + match[0].length;
    match = pattern.exec(code);
  }
}

function hasResultBound(callText) {
  return /\b(take|skip|cursor|distinct)\s*:/.test(callText)
    || /\b(limit|pageSize|maxResults|maxCount)\b/.test(callText);
}

function classifyDatabaseRisk(file) {
  const sourceKind = classifySourceKind(file);
  if (sourceKind !== 'runtime_code') {
    return { source_kind: sourceKind, confidence: 'low', gate_effect: 'info' };
  }
  if (file.startsWith('src/app/') || file.startsWith('src/lib/services/')) {
    return { source_kind: sourceKind, confidence: 'medium', gate_effect: 'review' };
  }
  return { source_kind: sourceKind, confidence: 'low', gate_effect: 'info' };
}

function classifySourceKind(file) {
  const normalized = file.toLowerCase();
  if (normalized.startsWith('scripts/') || normalized.includes('/crawlers/')) return 'batch_or_tooling';
  if (/(^|\/)(__tests__|tests?|spec|fixtures?)(\/|$)/.test(normalized)
    || /\.(test|spec)\.(js|jsx|ts|tsx)$/.test(normalized)) {
    return 'test';
  }
  if (normalized.startsWith('docs/') || normalized.endsWith('.md')) return 'docs';
  return 'runtime_code';
}

function extractCall(content, startIndex) {
  const openIndex = content.indexOf('(', startIndex);
  if (openIndex === -1) return null;
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          text: content.slice(startIndex, index + 1),
          end: index + 1
        };
      }
    }
  }
  return null;
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function firstLine(text) {
  return text.trim().split(/\r?\n/)[0].trim();
}

function summarizeGateEffects(hits) {
  const summary = Object.fromEntries(GATE_EFFECTS.map((effect) => [effect, 0]));
  for (const hit of hits) {
    if (summary[hit.gate_effect] !== undefined) summary[hit.gate_effect] += 1;
  }
  return summary;
}
