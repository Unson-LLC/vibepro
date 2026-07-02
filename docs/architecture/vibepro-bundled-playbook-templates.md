---
title: Story Engineering Playbook同梱テンプレートアーキテクチャ
status: draft
related_stories:
  - story-vibepro-bundled-playbook-templates
---

# Story Engineering Playbook同梱テンプレートアーキテクチャ

## 目的
Story Engineering PlaybookのテンプレートをVibePro本体に同梱し、非公開repoや外部同期に依存せず、Story単位のPlaybook exportが参照元テンプレを説明できるようにする。

## 配置
必須テンプレートは `docs/playbooks/story-engineering-playbook/` に配置する。

```text
docs/playbooks/story-engineering-playbook/
  catalog.json
  product/
  architecture/
  testing/
  features/_feature-template/
  adr/_template.md
```

`design/` と `discovery/` は初期同梱対象外とする。UI/UX storyや既存プロダクト導入storyで必要になった時点で、別Storyとして追加する。

## 実行時の読み取り
`src/playbook-exporter.js` は対象repoではなく、VibeProパッケージrootから `docs/playbooks/story-engineering-playbook/catalog.json` を読む。

この境界により、`vibepro playbook export /path/to/user/repo` を実行しても、利用側repoにPlaybookテンプレを事前配置する必要はない。

## catalogの役割
`catalog.json` は選択ロジックではない。

- catalog id
- 同梱対象root
- 初期対象外root
- template idごとのローカルmdパス

を持つ目録である。

templateの採否は引き続きEngineering Judgment / Gate DAGを優先する。PR prepareやGate DAGが未生成の場合だけ、Story/Spec/Architecture本文のsurface signalをfallbackとして明示する。

## 出力契約
`.vibepro/playbook/<story-id>/playbook.json` と `story-engineering-playbook.md` には、選択されたtemplate idに加えて `template_paths` を出力する。

これにより、人間は「VibeProがなぜその項目を出したか」だけでなく、「どのローカルテンプレに基づく項目か」も確認できる。

## パッケージング
npm packageには `docs/playbooks` を含める。

`playbook export` は起動時にcatalog内の全 `template_paths` を読み取り、同梱漏れやpath traversalを検出した場合は明示的に失敗する。
