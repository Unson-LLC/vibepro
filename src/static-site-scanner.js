import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
  { kind: 'eval_call', pattern: /(?<![\w$])eval\s*\(/ },
  { kind: 'new_function', pattern: /\bnew\s+Function\s*\(/ },
  { kind: 'document_write', pattern: /\bdocument\.write\s*\(/ }
];
const EXTERNAL_RESOURCE_PATTERN =
  /<(script|link|iframe)\b[^>]*(?:src|href)=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
const GATE_EFFECTS = ['block', 'review', 'info'];

export async function scanStaticSite(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = await filterGitIgnoredFiles(root, await collectFiles(root));
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

  result.risk_summary = {
    secret_hits: summarizeGateEffects(result.secret_hits),
    xss_risk_hits: summarizeGateEffects(result.xss_risk_hits)
  };
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

async function filterGitIgnoredFiles(root, files) {
  if (files.length === 0) return files;

  try {
    const ignored = new Set();
    for (let index = 0; index < files.length; index += 200) {
      const chunk = files.slice(index, index + 200).map((file) => file.relativePath);
      try {
        const { stdout } = await execFileAsync('git', ['check-ignore', ...chunk], {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024
        });
        for (const file of stdout.split(/\r?\n/).filter(Boolean)) {
          ignored.add(file);
        }
      } catch (error) {
        if (error.code !== 1) throw error;
      }
    }
    return files.filter((file) => !ignored.has(file.relativePath));
  } catch (error) {
    return files;
  }
}

function collectSecretHits(hits, file, lineNumber, line) {
  if (isEnvFile(file) && line.trim() && !line.trim().startsWith('#')) {
    const risk = classifySecretRisk(file, line, 'env_file_value');
    hits.push({
      file,
      line: lineNumber,
      kind: 'env_file_value',
      excerpt: maskSensitiveLine(line),
      ...risk
    });
    return;
  }

  for (const { kind, pattern } of SECRET_PATTERNS) {
    if (!pattern.test(line)) continue;
    const risk = classifySecretRisk(file, line, kind);
    hits.push({
      file,
      line: lineNumber,
      kind,
      excerpt: maskSensitiveLine(line),
      ...risk
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
    const risk = classifyXssRisk(file, line, kind);
    hits.push({
      file,
      line: lineNumber,
      kind,
      excerpt: line.trim().slice(0, 160),
      ...risk
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

function classifySecretRisk(file, line, kind) {
  const sourceKind = classifySourceKind(file);
  if (sourceKind !== 'runtime_code') {
    return { source_kind: sourceKind, confidence: 'low', gate_effect: 'info' };
  }
  if (isPlaceholderSecret(line) || isEnvironmentReference(line) || isSecretReferenceOnly(line, kind)) {
    return { source_kind: sourceKind, confidence: 'low', gate_effect: 'info' };
  }
  if (kind === 'env_file_value' || kind === 'openai_key_like' || /\bsk-[A-Za-z0-9]{20,}\b/.test(line)) {
    return { source_kind: sourceKind, confidence: 'high', gate_effect: 'block' };
  }
  return { source_kind: sourceKind, confidence: 'medium', gate_effect: 'review' };
}

function classifyXssRisk(file, line, kind) {
  const sourceKind = classifySourceKind(file);
  if (sourceKind !== 'runtime_code') {
    return { source_kind: sourceKind, confidence: 'low', gate_effect: 'info' };
  }
  if (kind === 'inner_html_assignment' && /DOMPurify\.sanitize|sanitize\(/.test(line)) {
    return { source_kind: sourceKind, confidence: 'low', gate_effect: 'info' };
  }
  return { source_kind: sourceKind, confidence: 'medium', gate_effect: 'review' };
}

function classifySourceKind(file) {
  const normalized = file.toLowerCase();
  const basename = path.basename(normalized);
  if (normalized.startsWith('.claude/')) return 'agent_skill';
  if (basename === '.env.example' || basename === '.env.sample' || basename === '.env.template') return 'example';
  if (normalized.startsWith('docs/') || normalized.endsWith('.md')) return 'docs';
  if (/(^|\/)(__tests__|tests?|spec|fixtures?)(\/|$)/.test(normalized)
    || /\.(test|spec)\.(js|jsx|ts|tsx)$/.test(normalized)) {
    return 'test';
  }
  if (/(^|\/)(examples?|samples?)(\/|$)/.test(normalized)) return 'example';
  return 'runtime_code';
}

function isPlaceholderSecret(line) {
  return /\b(example|dummy|placeholder|your[_-]?|xxxx|xxxxx|test[_-]?key)\b/i.test(line)
    || /[xX]{8,}/.test(line)
    || /<[^>]*(key|token|secret)[^>]*>/i.test(line);
}

function isEnvironmentReference(line) {
  return /\bprocess\.env\b|\bos\.environ\b|\bos\.getenv\s*\(|\benv\.[A-Z0-9_]+\b/i.test(line);
}

function isSecretReferenceOnly(line, kind) {
  if (kind !== 'secret_keyword') return false;
  const match = /\b(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|secret[_-]?key)\b\s*[:=]\s*([^,;\n)\]}]+)/i.exec(line);
  if (!match) return false;
  const value = match[2].trim();
  if (!value) return true;
  if (/^['"`]/.test(value)) return false;
  if (/^(request|req|body|params|headers|cookies|formData)\b/i.test(value)) return true;
  if (/^[A-Za-z_$][\w$]*\s*\($/.test(value)) return true;
  if (!/^[A-Za-z_$][\w$]*(?:[.?!][A-Za-z_$][\w$]*)*(?:\s*\(|\s*$|[.?!,\]])/.test(value)) return false;
  return /[.?!]/.test(value)
    || /\b[A-Za-z]+(?:Key|Token|Secret)\b/.test(value)
    || /(?:^|_)(api_key|api_secret|access_token|auth_token|secret_key)(?:_|$)/i.test(value);
}

function summarizeGateEffects(hits) {
  const summary = Object.fromEntries(GATE_EFFECTS.map((effect) => [effect, 0]));
  for (const hit of hits) {
    const effect = GATE_EFFECTS.includes(hit.gate_effect) ? hit.gate_effect : 'info';
    summary[effect] += 1;
  }
  return summary;
}
