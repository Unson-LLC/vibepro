---
story_id: story-vibepro-canonical-audit-diff-stats
title: "execute mergeでPR diff統計をcanonical auditへ接続する"
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-23-DIFF-STATS
  title: "証跡コスト比率の表示はあるが、実PRのsrc/test/docs変更量がcanonical auditに入っていない"
related_stories:
  - story-vibepro-evidence-cost-budget
  - story-vibepro-canonical-audit-artifacts
  - story-vibepro-usage-report-canonical-traceability
architecture_docs:
  - docs/architecture/vibepro-canonical-audit-diff-stats.md
spec_docs:
  - docs/specs/vibepro-canonical-audit-diff-stats.md
created_at: 2026-06-23
updated_at: 2026-06-23
---

# Story

VibeProは `usage report` に証跡コスト欄を出せるようになったが、直近の実PRでは
`product_changed_lines: 0` となり、src/test/story-spec-architecture docs の変更量が
canonical auditに接続されていなかった。

これでは「監査証跡が本体修正より大きいか」を判断できず、token/time比率の議論も
推測に戻ってしまう。`execute merge` はPR merge時点のdiff統計を取得し、canonical
audit bundleへ信頼できる cost summary として永続化する必要がある。

## User Story

**As a** VibeProの価値監査をするengineer<br>
**I want to** merged PRのdiff統計がcanonical audit bundleに正しく残ってほしい<br>
**So that** audit artifact/code比率、docs比率、test比率を実データで判断できる

## Scope

- `execute merge` がPRのbase/head/merge commitから `git diff --numstat` 相当のper-file統計を取得する
- 取得した統計を `src`、`test`、story/spec/architecture docs、audit artifacts、other に分類する
- `promoteCanonicalAuditArtifacts` と `buildCanonicalEvidenceCostSummary` に実diff統計を渡す
- diff統計が取れない場合は0扱いにせず、`unavailable` と理由を記録する
- `usage report` はcanonical cost summaryの実測値を表示し、未取得の値だけ `未確認` とする

## Acceptance Criteria

- [ ] `execute merge` 後の `audit-bundle.json` / `audit-index.json` に `diff_stats_source`、base ref、head ref、merge commit、取得時刻が残る。
- [ ] 実PRにsrc/test/docs変更がある場合、canonical `cost_summary.changed_lines.by_bucket` が0ではなく実diff統計を反映する。
- [ ] `artifact_code_ratio` は audit artifact行数を product/source側の変更行数で割った値として計算され、分母が0または未取得なら `null` + 理由になる。
- [ ] diff統計の取得に失敗した場合、VibeProは `product_changed_lines: 0` を事実のように保存せず、`diff_stats_status: unavailable` を保存する。
- [ ] `usage report` は `src`、`test`、story/spec/architecture docs、audit artifacts、other のchanged linesをstory別に表示できる。
- [ ] regression testは「実diffあり」「diff取得不能」「audit-only変更」「docs-only変更」の4ケースを含む。

## Non Goals

- token/timeログの収集実装。
- 証跡生成量そのものの削減。
- GitHub APIだけに依存した過去PRの完全復元。
- diff統計が取れないStoryをpass扱いにすること。
