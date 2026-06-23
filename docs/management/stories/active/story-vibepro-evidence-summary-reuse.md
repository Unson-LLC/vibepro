---
story_id: story-vibepro-evidence-summary-reuse
title: "PR lifecycle内でsummary/index証跡を再利用する"
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-23-SUMMARY-REUSE
  title: "同じPR内で同等の証跡を何度も生成・読込すると保存圧縮だけではtoken/timeが減らない"
related_stories:
  - story-vibepro-evidence-cost-budget
  - story-vibepro-evidence-depth-planner
  - story-vibepro-review-judgment-delta-handoff
architecture_docs:
  - docs/architecture/vibepro-evidence-summary-reuse.md
spec_docs:
  - docs/specs/vibepro-evidence-summary-reuse.md
created_at: 2026-06-23
updated_at: 2026-06-23
---

# Story

VibeProがsummary/indexを作っても、`pr prepare`、`review prepare`、review agent input、
`execute merge`、`usage report` がそれぞれ同じ巨大artifactを読み直すなら、token/timeは下がらない。

同一PR lifecycle内では、Story、head SHA、Spec fingerprint、risk surface、verification stateが変わらない限り、
既存のsummary/indexを再利用するべきである。再利用できない場合だけ、理由つきで再生成する。

## User Story

**As a** VibeProで複数gate/reviewを回すengineer<br>
**I want to** 同じ判断材料はPR lifecycle内で再利用されてほしい<br>
**So that** 同等の証跡を何度もLLMに読ませず、review品質とtoken/time効率を両立できる

## Scope

- `evidence_key` を定義し、Story ID、base/head SHA、Spec fingerprint、risk surface、verification summary hashから生成する
- `decision-summary` / `audit-index` / gate summary / review input summaryをkey付きで保存する
- `review prepare` はfull artifactより先に既存summary/indexを読む
- 同一keyのfull evidenceは1回だけ生成し、以後はdigest/referenceを再利用する
- head変更、Spec変更、verification変更、risk surface変更ではcacheをstaleにする
- cache hit/miss/staleの理由をartifactに残す

## Acceptance Criteria

- [ ] VibeProはPR lifecycle内の再利用単位として `evidence_key` を生成し、summary/index artifactに保存する。
- [ ] `review prepare` は同じ `evidence_key` のsummary/indexがfreshなら、それをreview inputの第一資料として使う。
- [ ] 同じ `evidence_key` でfull evidenceが必要になった場合、2回目以降は再生成せずdigest/referenceを再利用する。
- [ ] head SHA、Spec fingerprint、verification summary、risk surfaceのいずれかが変わった場合、既存summary/indexはstale扱いになる。
- [ ] cache hit/miss/staleは `evidence_reuse` としてmachine-readableに記録され、usage reportで確認できる。
- [ ] stale artifactをfreshとして使った場合はgate failureになり、passにはならない。
- [ ] regression testは「fresh reuse」「head変更でstale」「Spec変更でstale」「full evidence generated only once」を含む。

## Non Goals

- artifact生成前のevidence depth planner。
- canonical audit diff統計の計算。
- raw transcriptやprovider logの長期保存。
- stale artifactを自動で正しいと推測すること。
