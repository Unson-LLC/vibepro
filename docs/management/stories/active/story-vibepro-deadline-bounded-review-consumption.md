---
story_id: story-vibepro-deadline-bounded-review-consumption
title: "review lifecycle の agent_consumption_ms を「生存していた時間」に境界づける — close_reason で9件のcompletedを免除し、timeoutの1件だけをtimeout_msで束縛して11,073,531msを4,656,074msへ縮めるdeadline-bounded attribution"
status: active
view: dev
period: 2026-08
category: quality
parent_design: vibepro-deadline-bounded-review-consumption
related_stories:
  - story-vibepro-content-scoped-evidence-reuse-key
  - story-vibepro-trusted-delivery-efficiency-guardrail
  - story-vibepro-owner-gated-budget-override
reason:
  decision: "review lifecycle 1件が予算に計上する agent 消費量を、`close_reason` によって区別する。`close_reason === 'completed'`（review record --agent-closed による正常終了）は現在どおり `closed_at - started_at` の全区間を計上する。それ以外（`timeout` / `replaced` / `manual_shutdown`、および将来の未知値）は `min(closed_at - started_at, timeout_ms)` に縮める。`timeout_ms` が欠落・非有限の場合は現在どおり全区間を計上する（後方互換）。実装は `aggregateDeliveryMetrics`（`src/delivery-efficiency-guardrail.js:231-274`）1箇所に置き、呼び出し側（`src/agent-review.js` の authorizeAgentReviewDispatch、`src/pr-manager.js` の buildDeliveryEfficiencyContext）は `reviews[]` 構築時に `close_reason` と `timeout_ms` を lifecycle entry からそのまま渡すだけでよい。`review_wait_ms` / `subagent_wall_clock_ms`（`unionDuration` ベース）は対象外のまま維持する。上限で削られた量は `deadline_excluded_ms` / `deadline_excluded_count` として可視化し、黙って消えさせない。`story-vibepro-content-scoped-evidence-reuse-key` の実 lifecycle 記録（10件）で検証すると、合計は 11,073,531ms（184.6分）から 4,656,074ms（77.6分）へ縮み、既に承認済みだった上限 9,000,000ms に収まる（3回目の owner 承認は不要だった計算になる）。非退化性: 10件中3件（744,613 / 633,099 / 7,017,457ms）が 600,000ms の deadline を超えるが、束縛されるのは close_reason=timeout の1件だけであり、束縛率は 1/10 = 10%。残る2件は close_reason=completed のため免除される。これは `count × timeout_ms` へ潰れないことの実測による証拠であり、先行した `story-vibepro-work-based-agent-consumption-budget`（未merge、branch claude/zealous-jones-a4447a）の3段tier設計が『計測』段に producer が無く count×timeoutへ退化して停止した失敗を再演しない。"
  alternatives: "(a) `vibepro review close --closed-at <iso>` のような retroactive 補正コマンドを追加する案は採用しない。補正値は予算を制限される側が自己申告する値であり、突き合わせる独立記録が無い。これは先行 story `story-vibepro-owner-gated-budget-override` が拒否した『検証不能な自己都合の値』と同型の問題であり、かつ人間が気づいて明示的に使わない限り既定の経路は誤ったままになる。deadline bound は運用者の操作なしに支配的なケースを直す。(b) lifecycle heartbeat を新設し、最後の heartbeat を実質的な closed_at として使う案は採用しない。本リポジトリが実際に使っている dispatch 形態（手動起動する Claude Code review subagent）に producer が存在しない。tree 内で唯一の heartbeat 相当は `.vibepro/runtime-inbox/<dispatch_id>/`（codex runtime adapter が書く）であり、`src/agent-review.js` はこれを一切読まない。採用すると `story-vibepro-work-based-agent-consumption-budget` を停止させたのと同じ『producer が無い measured tier』の欠陥を再現する。(c) close_reason に関わらず全 lifecycle を timeout_ms で一律に束縛する案は採用しない。実 ledger では10件中3件が締切を超えるが、そのうち2件は実際に完了した正当な review（suite 待ちで長引いただけ）であり、これを縮めるのは一度停止させた count×timeoutの退化設計そのものである。(d) 締切超過分を0として扱う（束縛された lifecycle を集計から除外する）案は採用しない。締切まで生存していた dispatch は締切までの agent capacity を実際に消費しており、0として扱うと『完走するより落ちる方が安い』という逆インセンティブを作る。(e) `max_agent_consumption_ms` をグローバルに引き上げる案は採用しない。計測の欠陥を緩い guardrail の後ろに隠すだけであり、将来のインフラ障害のたびに実予算を消費し続ける。(f) `result_artifact !== null` を close_reason の代わりに束縛判定へ使う案は、実データで検証すると採用できない。architecture_boundary lifecycle `657ff5ab...`（744,613ms、close_reason=completed、close_evidence に needs_changes の verdict JSON 内容が明記）は result_artifact が null である。この discriminator を採用すると正当に完了した review まで 600,000ms へ縮めてしまい、close_reasonより弱い近似になる。"
  compatibility: "`aggregateDeliveryMetrics(input)` の呼び出しシグネチャは変えない。`reviews[]` の各要素に `close_reason` / `timeout_ms` という2つの optional field を追加するだけで、両方とも欠落時は現在の挙動（全区間合算、timeout_ms欠落は無条件フォールバック）にフォールバックするため、この2フィールドを渡さない既存呼び出し元は無改修で現行動作を維持する。戻り値には `deadline_excluded_ms` / `deadline_excluded_count` という2つの新規フィールドが追加されるのみで、既存フィールド（agent_consumption_ms / review_wait_ms / subagent_wall_clock_ms 等）の意味・型は変えない。呼び出し側2箇所は `reviews.push`/`map` の対象オブジェクトに `close_reason: item.close_reason, timeout_ms: item.timeout_ms` を追加するだけで、lifecycle entry のスキーマ自体（schema_version 0.1.0）は変更しない。`story-run-portfolio.js` の `mergeCostAttribution`（:400-407）は `next.reviews` をそのまま `aggregateDeliveryMetrics` に渡す経路のため、呼び出しコード自体の変更なしに恩恵を受ける。`evaluateDeliveryBudget` の入力契約（max_agent_consumption_ms -> agent_consumption_ms）は変えないため、budget評価・stop reason（budget_exceeded）・fail-closedの送出経路は無改修で動く。"
  rollback: "`aggregateDeliveryMetrics` 内の bound 分岐（close_reason===completedなら全区間、そうでなければmin(duration, timeout_ms)）を削除して `intervals.reduce((sum, item) => sum + item[1] - item[0], 0)` に戻し、2箇所の呼び出し元から close_reason/timeout_msの受け渡しを外し、戻り値からdeadline_excluded_ms/deadline_excluded_countを外せば、旧来の単純合算に戻る。lifecycle artifact自体のスキーマは変更していないため、記録済み `.vibepro/reviews/**/lifecycle.json` のrollbackは不要。"
  boundary: "`aggregateDeliveryMetrics` の agent_consumption_ms / deadline_excluded_ms / deadline_excluded_count のみを対象とする。review_wait_ms / subagent_wall_clock_ms（unionベース）は対象外。budget override authority（human grantor / self-grant fail-closed / digest束縛）は変更しない。`--closed-at` のような retroactive 時刻編集は追加しない。lifecycle heartbeat・新しい runtime producer は追加しない。`src/usage-report.js` の --subagent-roi（別のreporting metric、ARM-CONTRACT-002でpin済み）は対象外。`hasCompleteReviewTiming` の.every()完全性ゲート（1件のopen lifecycleが次元全体をunknownにする挙動）は変更しない — 別の欠陥として認識するが本story の対象外、後続storyへのfollow-upとして明記する。`.vibepro/config.json` のlimit値そのもの（max_subagent_count等）は変更しない。既に記録済みのamendment_reason履歴を遡及的に書き換えない。`src/story-run-portfolio.js` の永続化 `cost_attribution` 形状（`emptyCostAttribution()` / `COUNT_COST_KEYS`）へ `deadline_excluded_ms` / `deadline_excluded_count` を追加することも対象外とする。`validateState` は `hasExactKeys(cost, COST_KEYS)` で closed schema を強制しており、`COST_KEYS` は実行中コードの `emptyCostAttribution()` から導出される。Portfolio state は `.vibepro/` 配下の git-ignored ファイルとして永続化されるため、このフィールド追加を含むコミットを `git revert` してもコードだけが戻り、既にディスク上にある state ファイルは新フィールド付きのまま残る。ロールバック後のコードはそれを `invalid_portfolio_state` として拒否し、以後の Portfolio 操作を永続的にブロックする——rollback の非対称性がある。DBA-S-6 が要求する可視性（`pr prepare` の効率性レポートと dispatch decision evidence）は `story-run-portfolio.js` を経由せずに満たされている（`gate_dag.summary.efficiency_debt.metrics` と各 lifecycle の `dispatch_decision.decision_evidence.budget` で確認済み）ため、この面を変更する必要はない。"
