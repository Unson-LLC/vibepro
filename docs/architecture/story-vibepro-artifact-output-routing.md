# Artifact Output Routing Architecture

## Context

VibePro の成果物パスは、生成、読み込み、検出、Gate、PR preparation の各モジュールに固定値として分散している。コマンド単位の `--output` は生成先だけを変えるため、読み込み先との divergence を生む。さらに `.vibepro/config.json` 自体を一律 ignore すると、custom routing を fresh checkout で復元できない。

## Decision

### 1. Repository contract

`.vibepro/config.json` のトップレベル `artifact_routing` を追跡可能な repository contract とする。

```json
{
  "artifact_routing": {
    "schema_version": "0.1.0",
    "artifacts": {
      "story": {
        "canonical": "docs/features/{feature_slug}/story.md",
        "projections": []
      },
      "architecture": {
        "canonical": "docs/features/{feature_slug}/04_technical_delta.md"
      }
    }
  }
}
```

`canonical` は成果物種別ごとに一つの writable path template だけを許可する。`projections` は中央 writer を持つ Architecture、accepted Spec、Task plan に限って `{ path, generated: true }` の宣言を受理し、編集可能な第二正本として扱わない。その他の種別への projection 宣言は、生成漏れを黙認せず `unsupported_projection` で拒否する。

### 2. Shared resolver

`src/artifact-routing.js` を唯一の path contract resolver とする。責務は次の通り。

- 既定 template と repository 設定の merge
- `{story_id}` と `{feature_slug}` の安定した展開
- repository-relative path への正規化
- 絶対パス、traversal、未解決変数、canonical collision、projection ambiguity の拒否
- canonical / projection lineage の構造化出力
- read/discovery と write/output へ同一 resolved path を提供

`feature_slug` は `story-` prefix を除いた story ID を lowercase kebab-case 化する。`story_id` は通常 path-safe な lowercase kebab-case 表現とするが、`STR-047` や `US-002` のような既存 tracker の opaque ID（大文字英数字 prefix + 数字）は identity と filesystem 上の参照を壊さないよう大文字小文字を保持する。

### 3. Integration boundary

最初の統合面は、tracked または長期参照される artifact contract を持つ以下の種別とする。

- `story`
- `architecture`
- `accepted_spec`
- `task_plan`
- `graphify`
- `review`
- `gate`
- `pr`

生成側だけでなく Story discovery、Architecture read/write、Spec read/write、Task plan、Graphify/review/Gate/PR の story binding が resolver を共有する。内部の一時ファイル、history、lock、raw log は routing 対象外とし、canonical artifact から派生する runtime evidence として従来の workspace 配下に残す。

### 4. Migration

`vibepro artifacts migrate <repo> --id <story-id> --dry-run [--json]` は書き込みを行わず、各種別について default source、resolved destination、存在状態、collision、unresolved reference、required move を返す。初期実装は安全な計画作成のみで、自動 move は行わない。

## Compatibility

`artifact_routing` がない場合は従来の path template をそのまま使う。Architecture の明示 `--output` は一回限りの override として残すが、repository routing と異なる場合は divergence を拒否する。

## Rollback

`artifact_routing` を削除すれば既定パス契約へ戻る。migration は dry-run のみなので tracked files を暗黙に移動せず、rollback に追加操作を要求しない。

## Rejected alternatives

- コマンドごとの `--output`: discovery と Gate が同じ場所を読む保証がない。
- symlink による統一: platform 差と repository traversal の境界が曖昧になる。
- canonical を配列で宣言: writable SSOT を複数作り、Issue の目的に反する。
