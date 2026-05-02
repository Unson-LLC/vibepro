const INFO_GATE_EFFECT = 'info';

export function buildRefactoringOpportunities(evidence) {
  const codeQuality = evidence?.code_quality ?? {};
  const opportunities = [
    ...buildDuplicateQueryOpportunities(codeQuality.duplicate_query_shapes ?? []),
    ...buildResponsibilityHotspotOpportunities(codeQuality.responsibility_hotspots ?? [])
  ];
  return rankRefactoringOpportunities(opportunities, evidence);
}

export function buildRefactoringCampaigns(evidence) {
  const opportunities = Array.isArray(evidence?.refactoring_opportunities)
    ? evidence.refactoring_opportunities
    : [];
  const groups = new Map();
  for (const opportunity of opportunities) {
    const key = buildCampaignKey(opportunity);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(opportunity);
  }

  return [...groups.values()]
    .map((items, index) => buildRefactoringCampaign(items, index + 1))
    .sort((a, b) => b.score.total - a.score.total || a.id.localeCompare(b.id))
    .map((campaign, index) => ({
      ...campaign,
      id: `VP-CAMPAIGN-REF-${formatSerial(index + 1)}`,
      rank: index + 1
    }));
}

export function buildRefactoringActionCandidates(evidence) {
  const opportunities = Array.isArray(evidence?.refactoring_opportunities)
    ? evidence.refactoring_opportunities
    : [];
  const campaigns = Array.isArray(evidence?.refactoring_campaigns)
    ? evidence.refactoring_campaigns
    : [];
  const primaryDryOpportunity = opportunities.find((opportunity) => (
    opportunity.finding_id === 'VP-DRY-001'
    && opportunity.source === 'duplicate_query_shape'
  ));
  const primaryArchOpportunity = opportunities.find((opportunity) => (
    opportunity.finding_id === 'VP-ARCH-001'
    && opportunity.source === 'responsibility_hotspot'
  ));
  return [
    primaryDryOpportunity
      ? buildRefactoringActionCandidate({
          actionId: 'VP-ACTION-DRY-001',
          opportunity: primaryDryOpportunity,
          campaign: findCampaignForOpportunity(campaigns, primaryDryOpportunity.id)
        })
      : null,
    primaryArchOpportunity
      ? buildRefactoringActionCandidate({
          actionId: 'VP-ACTION-ARCH-001',
          opportunity: primaryArchOpportunity,
          campaign: findCampaignForOpportunity(campaigns, primaryArchOpportunity.id)
        })
      : null
  ].filter(Boolean);
}

