<!-- vibepro-projection story_id=story-vibepro-routing-profiles-rendered-projections feature_slug=routing-profiles-rendered-projections ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-routing-profiles-rendered-projections/spec.json source_sha256=f4f4a41a809bfccc59afa995c2b57f7d1ab3e90802084f2e373b6d12c8550c9b renderer=functional_spec_markdown@1 direct_edit=false -->
# Functional Spec

- Story: story-vibepro-routing-profiles-rendered-projections
- Status: -
- Clauses: 12

## C-001

Accepted Spec JSON must render deterministically into Functional Spec Markdown, preserving clauses, origin references, and diagrams.

### Origin refs

- {"anchor":"writeArtifactProjections","file":"src/spec-store.js"}
- {"case":"accepted spec JSON deterministically renders lineage-bearing Functional Spec Markdown","file":"test/spec-pipeline.test.js"}
- {"file":"docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md","section":"方針","text_snippet":"direct-edit prohibition"}
- {"index":4,"kind":"acceptance_criteria","text_snippet":"Accepted Spec JSONを決定論的なFunctional Spec Markdownへrenderできる"}

## C-002

Functional Spec, Tasks, Evidence, Test Plan, Review, Gate, and Release Markdown views in both profiles must carry generated, curated, or human_owned ownership plus profile, feature_slug, source canonical path and SHA-256, renderer id/version, and a direct-edit prohibition marker where generated.

### Origin refs

- {"file":"docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md","section":"方針","text_snippet":"generated view"}
- {"index":6,"kind":"acceptance_criteria","text_snippet":"Evidence/Test PlanとGate/Release viewがgenerated、curated、human_ownedのownershipを明示する"}
- {"index":7,"kind":"acceptance_criteria","text_snippet":"generated projectionがsource path、source hash、renderer version、direct-edit prohibitionを含む"}

## C-003

The existing machine task authority at .vibepro/stories/{story_id}/tasks/tasks.json must remain unmoved and render deterministically by unique task id and fixed field order into lineage-bearing Tasks Markdown using tasks_markdown renderer version 1; Markdown must never become read authority.

### Origin refs

- {"anchor":"createStoryTasks","file":"src/story-task-generator.js"}
- {"anchor":"createTasksFromPlan","file":"src/task-manager.js"}
- {"case":"machine task JSON deterministically renders lineage-bearing Tasks Markdown","file":"test/artifact-routing.test.js"}
- {"file":"docs/architecture/story-vibepro-routing-profiles-rendered-projections.md","section":"Deterministic Projection and Lineage","text_snippet":".vibepro/stories/{story_id}/tasks/tasks.json"}
- {"index":5,"kind":"acceptance_criteria","text_snippet":"machine task modelを決定論的なTasks Markdownへrenderできる"}

## C-004

Each semantic artifact must have exactly one writable canonical path, and generated projections must not become read authority.

### Origin refs

- {"file":"docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md","section":"方針","text_snippet":"projection"}
- {"index":9,"kind":"acceptance_criteria","text_snippet":"semantic artifactごとにwritable canonicalは一つだけでprojectionはread authorityにならない"}

## C-005

artifact_routing schema 0.2.0 introduces named profiles, ownership, and renderers; the new CLI must preserve 0.1.0 repository-global routing, while an old CLI must reject 0.2.0 as unsupported_schema and must not ignore profiles or silently fall back to defaults.

### Origin refs

- {"anchor":"validateRoutingShape","file":"src/artifact-routing.js"}
- {"case":"legacy resolver rejects schema 0.2.0 without silent fallback","file":"test/artifact-routing.test.js"}
- {"case":"new resolver preserves schema 0.1.0 routing and defaults","file":"test/artifact-routing.test.js"}
- {"file":"docs/architecture/story-vibepro-routing-profiles-rendered-projections.md","section":"Compatibility, Regression, and Fresh Checkout","text_snippet":"unsupported_schema"}
- {"index":13,"kind":"acceptance_criteria","text_snippet":"後方互換を維持する"}

## INV-001

schema 0.2.0 repositories must define at least two stable named artifact-routing profiles; each selected profile must independently define story, architecture, accepted_spec, task_plan, graphify, evidence, test_plan, review, gate, and pr without inheritance or cross-profile composition, and any missing kind or collision fails closed.

### Origin refs

- {"anchor":"ARTIFACT_KINDS","file":"src/artifact-routing.js"}
- {"case":"schema 0.2.0 resolves complete feature and governance profiles without composition","file":"test/artifact-routing.test.js"}
- {"file":"docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md","section":"方針","text_snippet":"named routing profile"}
- {"index":0,"kind":"acceptance_criteria","text_snippet":"repositoryが二つ以上のnamed artifact-routing profileを定義できる"}

## INV-002

routing must fail closed before any write when the profile is undefined, required variables are missing, or metadata conflicts are detected.

### Origin refs

