const EXPERT_JUDGMENT_SCHEMA_VERSION = '0.1.0';
const EXPERT_JUDGMENT_OUTPUT_SCHEMA_VERSION = '0.2.0';
const EXPERT_JUDGMENT_RULE_VERSION = '2';

const EVIDENCE_BOUNDARY =
  'source_refs は入力のまま保持し、参照先の存在や観測を証明するかどうかは検証しません。';

const OUTCOME_SCOPE_KINDS = Object.freeze([
  'delivery_outcome_defined',
  'necessary_for_committed_job',
  'required_protection'
]);
const DECISION_AUTHORITY_KINDS = Object.freeze([
  'owner_value_choice_required',
  'existing_authority_covers_action'
]);
const CHANGE_OWNERSHIP_KINDS = Object.freeze([
  'change_scope_known',
  'shared_contract_change'
]);
const INFORMATION_BOUNDARY_KINDS = Object.freeze([
  'information_boundary_crossed',
  'recipient_scope_authorized'
]);
const EXECUTION_BOUNDARY_KINDS = Object.freeze([
  'execution_topology_known',
  'dependency_available',
  'fallback_preserves_contract',
  'production_data_isolated'
]);
const STRUCTURAL_KINDS = Object.freeze([
  'repeated_local_fixes',
  'complexity_growing',
  'outcome_improving',
  'urgent_containment'
]);
const RUNTIME_KINDS = Object.freeze([
  'capability_claimed',
  'implementation_present',
  'intended_path_observed'
]);
const EVIDENCE_KINDS = Object.freeze([
  'verification_repeating',
  'material_unknown_open',
  'next_check_changes_decision',
  'independently_required_check'
]);

const DAG_NODE_ORDER = Object.freeze([
  'outcome-scope',
  'decision-authority',
  'change-ownership',
  'information-boundary',
  'execution-boundary',
  'structural-simplification',
  'runtime-reachability',
  'evidence-decision-value'
]);

const DAG_EDGE_SOURCE = [
  {
    from: 'outcome-scope',
    to: 'decision-authority',
    reason: '成果の成立条件が、本人の価値・責任・権限を確認する文脈を与える。'
  },
  {
    from: 'outcome-scope',
    to: 'change-ownership',
    reason: '約束した成果に必要な変更かどうかが、変更責任の範囲を決める。'
  },
  {
    from: 'decision-authority',
    to: 'information-boundary',
    reason: '誰が判断できるかを確かめてから、データを誰へ共有できるかを扱う。'
  },
  {
    from: 'change-ownership',
    to: 'execution-boundary',
    reason: '変更の責任範囲を確かめてから、実行場所と依存先の境界を確認する。'
  },
  {
    from: 'information-boundary',
    to: 'execution-boundary',
    reason: '情報を扱う相手と範囲が、実行時の通信・認証・保存境界に影響する。'
  },
  {
    from: 'change-ownership',
    to: 'structural-simplification',
    reason: 'どの責任範囲を変えるのかが定まってから、構造の単純化を比較する。'
  },
  {
    from: 'execution-boundary',
    to: 'runtime-reachability',
    reason: '実行場所と依存先が分かってから、実際の経路への到達性を追う。'
  },
  {
    from: 'structural-simplification',
    to: 'runtime-reachability',
    reason: '構造の変更候補が、実際の実行経路に届くかを確認する。'
  },
  {
    from: 'outcome-scope',
    to: 'evidence-decision-value',
    reason: '何を届けるかが、確認を続ける価値と完了条件を決める。'
  },
  {
    from: 'runtime-reachability',
    to: 'evidence-decision-value',
    reason: '実行経路の観測が、次に必要な確認と判断の価値を決める。'
  }
];

const ALL_OBSERVATION_KINDS = new Set([
  ...OUTCOME_SCOPE_KINDS,
  ...DECISION_AUTHORITY_KINDS,
  ...CHANGE_OWNERSHIP_KINDS,
  ...INFORMATION_BOUNDARY_KINDS,
  ...EXECUTION_BOUNDARY_KINDS,
  ...STRUCTURAL_KINDS,
  ...RUNTIME_KINDS,
  ...EVIDENCE_KINDS
]);

function defineCatalog(definition) {
  return {
    version: EXPERT_JUDGMENT_SCHEMA_VERSION,
    ...definition,
    interpretation_status: 'candidate',
    rule_version: EXPERT_JUDGMENT_RULE_VERSION,
    provenance_ref: `curation:${definition.id}@2`
  };
}

