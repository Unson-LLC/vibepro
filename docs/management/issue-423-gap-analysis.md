# Issue #423 — あるべき姿と現状のギャップ分析

- 対象 issue: https://github.com/Unson-LLC/vibepro/issues/423
- 検証コミット: `origin/main` @ `72b0fed9` / package `0.2.0-beta.2`（reporter が記録した origin/main と同一）
- 検証方法: `.worktrees/issue423-main`（clean checkout + `npm ci`）で最小 fixture を `pr prepare` 実行
- 結論: **報告された2つの挙動はどちらも現行 main で再現する**。ただし報告者が推定した発火経路（構造化 `kind: deployment`）は誤りで、真の入力は Story 散文である。

---

## 0. 再現サマリー

| 再現 | 内容 | 結果 |
|---|---|---|
| A | Story 散文が「no runtime deployment」と明記 | `classes: ["deployment"]`、`gate:bug_physics_triage=needs_evidence`、`gate:bug_physics_deployment_version_stamp=needs_evidence` |
| A2 | 同じ変更で `deployment` 語だけを除去 | `classes: []`、deployment gate は**出現しない** |
| B | stale local `main` を `--base` に指定 | 差分が 2 → 4 files に膨張、gate 26 → 31、needs_evidence 8 → 15、route `docs_only` → `config_or_agent_policy` |
| C | 両 bug physics gate に accepted waiver decision を記録 | status 不変。両方が `blocking_gates` に残る（= `pr create` 不能） |

A と A2 の対比が決定的で、分類の実入力は**語の有無だけ**である。

---

## Gap 1: bug physics triage が「否定文」を「肯定シグナル」として読む

### あるべき姿

Story `docs/management/stories/active/story-vibepro-bug-physics-triage-router.md` の方針:

> triageは推測だけで通さない。`phase-decomposition`, `violation-rate`, `real-byte fixture`, `authoritative signal`, `version-stamp` などのprobe evidenceを要求する。

つまり **probe evidence がクラス選択の前提**であるべき。

### 現状

`src/pr-manager.js:10831` `buildBugPhysicsTriage()`:

1. `storyEvidenceText()`（`src/pr-manager.js:10510`）= title + background + summary + acceptance_criteria
2. `bugPhysicsSpecText()`（`10859`）= spec の `clauses[]` + `open_questions[]`
3. この連結テキストに `bugPhysicsClassMatchers`（`10851`）を正規表現マッチしてクラス確定

deployment matcher（`src/pr-manager.js:10856`）:

```js
deployment: /\b(deployment|deploy|version[-_\s]?stamp|artifact version|running session|expected artifact|settings\.json|browser cache)\b|デプロイ|配布|実行中/
```

- **否定の扱いが一切ない**。`no runtime deployment` は `deployment` にマッチする。
- probe evidence は**クラス選択に使われない**。`collectBugPhysicsProbeEvidence()`（`10869`）の結果は `gate:bug_physics_triage` の status（`10972` `buildBugPhysicsTriageGate`）を決めるだけ。順序が Story の意図と逆で、「推測でクラスを選び、その推測に対する証跡を要求する」構造になっている。
- 差分（fileGroups / changed paths）を一切参照しない。純テキスト分類。
- 「これはそもそも bug Story か」という前提判定がない。docs-only の feature Story にも無条件で triage が走る。

### 同一リポジトリ内に既にある「正しい型」

judgment axis 側には text-only 発火を抑制する precision guard が実装済み（`src/pr-manager.js:8736` `classifyAxisActivationPrecision`）:

```js
status: 'insufficient_signal',
reason: `${axis} has only text-derived candidates; suppressing activation until a changed-path, route, scope, docs, network-contract, or risk-surface corroboration exists`
```

実際 REPRO B の出力でも `execution_topology` がこの規則で suppress されている。**bug physics triage だけがこの補強シグナル要求を持っていない。**

### 出口がない（Gap 1 の重篤度を決める部分）

