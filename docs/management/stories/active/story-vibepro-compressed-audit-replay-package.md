---
story_id: story-vibepro-compressed-audit-replay-package
title: "監査証跡を薄い判断要約と圧縮replay bundleに分離する"
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-25-COMPRESSED-AUDIT-REPLAY
  title: "人間向け説明と機械向けreplay材料が混ざり、監査証跡が本体修正より重くなっている"
related_stories:
  - story-vibepro-evidence-cost-budget
  - story-vibepro-evidence-summary-reuse
  - story-vibepro-canonical-audit-bundle-self-contained
  - story-vibepro-canonical-audit-bundle-replay
architecture_docs:
  - docs/architecture/vibepro-compressed-audit-replay-package.md
spec_docs:
  - docs/specs/vibepro-compressed-audit-replay-package.md
created_at: 2026-06-25
updated_at: 2026-06-25
---

# Story

VibeProの監査証跡は、テスト通過ログではなく、別engineer/agentが後から「なぜこのPRを通してよいと判断したか」を再構成するための材料である。

ただし現在のcanonical auditでは、人間が読むべき判断要約、LLM/review入力、Gate DAG詳細、verification evidence、PR lifecycle JSON、raw artifact digestが混ざりやすい。その結果、小さな実装修正でも `docs/management/audit-artifacts/` が大きくなり、main checkoutで読む側も「どこだけ見れば判断できるか」を判断しにくい。

VibeProは監査証跡を、人間が読む薄い `decision-summary.md` と、機械が展開・検証できる圧縮replay bundleに分離するべきである。raw evidenceは人間が直接読めなくてもよいが、schema、hash、source refs、replay commandから同じ判断を再構成できる必要がある。

## User Story

**As a** VibeProでPR readinessやmerge可否を確認するengineer<br>
**I want to** 人間は短い判断要約だけを読み、必要時だけ機械可読の圧縮bundleを展開できる<br>
**So that** senior engineering judgmentの再現性を保ちながら、監査証跡のchanged lines、token読込、handoff負荷を下げられる

## Scope

- `decision-summary.md` を人間向けの唯一の第一入口にする
- full Gate DAG、review lifecycle、verification evidence、traceability map、PR/merge metadata、raw logs digestを圧縮replay bundleへ移す
- `audit-index.json` は summary と compressed bundle のmanifest、hash、schema、included artifact kinds、replay commandを持つ
- `usage report` と価値監査は、まず summary/index だけを読み、赤信号があるStoryだけbundleを展開する
- 圧縮bundleはhuman-readableでなくてもよいが、fresh main checkoutで `.vibepro/` なしに検証できる
- compressed artifactはline-countではなくbyte size、expanded line count、hashでコスト計測する

## Acceptance Criteria

- [ ] canonical audit promotionは、人間向けの `decision-summary.md` と機械向けの compressed replay bundleを別artifactとして生成する。
- [ ] `decision-summary.md` は、verdict、story id、PR URL、merge/head SHA、active/suppressed risk axes、pass/block/waiver理由、missing/stale/unverified evidence、replay pointerだけを含み、raw JSONや巨大Gate DAGを重複掲載しない。
- [ ] compressed replay bundleは、Gate DAG詳細、verification evidence、review result、traceability map、PR/merge metadata、artifact digests、source timestampsを含む。
- [ ] `audit-index.json` は compressed bundle の path、compression format、schema version、content hash、expanded size、included artifact kinds、replay commandをmachine-readableに記録する。
- [ ] `usage report` は通常時に compressed bundleを展開せず、summary/indexから verdict、replay status、stale/missing evidence、artifact costだけを表示できる。
- [ ] bundle展開が必要な条件は、block、waiver、stale evidence、missing evidence、unresolved reference、traceability gap、review needs_changesのいずれかとして記録される。
- [ ] fresh main checkoutで `.vibepro/` が存在しなくても、replay commandが compressed bundleを一時展開し、hash検証後に verdict、verification status、review conclusion、merge metadataを再構成できる。
- [ ] compressed bundleのhash不一致、schema不一致、展開失敗は `pass` ではなく `handoff_replay_status=blocked` または `unverified` になる。
- [ ] evidence cost budgetは compressed bundleを通常のtext changed linesとして過大計上せず、compressed bytes、expanded bytes、expanded line count、summary/index changed linesを分けて表示する。
- [ ] 回帰テストは「summaryだけで通常reportが読める」「赤信号時だけbundleを展開する」「fresh checkoutでreplayできる」「bundle破損時はblockedになる」を含む。

## Non Goals

- 監査証跡を捨てること。
- compressionをsecurity boundaryや暗号化として扱うこと。
- `decision-summary.md` だけでPR readinessを満たした扱いにすること。
- raw transcript全文やprovider固有ログを常にcanonical mainへ保存すること。
- 既存のhistorical audit artifactsを書き換えて新形式だったことにすること。
