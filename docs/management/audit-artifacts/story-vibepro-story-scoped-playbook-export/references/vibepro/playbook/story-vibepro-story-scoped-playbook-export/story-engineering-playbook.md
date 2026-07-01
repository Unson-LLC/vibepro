# Story Engineering Playbook

| 項目 | 内容 |
|------|------|
| Story | story-vibepro-story-scoped-playbook-export |
| Title | Story単位のStory Engineering Playbook形式ドキュメント出力 |
| Catalog | story-engineering-playbook-v1 |
| Generated at | 2026-07-01T16:33:03.528Z |

## 1. Intent

- Story doc: present
- Spec: present
- Architecture: present
- PR prepare / Gate DAG: present / present
- Engineering route: agent_workflow
- Active axes: public_contract, scope_reviewability

### 受け入れ基準

- vibepro playbook export はStory単位でStory Engineering PlaybookのMarkdown/JSON artifactを出力する。
- テンプレ選択は固定ルールではなく、Engineering Judgment / Gate DAGを優先し、存在しない場合だけStory/Spec/Architectureのfallback signalを明示する。
- 出力には選択したテンプレと省略したテンプレの根拠が含まれる。
- 出力は日本語設定のworkspaceでは日本語を既定にする。
- OSS利用者に伝わらない個人名をPlaybook名や出力契約に含めない。

## 2. Scope

- Changed files: design-ssot.json, docs/architecture/vibepro-story-scoped-playbook-export.md, docs/management/stories/active/story-vibepro-story-scoped-playbook-export.md, src/cli.js, src/playbook-exporter.js, src/workspace.js, test/cli-smoke.test.js, test/playbook-exporter.test.js
- Included: CLI command: playbook export / 出力先: .vibepro/playbook/<story-id>/ / 入力: Story doc、Spec、Architecture doc、PR prepare / Gate DAG
- Excluded: 全体設計図の自動更新 / Story実行後のArchitecture正本への自動反映 / Playbookテンプレcatalogを外部サービスから同期する機能

## 3. Architecture Delta

- Architecture docs: docs/architecture/vibepro-story-scoped-playbook-export.md
- Summary: Story実装前の認知負荷を下げるため、VibeProが既に持つStory、Spec、Architecture、Engineering Judgment / Gate DAGを読み、Story単位の開発ブリーフとしてStory Engineering Playbookを生成する。

## 4. Template Decisions

| Template | Decision | Source | Reason |
|----------|----------|--------|--------|
| story.intent | selected | core_story_contract | Story単位の実装判断で常に必要な価値・背景・受け入れ条件。 |
| story.scope | selected | core_story_contract | Storyから外れる変更をPRに混ぜないための範囲境界。 |
| architecture.delta | selected | core_story_contract | Story実装が既存境界・責務・依存方向に与える差分。 |
| quality.gates | selected | core_story_contract | 実装完了ではなく、PR作成・レビュー・マージに必要な証跡を明示するため。 |
| open.questions | selected | core_story_contract | 曖昧さを暗黙の実装判断に落とさず、未確認として残すため。 |
| contract.surface | selected | engineering_judgment_axis | 外部またはエージェントが依存する入出力契約に触れるため。 |
| data.state | omitted | engineering_judgment_absence | Engineering Judgmentのactive axis、Gate DAG node、route type、fallback surface signalのいずれからも選択根拠が出ていない。 |
| security.trust | omitted | engineering_judgment_absence | Engineering Judgmentのactive axis、Gate DAG node、route type、fallback surface signalのいずれからも選択根拠が出ていない。 |
| ux.workflow | omitted | engineering_judgment_absence | Engineering Judgmentのactive axis、Gate DAG node、route type、fallback surface signalのいずれからも選択根拠が出ていない。 |
| release.ops | omitted | engineering_judgment_absence | Engineering Judgmentのactive axis、Gate DAG node、route type、fallback surface signalのいずれからも選択根拠が出ていない。 |
| external.integration | omitted | engineering_judgment_absence | 本文上のsurface signalはあるが、生成済みEngineering Judgment / Gate DAGでこのテンプレは選択されていない。 |

## 5. Quality Gates

- story: present (required)
- gate:story_source_integrity: passed (required)
- gate:engineering_judgment_route: passed (required)
- gate:common_judgment_spine: needs_evidence (required)
- gate:judgment_axis_public_contract: passed (required)
- gate:judgment_axis_scope_reviewability: passed (required)
- gate:pr_scope_judgment: passed (required)
- gate:bug_physics_triage: passed (required)
- gate:judgment_agent_workflow_context_acquisition: passed (required)
- gate:judgment_agent_workflow_tool_boundary: passed (required)
- gate:judgment_agent_workflow_delegation_policy: passed (required)
- gate:judgment_agent_workflow_evidence_lifecycle: passed (required)
- gate:judgment_agent_workflow_human_decision_contract: passed (required)
- gate:pr_route_classification: passed (required)
- gate:pr_body_contract: passed (required)
- gate:managed_worktree: needs_review
- gate:change_classification: passed (required)
- gate:pr_freshness: passed (required)
- architecture: satisfied (required)
- spec: inferred (required)

## 6. Open Questions

- なし
