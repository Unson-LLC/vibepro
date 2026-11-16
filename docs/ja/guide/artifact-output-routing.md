# 成果物出力ルーティング

VibePro は `.vibepro/config.json` を canonical artifact の追跡可能なリポジトリ契約として使います。`vibepro init` は生成 workspace を ignore しつつ、この設定ファイルだけは追跡可能にします。

`artifact_routing` がない場合、既存パスと動作は変わりません。プロジェクト固有の feature packet へまとめる例:

```json
{
  "artifact_routing": {
    "schema_version": "0.1.0",
    "artifacts": {
      "story": { "canonical": "docs/features/{feature_slug}/01_behavior_spec.md" },
      "architecture": { "canonical": "docs/features/{feature_slug}/04_technical_delta.md" },
      "accepted_spec": { "canonical": "docs/features/{feature_slug}/02_functional_spec.json" },
      "task_plan": { "canonical": "docs/features/{feature_slug}/06_tasks.md" }
    }
  }
}
```

安定変数は `{story_id}` と `{feature_slug}` です。どちらも lowercase kebab-case になり、`feature_slug` は先頭の `story-` を除きます。パスは repository-relative に限られます。絶対パス、traversal、未解決変数、複数種別の同一 destination は書き込み前に拒否されます。

各種別の writable artifact は単一の `canonical` だけです。projection は次のように machine-managed と明示した場合だけ利用できます。

```json
{
  "path": "docs/generated/{story_id}/architecture.md",
  "generated": true
}
```

projection は再生成可能な表示であり、編集可能な第二正本ではありません。

ファイルを変更せず契約と migration plan を確認できます。

```bash
vibepro artifacts resolve . --id story-example --json
vibepro artifacts migrate . --id story-example --dry-run --json
```

plan は旧既定パス、解決後の destination、存在状態、必要な move、collision を報告します。内容を確認してから tracked artifact を移動してください。

rollback は設定を削除するだけの操作ではありません。migration plan は、現在の設定から解決した destination と、既定の source を比較して作られます。そのため、先に `artifact_routing` を削除すると、custom destination を自動的に推測できません。戻すときは、設定を削除する前に dry-run の `source` と `destination` の対応を保存し、collision と ownership を確認します。その対応表に従って custom artifact を既定パスへ移動し、既存ファイルを上書きせずに確認してから `artifact_routing` を削除してください。すでに削除した場合は、削除前の設定または Git 履歴から対応表を復元します。削除後の新しい dry-run だけでは、元の custom layout を復元できません。