created_at: 2026-08-06
updated_at: 2026-08-06
---

# review lifecycle の agent_consumption_ms を「生存していた時間」に境界づける — deadline-bounded attribution

## User Story

**As a** VibePro の review lifecycle budget を運用する story owner
**I want** `agent_consumption_ms` が「実際に生存していた時間」だけを計上し、インフラ障害（API過負荷など）で subagent が応答を止めた後の無稼働 wall-clock を予算から除外すること
**So that** インフラ由来の停止が、本来不要な追加の owner 承認を発生させない

## Context and Gap

- `src/delivery-efficiency-guardrail.js:231-274` の `aggregateDeliveryMetrics` は、本Story着手前は `agent_consumption_ms` を `intervals.reduce((sum, item) => sum + item[1] - item[0], 0)`（bound実装前のコード。現在は `boundAgentConsumption`/`resolveConsumptionCharge`、`:371-391` に置き換わっている）として計算しており、review lifecycle の `closed_at - started_at` を上限なしに合算していた。同じ関数の `review_wait_ms` / `subagent_wall_clock_ms`（`:251-252`）は `unionDuration` を使うため並行実行の二重計上は避けられているが、`agent_consumption_ms` だけは単純合算のままである。
- 2026-08-05、story `story-vibepro-content-scoped-evidence-reuse-key` で `architecture_boundary` 4件・`gate_evidence` 6件、計10件の lifecycle が閉じた。全件 `timeout_ms=600000`。9件は `close_reason=completed` で 183,390〜744,613ms、残り1件（`gate_evidence`、lifecycle_id `feab8687...`）は `started_at: 2026-08-05T12:49:56.929Z` から `closed_at: 2026-08-05T14:46:54.386Z` まで **7,017,457ms（116.9分）** かかって `close_reason=timeout` で閉じた。`close_evidence` は「subagent adb0d8a8d01998f2b timed out per review status; closing before replacement dispatch」とのみ記録されているが、実際には Anthropic API の過負荷（529）で subagent が応答を止め、後続セッションが気づいて close するまで誰も作業していなかった。
- 10件の合計は **11,073,531ms（184.6分）**。同じ story の `.vibepro/config.json` override の `amendment_reason` に記録された `measured=11,073,531ms` と完全一致し、単純合算モデルを実測で裏付ける。
- limit は 9,000,000ms（150分）で設定されていたため、合計が上限を超えて `remaining=0` となり、以後の dispatch がすべて拒否され、3件目の owner budget 承認が必要になった。3件のうち最後の1件は、story の重さではなくインフラ障害由来である。
- `resolveLifecycleEffectiveStatus`（`src/agent-review.js:4085-4099`）は既に「`elapsed_ms > normalizeTimeoutMs(entry.timeout_ms)` なら `timed_out`」という締切をシステム内部に持っている。システムは「これ以上は生存とみなさない」境界を既に持っているのに、`agent_consumption_ms` の計算だけがその境界を無視して合算を続けている。
- `close_reason` の enum は `['completed', 'timeout', 'replaced', 'manual_shutdown']`（`src/agent-review.js:4200`）で閉じており、自動で設定されるのは `review record --agent-closed` による `completed` のみ（`:524`）。`timeout_ms` は `startAgentReviewLifecycle`（`:696`）が dispatch 時に必ず stamping する（`DEFAULT_REVIEW_TIMEOUT_MS = 600000`, `:72`）。両方とも既存の producer を持つ既存フィールドであり、新しい計測経路を要しない。
- `close_reason=completed` の lifecycle でも `result_artifact` が `null` になり得る（実例: architecture_boundary lifecycle `657ff5ab...`、744,613ms、`close_reason=completed`、`result_artifact=null`、`close_evidence` に verdict JSON の内容が明記されている）。`result_artifact != null` を束縛判定に使うと、この genuinely completed な review まで縮められてしまう。
- **残るリスク（隠さず明記）**: `close_reason` は運用者・エージェントが `review close --close-reason` で明示的に設定する値であり、原理的には正当に40分で完了した review を `timeout` として close すれば `timeout_ms`（10分）にしか計上されなくなる。これは防止ではなく軽減である。主たる歯止めは `review record` が `close_reason !== 'completed'` で閉じた lifecycle への結果添付を拒否すること（`src/agent-review.js:505-508`: `entry.closed_at && entry.close_reason !== 'completed'` の場合に `` `review record ${stage}:${role} cannot attach a result to lifecycle closed as ${entry.close_reason ?? 'unknown'}` `` を throw する。既存 passing test `review record persists no result after timeout, replacement, or manual shutdown`、`test/review-inspection-first.test.js:836` で裏付け済み）で、実際に完了した review を `timeout` と偽ると、その結果自体が current artifact にも history にも残らず、review dispatch をやり直すコストが発生する。副次的に `deadline_excluded_ms` / `deadline_excluded_count` は `pr prepare` の機械可読サーフェス（`gate_dag.summary.efficiency_debt.metrics`、`--summary-json`/`--view blocking-gates`/`--view gate-evidence`、各lifecycleの `dispatch_decision.decision_evidence.budget`）には必ず現れるが、`gate-dag.html`/`pr-prepare.html` などの人間向け HTML レポートには現れない（`src/html-report.js` に `efficiency|agent_consumption|deadline_excluded` はゼロ件）。したがって「目立つ形で人間の目に入る」とまでは言えず、JSON/CLIサーフェスを見ないreviewerには伝わらない。

