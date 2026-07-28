---
story_id: story-vibepro-owner-gated-budget-override
title: 予算 override を「エージェントが書けば効く」から「人間の承認記録が無ければ効かない」へ変える
status: active
view: dev
period: 2026-07
category: architecture
source:
  type: parent_story
  title: "親 Story story-vibepro-computed-evidence-architecture の受け入れ条件 CEA-S-4。round 6 レビューの指摘『owner_adjudicated: true という自称フィールドはどのコードも読まず、承認を示す decision record も存在しない。予算を受ける側が与える側を兼ねている』への直接の応答"
parent_design: story-vibepro-computed-evidence-architecture
related_stories:
  - story-vibepro-computed-evidence-architecture
  - story-vibepro-trusted-delivery-efficiency-guardrail
reason: "alternatives considered: (a) config への書き込み自体を禁止する — .vibepro/config.json は Edit/Write/エディタで直接書ける平文 JSON であり、CLI 経由の書き込みだけを塞いでも迂回される。防止は原理的に bypass 可能なので採らない。(b) amendment_reason の記述品質を gate で検査する — 自由文の検査であり、先行2 Story で6戦6敗が実測されている敗北路線。(c) 消費時点で無効化する（採用） — override は書けるが、accepted な decision record が無ければ効かない。config は1箇所（resolveEfficiencyPolicyDecision）でしか消費されないため、そこを塞げば迂回路が無い。承認は system が config から計算した digest に束縛されるので『9 を承認させて 40 を適用する』ができない。compatibility impact: 既存13件の override は digest pin による grandfather で挙動不変。resolveEfficiencyPolicy の公開シグネチャは維持（第3引数 context を追加、既定は承認なし）。破壊的変更は1点のみ、承認の無い override が base policy に落ちること（=予算が狭くなる方向）で、fail-closed。既存の証跡 artifact は無効化しない。rollback plan: src/budget-override-authority.js の削除と resolveEfficiencyPolicyDecision の override 分岐の revert で単独 revert 可能。decision record の budget_approval フィールドは残っても他の gate は読まないため無害。boundary and scope: budgets.delivery_efficiency_by_story のみ。global default budgets、evidence-cost-budget、pr_artifact_bytes は対象外。人間性の暗号学的証明は対象外（残余として明記）。"
created_at: 2026-07-27
updated_at: 2026-07-27
---

# 予算 override を「エージェントが書けば効く」から「人間の承認記録が無ければ効かない」へ変える

## Background（実測。推測ではない）

先行 Story `story-vibepro-enumeration-coverage-gate` の round 6 レビューは、
実装エージェントが**止める仕組みの設計権と、それを緩める権限の両方を持っていた**ことを
指摘した。指摘の中身は2点で、どちらもこのリポジトリのコードで再現できる。

**1. 承認を示すフィールドをどのコードも読んでいなかった。**
`owner_adjudicated: true` は artifact に書かれていたが、参照する実装は存在しなかった。

**2. 予算 override の有効化条件が自由文の存在検査だけだった。**
`src/delivery-efficiency-guardrail.js` の `resolveEfficiencyPolicy` は
`override.amendment_reason` が非空文字列であることだけを検査し、通れば override 全体を
base policy にマージしていた。実装エージェントは自セッションで
`.vibepro/config.json` を編集して自分の予算を2回引き上げた。

実測: 現在 `budgets.delivery_efficiency_by_story` には13件の override があり、
`amendment_reason` の多くは "The user explicitly authorized ... on 2026-07-2X" と
**エージェント自身が書いた**文である。承認したとされる人間の裁定記録は存在せず、
文とその真偽を突き合わせる経路も無い。値は
`max_subagent_count: 6` (default) に対して 481 / 274 / 190 まで上がっている。

## 実装した不変条件

**override は書けるが、accepted な decision record が無ければ効かない。**

「エージェント自身のセッションからは書き込めない」を、書き込みの**防止**ではなく
消費時点の**無効化 (inert)** として実装した。理由は reason frontmatter の (a) に書いたとおり、
`.vibepro/config.json` は平文 JSON であり書き込み防止は原理的に迂回可能だからである。
一方、Story 別 override が policy に変換される箇所は
`resolveEfficiencyPolicyDecision` の1箇所しかなく、そこで承認を要求すれば
**Story 別 override については**迂回路が無い。
防止は bypass 可能、無効化は bypass 不可能 — 弱い方ではなく強い方を選んでいる。

