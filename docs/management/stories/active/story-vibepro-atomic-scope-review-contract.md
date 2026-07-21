---
story_id: story-vibepro-atomic-scope-review-contract
title: "atomic単一PRを現HEADのreview ownershipと検証証跡でfail-closedに裁定する"
status: active
parent_design:
  - vibepro-atomic-scope-review-contract
view: dev
period: 2026-07
source:
  type: engineering_judgment_followup
  title: "大規模Storyが自ら追加したscope policyで自身の単一PRを承認できる循環を除く"
architecture_docs:
  - docs/architecture/vibepro-atomic-scope-review-contract.md
spec_docs:
  - docs/specs/story-vibepro-atomic-scope-review-contract.md
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "The requirements SSOT, runtime implementation, executable E2E gate, and design lineage are one fail-closed contract: separating them would make the policy unverifiable against the exact code and review surface it governs, so all generated lanes must be reviewed and validated on one cumulative current HEAD."
pr_scope_review_facets:
  - repo-control
  - requirements-ssot
  - runtime-behavior
  - e2e-gate
  - misc-follow-up
pr_scope_dependency_boundaries:
  - repo-control->requirements-ssot
  - requirements-ssot->runtime-behavior
  - runtime-behavior->e2e-gate
  - e2e-gate->misc-follow-up
created_at: 2026-07-19
updated_at: 2026-07-19
reason: "alternatives considered: always force a split, accept a prose-only atomic declaration, or require typed current-head evidence; selected typed current-head evidence. compatibility impact: automatic split advice remains visible and Stories without atomic_single_pr retain existing behavior. rollback plan: remove atomic declaration evaluation and owner-map/path-target checks while preserving generated split plans. boundary: VibePro may accept one cumulative PR only when every generated lane is declared, current-head independent reviews own the declared facets, unsafe repository signals are absent, and verification evidence is bound to the changed target."
---

# Story

VibeProは広い変更をlaneへ分解してレビュー可能性を示すが、相互依存する変更には単一HEADでしか成立しないものもある。一方、Storyの自由記述だけで自動分割勧告を上書きできると、そのPRが追加したpolicyで自身を承認する循環が生じる。

## User Story

**As a** 大きなStoryのrelease boundaryを裁定するsenior engineer
**I want** atomic単一PRの例外が現HEADの独立review ownershipと対象束縛済み検証を満たした場合だけ成立すること
**So that** 相互依存変更を一体で検証しつつ、自己申告だけのscope overrideを防げる

## Acceptance Criteria

- [x] `ASR-S-1`: Storyが`atomic_single_pr`を要求しても、`pr_scope_dependency_boundaries[]`が全generated laneを一つの依存グラフとして接続しない、生成laneを全列挙しない、または型付きunsafe scope signalがある場合は`rejected`となり、自動split勧告を維持する。
- [x] `ASR-S-2`: 宣言された全facetの全changed pathをstrict current HEADへ束縛された必要review roleのinspection surfaceへ対応付け、各roleがcloseするまでatomic scopeをacceptしない。
- [x] `ASR-S-3`: accept後も自動split案とlaneは消さず、全laneを`cumulative_atomic_head`として同一HEADの最終検証へ接続する。
- [x] `ASR-S-4`: 最終検証には生成されたunit、integration/build、typecheck、required E2Eを欠落なく含める。
- [x] `ASR-S-5`: structured verificationがsurface名を含むだけではchanged pathをcoverせず、evidence target群が同一surface rowの全changed pathを包含するときだけcoverする。
- [x] `ASR-S-6`: Story metadataを持たない既存Story、およびreviewableな小規模PRの挙動を変えない。
- [x] `ASR-S-7`: atomic scopeのaccept結果を同じprepareのGate DAGへ反映し、自動split推奨があるのに`gate:split_resolution`が未生成ならnode/edgeを補完した上で、`gate:pr_scope_judgment`と`gate:split_resolution`をpassへ再調停し、`summary.needs_evidence_count`と`overall_status`も再計算してscope理由だけでPR readinessをblockしない。
- [x] `ASR-S-8`: responsibility authorityのrequired evidenceを解決するとき、同じscenario語を持つ未修飾commandより対象contract IDへ束縛されたcurrent commandを優先し、atomic scope用evidenceを別contractのauthority証跡へ誤流用しない。
- [x] `ASR-S-9`: 複数commitであること自体はreview必須のscope signalとして保持するがatomic override不能とはせず、commit messageに現在のStory以外の明示的なStory/STR/BFD/BUG/INC lineageがある場合だけ型付きunsafe signalとしてfail-closedにする。
- [x] `ASR-S-10`: `separate_session`はCLIのrelation文字列や任意IDだけでは成立せず、同一role・agent・agent systemの最新lifecycleがclosedでrecordのreviewer session/thread IDと一致し、implementation session IDと異なる場合だけatomic owner evidenceとして採用する。新しいrunning lifecycleは古いclosed lifecycleを無効化し、timeout/manual shutdown後の回復は旧lifecycle close evidence、`replacement_for`付きreplacement start、同一replacement identityのclose、transcript/close evidence付きrecordの順で実行可能でなければならない。
- [x] `ASR-S-11`: 型付きatomic scope宣言をschema/validation failureの実境界としてfail-closedに扱い、review roleやevidence ownershipというgovernance語だけでは`auth_denied`を要求しない。
- [x] `ASR-S-12`: `gate_orchestration`と`review_lifecycle`の両surfaceが同時に変わる場合だけ`workflow_heavy`へ昇格し、どちらか一方だけの変更は従来の軽量profileを維持する。
- [x] `ASR-S-13`: failure-mode coverageはcurrent HEADへ束縛されたpassing executable command、structured observation、非空のtarget、scenarioまたはobserved values内の明示的mode assertionが揃う場合だけ成立し、keyword一致だけ・失敗command・target未束縛evidenceをcoverageとして扱わない。
- [x] `ASR-S-14`: 混在repo-controlが`.vibepro/config.json`だけならtracked canonical Story registrationとしてtyped atomic contractのreview対象にできるが、`.github/*`、`.claude/*`、package/lockfile等の独立repo-controlが併存する場合はunsafeを維持する。
- [x] `ASR-S-15`: 現在Storyの`-vN` lineageは2親以上の実mergeで、`origin/codex/<story-vN>`がmerge parentへ解決され、targetが同じ`codex/<story-vN>`の場合だけcurrent lineageとして受理する。受理したreference、full commit SHA、parent count、判定basisをscope artifactへ保存し、bounded summary、human review、PR body、split plan、gate DAG、各HTML reportから再構成可能にする。titleだけ、単一親、missing/mismatched refはforeign lineageとしてfail-closedにする。

## Non Goals

- すべての大規模PRをatomicとして許可すること。
- reviewerの技術判断をlane名の一致だけで代替すること。
- runtime featureと、そのfeatureを裁くscope policyを同じStoryで導入すること。
