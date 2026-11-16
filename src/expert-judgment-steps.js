// Curated decision candidates, not a model of the owner's behavior or an executor.
function step(id, kind, question, ifTrue, ifFalse, repairCheck, extra = {}) {
  return { id, kind, question, if_true: ifTrue, if_false: ifFalse, repair_check: repairCheck, ...extra };
}

const PATHS = [
  {
    id: 'target-alignment', node_id: 'outcome-scope', name: '対象の一致を確かめる',
    activation_question: '似た資料・機能・入口を、今回の対象と取り違える可能性があるか？',
    causal_model: '対象が違うまま詳細化すると、実装が正しくても依頼した成果に届かない。',
    counterexample: '同じ製品でも入口や利用者の仕事が異なる。名称一致だけでは十分ではない。',
    steps: [
      step('product-scope', 'same_product_and_scope', '依頼された製品・機能・責任範囲と、候補資料や実装の対象は同じか？',
        '対象製品の一致を保って、利用者の入口と状態を照合する。',
        '候補の詳細化を止め、依頼された対象の資料・実装を探し直す。',
        '依頼の対象と候補の対象を並べ、別機能の資料を根拠にしていないか照合する。'),
      step('entry-state', 'same_entry_and_state', '同じ入口から、同じ利用段階・状態で使う体験を比較しており、別のデモ画面へのリンクで代用していないか？',
        '同じ入口・状態で利用者が達成する仕事を照合する。',
        '投稿・設定など別の導線を分け、今回の入口から到達する画面を追う。',
        '今回の入口からの遷移を追い、比較対象の画面と利用段階が一致するか確認する。'),
      step('actor-job', 'same_actor_and_job', 'その入口の利用者と達成したい仕事は、今回の依頼と一致するか？',
        'この対象で詳細設計を比較する候補に進む。',
        '誰が何を終えるための体験かを修正し、受入条件を組み直す。',
        '利用者・仕事・完了状態を依頼と候補で対比し、同じ成果を評価しているか確認する。')
    ]
  },
  {
    id: 'existing-mechanism', node_id: 'structural-simplification', name: '既存方式の再利用を判断する',
    activation_question: '同じ機能やプロセスの重複、既存方式を使える可能性があるか？',
    causal_model: '既存の集約方式と契約を調べずに追加すると、起動元や状態管理が重複しやすい。',
    counterexample: '似た機能でも認証・隔離・障害責任が異なれば、集約が契約を壊す。',
    steps: [
      step('existing-path', 'existing_mechanism_present', '同じ仕事を既に担う集約先・実装・運用方式が存在するか？',
        '既存方式の起動元・契約と今回の対象を比較する。',
        '調査範囲では既存方式がないことを残し、局所実装と新設を比較する。',
        '既存設定・呼び出し元・類似実装を調べ、集約先があるか確認する。', { false_terminal: true }),
      step('contract-fit', 'existing_mechanism_contract_compatible', '既存方式は今回の認証・データ隔離・利用者・履歴・固有の判定・障害時の契約を保てるか？',
        '既存方式への統合で、独立して管理する状態が減るか比較する。',
        '一律に統合せず、契約を保つ局所実装か明示的な接続境界を比較する。',
        '既存方式と今回の対象で、認証・保存・会話履歴・固有の判定・失敗と再開の契約を対比する。', { false_terminal: true }),
      step('state-reduction', 'reuse_reduces_independent_state', '再利用すると、独立した起動元・設定・保存状態が減り、新たな結合を増やさないか？',
        '既存方式の再利用を候補とし、移行後の重複解消を確認する。',
        '再利用を目的化せず、局所維持と削除・統合の費用を比較する。',
        '移行前後の起動元・設定・状態と障害範囲を比較する。', { false_terminal: true })
    ]
  },
  {
    id: 'recurrence-prevention', node_id: 'runtime-reachability', name: '現在の修復と再発経路を分ける',
    activation_question: '意図しない状態を直した後、原因や再発経路を確認する必要があるか？',
    causal_model: '現在値だけを直しても、その値を生成する設定・処理が残れば元に戻り得る。',
    counterexample: '過去の一回限りの操作が原因なら、不要な常設制御の追加は負担を増やす。',
    steps: [
      step('current-state', 'current_state_restored', '対象の現在状態を観測し、必要な被害封じ込めが成立しているか？',
        '現在値の修復と分けて、その状態を作った原因を調べる。',
        '既存権限内で現在の影響を封じ込める案を優先する。',
        '対象・現在値・影響範囲をreadbackし、封じ込めの成立を確認する。'),
      step('state-origin', 'state_origin_identified', '意図しない状態を作った操作・継承・設定・自動処理を、履歴と現設定から特定できたか？',
        '特定した生成経路が再実行された場合の状態を調べる。',
        '原因を決めつけず、作成元・継承元・変更履歴・自動処理を突き合わせる。',
        '現在値だけでなく生成元と変更履歴を照合し、原因候補を区別する。'),
      step('reentry', 'recurrence_path_controlled', '再作成・同期・再起動など原因経路の再実行でも、意図した状態を維持できるか？',
        '確認した経路と条件の範囲だけで、再発対策の候補を評価する。',
        '現在値を再修正するだけでなく、状態を戻す生成元の変更案を比較する。',
        '権限と環境を守った再現、または設定・履歴の照合で、原因経路の再実行後の状態を確認する。')
    ]
  },
  {
    id: 'interaction-contract', node_id: 'outcome-scope', name: '利用者の自然な操作から状態を決める',
    activation_question: '入力の初期値・選択・表示・クリアが、利用者の仕事を左右する画面か？',
    causal_model: '利用者の主な仕事を起点に初期値と表示条件を決めると、未選択の矛盾や不要な入力を減らせる可能性がある。',
    counterexample: '利用者によって主な仕事が違う場合、推測した初期値が誤操作や意図しない確定につながる。',
    steps: [
      step('primary-job', 'primary_user_job_known', '誰が何をするための画面か、主な利用状況を依頼・運用・利用観測から特定できたか？',
        'その利用状況で自然な初期状態を比較する。',
        '慣例だけで値を決めず、利用者の仕事と誤選択時の影響を調べる。',
        '依頼・運用・利用観測を照合し、主な仕事と別の利用状況を区別する。'),
      step('defaults', 'defaults_match_primary_job', '初期値が主な仕事に合い、未選択による矛盾や意図しない確定を避けられるか？',
        '選択したモードに応じた入力表示へ進む。',
        '主な仕事に合う初期値と、未選択を残す必要がある項目を分けて設計する。',
        '初回表示とクリア後の値を比較し、主な仕事が余計な選択なしに始められるか確認する。'),
      step('conditional-input', 'conditional_inputs_match_mode', '現在の選択に必要な項目だけを表示し、非表示項目が送信内容と矛盾しないか？',
        'モード変更とクリア後も同じ契約を保つか確認する。',
        '必要なモードだけで追加入力を表示し、非表示値の保持・消去・送信規則をそろえる。',
        '各モードの表示項目・必須条件・送信値を照合し、非表示の古い値が効いていないか確認する。'),
      step('reset-transition', 'reset_preserves_input_contract', '継続操作と新規開始・条件クリアを区別し、再表示でも必要な文脈・初期値・表示・送信の契約が一致するか？',
        '確認した利用状況で操作設計を候補として評価する。',
        '見た目だけでなく、状態遷移と送信時の解釈を修正する案を出す。',
        '初回・継続・変更・クリア・再表示の状態と送信値を比較し、継続に必要な過去の結果を落とさず、リセット時は残す値と消す値を区別する。')
    ]
  },
  {
    id: 'responsibility-handoff', node_id: 'execution-boundary', name: '選択・呼出し・提案・確定の責任を分ける',
    activation_question: '複数のモデル・アダプタ・業務APIが処理を渡し合い、どこが決めるか曖昧になり得るか？',
    causal_model: '呼出しや提案を業務の確定と混同すると、同じ処理の再判断や未承認の状態変更が起き得る。',
    counterexample: '一つの実装が複数の責任を担っても、契約・権限・状態変更の境界が明確なら物理的な分割は必須ではない。',
    steps: [
      step('responsibility-map', 'decision_responsibilities_known', '操作の選択・呼出し・提案・業務状態の確定を、誰が担う契約か明確か？',
        '合意した担当を保ったまま、呼出し層の実際の処理を照合する。',
        '製品名や配置だけで分担を推測せず、各段階の入力・出力・決定権を定める。',
        '選択・呼出し・提案・確定ごとに担当と契約を並べ、未定と重複を確認する。'),
      step('invocation-contract', 'invocation_preserves_selected_operation', '呼出し層は入力検証と認可を守り、契約外の操作再選択や業務判断を追加していないか？',
        '返された提案と、業務状態を確定する境界を照合する。',
        '隠れた再選択・重複判断を見直し、合意した担当へ戻す案を比較する。',
        '呼出し元から実行先を追い、引数・認可・再試行と追加判断の責任が契約どおりか確認する。'),
      step('proposal-commit', 'proposal_distinct_from_commit', '提案や確率を確定と扱わず、合意した業務APIが権限・現在状態を確認して状態を確定しているか？',
        '確認した経路の責任分担を候補として評価する。',
        '提案の返却と確定操作を分け、確定の担当・条件・結果の確認を明示する。',
        '提案生成から状態変更までを追い、どこで誰の権限により確定し、その結果を確認するか照合する。')
    ]
  }

];

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const EXPERT_DECISION_PATHS = freeze(PATHS.map((path) => ({
  ...path, interpretation_status: 'candidate', provenance_ref: `curation:${path.id}@3`,
  steps: path.steps.map((entry, index) => ({ ...entry, depends_on: index ? [path.steps[index - 1].id] : [] }))
})));
export const EXPERT_DETAIL_KINDS = freeze(EXPERT_DECISION_PATHS.flatMap((path) => path.steps.map((entry) => entry.kind)));