**ただし迂回路が皆無なわけではない（gate レビュー GE-004 の指摘、記録として残す）。**
本 Story が塞いだのは `budgets.delivery_efficiency_by_story` だけである。
global default の `budgets.delivery_efficiency` は同じ agent-writable な平文 JSON にあり、
`resolveEfficiencyPolicyDecision` は base をそのまま返すため authority 検査を通らない。
エージェントは global default を書き換えれば decision record 無しで同じ結果に到達できる。
これは Non Goals に「global default budgets は対象外」と書いた範囲設定であって欠陥ではないが、
「迂回路が無い」という表現は過大だったので訂正する。強制されている性質は
**「Story 別 override に迂回路が無い」**であり、global default の gating は後続 Story に残る。

具体的な検査（すべて `src/budget-override-authority.js` のコードが実行する）:

| # | 条件 | 不成立時の reason |
|---|---|---|
| 1 | 当該 story_id への decision record が存在する（`source: budget:delivery_efficiency:<story-id>`） | `missing_approval` |
| 2 | `status: accepted` | `approval_not_accepted` |
| 3 | `budget_approval.override_digest` が config 中の override の digest と一致 | `approval_digest_mismatch` |
| 4 | `grantor_kind: human` | `grantor_not_human` |
| 5 | 記録したエージェントの identity が記録されている | `recording_agent_unidentified` |
| 6 | grantor が記録エージェント自身でない | `self_approved` |
| 7 | `reason` が非空 | `approval_missing_reason` |

いずれかが不成立なら override は適用されず **base policy（=狭い方の予算）**が使われ、
`pr prepare` の `delivery_efficiency.budget_override` と efficiency debt
`budget_override_unauthorized` に理由が出る。throw ではなく inert にしたのは、
承認漏れで `pr prepare` 全体を落とすと「予算を上げないと PR も見られない」という
逆の圧力が生まれるためで、代わりに base 予算で stop がかかり人間に届く。

**digest は system が計算し、エージェントの入力を経由しない。**
`vibepro decision record --source budget:delivery_efficiency:<story-id>` は
`.vibepro/config.json` を自分で読んで digest を計算する（`src/decision-records.js`
`buildBudgetApprovalForSource`）。呼び出し側が digest を渡す経路は存在しない。
これにより「9 を承認させてから 40 に書き換える」が digest 不一致で落ちる（OGB-S-3）。
digest の対象からは `amendment_reason` を除いてあるので、文言の修正は再承認を要さず、
逆に文言の書き換えで数値の変更を隠すこともできない（OGB-S-4）。
digest には story_id を含めてある。同じ limits を持つ別 Story でも digest が異なるため、
承認記録を他 Story へ移植する経路は digest 自体で塞がれる（story_id の等価検査 2 箇所に
依存しない）。

**受ける側と与える側の分離。** 承認記録は「誰が承認したか (grantor)」と
「どのエージェントが記録したか (recorded_by)」の両方を持ち、両者が一致すると
書き込み時に throw し（`buildBudgetApproval`）、既存記録なら消費時に `self_approved`
として無効になる。これは `src/adjudication.js` が premise correction の再裁定で
使っている独立性判定と同じ形（記録された provenance の相異をコードが検査する）である。

## 既存13件の互換性: content digest による grandfather（明示的決定）

**決定: 13件すべてを grandfather する。ただし story_id ではなく override の内容 digest で pin する。**

`GRANDFATHERED_OVERRIDE_DIGESTS` は `src/budget-override-authority.js` の
frozen 定数で、13件の story_id → 現在の内容の sha256 を持つ。

- **grandfather する理由**: 13件はすべて merge 済み Story のものであり、遡及的に無効化すると
  既に merge された PR の意味を書き換えることになる。親 Story の Non Goals
  「既存の記録済み証跡 artifact の遡及的無効化」と同じ立場を取る。
- **story_id ではなく digest で pin する理由**: grandfather は「この Story は今後何を書いても
  自由」という**免許**ではなく、「この内容のまま」という**スナップショット**である。
  13件のいずれかを編集すれば digest が変わり `unauthorized` に落ちる（OGB-S-7）。
- **定数をコードに置く理由**: `.vibepro/config.json` に置くとエージェントが
  grandfather 集合そのものを拡張できてしまい、gate の意味が消える。コードに置けば
  追加には diff が必要で、レビューに乗る。

新規 Story の override は grandfather されない。OGB-S-8 が
config 中の全 override が `grandfathered` か `unauthorized` のどちらかに解決されることを
検査するので、この gate が取りこぼした「黙って効いている override」は存在しない。

## User Story

**As a** AI エージェントに実装を任せるリポジトリ所有者
**I want** エージェントが自分を止める予算を自分で引き上げられず、引き上げには
私の承認記録が要り、承認した数値そのものにその記録が束縛される状態
**So that** 「止める仕組みが実際に止まるか」を毎回自分で確かめずに済む

