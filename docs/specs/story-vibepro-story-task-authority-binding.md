# Spec: Story-scoped task authority binding

## Command

`vibepro task bind <repo> --id <story-id> --input <tracked-json> [--json]`

## Input schema

```json
{
  "schema_version": "0.1.0",
  "story_id": "story-example",
  "tasks": [
    {
      "task_id": "TASK-001",
      "story_id": "story-example",
      "title": "Implement boundary",
      "allowed_paths": ["src/example.js", "test/example.test.js"]
    }
  ]
}
```

`story_id`と各`task_id` / `story_id` / `allowed_paths`は必須。Task IDはtrim後に
非空かつ一意、allowed pathはrepo相対で非空、repo外へ解決せず、diagnostic
proposalを示す`source_run`や`source_type`を含まないこと。

## Canonical output

canonical task planは`authority.status = "accepted"`、正規化済み`tasks`、
`provenance.input_path`、`provenance.input_sha256`を持つ。時刻は保存しない。

## PR selection

`pr prepare --task X`はcanonical task planがaccepted authorityであり、Xが
そのtasksに存在する場合だけ続行する。選択時にはcanonical schema、accepted status、
tracked inputのrepo相対pathと現在内容のSHA-256、入力とcanonical双方のStory・Task
schema、一意性、allowed path境界を再検証する。

さらにbase refはHEADのancestor、head refは現在のHEADでなければならない。
`base...HEAD`の全変更pathが選択Taskの`allowed_paths`（exact path、directory prefix、
`*` / `**` glob）に含まれる場合だけprepareを続行する。Task未指定経路にはこの検証を
適用しない。失敗時はaccepted authorityとgenerated proposalを混同せず、canonical
pathと修復用`task bind` commandを示す。
