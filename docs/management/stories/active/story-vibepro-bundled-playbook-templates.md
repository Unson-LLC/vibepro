---
story_id: story-vibepro-bundled-playbook-templates
title: Story Engineering Playbookの必須テンプレをVibePro本体に同梱する
status: active
architecture_docs:
  - docs/architecture/vibepro-bundled-playbook-templates.md
spec_docs:
  - docs/specs/vibepro-bundled-playbook-templates.md
parent_design: vibepro-bundled-playbook-templates
---

# Story Engineering Playbookの必須テンプレをVibePro本体に同梱する

## 背景
`vibepro playbook export` はStory単位のPlaybook artifactを生成できるが、テンプレート本体がVibePro repo内に存在しないと、利用者には「どの型を選んでいるのか」が追えない。

元になった開発プレイブックは非公開repoにあるため、VibeProの実行時に外部repoを読みに行く設計にはできない。OSS利用者にも意味が通る名前と配置で、必須テンプレだけをVibePro本体に同梱する必要がある。

## 受け入れ基準
- 必須テンプレだけが `docs/playbooks/story-engineering-playbook/` に入っている。
- `product/`、`architecture/`、`testing/`、`features/_feature-template/`、`adr/_template.md` が含まれる。
- `design/` と `discovery/` は初期同梱対象外としてcatalogに明示される。
- `vibepro playbook export` は対象repoではなく、VibeProパッケージに同梱されたcatalogを読む。
- 出力JSON/Markdownには選択されたtemplate idとローカルtemplate pathが含まれる。
- npm packageに `docs/playbooks` が含まれる。
- OSS利用者に伝わらない個人名、非公開repo名、会社固有名を含めない。

## Scope
- `docs/playbooks/story-engineering-playbook/`
- `src/playbook-exporter.js`
- `test/playbook-exporter.test.js`
- `package.json`

## Non-goals
- `design/` と `discovery/` の同梱
- 外部repoからの同期機能
- 全体設計図の自動更新
- Story実行後のArchitecture正本への自動反映
