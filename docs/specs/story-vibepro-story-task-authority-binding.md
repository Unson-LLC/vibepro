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
そのtasksに存在する場合だけ続行する。失敗時はaccepted authorityとgenerated
proposalを混同せず、canonical pathと修復用`task bind` commandを示す。
