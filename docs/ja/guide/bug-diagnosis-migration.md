# バグ診断への移行

バグ修正の上位ワークフローはVibeProに一本化します。旧Verify-first入口は独立したDAGを持ちません。

## バグStoryを登録する

新しいStoryは作成時に契約種別を指定します。

```bash
vibepro story add . --id story-example-bug --title "障害を修正する" --contract-type bug_fix
vibepro story diagnose . --id story-example-bug --pre-architecture --run-graphify
```

既存Storyでは、`.vibepro/config.json` の対象Storyへ `"contract_type": "bug_fix"` を追加してから `story diagnose` を実行します。診断runはStory、run、Git HEADに結び付いた `.vibepro/bug-diagnosis/<story-id>/<run-id>/bug-diagnosis.json` を作成します。

## 診断証拠を順番に記録する

`vibepro bug diagnose record` で次の順に記録します。

1. `failure_reproduced`（`--path-id` 必須）
2. `failure_localized`
3. `relationship_analysis`
4. `preconditions_confirmed`
5. `root_cause_confirmed`
6. `regression_test_failed_before_fix`
7. `root_fix_applied`
8. `same_path_reverified`（再現時と同じ `--path-id` 必須）

成功にする各ノードには1件以上の `--evidence` が必要で、現在のHEADも記録されます。関係分析は `data_flow`、`control_flow`、`async_flow`、`module_boundary`、`change_history` から障害に必要なものだけを選びます。関係分析が不要なら `relationship_analysis` を、決定的な回帰テストを作れない場合は `regression_test_failed_before_fix` を、具体的な `--reason` 付きで `not_applicable` にできます。

記録構文の全体は `vibepro bug diagnose record --help` で確認できます。このガイドには、
成功証跡をそのまま自己申告できるコピー用コマンドを載せません。実行者が現在のStory runと
HEADに対応する証跡を指定してください。

新しい診断証跡は
`.vibepro/bug-diagnosis/<story-id>/<run-id>/bug-diagnosis.json` に保存し、
記録成功ごとにworktree非依存のプロセス記録ストアへ複製します。
従来の `.vibepro/diagnostics/...` を指すmanifestは後方互換として引き続き読み取れます。

診断が未完了なら、`pr prepare` は `gate_status: blocked` と `return_to_node`、`next_actions` を保存します。全必須ノードが受理されるまで `pr create` はPRの作成・更新を拒否します。単体テストの成功だけではこの契約を満たしません。
最終診断記録後にHEADが変わった場合、証跡は古いものとして扱われ、`pr prepare` は
`failure_reproduced` へ戻します。現在のHEADで診断をやり直してください。

## Verify-first互換入口

`vibepro verify-first` は非推奨です。警告を表示したうえで、登録済みバグStoryに対する同じ `story diagnose` 実装を呼び出します。別の証拠モデルやDAGは作りません。

| 旧Verify-first段階 | VibeProバグStoryノード |
|---|---|
| 再現 | `failure_reproduced` |
| 発生箇所の特定 | `failure_localized` |
| 関係と前提の分析 | `relationship_analysis`、`preconditions_confirmed` |
| 根本原因の確定 | `root_cause_confirmed` |
| 回帰証拠の追加 | `regression_test_failed_before_fix` |
| 根本修正 | `root_fix_applied` |
| 再検証 | `same_path_reverified` |

自動化は `story diagnose` と `bug diagnose record` へ移行してください。互換入口は移行状況を確認した後、次のメジャーリリースで削除候補になります。
