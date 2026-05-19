import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const UI_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const DEFAULT_UI_ROOTS = [
  'app',
  'src/app',
  'pages',
  'src/pages',
  'components',
  'src/components',
  'public',
  'styles',
  'src/styles'
];
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
const DEFAULT_SENPAINURSE_VALUE_CONTRACT = {
  forbidden_labels: ['退院予定日'],
  required_labels: ['退院目標日'],
  forbidden_new_registration_labels: ['退院先を選択', 'タスクを追加']
};

export async function scanFlowDesign(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = options.config ?? {};
  const flowConfig = config.flow_design ?? {};
  const profile = flowConfig.profile ?? inferProfile(options.story);
  const story = options.story ?? {};
  const uiFiles = await collectUiFiles(root, flowConfig);
  const valueContract = buildValueContract({ profile, flowConfig });
  const result = {
    schema_version: '0.1.0',
    status: 'pass',
    profile,
    story: {
      story_id: story.story_id ?? null,
      title: story.title ?? null
    },
    summary: {
      scanned_ui_files: uiFiles.length,
      contract_count: (flowConfig.contracts ?? []).length,
      interaction_count: 0,
      silent_noop_count: 0,
      ambiguous_primary_action_count: 0,
      selection_side_effect_count: 0,
      question_dead_end_count: 0,
      dead_ui_state_count: 0,
      interactive_contract_count: 0,
      value_alignment_count: 0
    },
    contracts: flowConfig.contracts ?? [],
    interactions: [],
    silent_noop_hits: [],
    ambiguous_primary_action_hits: [],
    selection_side_effect_hits: [],
    question_dead_end_hits: [],
    dead_ui_state_hits: [],
    interactive_contract_hits: [],
    value_alignment_hits: [],
    runtime_probe_plan: buildRuntimeProbePlan({ profile, story, flowConfig })
  };

  if (uiFiles.length === 0 && isUiStory(story, flowConfig)) {
    result.value_alignment_hits.push({
      id: 'FLOW-NO-UI-CODE',
      kind: 'ui_story_without_code_scan',
      severity: 'Critical',
      gate_effect: 'block',
      file: null,
      line: null,
      detail: 'UI Storyとして扱うべきStoryだが、flow-designが走査できるUIコードが0件だった。',
      recommendation: 'flow_design.code_rootsで対象UI実装のパスを指定するか、対象repoでVibeProを実行する。'
    });
  }

  for (const file of uiFiles) {
    const content = await readFile(file.absolutePath, 'utf8');
    collectInteractions(result.interactions, file.relativePath, content);
    collectSilentNoops(result.silent_noop_hits, file.relativePath, content);
    collectAmbiguousPrimaryActions(result.ambiguous_primary_action_hits, file.relativePath, content);
    collectSelectionSideEffects(result.selection_side_effect_hits, file.relativePath, content);
    collectQuestionDeadEnds(result.question_dead_end_hits, file.relativePath, content);
    collectDeadUiStates(result.dead_ui_state_hits, file.relativePath, content);
    collectInteractiveContractHits(result.interactive_contract_hits, file.relativePath, content);
    collectValueAlignmentHits(result.value_alignment_hits, file.relativePath, content, valueContract);
  }

  result.summary.interaction_count = result.interactions.length;
  result.summary.silent_noop_count = result.silent_noop_hits.length;
  result.summary.ambiguous_primary_action_count = result.ambiguous_primary_action_hits.length;
  result.summary.selection_side_effect_count = result.selection_side_effect_hits.length;
  result.summary.question_dead_end_count = result.question_dead_end_hits.length;
  result.summary.dead_ui_state_count = result.dead_ui_state_hits.length;
  result.summary.interactive_contract_count = result.interactive_contract_hits.length;
  result.summary.value_alignment_count = result.value_alignment_hits.length;
  result.status = resolveStatus(result);
  return result;
}

