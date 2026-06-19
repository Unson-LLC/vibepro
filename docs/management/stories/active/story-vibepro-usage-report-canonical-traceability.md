---
story_id: story-vibepro-usage-report-canonical-traceability
title: usage reportのtraceability判定をcanonical artifact優先にする
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-19-USAGE-CANONICAL-TRACE
related_stories:
  - story-vibepro-usage-report-traceability-gaps
  - story-vibepro-canonical-audit-artifacts
architecture_docs:
  - docs/architecture/vibepro-usage-report-canonical-traceability.md
spec_docs:
  - docs/specs/vibepro-usage-report-canonical-traceability.md
---

# Story

2026-06-19の価値監査で、最新main checkoutの `vibepro usage report . --subagent-roi --json`
は `traceability_gap_rate: 0.9785` を返した。多くのstoryで
`traceability_missing_pr_artifact` が出ており、mainから見るとVibeProの履歴がほぼ欠落しているように見える。

これは、`.vibepro/` がworktree local artifactであるにもかかわらず、usage reportが
Story docと同じcheckout内の `.vibepro/pr/<story-id>` を強く期待しているために起きる。

VibeProは、merged storyのtraceability判定では `.vibepro` だけでなく
`traceability.json`、canonical audit bundle、manifestのmerge記録を優先的に読み、
「証跡が別surfaceに存在するstory」をmissing扱いしない必要がある。

## Acceptance Criteria

- `usage report` は、storyごとに local `.vibepro/pr/<story-id>`、canonical audit bundle、
  manifest merge record、tracked traceability artifact の順で証跡候補を探索する。
- canonicalまたはtracked traceabilityからPR URLとmerge commitが読めるstoryは、
  `traceability_missing_pr_artifact` にしない。
- 証跡候補のsourceを `artifact_source` または同等のmachine-readable fieldに出す。
- local `.vibepro` とcanonical bundleの両方が存在する場合は、localを優先しつつ二重集計しない。
- `value_signals.traceability_gap_rate` は、actual missing と alternate-source-resolved を区別して集計する。
- human-readable reportは、missing storyとalternate sourceで解決済みのstoryを分けて表示する。

## Non Goals

- GitHub APIで過去PRを推測して穴埋めすること。
- artifactが存在しないstoryをmerged扱いに合成すること。
- traceability gapの定義をなくすこと。