const CATALOG_SOURCE = [
  defineCatalog({
    id: 'outcome-scope',
    name: '成果と今回の範囲',
    question: '今回届ける成果に必要な変更と、将来の拡張を分けられているか？',
    observation_kinds: OUTCOME_SCOPE_KINDS,
    observation_questions: {
      delivery_outcome_defined: '今回届ける最小の成果が定義されているか？',
      necessary_for_committed_job: 'この変更は今回約束した仕事の成立に必要か？',
      required_protection: '今回の成果に必要な権限管理や情報保護を維持する必要があるか？'
    },
    owner_principle: '人への提供を先に定め、必要な仕事を成立させる変更に範囲を絞り、必要な保護は削らない。',
    causal_model: '成果と保護要件を先に定めると、届けるための作業と将来拡張の判断を分けやすくなる。',
    counterexamples: [
      '今回の約束には含まれていなくても、横断的な修正が仕事の成立に必要になる。',
      '成果を最小化しすぎると、必要な権限管理や情報保護まで失われる。'
    ],
    hypotheses: [{
      id: 'bounded-delivery',
      claim: '届ける成果と保護要件を先に定めると、不要な拡張を延期できる。',
      prediction: '今回の成果に必要な変更と延期できる変更を、具体的な作業単位で分けられる。',
      counterexample: '横断的な変更が約束した仕事の成立条件であり、単純な範囲縮小では成立しない。'
    }]
  }),
  defineCatalog({
    id: 'decision-authority',
    name: '本人とAIの分担',
    question: 'この判断をAIが導けるのか、本人の価値・責任・権限の選択が必要なのか？',
    observation_kinds: DECISION_AUTHORITY_KINDS,
    observation_questions: {
      owner_value_choice_required: '目的・価値・責任・権限について本人の選択が必要か？',
      existing_authority_covers_action: '既に与えられた権限の範囲で、この行動を実行できるか？'
    },
    owner_principle: '本人にしか決められない価値・責任・権限を確認し、それ以外は既存の意思と事実から導く。',
    causal_model: '価値の選択と実行権限を分離すると、AIが導出できる作業と本人へ戻す判断を混同しにくくなる。',
    counterexamples: [
      '既存の権限があるように見えても、今回のデータや相手には適用されない。',
      '事実から導けるように見える選択が、実際には本人の責任の引受けを含む。'
    ],
    hypotheses: [{
      id: 'owner-agent-boundary',
      claim: '本人の価値選択と既存権限を切り分けると、AIが安全に進められる範囲が明確になる。',
      prediction: '本人へ戻す問いと、既存の意思から導いて進められる作業を分けて記述できる。',
      counterexample: '適用対象や責任の所在が不明で、既存権限だけでは行動を正当化できない。'
    }]
  }),
  defineCatalog({
    id: 'change-ownership',
    name: '変更の所属',
    question: 'この変更をどの責任範囲へ置くべきか、適用対象と契約から判断できるか？',
    observation_kinds: CHANGE_OWNERSHIP_KINDS,
    observation_questions: {
      change_scope_known: '今回変更する対象と責任範囲が分かっているか？',
      shared_contract_change: '複数の利用者や実装が共有する契約を変更するか？'
    },
    owner_principle: '変更の適用対象と契約の利用者を確かめ、責任のある場所へ変更を置く。',
    causal_model: '変更の適用対象と共有契約を分けて調べると、必要な共通化と局所変更を比較できる。',
    counterexamples: [
      '一見局所的な変更でも、共有契約の利用者が存在する。',
      '共有されているように見えても、互換性のない責任範囲へ共通化すると影響が広がる。'
    ],
    hypotheses: [{
      id: 'applicability-before-placement',
      claim: '適用対象と共有契約を確認してから変更場所を選ぶと、誤った責任範囲への修正を減らせる。',
      prediction: '候補ごとに適用対象、契約、利用者を比較し、局所配置と共有配置の理由を説明できる。',
      counterexample: '変更先を決める前に契約の利用者や互換性が確認できず、配置判断が保留になる。'
    }]
  }),
  defineCatalog({
    id: 'information-boundary',
    name: '情報の共有範囲',
    question: 'データが境界を越えるとき、対象データと受け手ごとの共有範囲を確認できているか？',
    observation_kinds: INFORMATION_BOUNDARY_KINDS,
    observation_questions: {
      information_boundary_crossed: '情報が組織・環境・担当者などの境界を越えるか？',
      recipient_scope_authorized: 'そのデータをその受け手へ共有する権限と目的があるか？'
    },
    owner_principle: '共有の可否はデータごと・受け手ごとに確認し、必要な範囲だけを共有する。',
    causal_model: 'データと受け手を明示して共有範囲を絞ると、目的のない情報流通と権限の取り違えを減らせる。',
    counterexamples: [
      '境界を越えない処理でも、受け手の権限が未確認なら目的と範囲を確認する必要がある。',
      '同じ組織や環境でも、データの目的や受け手によって共有可否が異なる。'
    ],
    hypotheses: [{
      id: 'recipient-specific-sharing',
      claim: 'データと受け手を個別に確認すると、必要な共有だけを準備できる。',
      prediction: '共有対象、受け手、目的、権限を列挙し、未承認の送信を止めた代替案を示せる。',
      counterexample: 'データの分類や受け手の権限が未確認で、共有を許可・拒否の一律規則にできない。'
    }]
  }),
  defineCatalog({
    id: 'execution-boundary',
    name: '実行と依存の境界',
    question: '処理の場所、通信、認証、保存、依存、障害時の再開点を説明できるか？',
    observation_kinds: EXECUTION_BOUNDARY_KINDS,
    observation_questions: {
      execution_topology_known: '処理がどこで動き、どこへ通信し、何を保存するか分かっているか？',
      dependency_available: '必要な依存先や実行基盤を現在利用できるか？',
      fallback_preserves_contract: '依存先が使えない場合の代替経路が契約を保てるか？',
      production_data_isolated: '本番データが検証用データや他の環境から分離されているか？'
    },
    owner_principle: '実行場所・通信・認証・保存・障害・再開を分けて確認し、依存先がなくても契約を壊さない。',
    causal_model: '実行境界と依存の代替経路を明示すると、動いているように見える構成と実際の到達可能性を区別できる。',
    counterexamples: [
      '依存先が利用できなくても、契約を保つ代替経路が存在する。',
      '検証環境では分離されていても、本番の保存先や認証経路が共有されている。'
    ],
    hypotheses: [{
      id: 'execution-contract-boundary',
      claim: '実行トポロジー、依存、フォールバック、データ分離を分けて確認すると障害境界を説明できる。',
      prediction: '処理場所、通信、認証、保存、失敗時、再開点と、依存停止時の契約を記述できる。',
      counterexample: '観測できる構成情報が不足し、依存停止時の代替が契約を満たすか判断できない。'
    }]
  }),
  defineCatalog({
    id: 'structural-simplification',
    name: '構造の単純化',
    question: '局所修正の反復が、削除・統合・再設計との比較を必要とする状態か？',
    observation_kinds: STRUCTURAL_KINDS,
    observation_questions: {
      repeated_local_fixes: '同じ領域で局所修正が繰り返されているか？',
      complexity_growing: '実装の複雑性が増えているか？',
      outcome_improving: '意図した成果が改善しているか？',
      urgent_containment: '構造を比較する前に緊急の被害封じ込めが必要か？'
    },
    owner_principle: '局所修正の反復と複雑性の増加が成果を改善していないなら、構造の比較を優先する。',
    causal_model: '局所修正が共通構造を温存すると、例外と保守負担が累積することがある。',
    counterexamples: [
      '修正が実際に独立しており、共通構造が安定している。',
      '新しい抽象化が、観測された保守負担を上回る結合や移行リスクを生む。'
    ],
    hypotheses: [{
      id: 'structural-pressure',
      claim: '局所修正の反復と複雑性の増加は、構造上の圧力を示すことがある。',
      prediction: '単純化の選択肢を比較すると、別の局所修正より例外や保守負担が少ないことを確認できる。',
      counterexample: '次の局所修正が独立していて複雑性が増えず、共通化が結合を増やす。'
    }]
  }),
  defineCatalog({
    id: 'runtime-reachability',
    name: '実行経路への到達',
    question: '実装された能力が、意図した実行経路に到達しているか？',
    observation_kinds: RUNTIME_KINDS,
    observation_questions: {
      capability_claimed: 'この能力が意図した振る舞いとして主張されているか？',
      implementation_present: '現在のコードにこの能力が実装されているか？',
      intended_path_observed: '実行時に意図した経路を観測できたか？'
    },
    owner_principle: '実装の存在と、意図した実行経路での効果を分けて確認する。到達性は受け手の価値の証明ではない。',
    causal_model: '実装があっても意図した呼び出し経路に到達しなければ、意図した効果は出ない。',
    counterexamples: [
      '観測した経路が有効な代替入口で、名前付きの経路は説明用にすぎない。',
      '文書化されたトリガーや設定が整うまで、能力を意図的に休止している。'
    ],
    hypotheses: [{
      id: 'unreached-capability',
      claim: '主張する能力と実際の提供範囲・実行経路には差異がある可能性がある。',
      prediction: '実装、呼び出し元、設定、提供範囲を追跡すると、どこで差異が生じているか区別できる。',
      counterexample: '意図した経路と提供範囲が一致しているか、現在の設定では能力を意図的に休止している。'
    }]
  }),
  defineCatalog({
    id: 'evidence-decision-value',
    name: '次の検証の価値',
    question: '次の確認が設計や採否の判断を変えるか、また独立した必須確認か？',
    observation_kinds: EVIDENCE_KINDS,
    observation_questions: {
      verification_repeating: '同じ確認が繰り返されているか？',
      material_unknown_open: '重大な未確認事項が残っているか？',
      next_check_changes_decision: '次の確認で判断が変わる可能性があるか？',
      independently_required_check: '判断を変えなくても独立して必要な確認か？'
    },
    owner_principle: '追加の確認は、未解決の判断を変え得るか、独立して必要な理由がある場所に使う。',
    causal_model: '採否や設計を変えない確認の反復は、不確実性を減らさないまま遅延を増やすことがある。',
    counterexamples: [
      '独立した監査、安全上の義務、再現性の記録のために、確認の反復が必要である。',
      '判断を変えないように見える次の確認が、これまでモデル化していなかった重大な未確認事項を見つける。'
    ],
    hypotheses: [{
      id: 'decision-linked-verification',
      claim: '確認は、未解決の判断を変え得るか独立した必須理由があるときに価値が高い。',
      prediction: '判断に結びついた確認または独立した必須確認によって、未確認事項が減るか選択肢が変わる。',
      counterexample: '確認の反復に独立した必須理由があるか、判断を変えないはずの確認が重大な未確認事項を見つける。'
    }]
  })
];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const EXPERT_JUDGMENT_CATALOG = deepFreeze(CATALOG_SOURCE);
export const EXPERT_JUDGMENT_SCHEMA = EXPERT_JUDGMENT_SCHEMA_VERSION;
export const EXPERT_JUDGMENT_OUTPUT_SCHEMA = EXPERT_JUDGMENT_OUTPUT_SCHEMA_VERSION;
export const EXPERT_JUDGMENT_DAG = deepFreeze({
  nodes: [...DAG_NODE_ORDER],
  order: [...DAG_NODE_ORDER],
  edges: DAG_EDGE_SOURCE.map((edge) => ({ ...edge }))
});

