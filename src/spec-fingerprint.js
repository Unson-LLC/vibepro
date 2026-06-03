import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CODE_EXTENSIONS,
  DOMAIN_KEYWORDS,
  INVARIANT_PATTERNS,
  collectCodeScenarios,
  extractInvariantTexts,
  parseStoryLikeDocument,
  resolveCodeFiles,
  resolveStorySource
} from './requirement-consistency.js';
import { readInferredSpec } from './spec-store.js';
import { WORKSPACE_DIR } from './workspace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_GLOB_DIRS = ['test', 'tests', '__tests__', 'e2e'];
const TEST_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(?:m|c)?[jt]sx?$/i;
const MAX_TEST_FILES = 120;
const MAX_TEST_CASES_PER_FILE = 24;
const MAX_ARCHITECTURE_DOCS = 12;
const ARCHITECTURE_DOC_DIRS = [
  path.join('docs', 'architecture'),
  path.join('docs', 'adr'),
  path.join('docs', 'design')
];

export async function buildSpecFingerprint(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId ?? null;
  const storyOption = options.story ?? null;

  const codeFiles = await resolveCodeFiles(root, options);
  const storyForResolution = storyOption
    ?? (storyId ? { story_id: storyId, title: options.storyTitle ?? null } : null);
  const storySource = await resolveStorySource(root, {
    story: storyForResolution,
    storySource: options.storySource,
    codeFiles
  });
  const codeScenarios = await collectCodeScenarios(root, codeFiles);
  const testFingerprint = await collectTestFingerprint(root);
  const previousSpec = storyId ? await readInferredSpec(root, storyId) : null;
  const architectureFingerprint = await collectArchitectureFingerprint(root, storySource, storyId);
  const schema = await readSchema();
  const instructions = options.includeInstructions ? await readInstructions() : null;

  const story = buildStoryFingerprint(storySource, storyOption, storyId);
  const codeFingerprint = buildCodeFingerprint(codeScenarios);
  const inputsDigest = buildInputsDigest({ story, codeFingerprint, testFingerprint, architectureFingerprint });

  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    story_id: storyId,
    story,
    architecture_fingerprint: architectureFingerprint,
    code_fingerprint: codeFingerprint,
    test_fingerprint: testFingerprint,
    previous_spec: previousSpec,
    inputs_digest: inputsDigest,
    extraction_hints: {
      invariant_patterns: INVARIANT_PATTERNS.map((pattern) => pattern.source),
      domain_keywords: DOMAIN_KEYWORDS,
      story_invariant_hints: extractInvariantTexts(storySource)
    },
    schema_for_your_output: schema,
    instructions
  };
}

function buildStoryFingerprint(storySource, storyOption, storyId) {
  return {
    story_id: storyId ?? storyOption?.story_id ?? storySource?.story_id ?? null,
    title: storyOption?.title ?? storySource?.title ?? null,
    path: storySource?.path ?? null,
    frontmatter: storySource?.frontmatter ?? null,
    background: storySource?.background ?? null,
    policy: storySource?.policy ?? null,
    acceptance_criteria: storySource?.acceptance_criteria ?? []
  };
}

function buildCodeFingerprint(codeScenarios) {
  const branches = [];
  const externalEffects = [];
  const stateTransitions = [];
  const responseMessages = [];
  for (const scenario of codeScenarios) {
    for (const branch of scenario.branches) {
      branches.push({
        file: scenario.file,
        kind: branch.kind,
        condition: branch.condition,
        domain_keywords: scenario.domain_keywords
      });
    }
    for (const effect of scenario.external_effects) {
      externalEffects.push({ file: scenario.file, type: effect.type, evidence: effect.evidence });
    }
    for (const transition of scenario.state_transitions) {
      stateTransitions.push({ file: scenario.file, key: transition.key, value: transition.value });
    }
    for (const message of scenario.response_messages) {
      responseMessages.push({ file: scenario.file, message });
    }
  }
  return {
    files_scanned: codeScenarios.length,
    branches: branches.slice(0, 120),
    state_transitions: stateTransitions.slice(0, 80),
    external_effects: externalEffects.slice(0, 80),
    response_messages: responseMessages.slice(0, 60),
    files: codeScenarios.map((scenario) => scenario.file)
  };
}

