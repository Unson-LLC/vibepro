---
story_id: story-vibepro-responsibility-authority-core-catalog
title: VibePro自身の中核責務をResponsibility Authority Registryへ追加する
view: dev
period: 2026-06
architecture_docs:
  - docs/architecture/vibepro-responsibility-authority-core-catalog.md
spec_docs:
  - docs/specs/vibepro-responsibility-authority-core-catalog.md
status: active
created_at: 2026-06-26
updated_at: 2026-06-26
---

# VibePro自身の中核責務をResponsibility Authority Registryへ追加する

## Background

Responsibility Authority Registry は VibePro自身の `gate:responsibility_authority` を self-dogfood する最小契約から始まった。次に必要なのは、VibeProのPR readinessを支える中核責務を registry へ追加し、今後の変更で「この責務の設計SSOTは何か」を機械的に答えられる範囲を増やすこと。

## Acceptance Criteria

- PR lifecycle execution の責務が registry と Domain Contract に登録されている。
- Agent Review lifecycle の責務が registry と Domain Contract に登録されている。
- Verification evidence lifecycle の責務が registry と Domain Contract に登録されている。
- Story source integrity の責務が registry と Domain Contract に登録されている。
- Engineering Judgment route/axis の責務が registry と Domain Contract に登録されている。
- Managed worktree execution locality の責務が registry と Domain Contract に登録されている。
- 各責務は primary authority、supporting authority、owned surfaces、required evidence、unknown policy を持つ。
- テストは、各 core responsibility が current-head evidence と contract clause ID によって解決できることを確認する。

## Out of Scope

- VibeProの全責務を一度に網羅すること。
- `src/pr-manager.js` の全責務を一括で広く path ownership すること。
- Domain Contract ではなくMarkdown要約だけを primary authority にすること。
