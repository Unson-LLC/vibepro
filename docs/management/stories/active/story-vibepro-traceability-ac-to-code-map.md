---
story_id: story-vibepro-traceability-ac-to-code-map
title: Traceabilityをartifact一覧からAC-to-code対応表へ引き上げる
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-22-AC-TO-CODE-TRACEABILITY
  title: "traceability.jsonがPR artifact一覧に留まり、Storyから実装判断を追えない"
related_stories:
  - story-vibepro-usage-report-traceability-gaps
  - story-vibepro-traceability-evidence-promotion
  - story-vibepro-engineering-judgment-evidence-strength
architecture_docs:
  - docs/architecture/vibepro-traceability-ac-to-code-map.md
spec_docs:
  - docs/specs/vibepro-traceability-ac-to-code-map.md
created_at: 2026-06-22
updated_at: 2026-06-22
---

# Story

現在の `traceability.json` は、merged Storyに対してPR body、Gate DAG、
verification evidence、merge artifactの存在を列挙できる。しかし2026-06-22の価値監査では、
最新Storyのtraceabilityが実質的にartifact一覧であり、
Acceptance CriteriaやScenario clauseがどの変更ファイル、どのテスト、どのreview evidenceで
満たされたのかを再構成できなかった。

senior engineerが欲しいtraceabilityは「artifactがある」ではない。
「このACはこのコード変更とこの検証で満たされた。ここは未検証またはfollow-upである」と
判断できる対応表である。

VibeProはtraceabilityを、Story-to-PRの存在確認から、AC-to-code-to-evidenceの判断材料へ
引き上げる必要がある。

## Acceptance Criteria

- [ ] `traceability.json` は `acceptance_criteria[]` を持ち、
      各ACに stable id、source line/source text、status、mapped files、mapped tests、
      mapped evidence、mapped review findings を記録する。
- [ ] `scenario_clauses[]` が存在する場合、各scenario clauseも同じ対応表に含める。
- [ ] ACやscenario clauseに対応する changed file / test / verification evidence が無い場合、
      `status=unmapped` または `status=weakly_mapped` として表示する。
- [ ] `mapped evidence` は単なるcommand文字列ではなく、current-boundか、artifact quality、
      evidence strength、対象ファイル一致を含む。
- [ ] PR body / Gate DAG / usage report は、unmapped ACの件数と代表例を表示する。
- [ ] generic test passやbroad suiteだけで全ACを満たした扱いにしない。
- [ ] 回帰テストは、artifact一覧だけ存在するStory、AC-to-test対応があるStory、
      ACはあるがコード/検証が無いStory、scenario clauseだけが未対応のStoryを含む。

## Non Goals

- LLM自由文でAC充足を断定すること。
- GitHub PR本文だけから完全なtraceabilityを復元すること。
- すべてのdocs-only Storyに重いAC mappingを必須化すること。