async function collectTestFingerprint(repoRoot) {
  const testFiles = await listTestFiles(repoRoot);
  const files = [];
  for (const relative of testFiles.slice(0, MAX_TEST_FILES)) {
    let content = '';
    try {
      content = await readFile(path.join(repoRoot, relative), 'utf8');
    } catch {
      continue;
    }
    const describes = extractCallStrings(content, /\bdescribe\s*\(\s*(['"`])([^'"`]{1,160})\1/g);
    const cases = extractTestCases(content);
    if (describes.length === 0 && cases.length === 0) continue;
    files.push({
      path: relative,
      describes,
      cases: cases.slice(0, MAX_TEST_CASES_PER_FILE)
    });
  }
  return {
    files_scanned: files.length,
    files
  };
}

async function collectArchitectureFingerprint(repoRoot, storySource, storyId) {
  const explicitRefs = extractArchitectureDocRefs(storySource);
  const relatedRefs = await findRelatedArchitectureDocs(repoRoot, storyId);
  const paths = [...new Set([...explicitRefs, ...relatedRefs])].slice(0, MAX_ARCHITECTURE_DOCS);
  const docs = [];
  for (const relative of paths) {
    let content = '';
    try {
      content = await readFile(path.join(repoRoot, relative), 'utf8');
    } catch {
      continue;
    }
    docs.push({
      path: relative,
      title: findMarkdownTitle(content),
      evidence_kind: inferArchitectureEvidenceKind(content),
      flow_state_boundary_snippets: extractArchitectureSnippets(content)
    });
  }
  return {
    files_scanned: docs.length,
    files: docs
  };
}

function extractArchitectureDocRefs(storySource) {
  const refs = [];
  const content = storySource?.content ?? '';
  const storyDir = storySource?.path ? path.posix.dirname(storySource.path) : '.';
  for (const ref of extractFrontmatterRefs(content, 'architecture_docs')) {
    refs.push(resolveStoryDocRef(storyDir, ref));
  }
  const frontmatterRef = storySource?.frontmatter?.architecture_docs;
  if (typeof frontmatterRef === 'string') refs.push(resolveStoryDocRef(storyDir, frontmatterRef));
  return refs.filter(Boolean);
}

function extractFrontmatterRefs(content, key) {
  const match = String(content ?? '').match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const lines = match[1].split('\n');
  const refs = [];
  let inBlock = false;
  for (const line of lines) {
    const direct = line.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`));
    if (direct) {
      const value = direct[1].trim();
      if (value && value !== '|' && value !== '>') refs.push(stripYamlQuote(value));
      inBlock = value === '' || value === '|' || value === '>';
      continue;
    }
    if (inBlock) {
      const item = line.match(/^\s*-\s+(.+?)\s*$/);
      if (item) {
        refs.push(stripYamlQuote(item[1]));
        continue;
      }
      if (/^[A-Za-z0-9_-]+:/.test(line)) inBlock = false;
    }
  }
  return refs;
}

function stripYamlQuote(value) {
  return String(value).replace(/^['"]|['"]$/g, '').trim();
}

function resolveStoryDocRef(storyDir, ref) {
  const clean = stripYamlQuote(ref);
  if (!clean || /^reason\s*:/.test(clean)) return null;
  const resolved = clean.startsWith('.')
    ? path.posix.normalize(path.posix.join(storyDir, clean))
    : path.posix.normalize(clean);
  return resolved.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function findRelatedArchitectureDocs(repoRoot, storyId) {
  if (!storyId) return [];
  const needle = String(storyId).toLowerCase();
  const shortNeedle = needle.replace(/^story-/, '');
  const files = [];
  for (const dir of ARCHITECTURE_DOC_DIRS) {
    const absolute = path.join(repoRoot, dir);
    try {
      await walkMarkdownFiles(absolute, repoRoot, files);
    } catch {
      // optional architecture directories may not exist
    }
  }
  const matches = [];
  for (const relative of files) {
    const lower = relative.toLowerCase();
    if (lower.includes(needle) || lower.includes(shortNeedle)) {
      matches.push(relative);
      continue;
    }
    try {
      const content = await readFile(path.join(repoRoot, relative), 'utf8');
      if (content.toLowerCase().includes(needle)) matches.push(relative);
    } catch {
      // ignore unreadable docs
    }
  }
  return matches;
}

async function walkMarkdownFiles(absolute, repoRoot, collected) {
  let entries = [];
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const next = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdownFiles(next, repoRoot, collected);
      continue;
    }
    if (/\.mdx?$/i.test(entry.name)) {
      collected.push(path.relative(repoRoot, next).split(path.sep).join('/'));
    }
  }
}

function inferArchitectureEvidenceKind(content) {
  const text = String(content ?? '');
  const kinds = [];
  if (/(IA|information architecture|情報構造|navigation|ナビゲーション|route|screen|画面)/i.test(text)) kinds.push('information_architecture');
  if (/(flow|journey|画面遷移|遷移|導線|workflow|sequence)/i.test(text)) kinds.push('flow');
  if (/(state|status|状態|ステート)/i.test(text)) kinds.push('state');
  if (/(boundary|responsibility|責務|境界|dependency|依存)/i.test(text)) kinds.push('boundary');
  return kinds.length > 0 ? kinds : ['architecture'];
}

function extractArchitectureSnippets(content) {
  const headings = [
    'Intent',
    'Boundary',
    'Data Flow',
    'Information Architecture',
    'IA',
    'UI Flow',
    'Flow',
    'Journey',
    'State',
    'Responsibilities',
    '責務',
    '境界',
    '情報構造',
    '画面遷移',
    '導線',
    '状態'
  ];
  const snippets = [];
  for (const heading of headings) {
    const section = extractMarkdownSection(content, heading);
    if (section) snippets.push({ section: heading, text: compactSnippet(section) });
    if (snippets.length >= 6) break;
  }
  if (snippets.length === 0) snippets.push({ section: 'summary', text: compactSnippet(content) });
  return snippets;
}

function extractMarkdownSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content ?? '').match(new RegExp(`^##+\\s+.*${escaped}.*\\n([\\s\\S]*?)(?=^##+\\s+|(?![\\s\\S]))`, 'im'));
  return match?.[1] ?? null;
}

function compactSnippet(value) {
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('---'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 700);
}

function extractCallStrings(content, regex) {
  const results = [];
  for (const match of content.matchAll(regex)) {
    const value = match[2]?.trim();
    if (value && value.length >= 2) results.push(value);
  }
  return [...new Set(results)].slice(0, 30);
}

function extractTestCases(content) {
  const cases = [];
  const nameRegex = /\b(?:it|test)\s*\(\s*(['"`])([^'"`]{1,200})\1/g;
  for (const match of content.matchAll(nameRegex)) {
    cases.push({ name: match[2].trim(), expects: [] });
  }
  const expectRegex = /\bexpect\(([^)]{1,180})\)\s*\.\s*([A-Za-z0-9_$]+)\s*\(([^)]{0,160})\)/g;
  for (const match of content.matchAll(expectRegex)) {
    const expectText = `expect(${match[1].trim()}).${match[2]}(${match[3].trim()})`;
    if (cases.length === 0) continue;
    const lastCase = cases[cases.length - 1];
    if (lastCase.expects.length < 6) lastCase.expects.push(expectText);
  }
  const assertRegex = /\bassert(?:\.[A-Za-z0-9_$]+)?\s*\(([^)]{1,160})\)/g;
  for (const match of content.matchAll(assertRegex)) {
    if (cases.length === 0) continue;
    const lastCase = cases[cases.length - 1];
    if (lastCase.expects.length < 6) lastCase.expects.push(`assert(${match[1].trim()})`);
  }
  return cases;
}

async function listTestFiles(repoRoot) {
  const collected = new Set();
  for (const dir of TEST_GLOB_DIRS) {
    const absolute = path.join(repoRoot, dir);
    let stats;
    try {
      stats = await stat(absolute);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    await walkTests(absolute, repoRoot, collected);
  }
  return [...collected];
}

async function walkTests(absolute, repoRoot, collected) {
  let entries = [];
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === WORKSPACE_DIR) continue;
    const next = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      await walkTests(next, repoRoot, collected);
      continue;
    }
    if (!TEST_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (!TEST_FILE_PATTERN.test(entry.name)) continue;
    collected.add(path.relative(repoRoot, next).split(path.sep).join('/'));
  }
}

function buildInputsDigest({ story, codeFingerprint, testFingerprint, architectureFingerprint }) {
  return {
    story_sha: sha256({
      story_id: story?.story_id ?? null,
      title: story?.title ?? null,
      acceptance_criteria: story?.acceptance_criteria ?? [],
      background: story?.background ?? null,
      policy: story?.policy ?? null
    }),
    code_sha: sha256({
      files: codeFingerprint.files,
      branches: codeFingerprint.branches,
      state_transitions: codeFingerprint.state_transitions,
      external_effects: codeFingerprint.external_effects
    }),
    test_sha: sha256({
      files: testFingerprint.files.map((file) => ({
        path: file.path,
        describes: file.describes,
        cases: file.cases.map((entry) => entry.name)
      }))
    }),
    architecture_sha: sha256({
      files: (architectureFingerprint?.files ?? []).map((file) => ({
        path: file.path,
        evidence_kind: file.evidence_kind,
        snippets: file.flow_state_boundary_snippets
      }))
    })
  };
}

function findMarkdownTitle(content) {
  const match = String(content ?? '').match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function sha256(value) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(value));
  return `sha256:${hash.digest('hex')}`;
}

async function readSchema() {
  const schemaPath = path.join(__dirname, 'spec-schema.json');
  return JSON.parse(await readFile(schemaPath, 'utf8'));
}

async function readInstructions() {
  const promptPath = path.join(__dirname, 'spec-prompt-template.md');
  return readFile(promptPath, 'utf8');
}
