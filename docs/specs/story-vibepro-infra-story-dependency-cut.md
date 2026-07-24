---
story_id: story-vibepro-infra-story-dependency-cut
title: workspace-infraからstoryへの許可外依存を削減するSpec
parent_design: story-vibepro-infra-story-dependency-cut
---

# Spec

## Contracts

- `IDC-CONTRACT-001`: `src/decision-records.js` は `docs/architecture/target-model.json` の `workspace-infra` モジュール(`story`ではない)に分類される。理由: `decision-records.js`の実インポートは`workspace.js`/`run-context-capsule.js`/`artifact-routing.js`のみで、実consumerは`managed-worktree.js`/`managed-worktree-gate.js`/`pr-manager.js`/`cli.js`のみ(いずれもstory catalog機能を持たない)。
- `IDC-CONTRACT-002`: `src/managed-worktree.js`と`src/managed-worktree-gate.js`の`readDecisionRecordsIfExists`呼び出し自体(挙動)は変更しない。変わるのは`decision-records.js`のtarget-model.json上のモジュール分類のみ。
- `IDC-CONTRACT-003`: `normalizeActiveStories`とprivateヘルパー`isArchived`は`src/story-manager.js`から`src/workspace.js`(workspace-infra、既に`DEFAULT_BRAINBASE_STORIES`を保持)へ移動する。`src/story-manager.js`・`src/guard.js`・`src/performance-evidence.js`・`src/pr-manager.js`は`./workspace.js`からこの2関数をimportする。

## Invariants

- `IDC-INV-001`: `src/performance-evidence.js`のuser-perceivedメトリクスreadiness判定(`hasUserPerceivedEvidence(context.beforeRuns)`/`hasUserPerceivedEvidence(context.afterRuns)`、および`metric.readinessKind === 'user_perceived'`の分岐)はunchanged/existingであり、本Storyで変更したのは同ファイル内の`normalizeActiveStories`のimport元(`./story-manager.js`→`./workspace.js`)のみ。

## Scenarios

- `IDC-S-001`: workspace-infra依存カットを適用後、`vibepro graph . --run-graphify`のあとに`vibepro architecture conformance . --json`を再実行すると、conformance summaryの`violation_count`が着手前実測値(85)から増加せず、guard.js/managed-worktree.js/managed-worktree-gate.jsの3実エッジは`src/story-manager.js`・`src/decision-records.js`への呼び出しとしてもう現れない。
- `IDC-S-002`: conformanceが報告する残存`workspace-infra -> story`エッジ(例: `src/workspace.js -> src/story-manager.js`)について、変更前後どちらのコミットでも報告元ファイルの実際のimport文を直読すると該当importが存在せず、graphifyツールの呼び出し方向属性の誤検出(ノイズ)であることを確認する。各コミットを独立に複数回(3回ずつ)再測定した結果は各コミット内で安定していた(変更前46・変更後45)。実依存3件の除去に対して測定上のネット差分が-1にとどまる理由は、`src/workspace.js -> src/story-manager.js`のノイズエッジ数が変更前後のコミット間で21件→23件に変化した相殺であり、同一コードでの再実行間の非決定性ではない。この点は本Storyの範囲外(graphify本体の修正が必要)として別途フラグする。
