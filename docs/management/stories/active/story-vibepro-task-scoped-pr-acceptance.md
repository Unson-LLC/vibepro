---
story_id: story-vibepro-task-scoped-pr-acceptance
title: Task指定PRはStory文脈を保ちながらTask受入範囲だけを判定する
architecture_docs:
  - docs/architecture/story-vibepro-task-scoped-pr-acceptance.md
spec_docs:
  - docs/specs/story-vibepro-task-scoped-pr-acceptance.md
parent_design: vibepro-task-scoped-pr-acceptance
---

# Story: Task指定PRはStory文脈を保ちながらTask受入範囲だけを判定する

## Background

`vibepro pr prepare/create --task <task-id>` はTask情報をPRへ表示する一方、
受入基準、E2E coverage、traceability、evidence adjudication、Gate DAG、
senior-gap judgmentではStory全体のAcceptance Criteriaを使い続けている。
そのため、複数Taskへ分割されたStoryで、後続Taskや人間承認後にだけ実施する
将来の受入基準が、現在Taskの安全なPR作成を不当にブロックする。

さらにPR managerはtask planの保存先を
`.vibepro/stories/<story-id>/tasks/tasks.json`へ固定しており、
artifact routingでfeature packet内をcanonicalにしたrepositoryでは
正しいTaskを読み込めない。

## Invariants

- Story source、Architecture、Spec、リスク分類、requirement consistencyは
  Story全体の設計文脈を維持する。
- `--task`を指定した場合だけ、PR完了判定の受入範囲を選択Taskへ狭める。
- `--task`を指定しない既存フローはStory単位のまま変えない。
- task planはartifact routingのcanonicalを優先し、既存の標準保存先との
  後方互換性を維持する。
- Taskが見つからない、またはtask planを読めない場合はfail closedとする。

## Acceptance Criteria

- TSPA-AC-001: `pr prepare/create --task`はartifact routingで解決した
  canonical task planを読み、feature packet経路でも互換コピーなしで動作する。
- TSPA-AC-002: task指定PR artifactは、`source: task`、Story ID、Task ID、
  選択された受入基準を含むmachine-readableなacceptance scopeを公開する。
- TSPA-AC-003: task指定時は選択Taskの受入基準がE2E coverage、
  Gate DAGのacceptance node/count、traceability、evidence adjudication、
  senior-gap judgmentのacceptance countを駆動し、後続Taskの受入基準は
  現在Taskのblocking outcomeにならない。
- TSPA-AC-004: Story source、Architecture、Spec、リスク分類、
  requirement consistencyはtask指定時もStory全体を参照する。
- TSPA-AC-005: `--task`なしのPR prepare/createは従来どおり
  Story Acceptance Criteriaを使い、出力意味を変更しない。
- TSPA-AC-006: routed task plan欠落、Task ID不一致、空のTask受入基準は
  推測やStory fallbackをせず、解決対象を示してfail closedする。
- TSPA-AC-007: 複数Task Storyの現在Task完了・後続Task未完了ケースと、
  feature packet routingケースを回帰テストで再現する。

## Out of Scope

- StoryのArchitecture/Spec/リスク境界をTask単位へ分割すること。
- Task未指定フローのGateモデル変更。
- 未完了Taskを自動で完了扱いにすること。
- gate waiverやevidence adjudicationの安全基準を緩めること。