export function renderFlowDesignReport({ runId, flowDesign }) {
  if (!flowDesign) {
    return `# Flow Design Check

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| 状態 | flow-design-check は未生成 |
`;
  }
  return `# Flow Design Check

| 項目 | 内容 |
|------|------|
| Run ID | ${runId} |
| Status | ${flowDesign.status} |
| Profile | ${flowDesign.profile ?? '-'} |
| UI走査ファイル | ${flowDesign.summary?.scanned_ui_files ?? 0}件 |
| Interaction | ${flowDesign.summary?.interaction_count ?? 0}件 |
| Silent noop | ${flowDesign.summary?.silent_noop_count ?? 0}件 |
| Selection side effect | ${flowDesign.summary?.selection_side_effect_count ?? 0}件 |
| Question dead end | ${flowDesign.summary?.question_dead_end_count ?? 0}件 |
| Dead UI state | ${flowDesign.summary?.dead_ui_state_count ?? 0}件 |
| Interactive contract | ${flowDesign.summary?.interactive_contract_count ?? 0}件 |
| Value alignment | ${flowDesign.summary?.value_alignment_count ?? 0}件 |

## Silent noop

${formatHits(flowDesign.silent_noop_hits)}

## Selection side effect

${formatHits(flowDesign.selection_side_effect_hits)}

## Question dead end

${formatHits(flowDesign.question_dead_end_hits)}

## Dead UI state

${formatHits(flowDesign.dead_ui_state_hits)}

## Interactive contract

${formatHits(flowDesign.interactive_contract_hits)}

## Value alignment

${formatHits(flowDesign.value_alignment_hits)}

## Runtime probe plan

${(flowDesign.runtime_probe_plan?.commands ?? []).length === 0 ? '- なし' : flowDesign.runtime_probe_plan.commands.map((item) => `- ${item.id}: ${item.intent}`).join('\n')}
`;
}

function formatHits(hits = []) {
  if (!Array.isArray(hits) || hits.length === 0) return '- なし';
  return hits.map((hit) => `- ${hit.file ?? '-'}:${hit.line ?? '-'} ${hit.kind} severity=${hit.severity ?? '-'} gate_effect=${hit.gate_effect ?? '-'} ${hit.detail ?? hit.excerpt ?? ''}`.trim()).join('\n');
}

async function collectUiFiles(root, flowConfig) {
  const roots = flowConfig.code_roots?.length > 0 ? flowConfig.code_roots : DEFAULT_UI_ROOTS;
  const files = [];
  for (const candidate of roots) {
    const absoluteRoot = path.isAbsolute(candidate) ? candidate : path.join(root, candidate);
    files.push(...await listUiFiles(root, absoluteRoot));
  }
  return uniqueBy(files, (file) => file.absolutePath)
    .filter((file) => !isApiRoute(file.relativePath))
    .slice(0, 160);
}

async function listUiFiles(repoRoot, current) {
  let entries = [];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listUiFiles(repoRoot, absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!UI_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const fileStat = await stat(absolutePath);
    if (fileStat.size > 1024 * 1024) continue;
    files.push({
      absolutePath,
      relativePath: path.relative(repoRoot, absolutePath).split(path.sep).join('/')
    });
  }
  return files;
}

function collectInteractions(interactions, file, content) {
  const patterns = [
    /\bonClick\s*=\s*\{([^}\n]+)\}/g,
    /\bonSubmit\s*=\s*\{([^}\n]+)\}/g,
    /\bonChange\s*=\s*\{([^}\n]+)\}/g
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      interactions.push({
        file,
        line: lineNumberAt(content, match.index),
        handler: cleanup(match[1]),
        excerpt: cleanup(match[0]).slice(0, 180)
      });
    }
  }
}

