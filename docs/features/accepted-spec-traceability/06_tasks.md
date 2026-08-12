<!-- vibepro-projection story_id=story-vibepro-accepted-spec-traceability feature_slug=accepted-spec-traceability ownership=generated profile=feature_packet source=.vibepro/stories/story-vibepro-accepted-spec-traceability/tasks/tasks.json source_sha256=57a1c50e565a276de500f0fadc8aa54686041aabac694ffe0f0d7e11d23d6137 renderer=tasks_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Tasks

## ASTR-T-001: HEAD-tree accepted-spec lineage resolverを実装する

- story_id: story-vibepro-accepted-spec-traceability
- status: done
- target_files: src/artifact-routing.js, src/traceability.js
- dependencies:
- acceptance_criteria:
  - ASTR-AC-001〜005、008〜011を満たす

## ASTR-T-002: 同一条項mapを3つのPR成果物へ投影する

- story_id: story-vibepro-accepted-spec-traceability
- status: done
- target_files: src/pr-manager.js
- dependencies: ASTR-T-001
- acceptance_criteria:
  - ASTR-AC-007を満たす

## ASTR-T-003: 12条項fixture・fail-closed負例・runner由来環境証拠を検証する

- story_id: story-vibepro-accepted-spec-traceability
- status: done
- target_files: test/accepted-spec-traceability.test.js, src/verification-runner.js, src/verification-evidence.js, test/verification-runner.test.js
- dependencies: ASTR-T-001, ASTR-T-002
- acceptance_criteria:
  - ASTR-AC-006、008〜012を満たす
