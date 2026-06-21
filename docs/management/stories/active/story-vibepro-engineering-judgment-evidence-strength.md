---
story_id: story-vibepro-engineering-judgment-evidence-strength
title: Engineering Judgmentのevidenceをpresence判定からstrength判定へ移す
view: dev
period: 2026-06
source:
  type: user_feedback
  id: VP-EJD-SENIORITY-2026-06-21-STRENGTH
  title: "evidenceがあることと、senior engineerが信用できる強さを持つことが区別されていない"
related_stories:
  - story-vibepro-engineering-judgment-surface-evidence
  - story-vibepro-verification-observation-artifacts
  - story-vibepro-review-evidence-handling
architecture_docs:
  - docs/architecture/vibepro-engineering-judgment-evidence-strength.md
spec_docs:
  - docs/specs/vibepro-engineering-judgment-evidence-strength.md
status: active
created_at: 2026-06-21
updated_at: 2026-06-21
---

# Story

現在のEngineering Judgmentは、`test files in diff` や current-bound command の存在で
evidenceをかなり広く満たせてしまう。
しかし senior engineer は、evidence の存在だけでなく、
その再現性、対象一致、artifact quality、反証可能性を見る。

generic test pass、手書きsummary、machine-readable artifact無しの pass claim は、
高リスクsurfaceでは同じ強さとして扱うべきではない。
VibeProは matched evidence を `ある/ない` ではなく、
少なくとも `declared / supporting / strong` の strength で扱う必要がある。

## Acceptance Criteria

- [ ] `matched_evidence[]` の各要素は `strength` と `strength_reason` を持つ
- [ ] high-risk surface では、required evidence kindごとに minimum strength が定義される
- [ ] `test files in diff` や broad regression suite は supporting evidence にはなれても、
      それ単独では `current_reality` や `failure_modes` を pass させない
- [ ] verification evidence に machine-readable artifact が無い pass claim は、
      `current_verification` として supporting までに留まり、strong にはならない
- [ ] PR body / Gate DAG / review cockpit から、
      「なぜそのevidenceが strong なのか、なぜ weak/supporting 扱いなのか」を追える
- [ ] representative tests として、`#203` 型の artifact薄いケースと
      `#206` 型の durable log/artifact 付きケースで strength 差分を検証する

## Non Goals

- すべての evidence を数値スコア1本で比較すること
- Graphify を runtime/security correctness の strong evidence に昇格させること
- LLM summary を machine artifact の代替にすること
