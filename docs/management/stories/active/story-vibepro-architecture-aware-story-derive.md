---
story_id: story-vibepro-architecture-aware-story-derive
title: "非WebリポジトリへWeb/SaaSストーリーを誤生成しない"
source:
  type: github_issue
  id: "#46"
  title: "story_cluster source matches unrelated web/SaaS preset templates to non-web projects"
architecture_docs:
  - ../../architecture/vibepro-architecture-aware-story-derive.md
spec_docs:
  - ../../specs/vibepro-architecture-aware-story-derive.md
status: active
view: dev
horizon: month
period: 2026-05
created_at: 2026-05-21
updated_at: 2026-05-21
---

# Story: 非WebリポジトリへWeb/SaaSストーリーを誤生成しない

## User Story

**As a** VibeProで未知のリポジトリからStoryとArchitectureの道筋を作るユーザー
**I want to** VibeProが最初にリポジトリの種類とアーキテクチャ前提を判定してからStory presetを適用する
**So that** Python CLI、ライブラリ、データパイプラインなど非Webプロジェクトに、認証・CMS・通知など存在しないWeb/SaaS Storyが混ざらない

## Background

Issue #46では、Pythonのみのアルゴリズム取引CLIリポジトリに対して `story derive` を実行したところ、`story-product-auth-account-access`、`story-product-content-cms`、`story-product-notification` が `story_cluster` sourceとして生成された。

対象リポジトリにはHTTP server、Web frontend、user model、CMS article entity、notification dispatcherが存在しない。にもかかわらず `story_cluster (N paths)` と表示されたため、VibeProが実コード根拠を見つけたように見え、利用者の検証コストと信頼低下につながった。

これは単なるfixture不足ではなく、`story derive` が `--preset` 未指定時にWeb/Next.js/SaaS前提を先に置いてしまうアーキテクチャ判定不足である。VibeProの目的である「StoryからArchitectureを出し、それを確定できればAIに安心して開発を任せる」を成立させるには、最初のStory生成が対象外ドメインを混入させない必要がある。

## Acceptance Criteria

- [ ] `--preset` 未指定の `story derive` は、まずrepo profileを判定し、Web/Next.js/SaaSの証拠がない場合は `next-app` product surface storiesを適用しない
- [ ] Python CLI / algorithmic trading / library / data-pipeline repoでは、auth、CMS、notificationなどWeb/SaaS専用Storyを `story_cluster` として生成しない
- [ ] 判断不能なpreset候補は確定Storyではなく `story_candidate` または `needs_domain_confirmation` として扱い、`story-map.md` に警告を出す
- [ ] `--preset next-app` またはrepo configで明示された場合だけ、Next.js product surface signalsを適用できる
- [ ] `story_cluster (N paths)` のpathsは、対象Storyのドメイン証拠として説明可能なcode/doc pathだけを含む
- [ ] Issue #46相当の非Web fixtureで、Web/SaaS Storyが生成されない回帰テストがある
- [ ] 既存のNext.js repo fixtureでは、明示presetまたはauto判定により既存のWeb Story生成が維持される
- [ ] 既存のsource recovery補助は維持しつつ、design-first StoryではStory/Architecture/Specの明示リンクが揃うまでSpec/Architecture不足を解消済み扱いしない

## Implementation Notes

- 対象候補: `src/presets.js`, `src/story-catalog-generator.js`, `src/story-manager.js`, `src/cli.js`
- 現状の危険点: `DEFAULT_PRESET_ID = 'next-app'` により、preset未指定時に非Web repoでもNext.js product surface signalsが有効になる
- 方針候補:
  - `auto` profileをdefaultにする
  - `detectRepoProfile(files, package metadata, graph paths)` を導入する
  - preset familyに `applicability` / `requiredEvidence` を持たせる
  - applicabilityが低い場合はStoryを出さず、warningと候補に落とす
  - `--preset` 明示時は従来互換のためそのpresetを尊重する

## タスク

1. Architecture判断を正本化する
   - `story derive` の前段で必要なrepo profile / preset applicability / Story promotion境界をArchitectureとして明文化する
   - Web/Next.js/SaaS、API service、CLI、library、data-pipelineで何をStory候補にしてよいかの境界を決める
   - `docs/architecture/` にADRまたはArchitecture noteを追加し、実装時の判断基準にする

2. Spec契約を正本化する
   - repo profile判定、preset applicability、domain mismatch warning、明示preset互換性をSpecとして機械検証可能な契約にする
   - 非Web repoでWeb/SaaS Storyが出ないこと、明示presetでは従来互換を保つことを受け入れ条件に落とす
   - `docs/specs/` にSpec文書を追加し、内部spec clausesと対応づける

3. Repo profile判定を追加する
   - `story derive` の入力ファイルから `next-app`, `web`, `api-service`, `python-cli`, `library`, `data-pipeline`, `unknown` などのrepo profileを推定する
   - package metadata、拡張子、HTTP framework、Next.js app router、CLI script、Python module構造を根拠として記録する
   - 判定結果を `story-catalog.json` と `story-map.md` に出す

4. Preset applicability gateを導入する
   - `--preset` 未指定時はWeb/SaaS product surface signalsを自動適用しない
   - presetごとに必要証拠を持たせ、証拠不足なら確定Storyではなく候補または警告へ落とす
   - `--preset next-app` または `story_catalog.preset` 明示時は従来互換でNext.js presetを適用する

5. 非Web回帰fixtureを追加する
   - Python CLI / algorithmic trading相当のfixtureを作る
   - auth、CMS、notificationのStoryが `story_cluster` として生成されないことをテストする
   - 既存Next.js fixtureでは明示presetまたはauto判定で従来Storyが生成されることをテストする

6. Domain mismatch warningを出す
   - preset適用が不確実な場合は `needs_domain_confirmation` または同等のwarningを出す
   - `story_cluster (N paths)` が実ドメイン証拠を持たない場合、validatedなStoryとして表示しない
   - `story-map.md` に「template候補」と「証拠付きStory」の違いが分かる表示を追加する