## Acceptance Criteria

- [ ] DBA-S-1: `aggregateDeliveryMetrics` の `agent_consumption_ms` 計算で、`reviews[]` の各項目が `close_reason === 'completed'` の場合は現在どおり `finished_at - started_at` の全区間を計上する（変更なし）。
- [ ] DBA-S-2: `close_reason` が `'completed'` 以外（`timeout` / `replaced` / `manual_shutdown` / 将来追加されうる未知値を含む）で、かつ `timeout_ms` が有限値の場合、計上区間は `min(finished_at - started_at, timeout_ms)` に縮められる。
- [ ] DBA-S-3: `timeout_ms` が欠落・非有限（`null`/`undefined`/`NaN`/非数値）、またはゼロ以下（`<= 0`）の場合、`close_reason` に関わらず現在どおり全区間を計上する（呼び出し側が新フィールドを渡さない既存呼び出しとの後方互換）。ゼロ以下の `timeout_ms` を上限として束縛すると `Math.min(duration, 0)` が常にゼロを返し、実際に消費した agent 時間が丸ごと消えるという、過大計上より悪い失敗になるため、束縛せず全区間計上へフォールバックする。
- [ ] DBA-S-4: `review_wait_ms` と `subagent_wall_clock_ms` は `unionDuration(intervals)` のままであり、本 story による deadline 上限の対象にならない。
- [ ] DBA-S-5: `src/agent-review.js` の `authorizeAgentReviewDispatch`（`:819-830`）と `src/pr-manager.js` の `buildDeliveryEfficiencyContext`（`:11741-11749`）の両方が、`reviews[]` 構築時に `close_reason` と `timeout_ms` を lifecycle entry からそのまま渡すよう変更される。
- [ ] DBA-S-6: `aggregateDeliveryMetrics` の戻り値に `deadline_excluded_ms`（上限で削られた合計ミリ秒）と `deadline_excluded_count`（上限が適用された lifecycle 件数）が追加され、`pr prepare` の効率性レポートと dispatch decision evidence の両方に伝播する。
- [ ] DBA-S-7: `story-vibepro-content-scoped-evidence-reuse-key` の実 lifecycle 記録（10件、`architecture_boundary` 4件 + `gate_evidence` 6件）をそのまま入力として `aggregateDeliveryMetrics` を呼ぶ回帰テストが、`agent_consumption_ms` が 11,073,531 から 4,656,074 へ、`deadline_excluded_count` が 1 になることを assert する。
- [ ] DBA-S-8: `evaluateDeliveryBudget` の fail-closed 停止（`budget_exceeded` stop reason、`throwReviewDispatchStop` による例外送出）と、`budget-override-authority.js` が要求する human-only grant（`grantor_kind: human`、自己承認拒否、digest 一致）の経路は本 story で変更しない。既存の budget override 関連テストは無改修で通る。