export function suggestExpertJudgments(input) {
  const normalized = validateExpertJudgmentInput(input);
  const evaluated = new Map();
  const nodes = EXPERT_JUDGMENT_CATALOG.map((catalog) => {
    const node = buildNode(catalog, normalized, evaluated);
    evaluated.set(catalog.id, node);
    return node;
  });

  return {
    schema_version: EXPERT_JUDGMENT_OUTPUT_SCHEMA_VERSION,
    input_schema_version: normalized.schema_version,
    case_id: normalized.case_id,
    advisory: true,
    blocking: false,
    profile_status: 'candidate',
    evidence_boundary: EVIDENCE_BOUNDARY,
    dag: EXPERT_JUDGMENT_DAG,
    observations: normalized.observations.map((observation) => ({
      id: observation.id,
      kind: observation.kind,
      value: observation.value,
      source_refs: [...observation.source_refs]
    })),
    nodes
  };
}

export function validateExpertJudgmentInput(input) {
  assertPlainObject(input, 'input');
  if (input.schema_version !== EXPERT_JUDGMENT_SCHEMA_VERSION) {
    throw new Error(`対応していない expert judgment の schema_version です: ${String(input.schema_version)}`);
  }
  requireText(input.case_id, 'case_id');
  if (!Array.isArray(input.observations)) {
    throw new Error('observations は配列で指定してください');
  }

  const kinds = new Set();
  const ids = new Set();
  const observations = input.observations.map((observation, index) => {
    assertPlainObject(observation, `observations[${index}]`);
    requireText(observation.id, `observations[${index}].id`);
    if (ids.has(observation.id)) {
      throw new Error(`観測の id が重複しています: ${observation.id}`);
    }
    ids.add(observation.id);
    if (!ALL_OBSERVATION_KINDS.has(observation.kind)) {
      throw new Error(`observations[${index}].kind は定義済みの種類で指定してください: ${[...ALL_OBSERVATION_KINDS].join(', ')}`);
    }
    if (kinds.has(observation.kind)) {
      throw new Error(`観測の kind が重複しています: ${observation.kind}`);
    }
    kinds.add(observation.kind);
    if (typeof observation.value !== 'boolean') {
      throw new Error(`observations[${index}].value は true または false で指定してください`);
    }

    let sourceRefs = [];
    if (observation.source_refs !== undefined && observation.source_refs !== null) {
      if (!Array.isArray(observation.source_refs)) {
        throw new Error(`observations[${index}].source_refs は文字列の配列で指定してください`);
      }
      sourceRefs = observation.source_refs.map((sourceRef, sourceIndex) => {
        if (typeof sourceRef !== 'string') {
          throw new Error(`observations[${index}].source_refs[${sourceIndex}] は文字列で指定してください`);
        }
        return sourceRef;
      }).filter((sourceRef) => sourceRef.trim().length > 0);
    }

    return {
      id: observation.id,
      kind: observation.kind,
      value: observation.value,
      source_refs: sourceRefs
    };
  });

  return {
    schema_version: EXPERT_JUDGMENT_SCHEMA_VERSION,
    case_id: input.case_id,
    observations,
    byKind: new Map(observations.map((observation) => [observation.kind, observation]))
  };
}

