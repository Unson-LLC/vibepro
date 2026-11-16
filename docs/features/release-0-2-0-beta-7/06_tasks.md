<!-- vibepro-projection story_id=story-vibepro-release-0-2-0-beta-7 feature_slug=release-0-2-0-beta-7 ownership=generated profile=feature_packet source=.vibepro/stories/story-vibepro-release-0-2-0-beta-7/tasks/tasks.json source_sha256=582e05a55b5ce60b4bddc8f58d7f829f30390a43a8145ca1f571df985df73da0 renderer=tasks_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Tasks

## VP-TASK-REL7-001: beta.7 のバージョン情報を一致させる

- story_id: story-vibepro-release-0-2-0-beta-7
- status: completed
- target_files: package.json, package-lock.json
- dependencies:
- acceptance_criteria:
  - package.json と package-lock.json のroot versionが0.2.0-beta.7で一致する。
  - CLIのversion出力が0.2.0-beta.7になる。
  - 依存関係とruntime実装は変更しない。

## VP-TASK-REL7-002: 最小リリース成果物を揃える

- story_id: story-vibepro-release-0-2-0-beta-7
- status: completed
- target_files: .vibepro/config.json, .vibepro/spec/story-vibepro-release-0-2-0-beta-7/spec.json, docs/management/stories/active/story-vibepro-release-0-2-0-beta-7.md, docs/architecture/story-vibepro-release-0-2-0-beta-7.md, docs/features/release-0-2-0-beta-7/02_functional_spec.md, docs/features/release-0-2-0-beta-7/06_tasks.md
- dependencies: VP-TASK-REL7-001
- acceptance_criteria:
  - Story、Architecture、Spec、Task、catalogが同じStory IDとrelease slugを参照する。
  - mainとの差分にsrc、bin、依存、公開workflowの挙動変更が含まれない。

## VP-TASK-REL7-003: release candidateと公開結果を同じcommitで検証する

- story_id: story-vibepro-release-0-2-0-beta-7
- status: completed
- target_files: package.json, package-lock.json, .github/workflows/post-merge-release.yml, scripts/post-merge-release.mjs
- dependencies: VP-TASK-REL7-001, VP-TASK-REL7-002
- acceptance_criteria:
  - Node 22でtypecheck、全テスト、npm pack dry-runが成功する。
  - マージ後のnpm gitHead、betaとlatest dist-tag、GitHub prereleaseのtag commitがrelease merge commitへ収束する。
  - GitHub prereleaseはprerelease=trueかつlatest=falseとして公開される。
