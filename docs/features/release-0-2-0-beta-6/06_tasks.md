<!-- vibepro-projection story_id=story-vibepro-release-0-2-0-beta-6 feature_slug=release-0-2-0-beta-6 ownership=generated profile=feature_packet source=.vibepro/stories/story-vibepro-release-0-2-0-beta-6/tasks/tasks.json source_sha256=d18a10ca0527fa56e276199755f12724e88078cf993a205734e27ad493444bbc renderer=tasks_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Tasks

## VP-TASK-REL6-001: beta.6 のバージョン情報を一致させる

- story_id: story-vibepro-release-0-2-0-beta-6
- status: completed
- target_files: package.json, package-lock.json
- dependencies: 
- acceptance_criteria:
  - package.json と package-lock.json のroot versionが0.2.0-beta.6で一致する。
  - CLIのversion出力が0.2.0-beta.6になる。
  - 依存関係とruntime実装は変更しない。

## VP-TASK-REL6-002: 最小リリース成果物を揃える

- story_id: story-vibepro-release-0-2-0-beta-6
- status: completed
- target_files: .vibepro/config.json, docs/management/stories/active/story-vibepro-release-0-2-0-beta-6.md, docs/architecture/story-vibepro-release-0-2-0-beta-6.md, docs/features/release-0-2-0-beta-6/02_functional_spec.md, docs/features/release-0-2-0-beta-6/06_tasks.md
- dependencies: VP-TASK-REL6-001
- acceptance_criteria:
  - Story、Architecture、Spec、Task、catalogが同じStory IDとrelease slugを参照する。
  - mainとの差分にsrc、bin、依存、公開workflowの挙動変更が含まれない。

## VP-TASK-REL6-003: release candidateと公開結果を同じcommitで検証する

- story_id: story-vibepro-release-0-2-0-beta-6
- status: completed
- target_files: package.json, package-lock.json, .github/workflows/post-merge-release.yml, scripts/post-merge-release.mjs
- dependencies: VP-TASK-REL6-001, VP-TASK-REL6-002
- acceptance_criteria:
  - Node 22でtypecheck、全テスト、npm pack dry-runが成功する。
  - merge後のnpm gitHead、betaとlatest dist-tag、GitHub prereleaseのtag commitがrelease merge commitへ収束する。
  - GitHub prereleaseはprerelease=trueかつlatest=falseとして公開される。
