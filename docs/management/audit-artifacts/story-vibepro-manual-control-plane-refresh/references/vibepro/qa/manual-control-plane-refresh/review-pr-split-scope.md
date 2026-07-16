# PR split scope review

- status: pass
- agent: /root/docs_pr_split_scope
- head: 8fc53f0ee91aca631d1d0b7a5874e591bff533b9

45ファイルは多いが、公開マニュアル刷新という一意図に収束している。日英対称ガイド、CLI生成元と生成物、公開境界、発見性、契約テストは相互依存し、分割すると中間状態で契約不整合を作るためsplit不要。無関係変更なし。

## Finding

- low `split-plan-stale-input`: 旧HEADのsplit-planはstale。現HEADでpr prepareを再生成すること。

## Judgment delta

45ファイルのためsplit候補だったが、各差分をStory/Spec 8条項へ分類した結果、原子的なbundled scopeと判断してpass。