function buildNode(catalog, normalized, evaluated) {
  const states = Object.fromEntries(catalog.observation_kinds.map((kind) => [kind, observationState(normalized.byKind.get(kind))]));
  let decision;
  if (catalog.id === 'outcome-scope') {
    decision = decideOutcomeScope(states);
  } else if (catalog.id === 'decision-authority') {
    decision = decideDecisionAuthority(states);
  } else if (catalog.id === 'change-ownership') {
    decision = decideChangeOwnership(states);
  } else if (catalog.id === 'information-boundary') {
    decision = decideInformationBoundary(states);
  } else if (catalog.id === 'execution-boundary') {
    decision = decideExecutionBoundary(states);
  } else if (catalog.id === 'structural-simplification') {
    decision = decideStructuralSimplification(states);
  } else if (catalog.id === 'runtime-reachability') {
    decision = decideRuntimeReachability(states);
  } else {
    decision = decideEvidenceDecisionValue(states);
  }

  const ancestors = ancestorIds(catalog.id)
    .map((nodeId) => evaluated.get(nodeId))
    .filter(Boolean);
  const pendingAncestors = ancestors.filter((node) => (
    node.status === 'insufficient'
    || node.context_requirements.length > 0
    || (node.status === 'proposed' && node.unknowns.length > 0)
  ));
  const upstreamUnknowns = pendingAncestors.map((node) => ({
    node_id: node.node_id,
    unknowns: [...node.unknowns],
    status: node.status,
    context_requirements: [...node.context_requirements]
  }));
  const contextStatus = upstreamUnknowns.length > 0 ? 'unresolved' : 'available';

  if (catalog.id === 'evidence-decision-value') {
    decision = guardEvidenceCompletion(decision, upstreamUnknowns);
  }

  const evidenceRefs = unique(catalog.observation_kinds.flatMap((kind) => states[kind].source_refs));
  const adoptionStatus = decision.status === 'not_applicable' && contextStatus === 'available'
    ? 'not_applicable'
    : decision.status === 'proposed'
      && contextStatus === 'available'
      && decision.unknowns.length === 0
      && decision.context_requirements.length === 0
      ? 'candidate'
      : 'conditional';

  return {
    node_id: catalog.id,
    version: catalog.version,
    name: catalog.name,
    question: catalog.question,
    observation_kinds: [...catalog.observation_kinds],
    owner_principle: catalog.owner_principle,
    interpretation_status: catalog.interpretation_status,
    rule_version: catalog.rule_version,
    provenance_ref: catalog.provenance_ref,
    depends_on: directDependencies(catalog.id),
    context_status: contextStatus,
    upstream_unknowns: upstreamUnknowns,
    adoption_status: adoptionStatus,
    status: decision.status,
    finding: decision.finding,
    causal_model: catalog.causal_model,
    hypotheses: catalog.hypotheses.map((hypothesis) => ({ ...hypothesis })),
    counterexamples: [...catalog.counterexamples],
    options: decision.options,
    next_checks: normalizeNextChecks(catalog, decision),
    evidence_refs: evidenceRefs,
    unknowns: decision.unknowns,
    context_requirements: decision.context_requirements,
    evidence_boundary: EVIDENCE_BOUNDARY,
    advisory: true,
    blocking: false
  };
}

