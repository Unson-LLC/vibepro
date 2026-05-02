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

export async function scanCodeQuality(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = await collectFiles(root);
  const result = {
    scanned_files: files.length,
    authorization_order_risks: [],
    duplicate_query_shapes: [],
    responsibility_hotspots: []
  };
  const queryShapeOccurrences = new Map();

  for (const file of files) {
    const content = await readFile(file.absolutePath, 'utf8');
    const code = stripComments(content);
    collectAuthorizationOrderRisks(result.authorization_order_risks, file.relativePath, code);
    collectResponsibilityHotspots(result.responsibility_hotspots, file.relativePath, code);
    collectQueryShapes(queryShapeOccurrences, file.relativePath, code);
  }

  result.duplicate_query_shapes = buildDuplicateQueryShapes(queryShapeOccurrences);
  result.risk_summary = {
    authorization_order_risks: summarizeGateEffects(result.authorization_order_risks),
    duplicate_query_shapes: summarizeGateEffects(result.duplicate_query_shapes),
    responsibility_hotspots: summarizeGateEffects(result.responsibility_hotspots)
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

function collectAuthorizationOrderRisks(hits, file, code) {
  if (!isRuntimeCode(file)) return;
  const authorizationLine = findFirstLine(code, [
    /\b(status\s*:\s*403|Access denied|Forbidden|forbidden|not authorized|not_authorized)\b/gi,
    /\bNextResponse\.json\s*\([^)]*\{\s*status\s*:\s*403\s*\}/g,
    /\bResponse\.json\s*\([^)]*\{\s*status\s*:\s*403\s*\}/g
  ]);
  if (!authorizationLine) return;

  const bulkQueryPattern = /\b(?:prisma|db|client|prismaAny)\.[A-Za-z_$][\w$]*\.(findMany|count|aggregate|groupBy)\s*\(/g;
  let match = bulkQueryPattern.exec(code);
  while (match) {
    const queryLine = lineNumberAt(code, match.index);
    if (queryLine < authorizationLine) {
      const call = extractCall(code, match.index);
      hits.push({
        file,
        line: queryLine,
        kind: 'bulk_data_access_before_authorization_check',
        excerpt: firstLine(call?.text ?? match[0]).slice(0, 160),
        authorization_line: authorizationLine,
        source_kind: 'runtime_code',
        confidence: 'medium',
        gate_effect: 'review'
      });
    }
    match = bulkQueryPattern.exec(code);
  }
}

function collectResponsibilityHotspots(hits, file, code) {
  if (!isRuntimeCode(file)) return;
  const signals = detectResponsibilitySignals(file, code);
  const lineCount = code.split(/\r?\n/).length;
  const signalCount = Object.values(signals).filter(Boolean).length;
  const isHotspot = (lineCount >= 150 && signalCount >= 4) || (lineCount >= 300 && signalCount >= 3);
  if (!isHotspot) return;

  hits.push({
    file,
    line: 1,
    kind: 'mixed_responsibility_hotspot',
    line_count: lineCount,
    signals: Object.entries(signals).filter(([, active]) => active).map(([name]) => name),
    source_kind: 'runtime_code',
    confidence: signalCount >= 5 ? 'high' : 'medium',
    gate_effect: 'review'
  });
}

function collectQueryShapes(occurrences, file, code) {
  if (!isRuntimeCode(file)) return;
  const pattern = /\b(?:prisma|db|client|prismaAny)\.([A-Za-z_$][\w$]*)\.(findMany|findUnique|findFirst|count|create|update|deleteMany)\s*\(/g;
  let match = pattern.exec(code);
  while (match) {
    const call = extractCall(code, match.index);
    if (!call) {
      match = pattern.exec(code);
      continue;
    }
    const signature = buildQueryShapeSignature(match[1], match[2], call.text);
    if (!signature) {
      match = pattern.exec(code);
      continue;
    }
    const item = {
      file,
      line: lineNumberAt(code, match.index),
      excerpt: firstLine(call.text).slice(0, 160)
    };
    occurrences.set(signature, [...(occurrences.get(signature) ?? []), item]);
    pattern.lastIndex = call.end;
    match = pattern.exec(code);
  }
}

function buildDuplicateQueryShapes(occurrences) {
  const duplicates = [];
  for (const [signature, items] of occurrences.entries()) {
    const files = unique(items.map((item) => item.file));
    if (items.length < 3 && files.length < 2) continue;
    if (items.length < 2) continue;
    duplicates.push({
      signature,
      kind: 'duplicate_prisma_query_shape',
      occurrence_count: items.length,
      file_count: files.length,
      files,
      examples: items.slice(0, 8),
      source_kind: 'runtime_code',
      confidence: files.length >= 2 ? 'medium' : 'low',
      gate_effect: files.length >= 2 ? 'review' : 'info'
    });
  }
  return duplicates.sort((a, b) => b.file_count - a.file_count || b.occurrence_count - a.occurrence_count);
}

function buildQueryShapeSignature(model, operation, callText) {
  const topLevelKeys = extractObjectKeys(callText);
  if (topLevelKeys.length === 0) return null;
  const whereKeys = extractNestedObjectKeys(callText, 'where');
  const selectKeys = extractNestedObjectKeys(callText, 'select');
  const orderKeys = extractNestedObjectKeys(callText, 'orderBy');
  return [
    `${model}.${operation}`,
    `top:${topLevelKeys.join(',')}`,
    `where:${whereKeys.join(',') || '-'}`,
    `select:${selectKeys.join(',') || '-'}`,
    `order:${orderKeys.join(',') || '-'}`
  ].join('|');
}

function extractObjectKeys(text) {
  const objectStart = text.indexOf('{');
  if (objectStart === -1) return [];
  const objectText = text.slice(objectStart);
  const keys = [];
  const pattern = /(?:^|[,{]\s*)([A-Za-z_$][\w$]*)\s*:/g;
  let match = pattern.exec(objectText);
  while (match) {
    keys.push(match[1]);
    match = pattern.exec(objectText);
  }
  return unique(keys).sort();
}

function extractNestedObjectKeys(text, propertyName) {
  const pattern = new RegExp(`\\b${propertyName}\\s*:\\s*\\{`, 'g');
  const match = pattern.exec(text);
  if (!match) return [];
  const start = text.indexOf('{', match.index);
  const object = extractBalancedBlock(text, start, '{', '}');
  if (!object) return [];
  return extractObjectKeys(object.text).filter((key) => key !== propertyName);
}

function detectResponsibilitySignals(file, code) {
  return {
    route_or_action: /(^|\/)(app\/api|pages\/api)\//.test(file) || /\bexport\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(code) || /['"]use server['"]/.test(code),
    data_access: /\b(?:prisma|db|client|prismaAny)\.[A-Za-z_$][\w$]*\./.test(code),
    auth: /\b(auth|session|getServerSession|currentUser|requireAuth|authorization|Bearer|token)\b/i.test(code),
    validation: /\b(z\.object|safeParse|parse\(|schema|validate|validation)\b/i.test(code),
    external_io: /\b(fetch|axios|twilio|openai|stripe|resend|sendgrid|webhook|blob)\b/i.test(code),
    notification: /\b(notify|notification|email|slack|webhook)\b/i.test(code),
    environment: /\bprocess\.env\.[A-Z0-9_]+\b/.test(code)
  };
}

function isRuntimeCode(file) {
  const normalized = file.toLowerCase();
  if (!/^(src|app|pages|lib)\//.test(normalized)) return false;
  if (normalized.startsWith('scripts/') || normalized.startsWith('docs/')) return false;
  if (/(^|\/)(__tests__|tests?|spec|fixtures?)(\/|$)/.test(normalized)
    || /\.(test|spec)\.(js|jsx|ts|tsx)$/.test(normalized)) {
    return false;
  }
  return true;
}

function findFirstLine(content, patterns) {
  const lines = [];
  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      lines.push(lineNumberAt(content, match.index));
      match = pattern.exec(content);
    }
  }
  return lines.length === 0 ? null : Math.min(...lines);
}

function extractCall(content, startIndex) {
  const openIndex = content.indexOf('(', startIndex);
  if (openIndex === -1) return null;
  const block = extractBalancedBlock(content, openIndex, '(', ')');
  if (!block) return null;
  return {
    text: content.slice(startIndex, block.end),
    end: block.end
  };
}

function extractBalancedBlock(content, openIndex, openChar, closeChar) {
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
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          text: content.slice(openIndex, index + 1),
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
  for (const hit of hits ?? []) {
    if (summary[hit.gate_effect] !== undefined) summary[hit.gate_effect] += 1;
  }
  return summary;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