function collectSilentNoops(hits, file, content) {
  const code = stripComments(content);
  for (const match of code.matchAll(/\bif\s*\(([^)]{1,180})\)\s*return\s*;?/g)) {
    const start = Math.max(0, match.index - 360);
    const end = Math.min(code.length, match.index + 360);
    const context = code.slice(start, end);
    if (/setError|throw\s+new|disabled=|focus\s*\(|scrollIntoView|aria-invalid/.test(context)) continue;
    hits.push({
      kind: 'silent_noop_return',
      severity: 'Medium',
      gate_effect: 'review',
      file,
      line: lineNumberAt(code, match.index),
      condition: cleanup(match[1]),
      excerpt: cleanup(match[0]),
      detail: `\`${cleanup(match[1])}\` で早期returnするが、同じ近傍にエラー表示・disabled・誘導が見えない。`
    });
  }
}

function collectAmbiguousPrimaryActions(hits, file, content) {
  const labelMatch = content.match(/\?\s*([^?:]{2,60})\s*:\s*([^}\n]{2,80})/);
  if (!labelMatch) return;
  const labels = [labelMatch[1], labelMatch[2]].map(cleanup).join(' / ');
  if (!/(検索|登録|保存|遷移|詳細へ|進む)/.test(labels)) return;
  if (!/(search|lookup|save|register|router\.push|navigate)/i.test(content)) return;
  hits.push({
    kind: 'state_dependent_primary_action',
    severity: 'Medium',
    gate_effect: 'review',
    file,
    line: lineNumberAt(content, labelMatch.index ?? 0),
    excerpt: labels,
    detail: '同じ主ボタンが状態によって検索・登録・保存・遷移など異なる意味を持つ可能性がある。'
  });
}

