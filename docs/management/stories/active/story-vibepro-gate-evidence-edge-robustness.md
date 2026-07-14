---
story_id: story-vibepro-gate-evidence-edge-robustness
title: "gate evidence機構をmalformed workspaceとextra bag衝突に対して堅牢化する"
view: dev
period: 2026-07
source:
  type: salvage-triage
  id: VP-SALVAGE-2026-07-14-GATE-EVIDENCE-ROBUSTNESS
  title: "canonical checkout上の未コミット実験編集のうち、健全なrobustness/correctness改善のみを正式化する"
architecture_docs:
  - ../../../architecture/vibepro-gate-evidence-edge-robustness.md
spec_docs:
  - ../../../specs/vibepro-gate-evidence-edge-robustness.md
parent_design: vibepro-gate-evidence-edge-robustness
status: active
created_at: 2026-07-14
updated_at: 2026-07-14
---

# gate evidence機構をmalformed workspaceとextra bag衝突に対して堅牢化する

## User Story

**As a** VibeProをハーネスとして使うAIコーディングエージェント／運用者
**I want to** gate evidenceの走査とevidence item組立が、ディレクトリのはずのパスがファイルだった場合や、
呼び出し側が渡す追加フィールドがcanonicalなkind/refと衝突した場合でも、クラッシュや静かな取り違えを
起こさず正しく振る舞ってほしい
**So that** 壊れかけた workspace（本来ディレクトリの場所にファイルがある等）や将来の呼び出し追加でも、
`vibepro pr prepare` が例外で止まったり、証拠itemのkindが黙って上書きされたりしない

## 背景

canonical checkout（`~/workspace/code/vibepro`）に、172コミット前の実験的な未コミット編集が
salvageブランチ（`salvage/pre-reevolve-main-2026-07-14`）として残っていた。6編集を現行mainに対して
シニア判断で精査した結果、以下2件のみが「上流に存在せず・安全・実利のあるrobustness/correctness改善」
と確認できた（残り4件は上流で解決済み・消費者なし・あるいはセキュリティ/契約bindingを弱める退行のため除外）。

1. `safeReaddir`（execution-state.js）が `ENOENT` のみをハンドルし、`ENOTDIR` を投げてしまう。
   本来ディレクトリであるべきパスがファイルだった場合（壊れたworkspace）、走査系が例外で停止する。
   `ENOTDIR` も「エントリなし（`[]`）」として扱うのが正しい（`safeReaddir` の設計意図＝走査対象が
   無ければ空を返す、に合致）。
2. `buildEvidenceItem`（pr-manager.js）が `...extra` を最後に展開しているため、`extra` に `kind` や `ref`
   が含まれると明示引数を黙って上書きできてしまう。実際、呼び出しの1つ（`classifySeniorAxisEvidence`
   内の `add`）は `{ ...extra, kind }` という回避策で同じkindを二重指定している。明示引数と既定値が
   常に勝つよう `...extra` を先頭に展開し、この footgun を消す（回避策も不要になる）。

いずれも「壊れた入力・将来の呼び出し追加でも黙って壊れない」という、直近のcorrupt-artifact対策
（JADJ-S-011）と同じ堅牢化の系列である。

## Scope

- `safeReaddir` が `ENOTDIR` でも `[]` を返す（`ENOENT` と同じ非致命扱い）。それ以外のエラーは従来どおり throw。
- `buildEvidenceItem` は `...extra` を先頭で展開し、`kind` / `ref` / `strength` 等の既定値付き明示フィールドが
  `extra` の同名キーに勝つようにする。`extra` の追加フィールド（`matched_file_count`・`investigation_files`・
  `deprecation` 等）は従来どおり保持される。
- `classifySeniorAxisEvidence` 内 `add` の `{ ...extra, kind }` 回避策から冗長な `kind` を除去する
  （`buildEvidenceItem` 側の修正で不要になったことの実証）。

## 非目標

- salvageの他4編集（auth境界のパスゲート・`add(item.kind)`・explicit kindsへのnegative_path系追加・
  responsibility `command.kind` 直接照合）の取り込み。auth境界とcommand.kind照合はセキュリティ/契約
  bindingを弱めるため明示的に除外し、残り2件は上流で既に解決済み・消費者なしのため除外する。
- 走査系・evidence機構のロジック再設計。エラーハンドリングとフィールド優先順位の局所修正に限定する。

## 受け入れ基準

- [ ] `safeReaddir` は対象がファイル（`ENOTDIR`）のとき例外を投げず `[]` を返し、`ENOENT` のときも従来どおり `[]` を返す。それ以外のエラーは再throwする。
- [ ] `buildEvidenceItem` は `extra` が `kind` や `ref` を含んでいても、明示引数の `kind` / `ref` が最終結果で勝つ。
- [ ] `buildEvidenceItem` は `extra` が `strength` / `binding_status` / `artifact_quality` を持たない場合に既定値（`declared` / `n/a` / `unknown`）を返し、持つ場合はその値を保持する。
- [ ] `buildEvidenceItem` は `extra` の追加フィールド（例: `matched_file_count`・`investigation_files`）を結果に保持する。
- [ ] `classifySeniorAxisEvidence` 内 `add` は `kind` を `extra` に重複指定しなくても、正しい `kind` の evidence item を生成する。
- [ ] テストは「`ENOTDIR`/`ENOENT`/その他エラーの分岐」「明示 `kind`/`ref` が `extra` に勝つ」「既定値と追加フィールド保持」を含む。
- [ ] 既存の gate check・evidence機構・pr prepare スイートに退行がない。

## 検証メモ

証拠記録では自動テストで検証した事実のみをverify recordへ記録する。clause裁定とjudgment裁定を
独立fresh context subagentへdispatchする（自身の判断DAGを新ゲートで裁く2例目）。
