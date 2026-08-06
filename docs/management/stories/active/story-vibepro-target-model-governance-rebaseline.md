---
story_id: story-vibepro-target-model-governance-rebaseline
title: "target model governance rebaseline — 誰がモデルを変えてよいかを三分法で確定し、再baseline案と裁定カードを機械生成する"
status: active
view: dev
period: 2026-08
category: quality
parent_design: vibepro-target-model-governance-rebaseline
related_stories:
  - story-vibepro-conformance-delta-ledger
  - story-vibepro-import-based-conformance
  - story-vibepro-senior-gap-judgment
reason:
  decision: "target-model.json に統治の三分法（機械保守 / 人間裁定 / 機械的投影）を機械可読な governance ブロックとして明記し、model_version を導入して conformance/delta artifact が『どのversionのモデルに対する計測か』を記録するようにする。そのうえで現状スキャンから、孤児ファイルの割当候補・新モジュール候補クラスタ・未宣言依存の仕分けを、根拠と『割当した場合に誘発される新規依存』付きで生成する再現可能な rebaseline proposal artifact を機械生成し、人間裁定が必要な項目だけを裁定カードとして残す"
  alternatives: "(a) 孤児25件と未宣言依存41件を agent 判断で一括して target-model へ反映する案は、note の『自動改訂を禁止』に正面から抵触し、かつ新モジュール新設・新規許可依存の宣言は R-004 が明示的に人間承認を要求するため採用しない。(b) 逆に一切機械反映しない案は、note が明示している『rulesの範囲内での機械保守』条項を死文化させ、自明な割当（src/architecture-conformance-delta.js -> architecture 等）まで人間の裁定待ちで滞留させるため採用しない。(c) proposal を手書きMarkdownだけで作る案は、violation がHEADごとに揺れる実測（76〜91、循環次元込みで27,629）に対し再現性がなく、裁定の根拠が更新できないため採用しない。(d) model_version をgit shaで代用する案は、docs以外のcommitでも値が変わり『モデルが改訂された』の意味を失うため採用しない"
  compatibility: "model_version は任意フィールドとして追加し、欠落時は null に degrade する（既存の target-model を持つ利用リポジトリで conformance が失敗しない）。conformance の出力スキーマは model.version の追加のみで既存フィールドを維持する。delta 出力は base/head の model_version と model_version_changed を追加するのみで、既存の delta/summary 構造を変えない。rules[] 本文は一切変更しない。arch conformance の import scan 方式（PR #387）は維持する"
  rollback: "governance ブロックと model_version は追加フィールドであり、削除すれば従来の target-model に戻る。rebaseline proposal は独立CLI（architecture rebaseline-proposal）とderive-onlyのartifactであり、既存のgate/PRフローに介入しないため、コマンドを使わなければ影響がない。機械保守範囲で追加した modules[].paths は、当該行を戻せば孤児として再度計上される"
  boundary: "rules[]本文の改訂はしない（人間裁定領域）。新モジュールの新設・新規allowed_dependenciesの宣言はしない（裁定カードに残す）。ratchet gate（新規悪化block）はしない。violationからのStory候補導出はしない。merge後のpost-merge reconciliation・baseline更新はしない。裁定カードへの回答はしない。dependency_cycle次元の組合せ爆発（27,551件）はこのstoryでは修正せず、proposal artifactの計測所見として記録するに留める"
created_at: 2026-08-04
updated_at: 2026-08-04
---

# target model governance rebaseline — 誰がモデルを変えてよいかを三分法で確定し、再baseline案と裁定カードを機械生成する

## User Story

**As a** VibeProを「あるべき姿へ継続収束させる制御系」へ進化させたい開発者
**I want** target architecture model の改訂権限が三分法で機械可読に確定し、モデルにversionが付き、現状ギャップの再baseline案が根拠付きで機械生成されること
**So that** 「機械が勝手にモデルを甘くする」ことも「自明な割当まで人間待ちで滞留する」ことも起きず、人間は本当に裁定が必要な少数の設計判断（新モジュール・新規許可依存・逆転依存の扱い）にだけ答えればよくなる

## Context and Gap