function collectSelectionSideEffects(hits, file, content) {
  for (const fn of extractFunctions(content)) {
    if (!/^select|choose|pick|handleSelect/i.test(fn.name)) continue;
    if (/router\.push|navigate\s*\(|location\.href/.test(fn.body)) {
      hits.push(buildFunctionHit('selection_triggers_navigation', file, content, fn, '候補選択handlerが画面遷移を含む。'));
    }
    if (/fetch\s*\([^)]*method\s*:\s*['"`]POST|await\s+\w*save|createCase|register/i.test(fn.body)) {
      hits.push(buildFunctionHit('selection_triggers_persistence', file, content, fn, '候補選択handlerが保存・作成系副作用を含む。'));
    }
  }
}

function collectQuestionDeadEnds(hits, file, content) {
  const questionKeys = [...content.matchAll(/question\.key\s*===\s*['"`]([^'"`]+)['"`]/g)];
  for (const match of questionKeys) {
    const block = content.slice(match.index, Math.min(content.length, match.index + 720));
    if (!/fetch\s*\(|set[A-Z]/.test(block)) continue;
    if (/router\.push|scrollIntoView|focus\s*\(|set.*Open|set.*Expanded|document\.getElementById|location\.hash/.test(block)) continue;
    hits.push({
      kind: 'question_answer_does_not_open_next_ui',
      question_key: match[1],
      severity: 'High',
      gate_effect: 'review',
      file,
      line: lineNumberAt(content, match.index),
      excerpt: cleanup(block).slice(0, 180),
      detail: `質問 \`${match[1]}\` の回答後に、次の入力UIを開く/移動する導線が見えない。`
    });
  }
}

function collectDeadUiStates(hits, file, content) {
  for (const match of content.matchAll(/\bset([A-Z][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*;?/g)) {
    const state = `${match[1].charAt(0).toLowerCase()}${match[1].slice(1)}`;
    const after = content.slice(match.index, Math.min(content.length, match.index + 360));
    if (!/(router\.push|navigate\s*\(|location\.href|await\s+\w*save|await\s+saveCase)/.test(after)) continue;
    if (!new RegExp(`\\b${escapeRegExp(state)}\\b`).test(content.slice(match.index + match[0].length))) continue;
    hits.push({
      kind: 'state_set_before_immediate_navigation_or_save',
      state,
      severity: 'Medium',
      gate_effect: 'review',
      file,
      line: lineNumberAt(content, match.index),
      excerpt: cleanup(after).slice(0, 180),
      detail: `\`${state}\` を表示用stateとして更新した直後に保存/遷移しており、到達不能UIの可能性がある。`
    });
  }
}

function collectInteractiveContractHits(hits, file, content) {
  const code = stripComments(content);
  const functions = extractFunctions(code);
  const functionLookup = new Map(functions.map((fn) => [fn.name, fn]));
  const elementPattern = /<([A-Za-z][A-Za-z0-9_.]*)\b([^<>]*?)(?:\/>|>)/g;
  for (const match of code.matchAll(elementPattern)) {
    const tag = match[1];
    const attrs = match[2] ?? '';
    if (isClosingOrNonInteractiveTag(tag, attrs)) continue;
    const after = code.slice(match.index + match[0].length, Math.min(code.length, match.index + match[0].length + 240));
    const label = extractElementLabel(after);
    if (!looksInteractive(tag, attrs, label)) continue;
    if (hasExplicitUnavailableState(attrs, label, after)) continue;

    const directContract = classifyDirectInteractiveContract(tag, attrs);
    if (directContract) continue;

    const handler = extractHandlerName(attrs);
    if (handler) {
      const fn = functionLookup.get(handler);
      if (!fn) continue;
      if (handlerBodyHasUserVisibleContract(fn.body)) continue;
      hits.push({
        kind: 'interactive_handler_without_user_visible_effect',
        severity: 'High',
        gate_effect: 'review',
        file,
        line: lineNumberAt(code, match.index),
        element: tag,
        handler,
        label,
        excerpt: cleanup(match[0]).slice(0, 180),
        detail: `クリック可能に見える \`${label || tag}\` のhandler \`${handler}\` に、保存・表示変化・遷移・scroll/focus・準備中表示のいずれも静的に確認できない。`
      });
      continue;
    }

    hits.push({
      kind: 'interactive_element_without_contract',
      severity: 'High',
      gate_effect: 'review',
      file,
      line: lineNumberAt(code, match.index),
      element: tag,
      label,
      excerpt: cleanup(match[0]).slice(0, 180),
      detail: `クリック可能に見える \`${label || tag}\` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。`
    });
  }
}

function collectValueAlignmentHits(hits, file, content, valueContract) {
  for (const label of valueContract.forbidden_labels ?? []) {
    for (const match of content.matchAll(new RegExp(escapeRegExp(label), 'g'))) {
      hits.push({
        kind: 'forbidden_label',
        label,
        severity: 'High',
        gate_effect: 'review',
        file,
        line: lineNumberAt(content, match.index),
        excerpt: label,
        detail: `価値観contractで禁止されたラベル \`${label}\` が表示面に残っている。`
      });
    }
  }
  if (isNewRegistrationFile(file)) {
    for (const label of valueContract.forbidden_new_registration_labels ?? []) {
      for (const match of content.matchAll(new RegExp(escapeRegExp(label), 'g'))) {
        hits.push({
          kind: 'forbidden_new_registration_label',
          label,
          severity: 'High',
          gate_effect: 'review',
          file,
          line: lineNumberAt(content, match.index),
          excerpt: label,
          detail: `新規登録画面では扱わない導線 \`${label}\` が残っている。`
        });
      }
    }
  }
}

function extractFunctions(content) {
  const functions = [];
  const pattern = /\b(?:const|function)\s+([A-Za-z0-9_]+)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\([^)]*\)\s*)\s*\{/g;
  for (const match of content.matchAll(pattern)) {
    const bodyStart = content.indexOf('{', match.index);
    const bodyEnd = findMatchingBrace(content, bodyStart);
    if (bodyEnd < 0) continue;
    functions.push({
      name: match[1],
      start: match.index,
      body: content.slice(bodyStart, bodyEnd + 1)
    });
  }
  return functions;
}

function findMatchingBrace(content, start) {
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === '{') depth += 1;
    if (content[index] === '}') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function buildFunctionHit(kind, file, content, fn, detail) {
  return {
    kind,
    severity: 'High',
    gate_effect: 'review',
    file,
    line: lineNumberAt(content, fn.start),
    handler: fn.name,
    excerpt: cleanup(fn.body).slice(0, 180),
    detail
  };
}

function buildValueContract({ profile, flowConfig }) {
  const base = profile === 'senpainurse' ? DEFAULT_SENPAINURSE_VALUE_CONTRACT : {};
  const configured = flowConfig.value_contract ?? {};
  return {
    forbidden_labels: [...new Set([...(base.forbidden_labels ?? []), ...(configured.forbidden_labels ?? [])])],
    required_labels: [...new Set([...(base.required_labels ?? []), ...(configured.required_labels ?? [])])],
    forbidden_new_registration_labels: [
      ...new Set([
        ...(base.forbidden_new_registration_labels ?? []),
        ...(configured.forbidden_new_registration_labels ?? [])
      ])
    ]
  };
}

function buildRuntimeProbePlan({ profile, story, flowConfig }) {
  if (Array.isArray(flowConfig?.runtime_probes) && flowConfig.runtime_probes.length > 0) {
    return {
      status: 'available',
      commands: flowConfig.runtime_probes.map((probe) => ({
        id: probe.id,
        intent: probe.intent ?? probe.title ?? probe.id,
        path: probe.path ?? null,
        mutates: probe.mutates === true,
        steps: Array.isArray(probe.steps) ? probe.steps : []
      })),
      story_id: story?.story_id ?? null
    };
  }
  if (profile !== 'senpainurse') {
    return { status: 'available', commands: [] };
  }
  return {
    status: 'available',
    commands: [
      {
        id: 'new-registration-dpc-flow',
        intent: '新規登録で病名検索、候補選択、明示登録、患者詳細遷移を確認する。',
        path: '/new',
        mutates: false,
        steps: [
          { action: 'expectVisible', text: '病名' },
          { action: 'expectVisible', text: '仮登録' },
          { action: 'expectNotVisible', text: '退院予定日' },
          { action: 'screenshot', name: 'new-registration-dpc-flow' }
        ]
      },
      {
        id: 'patient-detail-dpc-question',
        intent: 'DPC未入力患者で質問カードからDPC入力UIへ進めることを確認する。',
        path: '/patients/demo',
        mutates: false,
        steps: [
          { action: 'expectVisible', text: '？' },
          { action: 'expectVisible', text: '病名' },
          { action: 'screenshot', name: 'patient-detail-dpc-question' }
        ]
      }
    ],
    story_id: story?.story_id ?? null
  };
}

function resolveStatus(result) {
  const allHits = [
    ...(result.silent_noop_hits ?? []),
    ...(result.ambiguous_primary_action_hits ?? []),
    ...(result.selection_side_effect_hits ?? []),
    ...(result.question_dead_end_hits ?? []),
    ...(result.dead_ui_state_hits ?? []),
    ...(result.interactive_contract_hits ?? []),
    ...(result.value_alignment_hits ?? [])
  ];
  if (allHits.some((hit) => hit.severity === 'Critical')) return 'block';
  if (allHits.length > 0) return 'needs_review';
  return 'pass';
}

function isClosingOrNonInteractiveTag(tag, attrs) {
  if (!tag || tag.startsWith('/')) return true;
  if (/^(Fragment|React\.Fragment|form|input|select|textarea|option|label|img|svg|path|p|h[1-6]|ul|ol|li|section|main|header|footer)$/i.test(tag)) {
    return !/\bonClick\s*=|\brole\s*=\s*["']button["']/.test(attrs);
  }
  return false;
}

function looksInteractive(tag, attrs, label) {
  if (/^(button|a)$/i.test(tag)) return true;
  if (/\brole\s*=\s*["']button["']/.test(attrs)) return true;
  if (/\bonClick\s*=|\bonMouseDown\s*=|\bonKeyDown\s*=/.test(attrs)) return true;
  if (/\b(className|class)\s*=\s*["'`{][^"'`}]*\b(button|btn|action|clickable|link|tab|trigger|menu|detail|summary)\b/i.test(attrs)) return true;
  if (/[A-Z][A-Za-z0-9_.]*(Button|Link|Action|Trigger|Tab|MenuItem)$/.test(tag)) return true;
  return /(詳細を見る|音声入力|AI要約|保存|登録|検索|開始|編集|削除|開く|閉じる|もっと見る|追加|送信|選択|見る|View|Save|Submit|Search|Open|Close|Edit|Delete|More|Start|Add)/i.test(label ?? '');
}

function classifyDirectInteractiveContract(tag, attrs) {
  if (/\bdisabled(?:\s*=\s*(?:\{?true\}?|["']true["']))?/.test(attrs)) return 'disabled';
  if (/\baria-disabled\s*=\s*(?:\{?true\}?|["']true["'])/.test(attrs)) return 'disabled';
  if (/\bhref\s*=|\bto\s*=/.test(attrs)) return 'navigation';
  if (/\bformAction\s*=/.test(attrs)) return 'submit';
  if (/^button$/i.test(tag) && /\btype\s*=\s*["']submit["']/.test(attrs)) return 'submit';
  if (/\bonClick\s*=\s*\{\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(attrs)) return 'inline-handler';
  if (/\bonMouseDown\s*=|\bonKeyDown\s*=|\bonSubmit\s*=|\bonChange\s*=/.test(attrs)) return 'handler';
  return null;
}

function extractHandlerName(attrs) {
  const match = attrs.match(/\bonClick\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/);
  return match?.[1] ?? null;
}

function handlerBodyHasUserVisibleContract(body) {
  const normalized = cleanup(body);
  if (!normalized || /^\{\s*\}$/.test(normalized)) return false;
  if (/\b(fetch|axios|mutate|save|create|update|delete|submit|post|put|patch)\b/i.test(body)) return true;
  if (/\b(router\.push|router\.replace|navigate\s*\(|location\.href|window\.open|history\.pushState)\b/.test(body)) return true;
  if (/\bset[A-Z][A-Za-z0-9_]*\s*\(/.test(body)) return true;
  if (/\b(scrollIntoView|focus\s*\(|document\.getElementById|location\.hash)\b/.test(body)) return true;
  if (/(準備中|未実装|近日|coming soon|not implemented|disabled|toast|setError|alert\s*\()/i.test(body)) return true;
  if (/^\{\s*(?:event\.)?preventDefault\s*\(\s*\)\s*;?\s*\}$/.test(normalized)) return false;
  if (/^\{\s*(?:console\.(log|warn|error)\s*\([^)]*\)\s*;?\s*)+\}$/.test(normalized)) return false;
  return !/(TODO|noop|no-op|placeholder|仮置き)/i.test(body);
}

function hasExplicitUnavailableState(attrs, label, after) {
  const text = `${attrs} ${label ?? ''} ${after.match(/^([^<]{0,120})/)?.[1] ?? ''}`;
  return /(disabled|aria-disabled|準備中|未実装|近日公開|coming soon|not implemented|placeholder|工事中)/i.test(text);
}

function extractElementLabel(after) {
  const text = (after.match(/^([^<]{0,160})/)?.[1] ?? '')
    .replace(/\{[^}]*\}/g, ' ');
  return cleanup(text).slice(0, 80);
}

function isUiStory(story, flowConfig) {
  if (flowConfig.enabled === true) return true;
  const text = [story?.story_id, story?.title, story?.view].filter(Boolean).join(' ');
  return /UI|画面|導線|登録|質問|フォーム|dashboard|frontend|user/i.test(text);
}

function inferProfile(story) {
  const text = [story?.story_id, story?.title].filter(Boolean).join(' ');
  if (/senpai|センパイ|退院支援|DPC|患者/.test(text)) return 'senpainurse';
  return 'generic';
}

function isApiRoute(file) {
  return /(?:^|\/)api\/.+\/route\.(js|jsx|ts|tsx)$/.test(file) || /(?:^|\/)pages\/api\//.test(file);
}

function isNewRegistrationFile(file) {
  return /(?:^|\/)(new|register|registration)(?:\/|\.|$)/i.test(file);
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function cleanup(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const values = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(item);
  }
  return values;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
