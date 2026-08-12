<!-- vibepro-projection story_id=story-vibepro-release-exact-sha-fast-path feature_slug=release-exact-sha-fast-path ownership=generated profile=feature_packet source=.vibepro/stories/story-vibepro-release-exact-sha-fast-path/tasks/tasks.json source_sha256=4cd98138e0dd877a9607f2e9da9ab23dc7a14133185dac4477dd92987f02c738 renderer=tasks_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Tasks

## RELFAST-T-001: reviewed headのCI証拠とmerge treeを検証する

- story_id: story-vibepro-release-exact-sha-fast-path
- status: done
- target_files: scripts/post-merge-release.mjs, .github/workflows/ci.yml, .github/workflows/codeql.yml
- dependencies:
- acceptance_criteria:
  - RELFAST-AC-001、RELFAST-AC-002、RELFAST-AC-004を満たす

## RELFAST-T-002: fast pathとfull fallbackを公開workflowへ接続する

- story_id: story-vibepro-release-exact-sha-fast-path
- status: done
- target_files: .github/workflows/post-merge-release.yml, scripts/post-merge-release.mjs
- dependencies: RELFAST-T-001
- acceptance_criteria:
  - RELFAST-AC-003、RELFAST-AC-005、RELFAST-AC-007、RELFAST-AC-008を満たす

## RELFAST-T-003: exact-SHA再利用とfail-closed境界を回帰テストで固定する

- story_id: story-vibepro-release-exact-sha-fast-path
- status: done
- target_files: test/post-merge-release.test.js, test/e2e/story-vibepro-release-exact-sha-fast-path.test.js
- dependencies: RELFAST-T-001, RELFAST-T-002
- acceptance_criteria:
  - RELFAST-AC-004、RELFAST-AC-006、RELFAST-AC-008を満たす
