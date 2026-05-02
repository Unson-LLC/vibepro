const INFO_GATE_EFFECT = 'info';

export function buildRefactoringOpportunities(evidence) {
  const codeQuality = evidence?.code_quality ?? {};
  return [
    ...buildDuplicateQueryOpportunities(codeQuality.duplicate_query_shapes ?? []),
    ...buildResponsibilityHotspotOpportunities(codeQuality.responsibility_hotspots ?? [])
  ];
}

export function buildRefactoringActionCandidates(evidence) {
  const opportunities = Array.isArray(evidence?.refactoring_opportunities)
    ? evidence.refactoring_opportunities
    : [];
  const primaryDryOpportunity = opportunities.find((opportunity) => (
    opportunity.finding_id === 'VP-DRY-001'
    && opportunity.source === 'duplicate_query_shape'
  ));
  if (!primaryDryOpportunity) return [];

  return [{
    id: 'VP-ACTION-DRY-001',
    finding_id: 'VP-DRY-001',
    scope: 'refactoring',
    title: primaryDryOpportunity.title,
    target_count: primaryDryOpportunity.target_count,
    target_files: primaryDryOpportunity.target_files,
    execution_policy: 'proposal_only',
    mutates_repository: false,
    confidence: primaryDryOpportunity.confidence,
    recommendation: primaryDryOpportunity.story_blueprint.summary,
    refactoring_opportunity_id: primaryDryOpportunity.id,
    story_blueprint: primaryDryOpportunity.story_blueprint,
    implementation_plan: buildRefactoringImplementationPlan(primaryDryOpportunity)
  }];
}

function buildDuplicateQueryOpportunities(duplicateQueryShapes) {
  return duplicateQueryShapes
    .filter((shape) => shape?.gate_effect !== INFO_GATE_EFFECT)
    .map((shape, index) => buildDuplicateQueryOpportunity(shape, index + 1))
    .sort(compareOpportunities);
}

function buildDuplicateQueryOpportunity(shape, serialNumber) {
  const parsed = parseQuerySignature(shape.signature);
  const intent = classifyQueryIntent(parsed, shape);
  const suggestedAbstraction = buildSuggestedAbstraction(intent, parsed);
  const targetFiles = uniqueFiles(shape.files ?? []);
  const storyBlueprint = buildDuplicateQueryStoryBlueprint({
    shape,
    parsed,
    intent,
    suggestedAbstraction,
    targetFiles
  });

  return {
    id: `VP-OPP-DRY-${formatSerial(serialNumber)}`,
    finding_id: 'VP-DRY-001',
    source: 'duplicate_query_shape',
    title: storyBlueprint.title,
    refactoring_intent: intent,
    target_count: targetFiles.length,
    target_files: targetFiles,
    confidence: shape.confidence ?? 'medium',
    priority: shape.gate_effect === 'block' ? 'high' : 'medium',
    suggested_abstraction: suggestedAbstraction,
    evidence_refs: {
      signature: shape.signature,
      model: parsed.model,
      operation: parsed.operation,
      where_keys: parsed.where_keys,
      select_keys: parsed.select_keys,
      occurrence_count: shape.occurrence_count ?? 0,
      file_count: shape.file_count ?? targetFiles.length,
      examples: shape.examples ?? []
    },
    story_blueprint: storyBlueprint
  };
}

function buildResponsibilityHotspotOpportunities(hotspots) {
  return hotspots
    .filter((hotspot) => hotspot?.gate_effect !== INFO_GATE_EFFECT)
    .map((hotspot, index) => {
      const targetFiles = uniqueFiles([hotspot.file]);
      const storyBlueprint = buildResponsibilityStoryBlueprint({ hotspot, targetFiles });
      return {
        id: `VP-OPP-ARCH-${formatSerial(index + 1)}`,
        finding_id: 'VP-ARCH-001',
        source: 'responsibility_hotspot',
        title: storyBlueprint.title,
        refactoring_intent: 'responsibility_split',
        target_count: targetFiles.length,
        target_files: targetFiles,
        confidence: hotspot.confidence ?? 'medium',
        priority: hotspot.gate_effect === 'block' ? 'high' : 'medium',
        suggested_abstraction: {
          id: 'split-runtime-responsibilities',
          label: 'runtime責務を境界ごとに分離する',
          target_shape: 'route/action/service/helpers'
        },
        evidence_refs: {
          file: hotspot.file,
          line_count: hotspot.line_count ?? null,
          signals: hotspot.signals ?? [],
          examples: hotspot.examples ?? []
        },
        story_blueprint: storyBlueprint
      };
    });
}

