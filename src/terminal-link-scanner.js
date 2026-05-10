import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const CANDIDATE_PATHS = [
  'public/modules/file-preview-config.js',
  'public/modules/xterm-file-links.js',
  'public/modules/iframe-contextmenu-handler.js',
  'public/ttyd/custom_ttyd_index.html',
  'server/controllers/session/shared-methods.js',
  'server/controllers/session/context-handlers.js'
];
const GATE_EFFECTS = ['block', 'review', 'info'];
const REQUIRED_IMAGE_PREVIEW_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

export async function scanTerminalLinkContracts(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = await collectFiles(root);
  const result = {
    schema_version: '0.1.0',
    scanned_files: files.length,
    dot_directory_link_hits: [],
    wrapped_terminal_link_hits: [],
    dot_directory_tree_hits: [],
    image_preview_extension_hits: [],
    risk_summary: {
      dot_directory_link_hits: { block: 0, review: 0, info: 0 },
      wrapped_terminal_link_hits: { block: 0, review: 0, info: 0 },
      dot_directory_tree_hits: { block: 0, review: 0, info: 0 },
      image_preview_extension_hits: { block: 0, review: 0, info: 0 }
    },
    status: 'ok'
  };

  for (const file of files) {
    const content = await readFile(file.absolutePath, 'utf8');
    collectDotDirectoryLinkHits(result.dot_directory_link_hits, file.relativePath, content);
    collectWrappedTerminalLinkHits(result.wrapped_terminal_link_hits, file.relativePath, content);
    collectDotDirectoryTreeHits(result.dot_directory_tree_hits, file.relativePath, content);
    collectImagePreviewExtensionHits(result.image_preview_extension_hits, file.relativePath, content);
  }

  result.risk_summary = {
    dot_directory_link_hits: summarizeGateEffects(result.dot_directory_link_hits),
    wrapped_terminal_link_hits: summarizeGateEffects(result.wrapped_terminal_link_hits),
    dot_directory_tree_hits: summarizeGateEffects(result.dot_directory_tree_hits),
    image_preview_extension_hits: summarizeGateEffects(result.image_preview_extension_hits)
  };
  result.status = allHits(result).length > 0 ? 'needs_review' : 'ok';
  return result;
}

export function renderTerminalLinkReport({ runId, terminalLinkContracts }) {
  if (!terminalLinkContracts) {
    return `# ターミナルリンク契約診断結果

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| 状態 | 未生成 |
`;
  }

  return `# ターミナルリンク契約診断結果

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| Status | ${terminalLinkContracts.status} |
| 走査ファイル | ${terminalLinkContracts.scanned_files}件 |
| dot directoryリンク候補 | ${formatRiskCount(terminalLinkContracts.dot_directory_link_hits, terminalLinkContracts.risk_summary?.dot_directory_link_hits)} |
| 折り返しリンク候補 | ${formatRiskCount(terminalLinkContracts.wrapped_terminal_link_hits, terminalLinkContracts.risk_summary?.wrapped_terminal_link_hits)} |
| dot directoryツリー候補 | ${formatRiskCount(terminalLinkContracts.dot_directory_tree_hits, terminalLinkContracts.risk_summary?.dot_directory_tree_hits)} |
| 画像プレビュー拡張子候補 | ${formatRiskCount(terminalLinkContracts.image_preview_extension_hits, terminalLinkContracts.risk_summary?.image_preview_extension_hits)} |

## dot directoryリンク候補

${formatHits(terminalLinkContracts.dot_directory_link_hits)}

## 折り返しリンク候補

${formatHits(terminalLinkContracts.wrapped_terminal_link_hits)}

## dot directoryツリー候補

${formatHits(terminalLinkContracts.dot_directory_tree_hits)}

## 画像プレビュー拡張子候補

${formatHits(terminalLinkContracts.image_preview_extension_hits)}
`;
}

function collectDotDirectoryLinkHits(hits, file, content) {
  if (!isTerminalLinkFile(file, content)) return;
  const hasStrictStarter = content.includes('[a-zA-Z0-9_][a-zA-Z0-9_/.\\\\-]*')
    || content.includes('[a-zA-Z0-9_][a-zA-Z0-9_/.\\-]*');
  const supportsDotDirectory = content.includes('\\\\.[a-zA-Z0-9_]')
    || content.includes('\\.[a-zA-Z0-9_]')
    || content.includes('PATH_START');
  if (!hasStrictStarter || supportsDotDirectory) return;

  hits.push({
    file,
    line: lineNumberOf(content, '[a-zA-Z0-9_]'),
    kind: 'dot_directory_file_link_not_supported',
    excerpt: excerptAround(content, '[a-zA-Z0-9_]'),
    confidence: 'high',
    gate_effect: 'review',
    recommendation: 'terminal file link regex should accept dot-prefixed relative directories such as .vibepro/pr/story/pr-prepare.html.'
  });
}

