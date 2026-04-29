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
const IGNORED_FILES = new Set(['.gitignore', '.vibeproignore']);
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.env',
  '.htm',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.md',
  '.py',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml'
]);
const STATIC_EXTENSIONS = new Set([
  '.css',
  '.gif',
  '.htm',
  '.html',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.map',
  '.md',
  '.mjs',
  '.png',
  '.svg',
  '.ttf',
  '.txt',
  '.webp',
  '.woff',
  '.woff2'
]);
const SECRET_PATTERNS = [
  {
    kind: 'secret_keyword',
    pattern: /\b(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|secret[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_\-.]{8,})/i
  },
  {
    kind: 'openai_key_like',
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/
  }
];
const XSS_PATTERNS = [
  { kind: 'inner_html_assignment', pattern: /\.innerHTML\s*=/ },
  { kind: 'eval_call', pattern: /\beval\s*\(/ },
  { kind: 'new_function', pattern: /\bnew\s+Function\s*\(/ },
  { kind: 'document_write', pattern: /\bdocument\.write\s*\(/ }
];
const EXTERNAL_RESOURCE_PATTERN =
  /<(script|link|iframe)\b[^>]*(?:src|href)=["'](https?:\/\/[^"']+)["'][^>]*>/gi;

export async function scanStaticSite(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = await collectFiles(root);
  const result = {
    has_index_html: files.some((file) => file.relativePath === 'index.html'),
    scanned_files: files.length,
    secret_hits: [],
    xss_risk_hits: [],
    external_resources: [],
    non_static_files: []
  };

  for (const file of files) {
    const ext = path.extname(file.relativePath).toLowerCase();
    if (!STATIC_EXTENSIONS.has(ext)) {
      result.non_static_files.push({ file: file.relativePath, extension: ext || '(none)' });
    }

    if (!TEXT_EXTENSIONS.has(ext) && !isEnvFile(file.relativePath)) continue;

    const content = await readFile(file.absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      collectSecretHits(result.secret_hits, file.relativePath, index + 1, line);
      collectXssHits(result.xss_risk_hits, file.relativePath, index + 1, line);
      collectExternalResources(result.external_resources, file.relativePath, index + 1, line);
    }
  }

  return result;
}

async function collectFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isFile() && IGNORED_FILES.has(entry.name)) continue;
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, absolutePath));
      continue;
    }

    if (!entry.isFile()) continue;
    const fileStat = await stat(absolutePath);
    if (fileStat.size > 1024 * 1024) continue;
    files.push({ absolutePath, relativePath });
  }

  return files;
}

function collectSecretHits(hits, file, lineNumber, line) {
  if (isEnvFile(file) && line.trim() && !line.trim().startsWith('#')) {
    hits.push({
      file,
      line: lineNumber,
      kind: 'env_file_value',
      excerpt: maskSensitiveLine(line)
    });
    return;
  }

  for (const { kind, pattern } of SECRET_PATTERNS) {
    if (!pattern.test(line)) continue;
    hits.push({
      file,
      line: lineNumber,
      kind,
      excerpt: maskSensitiveLine(line)
    });
    pattern.lastIndex = 0;
    return;
  }
}

function isEnvFile(file) {
  const basename = path.basename(file);
  return basename === '.env' || basename.startsWith('.env.');
}

function collectXssHits(hits, file, lineNumber, line) {
  for (const { kind, pattern } of XSS_PATTERNS) {
    if (!pattern.test(line)) continue;
    hits.push({
      file,
      line: lineNumber,
      kind,
      excerpt: line.trim().slice(0, 160)
    });
  }
}

function collectExternalResources(resources, file, lineNumber, line) {
  EXTERNAL_RESOURCE_PATTERN.lastIndex = 0;
  let match = EXTERNAL_RESOURCE_PATTERN.exec(line);
  while (match) {
    resources.push({
      file,
      line: lineNumber,
      tag: match[1].toLowerCase(),
      url: match[2]
    });
    match = EXTERNAL_RESOURCE_PATTERN.exec(line);
  }
}

function maskSensitiveLine(line) {
  return line
    .trim()
    .replace(/sk-[A-Za-z0-9]{20,}/g, (value) => `${value.slice(0, 6)}...${value.slice(-4)}`)
    .replace(/(["']?)([A-Za-z0-9_\-.]{12,})(["']?)/g, (_match, prefix, value, suffix) => {
      if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return `${prefix}${value}${suffix}`;
      return `${prefix}${value.slice(0, 4)}...${value.slice(-4)}${suffix}`;
    });
}