function buildDuplicateQueryStoryBlueprint({ shape, parsed, intent, suggestedAbstraction, targetFiles }) {
  const label = intentLabel(intent);
  const queryLabel = [parsed.model, parsed.operation].filter(Boolean).join('.') || 'Prisma query';
  return {
    title: `${label}の重複query形状を共通化する`,
    summary: `${shape.occurrence_count ?? targetFiles.length}箇所に出ている ${queryLabel} の同一where/select/orderByを、用途が同じか確認したうえで共通境界へ寄せる。`,
    source_finding_id: 'VP-DRY-001',
    refactoring_intent: intent,
    current_behavior: {
      query: queryLabel,
      occurrence_count: shape.occurrence_count ?? 0,
      file_count: shape.file_count ?? targetFiles.length,
      target_files: targetFiles
    },
    behavior_variants: buildQueryBehaviorVariants(parsed),
    suggested_abstraction: suggestedAbstraction,
    invariants: [
      '返却データのshapeを既存呼び出し元ごとに変えない。',
      'where/select/orderBy/take/skip/cursorの意味を共通化前後で一致させる。',
      '用途が異なる重複は無理に統合せず、Story内で別責務として分ける。'
    ],
    acceptance_criteria: [
      '重複しているquery形状の用途が同じか、Story上で判断根拠が明示されている。',
      '同じ用途のquery形状はservice/helper/repositoryなど単一の境界に集約されている。',
      '既存の呼び出し元テストまたは型検査で返却shapeの互換性が確認されている。',
      'VibePro診断で対象の重複query形状が減っている。'
    ],
    validation_commands: [
      'npm test -- <related tests>',
      'npm run type-check',
      'vibepro diagnose <repo>'
    ]
  };
}

function buildResponsibilityStoryBlueprint({ hotspot, targetFiles }) {
  return {
    title: '責務混在runtime fileを分離する',
    summary: `${hotspot.file} にDB・認証・検証・外部I/Oなど複数責務が集中しているため、境界をStory化して分離する。`,
    source_finding_id: 'VP-ARCH-001',
    refactoring_intent: 'responsibility_split',
    current_behavior: {
      target_files: targetFiles,
      signals: hotspot.signals ?? [],
      line_count: hotspot.line_count ?? null
    },
    behavior_variants: [
      'route/actionは入力・認可・レスポンス責務を持つ。',
      'service/repositoryはDBアクセスとdomain処理を分離して持つ。',
      '外部I/Oや通知は副作用境界として切り出す。'
    ],
    suggested_abstraction: {
      id: 'split-runtime-responsibilities',
      label: 'runtime責務を境界ごとに分離する',
      target_shape: 'route/action/service/helpers'
    },
    invariants: [
      'APIまたはUIから見える入出力を変えない。',
      '認可順序とエラーハンドリングを分離前後で維持する。',
      '副作用を呼び出すタイミングを変えない。'
    ],
    acceptance_criteria: [
      '混在していた責務が読み取れる単位へ分離されている。',
      '既存テストまたは型検査で入出力互換性が確認されている。',
      'VibePro診断で責務混在候補の根拠が減っている。'
    ],
    validation_commands: [
      'npm test -- <related tests>',
      'npm run type-check',
      'vibepro diagnose <repo>'
    ]
  };
}

function buildRefactoringImplementationPlan(opportunity) {
  return {
    priority: opportunity.priority,
    rationale: `${opportunity.finding_id} から ${opportunity.refactoring_intent} としてStory化できる候補。対象は ${opportunity.target_count}ファイル。`,
    read_first_files: opportunity.target_files.map((file) => ({
      file,
      reason: `リファクタリング機会 ${opportunity.id} の対象ファイル`
    })),
    steps: [
      {
        id: 'inventory-current-behavior',
        title: '現在の挙動を棚卸しする',
        detail: '対象ファイルごとにquery条件、返却shape、fallback、例外処理、呼び出し元期待値を確認する。'
      },
      {
        id: 'decide-abstraction-boundary',
        title: '共通境界を決める',
        detail: '同じ用途なら共通service/helper/repositoryへ集約し、用途が違う場合はStory内で分離する。'
      },
      {
        id: 'replace-call-sites',
        title: '呼び出し元を置き換える',
        detail: '既存の返却shapeを保ったまま、対象箇所を共通境界へ接続する。'
      },
      {
        id: 'rerun-diagnosis',
        title: '診断を再実行する',
        detail: '型検査・関連テスト・VibePro診断で重複query形状が減ったことを確認する。'
      }
    ],
    acceptance_criteria: opportunity.story_blueprint.acceptance_criteria,
    pre_fix_briefing: {
      opportunity: {
        id: opportunity.id,
        source: opportunity.source,
        refactoring_intent: opportunity.refactoring_intent,
        suggested_abstraction: opportunity.suggested_abstraction,
        evidence_refs: opportunity.evidence_refs
      },
      target_files: opportunity.target_files,
      invariants: opportunity.story_blueprint.invariants,
      evidence_examples: opportunity.evidence_refs.examples ?? [],
      strategy_options: [
        {
          id: 'extract-shared-boundary',
          label: '方針A: 同じ用途の処理を共通境界へ抽出する',
          target_count: opportunity.target_count,
          candidate_files: opportunity.target_files,
          benefits: ['重複query形状を直接減らせる', '挙動変更を一箇所で検証しやすい'],
          cautions: ['用途が違う重複を誤って統合しない確認が必要']
        },
        {
          id: 'separate-behavior-variants',
          label: '方針B: 用途差分を明示して責務を分ける',
          target_count: opportunity.target_count,
          candidate_files: opportunity.target_files,
          benefits: ['暗黙の差分をStoryに残せる', '無理な共通化による回帰を避けやすい'],
          cautions: ['重複削減より責務明確化を優先する判断になる']
        }
      ],
      recommended_strategy: {
        id: 'extract-shared-boundary',
        reason: '同一query形状が複数ファイルで繰り返されており、まず用途一致を確認して共通境界化する価値が高い。'
      }
    }
  };
}