- `gate:bug_physics_triage` と `bug_physics_profile_gate` は critical 判定（`src/pr-manager.js:15435-15436` `isCriticalUnresolvedGate`）。
- `pr create` は critical unresolved gate を `--allow-needs-verification --verification-waiver` でも拒否する（`src/pr-manager.js` の "critical unresolved gates cannot be waived by reason alone"）。
- `buildBugPhysicsProfileGates()`（`10992`）は status を `hasCurrentBugPhysicsEvidence()` だけで決め、**decision record を参照しない**。`gate:deploy_verification` が持つような waiver decision 経路（`vibepro decision record --source gate:deploy_verification --type waiver`）が bug physics には存在しない。
- REPRO C で accepted waiver を両 gate id に記録しても status は `needs_evidence` のまま。

結果、閉じる方法は「Story 散文とverify record に `version stamp` / `running session` 等の語を書き込む」＝**証跡の捏造**しかない。reporter の "pushed toward either fabricating irrelevant version-stamp evidence or bypassing VibePro" は正確。

### 報告内容の訂正点

issue は「構造化 `kind: deployment` が profile を選んでいるように見える」と推定しているが、**これは誤り**。

- spec の diagram は `inferredSpec.diagrams[]` に入る（`src/pr-manager.js:7433` 付近）。
- `bugPhysicsSpecText()` は `clauses` と `open_questions` しか読まない。`diagrams` は読まない。
- REPRO A2 が示す通り、散文から `deployment` 語を消せばクラスは消える。

したがって issue の Expected result #2「diagram に `applicability: not_applicable` を持たせる」**だけでは何も直らない**。修正は分類器側（散文入力 + 補強シグナル + 否定/非該当セマンティクス）に入れる必要がある。

---

## Gap 2: `--base` の解決が lifecycle 間で不整合、かつ stale base が無検出

### あるべき姿

`pr prepare` / `pr create` / `execute merge` が同じ「現在の統合対象」を評価し、gate scope は実際の PR 差分と一致する。ずれたら loud に落ちる。

### 現状

| コマンド | base 解決 | fetch |
|---|---|---|
| `pr prepare` | `options.baseRef ?? resolveBaseRef()`（`src/pr-manager.js:3090`）。`--base` は**文字列そのまま**使用 | しない |
| `pr create` | 内部で `preparePullRequest()` を再実行（同上）。GitHub 側 base は `stripRemote()` 後（`src/pr-manager.js:1465`） | しない |
| `execute merge` | 常に `origin/${baseBranch}` に正規化（`src/merge-manager.js:103` ほか）、事前に `git fetch origin <base>` | する |

- 既定の `resolveBaseRef()`（`src/pr-manager.js:3232`）は `origin/HEAD` → `origin/develop` → `origin/main` → local と remote-tracking 優先で正しい。**壊れるのは `--base main` を明示した時だけ**。
- `collectRefTopology()` は `fetch_performed: false` をハードコード（`src/pr-manager.js:3288`）。`--base origin/main` でも fetch していない remote-tracking ref を見ている可能性がある。
- `divergence.local_vs_remote` / `divergence_flags.branch_divergence_detected` は計算され `ref-topology.json` に書かれるが、**どの gate も消費しない**。純テレメトリ。
- `gate:pr_freshness`（`src/pr-manager.js:3198`）は `mergeBaseSha === baseSha`（= head が base を含むか）しか見ない。base が古いほど head は base を含むので、**stale base は必ず `passed` になる**。方向が逆。

### REPRO B 実測（同一 head、`--base` だけ変更）

| | `--base origin/main` | `--base main`（stale） |
|---|---|---|
| changed_files | 2 | 4（`.github/workflows/deploy.yml`, `infra/main.tf` が混入） |
| required_gate_count | 26 | 31 |
| needs_evidence_count | 8 | 15 |
| pr_route | `docs_only` | `config_or_agent_policy` |
| active_judgment_axes | 1 | 4（+rollback_sensitive, scope_reviewability, release_ops） |
| pr_scope_judgment | passed | **needs_split** |
| senior_gap_judgment | needs_review（blocking 8） | **block**（blocking 18） |
| evidence_reuse | passed | **needs_refresh**（`base_sha changed`） |
| 追加 gate | — | judgment_axis_rollback_sensitive / judgment_axis_scope_reviewability / judgment_axis_release_ops / split_resolution |
| `gate:pr_freshness` | passed | **passed**（検出されない） |
| `branch_divergence_detected` | — | `true`（記録のみ、gate なし） |

