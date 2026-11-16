# 保存済みPR説明の投影設計

## 境界

`report write` が検証して保存した `.vibepro/report/<story-id>/pr-body/narrative.json` を説明の正本とする。`preparePullRequest` が同じStory IDでこの正本を読み、固定のPR本文骨格へ派生表示する。

投影時には保存済み `inputs_digest` を、現在のStory・HEAD・トレーサビリティ・Spec・ドリフト・検証・レビューから再計算した指紋と比較する。検証はコマンドreceipt全体、レビューは役割別状態と収束スナップショットを指紋へ含める。一致しない説明は現在状態として描画せず、更新が必要な候補として警告だけを表示する。

```text
report write
  -> validateReportNarrative
  -> narrative.json
  -> preparePullRequest
  -> renderPrBody
  -> pr-body.md
  -> gh pr create/edit --body-file
```

## 判断

- `pr-manager.js` は独自の状態欄を再定義せず、既存の `readNarrative` を使う。
- 説明は `pr-prepare.json` に複製せず、生成時だけ読む。監査正本を増やさない。
- `renderPrBody` の固定骨格は維持し、その冒頭に「保存済みの判断説明」欄を追加する。
- 各スロットは許可済みの4種類だけを描画し、Talking Point IDと生成者を残す。
- 各スロット本文は単一行・280文字以内の平文に限定し、Markdown見出し、リスト、罫線、引用、強調、リンク、コード記法、HTMLなど固定骨格を変える構造を保存時に拒否する。
- 説明がない場合は空文字を返し、既存本文を変えない。
- Task派生表示は生成候補の `id` / `target_files` / `dependencies` と、受理済み正本の `task_id` / `allowed_paths` / `depends_on` の両方を明示的に正規化し、正本の項目名を表示契約へ漏らさない。

## 表示契約

- 現在指紋と一致する検証済み説明だけを固定見出し内へ表示する。
- 指紋不一致または再検証失敗時は説明本文を抑止し、再生成が必要だと明示する。
- 呼び出し側が渡した `inputs_digest` は信用せず、VibeProが読んだ指紋で上書きする。
- 同一HEADで検証証拠の観測値またはレビュー役割の結果だけが変わった場合も、保存済み説明を古いものとして抑止する。

## 代替案と不採用理由

- Acceptance Criteriaへ現在状態を埋め込む案は、要求と実行結果を混同するため不採用。
- `gh pr edit` 後に手で追記する案は、VibeProの生成artifactとGitHub表示を分岐させるため不採用。
- PR本文全体をAI生成する案は、固定骨格と監査可能性を失うため不採用。

## 互換性・ロールバック

説明がない既存Storyでは出力が変わらない。問題があれば `readNarrative` 接続と説明Rendererを戻すだけで、保存済み説明や既存PR artifactは破壊しない。
