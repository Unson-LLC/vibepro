<!-- vibepro-projection story_id=story-vibepro-github-prerelease-convergence feature_slug=github-prerelease-convergence ownership=generated profile=feature_packet source=.vibepro/stories/story-vibepro-github-prerelease-convergence/tasks/tasks.json source_sha256=f56af2e3e79e87ce564b3dd5c016639a04e1746de6a12f157a30ee75753e206a renderer=tasks_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Tasks

## VP-TASK-GRC-001: SemVer分類とLatest単調性を実装する

- story_id: story-vibepro-github-prerelease-convergence
- status: todo
- target_files: scripts/post-merge-release.mjs, test/github-release-convergence.test.js
- dependencies:
- acceptance_criteria:
  - プレリリースはprerelease=trueかつlatest=falseになる。
  - 安定版は現在のLatest以下でなければlatest=trueになる。
  - 古い安定版の再実行は新しいLatestを維持する。

## VP-TASK-GRC-002: GitHub Release create/editを同じ状態へ収束させる

- story_id: story-vibepro-github-prerelease-convergence
- status: todo
- target_files: scripts/post-merge-release.mjs, .github/workflows/post-merge-release.yml
- dependencies:
- acceptance_criteria:
  - create/edit双方へprerelease/latestを明示する。
  - 操作後のtag SHAとmetadata不一致は非0終了する。
  - 古い安定版では操作前のLatestが維持されたことを検証する。

## VP-TASK-GRC-003: Node 22の回帰検証とVibePro証跡を固定する

- story_id: story-vibepro-github-prerelease-convergence
- status: todo
- target_files: test/github-release-convergence.test.js, test/post-merge-release.test.js, test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js, docs/features/github-prerelease-convergence/07_evidence.md
- dependencies:
- acceptance_criteria:
  - focused behavioral testが通る。
  - typecheckと全テストがNode 22で通る。
  - runner-direct証跡がcurrent HEADへstrict bindingされる。