function directDependencies(nodeId) {
  return DAG_EDGE_SOURCE.filter((edge) => edge.to === nodeId).map((edge) => edge.from);
}

function ancestorIds(nodeId) {
  const ancestors = new Set();
  const visit = (current) => {
    for (const edge of DAG_EDGE_SOURCE.filter((candidate) => candidate.to === current)) {
      if (ancestors.has(edge.from)) continue;
      ancestors.add(edge.from);
      visit(edge.from);
    }
  };
  visit(nodeId);
  return DAG_NODE_ORDER.filter((candidate) => ancestors.has(candidate));
}

function guardEvidenceCompletion(decision, upstreamUnknowns) {
  if (upstreamUnknowns.length === 0) return decision;
  const finish = decision.options.some((candidate) => candidate.id === 'finish-and-move-on');
  if (!finish) return decision;
  return {
    ...decision,
    finding: `${decision.finding} 上流の未解決事項があるため、全体の完了とは扱いません。`,
    options: [
      option('resolve-upstream-unknowns', '上流の未確認事項と未成立の前提を解消する。'),
      option('continue-unblocked-work', '上流の判断に依存しない作業は続ける。')
    ],
    next_checks: [{
      kind: 'resolve-upstream-unknowns',
      question: '上流ノードの未確認事項と未成立の前提を確認する。'
    }]
  };
}

function normalizeNextChecks(catalog, decision) {
  let checks = decision.next_checks;
  if (checks.length === 0 && decision.status === 'proposed') {
    checks = [hypothesisCheck(catalog)];
  }
  return checks.map((check) => {
    if (typeof check !== 'string') return { ...check };
    return {
      kind: check,
      question: catalog.observation_questions[check]
    };
  });
}

function hypothesisCheck(catalog) {
  const hypothesis = catalog.hypotheses[0];
  return {
    kind: 'hypothesis_check',
    question: 'この仮説の予測が観測に合うか、反証条件に当たらないかを確認する。',
    prediction: hypothesis.prediction,
    counterexample: hypothesis.counterexample
  };
}

function observationState(observation) {
  if (!observation || observation.source_refs.length === 0) {
    return { status: 'unknown', value: null, source_refs: [] };
  }
  return {
    status: 'known',
    value: observation.value,
    source_refs: [...observation.source_refs]
  };
}

function decideOutcomeScope(states) {
  const delivery = states.delivery_outcome_defined;
  const necessary = states.necessary_for_committed_job;
  const protection = states.required_protection;
  const unknowns = unknownKinds(states);

  if (protection.status === 'known' && protection.value === true) {
    return proposed(
      '成果の範囲にかかわらず、必要な権限管理や情報保護を維持します。',
      [option('preserve-required-protection', '必要な権限管理と情報保護を残したまま、他の範囲を判断する。')],
      unknowns,
      delivery.status === 'known' && delivery.value === false
        ? [{ kind: 'define-minimum-outcome', question: '保護を維持したうえで、今回の受け手・仕事・期限・最小成果を定義する。' }]
        : [],
      delivery.status === 'known' && delivery.value === false ? ['outcome-not-defined'] : []
    );
  }
  if (unknowns.length > 0) {
    return insufficient(unknowns, '成果の成立条件と保護要件がすべて確認できていません。');
  }
  if (delivery.value === false) {
    return proposed(
      '今回届ける最小の成果を先に定義します。',
      [option('define-minimum-outcome', '今回の受け手・仕事・期限に対応する最小の成果を定義する。')],
      unknowns,
      [],
      ['outcome-not-defined']
    );
  }
  if (necessary.value === true) {
    return proposed(
      '今回約束した仕事を成立させる最小の変更を優先します。',
      [option('deliver-minimum-outcome', '約束した仕事に必要な最小の成果を届ける。')],
      unknowns
    );
  }
  return proposed(
    '今回の仕事に必要でない拡張は、約束した成果の後へ延期します。',
    [option('defer-expansion', '将来の一般化や追加機能を、今回の成果の後へ延期する。')],
    unknowns,
    [],
    ['deferred-from-current-scope']
  );
}