## Inherited Behavior

- `REVIEW_CLOSE_REASONS = ['completed', 'timeout', 'replaced', 'manual_shutdown']`（`src/agent-review.js:4200`）は不変。自動設定されるのは `review record --agent-closed` による `completed` のみ（`:524`）。
- `timeout_ms` は `startAgentReviewLifecycle`（`src/agent-review.js:696`）が dispatch 時に必ず stamping する既存 producer をそのまま使う（`DEFAULT_REVIEW_TIMEOUT_MS = 600000`, `:72`）。新しい producer は作らない。
- `resolveLifecycleEffectiveStatus`（`:4085-4099`）が `elapsed_ms > normalizeTimeoutMs(entry.timeout_ms)` を `timed_out` と判定する既存の締切ロジックは不変。
- budget override authority（`story-vibepro-owner-gated-budget-override`: human grantor 必須・self-grant fail-closed・digest 束縛）は不変。
- `evaluateDeliveryBudget` の stop reason `budget_exceeded` と `throwReviewDispatchStop` による fail-closed 送出（`story-vibepro-trusted-delivery-efficiency-guardrail`）は不変。

## Non Goals

- budget override authority model（human grantor 必須・agent self-grant fail-closed・digest 束縛）の変更。この設計は正しく、そのまま維持する。
- `--closed-at` のような retroactive timestamp 編集の追加。
- lifecycle heartbeat の新設、および新しい runtime producer の追加。
- `src/usage-report.js` の独立した `--subagent-roi` metric の計算方式の変更。これは reporting metric であり budget enforcer ではない。その合算方式は受理済み Spec `docs/specs/vibepro-agent-runtime-metrics.md` の `ARM-CONTRACT-002` で pin されている。
- `hasCompleteReviewTiming` の `.every()` 完全性ゲート（1件でも open な lifecycle があると次元全体が `unknown` になる挙動）の変更。これも欠陥として妥当だが、本 story が対象とする欠陥ではない。後続 story への follow-up として明記する。
- `.vibepro/config.json` の `max_subagent_count` / `max_review_dispatches_by_role` その他、いかなる limit の**値**の変更。
- 既に記録済みの `amendment_reason` 履歴の遡及的修正。