function buildRefactoringActionCandidate({ actionId, opportunity, campaign }) {
  const title = campaign?.title ?? opportunity.title;
  return {
    id: actionId,
    finding_id: opportunity.finding_id,
    scope: 'refactoring',
    title,
    target_count: campaign?.target_count ?? opportunity.target_count,
    target_files: campaign?.target_files ?? opportunity.target_files,
    execution_policy: 'proposal_only',
    mutates_repository: false,
    confidence: opportunity.confidence,
    recommendation: campaign?.story_blueprint?.summary ?? opportunity.story_blueprint.summary,
    refactoring_opportunity_id: opportunity.id,
    refactoring_campaign_id: campaign?.id ?? null,
    story_blueprint: campaign?.story_blueprint ?? opportunity.story_blueprint,
    implementation_plan: buildRefactoringImplementationPlan(opportunity, campaign)
  };
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

function buildRefactoringImplementationPlan(opportunity, campaign = null) {
  const targetFiles = campaign?.target_files ?? opportunity.target_files;
  return {
    priority: campaign?.priority ?? opportunity.priority,
    rationale: campaign
      ? `${campaign.id} は ${campaign.opportunity_count}件の機会を束ねるStory候補。最初に ${opportunity.id} を確認する。`
      : `${opportunity.finding_id} から ${opportunity.refactoring_intent} としてStory化できる候補。対象は ${opportunity.target_count}ファイル。`,
    read_first_files: targetFiles.map((file) => ({
      file,
      reason: campaign
        ? `リファクタリングcampaign ${campaign.id} の対象ファイル`
        : `リファクタリング機会 ${opportunity.id} の対象ファイル`
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
    acceptance_criteria: campaign?.story_blueprint?.acceptance_criteria ?? opportunity.story_blueprint.acceptance_criteria,
    pre_fix_briefing: {
      opportunity: {
        id: opportunity.id,
        source: opportunity.source,
        refactoring_intent: opportunity.refactoring_intent,
        rank: opportunity.rank,
        score: opportunity.score,
        suggested_abstraction: opportunity.suggested_abstraction,
        evidence_refs: opportunity.evidence_refs
      },
      campaign: campaign
        ? {
            id: campaign.id,
            rank: campaign.rank,
            title: campaign.title,
            opportunity_ids: campaign.opportunity_ids,
            expected_diagnostic_delta: campaign.expected_diagnostic_delta
          }
        : null,
      target_files: targetFiles,
      invariants: campaign?.story_blueprint?.invariants ?? opportunity.story_blueprint.invariants,
      evidence_examples: opportunity.evidence_refs.examples ?? [],
      strategy_options: buildRefactoringStrategyOptions(opportunity, targetFiles),
      recommended_strategy: buildRefactoringRecommendedStrategy(opportunity)
    }
  };
}

function buildRefactoringStrategyOptions(opportunity, targetFiles) {
  if (opportunity.source === 'responsibility_hotspot') {
    return [
      {
        id: 'split-runtime-boundaries',
        label: '方針A: runtime責務をroute/action/service/helperへ分離する',
        target_count: targetFiles.length,
        candidate_files: targetFiles,
        benefits: ['認可、DB、検証、外部I/Oの責務境界を読みやすくできる', '副作用の順序をレビューしやすくなる'],
        cautions: ['入出力と副作用タイミングを先に固定する必要がある']
      },
      {
        id: 'extract-side-effect-boundary',
        label: '方針B: 外部I/Oや通知など副作用境界から切り出す',
        target_count: targetFiles.length,
        candidate_files: targetFiles,
        benefits: ['大きなファイルを段階的に小さくできる', 'テストしづらい副作用を隔離できる'],
        cautions: ['DB更新やレスポンス整形との順序を変えない確認が必要']
      }
    ];
  }
  return [
    {
      id: 'extract-shared-boundary',
      label: '方針A: 同じ用途の処理を共通境界へ抽出する',
      target_count: targetFiles.length,
      candidate_files: targetFiles,
      benefits: ['重複query形状を直接減らせる', '挙動変更を一箇所で検証しやすい'],
      cautions: ['用途が違う重複を誤って統合しない確認が必要']
    },
    {
      id: 'separate-behavior-variants',
      label: '方針B: 用途差分を明示して責務を分ける',
      target_count: targetFiles.length,
      candidate_files: targetFiles,
      benefits: ['暗黙の差分をStoryに残せる', '無理な共通化による回帰を避けやすい'],
      cautions: ['重複削減より責務明確化を優先する判断になる']
    }
  ];
}

function buildRefactoringRecommendedStrategy(opportunity) {
  if (opportunity.source === 'responsibility_hotspot') {
    return {
      id: 'split-runtime-boundaries',
      reason: '責務混在候補は重複削減より先に、認可、DB、検証、外部I/Oの境界を固定する価値が高い。'
    };
  }
  return {
    id: 'extract-shared-boundary',
    reason: '同一query形状が複数ファイルで繰り返されており、まず用途一致を確認して共通境界化する価値が高い。'
  };
}

function rankRefactoringOpportunities(opportunities, evidence) {
  return opportunities
    .map((opportunity) => {
      const score = scoreRefactoringOpportunity(opportunity, evidence);
      return {
        ...opportunity,
        priority: score.total >= 75 ? 'high' : score.total >= 40 ? opportunity.priority : 'low',
        score,
        priority_reasons: score.reasons
      };
    })
    .sort((a, b) => b.score.total - a.score.total || compareOpportunities(a, b))
    .map((opportunity, index) => ({
      ...opportunity,
      rank: index + 1
    }));
}

function scoreRefactoringOpportunity(opportunity, evidence) {
  const reasons = [];
  const targetFiles = opportunity.target_files ?? [];
  const occurrenceCount = opportunity.evidence_refs?.occurrence_count ?? opportunity.target_count ?? 0;
  const securityScore = scoreSecurityProximity(opportunity, targetFiles, reasons);
  const blastRadiusScore = Math.min(25, (targetFiles.length * 4) + (occurrenceCount * 2));
  if (blastRadiusScore >= 12) reasons.push(`blast_radius:${blastRadiusScore}`);
  const confidenceScore = { high: 15, medium: 10, low: 5 }[opportunity.confidence] ?? 5;
  reasons.push(`confidence:${opportunity.confidence ?? 'unknown'}`);
  const storyFitScore = scoreStoryFit(opportunity, evidence?.story, reasons);
  const sourceScore = opportunity.source === 'duplicate_query_shape' ? 8 : 5;
  const total = securityScore + blastRadiusScore + confidenceScore + storyFitScore + sourceScore;
  return {
    total,
    components: {
      security_proximity: securityScore,
      blast_radius: blastRadiusScore,
      confidence: confidenceScore,
      story_fit: storyFitScore,
      source: sourceScore
    },
    reasons
  };
}

function scoreSecurityProximity(opportunity, targetFiles, reasons) {
  const haystack = [
    opportunity.refactoring_intent,
    opportunity.title,
    ...(targetFiles ?? [])
  ].join(' ').toLowerCase();
  if (opportunity.refactoring_intent === 'authorization_boundary') {
    reasons.push('security_proximity:authorization_boundary');
    return 30;
  }
  if (/(auth|session|user|account|identity|middleware|permission|role)/.test(haystack)) {
    reasons.push('security_proximity:auth_or_identity');
    return 25;
  }
  if (/(billing|subscription|stripe|payment|invoice|webhook)/.test(haystack)) {
    reasons.push('security_proximity:billing_or_webhook');
    return 22;
  }
  if (/(api\/|route\.ts|route\.js|server)/.test(haystack)) {
    reasons.push('security_proximity:runtime_boundary');
    return 15;
  }
  return 5;
}

function scoreStoryFit(opportunity, story, reasons) {
  const patterns = extractStoryCoveragePatterns(story);
  if (patterns.length === 0) return 5;
  const targetFiles = opportunity.target_files ?? [];
  const matched = targetFiles.filter((file) => patterns.some((pattern) => matchesStoryPattern(file, pattern)));
  if (matched.length === 0) return 0;
  reasons.push(`story_fit:${matched.length}/${targetFiles.length}`);
  return Math.min(15, 5 + matched.length * 3);
}

function extractStoryCoveragePatterns(story) {
  const rawPatterns = [
    ...(story?.coverage_patterns ?? []),
    ...(story?.coveragePatterns ?? []),
    ...(story?.derived?.coverage_patterns ?? []),
    ...(story?.derived?.coveragePatterns ?? [])
  ];
  return rawPatterns
    .map((pattern) => typeof pattern === 'string' ? pattern : pattern?.path ?? pattern?.pattern ?? null)
    .filter(Boolean);
}

function matchesStoryPattern(file, pattern) {
  const normalizedFile = normalizePath(file);
  const normalizedPattern = normalizePath(pattern)
    .replace(/\*\*\/?/g, '')
    .replace(/\*/g, '');
  if (!normalizedPattern) return false;
  return normalizedFile.includes(normalizedPattern.replace(/\/$/, ''));
}

function buildCampaignKey(opportunity) {
  return `${opportunity.refactoring_intent}:${resolveCampaignDomain(opportunity)}`;
}

function resolveCampaignDomain(opportunity) {
  const haystack = [
    opportunity.title,
    opportunity.refactoring_intent,
    ...(opportunity.target_files ?? [])
  ].join(' ').toLowerCase();
  if (/(auth|session|identity|user|account|profile|member)/.test(haystack)) return 'identity';
  if (/(billing|subscription|stripe|payment|invoice|customer)/.test(haystack)) return 'billing';
  if (/(permission|role|owner|tenant|workspace|organization|policy|access)/.test(haystack)) return 'authorization';
  if (/(webhook|notification|event|integration|audit)/.test(haystack)) return 'integration';
  if (/(api\/|route\.ts|route\.js)/.test(haystack)) return 'api';
  return 'application';
}

function buildRefactoringCampaign(opportunities, serialNumber) {
  const sorted = [...opportunities].sort((a, b) => b.score.total - a.score.total || a.id.localeCompare(b.id));
  const primary = sorted[0];
  const targetFiles = uniqueFiles(sorted.flatMap((opportunity) => opportunity.target_files ?? []));
  const scoreTotal = Math.round(sorted.reduce((sum, opportunity) => sum + opportunity.score.total, 0) / sorted.length);
  const priority = scoreTotal >= 75 ? 'high' : scoreTotal >= 40 ? 'medium' : 'low';
  const storyBlueprint = buildCampaignStoryBlueprint({ primary, opportunities: sorted, targetFiles });
  return {
    id: `VP-CAMPAIGN-REF-${formatSerial(serialNumber)}`,
    title: storyBlueprint.title,
    refactoring_intent: primary.refactoring_intent,
    domain: resolveCampaignDomain(primary),
    priority,
    score: {
      total: scoreTotal,
      top_opportunity_score: primary.score.total
    },
    opportunity_count: sorted.length,
    opportunity_ids: sorted.map((opportunity) => opportunity.id),
    finding_ids: [...new Set(sorted.map((opportunity) => opportunity.finding_id))],
    target_count: targetFiles.length,
    target_files: targetFiles.slice(0, 20),
    recommended_first_opportunity_id: primary.id,
    expected_diagnostic_delta: {
      duplicate_query_shapes: sorted.filter((opportunity) => opportunity.finding_id === 'VP-DRY-001').length,
      responsibility_hotspots: sorted.filter((opportunity) => opportunity.finding_id === 'VP-ARCH-001').length
    },
    priority_reasons: uniqueFiles(sorted.flatMap((opportunity) => opportunity.priority_reasons ?? [])).slice(0, 10),
    story_blueprint: storyBlueprint
  };
}

function buildCampaignStoryBlueprint({ primary, opportunities, targetFiles }) {
  const title = `${intentLabel(primary.refactoring_intent)} campaignをStory化する`;
  return {
    title,
    summary: `${opportunities.length}件の ${primary.refactoring_intent} 機会を、診断で効果確認できるStory単位に束ねる。最初の対象は ${primary.id}。`,
    source_opportunity_ids: opportunities.map((opportunity) => opportunity.id),
    source_finding_ids: [...new Set(opportunities.map((opportunity) => opportunity.finding_id))],
    refactoring_intent: primary.refactoring_intent,
    target_files: targetFiles.slice(0, 20),
    recommended_sequence: opportunities.slice(0, 5).map((opportunity, index) => ({
      order: index + 1,
      opportunity_id: opportunity.id,
      title: opportunity.title,
      reason: opportunity.priority_reasons?.slice(0, 3) ?? []
    })),
    invariants: uniqueFiles(opportunities.flatMap((opportunity) => opportunity.story_blueprint?.invariants ?? [])).slice(0, 8),
    acceptance_criteria: [
      'campaign内の機会がStory単位として実装順に並んでいる。',
      '最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。',
      '修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。',
      ...uniqueFiles(opportunities.flatMap((opportunity) => opportunity.story_blueprint?.acceptance_criteria ?? [])).slice(0, 4)
    ],
    validation_commands: [
      'npm test -- <related tests>',
      'npm run type-check',
      'vibepro diagnose <repo>'
    ]
  };
}

function findCampaignForOpportunity(campaigns, opportunityId) {
  return campaigns.find((campaign) => campaign.opportunity_ids?.includes(opportunityId)) ?? null;
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

function normalizePath(file) {
  return String(file ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}