function decideDecisionAuthority(states) {
  const choice = states.owner_value_choice_required;
  const authority = states.existing_authority_covers_action;
  const unknowns = unknownKinds(states);

  if (choice.status === 'unknown') {
    return insufficient(unknowns, '本人の価値・責任・権限の選択が必要か確認できていません。');
  }
  if (choice.value === true) {
    return proposed(
      '目的・価値・責任・権限に関わるため、本人の選択を確認します。',
      [option('ask-owner-choice', '本人に目的・価値・責任・権限の選択を確認する。')],
      unknowns,
      [],
      ['owner-choice-pending']
    );
  }
  if (authority.status === 'unknown') {
    return insufficient(unknowns, 'この行動が既存の権限の範囲内か確認できていません。');
  }
  if (authority.value === false) {
    return proposed(
      '既存の権限では行動を正当化できないため、行動の権限を解決します。',
      [option('resolve-action-authority', '対象と行動に適用される権限を確認し、必要なら本人へ戻す。')],
      unknowns,
      [],
      ['action-authority-missing']
    );
  }
  return proposed(
    '本人の価値選択は不要で、既存の権限の範囲から行動を導けます。',
    [option('derive-and-proceed', '既存の意思・事実・権限の範囲内で導出して進める。')],
    unknowns
  );
}

function decideChangeOwnership(states) {
  const scope = states.change_scope_known;
  const shared = states.shared_contract_change;
  const unknowns = unknownKinds(states);

  if (scope.status === 'unknown') {
    return insufficient(unknowns, '変更の対象と責任範囲が確認できていません。');
  }
  if (scope.value === false) {
    return proposed(
      '変更を置く責任範囲を先に特定します。',
      [option('locate-change-owner', '適用対象、契約、利用者を確認して変更の責任者を特定する。')],
      unknowns,
      [],
      ['change-owner-unresolved']
    );
  }
  if (shared.status === 'unknown') {
    return insufficient(unknowns, '共有契約を変更するか確認できていません。');
  }
  if (shared.value === true) {
    return proposed(
      '共有契約の利用者と互換性を比較して、共有場所と局所場所を選びます。',
      [option('compare-shared-placement', '適用対象・契約・利用者を比較し、共有配置の影響を確認する。')],
      unknowns
    );
  }
  return proposed(
    '共有契約を変えないため、責任範囲内に変更を保ちます。',
    [option('keep-local-change', '今回の適用対象と責任範囲に変更を留める。')],
    unknowns
  );
}

function decideInformationBoundary(states) {
  const crossed = states.information_boundary_crossed;
  const recipient = states.recipient_scope_authorized;
  const unknowns = unknownKinds(states);

  if (crossed.status === 'unknown') {
    return insufficient(unknowns, '情報が境界を越えるか確認できていません。');
  }
  if (crossed.value === false) {
    return notApplicable('情報が境界を越えないため、共有送信の提案は適用対象外です。', unknowns);
  }
  if (recipient.status === 'unknown') {
    return insufficient(unknowns, 'データと受け手ごとの共有権限が確認できていません。');
  }
  if (recipient.value === false) {
    return proposed(
      '受け手への共有権限がないため、データを所有範囲に留めます。',
      [option('keep-with-owner', '送信せず、必要なら匿名化・削除・明示承認後の共有案を準備する。')],
      unknowns,
      [],
      ['recipient-scope-unauthorized']
    );
  }
  return proposed(
    '共有権限を確認したうえで、目的に必要な最小限のデータだけを扱います。',
    [option('minimize-shared-data', 'データ、受け手、目的を確認し、共有範囲を最小化する。')],
    unknowns
  );
}