- `docs/architecture/target-model.json` の note は「自動生成・自動改訂を禁止する」と「modules/allowed_dependenciesの具体的な分割詳細はrulesの範囲内での機械保守の対象」を同居させており、agent が何をしてよいかが読み手依存になっている。前段（conformance delta ledger）で三分法として言語化されたが、機械可読な形ではモデルに入っていない。
- モデルは 2026-07-22 裁定だが version を持たない。conformance/delta artifact は「どのversionのモデルに対する計測か」を記録できず、モデル改訂前後の delta を同一軸の改善/悪化として誤読できる。
- 実測ギャップ（本worktree HEAD `d4e46eb2`、`vibepro architecture conformance .`）: 孤児 26 ファイル、未宣言依存 41 ペア、予算超過 11 ファイル、循環依存 27,551 件、violation 合計 27,629。孤児には計測器自身（`src/architecture-conformance-delta.js`）が含まれ、未宣言依存の筆頭は `workspace-infra -> gate-pr` 6 edges（R-001 に対する逆転）。
- 孤児をモジュールへ割り当てる操作は意味的に中立ではない。割当により、それまで孤児ゆえに不可視だった import が module 間依存として顕在化し、新規 undeclared_dependency を誘発しうる。この帰結を提示しないまま割当を進めると、モデル整備が違反数の悪化として見え、判断が濁る。

## Acceptance Criteria

- [ ] TMG-S-1: `target-model.json` は `governance` ブロックを持ち、`machine_maintainable` / `human_adjudicated` / `machine_projection` の3カテゴリに、具体的な操作が列挙される。`rules[]` の本文は変更されない。
- [ ] TMG-S-2: `target-model.json` は `model_version`（正の整数）を持ち、`loadTargetModel` はこれを読み取る。欠落時は `null` に degrade し、不正値（0以下・非整数・非数値）は理由付きエラーになる。
- [ ] TMG-S-3: `architecture conformance` の出力は `model.version` を含み、`architecture conformance --base` の delta 出力は base/head 双方の `model_version` と `model_version_changed` を含む。
- [ ] TMG-S-4: `vibepro architecture rebaseline-proposal` は、現状スキャンから (a) 孤児全件のモジュール割当候補（各候補は import 実績を根拠として持つ）、(b) 孤児の相互依存に基づくクラスタ、(c) 未宣言依存全件の `declare` / `resolve` 仕分け（rule_id 由来の根拠付き）を含む proposal artifact を生成する。
- [ ] TMG-S-5: 各割当候補は、その割当を適用した場合に誘発される新規モジュール間依存（`induced_dependencies`、既存の `allowed_dependencies` で許可されるかの判定付き）を含む。
- [ ] TMG-S-6: proposal は決定論的である。同一入力に対して2回生成すると、`generated_at` を除く全内容が完全一致する。
- [ ] TMG-S-7: 人間裁定が必要な項目（新モジュール新設、新規許可依存の承認、R-001/R-002 逆転依存の扱い）は、選択肢5問以内・各選択肢の帰結明記・推奨付きの裁定カードとして残され、未回答であることが artifact 上で判別できる。
- [ ] TMG-S-8: 機械保守範囲として `modules[].paths` に追加した割当は、割当後の再スキャンで当該ファイルが孤児から消え、かつ `rules[]` と `allowed_dependencies` が無変更であることが確認できる。

## Inherited Behavior

- import scan による依存判定（PR #387 の決定）を維持する。graphify calls エッジは復活させない。
- `architecture conformance` の既存出力スキーマ・`--strict`・`--base/--head` delta モードの挙動を維持する。
- conformance/delta は derive-only であり、recorded evidence を新設しない。

## Non Goals

- rules[] 本文の改訂。
- 新モジュールの新設と新規 allowed_dependencies の宣言（裁定カードに残す）。
- ratchet gate（新規悪化 block）。
- violation クラスタリングからの Refactoring Story 候補導出。
- merge 後の再計測・baseline 更新。
- dependency_cycle の組合せ爆発の修正（所見として記録するのみ）。

## 初期タスク

1. Governance の機械可読化
   - `governance` ブロック（三分法）を target-model.json へ追加、note から参照
2. Model versioning
   - `model_version` 追加、`loadTargetModel` の読み取りと検証、conformance/delta 出力への反映
3. Rebaseline proposal generator
   - 孤児割当候補（import 実績根拠 + induced_dependencies）、孤児クラスタ、未宣言依存仕分け、決定論性テスト
   - CLI `architecture rebaseline-proposal` と CLI リファレンス再生成
4. 裁定カードと機械保守範囲の反映
   - 人間裁定項目の裁定カード生成
   - 自明な割当のみ modules[].paths へ反映
