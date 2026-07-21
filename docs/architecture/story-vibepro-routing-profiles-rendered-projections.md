---
parent_design: vibepro-artifact-output-routing
---

# Story-vibepro-routing-profiles-rendered-projections Architecture

## Summary

`.vibepro/config.json` の `brainbase.stories[]` をStory別routing metadataのauthorityとし、Story frontmatterを人間向けmirrorとして検証する。全lifecycle consumerは同じresolverからprofile、variables、canonical、projection contractを取得する。machine canonicalだけがwrite/read authorityを持ち、Markdown projectionはlineage header付きの決定論的read viewとする。

## Metadata Authority and Conflict Rule

- authority: `.vibepro/config.json` `brainbase.stories[]` の `artifact_profile` と `feature_slug`
- mirror: named profileを選ぶStoryではStory frontmatterの同名fieldを必須とする。profile metadataを持たないlegacy/unconfigured Storyではmirrorは任意であり、catalog-only legacy entryをnamed profileとして扱わない。
- resolverはcatalog entryをstory idで一意に選び、named profileなら必須mirrorの存在と完全一致を要求する。
- catalog重複、profile未定義、必須field欠落、CLI `--feature-slug`との不一致、frontmatter mirrorとの不一致は`metadata_conflict`または専用errorで、全filesystem writeのpreflight前にfail closedする。
- legacy repositoryでcatalog metadataとnamed profilesがともに無い場合だけ、従来の`artifact_routing.artifacts`とstory id由来slugへfallbackする。片方だけ存在する不完全なnamed-profile設定はfallbackしない。

## Profile Resolution

1. story idからcatalog authorityを読む。
2. catalogの`artifact_profile`を`artifact_routing.profiles`から選ぶ。
3. catalogの`feature_slug`をvariablesへ設定し、frontmatter/CLI mirrorを照合する。
4. 選択profileのartifact contractを解決し、全kindのcollisionとownershipを検証する。
5. named metadataが無いlegacy repositoryのみ`artifact_routing.artifacts`をdefault compatibility profileとして解決する。

schema `0.2.0`の各profileは全artifact kindを自己完結して定義し、profile inheritance/compositionを許可しない。profile内のkind欠落、profile間合成、canonical/projection collisionはfilesystem preflight前にfail closedする。最低二つのnamed profileを許可する。

- `feature_packet`: feature固有のcanonicalと人間向けgenerated viewsを同一packetへ集約する。
- `governance_packet`: review、gate、releaseのmachine canonicalを`.vibepro`に保ち、必要な人間向けviewだけをfeature packetへ投影する。

## Artifact Ownership Matrix

| kind | canonical authority | canonical writer | read authority | projection renderer / ownership | overwrite rule |
|---|---|---|---|---|---|
| story | catalog entry + tracked Story source | story discovery/registration | catalog metadata、本文はStory source | Story mirror / `curated` | 自動上書きしない |
| architecture | profileのcanonical Markdown | architecture write | canonical | `architecture_markdown@1` / `generated`または`curated` | `generated`のみ再生成可 |
| accepted_spec | profileのAccepted Spec JSON | spec write | canonical JSON | `functional_spec_markdown@1` / `generated` | lineage一致時だけ再生成可 |
| task_plan | `.vibepro/stories/{story_id}/tasks/tasks.json` | task create/update | canonical JSON | `tasks_markdown@1` / `generated` | lineage一致時だけ再生成可 |
| graphify | profileのgraph JSON/directory | graphify | canonical | rendererなし / `generated` | projectionなし |
| evidence | profileのevidence directory | verify record | canonical evidence | `evidence_summary_markdown@1` / `generated` | lineage一致時だけ再生成可 |
| test_plan | profileのtest-plan JSON | checkpoint/test planning | canonical JSON | `test_plan_markdown@1` / `generated` | lineage一致時だけ再生成可 |
| review | profileのreview JSON/directory | review lifecycle | canonical | `review_summary_markdown@1` / `generated`または`curated` | `generated`のみ再生成可 |
| gate | profileのgate JSON | pr prepare/gate | canonical | `gate_summary_markdown@1` / `generated` | lineage一致時だけ再生成可 |
| pr | profileのPR prepare JSON | pr prepare（create後は同じprepare canonicalを再投影） | canonical | `release_summary_markdown@1` / `generated` | lineage一致時だけ再生成可。merge payloadは使用しない |
| evidence/test plan packet file | repositoryの指定path | human | human-owned file | rendererなし / `human_owned` | VibeProは作成・更新・削除しない |

`curated`と`human_owned`は自動上書き対象外である。canonicalとprojectionが同一pathになる設定、または同一semantic artifactに複数canonical writer/read authorityを作る設定はrejectする。

## Deterministic Projection and Lineage

Accepted Spec JSONはclauses、origin references、diagramsを安定順序でFunctional Spec Markdownへrenderする。task machine authority `.vibepro/stories/{story_id}/tasks/tasks.json` はtask `id`のUnicode code-point昇順、同一idをrejectし、各task fieldを`id`, `story_id`, `title`, `status`, `target_files`, `dependencies`, `acceptance_criteria`の固定順、配列はcanonical JSON順でTasks Markdownへrenderする。同じcanonical bytes、profile、feature_slug、renderer id/versionから常に同じprojection bytesを得る。

generated Markdownの先頭には機械可読なlineage headerを必須とする。

```yaml
vibepro_projection:
  ownership: generated
  profile: feature_packet
  feature_slug: example
  source_canonical_path: .vibepro/spec/story-example/spec.json
  source_sha256: <64-hex>
  renderer_id: functional_spec_markdown
  renderer_version: "1"
  direct_edit: prohibited
```

