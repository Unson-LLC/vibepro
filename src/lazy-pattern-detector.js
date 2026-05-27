const SCHEMA_VERSION = '0.1.0';
const SNIPPET_MAX = 120;

const TEST_PATH_PATTERNS = [
  /(^|\/)tests?\//,
  /(^|\/)__tests?__\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.(test|spec)\.py$/,
  /_test\.(go|rs)$/
];

const PATTERNS = [
  {
    id: 'merge_conflict_marker',
    severity: 'critical',
    applies_to: () => true,
    message: 'Merge conflict markers present in committed text.',
    fix_hint: 'Resolve the merge conflict and remove the <<<<<<<, =======, and >>>>>>> markers before committing.',
    file_check(addedLines) {
      let openMarker = null;
      let separator = null;
      let close = null;
      for (const entry of addedLines) {
        if (entry.content.startsWith('<<<<<<<')) openMarker = entry;
        else if (entry.content.startsWith('=======') && openMarker && !separator) separator = entry;
        else if (entry.content.startsWith('>>>>>>>') && openMarker && separator) close = entry;
      }
      if (openMarker && separator && close) {
        return { line_number: openMarker.line_number, snippet: trimSnippet(openMarker.content) };
      }
      return null;
    }
  },
  {
    id: 'commit_marker_left_in',
    severity: 'high',
    applies_to: (filePath) => !isTestPath(filePath),
    message: 'Self-addressed commit marker left in the change.',
    fix_hint: 'Remove the marker; if the work is truly unfinished, split it into a follow-up PR or mark the entire PR as a draft.',
    pattern: /\b(REMOVE BEFORE COMMIT|DO NOT COMMIT|DEBUG ONLY)\b/
  },
  {
    id: 'debug_print_left_in',
    severity: 'high',
    applies_to: (filePath) => {
      if (isTestPath(filePath)) return false;
      return /\.(js|ts|jsx|tsx|mjs|cjs|py|rs)$/.test(filePath);
    },
    message: 'Debug print or logging statement left in non-test source.',
    fix_hint: 'Remove the debug line, or replace it with a real logger call wired through the project\'s logging facility.',
    match(line, filePath) {
      if (/\bconsole\.(log|debug)\s*\(/.test(line)) return { snippet: trimSnippet(line), fix_hint: null };
      if (/\bdebugger\s*;/.test(line)) return { snippet: trimSnippet(line), fix_hint: null };
      if (filePath.endsWith('.py') && /(^|\s)print\s*\(/.test(line)) return { snippet: trimSnippet(line), fix_hint: null };
      if (filePath.endsWith('.rs') && /\bdbg!\s*\(/.test(line)) return { snippet: trimSnippet(line), fix_hint: null };
      return null;
    }
  },
  {
    id: 'silent_catch',
    severity: 'high',
    applies_to: (filePath) => !isTestPath(filePath),
    message: 'Empty catch block silently swallows errors.',
    fix_hint: 'Log the error, rethrow, or document explicitly with a comment why the failure is being ignored.',
    match(line, filePath) {
      if (/\}\s*catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/.test(line)) return { snippet: trimSnippet(line) };
      if (filePath.endsWith('.py') && /except[^:]*:\s*pass\b/.test(line)) return { snippet: trimSnippet(line) };
      return null;
    }
  },
  {
    id: 'todo_fixme_marker',
    severity: 'medium',
    applies_to: (filePath) => !/\.md$/i.test(filePath),
    message: 'TODO/FIXME/XXX marker left in committed source.',
    fix_hint: 'Either resolve the marker now or link it to a tracked issue and convert it into a concrete reference.',
    pattern: /\b(TODO|FIXME|XXX)\b/
  },
  {
    id: 'eslint_disable_without_reason',
    severity: 'medium',
    applies_to: (filePath) => /\.(js|ts|jsx|tsx|mjs|cjs)$/.test(filePath),
    message: 'eslint-disable directive used without a trailing justification.',
    fix_hint: 'Add a short `-- because <reason>` clause so a future reviewer knows why the rule is suppressed.',
    match(line) {
      const m = line.match(/eslint-disable(?:-next-line|-line)?(?:\s+([^*\n]*))?/);
      if (!m) return null;
      const tail = (m[1] ?? '').trim();
      if (!tail) return { snippet: trimSnippet(line) };
      const afterRule = tail.replace(/^[\w@/-]+(?:,\s*[\w@/-]+)*/, '').trim();
      if (!afterRule || /^[*/]+$/.test(afterRule)) return { snippet: trimSnippet(line) };
      return null;
    }
  },
  {
    id: 'placeholder_text',
    severity: 'medium',
    applies_to: () => true,
    message: 'Generic placeholder text left in the change.',
    fix_hint: 'Replace with a real value, or remove the snippet entirely if it was only filler.',
    pattern: /\b(lorem ipsum|Acme Corp|Acme Corporation|John Doe|Jane Doe|foo@bar\.com|user@example\.com|example\.com)\b/i
  },
  {
    id: 'em_dash_in_prose',
    severity: 'low',
    applies_to: (filePath) => /\.md$/i.test(filePath),
    message: 'Em dash (—) detected in Markdown prose — a common AI tell.',
    fix_hint: 'Prefer a comma, period, or " - " hyphen-space depending on intent; em dashes are rare in human-edited prose.',
    pattern: /—/
  }
];

export function detectLazyPatterns({ files } = {}) {
  const findings = [];
  if (!Array.isArray(files)) {
    return { schema_version: SCHEMA_VERSION, findings };
  }
  for (const file of files) {
    if (!file || typeof file.path !== 'string') continue;
    const addedLines = Array.isArray(file.added_lines) ? file.added_lines : [];
    for (const pattern of PATTERNS) {
      try {
        if (!pattern.applies_to(file.path)) continue;
        if (typeof pattern.file_check === 'function') {
          const hit = pattern.file_check(addedLines);
          if (hit) {
            findings.push({
              pattern_id: pattern.id,
              severity: pattern.severity,
              file: file.path,
              line_number: hit.line_number,
              snippet: hit.snippet,
              message: pattern.message,
              fix_hint: hit.fix_hint ?? pattern.fix_hint
            });
          }
          continue;
        }
        for (const entry of addedLines) {
          if (!entry || typeof entry.content !== 'string') continue;
          let hit = null;
          if (typeof pattern.match === 'function') {
            hit = pattern.match(entry.content, file.path);
          } else if (pattern.pattern instanceof RegExp && pattern.pattern.test(entry.content)) {
            hit = { snippet: trimSnippet(entry.content) };
          }
          if (hit) {
            findings.push({
              pattern_id: pattern.id,
              severity: pattern.severity,
              file: file.path,
              line_number: entry.line_number,
              snippet: hit.snippet,
              message: pattern.message,
              fix_hint: hit.fix_hint ?? pattern.fix_hint
            });
          }
        }
      } catch {
        continue;
      }
    }
  }
  return { schema_version: SCHEMA_VERSION, findings };
}

export function listLazyPatternCatalog() {
  return PATTERNS.map((pattern) => ({
    id: pattern.id,
    severity: pattern.severity,
    message: pattern.message
  }));
}

function isTestPath(filePath) {
  return TEST_PATH_PATTERNS.some((re) => re.test(filePath));
}

function trimSnippet(text) {
  const trimmed = String(text).trim();
  return trimmed.length > SNIPPET_MAX ? `${trimmed.slice(0, SNIPPET_MAX - 1)}…` : trimmed;
}