function parseQuerySignature(signature = '') {
  const [operationPart = '', ...parts] = String(signature).split('|');
  const [rawModel = '', operation = 'unknown'] = operationPart.split('.');
  const clauses = Object.fromEntries(parts.map((part) => {
    const separatorIndex = part.indexOf(':');
    if (separatorIndex === -1) return [part, ''];
    return [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)];
  }));
  return {
    model: normalizeModelName(rawModel),
    operation,
    where_keys: splitKeys(clauses.where),
    select_keys: splitKeys(clauses.select),
    order_keys: splitKeys(clauses.order),
    top_keys: splitKeys(clauses.top),
    raw_signature: signature
  };
}

function normalizeModelName(model) {
  return String(model ?? '')
    .replace(/^t_/, '')
    .replace(/^prisma\./, '')
    .replace(/^db\./, '');
}

function splitKeys(value) {
  if (!value || value === '-') return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function classifyQueryIntent(parsed, shape) {
  const haystack = [
    parsed.model,
    parsed.operation,
    parsed.raw_signature,
    ...(shape.files ?? [])
  ].join(' ').toLowerCase();
  if (/(user|account|profile|identity|member)/.test(haystack) && /(auth|email|login|session|credential|provider|nextauth)/.test(haystack)) {
    return 'identity_resolution';
  }
  if (/(subscription|billing|stripe|invoice|plan|customer|payment)/.test(haystack)) {
    return 'subscription_state_sync';
  }
  if (/(tenant|workspace|organization|permission|role|owner|policy|access)/.test(haystack)) {
    return 'authorization_boundary';
  }
  if (/(webhook|notification|event|audit|log|integration)/.test(haystack)) {
    return 'integration_event_policy';
  }
  return 'query_policy';
}

function buildSuggestedAbstraction(intent, parsed) {
  const labels = {
    identity_resolution: 'identity resolver/service',
    subscription_state_sync: 'subscription state sync helper',
    authorization_boundary: 'authorization boundary service',
    integration_event_policy: 'integration event repository/helper',
    query_policy: 'shared query policy helper'
  };
  return {
    id: intent,
    label: labels[intent] ?? 'shared data access helper',
    target_shape: parsed.model
      ? `${parsed.model} ${parsed.operation} query boundary`
      : 'shared query boundary'
  };
}

function buildQueryBehaviorVariants(parsed) {
  return [
    `where keys: ${parsed.where_keys.join(', ') || '-'}`,
    `select keys: ${parsed.select_keys.join(', ') || '-'}`,
    `order keys: ${parsed.order_keys.join(', ') || '-'}`
  ];
}

function intentLabel(intent) {
  const labels = {
    identity_resolution: 'identity resolution',
    subscription_state_sync: 'subscription state sync',
    authorization_boundary: 'authorization boundary',
    integration_event_policy: 'integration event policy',
    query_policy: 'DB query policy',
    responsibility_split: 'responsibility split'
  };
  return labels[intent] ?? 'shared data access';
}

function compareOpportunities(a, b) {
  return priorityRank(a.priority) - priorityRank(b.priority)
    || confidenceRank(a.confidence) - confidenceRank(b.confidence)
    || b.target_count - a.target_count
    || a.id.localeCompare(b.id);
}

function priorityRank(priority) {
  const ranks = { high: 0, medium: 1, low: 2 };
  return ranks[priority] ?? 3;
}

function confidenceRank(confidence) {
  const ranks = { high: 0, medium: 1, low: 2 };
  return ranks[confidence] ?? 3;
}

function formatSerial(value) {
  return String(value).padStart(3, '0');
}

function uniqueFiles(files) {
  return [...new Set((files ?? []).filter(Boolean))];
}