## 初期タスク

1. `aggregateDeliveryMetrics` の bound 実装
   - `reviews[]` 項目が `close_reason`/`timeout_ms` を受け取り、`completed` 免除 + `min(duration, timeout_ms)` を実装
   - `deadline_excluded_ms` / `deadline_excluded_count` を戻り値へ追加
2. 呼び出し側2箇所の伝播
   - `src/agent-review.js` の `authorizeAgentReviewDispatch` が `close_reason`/`timeout_ms` を渡すよう変更
   - `src/pr-manager.js` の `buildDeliveryEfficiencyContext` が `close_reason`/`timeout_ms` を渡すよう変更
3. 可視化
   - `pr prepare` の効率性レポート、dispatch decision evidence に `deadline_excluded_ms`/`deadline_excluded_count` を反映
4. 回帰テスト
   - `story-vibepro-content-scoped-evidence-reuse-key` の実10件ledgerを固定入力にした replay テスト（11,073,531 → 4,656,074、bounded_count=1）
   - `test/delivery-efficiency-guardrail.test.js` へDBA-S-1〜DBA-S-7の新規テストを追加（既存の union/sum アサーションは無改修のまま通過し続けた）
   - `test/story-run-portfolio.test.js` は最終的に無改修（`mergeCostAttribution` は呼び出し側コード変更なしに束縛を継承するため。追加したDBA-S-6のportfolio永続化テストは、`story-run-portfolio.js` への2フィールド追加ごとrevertされ、boundary対象外として確定した）
   - budget-stop 統合テスト（`test/review-inspection-first.test.js`）が変更なしで通ることの確認