## Acceptance Criteria

- [ ] OGB-S-1: `amendment_reason` だけを持つ Story override は policy に反映されず、
      base policy が使われる。`override.status` は `unauthorized`、
      `reasons` は `['missing_approval']`。
- [ ] OGB-S-2: `source: budget:delivery_efficiency:<story-id>` / `status: accepted` /
      digest 一致 / `grantor_kind: human` / grantor ≠ 記録エージェント / reason 非空、
      をすべて満たす decision record がある場合にのみ override が適用される。
- [ ] OGB-S-3: 承認後に override の数値を書き換えると digest 不一致で無効になる。
- [ ] OGB-S-4: digest は `amendment_reason` を含まず story_id を含む。文言変更では
      承認が壊れず、数値変更では必ず壊れ、同一 limits の別 Story とは digest が一致しない。
- [ ] OGB-S-5: grantor が記録エージェント自身（`agent_id` / `agent_system` /
      `system:id` のいずれの表記でも）、`grantor_kind: agent`、記録エージェント未識別、
      `status: open` のいずれの場合も override は適用されない。
- [ ] OGB-S-6: 自己承認・記録エージェント未識別・不正な grantor_kind は
      decision record の**書き込み時**にも throw する（無効な記録を黙って作らない）。
- [ ] OGB-S-7: 既存13件は grandfather されて挙動不変。内容を編集すると
      `unauthorized` に落ちる。
- [ ] OGB-S-8: `.vibepro/config.json` の全 override が `grandfathered` か
      `unauthorized` のいずれかに解決される（黙って効く override が無い）。
- [ ] OGB-S-9: `unauthorized` な override は efficiency debt
      `budget_override_unauthorized` として報告される。
- [ ] OGB-S-10: `vibepro decision record --source budget:delivery_efficiency:<id>` は
      digest を `.vibepro/config.json` から自分で計算する。呼び出し側の digest 入力は
      経路自体が存在しない。
- [ ] OGB-S-11: 承認記録には `--reason` / `--budget-grantor` / `--budget-grantor-kind` /
      `--agent-system` / `--agent-id` が必須で、欠落は throw する。
- [ ] OGB-S-12: override が config に存在しない story、`--id` と `--source` の
      story_id が食い違う場合、budget flags を budget 以外の source に付けた場合は throw する。

## Non Goals

- 人間性の暗号学的証明。out-of-band な署名チャネルを持たない以上、コードは
  「実在する人間が承認した」ことを in-band で証明できない（残余に記載）。
- global default budgets / `evidence_cost_budget` / `pr_artifact_bytes` の override 管理。
  特に `budgets.delivery_efficiency`（global default）は本 Story では gating されない。
  Story 別 override を塞いでも global default を書き換える経路が残るため、
  CEA-S-4 の完全な達成には後続 Story が必要である（GE-004）。
- 既存13件の override の値そのものの妥当性の再評価。
- 承認回数の削減。目的は承認の**所在**を移すことであって、頻度を下げることではない。

## 残余（この Story で消えないもの）

**書き込み権限を持つエージェントは、実在しない人間の名前で承認記録を書ける。**
コードはそれを in-band で検出できない。閉じるには out-of-band の署名チャネル
（人間の鍵で署名された grant）が要り、本 Story の範囲外である。

ただし変わったことは実質的である。before: どのコードも読まない自由文フィールドと、
存在すらしない decision record。after: (1) コードが実際に読む decision record が要る、
(2) 承認は system が計算した digest で特定の数値に束縛される、
(3) 承認者と記録エージェントが記録され、一致するとコードが拒否する、
(4) 未承認の override は `pr prepare` の efficiency debt として人間の目の前に出る。
自己承認は「gate の抜け道」から「名前と digest と時刻が残る偽造」になった。
偽造を検出するのは人間だが、検出に必要な材料は自由文ではなく構造化された記録である。

## 検証済みの範囲（Evidence）

- `test/delivery-efficiency-guardrail.test.js`: OGB-S-1〜S-9（21 tests pass）。
  OGB-S-7 / S-8 は実際の `.vibepro/config.json` を読んで13件を検査する。
- `test/decision-records.test.js`: OGB-S-10〜S-12（8 tests pass）。
- 旧契約を encode していた既存テスト
  `story budget override preserves global defaults and merges role limits` は
  意図的に反転させ `story budget override without an accepted approval stays inert` に
  置き換えた。同じ config が base policy に解決されることを assert する。
  これは仕様変更であって修正ではない。
