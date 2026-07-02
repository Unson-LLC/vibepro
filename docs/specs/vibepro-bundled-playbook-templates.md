---
story_id: story-vibepro-bundled-playbook-templates
title: Story Engineering Playbook同梱テンプレート仕様
status: draft
parent_design: vibepro-bundled-playbook-templates
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        User["VibePro CLI利用者"] --> CLI["vibepro playbook export"]
        CLI --> PackageCatalog["同梱catalog.json"]
        PackageCatalog --> Templates["同梱Markdownテンプレート"]
        CLI --> Output[".vibepro/playbook成果物"]
        ExternalRepo["対象repo"] -. "テンプレート参照元として信用しない" .-> CLI
        PrivateRepo["非公開playbook repo"] -. "実行時には読まない" .-> CLI
        Templates --> Guard["catalog path検証"]
        Guard --> Output
---

# Story Engineering Playbook同梱テンプレート仕様

## 不変条件

- `BP-INV-001`: `vibepro playbook export` は対象repoではなく、VibeProパッケージrootからStory Engineering Playbook catalogを読む。
- `BP-INV-002`: 同梱catalogは `docs/playbooks/story-engineering-playbook/` 配下のpathだけを参照する。
- `BP-INV-003`: catalog pathが存在しない、playbook root外へ出る、または読み取れない場合、runtime exportは明示的に失敗する。
- `BP-INV-004`: template選択はEngineering Judgment / Gate DAGの判断として維持し、`catalog.json` は同梱template fileの目録に限定する。
- `BP-INV-005`: OSS packageには同梱playbook templateを含め、VibePro内部workspaceのartifactは含めない。
- `BP-INV-006`: 同梱template本文には、非公開repo URL、個人名由来のラベル、OSS利用者に意味が通らない社内固有名を含めない。

## 契約

- `BP-CONTRACT-001`: `docs/playbooks/story-engineering-playbook/catalog.json` をStory Engineering Playbook templateのローカルpackage catalogとする。
- `BP-CONTRACT-002`: `exportStoryEngineeringPlaybook()` はJSON出力に `playbook_catalog` source metadataと選択済み `template_paths` を含める。
- `BP-CONTRACT-003`: Markdown出力にはcatalog pathと、選択されたtemplate decisionに対応するローカルtemplate pathを表示する。
- `BP-CONTRACT-004`: `package.json#files` に `docs/playbooks` を含め、npm package利用者がcatalogとtemplateを受け取れるようにする。
- `BP-CONTRACT-005`: 初期同梱rootは `product/`、`architecture/`、`testing/`、`features/_feature-template/`、`adr/_template.md` とし、`design/` と `discovery/` は後続storyで必要になるまで除外する。

## シナリオ

- `BP-SCENARIO-001`: ローカルplaybook templateを持たない対象repoで `vibepro playbook export` を実行すると、同梱package catalogを読み、選択済み `template_paths` を出力する。
- `BP-SCENARIO-002`: 同梱catalog entryのpathがplaybook root外へ出る場合、VibeProは誤ったplaybook outputを書き込む前に失敗する。
- `BP-SCENARIO-003`: npm packagingのdry-run file listを確認すると、`docs/playbooks/story-engineering-playbook/catalog.json` と必須template fileが含まれ、`docs/releases` は除外されている。
- `BP-SCENARIO-004`: 同梱templateをprivate name denylistでscanすると、test denylist pattern以外はmatchしない。

## 検証

- `BP-VERIFY-001`: `npm run typecheck` でCLIとsource syntaxを確認する。
- `BP-VERIFY-002`: focused unit testで、同梱catalogの読み取り、出力されるtemplate path、playbook export CLI出力、fallback selection、OSS package metadata、npm dry-run allowlistを確認する。
- `BP-VERIFY-003`: package dry-run evidenceで、36個のplaybook fileと `catalog.json` が含まれることを確認する。
- `BP-VERIFY-004`: sensitive-name scanで、同梱docsとruntime codeにprivate identifierが残っていないことを確認する。
