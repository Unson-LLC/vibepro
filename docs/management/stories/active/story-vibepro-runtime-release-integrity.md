---
story_id: story-vibepro-runtime-release-integrity
title: "VibePro自己改善: 実際に動いているVibeProの版を保証する"
source:
  type: codex-log-audit
  id: VP-SELF-002
  title: "修正済みと思ったVibeProが実行環境へ反映されない"
architecture_docs:
  - ../../architecture/vibepro-self-dogfood-control-loop-architecture.md
spec_docs:
  - ../../specs/vibepro-self-dogfood-control-loop.md
status: active
created_at: 2026-05-16
updated_at: 2026-05-16
---

# Story: VibePro自己改善: 実際に動いているVibeProの版を保証する

## User Story

**As a** VibeProを使って開発を任せたいユーザー
**I want to** 実際に呼び出されているVibePro CLI、checkout、origin/main、Skill群の版が確認される
**So that** 修正したはずの機能が古いcheckoutや古いSkillで実行され、同じ問題を再発させることを防げる

## Background

VibeProの修正後にも、実際に `~/.local/bin/vibepro` がどのcheckoutを参照しているか、`workspace/code/vibepro` がorigin/mainへ追随しているか、Skillが最新版に追随しているかを都度確認する必要があった。

一方で、余計なcheckoutを増やすと実態把握が難しくなり、どのVibeProを使って検証したのかが曖昧になる。

## Acceptance Criteria

- [ ] `vibepro doctor` と `vibepro pr prepare` が、実行中CLIの実体パス、package root、git HEAD、branch、origin/mainとの差分を表示する
- [ ] 実行中CLIが期待repoと異なる場合、PR gateに runtime_mismatch を出す
- [ ] `workspace/code/vibepro` がorigin/mainに追随していない場合、stale_runtime として警告する
- [ ] Skill配布先がVibePro本体の最新版とずれている場合、skills_drift として検出できる
- [ ] 追加checkoutを作らずに、既存の正本checkoutを最新化する手順が証跡に残る
- [ ] 診断結果には「どのファイル、どのログ、どのプロセスで確認したか」を含める

## Implementation Notes

- 対象候補: `src/runtime-info.js`, `src/doctor.js`, `src/pr-manager.js`
- Skill同期の扱いは、VibePro本体と運用Skill repoの責務境界を明示する
- dirty fileは実行版の判定と混ぜず、別の作業状態として扱う