function collectWrappedTerminalLinkHits(hits, file, content) {
  if (!isTerminalLinkFile(file, content)) return;
  if (!content.includes('CONTINUATION') && !content.includes('registerLinkProvider')) return;
  if (!content.includes('^(\\\\s+)') && !content.includes("'^(\\\\s+)'")) return;

  hits.push({
    file,
    line: lineNumberOf(content, '^(\\\\s+)'),
    kind: 'wrapped_terminal_continuation_requires_indent',
    excerpt: excerptAround(content, '^(\\\\s+)'),
    confidence: 'high',
    gate_effect: 'review',
    recommendation: 'terminal continuation detection should handle hard wraps that continue at column 1, not only indented continuation lines.'
  });
}

function collectDotDirectoryTreeHits(hits, file, content) {
  if (!/folder-tree|readTree|hasVisibleChildren|EXCLUDED_DIRS/i.test(content)) return;
  if (!content.includes("startsWith('.')")) return;
  if (content.includes('VISIBLE_DOT_DIRS') || content.includes('.vibepro')) return;

  hits.push({
    file,
    line: lineNumberOf(content, "startsWith('.')"),
    kind: 'dot_directory_tree_hidden_without_allowlist',
    excerpt: excerptAround(content, "startsWith('.')"),
    confidence: 'high',
    gate_effect: 'review',
    recommendation: 'folder tree hidden-file filtering should allow generated review artifact directories such as .vibepro while still excluding .git and other internals.'
  });
}

function collectImagePreviewExtensionHits(hits, file, content) {
  if (file !== 'public/modules/file-preview-config.js' && !content.includes('BROWSER_PREVIEWABLE_EXTENSIONS')) return;

  const browserBody = extractSetBody(content, 'BROWSER_PREVIEWABLE_EXTENSIONS');
  if (!browserBody) return;

  const imageBody = extractSetBody(content, 'IMAGE_EXTENSIONS');
  const browserUsesImageSet = /\.\.\.\s*IMAGE_EXTENSIONS/.test(browserBody);
  const previewableSource = browserUsesImageSet && imageBody ? imageBody : browserBody;
  const missing = REQUIRED_IMAGE_PREVIEW_EXTENSIONS.filter((ext) => !hasQuotedExtension(previewableSource, ext));
  if (missing.length === 0) return;

  hits.push({
    file,
    line: lineNumberOf(content, 'BROWSER_PREVIEWABLE_EXTENSIONS'),
    kind: 'browser_preview_image_extensions_missing',
    missing_extensions: missing,
    excerpt: excerptAround(content, 'BROWSER_PREVIEWABLE_EXTENSIONS'),
    confidence: 'high',
    gate_effect: 'review',
    recommendation: `file viewer browser-preview contract should include common image extensions: ${REQUIRED_IMAGE_PREVIEW_EXTENSIONS.join(', ')}. Missing: ${missing.join(', ')}.`
  });
}

function isTerminalLinkFile(file, content) {
  return /xterm|ttyd|terminal/i.test(file) || /registerLinkProvider|OPEN_FILE|filePathRegex|XTERM_FILE_TOKEN_REGEX/.test(content);
}

function allHits(result) {
  return [
    ...result.dot_directory_link_hits,
    ...result.wrapped_terminal_link_hits,
    ...result.dot_directory_tree_hits,
    ...result.image_preview_extension_hits
  ];
}

async function collectFiles(root, current = root) {
  const files = [];
  for (const relativePath of CANDIDATE_PATHS) {
    const absolutePath = path.join(root, relativePath);
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile() || fileStat.size > 1024 * 1024) continue;
      files.push({ absolutePath, relativePath });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return files;
}

function summarizeGateEffects(items = []) {
  const summary = Object.fromEntries(GATE_EFFECTS.map((effect) => [effect, 0]));
  for (const item of items) {
    if (summary[item.gate_effect] !== undefined) summary[item.gate_effect] += 1;
  }
  return summary;
}

function formatRiskCount(items = [], summary = summarizeGateEffects(items)) {
  return `${items.length}件 (block: ${summary.block ?? 0}, review: ${summary.review ?? 0}, info: ${summary.info ?? 0})`;
}

function formatHits(hits = []) {
  if (hits.length === 0) return '- なし';
  return hits.map((hit) => `- ${hit.file}:${hit.line} ${hit.kind} confidence=${hit.confidence} gate_effect=${hit.gate_effect} \`${hit.excerpt}\``).join('\n');
}

function lineNumberOf(content, needle) {
  const index = content.indexOf(needle);
  if (index < 0) return 1;
  return content.slice(0, index).split(/\r?\n/).length;
}

function excerptAround(content, needle) {
  const index = content.indexOf(needle);
  if (index < 0) return '';
  return content
    .slice(Math.max(0, index - 60), index + needle.length + 80)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function extractSetBody(content, exportName) {
  const match = content.match(new RegExp(`${exportName}\\s*=\\s*new\\s+Set\\s*\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`, 'm'));
  return match?.[1] || null;
}

function hasQuotedExtension(content, extension) {
  const escaped = extension.replace('.', '\\.');
  return new RegExp(`['"\`]${escaped}['"\`]`).test(content);
}