`bug_physics_classes` は両方 `[]`。**stale base は bug physics を直接強化しない**（分類器が差分を読まないため）。issue の "This further reinforced the deployment classification" は、route / judgment axis の強化としては正しいが、bug physics 分類に対しては成り立たない。

### 2つの Gap を繋ぐ実際の因果

`src/diagram-requirement-resolver.js:144-161` は **差分駆動**で、IaC / deploy config が差分に含まれると `kind: deployment` の design diagram を必須にする。よって reporter のケースは:

1. stale `--base main` が `.github/workflows/*` と Terraform を差分に混入（Gap 2）
2. `gate:design_diagrams` が deployment diagram を要求
3. 作成者が「repository-only、runtime deployment なし」という否定説明を Story / diagram に書く
4. その否定散文が bug physics deployment matcher を発火（Gap 1）
5. waiver 不能な critical gate 2本で governed merge path が閉じる

**Gap 2 が、Gap 1 を踏むための deployment 語彙を生成している。**

---

## 修正方針（issue の Expected result への対応）

| issue の要求 | 評価 | 対応方針 |
|---|---|---|
| 1. 否定 deployment 境界で profile を発火させない | 妥当 | 分類器に否定/非該当セマンティクスを入れる |
| 2. `applicability: not_applicable` を構造化 metadata に | **単独では無効** | diagram は分類器に届いていない。入れるなら分類器が読む面（Story frontmatter か spec clause）に置き、かつ分類器側で消費する |
| 3. 3コマンドが同じ base を解決 | 妥当 | `--base` を remote-tracking へ正規化するか、stale を loud に落とす（`execute merge` の `origin/<base>` 正規化に揃える） |
| 4. gate scope を実 PR 差分から導出 | 妥当 | 上と同一の修正で満たせる |
| 5. 本物の deployment 変更では gate を維持 | 妥当・必須 | 補強シグナル（changed path / route / risk surface）を要求する形なら自然に満たす |

推奨する実装の骨子:

1. **bug physics triage に precision guard を移植** — `classifyAxisActivationPrecision`（`8736`）と同型の「text-only 候補は非テキスト補強シグナルが出るまで suppress」。deployment なら「差分に IaC / deploy config / workflow / release route があるか」。
2. **否定文脈の除外** — `no runtime deployment` / `deployment なし` / `not deployed` 等を negative context として matcher から除去する前処理。ただし 1 が入れば主効果は 1 が担うので、これは補助。
3. **非該当の正規経路** — bug physics profile gate にも `findAcceptedDecisionForSource()` ベースの typed N/A decision 経路を追加（`gate:deploy_verification` と同じ形）。分類器が誤っても人間が監査可能な形で閉じられるようにする。捏造証跡への圧力を消す。
4. **base 解決の正規化と staleness gate** — `--base <branch>` を `origin/<branch>` に解決（または `refs/remotes` 存在時は remote 優先）し、local が remote より behind なら `pr prepare` / `pr create` で明示的に落とす。`branch_divergence_detected` を gate 化して `ref-topology.json` のテレメトリを enforcement に昇格させる。

## 提案テスト（issue の Suggested tests に対応）

- 否定 fixture: 「no runtime deployment」明記の docs-only Story → deployment bug physics gate が出ない
- 肯定 fixture: deploy workflow / runtime artifact 変更あり → version-stamp gate は従来通り出る
- base topology fixture: stale local `main` + 現在の `origin/main` → `pr prepare` / `pr create` / `execute merge` が同じ差分を評価する（または loud に落ちる）
- 回帰 fixture: 生成 Graph 内の無関係な deployment ノードが docs-only Story 分類を汚染しない

---

## 検証で使った成果物

- 再現テスト: `/private/tmp/claude-502/-Users-ksato-workspace-repos-vibepro/36dd5e92-285f-4dbc-8f91-1cfb56c33faf/scratchpad/issue423-repro.test.js`
- 参照 checkout: `.worktrees/issue423-main`（`origin/main` @ `72b0fed9`, `npm ci` 済み）