- {"anchor":"ArtifactRoutingError","file":"src/artifact-routing.js"}
- {"case":"named profile requires a complete matching Story mirror before writes","file":"test/artifact-routing.test.js"}
- {"index":3,"kind":"acceptance_criteria","text_snippet":"profile未定義、必須変数不足、相互矛盾するmetadataは書込前にfail closedする"}

## INV-003

VibePro must never overwrite a human_owned packet file, and curated views must remain outside automatic overwrite paths.

### Origin refs

- {"file":"docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md","section":"方針","text_snippet":"human_owned"}
- {"index":8,"kind":"acceptance_criteria","text_snippet":"VibeProがhuman-owned packet fileを上書きしない"}

## S-001

Given catalog-authoritative artifact_profile and feature_slug for a named-profile Story, matching Story-frontmatter mirrors are mandatory and every lifecycle consumer resolves the same profile and context; missing or conflicting mirrors fail before writes, while profile-less legacy/unconfigured Stories may omit mirrors and use only the 0.1.0 fallback contract.

### Origin refs

- {"file":"docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md","section":"方針","text_snippet":"artifact_profile"}
- {"index":1,"kind":"acceptance_criteria","text_snippet":"各Storyがartifact_profileと明示的feature_slugを永続的に選択できる"}
- {"index":2,"kind":"acceptance_criteria","text_snippet":"Story discovery、Architecture、Spec、Task、Graphify、Review、Gate、PR prepare/create/merge、status、migrationが同じprofileを解決する"}

## S-002

artifacts resolve JSON/text must report story_id, profile, metadata_source, variables, and per-kind canonical owner/writer/read authority plus projection ownership and renderer; artifacts migrate --dry-run must keep edits_performed at zero and classify each candidate as create, update, noop, or conflict with a non-silent reason after comparing lineage headers and legacy byte copies.

### Origin refs

- {"anchor":"buildArtifactMigrationPlan","file":"src/artifact-routing.js"}
- {"case":"migration reports create update noop conflict reasons and edits_performed zero","file":"test/artifact-routing.test.js"}
- {"case":"resolve JSON and text report required profile ownership renderer and authority fields","file":"test/artifact-routing.test.js"}
- {"index":10,"kind":"acceptance_criteria","text_snippet":"artifacts resolveがprofile、variables、canonical、projection、ownership、rendererを報告する"}
- {"index":11,"kind":"acceptance_criteria","text_snippet":"artifacts migrate --dry-runがprofile変更、move、collision、stale projection、human-owned overwrite riskを編集せず報告する"}

## S-003

Story discovery, status, Architecture, Spec, Task, Graphify, Evidence, Test Plan, Review, Gate, PR prepare/create/merge, and migration must each consume one shared resolver result and expose the same profile and feature_slug without local derivation; the workflow state transition is unresolved -> canonical_written -> projections_written -> published, and any resolver or projection failure must stop before the next state while preserving the previously published state; status, gate, and PR summaries must expose the routed surfaces.

### Origin refs

- {"case":"named profile is shared by every lifecycle consumer","file":"test/artifact-routing.test.js"}
- {"file":"docs/architecture/story-vibepro-routing-profiles-rendered-projections.md","section":"Lifecycle Consumer Matrix","text_snippet":"全consumerはprofile/feature_slugを独自推論せず"}
- {"index":2,"kind":"acceptance_criteria","text_snippet":"全producer/consumerへ同じrouting context"}

## S-004

A fresh checkout must resolve story-feature-checkout to feature_packet surfaces under docs/features/checkout-feature and story-governance-checkout to governance_packet surfaces under docs/governance/checkout-governance, including Functional Spec, Tasks, Evidence, Test Plan, Review, Gate, and Release summaries with lineage; resolve JSON/text, status/gate/PR summaries, migration edits_performed zero, and legacy fallback must all be asserted.

### Origin refs

- {"case":"feature and governance named profiles survive fresh checkout with catalog metadata and lineage","file":"test/artifact-routing.test.js"}
- {"case":"migration dry-run reports create update noop conflict without editing a fresh checkout","file":"test/artifact-routing.test.js"}
- {"index":12,"kind":"acceptance_criteria","text_snippet":"feature profileとgovernance profileをfresh checkout E2Eで検証する"}
- {"index":13,"kind":"acceptance_criteria","text_snippet":"profile未設定repositoryと既存artifact_routing.artifacts設定の後方互換を維持する"}

## Diagrams

### flow

flowchart LR
  Story[Story metadata] --> Resolver[Artifact resolver]
  Resolver --> Canonical[Writable canonical artifact]
  Resolver --> Projection[Generated projection]
  Projection --> View[Human-readable view]
  Canonical --> Migration[Dry-run migration]
  Projection -. lineage metadata .-> View

### threat_model

flowchart LR
  Catalog[Catalog authority] --> Resolver[Validated resolver]
  StoryMirror[Required named-profile Story mirror] --> Resolver
  Resolver --> Canonical[Canonical artifact]
  Resolver --> Projection[Generated projection]
  UntrustedPath[Traversal or symlink input] --> Reject[Fail closed]
  Reject -. blocks .-> Canonical
  Reject -. blocks .-> Projection
