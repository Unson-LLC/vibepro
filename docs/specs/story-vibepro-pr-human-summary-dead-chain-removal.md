---
story_id: story-vibepro-pr-human-summary-dead-chain-removal
title: 死んだ人間向けPRサマリーレンダラーチェーン削除の契約 Spec
status: active
parent_design: story-vibepro-pr-human-summary-dead-chain-removal
---

# 死んだ人間向けPRサマリーレンダラーチェーン削除の契約 Spec

正本のSpec artifactは `.vibepro/spec/story-vibepro-pr-human-summary-dead-chain-removal/spec.json`（clauses: INV-001 / INV-002 / INV-003 / CON-001）。本ファイルはDesign SSOTのlineage束縛用のspec pointerかつ公開契約変更のcontract docであり、Storyの受け入れ基準は `docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md` を参照する。

## Contract Summary

### 削除される公開契約面（module exports）

`src/pr-manager.js` から以下の2つのexported関数を削除する。両者はPR #228以降production呼び出し元ゼロで、参照していたのは本Storyで同時に削除する2テストファイルのみ（story-vibepro-uiux-intake-gate-pr-summary-surfaces の3独立レビューで確認済み）。

- `renderPrGateSummary(gateDag)` — per-gate詳細行のレンダラー。同内容は `gate-dag.json` / `gate-dag.html` / `pr-prepare.json` `gate_status` が正本として提供する。
- `buildHumanEvidenceDigest(gateDag)` — curated gateラベルの1行ダイジェスト。同内容は `review-cockpit.html` / `gate-dag.html` が人間向けに提供する。

内部専用（非export）の22関数も同時に削除する。exportされていないため外部利用者への契約影響はない。

### 互換性（compat_or_output_test）

- `vibepro` CLIのコマンド・フラグ・exit code・出力形式は不変更。
- pr prepare が生成する `pr-body.md` のconcise契約（セクション順序 判断→経緯→原因→解決→レビュー観点→確認→詳細、`Engineering Judgment:` 出現禁止、判断過程narrative禁止、suppressed axis詳細禁止、20KB上限）は不変更。CON-001としてfull suiteの契約テスト（test/vibepro-cli.test.js / test/risk-adaptive-gate.test.js / test/engineering-judgment-activation-precision.test.js）と、本Story e2eの実repo fixture再生（ac:3）で検証する。
- 生成される `.vibepro/` artifact（pr-prepare.json / gate-dag.json / review-cockpit.html 等）の形式・内容は不変更。
- `package.json` のpublic API（binエントリ）は変更なし。`src/pr-manager.js` のexportsはVibePro内部モジュール契約であり、削除2関数の残存参照はrepo内ゼロをe2eで固定する（ac:1, ac:4）。

### story_spec_traceability

- Story: `docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md`（AC-1〜AC-4）
- Spec artifact: `.vibepro/spec/story-vibepro-pr-human-summary-dead-chain-removal/spec.json`（INV-001↔AC-1, INV-002↔AC-2, CON-001↔AC-3, INV-003↔AC-4）
- E2E: `test/e2e/story-vibepro-pr-human-summary-dead-chain-removal-main.test.js`（ac:1〜ac:4 markers）

### Rollback

単一commitのrevertで削除関数・削除テスト・本docが同時に復元される。データ・schema・生成artifactの移行はない。
