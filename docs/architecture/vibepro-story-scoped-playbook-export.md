# Story単位のStory Engineering Playbook出力アーキテクチャ

## 目的
Story実装前の認知負荷を下げるため、VibeProが既に持つStory、Spec、Architecture、Engineering Judgment / Gate DAGを読み、Story単位の開発ブリーフとしてStory Engineering Playbookを生成する。

## 境界
- `src/playbook-exporter.js` が読み取りと成果物生成を担当する。
- `src/cli.js` は `vibepro playbook export` の引数解決と表示だけを担当する。
- `.vibepro/playbook/<story-id>/playbook.json` と `.vibepro/playbook/<story-id>/story-engineering-playbook.md` は生成artifactであり、実装ソースの正本ではない。

## 判断フロー
1. `.vibepro/config.json` から対象Storyを解決する。
2. `docs/management/stories/**/<story-id>.md` とfrontmatterの `architecture_docs` を読む。
3. `.vibepro/spec/<story-id>/spec.json` と `.vibepro/pr/<story-id>/pr-prepare.json` / `gate-dag.json` があれば読む。
4. Engineering Judgmentのactive axis、Gate DAG node、route typeを優先してテンプレを選択する。
5. PR prepareが未生成のearly phaseでは、Story/Spec/Architecture本文からfallback signalを出すが、そのsourceを明示する。