export function validateDecisionPaths(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string'
    || !EXPERT_DECISION_PATHS.some((path) => path.id === id)) || new Set(value).size !== value.length) {
    throw new Error('decision_paths は重複のない定義済み判断経路の配列で指定してください');
  }
  return [...value];
}

export function evaluateDecisionPaths(selected, byKind) {
  return EXPERT_DECISION_PATHS.filter((path) => selected.includes(path.id)).map((path) => {
    let stopped = false;
    let status = 'candidate';
    const nextChecks = [];
    const unknowns = [];
    const requirements = [];
    let recommendation = '';
    const steps = path.steps.map((entry) => {
      const observation = byKind.get(entry.kind);
      const known = Boolean(observation && observation.source_refs.length);
      const base = { step_id: entry.id, observation_kind: entry.kind, depends_on: [...entry.depends_on],
        question: entry.question, if_true: entry.if_true, if_false: entry.if_false,
        evidence_refs: observation ? [...observation.source_refs] : [] };
      if (stopped) return { ...base, status: 'deferred', value: null };
      const value = known ? observation.value : null;
      if (!known || (!value && !entry.false_terminal)) {
        stopped = true;
        status = known ? 'action_required' : 'insufficient';
        if (!known) unknowns.push(entry.kind);
        else requirements.push(`detail:${path.id}:${entry.id}`);
        recommendation = known ? entry.if_false : 'この観測を確認してから、後段の判断へ進む。';
        nextChecks.push({ kind: `detail:${path.id}:${entry.id}`, path_id: path.id,
          step_id: entry.id, question: known ? entry.repair_check : entry.question,
          if_true: entry.if_true, if_false: entry.if_false,
          decision_changed: `${entry.if_true} / ${entry.if_false}`,
          evidence_refs: base.evidence_refs, priority: 'before-dependent-detail' });
      } else {
        recommendation = value ? entry.if_true : entry.if_false;
        if (!value) stopped = true;
      }
      return { ...base, status: known ? value ? 'supported' : entry.false_terminal ? 'alternative' : 'action_required' : 'unknown', value };
    });
    return { path_id: path.id, node_id: path.node_id, name: path.name, status,
      interpretation_status: 'candidate', provenance_ref: path.provenance_ref,
      causal_model: path.causal_model, counterexample: path.counterexample,
      steps, recommendation, next_checks: nextChecks, unknowns, context_requirements: requirements,
      advisory: true, blocking: false };
  });
}
