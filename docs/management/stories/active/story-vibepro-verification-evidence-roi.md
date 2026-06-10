---
story_id: story-vibepro-verification-evidence-roi
title: 検証証跡のROIを上げる（artifact突き合わせとlow-risk reuse拡張）
status: active
source:
  type: local_log_audit
  id: claude-vibepro-evidence-roi-audit-2026-06-10
architecture_docs:
  - docs/architecture/vibepro-verification-evidence-roi.md
spec_docs:
  - docs/specs/vibepro-verification-evidence-roi.md
---

# Story

`vibepro verify record` は申告された status をそのまま記録するため、虚偽の pass 申告を検出できない。一方で、すべての変更に新しい証跡の再取得を要求すると、軽微な修正でもトークンと時間を浪費する。

検証の厳密性は二層に分ける。安い厳密性（決定的な artifact 突き合わせ）は全域に適用し、高い厳密性（検証の再実行）はリスクに比例させる。

- artifact 突き合わせ: `--artifact` で渡された machine-readable なテスト出力をパースし、申告 status と矛盾する pass 申告を記録前に止める。テストの再実行は要求しない。
- low-risk reuse 拡張: risk surface に該当しない小さな source 差分（少ファイル・少行数）は、Story/Spec/test のみの変更と同様に、既存の passing 証跡を再利用できるようにする。

## Acceptance Criteria

- `verify record` で pass 系 status と artifact の fail 結果が矛盾した場合、証跡は記録されずエラーになる。
- `--artifact` で指定されたファイルが存在しない場合、証跡は記録されずエラーになる。
- artifact が既知の形式（vitest/jest、Playwright、generic status JSON）の場合、突き合わせ結果が `artifact_check` として証跡に記録される。
- pass 系 status で artifact が未指定の場合、`artifact_check.status` が `missing` として記録される（記録はブロックしない）。
- risk surface 非該当かつ regression hotspot 非該当で、source 変更が 2 ファイル以下・合計 30 行以下の light 変更は `low_risk_evidence_change` に分類され、dirty fingerprint 変化のみで stale になった passing 証跡を再利用できる。
- risk surface に該当する source 変更、行数超過、ファイル数超過のいずれかがある場合は reuse 対象にならない。

## Tasks

- [x] artifact 突き合わせ（存在チェック・パース・矛盾ブロック・`artifact_check` 記録）を `verify record` に追加する。
- [x] `git diff --numstat` から per-file 行数を収集し、change risk classifier へ渡す。
- [x] classifier に小さな source 差分の low-risk 判定を追加し、evidence reuse policy を拡張する。
- [x] testsで矛盾ブロック・missing artifact・reuse 境界条件を検証する。
