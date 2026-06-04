---
story_id: story-vibepro-failure-mode-coverage-gate
title: 受け入れ基準ごとの失敗モードcoverageをGate化する
view: dev
period: 2026-06
source:
  type: codex-log-audit
  id: VP-EJD-AUDIT-003
  title: "Review logs found warning/error paths undercovered despite nominal tests"
architecture_docs:
  - ../../../architecture/vibepro-failure-mode-coverage-gate.md
spec_docs:
  - ../../../specs/vibepro-failure-mode-coverage-gate.md
status: active
created_at: 2026-06-04
updated_at: 2026-06-04
---

# 受け入れ基準ごとの失敗モードcoverageをGate化する

## 背景

直近レビューでは、正常系やマーカー確認の証跡はあるが、timeout、JSON parse failure、schema failure、低信頼度、外部provider欠落などの失敗時挙動が実行証跡で示されていないため `needs_changes` になった。

熟練エンジニアは「動くか」だけでなく「失敗したときにどう壊れるか、壊れた事実がユーザーや運用に届くか」を見る。VibeProのGate DAGも、Acceptance Criteriaと変更surfaceから失敗モードを導出し、coverage不足を明示する必要がある。

## User Story

**As a** VibeProでリスクのある変更をPR化する開発者
**I want to** Acceptance Criteriaごとの正常系と失敗系のcoverage不足をGate DAGで知りたい
**So that** marker testやhappy pathだけで壊れ方を未検証のままPRを出さずに済む

## 方針

- Story AC、Spec scenario/contract、差分surfaceからfailure mode候補を導出する。
- `gate:failure_mode_coverage` を追加し、failure modeごとに実行証跡または明示的な非該当理由を要求する。
- failure modeは固定リストではなくrouteに応じて増やす。例: external API, parser, DB persistence, queue/retry, auth, agent lifecycle, UI fallback。
- source textやmarkerの存在だけではpassにせず、実行結果またはassertionが対象failureを検証していることを要求する。

## 受け入れ基準

- [ ] `gate-dag.json` に `gate:failure_mode_coverage` が出る
- [ ] Acceptance Criteriaごとに正常系と失敗系のcoverage statusが出る
- [ ] timeout/parse/schema/provider欠落/retry/auth deniedなど、変更surfaceに応じたfailure mode候補が出る
- [ ] failure modeに対応するUnit/Integration/E2E/Flow Verification evidenceがない場合、該当modeが `missing_coverage` になる
- [ ] source markerや文字列一致だけではfailure mode coverageをpassしない
- [ ] failure modeが非該当の場合は、根拠付きの `not_applicable` を記録できる
- [ ] warningやfallbackの永続化を求めるACでは、保存先artifactまたはDB fieldまで検査対象に含める
- [ ] PR bodyに未カバーfailure modeと推奨検証コマンドが表示される

## 非目標

- すべてのfailure modeを自動で完全列挙すること
- 低リスクdocs-only変更に失敗系テストを強制すること
