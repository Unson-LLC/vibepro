---
story_id: story-vibepro-verification-evidence-roi
title: Verification Evidence ROI Spec
---

# Spec

## Artifact cross-check on `verify record`

- `--artifact <path>` が指定された場合、ファイルが存在しなければ record はエラーで失敗する。
- artifact が JSON で既知の形式の場合、テスト結果の outcome（pass/fail）を導出する:
  - vitest/jest: `success` boolean または `numFailedTests > 0`。
  - Playwright: `stats.unexpected > 0`。
  - generic: top-level `status` が pass 系/fail 系の値。
- 申告 status が pass 系（pass/passed/success/ok）で artifact outcome が fail の場合、record はエラーで失敗し、証跡は書き込まれない。
- 突き合わせ結果は command の `artifact_check` に記録される: `status` は `verified` / `unrecognized` / `missing` のいずれか。
- 申告 status が pass 系で `--artifact` が未指定の場合、`artifact_check.status = "missing"` として記録される。record はブロックしない。
- fail 系 / needs_setup の申告は artifact との矛盾でブロックしない（ゲートを閉じる方向の申告は安全側）。

## Widened low-risk evidence reuse

- `collectGitState` は `git diff --numstat` から per-file の additions/deletions を収集し、classifier へ `diffStats` として渡す。
- 以下をすべて満たす変更は `change_type = low_risk_evidence_change` に分類される:
  - source 変更が 1〜2 ファイル、かつ全ファイルの additions+deletions 合計が 30 行以下。
  - 検出された risk surface が `test_coverage` 以外に存在しない。
  - regression hotspot に該当する source 変更がない。
  - source 以外の変更が story docs / specs / tests に限られる。
  - profile が `light` である。
- 行数が不明な source ファイル（numstat に現れない untracked 等）が含まれる場合は reuse 対象にしない。
- `evidence_reuse_policy.mode` は source 変更を含む場合 `small_source_low_risk_reuse` とし、行数バジェットを記録する。
- 既存の docs/specs/tests のみの変更の分類（`path_scoped_low_risk_reuse`）は変更しない。
