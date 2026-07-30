---
story_id: story-vibepro-task-atomic-repo-control-contract
title: "Task依存グラフに束縛されたrepo-controlをatomic単一PRとしてfail-closedに裁定する"
status: active
parent_design:
  - vibepro-task-atomic-repo-control-contract
view: dev
period: 2026-07
source:
  type: downstream_contract_blocker
  title: "Taskが同一HEADを要求するworkflowとruntimeを現行split policyが強制分離する矛盾を解消する"
architecture_docs:
  - docs/architecture/story-vibepro-task-atomic-repo-control-contract.md
spec_docs:
  - docs/specs/story-vibepro-task-atomic-repo-control-contract.md
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "The Story registration, Task dependency contract, runtime policy, and executable regression proof define one fail-closed PR-preparation contract; splitting them would leave an intermediate CLI that either accepts unbound workflow changes or cannot verify the new exception."
pr_scope_review_facets:
  - repo-control
  - requirements-ssot
  - runtime-behavior
  - e2e-gate
pr_scope_dependency_boundaries:
  - repo-control->requirements-ssot
  - requirements-ssot->runtime-behavior
  - runtime-behavior->e2e-gate
created_at: 2026-07-30
updated_at: 2026-07-30
reason: "alternatives considered: keep every workflow change permanently unsafe, allow every Task-scoped workflow change, or accept only repo-control paths covered by a typed Task group connected to non-repo-control groups; selected the third. compatibility impact: Story-scoped PRs, Tasks without typed dependency groups, uncovered paths, and independently releasable repo-control remain unsafe. rollback plan: remove the task-bound exception and restore the existing unconditional independent repo-control signal. boundary: this changes PR split adjudication only; it grants no cloud mutation, Gate waiver, merge authority, or review bypass."
---

# Story

VibeProは`.github/*`などのrepo-controlを、atomic Story declarationでは上書きできない
unsafe surfaceとして扱う。この既定は安全だが、選択Taskがworkflow、runtime policy、
validator、negative testを同じcurrent HEADで成立させると明示し、typed target groupの
依存グラフでそれらを接続している場合も強制分割する。その結果、どちらの分割PRも
単独では契約を満たさない中間状態を作る。

## User Story

**As a** Task-scoped PRのrelease boundaryを裁定するmaintainer
**I want** repo-controlのatomic例外を選択Taskの正確なpath coverageとtyped dependency graphへ束縛する
**So that** 相互依存workflowを同じHEADで検証でき、無関係または未宣言のrepo-controlは従来どおり分割できる

## Acceptance Criteria

- [ ] `TAR-S-1`: `pr prepare --task`で、changed repo-control pathがすべて選択Taskの`classification: repo_control` target groupにexactに含まれ、そのgroupがtyped `depends_on` graphで少なくとも一つのnon-repo-control groupへ接続される場合だけ、`mixed_repo_control_surface`をatomic review可能として分類する。
- [ ] `TAR-S-2`: Task未指定、`target_groups`欠落・malformed、repo-control group欠落、未接続group、changed pathの部分coverage、余分なrepo-control pathでは従来の`unsafe_for_atomic_override: true`を維持する。
- [ ] `TAR-S-3`: task-bound分類後もStoryの`atomic_single_pr`宣言、全generated laneのreview facet/dependency coverage、current-HEAD reviewer owner map、verification evidenceを省略せず、いずれか不足時はatomic scopeをrejectする。
- [ ] `TAR-S-4`: 判定根拠としてTask ID、task state path、covered repo-control paths、repo-control group IDs、dependency edgesをmachine-readableなscope signalとsplit planへ残す。
- [ ] `TAR-S-5`: `--task`なしの既存Story、`.vibepro/config.json`だけの既存例外、通常のunsafe repo-control split、strict target validationの挙動を変えない。
- [ ] `TAR-S-6`: unit/CLI integration/E2Eでpositive、missing Task、malformed groups、uncovered extra workflow、disconnected group、Story atomic metadata不足を再現し、fail-closedを確認する。

## Non Goals

- 任意のworkflow変更をatomicとして許可すること。
- Task targetをglob推測やAcceptance Criteriaの自然言語だけで補完すること。
- current-HEAD review、verification、GateをTask metadataで代替すること。
- downstream repositoryのAWS apply、state migration、live negative testを実行すること。