source hashはcanonical bytesのSHA-256である。projectionはread authorityにならず、読み込み処理は常にcanonicalを参照する。

## Resolve Output Contract

`artifacts resolve --json`はtop-levelに`schema_version`, `config_path`, `configured`, `story_id`, `profile`, `metadata_source`, `variables`, `routes`を返す。各routeは`kind`, `canonical`, `canonical_owner`, `canonical_writer`, `read_authority`, `projections[]`, `configured`を持ち、各projectionは`path`, `ownership`, `renderer_id`, `renderer_version`, `lineage_required`, `overwrite_policy`を持つ。text出力もprofile、story_id、feature_slug、各kindのcanonical、ownership、rendererを省略しない。

## Lifecycle Consumer Matrix

| consumer | resolver input | required assertion |
|---|---|---|
| Story discovery/status | story id | catalog authorityとfrontmatter mirror一致 |
| Architecture read/write/readiness | story id | 同一profileのarchitecture canonical |
| Spec read/write/drift | story id | Accepted Spec canonicalとFunctional Spec projection |
| Task create/list/show/execute | story id | task JSON authorityとTasks Markdown projection |
| Graphify | story id | 同一profileのgraphify route |
| Evidence/Test Plan | story id | 同一profileのevidence/test_plan routeとsummary projection |
| Review prepare/start/record/status | story id | 同一profileのreview route |
| Gate/verification/PR prepare | story id | 同一profileのgate/pr routeとownership view |
| PR create/merge | story id | createはprepare canonicalからrelease viewを再生成する。merge結果は既存の`pr-merge.json`へ分離し、PR canonicalまたはrelease viewとして投影しない |
| artifacts resolve/migrate | story id | 同一metadata authorityと全route contract |

全consumerはprofile/feature_slugを独自推論せず、共通resolver resultを受け取る。

## Migration Dry-run

`artifacts migrate --dry-run`だけを許可し、`edits_performed: 0`を保証する。各canonical/projection候補をlegacy path、現在のnamed profile、既存lineage headerと比較し、`action: create | update | noop | conflict`と機械可読な`reason`を返す。

- `create`: destinationが無い。
- `update`: generated headerが同じsemantic sourceを指すがsource hash/profile/feature_slug/renderer versionがstale、またはlegacy byte-copyを安全にgenerated projectionへ置換できる。
- `noop`: headerとsource hashを含むlineageが期待値と一致する。
- `conflict`: destinationがhuman_owned/curated、lineageのsourceが異なる、canonical collision、またはlegacy byte-copyを安全に帰属判定できない。

reportは`status`, `dry_run`, `edits_performed`, `story_id`, `profile`, `feature_slug`, `items[]`, `unresolved[]`を持ち、profile change、source/destination、ownership、renderer、action、reasonを表示する。suppressionやoverwrite riskをsilentにしない。

## Compatibility, Regression, and Fresh Checkout

- `artifact_routing.schema_version: 0.2.0`をnamed profile、ownership、renderer contractの新schemaとする。新CLIは`0.1.0`をrepository-global legacy contractとして読み、pathとCLI outputの互換を保つ。
- 旧CLIは既存のschema validationにより`0.2.0`を`unsupported_schema`でfail closedする。version mismatch時に`artifacts`だけを読む、profilesを無視する、default pathへsilent fallbackする挙動は禁止する。
- named profile未設定repositoryは既存`artifact_routing.artifacts`、default paths、story id由来slugを維持する。
- existing producer/consumer APIは共通resolverへのstory id入力を維持し、output path以外のCLI contractを破壊しない。
- feature fixture `story-feature-checkout` / `feature_slug: checkout-feature`とgovernance fixture `story-governance-checkout` / `artifact_profile: governance_packet` / `feature_slug: checkout-governance`をStory frontmatter mirror込みでcommitする。fresh clone後、feature側`docs/features/checkout-feature/{02_functional_spec,04_technical_delta,05_test_plan,06_tasks,07_evidence,08_review,09_gate,10_release}.md`とgovernance側`docs/governance/checkout-governance/{architecture,functional-spec,tasks,test-plan,evidence,review,gate,release}.md`、両者のmachine canonical、lineage、resolve text/JSON、status/gate/PR summary、dry-run非変更を検証する。
- 全lifecycle consumer testはnamed profile導入前の実装では期待path/profile/ownership/renderer assertionに失敗するfixtureを使う。
- legacy fallback testは既存unconfigured/configured repositoryのpathを固定し、regressionを検知する。

## Rollback

named profilesとcatalog metadataを削除し、schema versionを従来値へ戻すことでlegacy resolverへ戻せる。machine canonicalは移動・削除せず、generated projectionsだけを再生成可能な派生物として扱う。rollbackは次の順序で行う。

1. 変更前に`artifacts resolve --json`と`artifacts migrate --dry-run --json`を保存し、canonical、writer、read authority、collisionを記録する。
2. machine canonicalを保持したまま、対象Storyの`artifact_profile` / `feature_slug` mirror、catalog metadata、named profiles、schema versionの順でlegacy contractへ戻す。
3. `artifacts resolve --json`を再実行し、`profile: null`、legacy owner/writer/read authority、従来pathへの復帰を確認する。
4. `artifacts migrate --dry-run --json`で`edits_performed: 0`と未解決collisionがないことを確認し、focused routing testと`story status`でrollback後の表示契約を検証する。

## Resolved Decisions

- metadata authorityはcatalog、named profile Storyのfrontmatterは必須mirror、legacy Storyでは任意。
- renderer metadataはMarkdown headerへ埋め込み、migrationが直接監査する。
- ownershipはfirst-class enum `generated | curated | human_owned`。
- review/gate/releaseはkind別renderer id/versionを持つ。
