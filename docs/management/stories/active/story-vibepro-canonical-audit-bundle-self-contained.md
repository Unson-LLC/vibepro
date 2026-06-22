---
story_id: story-vibepro-canonical-audit-bundle-self-contained
title: Canonical audit bundleをhandoff単位で自己完結させる
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-22-CANONICAL-SELF-CONTAINED
  title: "canonical audit bundleが.vibepro参照を残し、main checkout単体で再構成できない"
related_stories:
  - story-vibepro-canonical-audit-bundle-replay
  - story-vibepro-canonical-audit-artifacts
  - story-vibepro-engineering-judgment-activation-precision
architecture_docs:
  - docs/architecture/vibepro-canonical-audit-bundle-self-contained.md
spec_docs:
  - docs/specs/vibepro-canonical-audit-bundle-self-contained.md
created_at: 2026-06-22
updated_at: 2026-06-22
---

# Story

VibeProはmerge後に `docs/management/audit-artifacts/<story-id>/` へ
監査コアartifactを昇格できるようになった。しかし2026-06-22の価値監査では、
最新のEngineering Judgment系Storyで、canonical artifact内の参照が
`.vibepro/pr/<story-id>` や `.vibepro/reviews/<story-id>` のまま残り、
canonical `main` checkout上では多数の参照先が存在しなかった。

これは「artifactを保存した」ように見えるが、別engineer/agentがfresh checkoutから
判断経路を再構成できない状態である。VibeProの価値は、PRを通すことではなく、
後から senior engineer が「何を見て通したか」を追えることにある。

VibeProはcanonical audit bundleを、handoffに必要な最小単位で自己完結させる必要がある。

## Acceptance Criteria

- [ ] `audit-bundle.json` 内の各artifact参照は、canonical pathをprimaryとして持ち、
      `.vibepro/...` source pathだけに依存しない。
- [ ] canonical bundle内の `review-summary.json` / `review-result-*.json` /
      `verification-evidence.json` に含まれる参照先が、canonical bundle配下に
      解決可能かどうかを検査する。
- [ ] 解決不能な `.vibepro/...` 参照が残る場合、`audit-bundle.json` に
      `unresolved_references[]` と `handoff_replay_status=blocked` を記録する。
- [ ] handoffに必要な review request、review result、manual verification artifact、
      subagent transcript summary、durable command log summary は canonical bundleへ昇格する。
- [ ] raw provider log、HTML report、一時dispatch scratch、巨大な途中状態は保存対象外のまま維持する。
- [ ] `vibepro usage report` は `handoff_replay_status=blocked` のStoryを
      fake-value signalとして表示する。
- [ ] 回帰テストは、`.vibepro` が存在しないfresh checkout fixtureで、
      canonical bundleだけから merge URL、head SHA、verification evidence、
      review conclusion を再構成できるケースを含む。

## Non Goals

- `.vibepro/` 全体をtrackedにすること。
- raw transcript全文やprovider固有ログを永続化すること。
- 既存のcanonical artifact方針を廃止して、すべての一時ファイルを保存すること。