function decideExecutionBoundary(states) {
  const topology = states.execution_topology_known;
  const dependency = states.dependency_available;
  const fallback = states.fallback_preserves_contract;
  const production = states.production_data_isolated;
  const unknowns = unknownKinds(states);

  if (topology.status === 'unknown') {
    return insufficient(unknowns, '実行場所、通信、認証、保存、障害、再開の境界が確認できていません。');
  }
  if (topology.value === false) {
    return proposed(
      '実行場所、通信、認証、保存、障害、再開の境界を先に整理します。',
      [option('map-execution-boundaries', '処理段階ごとの実行場所と失敗・再開点を記述する。')],
      unknowns,
      [],
      ['execution-topology-unmapped']
    );
  }
  if (production.status === 'known' && production.value === false) {
    return proposed(
      '本番データを検証用データや他の環境から分離する境界を設けます。',
      [option('separate-production-data', '本番データの保存・認証・接続境界を分離する。')],
      unknowns,
      [],
      ['production-data-not-isolated']
    );
  }
  if (production.status === 'unknown') {
    return insufficient(unknowns, '本番データの分離状態が確認できていません。');
  }
  if (dependency.status === 'unknown') {
    return insufficient(unknowns, '必要な依存先が現在利用できるか確認できていません。');
  }
  if (dependency.value === false && fallback.status === 'unknown') {
    return insufficient(unknowns, '依存先が使えない場合に契約を保てるか確認できていません。');
  }
  if (dependency.value === false && fallback.value === false) {
    return proposed(
      '依存先が使えず、代替経路も契約を保てないため、依存を除去または置換します。',
      [option('remove-or-replace-dependency', '依存先を除去するか、契約を保てる代替へ置き換える。')],
      unknowns,
      [],
      ['dependency-contract-unmet']
    );
  }
  if (dependency.value === false && fallback.value === true) {
    return proposed(
      '依存先が使えない場合にも契約を保てる代替経路を比較します。',
      [option('compare-fallback-path', '依存停止時の代替経路を実行し、契約と再開点を比較する。')],
      unknowns
    );
  }
  return notApplicable(
    '依存先が利用できるため、依存停止時のフォールバック比較は現時点で適用対象外です。',
    unknowns
  );
}

function decideStructuralSimplification(states) {
  const repeated = states.repeated_local_fixes;
  const complexity = states.complexity_growing;
  const outcome = states.outcome_improving;
  const urgent = states.urgent_containment;
  const unknowns = unknownKinds(states);

  if (repeated.status === 'known' && repeated.value === false) {
    return notApplicable('局所修正の反復が観測されないため、構造の単純化は適用対象外です。', unknowns);
  }
  if (complexity.status === 'known' && complexity.value === false) {
    return notApplicable('複雑性の増加が観測されないため、構造の単純化は適用対象外です。', unknowns);
  }
  if (outcome.status === 'known' && outcome.value === true) {
    return notApplicable('意図した成果が改善しているため、これらの観測だけでは構造の単純化を提案しません。', unknowns);
  }

  const prerequisiteUnknowns = unknownKinds({
    repeated_local_fixes: repeated,
    complexity_growing: complexity,
    outcome_improving: outcome
  });
  if (prerequisiteUnknowns.length > 0) {
    return insufficient(unknowns, '構造上の圧力を判断する前提が十分に確認できていません。', prerequisiteUnknowns);
  }
  if (urgent.status === 'unknown') {
    return insufficient(unknowns, '緊急性が未確認のため、封じ込めと構造比較の順序を決められません。', ['urgent_containment']);
  }
  if (urgent.value === true) {
    return proposed(
      '緊急の影響を先に封じ込め、その後で追加修正と削除・統合・再設計を比較します。',
      [
        option('containment-first', '構造を変える前に現在の影響を封じ込める。'),
        option('structural-comparison-after-containment', '封じ込め後に、追加の局所修正と削除・統合・再設計を比較する。')
      ],
      unknowns,
      [{
        kind: 'post-containment-structural-comparison',
        question: '被害を封じ込めた後、局所修正と削除・統合・再設計の比較結果を確認する。'
      }]
    );
  }
  return proposed(
    '別の例外を追加する前に、もう一度局所修正する案と削除・統合・再設計を比較します。',
    [
      option('additional-local-fix', 'もう一度局所修正し、新たな例外や保守費用を記録する。'),
      option('simplification-comparison', '局所修正案と削除・統合・再設計を比較する。')
    ],
    unknowns
  );
}

function decideRuntimeReachability(states) {
  const claimed = states.capability_claimed;
  const implementation = states.implementation_present;
  const path = states.intended_path_observed;
  const unknowns = unknownKinds(states);

  if (implementation.status === 'known' && implementation.value === false
    && path.status === 'known' && path.value === true) {
    return insufficient(
      [...unknowns, 'runtime-scope-consistency'],
      '実装がないという観測と意図した経路の観測が矛盾しています。同じ能力と範囲を見ているか確認してください。',
      [{
        kind: 'runtime-scope-consistency',
        question: '実装の有無と実行経路が、同じ能力と範囲を対象にしているか確認する。'
      }]
    );
  }
  if (path.status === 'known' && path.value === true) {
    return notApplicable('意図した実行経路が観測されました。ただし、このノードは受け手の価値やすべての場合の正しさを証明しません。', unknowns);
  }
  if (claimed.status === 'known' && claimed.value === false) {
    return notApplicable('この観測では能力が主張されていないため、実行経路の提案は適用対象外です。', unknowns);
  }
  if (claimed.status === 'unknown') {
    return insufficient(unknowns, '能力の主張が未確認のため、実装の有無から提案を決められません。', ['capability_claimed']);
  }
  if (implementation.status === 'known' && implementation.value === false) {
    return proposed(
      '能力を未実装または利用不能として扱い、要件と実装を比較します。',
      [
        option('requirements-implementation-comparison', '主張された要件と現在の実装境界を比較する。'),
        option('implement-or-remove-claim', '能力を実装するか、主張と期待する経路を見直す。')
      ],
      unknowns
    );
  }
  if (claimed.status === 'known' && claimed.value === true
    && implementation.status === 'known' && implementation.value === true
    && path.status === 'known' && path.value === false) {
    return proposed(
      '実装の存在と実効的な実行を分け、呼び出し元・トリガー・意図した経路を調べます。',
      [
        option('trace-callers-and-trigger', '呼び出し元、トリガー、設定、実行経路を追跡する。'),
        option('verify-observed-effect', '意図した経路を実行または計測し、観測した効果と主張を比較する。')
      ],
      unknowns
    );
  }
  if (unknowns.length > 0) {
    return insufficient(unknowns, '能力、実装、意図した実行経路がすべて確認できていません。');
  }
  return notApplicable('観測された事実からは、実行経路の懸念は選ばれません。', unknowns);
}

function decideEvidenceDecisionValue(states) {
  const repeating = states.verification_repeating;
  const material = states.material_unknown_open;
  const changes = states.next_check_changes_decision;
  const required = states.independently_required_check;
  const unknowns = unknownKinds(states);

  if (required.status === 'known' && required.value === true) {
    const options = [option('required-check', '判断が変わらなくても独立して必要な確認を実施し、理由を記録する。')];
    if ((material.status === 'known' && material.value === true)
      || (changes.status === 'known' && changes.value === true)) {
      options.push(option('decision-linked-check', '重大な未確認事項を解消するか判断を変えられる確認を行う。'));
    }
    options.push(option('continue-unblocked-work', '未解決の判断に依存しない作業を続ける。'));
    return proposed('独立して必要な確認を優先し、判断に結びつく確認も分けて扱います。', options, unknowns);
  }
  if (material.status === 'known' && material.value === true
    || changes.status === 'known' && changes.value === true) {
    return proposed(
      '未解決の判断に結びつく確認を優先し、関係しない作業は続けます。',
      [
        option('decision-linked-check', '重大な未確認事項を解消するか判断を変えられる確認を行う。'),
        option('continue-unblocked-work', '未解決の判断に依存しない作業を続ける。')
      ],
      unknowns
    );
  }
  if (repeating.status === 'known' && repeating.value === true
    && material.status === 'known' && material.value === false
    && changes.status === 'known' && changes.value === false
    && required.status === 'known' && required.value === false) {
    return proposed(
      '次の確認で判断が変わる見込みがなく、独立した必須確認もないため、現在の確認を終えて次の作業へ進みます。',
      [
        option('finish-and-move-on', '現在の確認結果を記録し、次の作業へ進む。'),
        option('bounded-exception-check', '新たに判断を変える理由が出た場合だけ、範囲を限定して追加確認する。')
      ],
      unknowns,
      [{
        kind: 'reopen-condition',
        question: '新たな重大な未確認事項や判断を変える根拠が出た場合だけ、確認を再開する。'
      }]
    );
  }
  if (repeating.status === 'known' && repeating.value === true
    && material.status === 'known' && material.value === false
    && changes.status === 'known' && changes.value === false
    && required.status === 'unknown') {
    return insufficient(
      unknowns,
      '判断を変えなくても独立して必要な確認か未確認のため、完了して次へ進む提案はできません。',
      ['independently_required_check']
    );
  }
  if (repeating.status === 'known' && repeating.value === false
    && material.status === 'known' && material.value === false
    && changes.status === 'known' && changes.value === false
    && required.status === 'known' && required.value === false) {
    return notApplicable('確認は繰り返されておらず、判断に結びつく重大な未確認事項もないため、適用対象外です。', unknowns);
  }

  if (unknowns.length > 0) {
    return insufficient(unknowns, '追加確認の価値を判断するための観測が足りません。');
  }
  return notApplicable('判断に結びつく確認の懸念は観測されません。', unknowns);
}

function unknownKinds(states) {
  return Object.entries(states)
    .filter(([, state]) => state.status === 'unknown')
    .map(([kind]) => kind);
}

function proposed(finding, options, unknowns = [], next_checks = [], context_requirements = []) {
  return { status: 'proposed', finding, options, unknowns, next_checks, context_requirements };
}

function insufficient(unknowns, finding, next_checks = unknowns, context_requirements = []) {
  return { status: 'insufficient', finding, options: [], unknowns, next_checks, context_requirements };
}

function notApplicable(finding, unknowns = []) {
  return { status: 'not_applicable', finding, options: [], unknowns, next_checks: [], context_requirements: [] };
}

function option(id, summary) {
  return { id, summary };
}

function unique(values) {
  return [...new Set(values)];
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} は空でない文字列で指定してください`);
  }
}

export function renderExpertJudgmentSummary(result) {
  const lines = [
    `専門判断の提案: ${result.case_id}`,
    `プロファイル: ${result.profile_status}`,
    `助言のみ: ${result.advisory}`,
    `ブロック: ${result.blocking}`
  ];
  for (const node of result.nodes) {
    lines.push(`- ${node.node_id}: ${node.status} / ${node.adoption_status} — ${node.finding}`);
    if (node.unknowns.length > 0) lines.push(`  未確認: ${node.unknowns.join(', ')}`);
    if (node.context_status === 'unresolved') {
      lines.push(`  上流の未解決: ${node.upstream_unknowns.map((item) => item.node_id).join(', ')}`);
    }
  }
  lines.push('最終判断は人または呼び出し元にあり、自動採用は行いません。', '');
  return `${lines.join('\n')}\n`;
}
